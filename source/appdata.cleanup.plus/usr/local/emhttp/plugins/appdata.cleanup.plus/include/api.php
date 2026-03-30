<?php

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
  $allFiles = glob("/boot/config/plugins/dockerMan/templates-user/*.xml");
  $dockerRunning = is_dir("/var/lib/docker/tmp");
  $containers = getDockerContainersSafe();

  if ( ! is_array($allFiles) ) {
    $allFiles = array();
  }

  $availableVolumes = buildCandidateMap($allFiles);

  $availableVolumes = removeInstalledVolumeMatches($availableVolumes, $containers);
  $availableVolumes = filterToExistingCandidates($availableVolumes);
  $availableVolumes = removeParentCandidates($availableVolumes);
  $availableVolumes = removeParentsUsedByInstalledContainers($availableVolumes, $containers);

  $rows = buildCandidateRows($availableVolumes, $dockerRunning, $settings);
  $summary = buildSummary($rows);
  $snapshot = writeAppdataCleanupPlusSnapshot(buildSnapshotCandidateMap($rows));

  if ( ! $snapshot ) {
    return array(
      "ok" => false,
      "message" => "A secure scan snapshot could not be created right now.",
      "statusCode" => 500
    );
  }

  $latestAudit = getLatestAppdataCleanupPlusAuditEntry();
  $quarantineManager = buildQuarantineManagerPayload(false);

  return array(
    "ok" => true,
    "payload" => array(
      "ok" => true,
      "dockerRunning" => $dockerRunning,
      "summary" => $summary,
      "notices" => buildNotices($dockerRunning, $summary, $settings),
      "latestAuditMessage" => $latestAudit ? buildLatestAuditMessage($latestAudit) : "",
      "auditHistory" => buildAuditHistoryRows(),
      "rows" => $rows,
      "scanToken" => $snapshot["token"],
      "settings" => $settings,
      "quarantineSummary" => $quarantineManager["summary"]
    )
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

function handleSaveSafetySettings() {
  $token = getRequestedToken();
  $snapshot = getValidatedAppdataCleanupPlusSnapshot($token);

  if ( ! $snapshot ) {
    jsonResponse(array(
      "ok" => false,
      "message" => "This scan expired or is no longer valid. Rescan and try again."
    ), 409);
  }

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

function handleQuarantineManagerAction() {
  $action = getPostedString("managerAction");
  $entryIds = parseCandidateIds(getPostedString("entryIds"));

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

  $execution = executeQuarantineManagerAction($resolvedEntries["entries"], $action);

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
    "quarantine" => buildQuarantineManagerPayload(true)
  ));
}
