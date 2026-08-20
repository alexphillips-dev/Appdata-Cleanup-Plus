<?php

$stateRoot = isset($argv[1]) ? (string)$argv[1] : "";
$workerId = isset($argv[2]) ? (string)$argv[2] : "worker";
$count = isset($argv[3]) ? max(1, (int)$argv[3]) : 1;

if ( $stateRoot === "" ) {
  fwrite(STDERR, "Missing state root.\n");
  exit(1);
}

putenv("APPDATA_CLEANUP_PLUS_STATE_ROOT=" . $stateRoot);
require_once(dirname(__DIR__) . "/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus/include/helpers.php");

for ( $index = 0; $index < $count; $index++ ) {
  $path = "/mnt/user/appdata/concurrency-" . $workerId . "-" . $index;
  if ( ! ignoreAppdataCleanupPlusCandidate($path, array("name" => basename($path))) ) {
    fwrite(STDERR, "State update failed.\n");
    exit(1);
  }
}

exit(0);
