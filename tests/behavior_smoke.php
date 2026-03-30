<?php

date_default_timezone_set("UTC");

$repoRoot = dirname(__DIR__);
$stateRoot = $repoRoot . DIRECTORY_SEPARATOR . "tests" . DIRECTORY_SEPARATOR . ".tmp" . DIRECTORY_SEPARATOR . "state-" . getmypid();
$stateRoot = str_replace("\\", "/", $stateRoot);
$sessionRoot = $stateRoot . "/sessions";

putenv("APPDATA_CLEANUP_PLUS_STATE_ROOT=" . $stateRoot);

if ( function_exists("session_status") && session_status() === PHP_SESSION_ACTIVE ) {
  session_write_close();
}

if ( ! is_dir($sessionRoot) ) {
  mkdir($sessionRoot, 0777, true);
}

session_save_path($sessionRoot);
session_id("acp-behavior-primary");
session_start();

require_once($repoRoot . "/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus/include/helpers.php");
require_once($repoRoot . "/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus/include/dashboard.php");
require_once($repoRoot . "/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus/include/quarantine.php");
require_once($repoRoot . "/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus/include/pathUtils.php");
require_once($repoRoot . "/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus/include/api.php");

function behaviorSmokeFail($message) {
  fwrite(STDERR, "behavior_smoke: FAIL: " . $message . PHP_EOL);
  exit(1);
}

function behaviorSmokeAssertTrue($condition, $message) {
  if ( ! $condition ) {
    behaviorSmokeFail($message);
  }
}

function behaviorSmokeAssertSame($expected, $actual, $message) {
  if ( $expected !== $actual ) {
    behaviorSmokeFail($message . " expected=" . var_export($expected, true) . " actual=" . var_export($actual, true));
  }
}

function behaviorSmokeRemoveTree($path) {
  if ( ! $path || ! file_exists($path) ) {
    return;
  }

  if ( is_file($path) || is_link($path) ) {
    @unlink($path);
    return;
  }

  $iterator = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS),
    RecursiveIteratorIterator::CHILD_FIRST
  );

  foreach ( $iterator as $entry ) {
    if ( $entry->isDir() && ! $entry->isLink() ) {
      @rmdir($entry->getPathname());
      continue;
    }

    @unlink($entry->getPathname());
  }

  @rmdir($path);
}

behaviorSmokeRemoveTree($stateRoot);
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusConfigDir(), "State root should be created.");

$snapshot = writeAppdataCleanupPlusSnapshot(array(
  "alpha" => array(
    "id" => "alpha",
    "name" => "Alpha",
    "displayPath" => "/mnt/user/appdata/alpha"
  )
));

behaviorSmokeAssertTrue(is_array($snapshot) && ! empty($snapshot["token"]), "Snapshot write should return a token.");
behaviorSmokeAssertTrue(is_file(appdataCleanupPlusSnapshotFile($snapshot["token"])), "Snapshot file should be written.");
$validatedSnapshot = getValidatedAppdataCleanupPlusSnapshot($snapshot["token"]);
behaviorSmokeAssertSame("alpha", $validatedSnapshot["candidates"]["alpha"]["id"], "Snapshot validation should return the stored candidate.");

session_write_close();
session_id("acp-behavior-other");
session_start();
behaviorSmokeAssertSame(null, getValidatedAppdataCleanupPlusSnapshot($snapshot["token"]), "Snapshot validation should fail outside the original session scope.");
session_write_close();
session_id("acp-behavior-primary");
session_start();

$statsPath = "/mnt/user/appdata/cache-target";
clearCachedAppdataCleanupPlusPathStats($statsPath);
behaviorSmokeAssertSame(null, getCachedAppdataCleanupPlusPathStats($statsPath), "Stats cache should start empty for the test path.");
setCachedAppdataCleanupPlusPathStats($statsPath, array(
  "sizeBytes" => 2048,
  "lastModified" => 123
));
$cachedStats = getCachedAppdataCleanupPlusPathStats($statsPath);
behaviorSmokeAssertSame(2048, $cachedStats["sizeBytes"], "Stats cache should return the stored size.");
behaviorSmokeAssertTrue(persistAppdataCleanupPlusStatsCacheIfDirty(), "Stats cache persistence should succeed.");
$statsCache = readAppdataCleanupPlusJsonFile(appdataCleanupPlusStatsCacheFile(), array());
behaviorSmokeAssertTrue(! empty($statsCache[appdataCleanupPlusPathStatsCacheKey($statsPath)]), "Persisted stats cache should include the cached entry.");

$sizeFixture = $stateRoot . "/size-fixture";
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($sizeFixture), "Size fixture directory should be created.");
file_put_contents($sizeFixture . "/payload.bin", str_repeat("A", 2048));
clearCachedAppdataCleanupPlusPathStats($sizeFixture);
$measuredStats = collectPathStats($sizeFixture);
behaviorSmokeAssertTrue(isset($measuredStats["sizeBytes"]) && $measuredStats["sizeBytes"] >= 2048, "collectPathStats should measure a real directory size when no cache entry exists.");
$measuredCache = getCachedAppdataCleanupPlusPathStats($sizeFixture);
behaviorSmokeAssertSame($measuredStats["sizeBytes"], $measuredCache["sizeBytes"], "Measured directory size should be written back to the stats cache.");

$quarantineRoot = $stateRoot . "/quarantine";
$quarantineDestination = $quarantineRoot . "/20260330-120000/mnt/user/appdata/sample";
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($quarantineDestination), "Quarantine destination should be created.");
registerAppdataCleanupPlusQuarantineRecord(array(
  "id" => "entry-one",
  "name" => "sample",
  "sourcePath" => "/mnt/user/appdata/sample",
  "destination" => $quarantineDestination,
  "quarantineRoot" => $quarantineRoot,
  "quarantinedAt" => "2026-03-30T12:00:00+00:00",
  "sourceSummary" => "sample",
  "targetSummary" => "/config"
));
$activeEntries = getActiveAppdataCleanupPlusQuarantineEntries(false);
behaviorSmokeAssertSame(1, count($activeEntries), "Quarantine registry should return the active entry.");
behaviorSmokeAssertSame("entry-one", $activeEntries[0]["id"], "Quarantine entry id should round-trip.");
$quarantineSummary = buildQuarantineSummary($activeEntries);
behaviorSmokeAssertSame(1, $quarantineSummary["count"], "Quarantine summary should count active entries.");

appendAppdataCleanupPlusAuditEntry(array(
  "timestamp" => "2026-03-30T12:00:00+00:00",
  "operation" => "quarantine",
  "requestedCount" => 1,
  "summary" => array(
    "quarantined" => 1
  ),
  "results" => array(
    array(
      "status" => "quarantined",
      "path" => "/mnt/user/appdata/sample"
    )
  )
));
appendAppdataCleanupPlusAuditEntry(array(
  "timestamp" => "2026-03-30T12:05:00+00:00",
  "operation" => "restore",
  "requestedCount" => 1,
  "summary" => array(
    "restored" => 1
  ),
  "results" => array(
    array(
      "status" => "restored",
      "sourcePath" => "/mnt/user/appdata/sample"
    )
  )
));
$auditRows = buildAuditHistoryRows();
behaviorSmokeAssertSame(2, count($auditRows), "Audit history rows should include both entries.");
behaviorSmokeAssertSame("restore", $auditRows[0]["operation"], "Audit history should be newest-first.");
behaviorSmokeAssertSame("quarantine", $auditRows[1]["operation"], "Audit history should preserve older entries.");
behaviorSmokeAssertTrue($auditRows[0]["message"] !== "", "Audit rows should include a summary message.");

$dockerRuntimeFixture = $stateRoot . "/docker-runtime";
$dockerClientFixture = $stateRoot . "/DockerClient.php";
mkdir($dockerRuntimeFixture, 0777, true);
file_put_contents($dockerClientFixture, "<?php\ntrigger_error('docker client fixture include warning', E_USER_WARNING);\nclass DockerClient {\n  public function getDockerContainers() {\n    trigger_error('docker client fixture query warning', E_USER_WARNING);\n    echo \"docker-fixture-noise\";\n    return array((object)array(\n      'Volumes' => array(\n        (object)array('Source' => '/mnt/user/appdata/live', 'Destination' => '/config')\n      )\n    ));\n  }\n}\n");
putenv("APPDATA_CLEANUP_PLUS_DOCKER_RUNTIME_PATH=" . str_replace("\\", "/", $dockerRuntimeFixture));
putenv("APPDATA_CLEANUP_PLUS_DOCKER_CLIENT_PATH=" . str_replace("\\", "/", $dockerClientFixture));
$containers = getDockerContainersSafe();
behaviorSmokeAssertSame(1, count($containers), "Docker container scan should return fixture containers even when the Docker client emits warnings.");
$filteredVolumes = removeInstalledVolumeMatches(array(
  "/mnt/user/appdata/live" => array(
    "HostDir" => "/mnt/user/appdata/live"
  ),
  "/mnt/user/appdata/leftover" => array(
    "HostDir" => "/mnt/user/appdata/leftover"
  )
), $containers);
behaviorSmokeAssertTrue(! isset($filteredVolumes["/mnt/user/appdata/live"]), "Installed container paths should be removed even when Docker volumes arrive as objects.");
behaviorSmokeAssertTrue(isset($filteredVolumes["/mnt/user/appdata/leftover"]), "Unmatched candidate paths should remain after Docker volume filtering.");
$dashboard = buildDashboardPayload();
behaviorSmokeAssertTrue(is_array($dashboard) && ! empty($dashboard["ok"]), "Dashboard build should survive DockerClient warnings and output.");

behaviorSmokeRemoveTree($stateRoot);
echo "behavior_smoke: OK" . PHP_EOL;
