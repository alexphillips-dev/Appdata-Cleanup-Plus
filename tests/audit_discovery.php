<?php
// Every write stays in a unique system-temp directory. The fake ZFS CLI records
// arguments only: it never calls ZFS or removes candidate data.
if (($argv[1] ?? '') === '--zfs-fixture') {
  $fixture = $argv[2] ?? '';
  $real = realpath($fixture);
  if (!$real || dirname($real) !== realpath(sys_get_temp_dir()) || strpos(basename($real), 'acp-discovery-') !== 0) exit(2);
  $args = array_slice($argv, 3);
  $state = json_decode(file_get_contents($real . '/zfs.json'), true);
  if ($args === array('list', '-H', '-o', 'name,mountpoint', '-t', 'filesystem')) {
    if (!empty($state['fail'])) exit(1);
    foreach ($state['map'] as $mount => $name) echo $name . "\t" . $mount . "\n";
    exit(0);
  }
  if (($args[0] ?? '') !== 'destroy') exit(2);
  if (in_array('-nvp', $args, true)) exit(0);
  if (count($args) !== 2) exit(2);
  file_put_contents($real . '/destroy.log', $args[1] . "\n", FILE_APPEND);
  if (!empty($state['afterFirst'])) {
    $state['map'] = $state['afterFirst'];
    unset($state['afterFirst']);
    file_put_contents($real . '/zfs.json', json_encode($state));
  }
  exit(0);
}

if (DIRECTORY_SEPARATOR !== '/') {
  echo "audit_discovery: SKIP (requires POSIX paths; run in an isolated Linux environment)\n";
  exit(0);
}

function discoveryCheck($condition, $message) {
  if (!$condition) throw new RuntimeException($message);
}
function discoveryRemoveFixture($root) {
  $real = realpath($root);
  discoveryCheck($real && dirname($real) === realpath(sys_get_temp_dir()) && strpos(basename($real), 'acp-discovery-') === 0, 'Cleanup must remain inside this temporary fixture.');
  foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($real, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST) as $entry) {
    if ($entry->isDir() && !$entry->isLink()) rmdir($entry->getPathname());
    else unlink($entry->getPathname());
  }
  rmdir($real);
}
class DockerClient {
  public static $records = array();
  public function getDockerJSON($path, $method='GET', &$success=null, $callback=null, $unchunk=false) {
    discoveryCheck($method === 'GET', 'Only read-only Docker fixture requests are allowed.');
    $success = true;
    $body = json_encode(self::$records);
    if ($callback) $callback($body);
    return self::$records;
  }
}

$root = str_replace('\\', '/', sys_get_temp_dir()) . '/acp-discovery-' . bin2hex(random_bytes(8));
mkdir($root, 0700);
foreach (array('state', 'shares', 'templates', 'projects/demo', 'source/db', 'source/warm', 'poolA/db', 'poolB/db', 'elsewhere/db', 'backing/vm', 'backing/docker', 'backing/ordinary') as $part) mkdir($root . '/' . $part, 0700, true);
file_put_contents($root . '/source/db/keep.txt', 'untouched');
file_put_contents($root . '/docker.cfg', "DOCKER_APP_CONFIG_PATH=\"/mnt/user/appdata\"\nDOCKER_IMAGE_FILE=\"" . $root . "/backing/docker/docker.img\"\n");
file_put_contents($root . '/vm.cfg', 'DOMAINDIR="' . $root . "/backing/vm\"\n");
file_put_contents($root . '/shares/appdata.cfg', "shareName=\"appdata\"\n");
foreach (array('STATE_ROOT'=>'state', 'RUNTIME_ROOT'=>'runtime', 'DOCKER_RUNTIME_PATH'=>'source', 'DOCKER_CONFIG_PATH'=>'docker.cfg', 'VM_CONFIG_PATH'=>'vm.cfg', 'SHARE_CONFIG_DIR'=>'shares', 'DOCKER_TEMPLATE_DIR'=>'templates', 'COMPOSE_PROJECTS_DIR'=>'projects') as $key=>$value) putenv('APPDATA_CLEANUP_PLUS_' . $key . '=' . $root . '/' . $value);
putenv('APPDATA_CLEANUP_PLUS_ZFS_CLIENT_COMMAND=' . escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__) . ' --zfs-fixture ' . escapeshellarg($root));
$include = dirname(__DIR__) . '/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus/include/';
foreach (array('helpers.php', 'pathUtils.php', 'dashboard.php', 'quarantine.php') as $file) require_once $include . $file;
$GLOBALS['APPDATA_CLEANUP_PLUS_TEST_MOUNT_POINTS'] = array();
try {
  $settings = getDefaultAppdataCleanupPlusSafetySettings();
  $settings['manualAppdataSources'] = array($root . '/source', $root . '/poolA', $root . '/poolB');
  $settings['enablePermanentDelete'] = true;
  $writeMap = function($map, $extra=array()) use ($root) {
    file_put_contents($root . '/zfs.json', json_encode(array_merge(array('map'=>$map), $extra)));
  };
  // Virtual /mnt spellings exercise Unraid's share-collapsing comparison
  // without ever creating or changing a real /mnt directory.
  $physicalA = '/mnt/audit-pool-a/appdata/db';
  $physicalB = '/mnt/audit-pool-b/appdata/db';
  $writeMap(array($physicalB=>'poolB/db'));
  discoveryCheck(appdataCleanupPlusResolveStorageForPath($physicalA, $settings, true)['kind'] === 'filesystem', 'AUD-01: share-relative equality cannot identify a different physical pool.');
  discoveryCheck(!appdataCleanupPlusDestroyZfsDataset('poolB/db', false, $settings, $physicalA, $physicalB)['ok'] && !file_exists($root . '/destroy.log'), 'Wrong physical identity must never reach destructive dispatch.');
  $writeMap(array($physicalA=>'poolA/db', $physicalB=>'poolB/db'));
  discoveryCheck(appdataCleanupPlusResolveStorageForPath($physicalA, $settings, true)['datasetName'] === 'poolA/db' && appdataCleanupPlusResolveStorageForPath($physicalB, $settings, true)['datasetName'] === 'poolB/db', 'Two physical pools retain distinct dataset identities.');
  $writeMap(array($root . '/poolB/db'=>'poolB/db'));
  discoveryCheck(appdataCleanupPlusResolveStorageForPath($root . '/poolA/db', $settings, true)['kind'] === 'filesystem', 'AUD-01: a different physical pool must not supply dataset identity.');
  discoveryCheck(appdataCleanupPlusResolveStorageForPath($root . '/poolB/db', $settings, true)['datasetName'] === 'poolB/db', 'Exact physical identity remains supported.');
  $mapped = $settings;
  $mapped['zfsPathMappings'] = array(array('shareRoot'=>$root . '/source', 'datasetRoot'=>$root . '/poolB'));
  discoveryCheck(appdataCleanupPlusResolveStorageForPath($root . '/source/db', $mapped, true)['datasetName'] === 'poolB/db', 'An explicit disjoint mapping preserves dataset resolution.');
  $writeMap(array('/mnt/audit-pool/appdata/db'=>'audit-pool/appdata/db'));
  $unknown = appdataCleanupPlusResolveStorageForPath('/mnt/user/appdata/db', $settings, true);
  discoveryCheck($unknown['kind'] === 'zfs_unavailable' && $unknown['lockReason'] !== '', 'An unresolved FUSE alias must be locked, never actionable filesystem fallback.');
  $missingMappingReason = 'ZFS backing could not be verified. Review or add a path mapping in Tools > ZFS path mappings, then rescan.';
  foreach (array('/mnt/user/appdata/db', '/mnt/user0/appdata/db') as $unmappedPath) {
    $unmapped = appdataCleanupPlusResolveStorageForPath($unmappedPath, $settings, true);
    discoveryCheck($unmapped['lockReason'] === $missingMappingReason && $unmapped['resolutionDetail'] === $missingMappingReason, 'Fresh unresolved share paths explain the mapping requirement in both row and Details fields.');
    discoveryCheck(appdataCleanupPlusResolveStorageForPath($unmappedPath, $settings)['lockReason'] === $missingMappingReason, 'Cached resolution retains actionable mapping guidance.');
  }
  $shareMapped = $settings;
  $shareMapped['zfsPathMappings'] = array(array('shareRoot'=>'/mnt/user/appdata', 'datasetRoot'=>'/mnt/audit-pool/appdata'));
  $resolvedShare = appdataCleanupPlusResolveStorageForPath('/mnt/user/appdata/db', $shareMapped, true);
  discoveryCheck($resolvedShare['kind'] === 'zfs' && $resolvedShare['datasetName'] === 'audit-pool/appdata/db' && $resolvedShare['lockReason'] === '', 'Saving the matching mapping resolves the same previously blocked share path.');
  $writeMap(array('/mnt/audit-pool/appdata/db/child'=>'audit-pool/appdata/db/child'));
  discoveryCheck(appdataCleanupPlusResolveStorageForPath('/mnt/user/appdata/db', $settings, true)['lockReason'] === $missingMappingReason, 'A FUSE parent cannot bypass an unresolved possible child dataset and receives mapping guidance.');
  discoveryCheck(appdataCleanupPlusResolveStorageForPath('/mnt/user/appdata/db/child/ordinary', $settings, true)['kind'] === 'filesystem', 'Ordinary child folders inside a dataset do not gain dataset identity.');
  $ambiguous = $mapped;
  $ambiguous['zfsPathMappings'][] = array('shareRoot'=>$root . '/source', 'datasetRoot'=>$root . '/poolA');
  $writeMap(array($root . '/poolA/db'=>'poolA/db', $root . '/poolB/db'=>'poolB/db'));
  discoveryCheck(appdataCleanupPlusResolveStorageForPath($root . '/source/db', $ambiguous, true)['lockReason'] !== '', 'Conflicting explicit identities must fail closed.');

  // AUD-02: real batch dispatcher, mutation of fake inventory after row one.
  $map = array($root . '/source/warm'=>'pool/warm', $root . '/source/db'=>'pool/db');
  $writeMap($map, array('afterFirst'=>array($root . '/source/warm'=>'pool/warm', $root . '/elsewhere/db'=>'pool/db', $root . '/source/db'=>'replacement/db')));
  appdataCleanupPlusGetZfsDatasetMountMap(true);
  $result = executeCandidateOperation(array(
    array('path'=>$root . '/source/warm', 'realPath'=>realpath($root . '/source/warm'), 'datasetName'=>'pool/warm'),
    array('path'=>$root . '/source/db', 'realPath'=>realpath($root . '/source/db'), 'datasetName'=>'pool/db')
  ), $settings, 'delete');
  discoveryCheck(($result['results'][0]['status'] ?? '') === 'deleted', 'Unchanged first batch identity must dispatch: ' . json_encode($result));
  discoveryCheck(($result['results'][1]['status'] ?? '') !== 'deleted', 'AUD-02: stale second identity must not dispatch.');
  discoveryCheck(strpos($result['results'][1]['message'] ?? '', 'ZFS dataset mapping changed since the last scan.') !== false, 'Actual stale deletion targets retain the distinct rescan warning.');
  discoveryCheck(trim(file_get_contents($root . '/destroy.log')) === 'pool/warm', 'Only the freshly authorized dataset may reach the fake CLI.');
  $writeMap($map);
  discoveryCheck(appdataCleanupPlusDestroyZfsDataset('pool/db', false, $settings, $root . '/source/db', $root . '/source/db')['ok'], 'An unchanged fresh identity must still dispatch.');
  $before = file_get_contents($root . '/destroy.log');
  DockerClient::$records = array(array('Id'=>'new-owner', 'Names'=>array('/new-owner'), 'Mounts'=>array(array('Type'=>'bind', 'Source'=>$root . '/source/db', 'Destination'=>'/config'))));
  discoveryCheck(!appdataCleanupPlusDestroyZfsDataset('pool/db', false, $settings, $root . '/source/db', $root . '/source/db')['ok'] && file_get_contents($root . '/destroy.log') === $before, 'A new specific owner blocks the final boundary even with unchanged dataset identity.');
  DockerClient::$records = array();
  discoveryCheck(!appdataCleanupPlusDestroyZfsDataset('pool/db', false, $settings)['ok'], 'A name alone never authorizes destruction.');
  $writeMap($map, array('fail'=>true));
  discoveryCheck(!appdataCleanupPlusDestroyZfsDataset('pool/db', false, $settings, $root . '/source/db', $root . '/source/db')['ok'], 'Failed final inventory must block.');
  $writeMap(array());

  // AUD-03: omitted valid layouts must block every operation, with a supported
  // block bind and quoted environment literals as separate negative controls.
  foreach (array(
    "services:\n  app: {image: example, volumes: [\"./db:/config\"]}\n",
    "\"services\": {\"app\": {\"volumes\": [\"./db:/config\"]}}\n",
    "services:\n  app:\n    volumes:\n      - type: bind\n        \"source\": \"./db\"\n        target: /config\n",
    "services:\n  app:\n    \"volumes\": [\"./db:/config\"]\n",
    "services:\n  app:\n    volumes: [\"./db:/config\"]\n",
    "'include': other.yml\nservices: {}\n",
    "services:\n  app:\n    'extends': other.yml\n"
  ) as $yaml) {
    file_put_contents($root . '/source/compose.yml', $yaml);
    file_put_contents($root . '/projects/demo/indirect', $root . '/source/compose.yml');
    file_put_contents($root . '/projects/demo/indirect_mode', 'file');
    $meta = array();
    appdataCleanupPlusComposeReferencedPaths($settings, $meta);
    discoveryCheck($meta['uncertain'], 'AUD-03: unsupported ownership structure cannot be verified empty.');
    foreach (array('preview_delete', 'delete', 'quarantine', 'dry-run-delete', 'dry-run-quarantine') as $operation) {
      $result = executeCandidateOperation(array(array('path'=>$root . '/source/db')), $settings, $operation);
      discoveryCheck(($result['results'][0]['status'] ?? '') === 'blocked', 'Uncertain Compose inventory blocks all action paths.');
      discoveryCheck(file_get_contents($root . '/source/db/keep.txt') === 'untouched', 'Blocked actions preserve candidate contents.');
    }
  }
  file_put_contents($root . '/source/compose.yml', "services:\n  app:\n    volumes:\n      - ./db:/config\n");
  $protected = appdataCleanupPlusComposeReferencedPaths($settings, $meta);
  discoveryCheck(!$meta['uncertain'] && in_array($root . '/source/db', $protected, true), 'Supported relative block binds remain verified and protective.');
  $uncertain = false;
  appdataCleanupPlusComposeBindHosts("# volumes: [example]\n# \"source\": ./db\nservices:\n  app:\n    environment:\n      TEXT: 'volumes: [./db:/config] source: *literal example \"source\": ./db'\n", $uncertain, $root . '/source');
  discoveryCheck(!$uncertain, 'Comments and quoted environment strings must not become structural uncertainty.');
  $uncertain = false;
  $hosts = appdataCleanupPlusComposeBindHosts("services:\n  app:\n    volumes: []\nvolumes:\n  db: {}\n", $uncertain, $root . '/source');
  discoveryCheck(!$uncertain && $hosts === array(), 'Actual empty bind lists and empty named-volume definitions are harmless.');
  unlink($root . '/projects/demo/indirect');
  unlink($root . '/projects/demo/indirect_mode');

  // AUD-14: reject entire expanding graphs and bound legacy runtime consumers.
  $a = '/mnt/user/audit'; $b = '/mnt/pool/audit'; $c = '/srv/appdata/audit';
  foreach (array(
    array(array('shareRoot'=>$a, 'datasetRoot'=>$a . '/loop')),
    array(array('shareRoot'=>$a . '/loop', 'datasetRoot'=>$a)),
    array(array('shareRoot'=>$a, 'datasetRoot'=>$b), array('shareRoot'=>$b . '/child', 'datasetRoot'=>$a . '/deeper')),
    array(array('shareRoot'=>$a, 'datasetRoot'=>$b), array('shareRoot'=>$b, 'datasetRoot'=>$c), array('shareRoot'=>$c . '/nested', 'datasetRoot'=>$a))
  ) as $mappings) {
    discoveryCheck(appdataCleanupPlusValidateZfsPathMappings($mappings) !== '', 'Expanding mapping graphs must be rejected before persistence.');
    $rejected = false;
    try { appdataCleanupPlusBuildZfsResolutionPathVariants($a . '/db', array('zfsPathMappings'=>$mappings)); } catch (RuntimeException $exception) { $rejected = true; }
    discoveryCheck($rejected, 'Invalid legacy mappings must fail closed at runtime.');
  }
  $valid = array(array('shareRoot'=>$a, 'datasetRoot'=>$b), array('shareRoot'=>$b, 'datasetRoot'=>$c), array('shareRoot'=>$a, 'datasetRoot'=>$b));
  discoveryCheck(appdataCleanupPlusValidateZfsPathMappings($valid) === '', 'Finite multi-hop and duplicate mappings remain valid.');
  discoveryCheck(count(appdataCleanupPlusBuildZfsResolutionPathVariants($a . '/db', array('zfsPathMappings'=>$valid))) === 3, 'Finite aliases terminate with expected identities.');
  $large = array();
  for ($i=0; $i<65; $i++) $large[] = array('shareRoot'=>'/srv/alias-' . $i, 'datasetRoot'=>'/srv/backing-' . $i);
  discoveryCheck(appdataCleanupPlusValidateZfsPathMappings($large) !== '', 'Oversized stored graphs are rejected deterministically.');
  $chain = array();
  for ($i=0; $i<64; $i++) $chain[] = array('shareRoot'=>'/mnt/audit-pool-' . $i . '/root-' . $i, 'datasetRoot'=>'/mnt/audit-pool-' . ($i+1) . '/root-' . ($i+1));
  discoveryCheck(appdataCleanupPlusValidateZfsPathMappings($chain) === '', 'The traversal-budget control must be a finite valid graph.');
  discoveryCheck(count(appdataCleanupPlusBuildZfsResolutionPathVariants('/mnt/audit-pool-0/root-0/db', array('zfsPathMappings'=>$chain))) === 65, 'Finite exact identity traversal remains bounded.');
  $rejected = false;
  try { appdataCleanupPlusBuildZfsResolutionPathVariants('/mnt/audit-pool-0/root-0/db', array('zfsPathMappings'=>$chain), true); } catch (RuntimeException $exception) { $rejected = true; }
  discoveryCheck($rejected, 'Independent ownership-variant budget fails closed even for a finite valid graph.');
  $legacy = $settings;
  $legacy['zfsPathMappings'] = array(array('shareRoot'=>$a, 'datasetRoot'=>$a . '/loop'));
  discoveryCheck(setAppdataCleanupPlusSafetySettings($legacy), 'Seed only the private fixture with legacy invalid settings.');
  $rejected = false;
  try { appdataCleanupPlusPathComparisonVariants($a . '/db'); } catch (RuntimeException $exception) { $rejected = true; }
  discoveryCheck($rejected, 'Shared ownership comparison also fails closed on invalid stored graphs.');
  discoveryCheck(setAppdataCleanupPlusSafetySettings($settings), 'Restore private valid settings.');

  // R-01: supported source-root links may expose ordinary backing directories,
  // but may never remove managed VM/Docker protection through another spelling.
  if (DIRECTORY_SEPARATOR === '/') {
    discoveryCheck(symlink($root . '/backing', $root . '/linked-source'), 'Create private source-root link.');
    $linked = $settings;
    $linked['manualAppdataSources'][] = $root . '/linked-source';
    discoveryCheck(setAppdataCleanupPlusSafetySettings($linked), 'Persist private source-link settings for the production exemption.');
    foreach (array('vm', 'docker') as $child) {
      $path = $root . '/linked-source/' . $child;
      discoveryCheck(appdataCleanupPlusBuildManagedSystemLockReason($path) !== '', 'R-01: canonical backing storage remains protected.');
      foreach (array('delete', 'quarantine') as $operation) discoveryCheck(!resolveCandidateForAction(array('path'=>$path), $linked, $operation)['ok'], 'Managed source aliases must fail action authorization.');
    }
    discoveryCheck(resolveCandidateForAction(array('path'=>$root . '/linked-source/ordinary'), $linked, 'quarantine')['ok'], 'Ordinary configured source links retain intended support.');
  } else echo "audit_discovery: SKIP POSIX source-link integration\n";
  discoveryCheck(file_get_contents($root . '/source/db/keep.txt') === 'untouched', 'All canaries remain unchanged.');
  echo "audit_discovery: OK (exact ZFS identity, fresh batch dispatch, Compose certainty, bounded mappings, canonical managed aliases)\n";
} finally {
  releaseAllAppdataCleanupPlusRuntimeLocks();
  discoveryRemoveFixture($root);
}
