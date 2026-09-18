<?php
// All filesystem mutations are confined to a new temporary fixture directory.
$root = str_replace('\\', '/', sys_get_temp_dir()) . '/acp-ownership-' . bin2hex(random_bytes(8));
mkdir($root, 0700, true);
foreach (array('state', 'shares', 'templates', 'projects/demo', 'candidate') as $part) mkdir($root . '/' . $part, 0700, true);
file_put_contents($root . '/docker.cfg', "DOCKER_APP_CONFIG_PATH=\"/mnt/user/appdata\"\n");
file_put_contents($root . '/shares/appdata.cfg', "shareName=\"appdata\"\n");
file_put_contents($root . '/candidate/keep.txt', 'untouched');
foreach (array('STATE_ROOT'=>'state', 'DOCKER_CONFIG_PATH'=>'docker.cfg', 'SHARE_CONFIG_DIR'=>'shares', 'DOCKER_TEMPLATE_DIR'=>'templates', 'COMPOSE_PROJECTS_DIR'=>'projects', 'DOCKER_RUNTIME_PATH'=>'candidate', 'VM_CONFIG_PATH'=>'missing-vm.cfg') as $key=>$value) putenv('APPDATA_CLEANUP_PLUS_' . $key . '=' . $root . '/' . $value);
$plugin = dirname(__DIR__) . '/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus/include/';
foreach (array('helpers.php', 'pathUtils.php', 'dashboard.php', 'quarantine.php', 'api.php', 'templates.php') as $file) require_once $plugin . $file;
class DockerClient {
  public static $success = true;
  public static $records = array();
  public function getDockerJSON($path, $method='GET', &$success=null) {
    check($path === '/containers/json?all=1' && $method === 'GET', 'Ownership must query all containers directly.');
    $success = self::$success;
    return self::$records;
  }
}
function check($condition, $message) { if (!$condition) throw new RuntimeException($message); }
function containerRecord($path, $name='owner') { return array('Id'=>'fixture', 'Names'=>array('/' . $name), 'Mounts'=>$path === '' ? array() : array(array('Type'=>'bind', 'Source'=>$path, 'Destination'=>'/config'))); }
function clearFixture($root) {
  $real = realpath($root);
  $temp = realpath(sys_get_temp_dir());
  check($real && dirname($real) === $temp && strpos(basename($real), 'acp-ownership-') === 0, 'Cleanup must stay inside the generated temporary root.');
  foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($real, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST) as $entry) {
    if ($entry->isDir() && !$entry->isLink()) rmdir($entry->getPathname());
    else unlink($entry->getPathname());
  }
  rmdir($real);
}
try {
  check(appdataCleanupPlusDockerInventory()['ok'], 'Successful empty inventory must be usable.');
  DockerClient::$success = 'Server error';
  check(!appdataCleanupPlusDockerInventory()['ok'], 'Failed empty list must block.');
  DockerClient::$success = true;
  DockerClient::$records = array('message'=>'API error');
  check(!appdataCleanupPlusDockerInventory()['ok'], 'Error objects must block.');
  DockerClient::$records = array(array('Id'=>'incomplete', 'Names'=>array('/owner')));
  check(!appdataCleanupPlusDockerInventory()['ok'], 'Missing mount inventory must block.');
  DockerClient::$records = array(array('Id'=>'incomplete', 'Names'=>array(), 'Mounts'=>array()));
  check(!appdataCleanupPlusDockerInventory()['ok'], 'Missing container names must not make installed templates look stale.');
  DockerClient::$records = array(array('Id'=>'incomplete', 'Names'=>array('/owner'), 'Mounts'=>array(array('Type'=>'unknown'))));
  check(!appdataCleanupPlusDockerInventory()['ok'], 'Unknown mount types must not silently bypass ownership.');
  $settings = getDefaultAppdataCleanupPlusSafetySettings();
  foreach (array('/mnt/user/appdata/demo', '/mnt/user/appdata', '/mnt/user/appdata/demo/child') as $mount) {
    DockerClient::$records = array(containerRecord($mount));
    check(appdataCleanupPlusCurrentOwnershipLockReason('/mnt/user/appdata/demo', $settings) !== '', 'Exact, parent and child mounts must block actions.');
    $result = resolveCandidateForAction(array('path'=>'/mnt/user/appdata/demo'), $settings, 'quarantine');
    check(!$result['ok'] && strpos($result['message'], 'installed container') !== false, 'Resolver must refresh ownership after a scan.');
  }
  DockerClient::$records = array();
  $env = array();
  file_put_contents($root . '/projects/demo/.env', "export APPDATA=/mnt/user/appdata\nEMPTY=\n");
  check(appdataCleanupPlusParseEnvFileIntoMap($root . '/projects/demo/.env', $env), 'Read exported variables.');
  check(appdataCleanupPlusExpandComposeEnv('${APPDATA}/demo', $env) === '/mnt/user/appdata/demo', 'Expand exported variables.');
  check(appdataCleanupPlusExpandComposeEnv('${EMPTY-fallback}', $env) === '', 'Unset-only default must preserve empty variables.');
  check(appdataCleanupPlusExpandComposeEnv('${EMPTY:-fallback}', $env) === 'fallback', 'Empty-or-unset default must work.');
  foreach (array('/mnt/user/appdata/demo', '/mnt/user/./appdata/demo', '/mnt/user//appdata/demo', '/mnt/user/appdata/demo/child', '/mnt/user/appdata', '/mnt/user/appdata/My App') as $path) {
    foreach (array("      - \"$path:/config\"", "      - type: bind\n        source: \"$path\"\n        target: /config") as $volume) {
      file_put_contents($root . '/projects/demo/compose.yaml', "services:\n  app:\n    volumes:\n$volume\n");
      $meta = array(); $protected = appdataCleanupPlusComposeReferencedPaths($settings, $meta);
      $expected = strpos($path, 'My App') !== false ? '/mnt/user/appdata/My App' : '/mnt/user/appdata/demo';
      check(!$meta['uncertain'] && appdataCleanupPlusCurrentOwnershipLockReason($expected, $settings) !== '', 'Supported short/long binds must protect normalized paths, spaces and parents.');
      check(removeComposeReferencedCandidates(array('row'=>array('HostDir'=>$expected)), $protected) === array(), 'Scan must apply the same overlap policy.');
    }
  }
  foreach (array('      - /mnt/user/appdata/../appdata/demo:/config', '      - ${MISSING}/demo:/config', '      - ./demo:/config') as $volume) {
    file_put_contents($root . '/projects/demo/compose.yaml', "services:\n  app:\n    volumes:\n$volume\n");
    $meta = array(); appdataCleanupPlusComposeReferencedPaths($settings, $meta);
    check($meta['uncertain'], 'Ambiguous binds must not silently produce an empty protected set.');
  }
  // Indirect stacks and project-side overrides remain protective when down.
  mkdir($root . '/indirect');
  file_put_contents($root . '/projects/demo/indirect', $root . '/indirect');
  file_put_contents($root . '/indirect/compose.yml', "services:\n  app:\n    volumes:\n      - /mnt/user/appdata/indirect:/config\n");
  file_put_contents($root . '/projects/demo/compose.override.yml', "services:\n  app:\n    volumes:\n      - /mnt/user/appdata/override:/config\n");
  check(appdataCleanupPlusCurrentOwnershipLockReason('/mnt/user/appdata/indirect', $settings) !== '', 'Indirect stacks must be protected.');
  check(appdataCleanupPlusCurrentOwnershipLockReason('/mnt/user/appdata/override', $settings) !== '', 'Project overrides must be protected.');
  unlink($root . '/projects/demo/indirect');
  unlink($root . '/projects/demo/compose.override.yml');
  unlink($root . '/projects/demo/compose.yaml');
  foreach (array('/config2', '/config-backup', '/CONFIG', '/config/../other') as $target) check(!appdataCleanupPlusIsConfigTarget($target), 'Config targets must be case and segment exact.');
  check(appdataCleanupPlusIsConfigTarget('/config') && appdataCleanupPlusIsConfigTarget('/config/nested'), 'Config descendants remain valid.');

  // Failed ownership blocks real and preview actions without touching the candidate.
  DockerClient::$success = 'unreachable';
  foreach (array('quarantine', 'delete', 'dry-run-quarantine', 'dry-run-delete') as $operation) {
    $result = executeCandidateOperation(array(array('path'=>$root . '/candidate')), $settings, $operation);
    check($result['results'][0]['status'] === 'blocked', 'Unverified action must block.');
    check(file_get_contents($root . '/candidate/keep.txt') === 'untouched', 'Blocked action must preserve data.');
  }
  DockerClient::$success = true;
  $xml = '<Container><Name>saved-app</Name><Config Type="Variable" Target="PASSWORD">private-fixture-value</Config></Container>';
  $templateFile = $root . '/templates/my-saved-app.xml';
  file_put_contents($templateFile, $xml);
  $status = appdataCleanupPlusTemplateManagerPayload();
  $id = $status['templates'][0]['id'];
  check(strpos(json_encode($status), 'private-fixture-value') === false, 'UI must never receive raw template contents.');
  DockerClient::$records = array(containerRecord('', 'saved-app'));
  check(!appdataCleanupPlusTemplateManagerAction('archive', $id)['ok'] && is_file($templateFile), 'A newly installed container protects its saved template.');
  DockerClient::$records = array();
  file_put_contents($templateFile, $xml . '\n');
  check(!appdataCleanupPlusTemplateManagerAction('archive', $id)['ok'], 'Changed template must invalidate old ID.');
  file_put_contents($templateFile, $xml);
  check(!appdataCleanupPlusTemplateManagerAction('archive', '../../escape')['ok'], 'Path-like IDs must be rejected.');
  $archived = appdataCleanupPlusTemplateManagerAction('archive', $id);
  check($archived['ok'] && !is_file($templateFile), 'Archive removes only the selected saved template after backup.');
  $history = buildAuditHistoryRows();
  check(strpos(json_encode($history[0]['message']), 'folders were moved') === false && strpos(json_encode($history[0]['message']), 'saved template was archived') !== false, 'Template history must describe the template action, not a folder quarantine.');
  $status = appdataCleanupPlusTemplateManagerPayload();
  $backupId = $status['backups'][0]['id'];
  check(appdataCleanupPlusTemplateBackup($backupId)['contents'] === $xml, 'Backup must preserve exact configuration bytes.');
  file_put_contents($templateFile, 'new template');
  check(!appdataCleanupPlusTemplateManagerAction('restore', $backupId)['ok'] && file_get_contents($templateFile) === 'new template', 'Restore must never overwrite an existing file.');
  unlink($templateFile);
  check(appdataCleanupPlusTemplateManagerAction('restore', $backupId)['ok'] && file_get_contents($templateFile) === $xml, 'Restore recovers the original bytes.');
  check(appdataCleanupPlusTemplateBackup($backupId) !== null, 'Restore retains the backup.');
  $bundle = json_encode(buildAppdataCleanupPlusDiagnosticsBundle());
  check(strpos($bundle, 'private-fixture-value') === false && strpos($bundle, 'my-saved-app.xml') === false && strpos($bundle, $backupId) === false, 'Server diagnostics must exclude backup content, filenames and IDs.');
  $backupFile = appdataCleanupPlusTemplateBackupDir() . '/' . $backupId . '.json';
  $backup = json_decode(file_get_contents($backupFile), true);
  $backup['contents'] = 'corrupt';
  writeAppdataCleanupPlusJsonFile($backupFile, $backup);
  check(appdataCleanupPlusTemplateBackup($backupId) === null, 'Corrupt backups must be rejected.');
  check(file_get_contents($root . '/candidate/keep.txt') === 'untouched', 'Template maintenance must not change appdata.');
  echo "ownership_templates: OK (inventory, action revalidation, Compose variants, exact targets, backup and collision recovery)\n";
} finally {
  releaseAllAppdataCleanupPlusRuntimeLocks();
  clearFixture($root);
}
