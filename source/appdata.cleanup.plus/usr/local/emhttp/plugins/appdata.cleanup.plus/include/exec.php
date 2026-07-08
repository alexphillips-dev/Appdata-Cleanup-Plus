<?php

ob_start();

require_once(__DIR__ . "/helpers.php");
require_once(__DIR__ . "/pathUtils.php");
require_once(__DIR__ . "/dashboard.php");
require_once(__DIR__ . "/quarantine.php");
require_once(__DIR__ . "/fixtures.php");
require_once(__DIR__ . "/http.php");
require_once(__DIR__ . "/api.php");

register_shutdown_function("appdataCleanupPlusRespondToFatalShutdown");
register_shutdown_function("releaseAllAppdataCleanupPlusRuntimeLocks");

libxml_use_internal_errors(true);

$requestMethod = strtoupper((string)($_SERVER["REQUEST_METHOD"] ?? ""));
$action = getPostedString("action");
$csrfToken = getRequestedCsrfToken();
$actionLocks = array(
  "getOrphanAppdata" => "scan-operation",
  "executeCandidateAction" => "cleanup-operation",
  "fixtureManagerAction" => "cleanup-operation",
  "updateQuarantinePurgeSchedule" => "cleanup-operation",
  "quarantineManagerAction" => "cleanup-operation"
);

function appdataCleanupPlusGenericFailureMessage($action) {
  switch ( (string)$action ) {
    case "getOrphanAppdata":
      return "The orphaned appdata scan could not be completed right now.";
    case "saveSafetySettings":
      return "The plugin settings could not be saved right now.";
    case "browseAppdataSourcePath":
      return "The appdata source browser could not be loaded right now.";
    case "updateCandidateState":
      return "The folder state could not be updated right now.";
    case "executeCandidateAction":
      return "The cleanup action could not be completed right now.";
    case "getOperationProgress":
      return "Cleanup progress could not be loaded right now.";
    case "hydrateCandidateStats":
      return "Folder size details could not be loaded right now.";
    case "getCandidateDetails":
      return "Folder details could not be loaded right now.";
    case "getQuarantineSummary":
    case "getQuarantineEntries":
    case "updateQuarantinePurgeSchedule":
    case "inspectQuarantineRestore":
    case "quarantineManagerAction":
      return "The quarantine action could not be completed right now.";
    case "getAuditHistory":
      return "Audit history could not be loaded right now.";
    case "getDiagnosticsBundle":
      return "Diagnostics could not be generated right now.";
    case "fixtureManagerAction":
      return "The test fixture action could not be completed right now.";
    default:
      return "The Appdata Cleanup Plus request could not be completed right now.";
  }
}

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

if ( isset($actionLocks[$action]) ) {
  $lockName = $actionLocks[$action];
  if ( ! acquireAppdataCleanupPlusRuntimeLock($lockName, array("action" => $action)) ) {
    header("Retry-After: 5");
    jsonResponse(array(
      "ok" => false,
      "message" => $lockName === "cleanup-operation"
        ? "Appdata Cleanup Plus is already running a cleanup operation. Wait a few seconds, then try again."
        : "Appdata Cleanup Plus is already running a scan. Wait a few seconds, then try again."
    ), 429);
  }
}

try {
  switch ( $action ) {
    case "getOrphanAppdata":
      handleGetOrphanAppdata();
      break;

    case "getAuditHistory":
      handleGetAuditHistory();
      break;

    case "getQuarantineSummary":
      handleGetQuarantineSummary();
      break;

    case "getDiagnosticsBundle":
      handleGetDiagnosticsBundle();
      break;

    case "hydrateCandidateStats":
      handleHydrateCandidateStats();
      break;

    case "getCandidateDetails":
      handleGetCandidateDetails();
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

    case "fixtureManagerAction":
      handleFixtureManagerAction();
      break;

    case "getOperationProgress":
      handleGetOperationProgress();
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
    "message" => appdataCleanupPlusGenericFailureMessage($action)
  ), 500);
}
