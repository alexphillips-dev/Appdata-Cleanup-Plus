<?php
// Every ordinary case stays in one unique temporary fixture. Absolute named
// pool writes additionally require the private-chroot marker and explicit opt-in.
if (PHP_OS_FAMILY === "Windows") { echo "audit_quarantine: SKIP (requires POSIX filesystem/process semantics)\n"; exit(0); }
date_default_timezone_set("UTC");
$root = sys_get_temp_dir() . "/acp-quarantine-" . bin2hex(random_bytes(8));
mkdir($root, 0700);
foreach (array("state", "source", "templates", "projects", "shares", "docker-runtime", "managed", "sessions", "bin") as $part) mkdir($root . "/" . $part, 0700);
foreach (array("STATE_ROOT" => "state", "RUNTIME_ROOT" => "runtime", "DOCKER_CONFIG_PATH" => "docker.cfg", "VM_CONFIG_PATH" => "vm.cfg", "DOCKER_RUNTIME_PATH" => "docker-runtime", "DOCKER_CLIENT_PATH" => "DockerClient.php", "DOCKER_TEMPLATE_DIR" => "templates", "COMPOSE_PROJECTS_DIR" => "projects", "SHARE_CONFIG_DIR" => "shares") as $key => $value) putenv("APPDATA_CLEANUP_PLUS_" . $key . "=" . $root . "/" . $value);
putenv("APPDATA_CLEANUP_PLUS_ZFS_CLIENT_COMMAND=/bin/false");
file_put_contents($root . "/docker.cfg", "DOCKER_IMAGE_FILE=\"" . $root . "/managed/docker.img\"\n");
file_put_contents($root . "/vm.cfg", "");
file_put_contents($root . "/docker.json", json_encode(array("verified" => true, "records" => array())));
file_put_contents($root . "/DockerClient.php", <<<'PHP'
<?php
class DockerClient {
  public function getDockerJSON($path, $method='GET', &$success=null, $callback=null, $unchunk=false) {
    if ($method !== 'GET') throw new RuntimeException('Fixture only supports read-only inventory.');
    $state = json_decode(file_get_contents(dirname(__FILE__) . '/docker.json'), true);
    $success = $state['verified'];
    if ($callback) $callback(json_encode($state['records']));
    return $state['records'];
  }
}
PHP
);
session_save_path($root . "/sessions");
$include = dirname(__DIR__) . "/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus/include/";
foreach (array("helpers.php", "pathUtils.php", "dashboard.php", "quarantine.php", "http.php", "api.php") as $file) require_once $include . $file;
$GLOBALS["APPDATA_CLEANUP_PLUS_TEST_MOUNT_POINTS"] = array();
function aqCheck($condition, $message) { if (!$condition) throw new RuntimeException($message); }
function aqRemove($path) {
  if (!file_exists($path) && !is_link($path)) return;
  if (is_link($path) || !is_dir($path)) { unlink($path); return; }
  foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST) as $item) {
    if ($item->isDir() && !$item->isLink()) rmdir($item->getPathname()); else unlink($item->getPathname());
  }
  rmdir($path);
}
function aqEntry($root, $name, $extra=array()) {
  $source = $root . "/source/" . $name;
  $qroot = $root . "/source/.appdata-cleanup-plus-quarantine";
  $destination = $qroot . "/20261101-120000/" . trim($source, "/");
  if (!is_dir($destination)) mkdir($destination, 0755, true);
  file_put_contents($destination . "/keep.txt", "synthetic-needed-data");
  $entry = normalizeAppdataCleanupPlusQuarantineRecord(array_merge(array("id" => $name, "sourcePath" => $source, "destination" => $destination, "quarantineRoot" => $qroot, "quarantinedAt" => date("c"), "purgeAt" => date("c", time() + 86400), "purgeScheduleSource" => "default"), $extra));
  aqCheck(registerAppdataCleanupPlusQuarantineRecord($entry), "Fixture registry write must succeed.");
  aqCheck(writeAppdataCleanupPlusQuarantineEntryMarker($entry), "Fixture marker write must succeed.");
  return $entry;
}
function aqStart($args) {
  $process = proc_open($args, array(1 => array("pipe", "w"), 2 => array("pipe", "w")), $pipes);
  aqCheck(is_resource($process), "Fixture subprocess must start.");
  $job = array($process, $pipes);
  $GLOBALS["aqJobs"][] = $job;
  return $job;
}
function aqFinish($job) {
  $stdout = stream_get_contents($job[1][1]); $stderr = stream_get_contents($job[1][2]);
  fclose($job[1][1]); fclose($job[1][2]);
  return array(proc_close($job[0]), $stdout, $stderr);
}
function aqListBarrier($root) {
  @unlink($root . "/du-ready"); @unlink($root . "/du-go");
  putenv("ACP_QUARANTINE_DELAY_DU=" . $root);
  $job = aqStart(array(PHP_BINARY, __DIR__ . "/audit_quarantine_worker.php", $root, "list"));
  putenv("ACP_QUARANTINE_DELAY_DU");
  $deadline = microtime(true) + 10;
  while (!is_file($root . "/du-ready") && microtime(true) < $deadline) usleep(10000);
  aqCheck(is_file($root . "/du-ready"), "Reader must reach the real delayed du command.");
  return $job;
}
function aqResume($root, $job) {
  file_put_contents($root . "/du-go", "go");
  $result = aqFinish($job);
  aqCheck($result[0] === 0, "Listing must complete: " . $result[2]);
}
$originalPath = getenv("PATH");
$namedPool = "";
try {
  $settings = normalizeAppdataCleanupPlusSafetySettings(array("manualAppdataSources" => array($root . "/source"), "defaultQuarantinePurgeDays" => 1));
  aqCheck(setAppdataCleanupPlusSafetySettings($settings), "Initial settings must save.");
  $custom = array_merge($settings, array("quarantineRoot" => $root . "/custom-quarantine", "defaultQuarantinePurgeDays" => 7,
    "zfsPathMappings" => array(array("shareRoot" => $root . "/source", "datasetRoot" => $root . "/dataset"))));
  setAppdataCleanupPlusSafetySettings($custom);
  $response = aqFinish(aqStart(array(PHP_BINARY, __DIR__ . "/audit_quarantine_worker.php", $root, "settings-patch", json_encode(array("enablePermanentDelete" => "1")))));
  $payload = json_decode($response[1], true);
  aqCheck(is_array($payload) && $payload["ok"] && $payload["settings"]["enablePermanentDelete"] && $payload["settings"]["manualAppdataSources"] === $custom["manualAppdataSources"] && $payload["settings"]["zfsPathMappings"] === $custom["zfsPathMappings"] && $payload["settings"]["quarantineRoot"] === $custom["quarantineRoot"] && $payload["settings"]["defaultQuarantinePurgeDays"] === 7, "A real mode-only API save must preserve unrelated saved configuration.");
  $response = aqFinish(aqStart(array(PHP_BINARY, __DIR__ . "/audit_quarantine_worker.php", $root, "settings-patch", json_encode(array("manualAppdataSources" => $root . "/source")))));
  $payload = json_decode($response[1], true);
  aqCheck(is_array($payload) && $payload["ok"] && $payload["settings"]["enablePermanentDelete"] && $payload["settings"]["zfsPathMappings"] === $custom["zfsPathMappings"], "A source-only API save must preserve omitted cleanup mode and mappings.");
  $beforeInvalidMapping = file_get_contents(appdataCleanupPlusSafetySettingsFile());
  $response = aqFinish(aqStart(array(PHP_BINARY, __DIR__ . "/audit_quarantine_worker.php", $root, "settings-patch", json_encode(array("zfsPathMappings" => json_encode(array(array("shareRoot" => $root . "/source", "datasetRoot" => $root . "/source/loop"))))))));
  $payload = json_decode($response[1], true);
  aqCheck(is_array($payload) && !$payload["ok"] && file_get_contents(appdataCleanupPlusSafetySettingsFile()) === $beforeInvalidMapping, "The actual settings handler must reject an expanding mapping graph before writing state.");
  setAppdataCleanupPlusSafetySettings($settings);
  $entry = aqEntry($root, "valid");
  $bad = $entry; $bad["destination"] = $root . "/unrelated";
  mkdir($bad["destination"]); file_put_contents($bad["destination"] . "/canary", "keep");
  registerAppdataCleanupPlusQuarantineRecord($bad);
  aqCheck(purgeTrackedQuarantineEntry($bad)["status"] === "blocked" && is_file($bad["destination"] . "/canary"), "AUD-04: out-of-root record must preserve unrelated data.");
  registerAppdataCleanupPlusQuarantineRecord($entry);
  $bad = $entry; $bad["destination"] = $entry["quarantineRoot"];
  registerAppdataCleanupPlusQuarantineRecord($bad);
  aqCheck(purgeTrackedQuarantineEntry($bad)["status"] === "blocked" && is_dir($entry["destination"]), "Quarantine root itself must never be purged.");
  registerAppdataCleanupPlusQuarantineRecord($entry);
  file_put_contents($root . "/docker.json", json_encode(array("verified" => true, "records" => array(array("Id" => "synthetic-owner", "Names" => array("/owner"), "Mounts" => array(array("Type" => "bind", "Source" => $entry["destination"], "Destination" => "/config")))))));
  aqCheck(purgeTrackedQuarantineEntry($entry)["status"] === "blocked" && is_file($entry["destination"] . "/keep.txt"), "AUD-04: newly specific Docker ownership must block purge.");
  file_put_contents($root . "/docker.json", json_encode(array("verified" => false, "records" => array())));
  aqCheck(purgeTrackedQuarantineEntry($entry)["status"] === "blocked", "Unknown Docker inventory must fail closed.");
  file_put_contents($root . "/docker.json", json_encode(array("verified" => true, "records" => array())));
  mkdir($root . "/projects/test");
  file_put_contents($root . "/projects/test/compose.yaml", "services:\n  owned:\n    volumes:\n      - " . $entry["destination"] . ":/config\n");
  aqCheck(purgeTrackedQuarantineEntry($entry)["status"] === "blocked", "Current Compose ownership must block purge.");
  aqRemove($root . "/projects/test");
  $managed = aqEntry($root, "managed");
  $managedRoot = $root . "/managed/.appdata-cleanup-plus-quarantine";
  $managedDestination = $managedRoot . "/20261101-120000/" . trim($managed["sourcePath"], "/");
  mkdir(dirname($managedDestination), 0755, true); rename($managed["destination"], $managedDestination);
  $managed["destination"] = $managedDestination; $managed["quarantineRoot"] = $managedRoot;
  registerAppdataCleanupPlusQuarantineRecord($managed); writeAppdataCleanupPlusQuarantineEntryMarker($managed);
  aqCheck(purgeTrackedQuarantineEntry($managed)["status"] === "blocked", "Canonical managed storage must not be purged.");
  $nested = $entry["destination"] . "/nested"; mkdir($nested);
  $GLOBALS["APPDATA_CLEANUP_PLUS_TEST_MOUNT_POINTS"] = array($nested => true);
  aqCheck(purgeTrackedQuarantineEntry($entry)["status"] === "error" && is_dir($nested), "Nested mounts retain native fail-closed behavior.");
  $GLOBALS["APPDATA_CLEANUP_PLUS_TEST_MOUNT_POINTS"] = array();
  rmdir($nested);
  aqCheck(purgeTrackedQuarantineEntry($entry)["status"] === "purged" && !is_dir($entry["destination"]), "Verified ordinary purge must still succeed.");
  $replacement = aqEntry($root, "replacement");
  rename($replacement["destination"], $replacement["destination"] . "-old");
  mkdir($replacement["destination"]); file_put_contents($replacement["destination"] . "/replacement-canary", "keep-replacement");
  aqCheck(purgeTrackedQuarantineEntry($replacement)["status"] === "blocked" && is_file($replacement["destination"] . "/replacement-canary"), "A replacement directory at the recorded path needs genuine matching provenance.");
  $mismatch = aqEntry($root, "mismatch");
  $marker = readAppdataCleanupPlusQuarantineEntryMarker($mismatch["destination"]); $marker["id"] = "different-entry";
  writeAppdataCleanupPlusJsonFile(appdataCleanupPlusQuarantineEntryMarkerFile($mismatch["destination"]), $marker);
  aqCheck(purgeTrackedQuarantineEntry($mismatch)["status"] === "blocked" && is_file($mismatch["destination"] . "/keep.txt"), "A marker belonging to another record must not authorize deletion.");
  $legacy = aqEntry($root, "legacy");
  $legacyRoot = $root . "/old-custom-quarantine";
  $legacy["sourcePath"] = "/mnt/user/appdata/legacy-review";
  $legacyDestination = $legacyRoot . "/20261101-120000/" . trim($legacy["sourcePath"], "/");
  mkdir(dirname($legacyDestination), 0755, true); rename($legacy["destination"], $legacyDestination);
  $legacy["destination"] = $legacyDestination; $legacy["quarantineRoot"] = $legacyRoot;
  deleteAppdataCleanupPlusQuarantineEntryMarker($legacyDestination);
  registerAppdataCleanupPlusQuarantineRecord($legacy);
  aqCheck(purgeTrackedQuarantineEntry($legacy)["status"] === "blocked", "An unverifiable legacy custom root must not become purge authority.");
  $legacyRows = array_values(array_filter(getActiveAppdataCleanupPlusQuarantineEntries(false, true), function($row) { return $row["id"] === "legacy"; }));
  aqCheck(count($legacyRows) === 1 && $legacyRows[0]["restoreStatus"] === "ready", "Legacy unmarked entries must remain visible and restorable when their original path is safe.");

  // AUD-05: deterministic real-process interleavings at the actual size command.
  file_put_contents($root . "/bin/du", <<<'SH'
#!/bin/sh
if [ -n "$ACP_QUARANTINE_DELAY_DU" ] && [ ! -f "$ACP_QUARANTINE_DELAY_DU/du-go" ]; then
  touch "$ACP_QUARANTINE_DELAY_DU/du-ready"
  i=0
  while [ ! -f "$ACP_QUARANTINE_DELAY_DU/du-go" ] && [ "$i" -lt 1000 ]; do sleep .01; i=$((i+1)); done
fi
exec /usr/bin/du "$@"
SH
  );
  chmod($root . "/bin/du", 0700); putenv("PATH=" . $root . "/bin:" . $originalPath);
  $entry = aqEntry($root, "race");
  aqCheck(acquireAppdataCleanupPlusRuntimeLock("cleanup-operation"), "Mutating request must own cleanup lock.");
  $job = aqListBarrier($root);
  aqCheck(updateTrackedQuarantinePurgeSchedule(array($entry), "clear")["summary"]["cleared"] === 1, "Timer cancellation must commit.");
  aqResume($root, $job);
  aqCheck(getAppdataCleanupPlusQuarantineRegistry()["race"]["purgeAt"] === "", "AUD-05: listing cannot rearm a cleared timer.");
  $job = aqListBarrier($root);
  $newTime = date("c", time() + 5 * 86400);
  updateTrackedQuarantinePurgeSchedule(array($entry), "set", 0, $newTime);
  $added = aqEntry($root, "concurrently-added");
  aqResume($root, $job);
  aqCheck(getAppdataCleanupPlusQuarantineRegistry()["race"]["purgeAt"] === $newTime && isset(getAppdataCleanupPlusQuarantineRegistry()["concurrently-added"]), "Listing must preserve newly set timers and new records.");
  $job = aqListBarrier($root);
  removeAppdataCleanupPlusQuarantineRecord("race"); aqRemove($entry["destination"]);
  aqResume($root, $job);
  aqCheck(!isset(getAppdataCleanupPlusQuarantineRegistry()["race"]), "Listing must not resurrect a removed/purged record.");
  releaseAllAppdataCleanupPlusRuntimeLocks();

  // AUD-06: stale marker dates never supply renewed deletion consent.
  $recovery = aqEntry($root, "recovery", array("purgeAt" => date("c", time() - 86400)));
  updateTrackedQuarantinePurgeSchedule(array($recovery), "clear");
  removeAppdataCleanupPlusQuarantineRecord("recovery");
  $recovered = recoverMissingAppdataCleanupPlusQuarantineRecords();
  aqCheck($recovered["recovery"]["purgeAt"] === "" && $recovered["recovery"]["recoveryOrigin"] === "marker", "AUD-06: stale cancelled marker timer must recover paused.");
  $recoveredAgain = recoverMissingAppdataCleanupPlusQuarantineRecords();
  aqCheck($recoveredAgain["recovery"]["purgeAt"] === "", "Repeated recovery must preserve paused consent.");
  syncTrackedQuarantineEntriesToDefaultPurgeSchedule(array_merge($settings, array("defaultQuarantinePurgeDays" => 2)), $settings);
  aqCheck(getAppdataCleanupPlusQuarantineRegistry()["recovery"]["purgeAt"] === "", "A global default cannot silently arm recovered data.");

  // AUD-07: actual writer-lock failure must survive reload and reach APIs.
  $fault = aqEntry($root, "fault");
  $legacyFault = aqEntry($root, "legacy-fault");
  mutateAppdataCleanupPlusQuarantineRegistry(function($registry) { unset($registry["legacy-fault"]["purgeScheduleSource"]); return $registry; });
  $manual = aqEntry($root, "manual", array("purgeScheduleSource" => "manual", "purgeAt" => date("c", time() + 9 * 86400)));
  $lock = appdataCleanupPlusJsonFileLockPath(appdataCleanupPlusQuarantineRegistryFile());
  unlink($lock); mkdir($lock);
  $result = updateTrackedQuarantinePurgeSchedule(array($fault), "clear");
  aqCheck($result["summary"]["errors"] === 1 && $result["summary"]["cleared"] === 0 && getAppdataCleanupPlusQuarantineRegistry()["fault"]["purgeAt"] === $fault["purgeAt"], "AUD-07: failed cancellation must not claim committed success.");
  $response = aqFinish(aqStart(array(PHP_BINARY, __DIR__ . "/audit_quarantine_worker.php", $root, "schedule", "fault")));
  $payload = json_decode($response[1], true);
  aqCheck(is_array($payload) && $payload["ok"] === false && $payload["summary"]["errors"] > 0, "Schedule API must expose persistence failure.");
  $response = aqFinish(aqStart(array(PHP_BINARY, __DIR__ . "/audit_quarantine_worker.php", $root, "settings", "0")));
  $payload = json_decode($response[1], true);
  aqCheck(is_array($payload) && $payload["ok"] === false && $payload["settings"]["defaultQuarantinePurgeDays"] === 0 && getAppdataCleanupPlusQuarantineRegistry()["fault"]["purgeAt"] === $fault["purgeAt"], "Settings API must expose saved-settings/failed-schedule partial state.");
  rmdir($lock);
  $response = aqFinish(aqStart(array(PHP_BINARY, __DIR__ . "/audit_quarantine_worker.php", $root, "settings", "0")));
  $payload = json_decode($response[1], true);
  aqCheck(is_array($payload) && $payload["ok"] && getAppdataCleanupPlusQuarantineRegistry()["fault"]["purgeAt"] === "", "Retrying the same saved default after repair must synchronize the actual existing timer.");
  aqCheck(getAppdataCleanupPlusQuarantineRegistry()["manual"]["purgeAt"] === $manual["purgeAt"] && getAppdataCleanupPlusQuarantineRegistry()["recovery"]["purgeAt"] === "", "Same-default retry preserves manual overrides and paused recovery consent.");
  $legacyPaused = getAppdataCleanupPlusQuarantineRegistry()["legacy-fault"];
  aqCheck($legacyPaused["purgeAt"] === "" && $legacyPaused["purgeScheduleSource"] === "manual" && $legacyPaused["purgeErrorMessage"] !== "", "Ambiguous armed legacy timer must be paused for review after a partial-save retry.");
  foreach (array("1.5", "0.5", "1x", "1e2", "-1", "3651", "INF") as $invalidDays) {
    $before = file_get_contents(appdataCleanupPlusSafetySettingsFile());
    $response = aqFinish(aqStart(array(PHP_BINARY, __DIR__ . "/audit_quarantine_worker.php", $root, "settings", $invalidDays)));
    $payload = json_decode($response[1], true);
    aqCheck(is_array($payload) && !$payload["ok"] && file_get_contents(appdataCleanupPlusSafetySettingsFile()) === $before, "The server must reject the whole invalid day value without changing state: " . $invalidDays);
  }
  $response = aqFinish(aqStart(array(PHP_BINARY, __DIR__ . "/audit_quarantine_worker.php", $root, "settings", "100")));
  $payload = json_decode($response[1], true);
  aqCheck(is_array($payload) && $payload["ok"] && $payload["settings"]["defaultQuarantinePurgeDays"] === 100 && getAppdataCleanupPlusQuarantineRegistry()["fault"]["purgeAt"] === buildAppdataCleanupPlusDefaultPurgeAtForTimestamp(array("defaultQuarantinePurgeDays" => 100), strtotime($fault["quarantinedAt"])), "Valid100-day retention must persist and schedule the full100days.");
  aqCheck(getAppdataCleanupPlusQuarantineRegistry()["legacy-fault"]["purgeAt"] === "" && getAppdataCleanupPlusQuarantineRegistry()["manual"]["purgeAt"] === $manual["purgeAt"], "A later global default must not arm paused legacy data or change explicit manual consent.");
  $journalSource = $root . "/source/journal-fault";
  mkdir($journalSource); file_put_contents($journalSource . "/keep.txt", "recoverable-journal-data");
  unlink($lock); mkdir($lock);
  $journal = executeCandidateOperation(array(array("path" => $journalSource, "realPath" => realpath($journalSource))), $settings, "quarantine");
  aqCheck($journal["summary"]["quarantined"] === 1 && $journal["summary"]["errors"] === 1 && $journal["results"][0]["metadataSaved"] === false && !is_dir($journalSource) && file_get_contents($journal["results"][0]["destination"] . "/keep.txt") === "recoverable-journal-data", "A real quarantine move with failed metadata must retain its performed-action count and data.");
  rmdir($lock);
  $recoveredJournal = array_values(array_filter(recoverMissingAppdataCleanupPlusQuarantineRecords(), function($row) use ($journalSource) { return $row["sourcePath"] === $journalSource; }));
  aqCheck(count($recoveredJournal) === 1 && $recoveredJournal[0]["purgeAt"] === "", "A metadata-fault move remains recoverable with purge paused.");
  $partial = aqEntry($root, "metadata-partial");
  unlink($lock); mkdir($lock);
  $partialResult = executeQuarantineManagerAction(array($partial), "purge");
  aqCheck($partialResult["summary"]["purged"] === 1 && $partialResult["summary"]["errors"] === 1 && $partialResult["results"][0]["metadataSaved"] === false && !is_dir($partial["destination"]), "Actual purge plus failed tracking save must report the performed action and partial failure.");
  rmdir($lock);
  $savedRegistry = file_get_contents(appdataCleanupPlusQuarantineRegistryFile());
  file_put_contents(appdataCleanupPlusQuarantineRegistryFile(), "{invalid");
  aqCheck(!mutateAppdataCleanupPlusQuarantineRegistry(function($registry) { return array(); }) && file_get_contents(appdataCleanupPlusQuarantineRegistryFile()) === "{invalid", "Corrupt state must never become assumed-empty committed state.");
  file_put_contents(appdataCleanupPlusQuarantineRegistryFile(), $savedRegistry);

  // Real CLI: unsafe recorded provenance reports failure and pauses the timer.
  $cli = aqEntry($root, "cli", array("purgeAt" => date("c", time() - 60)));
  $cli["destination"] = $root . "/unrelated"; registerAppdataCleanupPlusQuarantineRecord($cli);
  $worker = dirname(__DIR__) . "/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus/scripts/scheduled-purge.php";
  $response = aqFinish(aqStart(array(PHP_BINARY, $worker, "--json"))); $payload = json_decode($response[1], true);
  aqCheck($response[0] === 1 && is_array($payload) && $payload["ok"] === false && $payload["summary"]["blocked"] > 0 && is_file($root . "/unrelated/canary"), "CLI purge must report per-entry safety failures and preserve canaries.");
  aqCheck(getAppdataCleanupPlusQuarantineRegistry()["cli"]["purgeAt"] === "", "Failed CLI purge must pause its existing timer.");
  $cli["purgeAt"] = date("c", time() - 60); registerAppdataCleanupPlusQuarantineRecord($cli);
  unlink($lock); mkdir($lock);
  $response = aqFinish(aqStart(array(PHP_BINARY, $worker, "--json"))); $payload = json_decode($response[1], true);
  aqCheck($response[0] === 1 && $payload["summary"]["errors"] > 0 && getAppdataCleanupPlusQuarantineRegistry()["cli"]["purgeAt"] === $cli["purgeAt"], "CLI must report failed timer pausing instead of claiming it committed.");
  rmdir($lock);

  // Named pool acceptance is pure unless a verified private chroot opts in.
  aqCheck(buildRestorePathSecurityReason("/mnt/fcache/isolated-appdata/folder") === "", "AUD-11: a dedicated named-pool original target must pass the namespace check.");
  aqCheck(buildRestorePathSecurityReason("/mnt/fcache") !== "" && buildRestorePathSecurityReason("/mnt/fcache/share/../escape") !== "", "Mount roots and traversal remain blocked.");
  if (getenv("ACP_TEST_ISOLATED_MNT") === "1" && is_file("/.acp-private-audit-root") && !is_file("/etc/unraid-version")) {
    $namedPool = "/mnt/fcache/acp-audit-quarantine-" . bin2hex(random_bytes(8));
    mkdir($namedPool . "/appdata/folder", 0755, true);
    file_put_contents($namedPool . "/appdata/folder/keep.txt", "named-pool-data");
    $poolSettings = array_merge($settings, array("manualAppdataSources" => array($namedPool . "/appdata"), "defaultQuarantinePurgeDays" => 0));
    setAppdataCleanupPlusSafetySettings($poolSettings);
    $move = quarantineCandidatePath(array("name" => "named-pool"), $namedPool . "/appdata/folder", $poolSettings);
    aqCheck($move["ok"], "Named-pool quarantine must save both recovery records.");
    $poolEntries = array_values(array_filter(getAppdataCleanupPlusQuarantineRegistry(), function($row) use ($namedPool) { return $row["sourcePath"] === $namedPool . "/appdata/folder"; }));
    deleteAppdataCleanupPlusQuarantineEntryMarker($poolEntries[0]["destination"]);
    $restore = restoreTrackedQuarantineEntry($poolEntries[0]);
    aqCheck($restore["status"] === "restored" && $restore["metadataSaved"] && file_get_contents($namedPool . "/appdata/folder/keep.txt") === "named-pool-data", "AUD-11: quarantine/reload/restore, including unmarked legacy data, must preserve named-pool file bytes.");
    echo "audit_quarantine: named-pool roundtrip passed in marked private chroot\n";
  } else echo "audit_quarantine: SKIP named-pool filesystem roundtrip (private chroot opt-in required); pure namespace checks passed\n";
  echo "audit_quarantine: PASS (provenance, current ownership, concurrent listing, recovery consent, persistence faults, API and CLI)\n";
} finally {
  file_put_contents($root . "/du-go", "go");
  foreach (($GLOBALS["aqJobs"] ?? array()) as $job) if (is_resource($job[0])) aqFinish($job);
  releaseAllAppdataCleanupPlusRuntimeLocks();
  putenv("PATH=" . $originalPath);
  putenv("ACP_QUARANTINE_DELAY_DU");
  if ($namedPool !== "" && strpos($namedPool, "/mnt/fcache/acp-audit-quarantine-") === 0 && is_file("/.acp-private-audit-root")) aqRemove($namedPool);
  $cache = appdataCleanupPlusStatsCacheState(); $cache["dirty"] = false; appdataCleanupPlusStatsCacheState($cache, true);
  aqCheck(dirname(realpath($root)) === realpath(sys_get_temp_dir()) && strpos(basename($root), "acp-quarantine-") === 0, "Cleanup target must remain the unique private fixture.");
  aqRemove($root);
}
