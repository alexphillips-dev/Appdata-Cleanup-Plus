<?php

if ( PHP_SAPI !== "cli" ) {
  http_response_code(404);
  exit(1);
}

require_once(__DIR__ . "/../include/helpers.php");
require_once(__DIR__ . "/../include/pathUtils.php");
require_once(__DIR__ . "/../include/dashboard.php");
require_once(__DIR__ . "/../include/quarantine.php");

register_shutdown_function("releaseAllAppdataCleanupPlusRuntimeLocks");

$emitJson = in_array("--json", isset($argv) && is_array($argv) ? $argv : array(), true);
$response = array(
  "ok" => true,
  "status" => "complete",
  "summary" => buildQuarantineManagerActionSummary(array())
);

if ( ! acquireAppdataCleanupPlusRuntimeLock("cleanup-operation", array("action" => "scheduled-purge")) ) {
  $response["status"] = "skipped";
  $response["message"] = "Another cleanup operation is already running.";
  if ( $emitJson ) {
    echo appdataCleanupPlusJsonEncode($response) . PHP_EOL;
  }
  exit(0);
}

try {
  $execution = sweepExpiredAppdataCleanupPlusQuarantineEntries();
  $response["summary"] = isset($execution["summary"]) ? $execution["summary"] : $response["summary"];
} catch ( Throwable $exception ) {
  $response["ok"] = false;
  $response["status"] = "error";
  $response["message"] = "Scheduled quarantine purge failed.";
  error_log("Appdata Cleanup Plus scheduled purge failed: " . $exception->getMessage());
} finally {
  releaseAppdataCleanupPlusRuntimeLock("cleanup-operation");
}

if ( $emitJson ) {
  echo appdataCleanupPlusJsonEncode($response) . PHP_EOL;
}

exit($response["ok"] ? 0 : 1);
