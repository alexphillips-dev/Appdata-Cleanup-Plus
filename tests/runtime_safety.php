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
  runtimeCheck(appdataCleanupPlusDiagnosticsRuntimeLockSummary()['inspectionStatus'] === 'missing', 'Missing lock storage is not verified empty.');
  runtimeCheck(appdataCleanupPlusDiagnosticsStatsCacheSummary()['entryCount'] === null, 'Missing cache is not reported as an empty cache.');
  runtimeCheck(!file_exists($root . '/runtime'), 'Diagnostics must not create runtime storage.');
  runtimeCheck(acquireAppdataCleanupPlusRuntimeLock('cleanup-operation'), 'A trusted runtime directory is created.');
  runtimeCheck(!acquireAppdataCleanupPlusRuntimeLock('cleanup-operation'), 'Concurrent acquisition fails.');
  runtimeCheck(appdataCleanupPlusDiagnosticsRuntimeLockSummary()['locks'][0]['held'] === true, 'Diagnostics identifies a held lock without releasing it.');
  runtimeCheck(!recoverAppdataCleanupPlusStaleRuntimeLockFile(appdataCleanupPlusRuntimeLockFile('cleanup-operation')), 'Recovery cannot touch a held lock.');
  releaseAllAppdataCleanupPlusRuntimeLocks();
  $lockFile = appdataCleanupPlusRuntimeLockFile('cleanup-operation');
  $lockBytes = file_get_contents($lockFile);
  unlink($lockFile);
  runtimeCheck(appdataCleanupPlusDiagnosticsRuntimeLockSummary()['inspectionStatus'] === 'verified_empty', 'An inspected empty lock directory is verified empty.');
  file_put_contents($lockFile, $lockBytes);
  chmod($lockFile, 0600);
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
  $missingCacheChecks = array_column(appdataCleanupPlusDiagnosticsTroubleshootingSummary(array())['checks'], null, 'id');
  runtimeCheck($missingCacheChecks['stats-cache']['status'] === 'info' && !file_exists(appdataCleanupPlusStatsCacheFile()), 'Missing disposable cache is informational and not rebuilt by diagnostics.');
  resetRuntimeCache();
  runtimeCheck(getCachedAppdataCleanupPlusPathStats('/synthetic/cache') === null, 'Lost runtime cache rebuilds after reboot.');
  setCachedAppdataCleanupPlusPathStats('/synthetic/cache', array('sizeBytes'=>99));
  runtimeCheck(persistAppdataCleanupPlusStatsCacheIfDirty(), 'Cache is rebuilt on demand.');
  clearCachedAppdataCleanupPlusPathStats('/synthetic/cache');
  runtimeCheck(getCachedAppdataCleanupPlusPathStats('/synthetic/cache') === null, 'Cleanup invalidates cached statistics.');
  runtimeCheck(file_get_contents($legacyCache) === '{"legacy":"untouched"}', 'Legacy cache is not rewritten or removed.');
  $cacheFile = appdataCleanupPlusStatsCacheFile();
  writeAppdataCleanupPlusJsonFile($cacheFile, array(
    '/private-canary/current' => array('cachedAt'=>time(), 'path'=>'/private-canary/current'),
    'expired' => array('cachedAt'=>time()-901), 'malformed' => array('cachedAt'=>'bad')));
  $cacheBefore = file_get_contents($cacheFile);
  $cacheHealth = appdataCleanupPlusDiagnosticsStatsCacheSummary();
  runtimeCheck($cacheHealth['storage'] === 'runtime' && $cacheHealth['ttlSeconds'] === 900, 'Cache summary identifies volatile storage and TTL.');
  runtimeCheck($cacheHealth['entryCount'] === 3 && $cacheHealth['validEntryCount'] === 1 && $cacheHealth['expiredEntryCount'] === 1 && $cacheHealth['invalidEntryCount'] === 1, 'Cache summary separates current, expired and invalid entries.');
  runtimeCheck(strpos(json_encode($cacheHealth), 'private-canary') === false, 'Cache diagnostics exclude keys and stored paths.');
  runtimeCheck(file_get_contents($cacheFile) === $cacheBefore, 'Diagnostics must not rebuild or prune the cache.');
  file_put_contents($cacheFile, '{invalid');
  runtimeCheck(appdataCleanupPlusDiagnosticsStatsCacheSummary()['reasonCode'] === 'invalid_json', 'Corrupt cache has an explicit read failure.');
  file_put_contents($cacheFile, '{}');
  runtimeCheck(appdataCleanupPlusDiagnosticsStatsCacheSummary()['entryCount'] === 0, 'A valid empty cache has zero entries.');
  file_put_contents($cacheFile, str_repeat(' ', 5242881));
  runtimeCheck(appdataCleanupPlusDiagnosticsStatsCacheSummary()['reasonCode'] === 'size_limit', 'Runtime JSON inspection is bounded.');
  file_put_contents($cacheFile, $cacheBefore);

  if (PHP_OS_FAMILY !== 'Windows') {
    clearstatcache();
    runtimeCheck((fileperms($root . '/runtime') & 0777) === 0700 && (fileperms(appdataCleanupPlusStatsCacheFile()) & 0777) === 0600, 'Runtime directories and files are private.');
    chmod($root . '/runtime', 0755);
    appdataCleanupPlusRecentOperations();
    appdataCleanupPlusDiagnosticsRuntimeLockSummary();
    appdataCleanupPlusDiagnosticsStatsCacheSummary();
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
      $lockHealth = appdataCleanupPlusDiagnosticsRuntimeLockSummary();
      $expectedReason = $plant === 'symlink' ? 'unsafe_symlink' : 'unsafe_hardlink';
      runtimeCheck($lockHealth['inspectionStatus'] === 'inspection_refused' && $lockHealth['reasonCounts'][$expectedReason] === 1, 'Diagnostics reports a refused linked lock with a fixed reason.');
      runtimeCheck(!recoverAppdataCleanupPlusStaleRuntimeLockFile($lock), 'Recovery cannot truncate a planted lock.');
      unlink($lock);
    }
    rename($cacheFile, $cacheFile . '.saved');
    foreach (array('symlink', 'link') as $plant) {
      $plant($sentinel, $cacheFile);
      $health = appdataCleanupPlusDiagnosticsStatsCacheSummary();
      runtimeCheck($health['status'] === 'failed' && $health['entryCount'] === null && $health['reasonCode'] === ($plant === 'symlink' ? 'unsafe_symlink' : 'unsafe_hardlink'), 'Linked cache is refused without reading the target.');
      runtimeCheck(appdataCleanupPlusDiagnosticsJsonFileHealth('stats-cache', $cacheFile)['validation'] === 'inspection_refused', 'Generic health cannot bypass runtime validation.');
      unlink($cacheFile);
    }
    rename($cacheFile . '.saved', $cacheFile);
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
    runtimeCheck(appdataCleanupPlusDiagnosticsRuntimeLockSummary()['reasonCode'] === 'unsafe_symlink', 'Linked runtime root is diagnosed without following it.');
    unlink($root . '/runtime');
    rename($root . '/saved-runtime', $root . '/runtime');
    chmod($root . '/runtime', 0777);
    runtimeCheck(!acquireAppdataCleanupPlusRuntimeLock('unsafe'), 'Writable-by-others runtime directory is refused.');
    $health = appdataCleanupPlusDiagnosticsTroubleshootingSummary(array());
    $byId = array_column($health['checks'], null, 'id');
    runtimeCheck($byId['runtime-locks']['status'] === 'warning' && $byId['runtime-locks']['details']['reasonCode'] === 'unsafe_permissions', 'Refused lock inspection must never produce a healthy finding.');
    runtimeCheck($byId['runtime-safety']['status'] === 'error', 'Unsafe runtime directory has an explicit health finding.');
    runtimeCheck(appdataCleanupPlusDiagnosticsStatsCacheSummary()['reasonCode'] === 'unsafe_permissions', 'Cache reports refused runtime permissions.');
    clearstatcache();
    runtimeCheck((fileperms($root . '/runtime') & 0777) === 0777, 'An unsafe directory is not repaired by chmod.');
    setCachedAppdataCleanupPlusPathStats('/synthetic/unavailable', array('sizeBytes'=>1));
    runtimeCheck(!persistAppdataCleanupPlusStatsCacheIfDirty(), 'Unavailable runtime cache fails without a persistent fallback.');
    chmod($root . '/runtime', 0700);
    if (function_exists('posix_geteuid') && posix_geteuid() === 0) {
      chown($root . '/runtime', 65534);
      runtimeCheck(!acquireAppdataCleanupPlusRuntimeLock('wrong-owner'), 'Unexpected owner is refused even by root.');
      runtimeCheck(appdataCleanupPlusDiagnosticsRuntimeLockSummary()['reasonCode'] === 'unsafe_owner', 'Unexpected owner has an explicit diagnostic reason.');
      clearstatcache();
      runtimeCheck(fileowner($root . '/runtime') === 65534, 'Unexpected ownership is not repaired.');
      chown($root . '/runtime', 0);
    } else echo "runtime_safety: SKIP foreign-owner fixture (requires root)\n";
    runtimeCheck(file_get_contents($sentinel) === '{"private":"preserve"}', 'All planted-link targets remain untouched.');
  } else echo "runtime_safety: SKIP POSIX permissions and links (Windows)\n";

  mkdir($root . '/candidate', 0700);
  file_put_contents($root . '/candidate/keep', 'preserve');
  $scanMetrics = appdataCleanupPlusCreateScanMetrics();
  foreach (array(false, '', 'malformed mount inventory') as $index => $inventory) {
    $GLOBALS['APPDATA_CLEANUP_PLUS_TEST_MOUNTINFO'] = $inventory;
    $expectedReason = array('mount_inventory_unavailable', 'mount_inventory_empty', 'mount_inventory_invalid')[$index];
    runtimeCheck(appdataCleanupPlusMountStatus($root . '/candidate', $reason) === 'unknown' && $reason === $expectedReason, 'Unavailable mount information has a specific diagnostic reason.');
    runtimeCheck(appdataCleanupPlusDiagnosticsMountInventory()['reasonCode'] === $expectedReason, 'Collection-time inventory reason is explicit.');
    runtimeCheck(pathIsMountPoint($root . '/candidate'), 'Boolean compatibility callers fail closed.');
    runtimeCheck(!nativeDeleteDirectory($root . '/candidate')['ok'], 'Unknown mount status blocks actual deletion.');
    runtimeCheck(buildPathSecurityLockReason($root . '/candidate', null, array('kind'=>'zfs'), $rowReason) !== '' && $rowReason === $expectedReason, 'Exact ZFS mapping cannot bypass unknown mount status and retains its reason.');
    runtimeCheck(!appdataCleanupPlusFixturePathIsSafe($root . '/candidate/' . appdataCleanupPlusFixtureNames()['empty'], $root . '/candidate'), 'Fixture creation refuses an unverified parent.');
  }
  $GLOBALS['APPDATA_CLEANUP_PLUS_TEST_MOUNTINFO'] = "36 25 0:32 / / rw - ext4 /dev/root rw\n";
  runtimeCheck(appdataCleanupPlusMountStatus($root . '/candidate') === 'directory', 'Usable mount inventory permits ordinary directories.');
  runtimeCheck(appdataCleanupPlusFixturePathIsSafe($root . '/candidate/' . appdataCleanupPlusFixtureNames()['empty'], $root . '/candidate'), 'Fixture creation can preflight a missing reserved child beneath a verified parent.');
  // Execute the shipped helper with injected stat failure, without a production
  // bypass or touching real mount tables. Namespace wrappers affect only this copy.
  $source = file_get_contents($plugin . 'pathUtils.php');
  eval('namespace RuntimeMountFailure; function stat($path) { return false; } function appdataCleanupPlusCanonicalizePath($p) { return \\appdataCleanupPlusCanonicalizePath($p); } ' . substr($source, 5));
  runtimeCheck(\RuntimeMountFailure\appdataCleanupPlusMountStatus($root . '/candidate', $reason) === 'unknown' && $reason === 'filesystem_metadata_failed', 'Failed directory/parent stat is unknown with a distinct reason.');
  runtimeCheck(\RuntimeMountFailure\inspectDirectoryTreeForUnsafeEntries($root . '/candidate') !== '', 'Tree inspection refuses failed metadata.');
  runtimeCheck(file_get_contents($root . '/candidate/keep') === 'preserve', 'Blocked cleanup preserves data.');
  appdataCleanupPlusMarkScanPhase($scanMetrics, 'row_build');
  $finished = appdataCleanupPlusFinalizeScanMetrics($scanMetrics);
  runtimeCheck($finished['mountInspection']['status'] === 'incomplete' && $finished['mountInspection']['reasonCounts']['filesystem_metadata_failed'] > 0, 'Scan persists path-free mount failure counters.');
  $finished['mountInspection']['reasonCounts']['private-canary'] = 9;
  runtimeCheck(strpos(json_encode(appdataCleanupPlusSanitizeScanMetrics($finished)), 'private-canary') === false, 'Persisted mount telemetry rejects unreviewed keys.');
  runtimeCheck(appdataCleanupPlusSanitizeScanMetrics(array())['mountInspection']['status'] === 'not_checked', 'Older scans without mount evidence are not treated as verified.');
  runtimeCheck(appdataCleanupPlusDiagnosticsMountInventory()['status'] === 'complete' && $finished['mountInspection']['status'] === 'incomplete', 'Current healthy inventory does not overwrite failed scan evidence.');
  appdataCleanupPlusPersistLatestScanMetrics($finished);
  $latest = appdataCleanupPlusDiagnosticsLatestScanSummary();
  runtimeCheck(in_array('mount-inspection-incomplete', $latest['warningFlags'], true), 'Mount failures appear in troubleshooting findings.');
  $cacheBefore = file_get_contents($cacheFile);
  $lockBefore = file_get_contents($lockFile);
  $bundle = buildAppdataCleanupPlusDiagnosticsBundle();
  runtimeCheck($bundle['state']['mountInventoryCurrent']['status'] === 'complete' && $bundle['state']['latestScanMetrics']['data']['mountInspection']['status'] === 'incomplete', 'Complete bundle separates current inventory from scan evidence.');
  runtimeCheck(strpos(json_encode($bundle), 'private-canary') === false, 'Runtime diagnostics exclude private cache keys and values.');
  runtimeCheck(file_get_contents($cacheFile) === $cacheBefore && file_get_contents($lockFile) === $lockBefore, 'Export does not rewrite cache or locks.');
  $apiSource = file_get_contents($plugin . 'api.php');
  eval('namespace RuntimeDiagnosticReadFailure; function appdataCleanupPlusOpenRuntimeFile($path) { return false; } ' . substr($apiSource, 5));
  runtimeCheck(\RuntimeDiagnosticReadFailure\appdataCleanupPlusDiagnosticsReadRuntimeJson($cacheFile)['reasonCode'] === 'unreadable', 'A refused or raced runtime open is reported as unreadable, not empty.');
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
