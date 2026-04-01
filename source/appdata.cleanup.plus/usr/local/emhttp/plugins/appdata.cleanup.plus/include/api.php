<?php

function appdataCleanupPlusBuildDashboardFallbackPayload($dockerRunning, $settings, $rows, $summary, $scanToken, $scanWarningMessage="") {
  $auditHistory = array();
  $quarantineSummary = array(
    "count" => 0,
    "sizeBytes" => 0,
    "sizeLabel" => "0 B"
  );

  try {
    $auditHistory = buildAuditHistoryRows();
  } catch ( Throwable $throwable ) {
    error_log("Appdata Cleanup Plus audit history failed during dashboard build: " . $throwable->getMessage());
  }

  try {
    $quarantineManager = buildQuarantineManagerPayload(false);
    if ( ! empty($quarantineManager["summary"]) && is_array($quarantineManager["summary"]) ) {
      $quarantineSummary = $quarantineManager["summary"];
    }
  } catch ( Throwable $throwable ) {
    error_log("Appdata Cleanup Plus quarantine summary failed during dashboard build: " . $throwable->getMessage());
  }

  return array(
    "ok" => true,
    "payload" => array(
      "ok" => true,
      "dockerRunning" => $dockerRunning,
      "summary" => $summary,
      "auditHistory" => $auditHistory,
      "rows" => $rows,
      "scanToken" => $scanToken,
      "scanWarningMessage" => $scanWarningMessage,
      "settings" => $settings,
      "quarantineSummary" => $quarantineSummary
    )
  );
}

function resolveSnapshotCandidates($token, $candidateIds) {
  if ( empty($candidateIds) ) {
    return array(
      "ok" => false,
      "message" => "No candidates were selected.",
      "statusCode" => 400
    );
  }

  $snapshot = getValidatedAppdataCleanupPlusSnapshot($token);
  if ( ! $snapshot ) {
    return array(
      "ok" => false,
      "message" => "This scan expired or is no longer valid. Rescan and try again.",
      "statusCode" => 409
    );
  }

  $resolvedCandidates = array();
  foreach ( $candidateIds as $candidateId ) {
    if ( empty($snapshot["candidates"][$candidateId]) || ! is_array($snapshot["candidates"][$candidateId]) ) {
      return array(
        "ok" => false,
        "message" => "One or more selected candidates are no longer valid. Rescan and try again.",
        "statusCode" => 409
      );
    }

    $resolvedCandidates[] = $snapshot["candidates"][$candidateId];
  }

  return array(
    "ok" => true,
    "snapshot" => $snapshot,
    "candidates" => $resolvedCandidates
  );
}

function buildDashboardPayload() {
  $settings = getAppdataCleanupPlusSafetySettings();
  $allFiles = glob(appdataCleanupPlusDockerTemplateDir() . "/*.xml");
  $dockerRunning = is_dir(appdataCleanupPlusDockerRuntimePath());
  $containers = getDockerContainersSafe();

  if ( ! is_array($allFiles) ) {
    $allFiles = array();
  }

  $templateVolumes = buildCandidateMap($allFiles);
  $filesystemVolumes = buildFilesystemCandidateMap($templateVolumes, $containers, $settings, $dockerRunning);
  $availableVolumes = $templateVolumes + $filesystemVolumes;

  $availableVolumes = removeInstalledVolumeMatches($availableVolumes, $containers);
  $availableVolumes = filterToExistingCandidates($availableVolumes);
  $availableVolumes = removeParentCandidates($availableVolumes);
  $availableVolumes = removeParentsUsedByInstalledContainers($availableVolumes, $containers);

  $rows = buildCandidateRows($availableVolumes, $dockerRunning, $settings, false);
  $summary = buildSummary($rows);
  $snapshot = writeAppdataCleanupPlusSnapshot(buildSnapshotCandidateMap($rows));
  $scanWarningMessage = "";

  if ( ! $snapshot ) {
    error_log("Appdata Cleanup Plus could not persist a scan snapshot. Returning read-only dashboard payload.");
    $rows = buildCandidateRows($availableVolumes, $dockerRunning, $settings, true);
    $summary = buildSummary($rows);
    $scanWarningMessage = "Scan results loaded, but actions are disabled because a secure snapshot could not be created right now.";
  }

  return appdataCleanupPlusBuildDashboardFallbackPayload(
    $dockerRunning,
    $settings,
    $rows,
    $summary,
    $snapshot ? (string)$snapshot["token"] : "",
    $scanWarningMessage
  );
}

function handleGetOrphanAppdata() {
  $dashboard = buildDashboardPayload();

  if ( ! $dashboard["ok"] ) {
    jsonResponse(array(
      "ok" => false,
      "message" => $dashboard["message"]
    ), $dashboard["statusCode"]);
  }

  jsonResponse($dashboard["payload"]);
}

function handleHydrateCandidateStats() {
  $token = getRequestedToken();
  $candidateIds = parseCandidateIds(getPostedString("candidateIds"));
  $resolvedCandidates = array();
  $rows = array();

  if ( empty($candidateIds) ) {
    jsonResponse(array(
      "ok" => false,
      "message" => "No candidates were selected."
    ), 400);
  }

  $resolvedCandidates = resolveSnapshotCandidates($token, $candidateIds);

  if ( ! $resolvedCandidates["ok"] ) {
    jsonResponse(array(
      "ok" => false,
      "message" => $resolvedCandidates["message"]
    ), $resolvedCandidates["statusCode"]);
  }

  foreach ( $resolvedCandidates["candidates"] as $candidate ) {
    $rows[] = buildHydratedCandidateStatRow($candidate);
  }

  jsonResponse(array(
    "ok" => true,
    "rows" => $rows
  ));
}

function handleSaveSafetySettings() {
  $settings = array(
    "allowOutsideShareCleanup" => getPostedBoolean("allowOutsideShareCleanup"),
    "enablePermanentDelete" => getPostedBoolean("enablePermanentDelete")
  );

  if ( ! setAppdataCleanupPlusSafetySettings($settings) ) {
    jsonResponse(array(
      "ok" => false,
      "message" => "Safety settings could not be saved."
    ), 500);
  }

  jsonResponse(array(
    "ok" => true,
    "settings" => getAppdataCleanupPlusSafetySettings()
  ));
}

function handleUpdateCandidateState() {
  $token = getRequestedToken();
  $candidateIds = parseCandidateIds(getPostedString("candidateIds"));
  $intent = getPostedString("intent");
  $resolvedCandidates = resolveSnapshotCandidates($token, $candidateIds);

  if ( ! $resolvedCandidates["ok"] ) {
    jsonResponse(array(
      "ok" => false,
      "message" => $resolvedCandidates["message"]
    ), $resolvedCandidates["statusCode"]);
  }

  if ( ! in_array($intent, array("ignore", "unignore"), true) ) {
    jsonResponse(array(
      "ok" => false,
      "message" => "Unsupported candidate state update."
    ), 400);
  }

  foreach ( $resolvedCandidates["candidates"] as $candidate ) {
    if ( $intent === "ignore" ) {
      if ( ! ignoreAppdataCleanupPlusCandidate($candidate["displayPath"], $candidate) ) {
        jsonResponse(array(
          "ok" => false,
          "message" => "The ignore list could not be updated."
        ), 500);
      }
      continue;
    }

    if ( ! unignoreAppdataCleanupPlusCandidate($candidate["displayPath"]) ) {
      jsonResponse(array(
        "ok" => false,
        "message" => "The ignore list could not be updated."
      ), 500);
    }
  }

  jsonResponse(array(
    "ok" => true
  ));
}

function handleExecuteCandidateAction() {
  $token = getRequestedToken();
  $candidateIds = parseCandidateIds(getPostedString("candidateIds"));
  $operation = getRequestedOperation();
  $resolvedCandidates = resolveSnapshotCandidates($token, $candidateIds);
  $settings = getAppdataCleanupPlusSafetySettings();

  if ( ! $resolvedCandidates["ok"] ) {
    jsonResponse(array(
      "ok" => false,
      "message" => $resolvedCandidates["message"]
    ), $resolvedCandidates["statusCode"]);
  }

  if ( ! $operation || ! isSupportedOperation($operation) ) {
    jsonResponse(array(
      "ok" => false,
      "message" => "Unsupported cleanup operation."
    ), 400);
  }

  $execution = executeCandidateOperation($resolvedCandidates["candidates"], $settings, $operation);

  if ( ! $execution["preview"] ) {
    appendAppdataCleanupPlusAuditEntry(array(
      "timestamp" => date("c"),
      "operation" => $execution["operation"],
      "requestedCount" => count($candidateIds),
      "requestedIds" => array_values($candidateIds),
      "summary" => $execution["summary"],
      "results" => $execution["results"]
    ));
  }

  jsonResponse(array(
    "ok" => $execution["summary"]["errors"] === 0,
    "operation" => $execution["operation"],
    "preview" => $execution["preview"],
    "results" => $execution["results"],
    "summary" => $execution["summary"],
    "quarantineSummary" => buildQuarantineManagerPayload(false)["summary"]
  ));
}

function handleGetQuarantineEntries() {
  jsonResponse(array(
    "ok" => true,
    "quarantine" => buildQuarantineManagerPayload(true)
  ));
}

function handleInspectQuarantineRestore() {
  $entryIds = parseCandidateIds(getPostedString("entryIds"));
  $resolvedEntries = array();

  if ( empty($entryIds) ) {
    jsonResponse(array(
      "ok" => false,
      "message" => "No quarantine entries were selected."
    ), 400);
  }

  $resolvedEntries = resolveTrackedQuarantineEntries($entryIds);

  if ( ! $resolvedEntries["ok"] ) {
    jsonResponse(array(
      "ok" => false,
      "message" => $resolvedEntries["message"]
    ), $resolvedEntries["statusCode"]);
  }

  jsonResponse(array(
    "ok" => true,
    "preview" => inspectTrackedQuarantineRestoreConflicts($resolvedEntries["entries"])
  ));
}

function buildUpdatedSnapshotTokenFromRestoredResults($token, $results) {
  $snapshot = getValidatedAppdataCleanupPlusSnapshot($token);
  $restoredRows = array();
  $candidateMap = array();

  if ( ! $snapshot || empty($snapshot["candidates"]) || ! is_array($snapshot["candidates"]) ) {
    return "";
  }

  foreach ( $results as $result ) {
    if ( empty($result["row"]) || ! is_array($result["row"]) ) {
      continue;
    }

    $restoredRows[] = $result["row"];
  }

  if ( empty($restoredRows) ) {
    return (string)$snapshot["token"];
  }

  $candidateMap = $snapshot["candidates"];
  foreach ( buildSnapshotCandidateMap($restoredRows) as $candidateId => $candidate ) {
    $candidateMap[$candidateId] = $candidate;
  }

  $updatedSnapshot = writeAppdataCleanupPlusSnapshot($candidateMap);
  return $updatedSnapshot ? (string)$updatedSnapshot["token"] : "";
}

function handleQuarantineManagerAction() {
  $action = getPostedString("managerAction");
  $entryIds = parseCandidateIds(getPostedString("entryIds"));
  $scanToken = getRequestedToken();
  $updatedScanToken = "";
  $options = array(
    "conflictMode" => getPostedString("restoreConflictMode")
  );

  if ( ! in_array($action, array("restore", "purge"), true) ) {
    jsonResponse(array(
      "ok" => false,
      "message" => "Unsupported quarantine manager action."
    ), 400);
  }

  if ( empty($entryIds) ) {
    jsonResponse(array(
      "ok" => false,
      "message" => "No quarantine entries were selected."
    ), 400);
  }

  $resolvedEntries = resolveTrackedQuarantineEntries($entryIds);

  if ( ! $resolvedEntries["ok"] ) {
    jsonResponse(array(
      "ok" => false,
      "message" => $resolvedEntries["message"]
    ), $resolvedEntries["statusCode"]);
  }

  $execution = executeQuarantineManagerAction($resolvedEntries["entries"], $action, $options);
  if ( $action === "restore" ) {
    $updatedScanToken = buildUpdatedSnapshotTokenFromRestoredResults($scanToken, $execution["results"]);
  }

  appendAppdataCleanupPlusAuditEntry(array(
    "timestamp" => date("c"),
    "operation" => $action,
    "requestedCount" => count($entryIds),
    "requestedIds" => array_values($entryIds),
    "summary" => $execution["summary"],
    "results" => $execution["results"]
  ));

  jsonResponse(array(
    "ok" => $execution["summary"]["errors"] === 0,
    "action" => $execution["action"],
    "results" => $execution["results"],
    "summary" => $execution["summary"],
    "quarantine" => buildQuarantineManagerPayload(true),
    "scanToken" => $updatedScanToken
  ));
}
