<?php

require_once("/usr/local/emhttp/plugins/appdata.cleanup.plus/include/helpers.php");
require_once("/usr/local/emhttp/plugins/appdata.cleanup.plus/include/pathUtils.php");
require_once("/usr/local/emhttp/plugins/appdata.cleanup.plus/include/dashboard.php");
require_once("/usr/local/emhttp/plugins/appdata.cleanup.plus/include/quarantine.php");
require_once("/usr/local/emhttp/plugins/appdata.cleanup.plus/include/http.php");
require_once("/usr/local/emhttp/plugins/appdata.cleanup.plus/include/api.php");

libxml_use_internal_errors(true);

$requestMethod = strtoupper((string)($_SERVER["REQUEST_METHOD"] ?? ""));
$action = getPostedString("action");
$csrfToken = getRequestedCsrfToken();

if ( $requestMethod !== "POST" ) {
  header("Allow: POST");
  jsonResponse(array(
    "ok" => false,
    "message" => "Unsupported request method."
  ), 405);
}

if ( ! requestTargetsCurrentHost() ) {
  jsonResponse(array(
    "ok" => false,
    "message" => "Request origin did not match this host."
  ), 403);
}

if ( ! validateAppdataCleanupPlusCsrfToken($csrfToken) ) {
  jsonResponse(array(
    "ok" => false,
    "message" => "Security validation failed. Refresh the page and try again."
  ), 403);
}

switch ( $action ) {
  case "getOrphanAppdata":
    handleGetOrphanAppdata();
    break;

  case "saveSafetySettings":
    handleSaveSafetySettings();
    break;

  case "updateCandidateState":
    handleUpdateCandidateState();
    break;

  case "executeCandidateAction":
    handleExecuteCandidateAction();
    break;

  case "getQuarantineEntries":
    handleGetQuarantineEntries();
    break;

  case "quarantineManagerAction":
    handleQuarantineManagerAction();
    break;

  default:
    jsonResponse(array(
      "ok" => false,
      "message" => "Unsupported action."
    ), 400);
}

