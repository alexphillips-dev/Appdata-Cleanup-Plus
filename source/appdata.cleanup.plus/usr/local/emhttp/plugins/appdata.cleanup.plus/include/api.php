<?php

function appdataCleanupPlusBuildDashboardPayload($dockerRunning, $settings, $rows, $summary, $scanToken, $scanWarningMessage="") {
  return array(
    "ok" => true,
    "payload" => array(
      "ok" => true,
      "dockerRunning" => $dockerRunning,
      "summary" => $summary,
      "rows" => $rows,
      "scanToken" => $scanToken,
      "scanWarningMessage" => $scanWarningMessage,
      "settings" => $settings,
      "appdataSourceInfo" => buildAppdataCleanupPlusSourceInfo($settings)
    )
  );
}

function buildAuditHistoryPayload($limit=0) {
  $effectiveLimit = max(0, (int)$limit);
  $history = getAppdataCleanupPlusAuditHistory($effectiveLimit > 0 ? ($effectiveLimit + 1) : 0);
  $hasMore = false;

  if ( $effectiveLimit > 0 && count($history) > $effectiveLimit ) {
    $history = array_slice($history, 0, $effectiveLimit);
    $hasMore = true;
  }

  return array(
    "auditHistory" => buildAuditHistoryRowsFromEntries($history),
    "hasMore" => $hasMore
  );
}

function buildDashboardQuarantineSummaryPayload() {
  $summary = array(
    "count" => 0,
    "sizeBytes" => 0,
    "sizeLabel" => "0 B"
  );

  try {
    $quarantineManager = buildQuarantineManagerPayload(false);
    if ( ! empty($quarantineManager["summary"]) && is_array($quarantineManager["summary"]) ) {
      $summary = $quarantineManager["summary"];
    }
  } catch ( Throwable $throwable ) {
    error_log("Appdata Cleanup Plus quarantine summary failed during dashboard load: " . $throwable->getMessage());
  }

  return $summary;
}

function appdataCleanupPlusDiagnosticsString($value) {
  return is_scalar($value) || $value === null ? (string)$value : "";
}

function appdataCleanupPlusDiagnosticsRedactPath($path) {
  $raw = trim(str_replace("\\", "/", (string)$path));
  $segments = array();

  if ( $raw === "" || $raw[0] !== "/" ) {
    return $raw;
  }

  $segments = explode("/", $raw);

  if ( strpos($raw, "/mnt/") === 0 ) {
    if ( isset($segments[2]) && $segments[2] !== "" && ! preg_match('/^(user|user0|cache|disk\d+)$/i', $segments[2]) ) {
      $segments[2] = "<mount>";
    }

    if ( isset($segments[3]) && $segments[3] !== "" && ! preg_match('/^(appdata|system|domains|isos)$/i', $segments[3]) ) {
      $segments[3] = "<share>";
    }

    for ( $index = 4; $index < count($segments); $index++ ) {
      if ( $segments[$index] !== "" ) {
        $segments[$index] = "<path>";
      }
    }

    return implode("/", $segments);
  }

  if ( strpos($raw, "/boot/") === 0 ) {
    for ( $index = 4; $index < count($segments); $index++ ) {
      if ( $segments[$index] !== "" ) {
        $segments[$index] = "<path>";
      }
    }

    return implode("/", $segments);
  }

  return "<path>";
}

function appdataCleanupPlusDiagnosticsRedactText($value) {
  $text = appdataCleanupPlusDiagnosticsString($value);

  if ( $text === "" ) {
    return "";
  }

  $text = preg_replace_callback('#/(?:mnt|boot|var|tmp|etc|usr)(?:/[^\\s\'"<>\\[\\](),;]+)+#', function($matches) {
    return appdataCleanupPlusDiagnosticsRedactPath($matches[0]);
  }, $text);
  $text = preg_replace('/([?&](?:csrf|token|key|password|passwd|pass|secret|session|auth)[^=\\s]*=)[^\\s&]+/i', '$1<redacted>', $text);
  $text = preg_replace('/\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b/i', '<email>', $text);
  $text = preg_replace('/\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b/', '<ipv4>', $text);
  $text = preg_replace('/\\b(?:[A-F0-9]{2}:){5}[A-F0-9]{2}\\b/i', '<mac>', $text);
  $text = preg_replace('/\\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\b/i', '<uuid>', $text);
  $text = preg_replace('/\\b[0-9a-f]{32,}\\b/i', '<hex>', $text);
  $text = preg_replace('/^([A-Z][a-z]{2}\\s+\\d{1,2}\\s+\\d{2}:\\d{2}:\\d{2}\\s+)\\S+/', '$1<host>', $text);

  return $text;
}

function appdataCleanupPlusDiagnosticsRedactValue($value) {
  if ( is_array($value) ) {
    $redacted = array();

    foreach ( $value as $key => $item ) {
      $redacted[$key] = appdataCleanupPlusDiagnosticsRedactValue($item);
    }

    return $redacted;
  }

  if ( is_string($value) ) {
    return appdataCleanupPlusDiagnosticsRedactText($value);
  }

  return $value;
}

function appdataCleanupPlusDiagnosticsLogKeywords() {
  return array(
    "appdata cleanup plus",
    "appdata.cleanup.plus",
    "php-fpm",
    "php-fpm:",
    "max children",
    "nginx",
    "504",
    "gateway timeout",
    "upstream timed out",
    "emhttp"
  );
}

function appdataCleanupPlusDiagnosticsLogPaths() {
  $paths = array();
  $override = trim((string)getenv("APPDATA_CLEANUP_PLUS_SYSLOG_PATH"));

  if ( $override !== "" ) {
    foreach ( explode(PATH_SEPARATOR, $override) as $path ) {
      $path = trim(str_replace("\\", "/", (string)$path));
      if ( $path !== "" ) {
        $paths[] = $path;
      }
    }
  }

  $paths[] = "/var/log/syslog";
  $paths[] = "/var/log/nginx/error.log";
  $paths[] = "/boot/logs/syslog";

  return array_values(array_unique($paths));
}

function appdataCleanupPlusDiagnosticsLineMatches($line) {
  $normalized = strtolower((string)$line);

  foreach ( appdataCleanupPlusDiagnosticsLogKeywords() as $keyword ) {
    if ( $keyword !== "" && strpos($normalized, $keyword) !== false ) {
      return true;
    }
  }

  return false;
}

function appdataCleanupPlusDiagnosticsReadMatchingLogTail($path, $matchLimit=500, $scanLimit=5000) {
  $matches = array();
  $file = null;
  $lineNumber = 0;
  $scanned = 0;

  if ( ! is_file($path) || ! is_readable($path) ) {
    return array(
      "path" => appdataCleanupPlusDiagnosticsRedactPath($path),
      "available" => false,
      "lines" => array(),
      "matchedLineCount" => 0,
      "scannedLineLimit" => (int)$scanLimit
    );
  }

  try {
    $file = new SplFileObject($path, "r");
    $file->seek(PHP_INT_MAX);
    $lineNumber = (int)$file->key();

    for ( ; $lineNumber >= 0 && count($matches) < $matchLimit && $scanned < $scanLimit; $lineNumber--, $scanned++ ) {
      $file->seek($lineNumber);
      $line = trim((string)$file->current());

      if ( $line === "" || ! appdataCleanupPlusDiagnosticsLineMatches($line) ) {
        continue;
      }

      $matches[] = appdataCleanupPlusDiagnosticsRedactText($line);
    }
  } catch ( Exception $exception ) {
    return array(
      "path" => appdataCleanupPlusDiagnosticsRedactPath($path),
      "available" => false,
      "error" => appdataCleanupPlusDiagnosticsRedactText($exception->getMessage()),
      "lines" => array(),
      "matchedLineCount" => 0,
      "scannedLineLimit" => (int)$scanLimit
    );
  }

  $matches = array_reverse($matches);

  return array(
    "path" => appdataCleanupPlusDiagnosticsRedactPath($path),
    "available" => true,
    "lines" => $matches,
    "matchedLineCount" => count($matches),
    "scannedLineLimit" => (int)$scanLimit,
    "matchLimit" => (int)$matchLimit
  );
}

function appdataCleanupPlusDiagnosticsReadOptionalJsonFile($path, $limit=50) {
  $payload = readAppdataCleanupPlusJsonFile($path, array());
  $count = is_array($payload) ? count($payload) : 0;

  if ( is_array($payload) && $limit > 0 && count($payload) > $limit ) {
    $payload = array_slice($payload, 0, $limit, true);
  }

  return array(
    "path" => appdataCleanupPlusDiagnosticsRedactPath($path),
    "exists" => is_file($path),
    "count" => $count,
    "truncated" => $limit > 0 && $count > $limit,
    "data" => appdataCleanupPlusDiagnosticsRedactValue($payload)
  );
}

function appdataCleanupPlusDiagnosticsSnapshotSummary() {
  $snapshotFiles = glob(appdataCleanupPlusSnapshotStorageDir() . "/*/*.json");
  $snapshots = array();

  if ( ! is_array($snapshotFiles) ) {
    $snapshotFiles = array();
  }

  rsort($snapshotFiles);

  foreach ( array_slice($snapshotFiles, 0, 10) as $snapshotFile ) {
    $snapshot = readAppdataCleanupPlusJsonFile($snapshotFile, array());
    $snapshots[] = array(
      "file" => appdataCleanupPlusDiagnosticsRedactPath($snapshotFile),
      "issuedAt" => isset($snapshot["issuedAt"]) ? (string)$snapshot["issuedAt"] : "",
      "expiresAt" => isset($snapshot["expiresAt"]) ? (string)$snapshot["expiresAt"] : "",
      "candidateCount" => isset($snapshot["candidates"]) && is_array($snapshot["candidates"]) ? count($snapshot["candidates"]) : 0
    );
  }

  return array(
    "count" => count($snapshotFiles),
    "recent" => $snapshots
  );
}

function appdataCleanupPlusDiagnosticsPluginVersion() {
  $paths = array(
    "/boot/config/plugins/appdata.cleanup.plus.plg",
    dirname(__DIR__, 6) . "/plugins/appdata.cleanup.plus.plg"
  );

  foreach ( $paths as $path ) {
    if ( ! is_file($path) ) {
      continue;
    }

    $contents = @file_get_contents($path);
    if ( is_string($contents) && preg_match('/<!ENTITY version "([^"]+)">/', $contents, $matches) ) {
      return (string)$matches[1];
    }
  }

  return "";
}

function appdataCleanupPlusDiagnosticsUnraidVersion() {
  foreach ( array("/etc/unraid-version", "/var/local/emhttp/var.ini") as $path ) {
    if ( ! is_file($path) || ! is_readable($path) ) {
      continue;
    }

    $contents = @file_get_contents($path, false, null, 0, 2048);
    if ( is_string($contents) && trim($contents) !== "" ) {
      return appdataCleanupPlusDiagnosticsRedactText(trim($contents));
    }
  }

  return "";
}

function buildAppdataCleanupPlusDiagnosticsBundle() {
  $logs = array();

  foreach ( appdataCleanupPlusDiagnosticsLogPaths() as $path ) {
    $logs[] = appdataCleanupPlusDiagnosticsReadMatchingLogTail($path);
  }

  return array(
    "ok" => true,
    "generatedAt" => date("c"),
    "redaction" => array(
      "enabled" => true,
      "strategy" => "Server diagnostics redact paths, IP addresses, emails, MAC addresses, tokens, UUIDs, long hex values, and syslog hostnames. Review before sharing."
    ),
    "runtime" => array(
      "pluginVersion" => appdataCleanupPlusDiagnosticsPluginVersion(),
      "phpVersion" => PHP_VERSION,
      "phpSapi" => PHP_SAPI,
      "unraidVersion" => appdataCleanupPlusDiagnosticsUnraidVersion(),
      "configDir" => appdataCleanupPlusDiagnosticsRedactPath(appdataCleanupPlusConfigDir()),
      "runtimeDir" => appdataCleanupPlusDiagnosticsRedactPath(appdataCleanupPlusRuntimeDir()),
      "dockerRuntimeExists" => is_dir(appdataCleanupPlusDockerRuntimePath())
    ),
    "state" => array(
      "safetySettings" => appdataCleanupPlusDiagnosticsReadOptionalJsonFile(appdataCleanupPlusSafetySettingsFile(), 0),
      "quarantineRegistry" => appdataCleanupPlusDiagnosticsReadOptionalJsonFile(appdataCleanupPlusQuarantineRegistryFile(), 50),
      "ignoredCandidates" => appdataCleanupPlusDiagnosticsReadOptionalJsonFile(appdataCleanupPlusIgnoreListFile(), 50),
      "auditHistory" => appdataCleanupPlusDiagnosticsRedactValue(getAppdataCleanupPlusAuditHistory(50)),
      "statsCache" => array(
        "path" => appdataCleanupPlusDiagnosticsRedactPath(appdataCleanupPlusStatsCacheFile()),
        "exists" => is_file(appdataCleanupPlusStatsCacheFile()),
        "entryCount" => count(readAppdataCleanupPlusJsonFile(appdataCleanupPlusStatsCacheFile(), array()))
      ),
      "snapshots" => appdataCleanupPlusDiagnosticsSnapshotSummary()
    ),
    "logs" => $logs
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

function updateSnapshotCandidateLockOverrideState($token, $candidateIds, $intent) {
  $normalizedIntent = strtolower(trim((string)$intent));
  $resolvedCandidates = resolveSnapshotCandidates($token, $candidateIds);
  $candidateMap = array();
  $updatedCandidates = array();
  $updatedSnapshot = null;

  if ( ! $resolvedCandidates["ok"] ) {
    return $resolvedCandidates;
  }

  if ( ! in_array($normalizedIntent, array("unlock", "relock"), true) ) {
    return array(
      "ok" => false,
      "message" => "Unsupported lock override update.",
      "statusCode" => 400
    );
  }

  $candidateMap = isset($resolvedCandidates["snapshot"]["candidates"]) && is_array($resolvedCandidates["snapshot"]["candidates"])
    ? $resolvedCandidates["snapshot"]["candidates"]
    : array();

  foreach ( $resolvedCandidates["candidates"] as $candidate ) {
    $candidateId = isset($candidate["id"]) ? (string)$candidate["id"] : "";

    if ( ! $candidateId || empty($candidateMap[$candidateId]) || ! is_array($candidateMap[$candidateId]) ) {
      return array(
        "ok" => false,
        "message" => "One or more selected candidates are no longer valid. Rescan and try again.",
        "statusCode" => 409
      );
    }

    if ( ! appdataCleanupPlusCandidateSupportsLockOverride($candidateMap[$candidateId]) ) {
      return array(
        "ok" => false,
        "message" => "Only outside-share review locks can be manually unlocked.",
        "statusCode" => 400
      );
    }

    $candidateMap[$candidateId]["lockOverridden"] = $normalizedIntent === "unlock";
    $updatedCandidates[] = $candidateMap[$candidateId];
  }

  $updatedSnapshot = writeAppdataCleanupPlusSnapshot($candidateMap);

  if ( ! $updatedSnapshot ) {
    return array(
      "ok" => false,
      "message" => "The selected review folders could not be updated right now.",
      "statusCode" => 500
    );
  }

  return array(
    "ok" => true,
    "scanToken" => (string)$updatedSnapshot["token"],
    "candidates" => $updatedCandidates
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

  $templateVolumes = buildCandidateMap($allFiles, $settings);
  $filesystemVolumes = buildFilesystemCandidateMap($templateVolumes, $containers, $settings, $dockerRunning);
  $availableVolumes = $templateVolumes + $filesystemVolumes;

  $availableVolumes = removeInstalledVolumeMatches($availableVolumes, $containers);
  $availableVolumes = filterToExistingCandidates($availableVolumes);
  $availableVolumes = removeParentCandidates($availableVolumes);
  $availableVolumes = removeParentsUsedByInstalledContainers($availableVolumes, $containers);
  $availableVolumes = removeVmManagerManagedCandidates($availableVolumes);

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

  return appdataCleanupPlusBuildDashboardPayload(
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

function handleGetAuditHistory() {
  $limit = (int)getPostedString("limit");
  $payload = buildAuditHistoryPayload($limit);

  jsonResponse(array(
    "ok" => true,
    "auditHistory" => $payload["auditHistory"],
    "hasMore" => ! empty($payload["hasMore"])
  ));
}

function handleGetQuarantineSummary() {
  jsonResponse(array(
    "ok" => true,
    "quarantineSummary" => buildDashboardQuarantineSummaryPayload()
  ));
}

function handleGetDiagnosticsBundle() {
  jsonResponse(array(
    "ok" => true,
    "bundle" => buildAppdataCleanupPlusDiagnosticsBundle()
  ));
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

function handleGetCandidateDetails() {
  $token = getRequestedToken();
  $candidateId = trim((string)getPostedString("candidateId"));
  $resolvedCandidates = array();

  if ( $candidateId === "" ) {
    jsonResponse(array(
      "ok" => false,
      "message" => "No candidate was selected."
    ), 400);
  }

  $resolvedCandidates = resolveSnapshotCandidates($token, array($candidateId));

  if ( ! $resolvedCandidates["ok"] ) {
    jsonResponse(array(
      "ok" => false,
      "message" => $resolvedCandidates["message"]
    ), $resolvedCandidates["statusCode"]);
  }

  jsonResponse(array(
    "ok" => true,
    "row" => appdataCleanupPlusBuildCandidateDetailPayload($resolvedCandidates["candidates"][0], getAppdataCleanupPlusSafetySettings())
  ));
}

function handleSaveSafetySettings() {
  $currentSettings = getAppdataCleanupPlusSafetySettings();
  $manualAppdataSources = isset($_POST["manualAppdataSources"])
    ? preg_split('/\r\n|\r|\n/', getPostedString("manualAppdataSources"))
    : (isset($currentSettings["manualAppdataSources"]) ? $currentSettings["manualAppdataSources"] : array());
  $zfsPathMappings = isset($_POST["zfsPathMappings"])
    ? json_decode(getPostedString("zfsPathMappings"), true)
    : (isset($currentSettings["zfsPathMappings"]) ? $currentSettings["zfsPathMappings"] : array());

  if ( isset($_POST["zfsPathMappings"]) && ! is_array($zfsPathMappings) ) {
    jsonResponse(array(
      "ok" => false,
      "message" => "ZFS path mappings must be valid JSON."
    ), 400);
  }

  foreach ( $manualAppdataSources as $manualSourcePath ) {
    $validationMessage = appdataCleanupPlusValidateManualAppdataSource($manualSourcePath);

    if ( trim((string)$manualSourcePath) === "" ) {
      continue;
    }

    if ( $validationMessage !== "" ) {
      jsonResponse(array(
        "ok" => false,
        "message" => $validationMessage
      ), 400);
    }
  }

  foreach ( is_array($zfsPathMappings) ? $zfsPathMappings : array() as $zfsPathMapping ) {
    $validationMessage = appdataCleanupPlusValidateZfsPathMapping($zfsPathMapping);

    if ( $validationMessage !== "" ) {
      jsonResponse(array(
        "ok" => false,
        "message" => $validationMessage
      ), 400);
    }
  }

  $settings = array(
    "allowOutsideShareCleanup" => getPostedBoolean("allowOutsideShareCleanup"),
    "enablePermanentDelete" => getPostedBoolean("enablePermanentDelete"),
    "enableZfsDatasetDelete" => getPostedBoolean("enableZfsDatasetDelete"),
    "defaultQuarantinePurgeDays" => isset($_POST["defaultQuarantinePurgeDays"])
      ? (int)getPostedString("defaultQuarantinePurgeDays")
      : (int)(isset($currentSettings["defaultQuarantinePurgeDays"]) ? $currentSettings["defaultQuarantinePurgeDays"] : 0),
    "manualAppdataSources" => $manualAppdataSources,
    "zfsPathMappings" => is_array($zfsPathMappings) ? $zfsPathMappings : array()
  );

  if ( ! setAppdataCleanupPlusSafetySettings($settings) ) {
    jsonResponse(array(
      "ok" => false,
      "message" => "Safety settings could not be saved."
    ), 500);
  }

  $nextSettings = getAppdataCleanupPlusSafetySettings();

  if ( (int)$currentSettings["defaultQuarantinePurgeDays"] !== (int)$nextSettings["defaultQuarantinePurgeDays"] ) {
    syncTrackedQuarantineEntriesToDefaultPurgeSchedule($nextSettings, $currentSettings);
  }

  jsonResponse(array(
    "ok" => true,
    "settings" => $nextSettings,
    "appdataSourceInfo" => buildAppdataCleanupPlusSourceInfo($nextSettings),
    "quarantine" => buildQuarantineManagerPayload(true)
  ));
}

function handleBrowseAppdataSourcePath() {
  $browseResult = appdataCleanupPlusBuildManualSourceBrowsePayload(getPostedString("path"));

  if ( empty($browseResult["ok"]) ) {
    jsonResponse(array(
      "ok" => false,
      "message" => isset($browseResult["message"]) ? (string)$browseResult["message"] : "The requested folder could not be browsed right now."
    ), isset($browseResult["statusCode"]) ? (int)$browseResult["statusCode"] : 400);
  }

  jsonResponse(array(
    "ok" => true,
    "browser" => isset($browseResult["browser"]) && is_array($browseResult["browser"]) ? $browseResult["browser"] : array()
  ));
}

function handleUpdateCandidateState() {
  $token = getRequestedToken();
  $candidateIds = parseCandidateIds(getPostedString("candidateIds"));
  $intent = getPostedString("intent");
  $resolvedCandidates = resolveSnapshotCandidates($token, $candidateIds);
  $lockOverrideUpdate = array();

  if ( ! $resolvedCandidates["ok"] ) {
    jsonResponse(array(
      "ok" => false,
      "message" => $resolvedCandidates["message"]
    ), $resolvedCandidates["statusCode"]);
  }

  if ( in_array($intent, array("unlock", "relock"), true) ) {
    $lockOverrideUpdate = updateSnapshotCandidateLockOverrideState($token, $candidateIds, $intent);

    if ( ! $lockOverrideUpdate["ok"] ) {
      jsonResponse(array(
        "ok" => false,
        "message" => $lockOverrideUpdate["message"]
      ), $lockOverrideUpdate["statusCode"]);
    }

    jsonResponse(array(
      "ok" => true,
      "scanToken" => isset($lockOverrideUpdate["scanToken"]) ? $lockOverrideUpdate["scanToken"] : "",
      "candidates" => isset($lockOverrideUpdate["candidates"]) ? $lockOverrideUpdate["candidates"] : array()
    ));
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
    "ok" => true,
    "scanToken" => $token
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
    "quarantineSummary" => buildDashboardQuarantineSummaryPayload()
  ));
}

function handleGetQuarantineEntries() {
  jsonResponse(array(
    "ok" => true,
    "quarantine" => buildQuarantineManagerPayload(true)
  ));
}

function handleUpdateQuarantinePurgeSchedule() {
  $entryIds = parseCandidateIds(getPostedString("entryIds"));
  $mode = strtolower(getPostedString("purgeScheduleMode"));
  $purgeAfterDays = (int)getPostedString("purgeAfterDays");
  $purgeAt = getPostedString("purgeAt");
  $normalizedPurgeAt = $purgeAt !== "" ? normalizeAppdataCleanupPlusQuarantinePurgeAt($purgeAt) : "";

  if ( $mode === "" ) {
    $mode = strtolower(getPostedString("mode"));
  }

  if ( empty($entryIds) ) {
    jsonResponse(array(
      "ok" => false,
      "message" => "No quarantine entries were selected."
    ), 400);
  }

  if ( ! in_array($mode, array("set", "clear"), true) ) {
    jsonResponse(array(
      "ok" => false,
      "message" => "Unsupported purge schedule action."
    ), 400);
  }

  if ( $mode === "set" ) {
    if ( $normalizedPurgeAt !== "" ) {
      if ( strtotime($normalizedPurgeAt) <= time() ) {
        jsonResponse(array(
          "ok" => false,
          "message" => "Purge time must be in the future."
        ), 400);
      }
    } elseif ( $purgeAfterDays < 1 || $purgeAfterDays > 3650 ) {
      jsonResponse(array(
        "ok" => false,
        "message" => "Purge delay must be between 1 and 3650 days."
      ), 400);
    }
  }

  $resolvedEntries = resolveTrackedQuarantineEntries($entryIds);

  if ( ! $resolvedEntries["ok"] ) {
    jsonResponse(array(
      "ok" => false,
      "message" => $resolvedEntries["message"]
    ), $resolvedEntries["statusCode"]);
  }

  $execution = updateTrackedQuarantinePurgeSchedule($resolvedEntries["entries"], $mode, $purgeAfterDays, $normalizedPurgeAt);
  jsonResponse(array(
    "ok" => empty($execution["summary"]["errors"]) && empty($execution["summary"]["missing"]),
    "action" => $execution["action"],
    "results" => $execution["results"],
    "summary" => $execution["summary"],
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
  $customRestoreNames = json_decode(getPostedString("restoreConflictNames"), true);

  if ( ! is_array($customRestoreNames) ) {
    $customRestoreNames = array();
  }

  $cleanCustomRestoreNames = array();
  foreach ( $customRestoreNames as $entryId => $restoreName ) {
    $entryKey = trim((string)$entryId);
    if ( ! $entryKey ) {
      continue;
    }

    $cleanCustomRestoreNames[$entryKey] = trim((string)$restoreName);
  }

  $options = array(
    "conflictMode" => getPostedString("restoreConflictMode"),
    "customRestoreNames" => $cleanCustomRestoreNames
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
