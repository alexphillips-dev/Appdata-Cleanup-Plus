<?php
// All writes and simulated attacks stay inside a unique disposable fixture.
$root = str_replace('\\', '/', sys_get_temp_dir()) . '/acp-runtime-' . bin2hex(random_bytes(8));
mkdir($root, 0700);
mkdir($root . '/state', 0700);
putenv('APPDATA_CLEANUP_PLUS_STATE_ROOT=' . $root . '/state');
putenv('APPDATA_CLEANUP_PLUS_RUNTIME_ROOT=' . $root . '/runtime');
$plugin = dirname(__DIR__) . '/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus/include/';
foreach (array('helpers.php', 'pathUtils.php', 'dashboard.php', 'quarantine.php', 'api.php', 'fixtures.php') as $file) require_once $plugin . $file;
function runtimeCheck($ok, $message) { if (!$ok) throw new RuntimeException($message); }
function resetRuntimeCache() { $store =& appdataCleanupPlusRuntimeStore(); unset($store['statsCacheState']); }
try {
  $missing = appdataCleanupPlusRuntimeLockFile('missing');
  runtimeCheck(appdataCleanupPlusInspectRuntimeLockFile($missing)['held'] === null, 'Missing lock status is unknown.');
  runtimeCheck(appdataCleanupPlusRecentOperations() === array() && !file_exists($root . '/runtime'), 'Status reads must not create runtime storage.');
  runtimeCheck(acquireAppdataCleanupPlusRuntimeLock('cleanup-operation'), 'A trusted runtime directory is created.');
  runtimeCheck(!acquireAppdataCleanupPlusRuntimeLock('cleanup-operation'), 'Concurrent acquisition fails.');
  runtimeCheck(!recoverAppdataCleanupPlusStaleRuntimeLockFile(appdataCleanupPlusRuntimeLockFile('cleanup-operation')), 'Recovery cannot touch a held lock.');
  releaseAllAppdataCleanupPlusRuntimeLocks();
  runtimeCheck(!recoverAppdataCleanupPlusStaleRuntimeLockFile(appdataCleanupPlusRuntimeLockFile('cleanup-operation')), 'Fresh metadata is not stale.');
  runtimeCheck(appdataCleanupPlusInitializeOperationProgress('fixture', 'delete', 1) === 'fixture', 'Progress uses the same secured JSON writer.');
  $before = file_get_contents(appdataCleanupPlusOperationProgressFile('fixture'));
  appdataCleanupPlusRecentOperations();
  runtimeCheck(file_get_contents(appdataCleanupPlusOperationProgressFile('fixture')) === $before && !file_exists($missing), 'Status does not mutate progress or create missing lock files.');

  $legacyCache = $root . '/state/path-stats-cache.json';
  file_put_contents($legacyCache, '{"legacy":"untouched"}');
  resetRuntimeCache();
  runtimeCheck(getCachedAppdataCleanupPlusPathStats('/synthetic/cache') === null, 'Old persistent cache is ignored.');
  setCachedAppdataCleanupPlusPathStats('/synthetic/cache', array('sizeBytes'=>42));
  runtimeCheck(persistAppdataCleanupPlusStatsCacheIfDirty(), 'Runtime cache persists.');
  runtimeCheck(dirname(appdataCleanupPlusStatsCacheFile()) === $root . '/runtime', 'Cache is outside persistent configuration.');
  resetRuntimeCache();
  runtimeCheck(getCachedAppdataCleanupPlusPathStats('/synthetic/cache')['sizeBytes'] === 42, 'A new request reads the runtime cache.');
  $cache = readAppdataCleanupPlusJsonFile(appdataCleanupPlusStatsCacheFile());
  $cache[appdataCleanupPlusPathStatsCacheKey('/synthetic/cache')]['cachedAt'] = time() - 901;
  writeAppdataCleanupPlusJsonFile(appdataCleanupPlusStatsCacheFile(), $cache);
  resetRuntimeCache();
  runtimeCheck(getCachedAppdataCleanupPlusPathStats('/synthetic/cache') === null, 'Expiry remains effective.');
  for ($i=0; $i<520; $i++) setCachedAppdataCleanupPlusPathStats('/synthetic/cache-' . $i, array('sizeBytes'=>$i));
  runtimeCheck(persistAppdataCleanupPlusStatsCacheIfDirty() && count(readAppdataCleanupPlusJsonFile(appdataCleanupPlusStatsCacheFile())) === 512, 'Cache remains bounded.');
  unlink(appdataCleanupPlusStatsCacheFile());
  resetRuntimeCache();
  runtimeCheck(getCachedAppdataCleanupPlusPathStats('/synthetic/cache') === null, 'Lost runtime cache rebuilds after reboot.');
  setCachedAppdataCleanupPlusPathStats('/synthetic/cache', array('sizeBytes'=>99));
  runtimeCheck(persistAppdataCleanupPlusStatsCacheIfDirty(), 'Cache is rebuilt on demand.');
  clearCachedAppdataCleanupPlusPathStats('/synthetic/cache');
  runtimeCheck(getCachedAppdataCleanupPlusPathStats('/synthetic/cache') === null, 'Cleanup invalidates cached statistics.');
  runtimeCheck(file_get_contents($legacyCache) === '{"legacy":"untouched"}', 'Legacy cache is not rewritten or removed.');

  if (PHP_OS_FAMILY !== 'Windows') {
    clearstatcache();
    runtimeCheck((fileperms($root . '/runtime') & 0777) === 0700 && (fileperms(appdataCleanupPlusStatsCacheFile()) & 0777) === 0600, 'Runtime directories and files are private.');
    chmod($root . '/runtime', 0755);
    appdataCleanupPlusRecentOperations();
    clearstatcache();
    runtimeCheck((fileperms($root . '/runtime') & 0777) === 0755, 'Reads must not chmod legacy directories.');
    runtimeCheck(acquireAppdataCleanupPlusRuntimeLock('upgrade'), 'Safe legacy directories upgrade without replacing locks.');
    releaseAllAppdataCleanupPlusRuntimeLocks();
    clearstatcache();
    runtimeCheck((fileperms($root . '/runtime') & 0777) === 0700, 'A writer tightens a trusted legacy directory.');

    $sentinel = $root . '/sentinel.json';
    file_put_contents($sentinel, '{"private":"preserve"}');
    foreach (array('symlink', 'link') as $plant) {
      $lock = appdataCleanupPlusRuntimeLockFile('planted');
      runtimeCheck($plant($sentinel, $lock), 'Plant isolated fixture link.');
      runtimeCheck(!acquireAppdataCleanupPlusRuntimeLock('planted'), 'Planted lock is rejected: ' . $plant);
      runtimeCheck(appdataCleanupPlusInspectRuntimeLockFile($lock)['held'] === null, 'Planted lock is not inspected.');
      runtimeCheck(!recoverAppdataCleanupPlusStaleRuntimeLockFile($lock), 'Recovery cannot truncate a planted lock.');
      unlink($lock);
    }
    foreach (array('active-operation.json', 'active-operation.json.lock', 'path-stats-cache.json.lock') as $name) {
      $path = $root . '/runtime/' . $name;
      if (file_exists($path)) unlink($path);
      symlink($sentinel, $path);
      $target = substr($name, -5) === '.lock' ? substr($path, 0, -5) : $path;
      runtimeCheck(!writeAppdataCleanupPlusJsonFile($target, array('overwrite'=>true)), 'Runtime JSON refuses planted target/lock: ' . $name);
      if (substr($name, -5) !== '.lock') runtimeCheck(readAppdataCleanupPlusJsonFile($path) === array(), 'Runtime JSON does not read through links.');
      unlink($path);
    }
    mkdir($root . '/external', 0700);
    file_put_contents($root . '/external/keep.json', '{}');
    rename($root . '/runtime/operation-progress', $root . '/saved-progress');
    symlink($root . '/external', $root . '/runtime/operation-progress');
    runtimeCheck(appdataCleanupPlusRecentOperations() === array(), 'Progress reader rejects linked directories.');
    appdataCleanupPlusPruneOperationProgress('fixture');
    runtimeCheck(file_exists($root . '/external/keep.json') && !appdataCleanupPlusWriteOperationProgress('planted', array()), 'Pruning and writing reject linked directories.');
    unlink($root . '/runtime/operation-progress');
    rename($root . '/saved-progress', $root . '/runtime/operation-progress');
    rename($root . '/runtime', $root . '/saved-runtime');
    symlink($root . '/saved-runtime', $root . '/runtime');
    runtimeCheck(!acquireAppdataCleanupPlusRuntimeLock('linked-root') && appdataCleanupPlusRecentOperations() === array(), 'A linked runtime root is refused for writes and status.');
    unlink($root . '/runtime');
    rename($root . '/saved-runtime', $root . '/runtime');
    chmod($root . '/runtime', 0777);
    runtimeCheck(!acquireAppdataCleanupPlusRuntimeLock('unsafe'), 'Writable-by-others runtime directory is refused.');
    clearstatcache();
    runtimeCheck((fileperms($root . '/runtime') & 0777) === 0777, 'An unsafe directory is not repaired by chmod.');
    setCachedAppdataCleanupPlusPathStats('/synthetic/unavailable', array('sizeBytes'=>1));
    runtimeCheck(!persistAppdataCleanupPlusStatsCacheIfDirty(), 'Unavailable runtime cache fails without a persistent fallback.');
    chmod($root . '/runtime', 0700);
    if (function_exists('posix_geteuid') && posix_geteuid() === 0) {
      chown($root . '/runtime', 65534);
      runtimeCheck(!acquireAppdataCleanupPlusRuntimeLock('wrong-owner'), 'Unexpected owner is refused even by root.');
      clearstatcache();
      runtimeCheck(fileowner($root . '/runtime') === 65534, 'Unexpected ownership is not repaired.');
      chown($root . '/runtime', 0);
    } else echo "runtime_safety: SKIP foreign-owner fixture (requires root)\n";
    runtimeCheck(file_get_contents($sentinel) === '{"private":"preserve"}', 'All planted-link targets remain untouched.');
  } else echo "runtime_safety: SKIP POSIX permissions and links (Windows)\n";

  mkdir($root . '/candidate', 0700);
  file_put_contents($root . '/candidate/keep', 'preserve');
  foreach (array(false, '', 'malformed mount inventory') as $inventory) {
    $GLOBALS['APPDATA_CLEANUP_PLUS_TEST_MOUNTINFO'] = $inventory;
    runtimeCheck(appdataCleanupPlusMountStatus($root . '/candidate') === 'unknown', 'Unavailable mount information is unknown.');
    runtimeCheck(pathIsMountPoint($root . '/candidate'), 'Boolean compatibility callers fail closed.');
    runtimeCheck(!nativeDeleteDirectory($root . '/candidate')['ok'], 'Unknown mount status blocks actual deletion.');
    runtimeCheck(buildPathSecurityLockReason($root . '/candidate', null, array('kind'=>'zfs')) !== '', 'Exact ZFS mapping cannot bypass unknown mount status.');
    runtimeCheck(!appdataCleanupPlusFixturePathIsSafe($root . '/candidate/' . appdataCleanupPlusFixtureNames()['empty'], $root . '/candidate'), 'Fixture creation refuses an unverified parent.');
  }
  $GLOBALS['APPDATA_CLEANUP_PLUS_TEST_MOUNTINFO'] = "36 25 0:32 / / rw - ext4 /dev/root rw\n";
  runtimeCheck(appdataCleanupPlusMountStatus($root . '/candidate') === 'directory', 'Usable mount inventory permits ordinary directories.');
  runtimeCheck(appdataCleanupPlusFixturePathIsSafe($root . '/candidate/' . appdataCleanupPlusFixtureNames()['empty'], $root . '/candidate'), 'Fixture creation can preflight a missing reserved child beneath a verified parent.');
  // Execute the shipped helper with injected stat failure, without a production
  // bypass or touching real mount tables. Namespace wrappers affect only this copy.
  $source = file_get_contents($plugin . 'pathUtils.php');
  eval('namespace RuntimeMountFailure; function stat($path) { return false; } function appdataCleanupPlusCanonicalizePath($p) { return \\appdataCleanupPlusCanonicalizePath($p); } ' . substr($source, 5));
  runtimeCheck(\RuntimeMountFailure\appdataCleanupPlusMountStatus($root . '/candidate') === 'unknown', 'Failed directory/parent stat is unknown.');
  runtimeCheck(\RuntimeMountFailure\inspectDirectoryTreeForUnsafeEntries($root . '/candidate') !== '', 'Tree inspection refuses failed metadata.');
  runtimeCheck(file_get_contents($root . '/candidate/keep') === 'preserve', 'Blocked cleanup preserves data.');
  echo "runtime_safety: OK\n";
} finally {
  releaseAllAppdataCleanupPlusRuntimeLocks();
  $store =& appdataCleanupPlusRuntimeStore();
  $store['statsCacheState'] = array('entries'=>array(), 'dirty'=>false, 'shutdownRegistered'=>true);
  unset($GLOBALS['APPDATA_CLEANUP_PLUS_TEST_MOUNTINFO']);
  $real = realpath($root);
  if ($real && dirname($real) === realpath(sys_get_temp_dir()) && strpos(basename($real), 'acp-runtime-') === 0) {
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($real, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST) as $entry) {
      if ($entry->isDir() && !$entry->isLink()) rmdir($entry->getPathname());
      else unlink($entry->getPathname());
    }
    rmdir($real);
  }
}
