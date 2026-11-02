<?php
// Workers operate only inside the unique system-temp fixture created by audit_api.
$root = realpath($argv[1] ?? "");
if (!$root || dirname($root) !== realpath(sys_get_temp_dir()) || !str_starts_with(basename($root), "acp-audit-api-")) exit(2);
$mode = $argv[2] ?? "";
if (!in_array($mode, array("session-fresh", "session-hold", "session-poll", "snapshot-write", "snapshot-cleanup"), true)) exit(2);
putenv("APPDATA_CLEANUP_PLUS_STATE_ROOT=" . $root . "/state");
putenv("APPDATA_CLEANUP_PLUS_RUNTIME_ROOT=" . $root . "/runtime");
session_save_path($root . "/sessions");
$plugin = dirname(__DIR__) . "/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus/include/";
foreach (array("helpers.php", "pathUtils.php", "dashboard.php", "quarantine.php", "api.php") as $file) require_once $plugin . $file;
if ($mode === "session-fresh") {
  $initiallyEmpty = session_id() === "" && session_status() === PHP_SESSION_NONE;
  $scope = appdataCleanupPlusSnapshotScopeKey();
  $validScope = $scope !== "" && $scope === hash("sha256", session_id());
  $snapshot = writeAppdataCleanupPlusSnapshot(array("synthetic" => array("id" => "synthetic")));
  closeAppdataCleanupPlusSession();
  $valid = $initiallyEmpty && $validScope && $snapshot && $snapshot["scope"] === $scope && getValidatedAppdataCleanupPlusSnapshot($snapshot["token"]) !== null && session_status() === PHP_SESSION_NONE;
  echo json_encode(array("valid" => $valid)) . "\n";
  exit($valid ? 0 : 1);
}
if (str_starts_with($mode, "session-")) {
  session_id("acp-audit-api-concurrent");
  session_start();
  if ($mode === "session-poll") {
    $valid = validateAppdataCleanupPlusCsrfToken($argv[3] ?? "");
    closeAppdataCleanupPlusSession();
    echo json_encode(array("valid" => $valid, "scope" => appdataCleanupPlusSnapshotScopeKey())) . "\n";
    exit($valid ? 0 : 1);
  }
  $csrf = getAppdataCleanupPlusCsrfToken();
  $snapshot = writeAppdataCleanupPlusSnapshot(array("synthetic" => array("id" => "synthetic", "path" => "/synthetic")));
  closeAppdataCleanupPlusSession();
  $resolved = $snapshot ? resolveSnapshotCandidates($snapshot["token"], array("synthetic")) : array();
  echo json_encode(array("ready" => !empty($resolved["ok"]), "closed" => session_status() === PHP_SESSION_NONE, "csrf" => $csrf, "scope" => appdataCleanupPlusSnapshotScopeKey())) . "\n";
  flush();
  fgets(STDIN);
  exit(0);
}
echo "ready\n";
flush();
if ($mode === "snapshot-cleanup") {
  cleanupExpiredAppdataCleanupPlusSnapshots();
  exit(0);
}
$file = appdataCleanupPlusSnapshotStorageDir() . "/race/new.json";
$payload = array("expiresAt" => date("c", time() + 3600), "candidates" => array("synthetic" => array("id" => "synthetic")));
exit(writeAppdataCleanupPlusJsonFile($file, $payload) ? 0 : 1);
