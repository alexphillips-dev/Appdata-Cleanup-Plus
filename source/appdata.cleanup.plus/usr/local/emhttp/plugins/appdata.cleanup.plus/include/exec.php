<?php

ob_start();

require_once(__DIR__ . "/helpers.php");
require_once(__DIR__ . "/pathUtils.php");
require_once(__DIR__ . "/dashboard.php");
require_once(__DIR__ . "/quarantine.php");
require_once(__DIR__ . "/http.php");
require_once(__DIR__ . "/api.php");

register_shutdown_function("appdataCleanupPlusRespondToFatalShutdown");

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

closeAppdataCleanupPlusSession();

try {
  switch ( $action ) {
    case "getOrphanAppdata":
      handleGetOrphanAppdata();
      break;

    case "hydrateCandidateStats":
      handleHydrateCandidateStats();
      break;

    case "saveSafetySettings":
      handleSaveSafetySettings();
      break;

    case "browseAppdataSourcePath":
      handleBrowseAppdataSourcePath();
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

    case "updateQuarantinePurgeSchedule":
      handleUpdateQuarantinePurgeSchedule();
      break;

    case "inspectQuarantineRestore":
      handleInspectQuarantineRestore();
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
} catch ( Throwable $throwable ) {
  error_log("Appdata Cleanup Plus exec failure: " . $throwable->getMessage() . " in " . $throwable->getFile() . ":" . $throwable->getLine());
  jsonResponse(array(
    "ok" => false,
    "message" => "The orphaned appdata scan could not be completed right now."
  ), 500);
}
