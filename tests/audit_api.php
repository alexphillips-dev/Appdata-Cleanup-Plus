<?php
// No real host paths are mutated. All fixtures and worker arguments stay under
// one unique system-temp directory, including session files and private XML.
$root = str_replace("\\", "/", sys_get_temp_dir()) . "/acp-audit-api-" . bin2hex(random_bytes(8));
mkdir($root, 0700);
foreach (array("state", "sessions", "templates", "fixture-files") as $dir) mkdir($root . "/" . $dir, 0700);
putenv("APPDATA_CLEANUP_PLUS_STATE_ROOT=" . $root . "/state");
putenv("APPDATA_CLEANUP_PLUS_RUNTIME_ROOT=" . $root . "/runtime");
putenv("APPDATA_CLEANUP_PLUS_DOCKER_TEMPLATE_DIR=" . $root . "/templates");
putenv("APPDATA_CLEANUP_PLUS_DOCKER_RUNTIME_PATH=" . $root . "/docker-unavailable");
session_save_path($root . "/sessions");
$plugin = dirname(__DIR__) . "/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus/include/";
foreach (array("helpers.php", "pathUtils.php", "dashboard.php", "quarantine.php", "api.php", "fixtures.php", "templates.php") as $file) require_once $plugin . $file;
libxml_use_internal_errors(true);
function auditApiCheck($condition, $message) { if (!$condition) throw new RuntimeException($message); }
function auditApiStart($root, $mode, $extra="") {
  $pipes = array();
  $process = proc_open(array(PHP_BINARY, __DIR__ . "/audit_api_worker.php", $root, $mode, $extra), array(0 => array("pipe", "r"), 1 => array("pipe", "w"), 2 => array("pipe", "w")), $pipes);
  auditApiCheck(is_resource($process), "Synthetic worker starts.");
  stream_set_timeout($pipes[1], 5);
  return array("process" => $process, "pipes" => $pipes);
}
function auditApiFinish(&$worker) {
  if (is_resource($worker["pipes"][0])) fclose($worker["pipes"][0]);
  $output = stream_get_contents($worker["pipes"][1]);
  $error = stream_get_contents($worker["pipes"][2]);
  fclose($worker["pipes"][1]); fclose($worker["pipes"][2]);
  $exit = proc_close($worker["process"]);
  $worker = null;
  auditApiCheck($exit === 0, "Synthetic worker exits cleanly: " . $error);
  return $output;
}
$workers = array();
try {
  // AUD-12: matching checksums do not make malformed stored XML safe to install.
  $invalidBodies = array("not XML", '<!DOCTYPE Container><Container><Name>Synthetic</Name></Container>', '<!DOCTYPE Container [<!ENTITY secret SYSTEM "file:///synthetic-private">]><Container><Name>&secret;</Name></Container>', '<Container><Name></Name></Container>', "<Container><Name>\xff</Name></Container>");
  foreach ($invalidBodies as $index => $contents) {
    $id = str_pad(dechex($index + 1), 32, "0", STR_PAD_LEFT);
    $record = array("schemaVersion" => 1, "id" => $id, "filename" => "invalid-" . $index . ".xml", "name" => "Synthetic", "contents" => $contents, "sha256" => hash("sha256", $contents), "archivedAt" => date("c"));
    $file = appdataCleanupPlusTemplateBackupDir() . "/" . $id . ".json";
    // Invalid UTF-8 cannot be represented faithfully in JSON; exercise the
    // shared content boundary before any normal JSON writer substitutes bytes.
    if ($index === 4) {
      auditApiCheck(appdataCleanupPlusTemplateContents($contents) === null, "Invalid UTF-8 is rejected before installation.");
      continue;
    }
    auditApiCheck(writeAppdataCleanupPlusJsonFile($file, $record), "Invalid stored backup fixture is persisted.");
    auditApiCheck(appdataCleanupPlusTemplateBackup($id) !== null, "Invalid contents remain available for explicit private recovery/export.");
    auditApiCheck(!appdataCleanupPlusTemplateManagerAction("restore", $id)["ok"] && !file_exists($root . "/templates/" . $record["filename"]), "Rejected stored XML leaves no installed residue.");
    auditApiCheck(is_file($file) && appdataCleanupPlusExportTemplateBackups(array($id)) !== null, "Rejected backup remains retained/exportable.");
    $rows = array_column(appdataCleanupPlusTemplateManagerPayload()["backups"], null, "id");
    auditApiCheck(!$rows[$id]["canRestore"], "Known invalid XML is not offered as restorable.");
    auditApiCheck(appdataCleanupPlusRemoveTemplateBackups(array($id))["ok"], "Explicit removal can manage invalid-content backups.");
  }
  $xml = '<Container><Name>Synthetic valid template</Name><Config Type="Variable" Target="PASSWORD">synthetic-private</Config></Container>';
  $record = appdataCleanupPlusValidateImportedTemplateBackup(array("filename" => "valid.xml", "contents" => $xml, "sha256" => hash("sha256", $xml), "archivedAt" => date("c")));
  auditApiCheck($record && writeAppdataCleanupPlusJsonFile(appdataCleanupPlusTemplateBackupDir() . "/" . $record["id"] . ".json", $record), "Valid legacy-format backup remains accepted.");
  auditApiCheck(appdataCleanupPlusTemplateManagerAction("restore", $record["id"])["ok"] && file_get_contents($root . "/templates/valid.xml") === $xml, "Valid restore preserves exact bytes.");
  auditApiCheck(!appdataCleanupPlusTemplateManagerAction("restore", $record["id"])["ok"] && file_get_contents($root . "/templates/valid.xml") === $xml, "Existing targets remain collision-protected.");
  $owned = $root . "/templates/owned.xml";
  $handle = fopen($owned, "xb"); $ownedStat = fstat($handle); fclose($handle);
  auditApiCheck(appdataCleanupPlusRemoveCreatedTemplate($owned, $ownedStat) && !file_exists($owned), "Rollback removes its own exclusive target.");
  if (PHP_OS_FAMILY !== "Windows") {
    $handle = fopen($owned, "xb"); $ownedStat = fstat($handle);
    unlink($owned); file_put_contents($owned, "replacement");
    auditApiCheck(!appdataCleanupPlusRemoveCreatedTemplate($owned, $ownedStat) && file_get_contents($owned) === "replacement", "Rollback never unlinks another actor's replacement inode.");
    fclose($handle);
  }

  // AUD-19: all three fixture output names refuse existing linked inodes.
  foreach (array("README.txt", "template-fixture.txt", "appdata-cleanup-plus-fixture.xml") as $name) {
    $target = $root . "/fixture-files/" . $name;
    $canary = $root . "/canary-" . $name;
    file_put_contents($canary, "unchanged");
    if (PHP_OS_FAMILY !== "Windows") {
      auditApiCheck(link($canary, $target), "Hardlink negative-control fixture is created.");
      auditApiCheck(!appdataCleanupPlusWriteFixtureFile($target, "replacement") && file_get_contents($canary) === "unchanged", "Fixture writing refuses hardlinks and preserves external bytes.");
      unlink($target);
      auditApiCheck(symlink($canary, $target), "Symlink negative-control fixture is created.");
      auditApiCheck(!appdataCleanupPlusWriteFixtureFile($target, "replacement") && file_get_contents($canary) === "unchanged", "Fixture writing preserves symlink targets.");
      unlink($target);
    }
    auditApiCheck(appdataCleanupPlusWriteFixtureFile($target, "first") && appdataCleanupPlusWriteFixtureFile($target, "second") && file_get_contents($target) === "second", "Ordinary fixture creation and replacement stay repeatable.");
    auditApiCheck(file_get_contents($canary) === "unchanged" && !glob($root . "/fixture-files/.acp-fixture-*.tmp"), "No external bytes or temporary residue change.");
  }
  // Full fixture actions require /mnt paths. Run this extra round trip only in
  // the explicitly marked private chroot, never against a developer's /mnt.
  if (PHP_OS_FAMILY === "Linux" && is_file("/.acp-private-audit-root") && posix_geteuid() === 0) {
    $fixtureRoot = "/mnt/user/acp-audit-api-" . bin2hex(random_bytes(8));
    mkdir($fixtureRoot, 0700);
    $fixtureSettings = array_merge(getDefaultAppdataCleanupPlusSafetySettings(), array("manualAppdataSources" => array($fixtureRoot)));
    auditApiCheck(appdataCleanupPlusCreateTestFixtures($fixtureSettings)["ok"], "Full fixture creation supports ordinary isolated sources.");
    $outputs = array($fixtureRoot . "/acp-test-folder/README.txt", $fixtureRoot . "/acp-test-template/template-fixture.txt", appdataCleanupPlusFixtureTemplatePath());
    foreach ($outputs as $index => $output) {
      $canary = $root . "/action-canary-" . $index;
      file_put_contents($canary, "unchanged");
      unlink($output); auditApiCheck(link($canary, $output), "Full-action hardlink fixture is created.");
      auditApiCheck(!appdataCleanupPlusCreateTestFixtures($fixtureSettings)["ok"] && file_get_contents($canary) === "unchanged", "Actual fixture creation preserves every hardlinked external canary.");
      unlink($output);
      auditApiCheck(appdataCleanupPlusCreateTestFixtures($fixtureSettings)["ok"], "Fixture action recovers after removing the unsafe entry.");
    }
    auditApiCheck(appdataCleanupPlusRemoveTestFixtures($fixtureSettings)["ok"] && is_dir($fixtureRoot), "Fixture removal preserves its isolated source.");
    rmdir($fixtureRoot); $fixtureRoot = null;
  }

  // AUD-13: keep verified scope identity without reacquiring the session lock.
  $workers["fresh"] = auditApiStart($root, "session-fresh");
  $fresh = json_decode(auditApiFinish($workers["fresh"]), true);
  auditApiCheck(!empty($fresh["valid"]), "Fresh CLI scope initialization creates a valid snapshot and preserves its closed session identity.");
  session_id("acp-audit-api-primary"); session_start();
  $csrf = getAppdataCleanupPlusCsrfToken();
  $snapshot = writeAppdataCleanupPlusSnapshot(array("synthetic" => array("id" => "synthetic", "path" => "/synthetic")));
  $scope = appdataCleanupPlusSnapshotScopeKey();
  auditApiCheck(closeAppdataCleanupPlusSession(), "Session closes after validation.");
  auditApiCheck(resolveSnapshotCandidates($snapshot["token"], array("synthetic"))["ok"] && session_status() === PHP_SESSION_NONE, "Resolving after close does not restart the session.");
  auditApiCheck(appdataCleanupPlusSnapshotScopeKey() === $scope && appdataCleanupPlusDiagnosticsCurrentSnapshot($snapshot["token"])["status"] === "valid" && session_status() === PHP_SESSION_NONE, "Diagnostics reuse the verified closed-session scope without reopening.");
  session_id("acp-audit-api-other"); session_start();
  auditApiCheck(!validateAppdataCleanupPlusCsrfToken($csrf) && getValidatedAppdataCleanupPlusSnapshot($snapshot["token"]) === null, "Other sessions cannot reuse CSRF or snapshot authority.");
  closeAppdataCleanupPlusSession();
  session_id("acp-audit-api-primary"); session_start();
  auditApiCheck(validateAppdataCleanupPlusCsrfToken($csrf), "Original session keeps its CSRF identity.");
  closeAppdataCleanupPlusSession();
  $workers["session"] = auditApiStart($root, "session-hold");
  $ready = json_decode(fgets($workers["session"]["pipes"][1]), true);
  auditApiCheck(!empty($ready["ready"]) && !empty($ready["closed"]), "Long synthetic request releases session after resolving a candidate.");
  $workers["poll"] = auditApiStart($root, "session-poll", $ready["csrf"]);
  stream_set_blocking($workers["poll"]["pipes"][1], false);
  $pollOutput = ""; $deadline = microtime(true) + 3;
  while (microtime(true) < $deadline && strpos($pollOutput, "\n") === false) { $pollOutput .= stream_get_contents($workers["poll"]["pipes"][1]); usleep(10000); }
  auditApiCheck(strpos($pollOutput, "\n") !== false, "Same-session polling completes while original request stays alive.");
  $poll = json_decode($pollOutput, true);
  auditApiCheck(!empty($poll["valid"]) && $poll["scope"] === $ready["scope"], "Concurrent poll preserves CSRF and exact session scope.");
  stream_set_blocking($workers["poll"]["pipes"][1], true); auditApiFinish($workers["poll"]);
  fwrite($workers["session"]["pipes"][0], "stop\n"); auditApiFinish($workers["session"]);

  // AUD-20: modern expiry has constant lock count and removes empty scopes.
  for ($i = 0; $i < 40; $i++) {
    $file = appdataCleanupPlusSnapshotStorageDir() . "/expired-" . $i . "/scan.json";
    auditApiCheck(writeAppdataCleanupPlusJsonFile($file, array("expiresAt" => date("c", time() - 60))), "Synthetic expired snapshot is written.");
    auditApiCheck(!file_exists($file . ".lock"), "New snapshot writes do not allocate per-file locks.");
  }
  cleanupExpiredAppdataCleanupPlusSnapshots();
  auditApiCheck(!glob(appdataCleanupPlusSnapshotStorageDir() . "/expired-*"), "Expired modern scopes leave no directories or lock debris.");
  $legacy = appdataCleanupPlusSnapshotStorageDir() . "/legacy/old.json";
  mkdir(dirname($legacy), 0700);
  file_put_contents($legacy, '{"expiresAt":"2000-01-01T00:00:00Z"}');
  $legacyHandle = fopen($legacy . ".lock", "c+"); flock($legacyHandle, LOCK_EX); $legacyStat = fstat($legacyHandle);
  cleanupExpiredAppdataCleanupPlusSnapshots();
  clearstatcache();
  auditApiCheck(!is_file($legacy) && is_file($legacy . ".lock") && stat($legacy . ".lock")["ino"] === $legacyStat["ino"], "Expiry never unlinks a historical lock inode.");
  flock($legacyHandle, LOCK_UN); fclose($legacyHandle);
  cleanupExpiredAppdataCleanupPlusSnapshots();
  auditApiCheck(is_file($legacy . ".lock"), "Quiescent historical locks also remain for safe cross-version compatibility.");
  $raceFile = appdataCleanupPlusSnapshotStorageDir() . "/race/new.json";
  $namespaceLock = appdataCleanupPlusOpenJsonFileLock($raceFile);
  $workers["write"] = auditApiStart($root, "snapshot-write");
  $workers["cleanup"] = auditApiStart($root, "snapshot-cleanup");
  foreach (array("write", "cleanup") as $key) auditApiCheck(trim(fgets($workers[$key]["pipes"][1])) === "ready", "Concurrent snapshot worker reaches namespace barrier.");
  usleep(100000);
  foreach (array("write", "cleanup") as $key) auditApiCheck(proc_get_status($workers[$key]["process"])["running"], "Writer and cleanup both wait on the shared namespace lock.");
  appdataCleanupPlusCloseJsonFileLock($namespaceLock); $namespaceLock = null;
  auditApiFinish($workers["write"]); auditApiFinish($workers["cleanup"]);
  auditApiCheck(readAppdataCleanupPlusJsonFile($raceFile)["candidates"]["synthetic"]["id"] === "synthetic", "Concurrent expiry preserves a complete new future snapshot.");
  auditApiCheck(mutateAppdataCleanupPlusJsonFile($raceFile, array(), function($value) { $value["updated"] = true; return $value; }) && !file_exists($raceFile . ".lock"), "Generic snapshot mutation shares the namespace without new lock growth.");
  auditApiCheck(is_file(appdataCleanupPlusStateFile("snapshots.lock")), "Shared namespace lock remains stable outside removable scopes.");

  // AUD-09: explicit instants remain identical in every server timezone.
  foreach (array("UTC", "America/New_York", "Pacific/Auckland") as $zone) {
    date_default_timezone_set($zone);
    foreach (array("2030-06-01T16:00:00.000Z", "2030-06-01T12:00:00-04:00", "2030-06-02T04:00:00+12:00") as $instant) auditApiCheck(strtotime(normalizeAppdataCleanupPlusQuarantinePurgeAt($instant)) === 1906560000, "Explicit purge instants are independent of server timezone.");
    $dstInstants = array(
      "2035-03-11T01:30:00-05:00" => "2035-03-11T06:30:00Z",
      "2035-03-11T03:30:00-04:00" => "2035-03-11T07:30:00Z",
      "2035-11-04T01:30:00-04:00" => "2035-11-04T05:30:00Z",
      "2035-11-04T01:30:00-05:00" => "2035-11-04T06:30:00Z",
      "2035-11-04T02:30:00-05:00" => "2035-11-04T07:30:00Z"
    );
    foreach ($dstInstants as $instant => $expectedUtc) {
      $normalized = normalizeAppdataCleanupPlusQuarantinePurgeAt($instant);
      auditApiCheck($normalized !== "" && gmdate("Y-m-d\\TH:i:s\\Z", strtotime($normalized)) === $expectedUtc, "Explicit offsets preserve exact spring/fall DST instants across server zones.");
    }
    auditApiCheck(normalizeAppdataCleanupPlusQuarantinePurgeAt("not a date") === "" && normalizeAppdataCleanupPlusQuarantinePurgeAt("") === "", "Invalid or absent purge timestamps remain rejected.");
    auditApiCheck(normalizeAppdataCleanupPlusQuarantinePurgeAt("2030-06-01T12:00") !== "", "Legacy offsetless persisted timestamps remain readable.");
  }
  echo "audit_api: OK (XML preflight/rollback, fixture links, concurrent session release, bounded snapshot locks/expiry, timestamp instants)\n";
} finally {
  if (isset($namespaceLock) && is_resource($namespaceLock)) appdataCleanupPlusCloseJsonFileLock($namespaceLock);
  foreach ($workers as &$worker) {
    if (!is_array($worker)) continue;
    if (is_resource($worker["process"])) proc_terminate($worker["process"]);
    foreach ($worker["pipes"] as $pipe) if (is_resource($pipe)) fclose($pipe);
    if (is_resource($worker["process"])) proc_close($worker["process"]);
  }
  unset($worker);
  if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
  if (isset($fixtureRoot) && is_file("/.acp-private-audit-root") && dirname($fixtureRoot) === "/mnt/user" && str_starts_with(basename($fixtureRoot), "acp-audit-api-")) {
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($fixtureRoot, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST) as $entry) {
      if ($entry->isDir() && !$entry->isLink()) rmdir($entry->getPathname()); else unlink($entry->getPathname());
    }
    rmdir($fixtureRoot);
  }
  $real = realpath($root);
  if ($real && dirname($real) === realpath(sys_get_temp_dir()) && str_starts_with(basename($real), "acp-audit-api-")) {
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($real, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST) as $entry) {
      if ($entry->isDir() && !$entry->isLink()) rmdir($entry->getPathname()); else unlink($entry->getPathname());
    }
    rmdir($real);
  }
}
