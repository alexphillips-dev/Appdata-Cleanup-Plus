<?php
// A separate fixture process models a request that loses its client connection.
putenv("APPDATA_CLEANUP_PLUS_STATE_ROOT=" . $argv[1]);
$plugin = dirname(__DIR__) . "/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus/include/";
foreach (array("helpers.php", "pathUtils.php", "dashboard.php", "quarantine.php", "api.php") as $file) require_once $plugin . $file;
if ( ! acquireAppdataCleanupPlusRuntimeLock("cleanup-operation", array("action" => "executeCandidateAction")) ) exit(1);
appdataCleanupPlusInitializeOperationProgress("fixture-running", "quarantine", 2);
appdataCleanupPlusOperationProgressRecordResult("fixture-running", array("path" => "private-fixture-path", "status" => "quarantined", "message" => "Quarantined successfully."));
echo "ready\n";
flush();
fgets(STDIN);
// Intentionally leave running status to model an abrupt process stop. The OS
// releases the lock; a status reader must report interrupted without mutation.
releaseAllAppdataCleanupPlusRuntimeLocks();
