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
$appdataShareName = "acp-smoke-share-" . getmypid();
$appdataShareRoot = "/mnt/user/" . $appdataShareName;
$appdataSharePhysicalRoot = $stateRoot . "/appdata-share-root";
$appdataShareUsesSymlink = false;

putenv("APPDATA_CLEANUP_PLUS_STATE_ROOT=" . $stateRoot);
putenv("APPDATA_CLEANUP_PLUS_DOCKER_CONFIG_PATH=" . $dockerConfigFixture);
putenv("APPDATA_CLEANUP_PLUS_VM_CONFIG_PATH=" . $vmConfigFixture);
putenv("APPDATA_CLEANUP_PLUS_SHARE_CONFIG_DIR=" . $shareConfigFixtureDir);
putenv("APPDATA_CLEANUP_PLUS_DOCKER_TEMPLATE_DIR=" . $templateFixtureDir);

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

function behaviorSmokeAssertContains($needle, $haystack, $message) {
  if ( strpos((string)$haystack, (string)$needle) === false ) {
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

behaviorSmokeRemoveTree($stateRoot);
behaviorSmokeRemoveTree($appdataShareRoot);
behaviorSmokeRemoveTree($appdataSharePhysicalRoot);
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
$templatedOrphanPath = $appdataShareRoot . "/templated-orphan";
$filesystemOrphanPath = $appdataShareRoot . "/fs-orphan";
$liveAppPath = $appdataShareRoot . "/live-app";
$nestedAppRoot = $appdataShareRoot . "/nested-app";
$nestedTemplatePath = $nestedAppRoot . "/config";
$slashLiveRoot = $appdataShareRoot . "/adguard";
$slashLivePath = $slashLiveRoot . "/workingdir";
$slashTemplatePath = $slashLivePath . "/";
$vmDomainsPath = $appdataShareRoot . "/vm-domains";
$vmDomainTemplatePath = $vmDomainsPath . "/template-candidate";
$vmIsosPath = $appdataShareRoot . "/vm-isos";
$libvirtRoot = $appdataShareRoot . "/system/libvirt";
$libvirtImagePath = $libvirtRoot . "/libvirt.img";
$libvirtParentPath = $appdataShareRoot . "/system";
$recycleBinPath = $appdataShareRoot . "/.Recycle.Bin";
$quarantinePath = $appdataShareRoot . "/.appdata-cleanup-plus-quarantine";
mkdir($dockerRuntimeFixture, 0777, true);
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory(dirname($dockerConfigFixture)), "Docker config fixture directory should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($shareConfigFixtureDir), "Share config fixture directory should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($templateFixtureDir), "Template fixture directory should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory(dirname($appdataShareRoot)), "Appdata share parent fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($appdataSharePhysicalRoot), "Appdata share physical fixture root should be created.");
if ( function_exists("symlink") && @symlink($appdataSharePhysicalRoot, $appdataShareRoot) ) {
  $appdataShareUsesSymlink = true;
} else {
  behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($appdataShareRoot), "Appdata share fixture root should be created.");
}
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($templatedOrphanPath), "Templated orphan fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($filesystemOrphanPath), "Filesystem orphan fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($liveAppPath), "Live app fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($nestedTemplatePath), "Nested template fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($slashLivePath), "Trailing-slash live path fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($vmDomainTemplatePath), "VM domains fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($vmIsosPath), "VM ISO fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($libvirtRoot), "Libvirt fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($recycleBinPath), "Recycle Bin fixture should be created.");
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($quarantinePath), "Quarantine fixture should be created.");
file_put_contents($vmConfigFixture, "DOMAINDIR=\"" . $vmDomainsPath . "/\"\nMEDIADIR=\"" . $vmIsosPath . "/\"\nIMAGE_FILE=\"" . $libvirtImagePath . "\"\n");
file_put_contents($dockerConfigFixture, "DOCKER_APP_CONFIG_PATH=\"" . $appdataShareRoot . "\"\n");
file_put_contents($shareConfigFixtureDir . "/" . $appdataShareName . ".cfg", "shareUseCache=\"yes\"\n");
behaviorSmokeWriteTemplateFixture($templateFixtureDir . "/templated-orphan.xml", "templated-orphan", $templatedOrphanPath, "/config");
behaviorSmokeWriteTemplateFixture($templateFixtureDir . "/nested-app.xml", "nested-app", $nestedTemplatePath, "/config");
behaviorSmokeWriteTemplateFixture($templateFixtureDir . "/adguard-workingdir.xml", "AdGuard", $slashTemplatePath, "/opt/adguardhome/work");
behaviorSmokeWriteTemplateFixture($templateFixtureDir . "/vm-template-managed.xml", "vm-template-managed", $vmDomainTemplatePath, "/config");
file_put_contents($libvirtImagePath, "libvirt-image");
file_put_contents($dockerClientFixture, "<?php\ntrigger_error('docker client fixture include warning', E_USER_WARNING);\nclass DockerClient {\n  public function getDockerContainers() {\n    trigger_error('docker client fixture query warning', E_USER_WARNING);\n    echo \"docker-fixture-noise\";\n    return array((object)array(\n      'Volumes' => array(\n        (object)array('Source' => '" . addslashes($liveAppPath) . "', 'Destination' => '/config'),\n        (object)array('Source' => '" . addslashes($slashLivePath) . "', 'Destination' => '/opt/adguardhome/work')\n      )\n    ));\n  }\n}\n");
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
$dashboardRows = isset($dashboard["payload"]["rows"]) && is_array($dashboard["payload"]["rows"]) ? $dashboard["payload"]["rows"] : array();
$templatedRow = behaviorSmokeFindRowByPath($dashboardRows, $templatedOrphanPath);
$filesystemRow = behaviorSmokeFindRowByPath($dashboardRows, $filesystemOrphanPath);
$liveRow = behaviorSmokeFindRowByPath($dashboardRows, $liveAppPath);
$nestedRootRow = behaviorSmokeFindRowByPath($dashboardRows, $nestedAppRoot);
$nestedTemplateRow = behaviorSmokeFindRowByPath($dashboardRows, $nestedTemplatePath);
$slashLiveRow = behaviorSmokeFindRowByPath($dashboardRows, $slashLivePath);
$vmDomainsRow = behaviorSmokeFindRowByPath($dashboardRows, $vmDomainsPath);
$vmTemplateRow = behaviorSmokeFindRowByPath($dashboardRows, $vmDomainTemplatePath);
$vmIsosRow = behaviorSmokeFindRowByPath($dashboardRows, $vmIsosPath);
$libvirtParentRow = behaviorSmokeFindRowByPath($dashboardRows, $libvirtParentPath);
$recycleBinRow = behaviorSmokeFindRowByPath($dashboardRows, $recycleBinPath);
$quarantineRow = behaviorSmokeFindRowByPath($dashboardRows, $quarantinePath);
behaviorSmokeAssertTrue(is_array($templatedRow), "Template-backed orphan should be detected.");
behaviorSmokeAssertTrue(is_array($filesystemRow), "Filesystem-only orphan should be detected.");
behaviorSmokeAssertSame(null, $liveRow, "Installed appdata paths should not be surfaced as orphaned.");
behaviorSmokeAssertSame(null, $nestedRootRow, "Top-level share folders containing a nested tracked path should not be duplicated as filesystem orphans.");
behaviorSmokeAssertTrue(is_array($nestedTemplateRow), "Nested template-backed orphan should still be surfaced.");
behaviorSmokeAssertSame(null, $slashLiveRow, "A trailing slash difference between a saved template path and a live mount should not create a false orphan.");
behaviorSmokeAssertSame(null, $vmDomainsRow, "VM Manager vdisk storage paths should be excluded from orphaned results.");
behaviorSmokeAssertSame(null, $vmTemplateRow, "Template-backed paths inside VM Manager storage should be excluded from orphaned results.");
behaviorSmokeAssertSame(null, $vmIsosRow, "VM Manager ISO storage paths should be excluded from orphaned results.");
behaviorSmokeAssertSame(null, $libvirtParentRow, "Parents containing the configured libvirt path should be excluded from orphaned results.");
behaviorSmokeAssertSame(null, $recycleBinRow, ".Recycle.Bin should be excluded from filesystem orphan discovery.");
behaviorSmokeAssertSame(null, $quarantineRow, "The plugin quarantine root should not be surfaced as a filesystem orphan.");
behaviorSmokeAssertSame("template", $templatedRow["sourceKind"], "Template-backed rows should preserve their source kind.");
behaviorSmokeAssertSame("filesystem", $filesystemRow["sourceKind"], "Filesystem-only rows should be marked as discovery candidates.");
behaviorSmokeAssertSame("Appdata share scan", $filesystemRow["sourceDisplay"], "Filesystem-only rows should explain their discovery source.");
behaviorSmokeAssertContains("Saved templates", $templatedRow["reason"], "Template-backed rows should explain their saved-template reference.");
behaviorSmokeAssertContains("no saved Docker template or installed container currently references it", $filesystemRow["reason"], "Filesystem-only rows should explain that they are unreferenced.");
behaviorSmokeAssertSame($slashLivePath, normalizeUserPath($slashTemplatePath), "Path normalization should collapse trailing slashes on saved template paths.");
behaviorSmokeAssertTrue(! empty($templatedRow["statsPending"]), "Initial dashboard rows should mark heavy stats as pending for progressive hydration.");
if ( $appdataShareUsesSymlink ) {
  behaviorSmokeAssertSame("", buildPathSecurityLockReason($templatedOrphanPath), "Configured appdata share root symlinks should not lock inside-share candidates.");
  behaviorSmokeAssertSame(false, ! empty($templatedRow["policyLocked"]), "Configured appdata share root symlinks should leave inside-share template rows actionable.");
  behaviorSmokeAssertSame(false, ! empty($filesystemRow["policyLocked"]), "Configured appdata share root symlinks should leave inside-share discovery rows actionable.");
}
$hydratedCandidate = resolveSnapshotCandidates($dashboard["payload"]["scanToken"], array($templatedRow["id"]));
behaviorSmokeAssertTrue(! empty($hydratedCandidate["ok"]), "Hydration should be able to resolve the initial snapshot candidate.");
$hydratedStatsRow = buildHydratedCandidateStatRow($hydratedCandidate["candidates"][0]);
behaviorSmokeAssertSame($templatedRow["id"], $hydratedStatsRow["id"], "Hydrated stats should map back to the original row id.");
behaviorSmokeAssertSame(false, ! empty($hydratedStatsRow["statsPending"]), "Hydrated rows should clear the pending-stats marker.");
behaviorSmokeAssertTrue($hydratedStatsRow["sizeLabel"] !== "Unknown", "Hydrated rows should populate a real size label.");

$vmManagerPaths = getAppdataCleanupPlusVmManagerManagedPaths();
behaviorSmokeAssertSame(3, count($vmManagerPaths), "VM Manager config should expose the configured vdisk, ISO, and libvirt paths.");
behaviorSmokeAssertContains("VM Manager vdisk storage path", buildPathSecurityLockReason($vmDomainsPath), "VM Manager vdisk storage should be safety-locked.");
behaviorSmokeAssertContains("VM Manager libvirt storage path", buildPathSecurityLockReason($libvirtParentPath), "Parents containing the configured libvirt path should be safety-locked.");
$vmActionResolution = resolveCandidateForAction(array(
  "path" => $vmDomainsPath,
  "displayPath" => $vmDomainsPath,
  "realPath" => (string)@realpath($vmDomainsPath)
), getAppdataCleanupPlusSafetySettings(), "quarantine");
behaviorSmokeAssertSame(false, $vmActionResolution["ok"], "VM Manager paths should be blocked at action time.");
behaviorSmokeAssertSame("blocked", $vmActionResolution["status"], "VM Manager action blocks should be reported as blocked.");
behaviorSmokeAssertContains("VM Manager vdisk storage path", $vmActionResolution["message"], "VM Manager action blocks should explain why the path is excluded.");

$symlinkTargetPath = $appdataShareRoot . "/symlink-target";
$symlinkLinkPath = $appdataShareRoot . "/symlink-link";
behaviorSmokeAssertTrue(ensureAppdataCleanupPlusDirectory($symlinkTargetPath . "/child"), "Symlink target fixture should be created.");
if ( function_exists("symlink") && @symlink($symlinkTargetPath, $symlinkLinkPath) ) {
  $symlinkReason = buildPathSecurityLockReason($symlinkLinkPath . "/child");
  behaviorSmokeAssertContains($symlinkLinkPath, $symlinkReason, "Symlink lock reasons should identify the exact offending path segment.");
}

behaviorSmokeRemoveTree($stateRoot);
behaviorSmokeRemoveTree($appdataShareRoot);
behaviorSmokeRemoveTree($appdataSharePhysicalRoot);
echo "behavior_smoke: OK" . PHP_EOL;
