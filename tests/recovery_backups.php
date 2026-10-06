<?php
$root = str_replace("\\", "/", sys_get_temp_dir()) . "/acp-recovery-" . bin2hex(random_bytes(8));
mkdir($root, 0700, true);
putenv("APPDATA_CLEANUP_PLUS_STATE_ROOT=" . $root);
putenv("APPDATA_CLEANUP_PLUS_DOCKER_TEMPLATE_DIR=" . $root . "/templates");
$plugin = dirname(__DIR__) . "/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus/include/";
foreach (array("helpers.php", "pathUtils.php", "dashboard.php", "quarantine.php", "api.php", "templates.php") as $file) require_once $plugin . $file;
function recoveryCheck($condition, $message) { if (!$condition) throw new RuntimeException($message); }
try {
  $worker = proc_open(array(PHP_BINARY, __DIR__ . "/recovery_worker.php", $root), array(0 => array("pipe", "r"), 1 => array("pipe", "w"), 2 => array("pipe", "w")), $pipes);
  recoveryCheck(is_resource($worker) && trim(fgets($pipes[1])) === "ready", "Worker must initialize its locked operation.");
  $before = file_get_contents(appdataCleanupPlusOperationProgressFile("fixture-running"));
  $recent = appdataCleanupPlusRecentOperations();
  recoveryCheck($recent[0]["status"] === "running" && !isset($recent[0]["results"]), "A fresh page discovers active status with no raw result payload in the list: " . json_encode(appdataCleanupPlusInspectRuntimeLockFile(appdataCleanupPlusRuntimeLockFile("cleanup-operation"))));
  recoveryCheck(file_get_contents(appdataCleanupPlusOperationProgressFile("fixture-running")) === $before, "Status discovery must not mutate operation files.");
  fwrite($pipes[0], "stop\n"); fclose($pipes[0]);
  $error = stream_get_contents($pipes[2]); fclose($pipes[1]); fclose($pipes[2]);
  recoveryCheck(proc_close($worker) === 0, "Worker exits cleanly: " . $error);
  recoveryCheck(appdataCleanupPlusInspectRuntimeLockFile(appdataCleanupPlusRuntimeLockFile("cleanup-operation"))["metadata"]["action"] === "executeCandidateAction", "Tracking must preserve the action metadata used by diagnostics.");
  $recovered = appdataCleanupPlusRecoverOperationProgress(appdataCleanupPlusReadOperationProgress("fixture-running"));
  recoveryCheck($recovered["status"] === "interrupted" && count($recovered["results"]) === 1, "A dropped request retains partial results and reports uncertainty.");
  recoveryCheck($recovered["summary"]["quarantined"] === 1, "Interrupted summaries must reflect work already completed.");
  recoveryCheck(file_get_contents(appdataCleanupPlusOperationProgressFile("fixture-running")) === $before, "Interrupted status is read-only.");
  recoveryCheck(acquireAppdataCleanupPlusRuntimeLock("cleanup-operation"), "A new request acquires the cleanup lock.");
  recoveryCheck(appdataCleanupPlusInitializeOperationProgress("fixture-complete", "restore", 1) !== "", "New operation initializes.");
  recoveryCheck(appdataCleanupPlusRecoverOperationProgress(appdataCleanupPlusReadOperationProgress("fixture-running"))["status"] === "interrupted", "Another active operation must not resurrect an old running record.");
  appdataCleanupPlusOperationProgressRecordResult("fixture-complete", array("status" => "restored", "message" => "Restored to the original location."));
  appdataCleanupPlusFinalizeOperationProgress("fixture-complete", "complete", "Cleanup finished.", array("restored" => 1));
  recoveryCheck(appdataCleanupPlusInitializeOperationProgress("fixture-complete", "delete", 1) === "", "Duplicate IDs must not replay an operation or overwrite its results.");
  appdataCleanupPlusUpdateOperationProgress("fixture-complete", array("acknowledged" => true));
  recoveryCheck(count(appdataCleanupPlusRecentOperations()) === 1 && count(appdataCleanupPlusReadOperationProgress("fixture-complete")["results"]) === 1, "Dismissal hides reminders and retains evidence.");
  recoveryCheck(appdataCleanupPlusOperationProgressId("../../escape") === "", "Path-like operation IDs are rejected.");
  appdataCleanupPlusInitializeOperationProgress("fixture-shutdown", "purge", 1);
  appdataCleanupPlusInterruptActiveOperation();
  recoveryCheck(appdataCleanupPlusReadOperationProgress("fixture-shutdown")["status"] === "interrupted", "Shutdown persists interruption without repeating an action.");
  releaseAllAppdataCleanupPlusRuntimeLocks();

  for ($i = 0; $i < 105; $i++) appdataCleanupPlusInitializeOperationProgress("bounded-" . $i, "delete", 1);
  recoveryCheck(count(glob(appdataCleanupPlusOperationProgressDir() . "/*.json")) <= 100 && appdataCleanupPlusReadOperationProgress("bounded-104"), "Retention stays bounded and keeps the newly active operation.");
  $expiredFile = appdataCleanupPlusOperationProgressFile("expired-fixture");
  appdataCleanupPlusWriteOperationProgress("expired-fixture", array("id" => "expired-fixture", "status" => "complete", "startedAt" => date("c", time() - 90000), "updatedAt" => date("c", time() - 90000)));
  touch($expiredFile, time() - 90000);clearstatcache();
  appdataCleanupPlusPruneOperationProgress("bounded-104");
  recoveryCheck(!is_file($expiredFile), "Expired progress records are pruned during new operations, not status reads.");

  mkdir($root . "/templates");
  $xml = '<Container><Name>Private fixture</Name><Config Type="Variable" Target="PASSWORD">private-backup-canary</Config></Container>';
  $record = array("filename" => "my-fixture.xml", "contents" => $xml, "sha256" => hash("sha256", $xml), "archivedAt" => date("c"));
  $archive = array("format" => "appdata-cleanup-plus-template-backups", "schemaVersion" => 1, "backups" => array($record));
  $archive["sha256"] = hash("sha256", appdataCleanupPlusJsonEncode($archive["backups"]));
  recoveryCheck(appdataCleanupPlusImportTemplateBackups(appdataCleanupPlusJsonEncode($archive))["ok"], "Verified private backup imports.");
  recoveryCheck(!file_exists($root . "/templates/my-fixture.xml"), "Import cannot restore or overwrite installed templates.");
  $files = glob(appdataCleanupPlusTemplateBackupDir() . "/*.json");
  $id = basename($files[0], ".json");
  recoveryCheck(appdataCleanupPlusImportTemplateBackups(appdataCleanupPlusJsonEncode($archive))["ok"] && count(glob(appdataCleanupPlusTemplateBackupDir() . "/*.json")) === 1, "Import is deduplicated by filename and exact content hash.");
  $export = appdataCleanupPlusExportTemplateBackups(array($id));
  recoveryCheck($export["backups"][0]["contents"] === $xml && !isset($export["backups"][0]["id"]), "Explicit private export preserves exact bytes and omits local IDs.");
  recoveryCheck(acpLocalizeResponse(array("backupArchive" => $export))["backupArchive"] === $export, "Presentation must never translate private archive contents.");
  $broken = $archive; $broken["backups"][0]["contents"] .= "corrupt";
  recoveryCheck(!appdataCleanupPlusImportTemplateBackups(appdataCleanupPlusJsonEncode($broken))["ok"], "Corrupted archive checksum is refused.");
  foreach (array("../escape.xml", "..\\escape.xml", "/absolute.xml", "C:escape.xml", "bad\nname.xml") as $filename) {
    $broken = $archive; $broken["backups"][0]["filename"] = $filename;
    $broken["sha256"] = hash("sha256", appdataCleanupPlusJsonEncode($broken["backups"]));
    recoveryCheck(!appdataCleanupPlusImportTemplateBackups(appdataCleanupPlusJsonEncode($broken))["ok"], "Traversal/control filename must be refused.");
  }
  foreach (array('<!DOCTYPE Container [<!ENTITY secret SYSTEM "file:///private-fixture">]><Container><Name>&secret;</Name></Container>', "not XML", "<Container><Name></Name></Container>") as $bytes) {
    $broken = $record; $broken["contents"] = $bytes; $broken["sha256"] = hash("sha256", $bytes);
    recoveryCheck(appdataCleanupPlusValidateImportedTemplateBackup($broken) === null, "Unsafe or malformed XML must be rejected even with valid checksums.");
  }
  $broken = $archive; $broken["backups"][] = array("invalid" => true);
  $broken["sha256"] = hash("sha256", appdataCleanupPlusJsonEncode($broken["backups"]));
  recoveryCheck(!appdataCleanupPlusImportTemplateBackups(appdataCleanupPlusJsonEncode($broken))["ok"] && count(glob(appdataCleanupPlusTemplateBackupDir() . "/*.json")) === 1, "Invalid later records cannot produce a partial validation import.");
  recoveryCheck(strpos(json_encode(buildAppdataCleanupPlusDiagnosticsBundle()), "private-backup-canary") === false, "Private exports and operation records stay outside diagnostics.");
  $publicBundle = json_encode(buildAppdataCleanupPlusDiagnosticsBundle());
  recoveryCheck(strpos($publicBundle, "Private fixture") === false && strpos($publicBundle, "my-fixture.xml") === false && strpos($publicBundle, $id) === false, "Private backup names, filenames and IDs must stay outside public diagnostics.");
  recoveryCheck(appdataCleanupPlusTemplateManagerAction("restore", $id)["ok"] && file_get_contents($root . "/templates/my-fixture.xml") === $xml, "Imported backup uses normal collision-safe restore.");
  recoveryCheck(!appdataCleanupPlusTemplateManagerAction("restore", $id)["ok"], "Imported backup cannot overwrite an existing template.");
  recoveryCheck(!appdataCleanupPlusRemoveTemplateBackups(array("../../escape"))["ok"], "Removal accepts only validated stored backup IDs.");
  recoveryCheck(appdataCleanupPlusRemoveTemplateBackups(array($id))["ok"] && file_get_contents($root . "/templates/my-fixture.xml") === $xml, "Explicit backup removal retains restored templates.");
  $history = buildAuditHistoryRows();
  recoveryCheck($history[0]["operationLabel"] === "Template backup removal" && $history[0]["completedCount"] === 1 && $history[0]["summary"]["removed"] === 1, "Backup removal history uses its own label and completion count.");
  recoveryCheck(strpos($history[0]["message"], "template backup was removed") !== false, "Backup history must describe recovery copies, not folder deletion or no changes.");
  $manifest = file_get_contents(dirname(__DIR__) . "/plugins/appdata.cleanup.plus.plg");
  $remove = substr($manifest, strpos($manifest, '<FILE Run="/bin/bash" Method="remove">'));
  recoveryCheck(strpos($remove, 'rm -rf /boot/config/plugins/') === false && strpos($remove, 'rm -rf &plugdir;') !== false, "Uninstall retains private recovery state while removing installed plugin code.");
  echo "recovery_backups: OK (cross-process recovery, partial outcomes, duplicate IDs, retention, private export/import, integrity, unsafe XML, collision and removal safety)\n";
} finally {
  if (isset($worker) && is_resource($worker)) {
    if (isset($pipes[0]) && is_resource($pipes[0])) { fwrite($pipes[0], "stop\n"); fclose($pipes[0]); }
    foreach (array(1, 2) as $index) if (isset($pipes[$index]) && is_resource($pipes[$index])) fclose($pipes[$index]);
    proc_close($worker);
  }
  releaseAllAppdataCleanupPlusRuntimeLocks();
  $real = realpath($root);
  if ($real && dirname($real) === realpath(sys_get_temp_dir()) && str_starts_with(basename($real), "acp-recovery-")) {
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($real, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST) as $entry) {
      if ($entry->isDir() && !$entry->isLink()) rmdir($entry->getPathname()); else unlink($entry->getPathname());
    }
    rmdir($real);
  }
}
