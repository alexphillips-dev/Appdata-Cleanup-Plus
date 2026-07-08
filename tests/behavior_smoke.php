<?php

date_default_timezone_set("UTC");

$repoRoot = dirname(__DIR__);
$stateRoot = $repoRoot . DIRECTORY_SEPARATOR . "tests" . DIRECTORY_SEPARATOR . ".tmp" . DIRECTORY_SEPARATOR . "state-" . getmypid();
$stateRoot = str_replace("\\", "/", $stateRoot);
$sessionRoot = $stateRoot . "/sessions";
$dockerConfigFixture = $stateRoot . "/boot/config/docker.cfg";
$vmConfigFixture = $stateRoot . "/boot/config/domain.cfg";
$shareConfigFixtureDir = $stateRoot . "/boot/config/shares";
$templateFixtureDir = $stateRoot . "/boot/config/plugins/dockerMan/templates-user";
$composeProjectsFixtureDir = $stateRoot . "/boot/config/plugins/compose.manager/projects";
$syslogFixture = $stateRoot . "/var/log/syslog";
$zfsClientFixture = $repoRoot . "/tests/fixtures/zfs_client_fixture.php";
$appdataShareName = "acp-smoke-share-" . getmypid();
$appdataShareRoot = "/mnt/user/" . $appdataShareName;
$zfsDatasetRoot = "/mnt/docker_vm_nvme/" . $appdataShareName;
$manualAliasSourceRoot = "/mnt/fcache/" . $appdataShareName;
$manualCustomSourceRoot = "/mnt/fcache/acp-extra-source-" . getmypid();
$outsideShareReviewRoot = "/mnt/fcache/acp-outside-review-" . getmypid();
$outsideShareReviewPath = $outsideShareReviewRoot . "/candidate";
$appdataSharePhysicalRoot = $stateRoot . "/appdata-share-root";
$appdataShareUsesSymlink = false;

putenv("APPDATA_CLEANUP_PLUS_STATE_ROOT=" . $stateRoot);
putenv("APPDATA_CLEANUP_PLUS_DOCKER_CONFIG_PATH=" . $dockerConfigFixture);
putenv("APPDATA_CLEANUP_PLUS_VM_CONFIG_PATH=" . $vmConfigFixture);
putenv("APPDATA_CLEANUP_PLUS_SHARE_CONFIG_DIR=" . $shareConfigFixtureDir);
putenv("APPDATA_CLEANUP_PLUS_DOCKER_TEMPLATE_DIR=" . $templateFixtureDir);
putenv("APPDATA_CLEANUP_PLUS_COMPOSE_PROJECTS_DIR=" . $composeProjectsFixtureDir);
putenv("APPDATA_CLEANUP_PLUS_SYSLOG_PATH=" . $syslogFixture);
putenv("APPDATA_CLEANUP_PLUS_ZFS_CLIENT_COMMAND=php \"" . str_replace("\\", "/", $zfsClientFixture) . "\"");
putenv("APPDATA_CLEANUP_PLUS_TEST_ZFS_SHARE_ROOT=" . $appdataShareRoot);
putenv("APPDATA_CLEANUP_PLUS_TEST_ZFS_DATASET_ROOT=" . $zfsDatasetRoot);

if ( function_exists("session_status") && session_status() === PHP_SESSION_ACTIVE ) {
  session_write_close();
}

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

function behaviorSmokeAssertContains($needle, $haystack, $message) {
  if ( strpos((string)$haystack, (string)$needle) === false ) {
    behaviorSmokeFail($message . " needle=" . var_export($needle, true) . " actual=" . var_export($haystack, true));
  }
}

function behaviorSmokeAssertNotContains($needle, $haystack, $message) {
  if ( strpos((string)$haystack, (string)$needle) !== false ) {
    behaviorSmokeFail($message . " needle=" . var_export($needle, true) . " actual=" . var_export($haystack, true));
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

function behaviorSmokeWriteTemplateFixture($path, $name, $hostDir, $targetPath) {
  $xml = "<?xml version='1.0'?>\n<Container>\n  <Name>" . htmlspecialchars($name, ENT_QUOTES) . "</Name>\n  <Config Type=\"Path\" Target=\"" . htmlspecialchars($targetPath, ENT_QUOTES) . "\">" . htmlspecialchars($hostDir, ENT_QUOTES) . "</Config>\n</Container>\n";
  file_put_contents($path, $xml);
}

function behaviorSmokeFindRowByPath($rows, $path) {
  foreach ( $rows as $row ) {
    if ( isset($row["displayPath"]) && $row["displayPath"] === $path ) {
      return $row;
    }
  }

  return null;
}

function behaviorSmokeFindEntryById($entries, $entryId) {
  foreach ( $entries as $entry ) {
    if ( isset($entry["id"]) && $entry["id"] === $entryId ) {
      return $entry;
    }
  }

  return null;
}

behaviorSmokeRemoveTree($stateRoot);
behaviorSmokeRemoveTree($appdataShareRoot);
behaviorSmokeRemoveTree($zfsDatasetRoot);
behaviorSmokeRemoveTree($manualAliasSourceRoot);
behaviorSmokeRemoveTree($manualCustomSourceRoot);
behaviorSmokeRemoveTree($outsideShareReviewRoot);
behaviorSmokeRemoveTree($appdataSharePhysicalRoot);
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($sessionRoot), "Session fixture root should be created.");
session_save_path($sessionRoot);
session_id("acp-behavior-primary");
session_start();
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusConfigDir(), "State root should be created.");
$defaultSafetySettings = getAppdataCleanupPlusSafetySettings();
behaviorSmokeAssertSame(0, (int)$defaultSafetySettings["defaultQuarantinePurgeDays"], "Default safety settings should start with no quarantine purge timer.");
behaviorSmokeAssertSame(true, ! empty($defaultSafetySettings["enableZfsDatasetDelete"]), "Default safety settings should start with ZFS dataset delete enabled.");
behaviorSmokeAssertSame(array(), $defaultSafetySettings["zfsPathMappings"], "Default safety settings should start without ZFS path mappings.");
behaviorSmokeAssertTrue(setAppdataCleanupPlusSafetySettings(array(
  "enablePermanentDelete" => false,
  "enableZfsDatasetDelete" => true,
  "manualAppdataSources" => array(
    "/mnt/fcache/test-appdata/",
    "",
    "/mnt/fcache/test-appdata",
    "/mnt/fcache/second-appdata"
  ),
  "zfsPathMappings" => array(
    array(
      "shareRoot" => "/mnt/user/test-appdata",
      "datasetRoot" => "/mnt/docker_vm_nvme/test-appdata"
    )
  ),
  "defaultQuarantinePurgeDays" => 21
)), "Safety settings persistence should succeed.");
$persistedSafetySettings = getAppdataCleanupPlusSafetySettings();
behaviorSmokeAssertSame(21, (int)$persistedSafetySettings["defaultQuarantinePurgeDays"], "Safety settings should persist the default quarantine purge days value.");
behaviorSmokeAssertSame(true, ! empty($persistedSafetySettings["enableZfsDatasetDelete"]), "Safety settings should keep ZFS dataset delete enabled.");
behaviorSmokeAssertSame(array(
  "/mnt/fcache/test-appdata",
  "/mnt/fcache/second-appdata"
), $persistedSafetySettings["manualAppdataSources"], "Safety settings should normalize and persist manual appdata sources.");
behaviorSmokeAssertSame(array(
  array(
    "shareRoot" => "/mnt/user/test-appdata",
    "datasetRoot" => "/mnt/docker_vm_nvme/test-appdata"
  )
), $persistedSafetySettings["zfsPathMappings"], "Safety settings should normalize and persist ZFS path mappings.");
behaviorSmokeAssertTrue(setAppdataCleanupPlusSafetySettings(array(
  "enablePermanentDelete" => false,
  "enableZfsDatasetDelete" => false,
  "manualAppdataSources" => array(),
  "zfsPathMappings" => array(),
  "defaultQuarantinePurgeDays" => 0
)), "Safety settings reset should succeed.");
behaviorSmokeAssertSame(true, ! empty(getAppdataCleanupPlusSafetySettings()["enableZfsDatasetDelete"]), "ZFS dataset delete should stay enabled even if old settings post it as disabled.");

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
behaviorSmokeAssertTrue(closeAppdataCleanupPlusSession(), "Session close helper should release the active PHP session lock.");
behaviorSmokeAssertSame(PHP_SESSION_NONE, session_status(), "Session close helper should leave no active session.");
session_id("acp-behavior-primary");
session_start();

behaviorSmokeAssertTrue(acquireAppdataCleanupPlusRuntimeLock("expensive-operation", array("action" => "smoke")), "Runtime lock should be acquired.");
behaviorSmokeAssertSame(false, acquireAppdataCleanupPlusRuntimeLock("expensive-operation", array("action" => "duplicate")), "Duplicate runtime lock acquisition should fail fast.");
behaviorSmokeAssertTrue(releaseAppdataCleanupPlusRuntimeLock("expensive-operation"), "Runtime lock should release cleanly.");
behaviorSmokeAssertTrue(acquireAppdataCleanupPlusRuntimeLock("expensive-operation", array("action" => "reacquire")), "Runtime lock should be acquirable after release.");
releaseAllAppdataCleanupPlusRuntimeLocks();

$staleLockFile = appdataCleanupPlusRuntimeLockFile("stale-smoke");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory(dirname($staleLockFile)), "Runtime lock directory should be created.");
file_put_contents($staleLockFile, appdataCleanupPlusJsonEncode(array(
  "name" => "stale-smoke",
  "pid" => 999999,
  "startedAt" => "2000-01-01T00:00:00+00:00",
  "metadata" => array("action" => "stale")
)) . "\n");
behaviorSmokeAssertTrue(recoverAppdataCleanupPlusStaleRuntimeLockFile($staleLockFile), "Unheld stale runtime lock metadata should be recoverable.");
behaviorSmokeAssertSame(false, is_file($staleLockFile), "Recovered stale runtime lock metadata should be removed.");

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
behaviorSmokeAssertSame("1 minute ago", formatRelativeAgeLabel(time() - 60), "Relative age labels should spell out singular minutes.");
behaviorSmokeAssertSame("2 hours ago", formatRelativeAgeLabel(time() - 7200), "Relative age labels should spell out plural hours.");
behaviorSmokeAssertSame("1 month ago", formatRelativeAgeLabel(time() - 2592000), "Relative age labels should spell out singular months.");
behaviorSmokeAssertSame("3 months ago", formatRelativeAgeLabel(time() - (3 * 2592000)), "Relative age labels should spell out plural months.");
behaviorSmokeAssertSame("1 year ago", formatRelativeAgeLabel(time() - 31536000), "Relative age labels should spell out singular years.");
behaviorSmokeAssertSame("2 years ago", formatRelativeAgeLabel(time() - (2 * 31536000)), "Relative age labels should spell out plural years.");

$quarantineRoot = $stateRoot . "/quarantine";
$quarantineDestination = $quarantineRoot . "/20260330-120000/mnt/user/appdata/sample";
$entryOneQuarantinedAt = date("c", time() - 7200);
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($quarantineDestination), "Quarantine destination should be created.");
registerAppdataCleanupPlusQuarantineRecord(array(
  "id" => "entry-one",
  "name" => "sample",
  "sourcePath" => "/mnt/user/appdata/sample",
  "destination" => $quarantineDestination,
  "quarantineRoot" => $quarantineRoot,
  "quarantinedAt" => $entryOneQuarantinedAt,
  "sourceSummary" => "sample",
  "targetSummary" => "/config"
));
$activeEntries = getActiveAppdataCleanupPlusQuarantineEntries(false);
behaviorSmokeAssertSame(1, count($activeEntries), "Quarantine registry should return the active entry.");
behaviorSmokeAssertSame("entry-one", $activeEntries[0]["id"], "Quarantine entry id should round-trip.");
$quarantineSummary = buildQuarantineSummary($activeEntries);
behaviorSmokeAssertSame(1, $quarantineSummary["count"], "Quarantine summary should count active entries.");
$quarantineSummaryOnlyRoot = $stateRoot . "/quarantine-summary-only";
$quarantineSummaryOnlyDestination = $quarantineSummaryOnlyRoot . "/20260330-120010/mnt/user/appdata/summary-only";
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($quarantineSummaryOnlyDestination), "Summary-only quarantine destination should be created.");
registerAppdataCleanupPlusQuarantineRecord(array(
  "id" => "entry-summary-only",
  "name" => "summary-only",
  "sourcePath" => "/mnt/user/appdata/summary-only",
  "destination" => $quarantineSummaryOnlyDestination,
  "quarantineRoot" => $quarantineSummaryOnlyRoot,
  "quarantinedAt" => date("c", time() - 3600),
  "sourceSummary" => "summary-only",
  "targetSummary" => "/config",
  "sizeBytes" => null
));
$summaryOnlyPayload = buildQuarantineManagerPayload(false);
$dashboardQuarantineSummary = buildDashboardQuarantineSummaryPayload();
$summaryOnlyRegistry = getAppdataCleanupPlusQuarantineRegistry();
behaviorSmokeAssertSame(2, (int)$summaryOnlyPayload["summary"]["count"], "Summary-only quarantine payload should count tracked entries without loading full entries.");
behaviorSmokeAssertSame(0, (int)$summaryOnlyPayload["summary"]["sizeBytes"], "Summary-only quarantine payload should not force uncached size scans.");
behaviorSmokeAssertSame(null, $summaryOnlyRegistry["entry-summary-only"]["sizeBytes"], "Summary-only quarantine payload should leave uncached quarantine sizes untouched.");
behaviorSmokeAssertSame((int)$summaryOnlyPayload["summary"]["count"], (int)$dashboardQuarantineSummary["count"], "Deferred dashboard quarantine summaries should match the summary-only manager count.");
removeAppdataCleanupPlusQuarantineRecord("entry-summary-only");
$scheduleSetResult = updateTrackedQuarantinePurgeSchedule($activeEntries, "set", 0, "2030-01-01T12:00:00+00:00");
behaviorSmokeAssertSame("scheduled", $scheduleSetResult["results"][0]["status"], "Purge scheduling should mark selected quarantine entries as scheduled.");
behaviorSmokeAssertSame("2030-01-01T12:00:00+00:00", $scheduleSetResult["results"][0]["purgeAt"], "Exact purge scheduling should preserve the selected purge timestamp.");
behaviorSmokeAssertContains("Scheduled to purge on", $scheduleSetResult["results"][0]["message"], "Exact purge scheduling should report the scheduled purge time.");
$scheduledEntries = getActiveAppdataCleanupPlusQuarantineEntries(false);
$scheduledPrimaryEntry = behaviorSmokeFindEntryById($scheduledEntries, "entry-one");
behaviorSmokeAssertTrue(is_array($scheduledPrimaryEntry), "Scheduled purge entry should still be present in the manager payload.");
behaviorSmokeAssertSame(true, ! empty($scheduledPrimaryEntry["purgeScheduled"]), "Scheduled purge entries should expose their scheduled state in the manager payload.");
behaviorSmokeAssertSame("2030-01-01T12:00:00+00:00", $scheduledPrimaryEntry["purgeAt"], "Scheduled purge entries should expose the exact purge timestamp.");
behaviorSmokeAssertTrue($scheduledPrimaryEntry["purgeBadgeLabel"] !== "", "Scheduled purge entries should expose a purge badge label.");
$scheduleClearResult = updateTrackedQuarantinePurgeSchedule($scheduledEntries, "clear", 0);
behaviorSmokeAssertSame("cleared", $scheduleClearResult["results"][0]["status"], "Clearing a scheduled purge should update the entry status.");
$clearedEntries = getActiveAppdataCleanupPlusQuarantineEntries(false);
$clearedPrimaryEntry = behaviorSmokeFindEntryById($clearedEntries, "entry-one");
behaviorSmokeAssertTrue(is_array($clearedPrimaryEntry), "Cleared purge entry should still be present in the manager payload.");
behaviorSmokeAssertSame(false, ! empty($clearedPrimaryEntry["purgeScheduled"]), "Cleared purge schedules should disappear from the manager payload.");
behaviorSmokeAssertTrue(setAppdataCleanupPlusSafetySettings(array(
  "enablePermanentDelete" => false,
  "defaultQuarantinePurgeDays" => 5
)), "Default purge settings should save before syncing tracked quarantine entries.");
$defaultSyncResult = syncTrackedQuarantineEntriesToDefaultPurgeSchedule(getAppdataCleanupPlusSafetySettings());
behaviorSmokeAssertSame(1, (int)$defaultSyncResult["updatedCount"], "Changing the default purge timer should update existing tracked quarantine entries.");
$defaultSyncedEntries = getActiveAppdataCleanupPlusQuarantineEntries(false);
$expectedDefaultSyncedPurgeAt = buildAppdataCleanupPlusDefaultPurgeAtForTimestamp(getAppdataCleanupPlusSafetySettings(), strtotime($entryOneQuarantinedAt));
$defaultSyncedPrimaryEntry = behaviorSmokeFindEntryById($defaultSyncedEntries, "entry-one");
behaviorSmokeAssertTrue(is_array($defaultSyncedPrimaryEntry), "Default-synced quarantine entry should still be present.");
behaviorSmokeAssertTrue(! empty($defaultSyncedPrimaryEntry["purgeScheduled"]), "Existing tracked quarantine entries should show a scheduled purge after default-timer sync.");
behaviorSmokeAssertSame($expectedDefaultSyncedPurgeAt, $defaultSyncedPrimaryEntry["purgeAt"], "Default-timer sync should be based on each entry's quarantine time.");
behaviorSmokeAssertTrue(setAppdataCleanupPlusSafetySettings(array(
  "enablePermanentDelete" => false,
  "defaultQuarantinePurgeDays" => 0
)), "Default purge settings should save before clearing tracked quarantine entries.");
$defaultSyncClearResult = syncTrackedQuarantineEntriesToDefaultPurgeSchedule(getAppdataCleanupPlusSafetySettings());
behaviorSmokeAssertSame(1, (int)$defaultSyncClearResult["updatedCount"], "Clearing the default purge timer should also clear existing tracked quarantine entries.");
$defaultClearedEntries = getActiveAppdataCleanupPlusQuarantineEntries(false);
$defaultClearedPrimaryEntry = behaviorSmokeFindEntryById($defaultClearedEntries, "entry-one");
behaviorSmokeAssertTrue(is_array($defaultClearedPrimaryEntry), "Default-cleared quarantine entry should still be present.");
behaviorSmokeAssertSame(false, ! empty($defaultClearedPrimaryEntry["purgeScheduled"]), "Tracked quarantine entries should clear their purge schedule when the default is cleared.");
$manualOverridePurgeAt = date("c", time() + (9 * 86400));
$manualOverrideResult = updateTrackedQuarantinePurgeSchedule($defaultClearedEntries, "set", 0, $manualOverridePurgeAt);
behaviorSmokeAssertSame("scheduled", $manualOverrideResult["results"][0]["status"], "Manual exact-time scheduling should still work after default-timer sync.");
behaviorSmokeAssertSame($manualOverridePurgeAt, $manualOverrideResult["results"][0]["purgeAt"], "Manual exact-time scheduling should preserve the selected purge time.");
behaviorSmokeAssertTrue(setAppdataCleanupPlusSafetySettings(array(
  "enablePermanentDelete" => false,
  "defaultQuarantinePurgeDays" => 7
)), "Default purge settings should save before verifying manual override preservation.");
$manualPreservationResult = syncTrackedQuarantineEntriesToDefaultPurgeSchedule(getAppdataCleanupPlusSafetySettings());
behaviorSmokeAssertSame(0, (int)$manualPreservationResult["updatedCount"], "Changing the default purge timer should not overwrite manual per-entry purge overrides.");
$manualPreservedEntries = getActiveAppdataCleanupPlusQuarantineEntries(false);
$manualPreservedPrimaryEntry = behaviorSmokeFindEntryById($manualPreservedEntries, "entry-one");
behaviorSmokeAssertTrue(is_array($manualPreservedPrimaryEntry), "Manual-preserved quarantine entry should still be present.");
behaviorSmokeAssertSame($manualOverridePurgeAt, $manualPreservedPrimaryEntry["purgeAt"], "Manual per-entry purge overrides should remain unchanged when the global default changes.");
$manualClearResult = updateTrackedQuarantinePurgeSchedule($manualPreservedEntries, "clear", 0);
behaviorSmokeAssertSame("cleared", $manualClearResult["results"][0]["status"], "Clearing a manual purge override should still work.");
setAppdataCleanupPlusQuarantineRegistry(array());
$legacyManualDestination = $stateRoot . "/quarantine/legacy-manual";
$legacyManualQuarantinedAt = date("c", time() - 1800);
$legacyManualPurgeAt = date("c", time() + (11 * 86400));
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($legacyManualDestination), "Legacy manual quarantine destination should be created.");
behaviorSmokeAssertTrue(setAppdataCleanupPlusQuarantineRegistry(array(
  "legacy-manual" => array(
    "id" => "legacy-manual",
    "name" => "legacy-manual",
    "sourcePath" => "/mnt/user/appdata/legacy-manual",
    "destination" => $legacyManualDestination,
    "quarantineRoot" => $quarantineRoot,
    "quarantinedAt" => $legacyManualQuarantinedAt,
    "purgeAt" => $legacyManualPurgeAt,
    "sourceSummary" => "legacy-manual",
    "targetSummary" => "/config"
  )
)), "Legacy manual quarantine entry should be written without source metadata.");
$legacyPreviousSettings = array(
  "enablePermanentDelete" => false,
  "defaultQuarantinePurgeDays" => 5,
  "quarantineRoot" => getDefaultAppdataCleanupPlusQuarantineRoot()
);
$legacyNextSettings = array(
  "enablePermanentDelete" => false,
  "defaultQuarantinePurgeDays" => 8,
  "quarantineRoot" => getDefaultAppdataCleanupPlusQuarantineRoot()
);
$legacySyncResult = syncTrackedQuarantineEntriesToDefaultPurgeSchedule($legacyNextSettings, $legacyPreviousSettings);
behaviorSmokeAssertSame(0, (int)$legacySyncResult["updatedCount"], "Legacy scheduled entries that do not match the previous default should be preserved as manual overrides.");
$legacyEntries = getActiveAppdataCleanupPlusQuarantineEntries(false);
behaviorSmokeAssertSame($legacyManualPurgeAt, $legacyEntries[0]["purgeAt"], "Legacy manual overrides should keep their exact scheduled purge time when the default changes.");
setAppdataCleanupPlusQuarantineRegistry(array());

$restoreCollisionSource = $appdataShareRoot . "/restore-collision";
$restoreCollisionQuarantineRoot = $stateRoot . "/restore-collision-quarantine";
$restoreCollisionDestination = $restoreCollisionQuarantineRoot . "/20260331-120500/mnt/user/appdata/restore-collision";
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($restoreCollisionSource), "Restore collision source fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($restoreCollisionDestination), "Restore collision quarantine fixture should be created.");
$restoreCollisionEntry = array(
  "id" => "restore-collision",
  "name" => "restore-collision",
  "sourcePath" => $restoreCollisionSource,
  "destination" => $restoreCollisionDestination,
  "quarantineRoot" => $restoreCollisionQuarantineRoot,
  "quarantinedAt" => "2026-03-30T12:05:00+00:00",
  "sourceSummary" => "restore-collision",
  "targetSummary" => "/config"
);
$restoreConflictPreview = inspectTrackedQuarantineRestoreConflicts(array($restoreCollisionEntry));
behaviorSmokeAssertSame(1, $restoreConflictPreview["summary"]["conflicts"], "Restore preview should report restore path collisions.");
behaviorSmokeAssertContains("-restored", $restoreConflictPreview["conflicts"][0]["suggestedPath"], "Restore preview should suggest a suffix restore path.");
$restoreConflictResult = restoreTrackedQuarantineEntry($restoreCollisionEntry);
behaviorSmokeAssertSame("conflict", $restoreConflictResult["status"], "Default restore mode should stop on an existing original path.");
$restoreSkippedResult = restoreTrackedQuarantineEntry($restoreCollisionEntry, array(
  "conflictMode" => "skip"
));
behaviorSmokeAssertSame("skipped", $restoreSkippedResult["status"], "Skip restore mode should leave conflicting entries in quarantine.");
behaviorSmokeAssertTrue(is_dir($restoreCollisionDestination), "Skipped restore conflicts should leave the quarantine folder in place.");
$restoreSuffixResult = restoreTrackedQuarantineEntry($restoreCollisionEntry, array(
  "conflictMode" => "suffix"
));
behaviorSmokeAssertSame("restored", $restoreSuffixResult["status"], "Suffix restore mode should restore conflicting entries beside the existing folder.");
behaviorSmokeAssertContains("-restored", $restoreSuffixResult["destination"], "Suffix restore mode should report the generated restore path.");
behaviorSmokeAssertTrue(is_dir($restoreCollisionSource), "Suffix restore mode should leave the original conflicting folder untouched.");
behaviorSmokeAssertTrue(is_dir($restoreSuffixResult["destination"]), "Suffix restore mode should create the generated restore destination.");
behaviorSmokeAssertTrue(! is_dir($restoreCollisionDestination), "Suffix restore mode should move the quarantined folder out of quarantine.");

$restoreCustomSource = $appdataShareRoot . "/restore-custom";
$restoreCustomQuarantineRoot = $stateRoot . "/restore-custom-quarantine";
$restoreCustomDestination = $restoreCustomQuarantineRoot . "/20260331-120600/mnt/user/appdata/restore-custom";
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($restoreCustomSource), "Restore custom source fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($restoreCustomDestination), "Restore custom quarantine fixture should be created.");
$restoreCustomEntry = array(
  "id" => "restore-custom",
  "name" => "restore-custom",
  "sourcePath" => $restoreCustomSource,
  "destination" => $restoreCustomDestination,
  "quarantineRoot" => $restoreCustomQuarantineRoot,
  "quarantinedAt" => "2026-03-30T12:06:00+00:00",
  "sourceSummary" => "restore-custom",
  "targetSummary" => "/config"
);
$restoreCustomPreview = inspectTrackedQuarantineRestoreConflicts(array($restoreCustomEntry));
behaviorSmokeAssertSame("restore-custom-restored", $restoreCustomPreview["conflicts"][0]["suggestedName"], "Restore preview should expose the editable suggested restore name.");
$restoreCustomResult = restoreTrackedQuarantineEntry($restoreCustomEntry, array(
  "conflictMode" => "custom",
  "customRestoreNames" => array(
    "restore-custom" => "restore-custom-reviewed"
  )
));
behaviorSmokeAssertSame("restored", $restoreCustomResult["status"], "Custom restore mode should restore to the edited destination name.");
behaviorSmokeAssertSame($appdataShareRoot . "/restore-custom-reviewed", $restoreCustomResult["destination"], "Custom restore mode should use the edited restore name inside the original parent.");
behaviorSmokeAssertTrue(is_dir($restoreCustomSource), "Custom restore mode should leave the original conflicting folder untouched.");
behaviorSmokeAssertTrue(is_dir($restoreCustomResult["destination"]), "Custom restore mode should create the edited restore destination.");
behaviorSmokeAssertTrue(! is_dir($restoreCustomDestination), "Custom restore mode should move the quarantined folder out of quarantine.");

$restoreCustomInvalidSource = $appdataShareRoot . "/restore-custom-invalid";
$restoreCustomInvalidQuarantineRoot = $stateRoot . "/restore-custom-invalid-quarantine";
$restoreCustomInvalidDestination = $restoreCustomInvalidQuarantineRoot . "/20260331-120700/mnt/user/appdata/restore-custom-invalid";
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($restoreCustomInvalidSource), "Restore custom invalid source fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($restoreCustomInvalidDestination), "Restore custom invalid quarantine fixture should be created.");
$restoreCustomInvalidEntry = array(
  "id" => "restore-custom-invalid",
  "name" => "restore-custom-invalid",
  "sourcePath" => $restoreCustomInvalidSource,
  "destination" => $restoreCustomInvalidDestination,
  "quarantineRoot" => $restoreCustomInvalidQuarantineRoot,
  "quarantinedAt" => "2026-03-30T12:07:00+00:00",
  "sourceSummary" => "restore-custom-invalid",
  "targetSummary" => "/config"
);
$restoreCustomInvalidResult = restoreTrackedQuarantineEntry($restoreCustomInvalidEntry, array(
  "conflictMode" => "custom",
  "customRestoreNames" => array(
    "restore-custom-invalid" => "bad/name"
  )
));
behaviorSmokeAssertSame("error", $restoreCustomInvalidResult["status"], "Custom restore mode should reject invalid edited restore names.");
behaviorSmokeAssertTrue(is_dir($restoreCustomInvalidDestination), "Invalid custom restore names should leave the quarantine folder in place.");

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
$auditPreviewPayload = buildAuditHistoryPayload(1);
behaviorSmokeAssertSame(2, count($auditRows), "Audit history rows should include both entries.");
behaviorSmokeAssertSame("restore", $auditRows[0]["operation"], "Audit history should be newest-first.");
behaviorSmokeAssertSame("quarantine", $auditRows[1]["operation"], "Audit history should preserve older entries.");
behaviorSmokeAssertTrue($auditRows[0]["message"] !== "", "Audit rows should include a summary message.");
behaviorSmokeAssertSame(1, count($auditPreviewPayload["auditHistory"]), "Deferred audit history payloads should honor the requested background limit.");
behaviorSmokeAssertSame(true, ! empty($auditPreviewPayload["hasMore"]), "Deferred audit history payloads should report when more history is available.");

$parentCandidateMap = array(
  "parent" => appdataCleanupPlusCreateCandidateVolume("/mnt/user/appdata/parent"),
  "child" => appdataCleanupPlusCreateCandidateVolume("/mnt/user/appdata/parent/child"),
  "sibling" => appdataCleanupPlusCreateCandidateVolume("/mnt/user/appdata/sibling")
);
$filteredParentCandidateMap = removeParentCandidates($parentCandidateMap);
behaviorSmokeAssertSame(false, isset($filteredParentCandidateMap["parent"]), "Parent candidate pruning should drop less-specific parent paths.");
behaviorSmokeAssertSame(true, isset($filteredParentCandidateMap["child"]), "Parent candidate pruning should keep child paths.");
behaviorSmokeAssertSame(true, isset($filteredParentCandidateMap["sibling"]), "Parent candidate pruning should keep unrelated sibling paths.");

behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory(dirname($syslogFixture)), "Syslog fixture directory should be created.");
file_put_contents(
  $syslogFixture,
  "May  4 10:00:00 PrivateTower php-fpm[123]: server reached max children setting while scanning /mnt/user/SecretShare/private-app token=0123456789abcdef0123456789abcdef from admin@example.com at 192.168.1.22\n" .
  "May  4 10:00:01 PrivateTower nginx: 504 gateway timeout for /Settings/AppdataCleanupPlus?csrf_token=abcdefabcdefabcdefabcdefabcdefabcdef\n" .
  "May  4 10:00:02 PrivateTower flash_backup: adding task: /var/local/emhttp/plugins/unrelated/update\n" .
  "May  4 10:00:03 PrivateTower emhttpd: shcmd (123): zpool import oldpool\n" .
  "May  4 10:00:04 PrivateTower emhttpd: plugin appdata.cleanup.plus update_version complete\n"
);
appendAppdataCleanupPlusAuditEntry(array(
  "timestamp" => date("c"),
  "operation" => "restore",
  "requestedCount" => 1,
  "requestedIds" => array("sensitive-audit-id"),
  "summary" => array("restored" => 1),
  "results" => array(
    array(
      "id" => "sensitive-audit-id",
      "name" => "SensitiveAppName",
      "sourcePath" => "/mnt/user/appdata/SensitiveAppName",
      "destination" => "/mnt/user/appdata/SensitiveAppName",
      "status" => "restored",
      "message" => "Restored SensitiveAppName to /mnt/user/appdata/SensitiveAppName.",
      "row" => array(
        "name" => "SensitiveAppName",
        "displayPath" => "/mnt/user/appdata/SensitiveAppName"
      )
    )
  )
));
$diagnosticsBundle = buildAppdataCleanupPlusDiagnosticsBundle();
$diagnosticsJson = appdataCleanupPlusJsonEncode($diagnosticsBundle);
behaviorSmokeAssertContains("max children", $diagnosticsJson, "Diagnostics bundle should include matching php-fpm log context.");
behaviorSmokeAssertContains("gateway timeout", $diagnosticsJson, "Diagnostics bundle should include matching nginx timeout context.");
behaviorSmokeAssertContains("update_version", $diagnosticsJson, "Diagnostics bundle should include relevant emhttpd plugin context.");
behaviorSmokeAssertNotContains("PrivateTower", $diagnosticsJson, "Diagnostics bundle should redact syslog hostnames.");
behaviorSmokeAssertNotContains("SecretShare", $diagnosticsJson, "Diagnostics bundle should redact share names from paths.");
behaviorSmokeAssertNotContains("private-app", $diagnosticsJson, "Diagnostics bundle should redact app-specific path segments.");
behaviorSmokeAssertNotContains("admin@example.com", $diagnosticsJson, "Diagnostics bundle should redact email addresses.");
behaviorSmokeAssertNotContains("192.168.1.22", $diagnosticsJson, "Diagnostics bundle should redact IP addresses.");
behaviorSmokeAssertNotContains("0123456789abcdef0123456789abcdef", $diagnosticsJson, "Diagnostics bundle should redact token-like hex strings.");
behaviorSmokeAssertNotContains("flash_backup", $diagnosticsJson, "Diagnostics bundle should not include unrelated emhttp path noise.");
behaviorSmokeAssertNotContains("zpool import", $diagnosticsJson, "Diagnostics bundle should not include unrelated emhttpd startup noise.");
behaviorSmokeAssertNotContains("SensitiveAppName", $diagnosticsJson, "Diagnostics bundle should redact nested audit app names.");
behaviorSmokeAssertNotContains("\"row\"", $diagnosticsJson, "Diagnostics bundle should omit nested audit row payloads.");

$scheduledPurgeQuarantineRoot = $stateRoot . "/scheduled-purge-quarantine";
$scheduledPurgeDestination = $scheduledPurgeQuarantineRoot . "/20260330-121000/mnt/user/appdata/scheduled-purge";
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($scheduledPurgeDestination), "Scheduled purge quarantine fixture should be created.");
file_put_contents($scheduledPurgeDestination . "/config.json", "{}");
registerAppdataCleanupPlusQuarantineRecord(array(
  "id" => "scheduled-purge-entry",
  "name" => "scheduled-purge",
  "sourcePath" => "/mnt/user/appdata/scheduled-purge",
  "destination" => $scheduledPurgeDestination,
  "quarantineRoot" => $scheduledPurgeQuarantineRoot,
  "quarantinedAt" => "2026-03-30T12:10:00+00:00",
  "purgeAt" => "2000-01-01T00:00:00+00:00",
  "sourceSummary" => "scheduled-purge",
  "targetSummary" => "/config"
));
$scheduledPurgeReadOnlyPayload = buildQuarantineManagerPayload(false);
behaviorSmokeAssertSame(1, (int)$scheduledPurgeReadOnlyPayload["summary"]["count"], "Read-only quarantine summaries should count expired scheduled purge entries without purging them.");
behaviorSmokeAssertTrue(is_dir($scheduledPurgeDestination), "Read-only quarantine summaries should not run scheduled purge side effects.");
$scheduledPurgeReadOnlyManager = buildQuarantineManagerPayload(true);
behaviorSmokeAssertSame(1, (int)$scheduledPurgeReadOnlyManager["summary"]["count"], "Quarantine manager loads should show expired scheduled purge entries without purging them.");
behaviorSmokeAssertTrue(is_dir($scheduledPurgeDestination), "Quarantine manager loads should not run scheduled purge side effects.");
$scheduledPurgeExecution = sweepExpiredAppdataCleanupPlusQuarantineEntries();
behaviorSmokeAssertSame("scheduled-purge", $scheduledPurgeExecution["action"], "Scheduled purge sweeps should report their action label.");
behaviorSmokeAssertTrue(! is_dir($scheduledPurgeDestination), "Explicit expired scheduled purge sweeps should purge due entries.");
$latestAuditEntry = getLatestAppdataCleanupPlusAuditEntry();
behaviorSmokeAssertSame("scheduled-purge", isset($latestAuditEntry["operation"]) ? $latestAuditEntry["operation"] : "", "Scheduled purge sweeps should append an audit entry.");
behaviorSmokeAssertSame(1, isset($latestAuditEntry["summary"]["purged"]) ? (int)$latestAuditEntry["summary"]["purged"] : 0, "Scheduled purge sweeps should report purged entries in the audit summary.");

$scheduledPurgeSymlinkRoot = $stateRoot . "/scheduled-purge-symlink-quarantine";
$scheduledPurgeSymlinkDestination = $scheduledPurgeSymlinkRoot . "/20260330-121500/mnt/user/appdata/scheduled-purge-symlink";
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($scheduledPurgeSymlinkDestination . "/letsencrypt/live/npm-1"), "Scheduled purge symlink fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($scheduledPurgeSymlinkDestination . "/letsencrypt/archive/npm-1"), "Scheduled purge symlink target fixture should be created.");
file_put_contents($scheduledPurgeSymlinkDestination . "/letsencrypt/archive/npm-1/cert18.pem", "cert");
if ( function_exists("symlink") && @symlink("../../archive/npm-1/cert18.pem", $scheduledPurgeSymlinkDestination . "/letsencrypt/live/npm-1/cert.pem") ) {
  registerAppdataCleanupPlusQuarantineRecord(array(
    "id" => "scheduled-purge-symlink-entry",
    "name" => "scheduled-purge-symlink",
    "sourcePath" => "/mnt/user/appdata/scheduled-purge-symlink",
    "destination" => $scheduledPurgeSymlinkDestination,
    "quarantineRoot" => $scheduledPurgeSymlinkRoot,
    "quarantinedAt" => "2026-03-30T12:15:00+00:00",
    "purgeAt" => "2000-01-01T00:00:00+00:00",
    "sourceSummary" => "scheduled-purge-symlink",
    "targetSummary" => "/config"
  ));
  $scheduledPurgeSymlinkExecution = sweepExpiredAppdataCleanupPlusQuarantineEntries();
  behaviorSmokeAssertSame(1, isset($scheduledPurgeSymlinkExecution["summary"]["purged"]) ? (int)$scheduledPurgeSymlinkExecution["summary"]["purged"] : 0, "Scheduled purge should unlink symlink entries inside quarantined folders without following them.");
  behaviorSmokeAssertTrue(! is_dir($scheduledPurgeSymlinkDestination), "Scheduled purge should remove quarantined folders that contain symlink entries.");
}

$scheduledPurgeMountRoot = $stateRoot . "/scheduled-purge-mount-quarantine";
$scheduledPurgeMountDestination = $scheduledPurgeMountRoot . "/20260330-122000/mnt/user/appdata/scheduled-purge-mount";
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($scheduledPurgeMountDestination), "Scheduled purge failure fixture should be created.");
registerAppdataCleanupPlusQuarantineRecord(array(
  "id" => "scheduled-purge-failed-entry",
  "name" => "scheduled-purge-failed",
  "sourcePath" => "/mnt/user/appdata/scheduled-purge-failed",
  "destination" => $scheduledPurgeMountDestination,
  "quarantineRoot" => $scheduledPurgeMountRoot,
  "quarantinedAt" => "2026-03-30T12:20:00+00:00",
  "purgeAt" => "2000-01-01T00:00:00+00:00",
  "sourceSummary" => "scheduled-purge-failed",
  "targetSummary" => "/config"
));
$GLOBALS["APPDATA_CLEANUP_PLUS_TEST_MOUNT_POINTS"] = array($scheduledPurgeMountDestination => true);
$scheduledPurgeFailureExecution = sweepExpiredAppdataCleanupPlusQuarantineEntries();
unset($GLOBALS["APPDATA_CLEANUP_PLUS_TEST_MOUNT_POINTS"]);
behaviorSmokeAssertSame(1, isset($scheduledPurgeFailureExecution["summary"]["errors"]) ? (int)$scheduledPurgeFailureExecution["summary"]["errors"] : 0, "Scheduled purge failures should be reported in the sweep summary.");
$scheduledPurgeFailureRegistry = getAppdataCleanupPlusQuarantineRegistry();
behaviorSmokeAssertSame("", isset($scheduledPurgeFailureRegistry["scheduled-purge-failed-entry"]["purgeAt"]) ? (string)$scheduledPurgeFailureRegistry["scheduled-purge-failed-entry"]["purgeAt"] : "missing", "Failed scheduled purge entries should have their due timer paused.");
behaviorSmokeAssertContains("locked for safety", isset($scheduledPurgeFailureRegistry["scheduled-purge-failed-entry"]["purgeErrorMessage"]) ? (string)$scheduledPurgeFailureRegistry["scheduled-purge-failed-entry"]["purgeErrorMessage"] : "", "Failed scheduled purge entries should preserve the purge error message.");

$dockerRuntimeFixture = $stateRoot . "/docker-runtime";
$dockerClientFixture = $stateRoot . "/DockerClient.php";
$templatedOrphanPath = $appdataShareRoot . "/templated-orphan";
$zfsCaseSensitivePath = $appdataShareRoot . "/Sonarr";
$zfsBusyPath = $appdataShareRoot . "/Busy";
$filesystemOrphanPath = $appdataShareRoot . "/fs-orphan";
$composeProtectedPath = $appdataShareRoot . "/compose-owned";
$composeUncertainPath = $appdataShareRoot . "/compose-uncertain";
$liveAppPath = $appdataShareRoot . "/live-app";
$nestedAppRoot = $appdataShareRoot . "/nested-app";
$nestedTemplatePath = $nestedAppRoot . "/config";
$slashLiveRoot = $appdataShareRoot . "/adguard";
$slashLivePath = $slashLiveRoot . "/workingdir";
$staleNestedEmptyParentPath = $appdataShareRoot . "/stale-empty-parent";
$staleNestedEmptyTemplatePath = $staleNestedEmptyParentPath . "/config";
$staleNestedNonEmptyParentPath = $appdataShareRoot . "/stale-nonempty-parent";
$staleNestedNonEmptyTemplatePath = $staleNestedNonEmptyParentPath . "/workingdir";
$staleNestedNonEmptyMarkerPath = $staleNestedNonEmptyParentPath . "/leftover.txt";
$slashTemplatePath = $slashLivePath . "/";
$manualAliasTemplatePath = $manualAliasSourceRoot . "/manual-template-only";
$manualAliasLivePath = $manualAliasSourceRoot . "/alias-live";
$manualUserAliasTemplatePath = $appdataShareRoot . "/alias-live";
$manualCustomOrphanPath = $manualCustomSourceRoot . "/manual-root-only";
$vmDomainsPath = $appdataShareRoot . "/vm-domains";
$vmDomainTemplatePath = $vmDomainsPath . "/template-candidate";
$vmIsosPath = $appdataShareRoot . "/vm-isos";
$dockerManagedRoot = $appdataShareRoot . "/docker-system";
$dockerManagedImagePath = $dockerManagedRoot . "/docker.img";
$dockerManagedTemplatePath = $dockerManagedRoot . "/template-candidate";
$libvirtRoot = $appdataShareRoot . "/system/libvirt";
$libvirtImagePath = $libvirtRoot . "/libvirt.img";
$libvirtParentPath = $appdataShareRoot . "/system";
$recycleBinPath = $appdataShareRoot . "/.Recycle.Bin";
$lostFoundPath = $appdataShareRoot . "/lost+found";
$quarantinePath = $appdataShareRoot . "/.appdata-cleanup-plus-quarantine";
mkdir($dockerRuntimeFixture, 0777, true);
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory(dirname($dockerConfigFixture)), "Docker config fixture directory should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($shareConfigFixtureDir), "Share config fixture directory should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($templateFixtureDir), "Template fixture directory should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory(dirname($appdataShareRoot)), "Appdata share parent fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory(dirname($zfsDatasetRoot)), "ZFS dataset parent fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory(dirname($manualAliasSourceRoot)), "Manual appdata source parent fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($appdataSharePhysicalRoot), "Appdata share physical fixture root should be created.");
if ( function_exists("symlink") && @symlink($appdataSharePhysicalRoot, $appdataShareRoot) ) {
  $appdataShareUsesSymlink = true;
} else {
  behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($appdataShareRoot), "Appdata share fixture root should be created.");
}
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($manualAliasSourceRoot), "Manual alias appdata source fixture root should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($manualCustomSourceRoot), "Manual custom appdata source fixture root should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($zfsDatasetRoot), "ZFS dataset fixture root should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($outsideShareReviewPath), "Outside-share review fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($templatedOrphanPath), "Templated orphan fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($zfsCaseSensitivePath), "Case-sensitive ZFS fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($zfsBusyPath), "Busy ZFS fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($filesystemOrphanPath), "Filesystem orphan fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($composeProtectedPath), "Compose-owned fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($composeUncertainPath), "Compose uncertainty fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($liveAppPath), "Live app fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($nestedTemplatePath), "Nested template fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($slashLivePath), "Trailing-slash live path fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($staleNestedEmptyParentPath), "Empty stale nested parent fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($staleNestedNonEmptyParentPath), "Non-empty stale nested parent fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($manualAliasTemplatePath), "Manual source template fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($manualAliasLivePath), "Alias-mounted live path fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($manualCustomOrphanPath), "Manual source filesystem orphan fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($zfsDatasetRoot . "/templated-orphan"), "ZFS dataset templated orphan fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($zfsDatasetRoot . "/Sonarr"), "ZFS dataset case-sensitive fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($zfsDatasetRoot . "/Busy"), "Busy ZFS dataset fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($vmDomainTemplatePath), "VM domains fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($vmIsosPath), "VM ISO fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($dockerManagedTemplatePath), "Docker managed path fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($libvirtRoot), "Libvirt fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($recycleBinPath), "Recycle Bin fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($lostFoundPath), "lost+found fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($quarantinePath), "Quarantine fixture should be created.");
file_put_contents($staleNestedNonEmptyMarkerPath, "leftover");
file_put_contents($vmConfigFixture, "DOMAINDIR=\"" . $vmDomainsPath . "/\"\nMEDIADIR=\"" . $vmIsosPath . "/\"\nIMAGE_FILE=\"" . $libvirtImagePath . "\"\n");
file_put_contents($dockerConfigFixture, "DOCKER_APP_CONFIG_PATH=\"" . $appdataShareRoot . "\"\nDOCKER_IMAGE_FILE=\"" . $dockerManagedImagePath . "\"\n");
file_put_contents($shareConfigFixtureDir . "/" . $appdataShareName . ".cfg", "shareUseCache=\"yes\"\n");
behaviorSmokeAssertTrue(setAppdataCleanupPlusSafetySettings(array(
  "enablePermanentDelete" => false,
  "enableZfsDatasetDelete" => false,
  "manualAppdataSources" => array(
    $manualAliasSourceRoot,
    $manualCustomSourceRoot
  ),
  "zfsPathMappings" => array(
    array(
      "shareRoot" => $appdataShareRoot,
      "datasetRoot" => $zfsDatasetRoot
    )
  ),
  "defaultQuarantinePurgeDays" => 0
)), "Manual appdata sources should save before dashboard testing.");
$browseRootPayload = appdataCleanupPlusBuildManualSourceBrowsePayload("/mnt");
behaviorSmokeAssertSame(true, ! empty($browseRootPayload["ok"]), "Manual source browser should load the /mnt root.");
behaviorSmokeAssertSame("/mnt", $browseRootPayload["browser"]["currentPath"], "Manual source browser should report the browsed current path.");
behaviorSmokeAssertSame(false, ! empty($browseRootPayload["browser"]["canAdd"]), "The /mnt browse root should not be addable as a manual appdata source.");
behaviorSmokeAssertTrue(count($browseRootPayload["browser"]["entries"]) >= 2, "The /mnt browse root should expose child folders for navigation.");
$browseFcachePayload = appdataCleanupPlusBuildManualSourceBrowsePayload("/mnt/fcache");
behaviorSmokeAssertSame(true, ! empty($browseFcachePayload["ok"]), "Manual source browser should load nested paths under /mnt.");
behaviorSmokeAssertContains("/mnt/fcache", $browseFcachePayload["browser"]["currentPath"], "Manual source browser should preserve the selected nested path.");
behaviorSmokeAssertTrue(count(array_filter($browseFcachePayload["browser"]["entries"], function($entry) use ($manualCustomSourceRoot) {
  return isset($entry["path"]) && $entry["path"] === $manualCustomSourceRoot;
})) === 1, "Manual source browser should list child folders under the selected path.");
$browseManualRootPayload = appdataCleanupPlusBuildManualSourceBrowsePayload($manualCustomSourceRoot);
behaviorSmokeAssertSame(true, ! empty($browseManualRootPayload["ok"]), "Manual source browser should load candidate appdata roots.");
behaviorSmokeAssertSame(true, ! empty($browseManualRootPayload["browser"]["canAdd"]), "Dedicated child folders should become addable manual appdata roots in the browser.");
behaviorSmokeAssertSame("", $browseManualRootPayload["browser"]["validationMessage"], "Addable manual appdata roots should clear the browser validation message.");
$browseInvalidPayload = appdataCleanupPlusBuildManualSourceBrowsePayload("/boot/config");
behaviorSmokeAssertSame(false, ! empty($browseInvalidPayload["ok"]), "Manual source browser should reject paths outside /mnt.");
behaviorSmokeAssertSame(400, (int)$browseInvalidPayload["statusCode"], "Manual source browser should reject outside-root paths with a bad request status.");
$suggestedSourceInfo = buildAppdataCleanupPlusSourceInfo(array(
  "enablePermanentDelete" => false,
  "enableZfsDatasetDelete" => false,
  "manualAppdataSources" => array(
    $manualAliasSourceRoot,
    $manualCustomSourceRoot
  ),
  "zfsPathMappings" => array(),
  "defaultQuarantinePurgeDays" => 0
));
behaviorSmokeAssertTrue(count(array_filter($suggestedSourceInfo["zfsPathMappingSuggestions"], function($mapping) use ($appdataShareRoot, $zfsDatasetRoot) {
  return isset($mapping["shareRoot"], $mapping["datasetRoot"]) &&
    $mapping["shareRoot"] === $appdataShareRoot &&
    $mapping["datasetRoot"] === $zfsDatasetRoot;
})) === 1, "Source info should suggest likely ZFS mappings inferred from detected dataset mountpoints.");
$appdataSourceInfo = buildAppdataCleanupPlusSourceInfo(getAppdataCleanupPlusSafetySettings());
behaviorSmokeAssertSame(1, count($appdataSourceInfo["detected"]), "Source info should expose the detected Docker appdata root.");
behaviorSmokeAssertSame(2, count($appdataSourceInfo["effective"]), "Source info should include the default root plus distinct manual appdata roots.");
behaviorSmokeAssertSame(1, count($appdataSourceInfo["zfsPathMappings"]), "Source info should expose configured ZFS path mappings.");
behaviorSmokeAssertSame(0, count($appdataSourceInfo["zfsPathMappingSuggestions"]), "Configured ZFS mappings should suppress identical root suggestions.");
behaviorSmokeWriteTemplateFixture($templateFixtureDir . "/templated-orphan.xml", "templated-orphan", $templatedOrphanPath, "/config");
behaviorSmokeWriteTemplateFixture($templateFixtureDir . "/sonarr-zfs.xml", "Sonarr", $zfsCaseSensitivePath, "/config");
behaviorSmokeWriteTemplateFixture($templateFixtureDir . "/nested-app.xml", "nested-app", $nestedTemplatePath, "/config");
behaviorSmokeWriteTemplateFixture($templateFixtureDir . "/adguard-workingdir.xml", "AdGuard", $slashTemplatePath, "/opt/adguardhome/work");
behaviorSmokeWriteTemplateFixture($templateFixtureDir . "/stale-empty-parent.xml", "stale-empty-parent", $staleNestedEmptyTemplatePath, "/config");
behaviorSmokeWriteTemplateFixture($templateFixtureDir . "/stale-nonempty-parent.xml", "stale-nonempty-parent", $staleNestedNonEmptyTemplatePath, "/opt/stale");
behaviorSmokeWriteTemplateFixture($templateFixtureDir . "/manual-template-only.xml", "manual-template-only", $manualAliasTemplatePath, "/opt/manual");
behaviorSmokeWriteTemplateFixture($templateFixtureDir . "/alias-live.xml", "alias-live", $manualUserAliasTemplatePath, "/opt/alias");
behaviorSmokeWriteTemplateFixture($templateFixtureDir . "/outside-share-review.xml", "outside-share-review", $outsideShareReviewPath, "/config");
behaviorSmokeWriteTemplateFixture($templateFixtureDir . "/vm-template-managed.xml", "vm-template-managed", $vmDomainTemplatePath, "/config");
behaviorSmokeWriteTemplateFixture($templateFixtureDir . "/docker-template-managed.xml", "docker-template-managed", $dockerManagedTemplatePath, "/config");
file_put_contents($libvirtImagePath, "libvirt-image");
file_put_contents($dockerManagedImagePath, "docker-image");
$composeProtectedProjectDir = $composeProjectsFixtureDir . "/compose-protected";
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($composeProtectedProjectDir), "Compose protected project fixture should be created.");
file_put_contents($composeProtectedProjectDir . "/.env", "APPDATA_ROOT=" . $appdataShareRoot . "\n");
file_put_contents($composeProtectedProjectDir . "/compose.yaml", "services:\n  protected:\n    volumes:\n      - \${APPDATA_ROOT}/compose-owned:/config\n");
file_put_contents($dockerClientFixture, "<?php\ntrigger_error('docker client fixture include warning', E_USER_WARNING);\nclass DockerClient {\n  public function getDockerContainers() {\n    trigger_error('docker client fixture query warning', E_USER_WARNING);\n    echo \"docker-fixture-noise\";\n    return array((object)array(\n      'Volumes' => array(\n        (object)array('Source' => '" . addslashes($liveAppPath) . "', 'Destination' => '/config'),\n        (object)array('Source' => '" . addslashes($slashLivePath) . "', 'Destination' => '/opt/adguardhome/work'),\n        (object)array('Source' => '" . addslashes($manualAliasLivePath) . "', 'Destination' => '/opt/alias')\n      )\n    ));\n  }\n}\n");
putenv("APPDATA_CLEANUP_PLUS_DOCKER_RUNTIME_PATH=" . str_replace("\\", "/", $dockerRuntimeFixture));
putenv("APPDATA_CLEANUP_PLUS_DOCKER_CLIENT_PATH=" . str_replace("\\", "/", $dockerClientFixture));
$containers = getDockerContainersSafe();
behaviorSmokeAssertSame(1, count($containers), "Docker container scan should return fixture containers even when the Docker client emits warnings.");
$filteredVolumes = removeInstalledVolumeMatches(array(
  $liveAppPath => array(
    "HostDir" => $liveAppPath
  ),
  $templatedOrphanPath => array(
    "HostDir" => $templatedOrphanPath
  )
), $containers);
behaviorSmokeAssertTrue(! isset($filteredVolumes[$liveAppPath]), "Installed container paths should be removed even when Docker volumes arrive as objects.");
behaviorSmokeAssertTrue(isset($filteredVolumes[$templatedOrphanPath]), "Unmatched candidate paths should remain after Docker volume filtering.");
$dashboard = buildDashboardPayload();
behaviorSmokeAssertTrue(is_array($dashboard) && ! empty($dashboard["ok"]), "Dashboard build should survive DockerClient warnings and output.");
behaviorSmokeAssertSame(false, array_key_exists("auditHistory", $dashboard["payload"]), "Initial dashboard scan payloads should defer audit history until after the main scan returns.");
behaviorSmokeAssertSame(false, array_key_exists("quarantineSummary", $dashboard["payload"]), "Initial dashboard scan payloads should defer quarantine summary loading until after the main scan returns.");
behaviorSmokeAssertTrue(! empty($dashboard["payload"]["scanMetrics"]["phases"]), "Dashboard scan payloads should include per-phase timing metrics.");
behaviorSmokeAssertTrue(isset($dashboard["payload"]["scanMetrics"]["totalMs"]), "Dashboard scan payloads should include total scan time.");
$persistedScanMetrics = readAppdataCleanupPlusJsonFile(appdataCleanupPlusLatestScanMetricsFile(), array());
behaviorSmokeAssertTrue(! empty($persistedScanMetrics["phases"]), "Dashboard scan should persist latest scan metrics for diagnostics export fallback.");
$guardSourceRoot = $stateRoot . "/filesystem-guard-source";
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($guardSourceRoot . "/first"), "Filesystem guard fixture should create the first candidate.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($guardSourceRoot . "/second"), "Filesystem guard fixture should create the second candidate.");
putenv("APPDATA_CLEANUP_PLUS_FILESYSTEM_CANDIDATE_LIMIT=1");
$filesystemGuardMeta = array();
$guardedFilesystemMap = buildFilesystemCandidateMap(array(), array(), array(
  "manualAppdataSources" => array($guardSourceRoot)
), true, $filesystemGuardMeta);
putenv("APPDATA_CLEANUP_PLUS_FILESYSTEM_CANDIDATE_LIMIT");
behaviorSmokeAssertSame(1, count($guardedFilesystemMap), "Filesystem discovery guard should return bounded partial results.");
behaviorSmokeAssertSame(true, ! empty($filesystemGuardMeta["truncated"]), "Filesystem discovery guard should report truncation.");
$dashboardRows = isset($dashboard["payload"]["rows"]) && is_array($dashboard["payload"]["rows"]) ? $dashboard["payload"]["rows"] : array();
$templatedRow = behaviorSmokeFindRowByPath($dashboardRows, $templatedOrphanPath);
$zfsCaseRow = behaviorSmokeFindRowByPath($dashboardRows, $zfsCaseSensitivePath);
$filesystemRow = behaviorSmokeFindRowByPath($dashboardRows, $filesystemOrphanPath);
$liveRow = behaviorSmokeFindRowByPath($dashboardRows, $liveAppPath);
$nestedRootRow = behaviorSmokeFindRowByPath($dashboardRows, $nestedAppRoot);
$nestedTemplateRow = behaviorSmokeFindRowByPath($dashboardRows, $nestedTemplatePath);
$slashLiveRootRow = behaviorSmokeFindRowByPath($dashboardRows, $slashLiveRoot);
$slashLiveRow = behaviorSmokeFindRowByPath($dashboardRows, $slashLivePath);
$staleNestedEmptyParentRow = behaviorSmokeFindRowByPath($dashboardRows, $staleNestedEmptyParentPath);
$staleNestedNonEmptyParentRow = behaviorSmokeFindRowByPath($dashboardRows, $staleNestedNonEmptyParentPath);
$manualAliasTemplateRow = behaviorSmokeFindRowByPath($dashboardRows, $manualAliasTemplatePath);
$manualCustomFilesystemRow = behaviorSmokeFindRowByPath($dashboardRows, $manualCustomOrphanPath);
$manualUserAliasTemplateRow = behaviorSmokeFindRowByPath($dashboardRows, $manualUserAliasTemplatePath);
$outsideShareReviewRow = behaviorSmokeFindRowByPath($dashboardRows, $outsideShareReviewPath);
$vmDomainsRow = behaviorSmokeFindRowByPath($dashboardRows, $vmDomainsPath);
$vmTemplateRow = behaviorSmokeFindRowByPath($dashboardRows, $vmDomainTemplatePath);
$vmIsosRow = behaviorSmokeFindRowByPath($dashboardRows, $vmIsosPath);
$dockerManagedRow = behaviorSmokeFindRowByPath($dashboardRows, $dockerManagedRoot);
$dockerManagedTemplateRow = behaviorSmokeFindRowByPath($dashboardRows, $dockerManagedTemplatePath);
$libvirtParentRow = behaviorSmokeFindRowByPath($dashboardRows, $libvirtParentPath);
$recycleBinRow = behaviorSmokeFindRowByPath($dashboardRows, $recycleBinPath);
$lostFoundRow = behaviorSmokeFindRowByPath($dashboardRows, $lostFoundPath);
$quarantineRow = behaviorSmokeFindRowByPath($dashboardRows, $quarantinePath);
$composeProtectedRow = behaviorSmokeFindRowByPath($dashboardRows, $composeProtectedPath);
behaviorSmokeAssertTrue(is_array($templatedRow), "Template-backed orphan should be detected.");
behaviorSmokeAssertTrue(is_array($zfsCaseRow), "Case-sensitive ZFS-backed template orphan should be detected.");
behaviorSmokeAssertTrue(is_array($filesystemRow), "Filesystem-only orphan should be detected.");
behaviorSmokeAssertSame(null, $liveRow, "Installed appdata paths should not be surfaced as orphaned.");
behaviorSmokeAssertSame(null, $nestedRootRow, "Top-level share folders containing a nested tracked path should not be duplicated as filesystem orphans.");
behaviorSmokeAssertTrue(is_array($nestedTemplateRow), "Nested template-backed orphan should still be surfaced.");
behaviorSmokeAssertSame(null, $slashLiveRootRow, "Top-level parents should stay hidden while an active nested appdata mount still exists under them.");
behaviorSmokeAssertSame(null, $slashLiveRow, "A trailing slash difference between a saved template path and a live mount should not create a false orphan.");
behaviorSmokeAssertTrue(is_array($staleNestedEmptyParentRow), "Empty parents left behind after nested appdata paths disappear should be surfaced as discovery candidates.");
behaviorSmokeAssertSame(null, $staleNestedNonEmptyParentRow, "Non-empty parents with stale nested references should stay hidden in the initial safe implementation.");
behaviorSmokeAssertTrue(is_array($manualAliasTemplateRow), "Template-backed paths under manual appdata sources should be detected.");
behaviorSmokeAssertTrue(is_array($manualCustomFilesystemRow), "Manual appdata source roots should be scanned for filesystem orphans.");
behaviorSmokeAssertSame(null, $manualUserAliasTemplateRow, "Share-like alias live mounts should suppress matching template candidates.");
behaviorSmokeAssertTrue(is_array($outsideShareReviewRow), "Outside-share template-backed rows should still be detected for review.");
behaviorSmokeAssertSame(null, $vmDomainsRow, "VM Manager vdisk storage paths should be excluded from orphaned results.");
behaviorSmokeAssertSame(null, $vmTemplateRow, "Template-backed paths inside VM Manager storage should be excluded from orphaned results.");
behaviorSmokeAssertSame(null, $vmIsosRow, "VM Manager ISO storage paths should be excluded from orphaned results.");
behaviorSmokeAssertSame(null, $dockerManagedRow, "Docker managed storage paths should be excluded from orphaned results.");
behaviorSmokeAssertSame(null, $dockerManagedTemplateRow, "Template-backed paths inside Docker managed storage should be excluded from orphaned results.");
behaviorSmokeAssertSame(null, $libvirtParentRow, "Parents containing the configured libvirt path should be excluded from orphaned results.");
behaviorSmokeAssertSame(null, $recycleBinRow, ".Recycle.Bin should be excluded from filesystem orphan discovery.");
behaviorSmokeAssertSame(null, $lostFoundRow, "lost+found should be excluded from filesystem orphan discovery.");
behaviorSmokeAssertSame(null, $quarantineRow, "The plugin quarantine root should not be surfaced as a filesystem orphan.");
behaviorSmokeAssertSame(null, $composeProtectedRow, "Docker Compose Manager referenced appdata should not be surfaced as orphaned.");
behaviorSmokeAssertTrue(count(array_filter($dashboard["payload"]["scanMetrics"]["phases"], function($phase) {
  return isset($phase["name"]) && $phase["name"] === "compose_scan" && isset($phase["protectedPathCount"]) && (int)$phase["protectedPathCount"] > 0;
})) === 1, "Dashboard scan metrics should report Compose-protected appdata paths.");
behaviorSmokeAssertSame("template", $templatedRow["sourceKind"], "Template-backed rows should preserve their source kind.");
behaviorSmokeAssertSame("zfs", $templatedRow["storageKind"], "Mapped template-backed rows should resolve to ZFS dataset storage.");
behaviorSmokeAssertSame("docker_vm_nvme/" . $appdataShareName . "/templated-orphan", $templatedRow["datasetName"], "Mapped template-backed rows should expose the resolved ZFS dataset name.");
behaviorSmokeAssertSame(false, ! empty($templatedRow["policyLocked"]), "ZFS-backed template rows should not be policy-locked by a ZFS option.");
behaviorSmokeAssertSame(true, ! empty($templatedRow["canDelete"]), "ZFS-backed template rows should be actionable when ZFS datasets are enabled.");
behaviorSmokeAssertSame("docker_vm_nvme/" . $appdataShareName . "/Sonarr", $zfsCaseRow["datasetName"], "ZFS dataset resolution should preserve case-sensitive dataset names.");
behaviorSmokeAssertSame("filesystem", $filesystemRow["sourceKind"], "Filesystem-only rows should be marked as discovery candidates.");
behaviorSmokeAssertSame("filesystem", $staleNestedEmptyParentRow["sourceKind"], "Empty stale parent remnants should be surfaced as discovery candidates.");
behaviorSmokeAssertSame($appdataShareRoot, $filesystemRow["sourceDisplay"], "Filesystem-only rows should expose the configured source root.");
behaviorSmokeAssertSame($manualCustomSourceRoot, $manualCustomFilesystemRow["sourceDisplay"], "Manual-source discovery rows should expose the manual source root.");
behaviorSmokeAssertSame("safe", $staleNestedEmptyParentRow["risk"], "Empty stale parent remnants should stay safely actionable inside configured appdata roots.");
behaviorSmokeAssertSame("safe", $manualCustomFilesystemRow["risk"], "Manual appdata source rows should be treated as inside-source candidates.");
behaviorSmokeAssertSame(true, ! empty($manualCustomFilesystemRow["canDelete"]), "Manual appdata source rows should remain actionable.");
behaviorSmokeAssertSame(true, ! empty($staleNestedEmptyParentRow["canDelete"]), "Empty stale parent remnants should remain actionable.");
behaviorSmokeAssertSame("safe", $manualAliasTemplateRow["risk"], "Template-backed rows under configured appdata sources should not be mislabeled as outside-share review.");
behaviorSmokeAssertSame(true, ! empty($manualAliasTemplateRow["canDelete"]), "Template-backed rows under manual appdata sources should be actionable by default.");
behaviorSmokeAssertSame("safe", $outsideShareReviewRow["risk"], "Outside-share template rows should be treated as ready.");
behaviorSmokeAssertSame(false, ! empty($outsideShareReviewRow["policyLocked"]), "Outside-share rows should not start locked by a review gate.");
behaviorSmokeAssertSame(true, ! empty($outsideShareReviewRow["canDelete"]), "Outside-share rows should be actionable by default.");
behaviorSmokeAssertContains("Saved templates", $templatedRow["reason"], "Template-backed rows should explain their saved-template reference.");
behaviorSmokeAssertContains("no saved Docker template or installed container currently references it", $filesystemRow["reason"], "Filesystem-only rows should explain that they are unreferenced.");
behaviorSmokeAssertContains("empty parent folder", $staleNestedEmptyParentRow["reason"], "Empty stale parent remnants should explain why the direct child folder is now actionable.");
behaviorSmokeAssertContains($manualCustomSourceRoot, $manualCustomFilesystemRow["reason"], "Manual-source discovery rows should describe the source root that surfaced them.");
behaviorSmokeAssertSame($slashLivePath, normalizeUserPath($slashTemplatePath), "Path normalization should collapse trailing slashes on saved template paths.");
behaviorSmokeAssertTrue(! empty($templatedRow["statsPending"]), "Initial dashboard rows should mark heavy stats as pending for progressive hydration.");
$composeUncertainProjectDir = $composeProjectsFixtureDir . "/compose-uncertain";
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($composeUncertainProjectDir), "Compose uncertain project fixture should be created.");
file_put_contents($composeUncertainProjectDir . "/compose.yaml", "services:\n  uncertain:\n    volumes:\n      - \${MISSING_APPDATA_ROOT}/compose-uncertain:/config\n");
$composeUncertainDashboard = buildDashboardPayload();
$composeUncertainRows = isset($composeUncertainDashboard["payload"]["rows"]) && is_array($composeUncertainDashboard["payload"]["rows"]) ? $composeUncertainDashboard["payload"]["rows"] : array();
$composeUncertainTemplatedRow = behaviorSmokeFindRowByPath($composeUncertainRows, $templatedOrphanPath);
behaviorSmokeAssertTrue(is_array($composeUncertainTemplatedRow), "Compose uncertainty scan should still return rows for review.");
behaviorSmokeAssertSame(true, ! empty($composeUncertainTemplatedRow["scanVerificationLocked"]), "Unresolved Compose bind mounts should lock cleanup actions for the scan.");
behaviorSmokeAssertContains("Docker Compose Manager", isset($composeUncertainDashboard["payload"]["scanWarningMessage"]) ? $composeUncertainDashboard["payload"]["scanWarningMessage"] : "", "Unresolved Compose bind mounts should explain the scan action lock.");
behaviorSmokeRemoveTree($composeUncertainProjectDir);
$templateActionResolution = resolveCandidateForAction(array(
  "path" => $manualAliasTemplatePath,
  "displayPath" => $manualAliasTemplatePath,
  "realPath" => (string)@realpath($manualAliasTemplatePath),
  "sourceKind" => "template",
  "sourceNames" => array("manual-template-only"),
  "targetPaths" => array("/opt/manual")
), getAppdataCleanupPlusSafetySettings(), "quarantine");
behaviorSmokeAssertSame(true, ! empty($templateActionResolution["ok"]), "Action-time validation should allow template-backed rows by default.");
$unverifiedRows = appdataCleanupPlusApplyDockerInventorySafetyToRows(array($filesystemRow));
behaviorSmokeAssertSame(true, appdataCleanupPlusDockerInventoryUnverified(true, array(), array("template" => array("HostDir" => $templatedOrphanPath))), "Docker inventory should be treated as unverified when Docker is running, no containers are returned, and templates exist.");
behaviorSmokeAssertSame(false, ! empty($unverifiedRows[0]["canDelete"]), "Unverified Docker inventory scans should disable filesystem cleanup actions.");
behaviorSmokeAssertSame(true, ! empty($unverifiedRows[0]["scanVerificationLocked"]), "Unverified Docker inventory scans should mark rows with a scan verification lock.");
behaviorSmokeAssertContains("could not verify any installed containers", $unverifiedRows[0]["policyReason"], "Unverified Docker inventory locks should explain the inventory problem.");
$indexedStaleParentPath = $manualCustomSourceRoot . "/indexed-stale-parent";
$indexedLiveParentPath = $manualCustomSourceRoot . "/indexed-live-parent";
$indexedExactParentPath = $manualCustomSourceRoot . "/indexed-exact-parent";
$indexedTemplateVolumes = array();
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($indexedStaleParentPath), "Indexed stale-parent fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($indexedLiveParentPath . "/nested-0"), "Indexed live-parent nested fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($indexedExactParentPath), "Indexed exact-parent fixture should be created.");
for ( $index = 0; $index < 120; $index++ ) {
  $indexedTemplateVolumes["indexed-stale-" . $index] = array(
    "HostDir" => $indexedStaleParentPath . "/missing-" . $index
  );
  $indexedTemplateVolumes["indexed-live-" . $index] = array(
    "HostDir" => $indexedLiveParentPath . "/nested-" . $index
  );
}
$indexedTemplateVolumes["indexed-exact"] = array(
  "HostDir" => $indexedExactParentPath
);
$indexedFilesystemVolumes = buildFilesystemCandidateMap($indexedTemplateVolumes, array(), getAppdataCleanupPlusSafetySettings(), true);
behaviorSmokeAssertTrue(isset($indexedFilesystemVolumes[appdataCleanupPlusPathComparisonKey($indexedStaleParentPath)]), "Indexed filesystem discovery should still surface empty stale parents even with many nested references.");
behaviorSmokeAssertSame(false, isset($indexedFilesystemVolumes[appdataCleanupPlusPathComparisonKey($indexedLiveParentPath)]), "Indexed filesystem discovery should still hide parents that contain an existing nested reference.");
behaviorSmokeAssertSame(false, isset($indexedFilesystemVolumes[appdataCleanupPlusPathComparisonKey($indexedExactParentPath)]), "Indexed filesystem discovery should still hide direct-child folders that are referenced exactly.");
behaviorSmokeRemoveTree($indexedStaleParentPath);
behaviorSmokeRemoveTree($indexedLiveParentPath);
behaviorSmokeRemoveTree($indexedExactParentPath);
$outsideShareActionResolution = resolveCandidateForAction(array(
  "path" => $outsideShareReviewPath,
  "displayPath" => $outsideShareReviewPath,
  "realPath" => (string)@realpath($outsideShareReviewPath)
), getAppdataCleanupPlusSafetySettings(), "quarantine");
behaviorSmokeAssertSame(true, ! empty($outsideShareActionResolution["ok"]), "Outside-share rows should be actionable by default.");
$dashboardRescan = buildDashboardPayload();
$rescannedOutsideShareRow = behaviorSmokeFindRowByPath(isset($dashboardRescan["payload"]["rows"]) ? $dashboardRescan["payload"]["rows"] : array(), $outsideShareReviewPath);
behaviorSmokeAssertTrue(is_array($rescannedOutsideShareRow), "Outside-share rows should still be present after a rescan.");
behaviorSmokeAssertSame(false, ! empty($rescannedOutsideShareRow["policyLocked"]), "Rescanning should keep outside-share rows ready.");
$manualSourceActionResolution = resolveCandidateForAction(array(
  "path" => $manualCustomOrphanPath,
  "displayPath" => $manualCustomOrphanPath,
  "realPath" => (string)@realpath($manualCustomOrphanPath)
), getAppdataCleanupPlusSafetySettings(), "quarantine");
behaviorSmokeAssertSame(true, ! empty($manualSourceActionResolution["ok"]), "Paths inside manual appdata sources should stay actionable.");
$zfsPermanentDeleteDisabledResolution = resolveCandidateForAction(array(
  "path" => $templatedOrphanPath,
  "displayPath" => $templatedOrphanPath,
  "realPath" => (string)@realpath($templatedOrphanPath),
  "storageKind" => "zfs",
  "datasetName" => "docker_vm_nvme/" . $appdataShareName . "/templated-orphan"
), getAppdataCleanupPlusSafetySettings(), "delete");
behaviorSmokeAssertSame(false, ! empty($zfsPermanentDeleteDisabledResolution["ok"]), "ZFS-backed delete should stay blocked while permanent delete mode is disabled.");
behaviorSmokeAssertContains("Permanent delete mode is disabled", $zfsPermanentDeleteDisabledResolution["message"], "Delete actions should still respect the global permanent delete toggle before ZFS dataset destroy can run.");
behaviorSmokeAssertTrue(setAppdataCleanupPlusSafetySettings(array(
  "enablePermanentDelete" => false,
  "enableZfsDatasetDelete" => true,
  "manualAppdataSources" => array(
    $manualAliasSourceRoot,
    $manualCustomSourceRoot
  ),
  "zfsPathMappings" => array(
    array(
      "shareRoot" => $appdataShareRoot,
      "datasetRoot" => $zfsDatasetRoot
    )
  ),
  "defaultQuarantinePurgeDays" => 0
)), "Permanent delete should stay disabled before action-time checks.");
$zfsQuarantineBlockedResolution = resolveCandidateForAction(array(
  "path" => $templatedOrphanPath,
  "displayPath" => $templatedOrphanPath,
  "realPath" => (string)@realpath($templatedOrphanPath),
  "storageKind" => "zfs",
  "datasetName" => "docker_vm_nvme/" . $appdataShareName . "/templated-orphan"
), getAppdataCleanupPlusSafetySettings(), "quarantine");
behaviorSmokeAssertSame(false, ! empty($zfsQuarantineBlockedResolution["ok"]), "ZFS-backed rows should not support quarantine mode.");
behaviorSmokeAssertContains("cannot be quarantined", $zfsQuarantineBlockedResolution["message"], "ZFS-backed quarantine blocks should explain the delete-only workflow.");
behaviorSmokeAssertTrue(setAppdataCleanupPlusSafetySettings(array(
  "enablePermanentDelete" => true,
  "enableZfsDatasetDelete" => true,
  "manualAppdataSources" => array(
    $manualAliasSourceRoot,
    $manualCustomSourceRoot
  ),
  "zfsPathMappings" => array(
    array(
      "shareRoot" => $appdataShareRoot,
      "datasetRoot" => $zfsDatasetRoot
    )
  ),
  "defaultQuarantinePurgeDays" => 0
)), "Permanent delete should be enabled before the ZFS delete workflow.");
$zfsDeleteReadyResolution = resolveCandidateForAction(array(
  "path" => $templatedOrphanPath,
  "displayPath" => $templatedOrphanPath,
  "realPath" => (string)@realpath($templatedOrphanPath),
  "storageKind" => "zfs",
  "datasetName" => "docker_vm_nvme/" . $appdataShareName . "/templated-orphan"
), getAppdataCleanupPlusSafetySettings(), "delete");
behaviorSmokeAssertSame(true, ! empty($zfsDeleteReadyResolution["ok"]), "ZFS-backed rows should become actionable in permanent delete mode.");
$zfsPreviewExecution = executeCandidateOperation(array(array(
  "id" => "templated-zfs",
  "name" => "templated-orphan",
  "path" => $templatedOrphanPath,
  "displayPath" => $templatedOrphanPath,
  "realPath" => (string)@realpath($templatedOrphanPath),
  "storageKind" => "zfs",
  "datasetName" => "docker_vm_nvme/" . $appdataShareName . "/templated-orphan"
)), getAppdataCleanupPlusSafetySettings(), "preview_delete");
behaviorSmokeAssertSame("ready", $zfsPreviewExecution["results"][0]["status"], "ZFS delete previews should report ready when the dataset can be destroyed.");
behaviorSmokeAssertSame(false, ! empty($zfsPreviewExecution["results"][0]["recursive"]), "Standard ZFS dataset previews should avoid recursive destroy when it is not required.");
behaviorSmokeAssertSame("", (string)$zfsPreviewExecution["results"][0]["zfsImpactSummary"], "Standard ZFS previews should not report recursive impact when it is not needed.");
$zfsRecursivePreviewExecution = executeCandidateOperation(array(array(
  "id" => "sonarr-zfs",
  "name" => "Sonarr",
  "path" => $zfsCaseSensitivePath,
  "displayPath" => $zfsCaseSensitivePath,
  "realPath" => (string)@realpath($zfsCaseSensitivePath),
  "storageKind" => "zfs",
  "datasetName" => "docker_vm_nvme/" . $appdataShareName . "/Sonarr"
)), getAppdataCleanupPlusSafetySettings(), "preview_delete");
behaviorSmokeAssertSame(true, ! empty($zfsRecursivePreviewExecution["results"][0]["recursive"]), "Recursive ZFS previews should surface when the dataset requires -r.");
behaviorSmokeAssertContains("Recursive destroy will also remove", $zfsRecursivePreviewExecution["results"][0]["zfsImpactSummary"], "Recursive ZFS previews should summarize descendant impact.");
behaviorSmokeAssertSame(1, (int)$zfsRecursivePreviewExecution["results"][0]["zfsChildDatasetCount"], "Recursive ZFS previews should count child datasets.");
behaviorSmokeAssertSame(2, (int)$zfsRecursivePreviewExecution["results"][0]["zfsSnapshotCount"], "Recursive ZFS previews should count affected snapshots.");
behaviorSmokeAssertContains("library", implode(",", $zfsRecursivePreviewExecution["results"][0]["zfsChildDatasets"]), "Recursive ZFS previews should list child datasets.");
behaviorSmokeAssertContains("@keep", implode(",", $zfsRecursivePreviewExecution["results"][0]["zfsSnapshots"]), "Recursive ZFS previews should list affected snapshots.");
$zfsRecursiveDetailPayload = appdataCleanupPlusBuildCandidateDetailPayload(array(
  "id" => "sonarr-zfs",
  "path" => $zfsCaseSensitivePath,
  "displayPath" => $zfsCaseSensitivePath
), getAppdataCleanupPlusSafetySettings());
behaviorSmokeAssertSame(true, ! empty($zfsRecursiveDetailPayload["zfsPreviewLoaded"]), "Row detail payloads should preload the current ZFS destroy preview for dataset-backed rows.");
behaviorSmokeAssertSame(true, ! empty($zfsRecursiveDetailPayload["zfsRecursiveDestroy"]), "Row detail payloads should surface when recursive destroy is required.");
behaviorSmokeAssertSame(1, (int)$zfsRecursiveDetailPayload["zfsChildDatasetCount"], "Row detail payloads should surface child dataset counts.");
behaviorSmokeAssertSame(2, (int)$zfsRecursiveDetailPayload["zfsSnapshotCount"], "Row detail payloads should surface snapshot counts.");
$zfsMappedNonExactDetailPayload = appdataCleanupPlusBuildCandidateDetailPayload(array(
  "id" => "nested-non-zfs",
  "path" => $nestedTemplatePath,
  "displayPath" => $nestedTemplatePath
), getAppdataCleanupPlusSafetySettings());
behaviorSmokeAssertSame("mapped_no_exact_mountpoint", (string)$zfsMappedNonExactDetailPayload["zfsResolutionKind"], "Mapped non-ZFS rows should expose why they did not resolve to an exact dataset.");
behaviorSmokeAssertSame($appdataShareRoot, (string)$zfsMappedNonExactDetailPayload["zfsMatchedShareRoot"], "Mapped non-ZFS row details should expose the matched share root.");
behaviorSmokeAssertSame($zfsDatasetRoot, (string)$zfsMappedNonExactDetailPayload["zfsMatchedDatasetRoot"], "Mapped non-ZFS row details should expose the matched dataset root.");
behaviorSmokeAssertContains($zfsDatasetRoot, implode(",", $zfsMappedNonExactDetailPayload["zfsResolutionVariants"]), "Mapped non-ZFS row details should expose the checked dataset-side paths.");
$zfsBusyPreviewExecution = executeCandidateOperation(array(array(
  "id" => "busy-zfs",
  "name" => "Busy",
  "path" => $zfsBusyPath,
  "displayPath" => $zfsBusyPath,
  "realPath" => (string)@realpath($zfsBusyPath),
  "storageKind" => "zfs",
  "datasetName" => "docker_vm_nvme/" . $appdataShareName . "/Busy"
)), getAppdataCleanupPlusSafetySettings(), "preview_delete");
behaviorSmokeAssertSame("error", $zfsBusyPreviewExecution["results"][0]["status"], "Busy ZFS dataset previews should fail instead of escalating to recursive destroy.");
behaviorSmokeAssertSame(false, ! empty($zfsBusyPreviewExecution["results"][0]["recursive"]), "Busy ZFS dataset previews should not mark recursive destroy as available.");
behaviorSmokeAssertContains("dataset is busy", $zfsBusyPreviewExecution["results"][0]["message"], "Busy ZFS dataset previews should preserve the original dry-run failure.");
$zfsDeleteExecution = executeCandidateOperation(array(array(
  "id" => "templated-zfs",
  "name" => "templated-orphan",
  "path" => $templatedOrphanPath,
  "displayPath" => $templatedOrphanPath,
  "realPath" => (string)@realpath($templatedOrphanPath),
  "storageKind" => "zfs",
  "datasetName" => "docker_vm_nvme/" . $appdataShareName . "/templated-orphan"
)), getAppdataCleanupPlusSafetySettings(), "delete");
behaviorSmokeAssertSame("deleted", $zfsDeleteExecution["results"][0]["status"], "ZFS-backed deletes should report deleted when the dataset destroy succeeds.");
behaviorSmokeAssertSame(false, is_dir($templatedOrphanPath), "Successful ZFS-backed deletes should remove the mapped share path.");
$zfsRecursiveDeleteExecution = executeCandidateOperation(array(array(
  "id" => "sonarr-zfs",
  "name" => "Sonarr",
  "path" => $zfsCaseSensitivePath,
  "displayPath" => $zfsCaseSensitivePath,
  "realPath" => (string)@realpath($zfsCaseSensitivePath),
  "storageKind" => "zfs",
  "datasetName" => "docker_vm_nvme/" . $appdataShareName . "/Sonarr"
)), getAppdataCleanupPlusSafetySettings(), "delete");
behaviorSmokeAssertSame("deleted", $zfsRecursiveDeleteExecution["results"][0]["status"], "Recursive ZFS-backed deletes should still report deleted when the dataset destroy succeeds.");
behaviorSmokeAssertSame(true, ! empty($zfsRecursiveDeleteExecution["results"][0]["recursive"]), "Recursive ZFS-backed deletes should report that -r was used.");
behaviorSmokeAssertContains("Recursive destroy will also remove", $zfsRecursiveDeleteExecution["results"][0]["zfsImpactSummary"], "Recursive ZFS-backed deletes should preserve recursive impact details in the results.");
behaviorSmokeAssertSame(false, is_dir($zfsCaseSensitivePath), "Recursive ZFS-backed deletes should remove the case-sensitive share path.");
$postDeleteDashboard = buildDashboardPayload();
behaviorSmokeAssertSame(null, behaviorSmokeFindRowByPath(isset($postDeleteDashboard["payload"]["rows"]) ? $postDeleteDashboard["payload"]["rows"] : array(), $templatedOrphanPath), "Deleted ZFS-backed rows should disappear after a rescan.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($templatedOrphanPath), "Templated orphan fixture should be recreated after ZFS delete testing.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($zfsCaseSensitivePath), "Case-sensitive ZFS fixture should be recreated after ZFS delete testing.");
$defaultPurgeCandidatePath = $appdataShareRoot . "/default-purge-candidate";
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($defaultPurgeCandidatePath), "Default purge candidate fixture should be created.");
behaviorSmokeAssertTrue(setAppdataCleanupPlusSafetySettings(array(
  "enablePermanentDelete" => false,
  "defaultQuarantinePurgeDays" => 30
)), "Default purge timer settings should be saved before quarantine.");
$defaultPurgeResult = quarantineCandidatePath(array(
  "name" => "default-purge-candidate",
  "sourceKind" => "filesystem",
  "sourceLabel" => "Discovery",
  "sourceDisplay" => "Appdata share scan",
  "reason" => "Default purge timer fixture."
), $defaultPurgeCandidatePath, getAppdataCleanupPlusSafetySettings());
behaviorSmokeAssertSame(true, ! empty($defaultPurgeResult["ok"]), "Quarantine moves should succeed when testing the default purge timer.");
$defaultPurgeRegistry = getAppdataCleanupPlusQuarantineRegistry();
$defaultPurgeRecord = null;
foreach ( $defaultPurgeRegistry as $record ) {
  if ( isset($record["sourcePath"]) && $record["sourcePath"] === $defaultPurgeCandidatePath ) {
    $defaultPurgeRecord = normalizeAppdataCleanupPlusQuarantineRecord($record);
    break;
  }
}
behaviorSmokeAssertTrue(is_array($defaultPurgeRecord), "Newly quarantined entries should be written to the quarantine registry.");
behaviorSmokeAssertTrue($defaultPurgeRecord["purgeAt"] !== "", "Newly quarantined entries should inherit the configured default purge timer.");
behaviorSmokeAssertTrue(strtotime($defaultPurgeRecord["purgeAt"]) > time(), "Default quarantine purge timers should be scheduled in the future.");
behaviorSmokeAssertSame("purged", purgeTrackedQuarantineEntry($defaultPurgeRecord)["status"], "Default purge fixture should be cleaned up after quarantine testing.");
behaviorSmokeAssertTrue(setAppdataCleanupPlusSafetySettings(array(
  "enablePermanentDelete" => false,
  "defaultQuarantinePurgeDays" => 0
)), "Default purge timer settings should reset after quarantine testing.");

$recoveredMarkerSourcePath = $appdataShareRoot . "/recovered marker source";
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($recoveredMarkerSourcePath), "Marker-backed recovery source fixture should be created.");
$recoveredMarkerQuarantineResult = quarantineCandidatePath(array(
  "name" => "recovered marker source",
  "sourceKind" => "filesystem",
  "sourceLabel" => "Discovery",
  "sourceDisplay" => "Appdata share scan",
  "reason" => "Marker-backed quarantine recovery fixture."
), $recoveredMarkerSourcePath, getAppdataCleanupPlusSafetySettings());
behaviorSmokeAssertSame(true, ! empty($recoveredMarkerQuarantineResult["ok"]), "Marker-backed quarantine recovery fixture should be quarantined.");
$recoveredMarkerDestination = $recoveredMarkerQuarantineResult["destination"];
behaviorSmokeAssertTrue(is_file(appdataCleanupPlusQuarantineEntryMarkerFile($recoveredMarkerDestination)), "New quarantined folders should write an on-disk recovery marker.");
@unlink(appdataCleanupPlusQuarantineRegistryFile());
@unlink(appdataCleanupPlusSafetySettingsFile());
$recoveredMarkerPayload = buildQuarantineManagerPayload(true);
$recoveredMarkerEntry = null;
foreach ( $recoveredMarkerPayload["entries"] as $entry ) {
  if ( isset($entry["destination"]) && $entry["destination"] === $recoveredMarkerDestination ) {
    $recoveredMarkerEntry = $entry;
    break;
  }
}
behaviorSmokeAssertTrue(is_array($recoveredMarkerEntry), "The quarantine manager should recover marker-backed entries from disk when plugin state is reset.");
behaviorSmokeAssertSame($recoveredMarkerSourcePath, $recoveredMarkerEntry["sourcePath"], "Marker-backed recovery should preserve the exact original source path.");
behaviorSmokeAssertSame(1, (int)$recoveredMarkerPayload["summary"]["count"], "Recovered marker-backed entries should repopulate the quarantine summary.");
$recoveredMarkerPayloadAgain = buildQuarantineManagerPayload(true);
behaviorSmokeAssertSame(1, (int)$recoveredMarkerPayloadAgain["summary"]["count"], "Recovered marker-backed entries should not be duplicated on repeated manager loads.");
behaviorSmokeAssertSame(1, count(getAppdataCleanupPlusQuarantineRegistry()), "Recovered marker-backed entries should be written back into the quarantine registry.");
$recoveredMarkerRestoreResult = restoreTrackedQuarantineEntry($recoveredMarkerEntry);
behaviorSmokeAssertSame("restored", $recoveredMarkerRestoreResult["status"], "Recovered marker-backed entries should remain restorable.");
behaviorSmokeAssertTrue(is_dir($recoveredMarkerSourcePath), "Recovered marker-backed restores should return the folder to its original path.");
behaviorSmokeAssertSame(false, file_exists(appdataCleanupPlusQuarantineEntryMarkerFile($recoveredMarkerSourcePath)), "Restore should remove the on-disk recovery marker from the restored folder.");

$legacyRecoveredSourcePath = $appdataShareRoot . "/legacy-recovery";
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($legacyRecoveredSourcePath), "Legacy recovery source fixture should be created.");
$legacyRecoveredQuarantineResult = quarantineCandidatePath(array(
  "name" => "legacy-recovery",
  "sourceKind" => "filesystem",
  "sourceLabel" => "Discovery",
  "sourceDisplay" => "Appdata share scan",
  "reason" => "Legacy quarantine recovery fixture."
), $legacyRecoveredSourcePath, getAppdataCleanupPlusSafetySettings());
behaviorSmokeAssertSame(true, ! empty($legacyRecoveredQuarantineResult["ok"]), "Legacy recovery fixture should be quarantined.");
$legacyRecoveredDestination = $legacyRecoveredQuarantineResult["destination"];
@unlink(appdataCleanupPlusQuarantineEntryMarkerFile($legacyRecoveredDestination));
@unlink(appdataCleanupPlusQuarantineRegistryFile());
@unlink(appdataCleanupPlusSafetySettingsFile());
$legacyRecoveredPayload = buildQuarantineManagerPayload(true);
$legacyRecoveredEntry = null;
foreach ( $legacyRecoveredPayload["entries"] as $entry ) {
  if ( isset($entry["destination"]) && $entry["destination"] === $legacyRecoveredDestination ) {
    $legacyRecoveredEntry = $entry;
    break;
  }
}
behaviorSmokeAssertTrue(is_array($legacyRecoveredEntry), "The quarantine manager should recover legacy quarantine folders from their on-disk layout when the registry is missing.");
behaviorSmokeAssertSame($legacyRecoveredSourcePath, $legacyRecoveredEntry["sourcePath"], "Legacy recovery should reconstruct the original source path from the quarantine layout.");
behaviorSmokeAssertSame("Recovered", $legacyRecoveredEntry["sourceLabel"], "Legacy recovery should identify entries recovered from quarantine storage.");
behaviorSmokeAssertSame(1, (int)$legacyRecoveredPayload["summary"]["count"], "Legacy recovery should repopulate the quarantine summary.");
$legacyRecoveredPurgeResult = purgeTrackedQuarantineEntry($legacyRecoveredEntry);
behaviorSmokeAssertSame("purged", $legacyRecoveredPurgeResult["status"], "Recovered legacy entries should remain purgeable.");
behaviorSmokeAssertSame(false, is_dir($legacyRecoveredDestination), "Purging a recovered legacy entry should remove the quarantined folder.");

if ( $appdataShareUsesSymlink ) {
  behaviorSmokeAssertSame("", buildPathSecurityLockReason($templatedOrphanPath), "Configured appdata share root symlinks should not lock inside-share candidates.");
  behaviorSmokeAssertSame(false, ! empty($filesystemRow["policyLocked"]), "Configured appdata share root symlinks should leave inside-share discovery rows actionable.");
}
$hydratedCandidate = resolveSnapshotCandidates($dashboard["payload"]["scanToken"], array($templatedRow["id"]));
behaviorSmokeAssertTrue(! empty($hydratedCandidate["ok"]), "Hydration should be able to resolve the initial snapshot candidate.");
$hydratedStatsRow = buildHydratedCandidateStatRow($hydratedCandidate["candidates"][0]);
behaviorSmokeAssertSame($templatedRow["id"], $hydratedStatsRow["id"], "Hydrated stats should map back to the original row id.");
behaviorSmokeAssertSame(false, ! empty($hydratedStatsRow["statsPending"]), "Hydrated rows should clear the pending-stats marker.");
behaviorSmokeAssertTrue($hydratedStatsRow["sizeLabel"] !== "Unknown", "Hydrated rows should populate a real size label.");
$hydratedEmptyCandidate = resolveSnapshotCandidates($dashboard["payload"]["scanToken"], array($staleNestedEmptyParentRow["id"]));
behaviorSmokeAssertTrue(! empty($hydratedEmptyCandidate["ok"]), "Hydration should resolve the empty parent remnant candidate.");
$hydratedEmptyStatsRow = buildHydratedCandidateStatRow($hydratedEmptyCandidate["candidates"][0]);
behaviorSmokeAssertSame(0, $hydratedEmptyStatsRow["sizeBytes"], "Empty folders should hydrate with zero measured bytes.");
behaviorSmokeAssertSame("Empty", $hydratedEmptyStatsRow["sizeLabel"], "Empty folders should render an explicit Empty size label instead of Unknown.");

$vmManagerPaths = getAppdataCleanupPlusVmManagerManagedPaths();
behaviorSmokeAssertSame(3, count($vmManagerPaths), "VM Manager config should expose the configured vdisk, ISO, and libvirt paths.");
$dockerManagedPaths = getAppdataCleanupPlusDockerManagedPaths();
behaviorSmokeAssertSame(1, count($dockerManagedPaths), "Docker config should expose the configured Docker image storage path.");
behaviorSmokeAssertContains("VM Manager vdisk storage path", buildPathSecurityLockReason($vmDomainsPath), "VM Manager vdisk storage should be safety-locked.");
behaviorSmokeAssertContains("VM Manager libvirt storage path", buildPathSecurityLockReason($libvirtParentPath), "Parents containing the configured libvirt path should be safety-locked.");
behaviorSmokeAssertContains("Docker image storage path", buildPathSecurityLockReason($dockerManagedRoot), "Docker image storage should be safety-locked.");
$vmActionResolution = resolveCandidateForAction(array(
  "path" => $vmDomainsPath,
  "displayPath" => $vmDomainsPath,
  "realPath" => (string)@realpath($vmDomainsPath)
), getAppdataCleanupPlusSafetySettings(), "quarantine");
behaviorSmokeAssertSame(false, $vmActionResolution["ok"], "VM Manager paths should be blocked at action time.");
behaviorSmokeAssertSame("blocked", $vmActionResolution["status"], "VM Manager action blocks should be reported as blocked.");
behaviorSmokeAssertContains("VM Manager vdisk storage path", $vmActionResolution["message"], "VM Manager action blocks should explain why the path is excluded.");
$dockerActionResolution = resolveCandidateForAction(array(
  "path" => $dockerManagedRoot,
  "displayPath" => $dockerManagedRoot,
  "realPath" => (string)@realpath($dockerManagedRoot)
), getAppdataCleanupPlusSafetySettings(), "quarantine");
behaviorSmokeAssertSame(false, $dockerActionResolution["ok"], "Docker managed paths should be blocked at action time.");
behaviorSmokeAssertSame("blocked", $dockerActionResolution["status"], "Docker managed action blocks should be reported as blocked.");
behaviorSmokeAssertContains("Docker image storage path", $dockerActionResolution["message"], "Docker managed action blocks should explain why the path is excluded.");

$symlinkTargetPath = $appdataShareRoot . "/symlink-target";
$symlinkLinkPath = $appdataShareRoot . "/symlink-link";
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($symlinkTargetPath . "/child"), "Symlink target fixture should be created.");
if ( function_exists("symlink") && @symlink($symlinkTargetPath, $symlinkLinkPath) ) {
  $symlinkReason = buildPathSecurityLockReason($symlinkLinkPath . "/child");
  behaviorSmokeAssertContains($symlinkLinkPath, $symlinkReason, "Symlink lock reasons should identify the exact offending path segment.");
}

$progressDeletePath = $stateRoot . "/progress-delete";
$progressDeleteId = "smoke-progress-delete";
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($progressDeletePath . "/nested"), "Progress delete fixture should be created.");
file_put_contents($progressDeletePath . "/root.txt", "root");
file_put_contents($progressDeletePath . "/nested/child.txt", "child");
appdataCleanupPlusInitializeOperationProgress($progressDeleteId, "delete", 1);
$progressDeleteResult = nativeDeleteDirectory($progressDeletePath, array(
  "operationProgressId" => $progressDeleteId
));
$progressPayload = appdataCleanupPlusReadOperationProgress($progressDeleteId);
behaviorSmokeAssertSame(true, ! empty($progressDeleteResult["ok"]), "Progress-tracked native deletes should succeed.");
behaviorSmokeAssertSame(false, is_dir($progressDeletePath), "Progress-tracked native deletes should remove the target folder.");
behaviorSmokeAssertSame(0, (int)$progressPayload["totalItems"], "Progress tracking should avoid expensive recursive item counts.");
behaviorSmokeAssertSame(0, (int)$progressPayload["processedItems"], "Progress tracking should avoid per-file delete writes.");
behaviorSmokeAssertSame(array(), $progressPayload["recent"], "Progress tracking should not retain per-file delete paths.");
behaviorSmokeAssertContains("progress-delete", $progressPayload["currentPath"], "Progress tracking should keep the current root folder.");

behaviorSmokeRemoveTree($stateRoot);
behaviorSmokeRemoveTree($appdataShareRoot);
behaviorSmokeRemoveTree($zfsDatasetRoot);
behaviorSmokeRemoveTree($manualAliasSourceRoot);
behaviorSmokeRemoveTree($manualCustomSourceRoot);
behaviorSmokeRemoveTree($outsideShareReviewRoot);
behaviorSmokeRemoveTree($appdataSharePhysicalRoot);
echo "behavior_smoke: OK" . PHP_EOL;
