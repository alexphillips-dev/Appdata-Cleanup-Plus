<?php
// A separate fixture process models a request that loses its client connection.
putenv("APPDATA_CLEANUP_PLUS_STATE_ROOT=" . $argv[1]);
$plugin = dirname(__DIR__) . "/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus/include/";
foreach (array("helpers.php", "pathUtils.php", "dashboard.php", "quarantine.php", "api.php") as $file) require_once $plugin . $file;
if ( ! acquireAppdataCleanupPlusRuntimeLock("cleanup-operation", array("action" => "executeCandidateAction")) ) exit(1);
$mode = $argv[2] ?? "";
if ( in_array($mode, array("candidate-warning", "restore-warning", "purge-clean"), true) ) {
  require_once $plugin . "http.php";
  register_shutdown_function("releaseAllAppdataCleanupPlusRuntimeLocks");
  $_POST = array("operationProgressId" => $mode);
  if ( $mode === "candidate-warning" ) {
    ensureAppdataCleanupPlusDirectory($argv[1] . "/sessions");
    session_save_path($argv[1] . "/sessions");
    session_id("acp-recovery-warning");
    session_start();
    $snapshot = writeAppdataCleanupPlusSnapshot(array("blocked-fixture" => array("path" => "/mnt/user/appdata/fixture", "displayPath" => "/mnt/user/appdata/fixture", "ignored" => true)));
    $_POST += array("scanToken" => $snapshot["token"], "candidateIds" => '["blocked-fixture"]', "operation" => "quarantine");
    handleExecuteCandidateAction();
  }
  $destination = $argv[1] . "/guarded-folder";
  ensureAppdataCleanupPlusDirectory($destination);
  registerAppdataCleanupPlusQuarantineRecord(array("id" => "guarded-entry", "name" => "Guarded fixture", "sourcePath" => "/", "destination" => $destination, "quarantineRoot" => $argv[1] . "/quarantine", "quarantinedAt" => date("c")));
  $_POST += array("entryIds" => '["guarded-entry"]', "managerAction" => $mode === "restore-warning" ? "restore" : "purge");
  handleQuarantineManagerAction();
}
appdataCleanupPlusInitializeOperationProgress("fixture-running", "quarantine", 2);
appdataCleanupPlusOperationProgressRecordResult("fixture-running", array("path" => "private-fixture-path", "status" => "quarantined", "message" => "Quarantined successfully."));
echo "ready\n";
flush();
fgets(STDIN);
// Intentionally leave running status to model an abrupt process stop. The OS
// releases the lock; a status reader must report interrupted without mutation.
releaseAllAppdataCleanupPlusRuntimeLocks();
