<?php
// Worker arguments can only name this suite's unique temporary fixture.
$root = realpath($argv[1] ?? "");
if (!$root || dirname($root) !== realpath(sys_get_temp_dir()) || strpos(basename($root), "acp-quarantine-") !== 0) exit(2);
$include = dirname(__DIR__) . "/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus/include/";
foreach (array("helpers.php", "pathUtils.php", "dashboard.php", "quarantine.php", "http.php", "api.php") as $file) require_once $include . $file;
$mode = $argv[2] ?? "";
if ($mode === "list") {
  @unlink(appdataCleanupPlusStatsCacheFile());
  buildQuarantineManagerPayload(true);
  exit(0);
}
if ($mode === "settings") {
  $_POST = array("defaultQuarantinePurgeDays" => $argv[3] ?? "0");
  handleSaveSafetySettings();
}
if ($mode === "settings-patch") {
  $_POST = json_decode($argv[3] ?? "{}", true);
  if (!is_array($_POST)) exit(2);
  handleSaveSafetySettings();
}
if ($mode === "schedule") {
  $_POST = array("entryIds" => json_encode(array($argv[3] ?? "")), "purgeScheduleMode" => "clear");
  handleUpdateQuarantinePurgeSchedule();
}
exit(2);
