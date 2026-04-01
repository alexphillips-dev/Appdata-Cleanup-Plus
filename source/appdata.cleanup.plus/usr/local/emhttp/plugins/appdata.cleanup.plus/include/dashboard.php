<?php

function appdataCleanupPlusDockerClientPath() {
  $override = trim((string)getenv("APPDATA_CLEANUP_PLUS_DOCKER_CLIENT_PATH"));

  if ( $override ) {
    return $override;
  }

  return "/usr/local/emhttp/plugins/dynamix.docker.manager/include/DockerClient.php";
}

function appdataCleanupPlusDockerRuntimePath() {
  $override = trim((string)getenv("APPDATA_CLEANUP_PLUS_DOCKER_RUNTIME_PATH"));

  if ( $override ) {
    return $override;
  }

  return "/var/lib/docker/tmp";
}

function appdataCleanupPlusLogTrimmedOutput($context, $message, $limit=400) {
  $normalized = trim(preg_replace('/\s+/', ' ', (string)$message));

  if ( $normalized === "" ) {
    return;
  }

  if ( strlen($normalized) > $limit ) {
    $normalized = substr($normalized, 0, $limit) . "...";
  }

  error_log("Appdata Cleanup Plus " . $context . ": " . $normalized);
}

function appdataCleanupPlusRunQuietly($callable, $context) {
  $capturedErrors = array();
  $result = null;

  ob_start();
  set_error_handler(function($severity, $message, $file, $line) use (&$capturedErrors) {
    $capturedErrors[] = trim((string)$message) . " in " . (string)$file . ":" . (int)$line;
    return true;
  });

  try {
    $result = $callable();
  } finally {
    restore_error_handler();
    $strayOutput = ob_get_clean();

    if ( ! empty($capturedErrors) ) {
      appdataCleanupPlusLogTrimmedOutput($context . " warning", implode(" | ", $capturedErrors));
    }

    if ( trim((string)$strayOutput) !== "" ) {
      appdataCleanupPlusLogTrimmedOutput($context . " output", $strayOutput);
    }
  }

  return $result;
}

function ensureAppdataCleanupPlusDockerClientLoaded() {
  static $loadedByPath = array();
  $dockerClientPath = appdataCleanupPlusDockerClientPath();

  if ( isset($loadedByPath[$dockerClientPath]) ) {
    return $loadedByPath[$dockerClientPath];
  }

  if ( class_exists("DockerClient", false) ) {
    $loadedByPath[$dockerClientPath] = true;
    return true;
  }

  if ( ! $dockerClientPath || ! is_file($dockerClientPath) ) {
    $loadedByPath[$dockerClientPath] = false;
    return false;
  }

  try {
    appdataCleanupPlusRunQuietly(function() use ($dockerClientPath) {
      require_once($dockerClientPath);
    }, "DockerClient include");
  } catch ( Throwable $throwable ) {
    error_log("Appdata Cleanup Plus could not load DockerClient from " . $dockerClientPath . ": " . $throwable->getMessage());
    $loadedByPath[$dockerClientPath] = false;
    return false;
  }

  $loadedByPath[$dockerClientPath] = class_exists("DockerClient", false);

  if ( ! $loadedByPath[$dockerClientPath] ) {
    error_log("Appdata Cleanup Plus could not find DockerClient after loading " . $dockerClientPath . ".");
  }

  return $loadedByPath[$dockerClientPath];
}

function appdataCleanupPlusNormalizeDockerRecord($record) {
  if ( is_object($record) ) {
    return get_object_vars($record);
  }

  return is_array($record) ? $record : array();
}

function appdataCleanupPlusExtractDockerVolumeHostPath($volume) {
  $record = appdataCleanupPlusNormalizeDockerRecord($volume);

  if ( is_string($volume) ) {
    $parts = explode(":", trim((string)$volume));
    return isset($parts[0]) ? trim((string)$parts[0]) : "";
  }

  if ( empty($record) ) {
    return "";
  }

  foreach ( array("HostDir", "host_volume", "Source", "source", "HostPath", "hostPath", "Bind", "bind") as $key ) {
    if ( ! empty($record[$key]) && is_string($record[$key]) ) {
      return trim((string)$record[$key]);
    }
  }

  if ( ! empty($record["Volume"]) && is_string($record["Volume"]) ) {
    $parts = explode(":", trim((string)$record["Volume"]));
    return isset($parts[0]) ? trim((string)$parts[0]) : "";
  }

  return "";
}

function appdataCleanupPlusExtractDockerVolumeHostPaths($containers) {
  $paths = array();

  foreach ( $containers as $container ) {
    $containerRecord = appdataCleanupPlusNormalizeDockerRecord($container);
    $volumeSets = array();

    foreach ( array("Volumes", "Mounts", "Binds") as $key ) {
      if ( ! empty($containerRecord[$key]) ) {
        $volumeSets[] = $containerRecord[$key];
      }
    }

    foreach ( $volumeSets as $volumeSet ) {
      foreach ( (array)$volumeSet as $volume ) {
        $hostPath = appdataCleanupPlusExtractDockerVolumeHostPath($volume);

        if ( $hostPath !== "" ) {
          $paths[normalizeUserPath($hostPath)] = true;
          $paths[normalizeCachePath($hostPath)] = true;
        }
      }
    }
  }

  return array_keys($paths);
}

function getDockerContainersSafe() {
  if ( ! is_dir(appdataCleanupPlusDockerRuntimePath()) || ! ensureAppdataCleanupPlusDockerClientLoaded() ) {
    return array();
  }

  try {
    $containers = appdataCleanupPlusRunQuietly(function() {
      $DockerClient = new DockerClient();
      return $DockerClient->getDockerContainers();
    }, "DockerClient query");

    return is_array($containers) ? $containers : array();
  } catch ( Throwable $throwable ) {
    error_log("Appdata Cleanup Plus Docker query failed: " . $throwable->getMessage());
    return array();
  }
}

function summarizeCandidateValues($values, $limit=2) {
  $values = array_values(array_filter($values, "strlen"));

  if ( empty($values) ) {
    return "";
  }

  natcasesort($values);
  $values = array_values($values);
  $summary = implode(", ", array_slice($values, 0, $limit));

  if ( count($values) > $limit ) {
    $summary .= " +" . (count($values) - $limit) . " more";
  }

  return $summary;
}

function formatBytesLabel($bytes) {
  if ( $bytes === null || $bytes < 0 ) {
    return "Unknown";
  }

  $units = array("B", "KB", "MB", "GB", "TB");
  $value = (float)$bytes;
  $unitIndex = 0;

  while ( $value >= 1024 && $unitIndex < count($units) - 1 ) {
    $value = $value / 1024;
    $unitIndex++;
  }

  if ( $unitIndex === 0 ) {
    return (string)((int)$value) . " " . $units[$unitIndex];
  }

  return number_format($value, $value >= 10 ? 0 : 1) . " " . $units[$unitIndex];
}

function formatDateTimeLabel($timestamp) {
  if ( ! $timestamp ) {
    return "";
  }

  return date("M j, Y g:i A", $timestamp);
}

function formatRelativeAgeLabel($timestamp) {
  if ( ! $timestamp ) {
    return "Unknown";
  }

  $delta = max(0, time() - $timestamp);

  if ( $delta < 60 ) {
    return "Just now";
  }

  if ( $delta < 3600 ) {
    $minutes = max(1, floor($delta / 60));
    return $minutes . " min ago";
  }

  if ( $delta < 86400 ) {
    $hours = max(1, floor($delta / 3600));
    return $hours . " hr ago";
  }

  if ( $delta < 2592000 ) {
    $days = max(1, floor($delta / 86400));
    return $days . " day" . ($days === 1 ? "" : "s") . " ago";
  }

  if ( $delta < 31536000 ) {
    $months = max(1, floor($delta / 2592000));
    return $months . " mo ago";
  }

  $years = max(1, floor($delta / 31536000));
  return $years . " yr ago";
}

function measureDirectoryBytesWithDu($path) {
  if ( ! is_dir($path) ) {
    return null;
  }

  $output = array();
  $returnCode = 1;
  @exec("du -sb " . escapeshellarg($path) . " 2>/dev/null", $output, $returnCode);

  if ( $returnCode !== 0 || empty($output[0]) ) {
    return null;
  }

  $parts = preg_split('/\s+/', trim($output[0]));
  if ( empty($parts[0]) || ! is_numeric($parts[0]) ) {
    return null;
  }

  return (int)$parts[0];
}

function measureDirectoryBytesWithIterator($path) {
  if ( ! is_dir($path) ) {
    return null;
  }

  $size = 0;

  try {
    $iterator = new RecursiveIteratorIterator(
      new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS),
      RecursiveIteratorIterator::SELF_FIRST
    );

    foreach ( $iterator as $item ) {
      if ( $item->isFile() && ! $item->isLink() ) {
        $size += $item->getSize();
      }
    }
  } catch ( Exception $exception ) {
    return null;
  }

  return $size;
}

function measureDirectoryBytes($path) {
  if ( strtoupper(substr(PHP_OS, 0, 3)) === "WIN" ) {
    return measureDirectoryBytesWithIterator($path);
  }

  return measureDirectoryBytesWithDu($path);
}

function collectPathStats($path) {
  $lastModified = @filemtime($path);
  $cached = getCachedAppdataCleanupPlusPathStats($path);
  $sizeBytes = null;
  $normalizedLastModified = $lastModified ? (int)$lastModified : null;

  if ( $cached && isset($cached["sizeBytes"]) ) {
    $cachedLastModified = isset($cached["lastModified"]) ? (int)$cached["lastModified"] : null;

    if ( $cachedLastModified !== null && $cachedLastModified === $normalizedLastModified ) {
      $sizeBytes = (int)$cached["sizeBytes"];
    }
  }

  if ( $sizeBytes === null ) {
    $measuredSize = measureDirectoryBytes($path);

    if ( $measuredSize !== null ) {
      $sizeBytes = (int)$measuredSize;
      setCachedAppdataCleanupPlusPathStats($path, array(
        "sizeBytes" => $sizeBytes,
        "lastModified" => $normalizedLastModified
      ));
    }
  }

  return array(
    "sizeBytes" => $sizeBytes,
    "sizeLabel" => formatBytesLabel($sizeBytes),
    "lastModified" => $normalizedLastModified,
    "lastModifiedIso" => $lastModified ? date("c", $lastModified) : "",
    "lastModifiedLabel" => formatRelativeAgeLabel($lastModified),
    "lastModifiedExact" => formatDateTimeLabel($lastModified)
  );
}

function collectLightweightPathStats($path) {
  $lastModified = @filemtime($path);

  return array(
    "sizeBytes" => null,
    "sizeLabel" => "Unknown",
    "lastModified" => $lastModified ? (int)$lastModified : null,
    "lastModifiedIso" => $lastModified ? date("c", $lastModified) : "",
    "lastModifiedLabel" => formatRelativeAgeLabel($lastModified),
    "lastModifiedExact" => formatDateTimeLabel($lastModified)
  );
}

function candidateSupportsHeavyPathStats($classification, $securityLockReason) {
  return empty($securityLockReason) && ! empty($classification["insideDefaultShare"]);
}

function buildCandidatePathStats($resolvedPath, $classification, $securityLockReason, $includeHeavyStats=true) {
  $canHydrate = candidateSupportsHeavyPathStats($classification, $securityLockReason);
  $pathStats = ($includeHeavyStats && $canHydrate)
    ? collectPathStats($resolvedPath)
    : collectLightweightPathStats($resolvedPath);

  $pathStats["statsPending"] = ! $includeHeavyStats && $canHydrate;
  return $pathStats;
}

function buildCandidateReason($sourceKind, $sourceNames, $targetPaths, $dockerRunning) {
  if ( $sourceKind === "filesystem" ) {
    if ( ! $dockerRunning ) {
      return "Appdata share scan found this folder, but Docker is offline, so active container mappings could not be verified.";
    }

    return "Appdata share scan found this folder, and no saved Docker template or installed container currently references it.";
  }

  $sourceSummary = summarizeCandidateValues($sourceNames);
  $targetSummary = summarizeCandidateValues($targetPaths);
  $sourceLabel = $sourceSummary ? "Saved templates " . $sourceSummary : "Saved Docker templates";

  if ( ! $targetSummary ) {
    $targetSummary = "tracked container paths";
  }

  if ( ! $dockerRunning ) {
    return $sourceLabel . " still reference this folder at " . $targetSummary . ". Docker is offline, so active container mappings could not be verified.";
  }

  return $sourceLabel . " still reference this folder at " . $targetSummary . ", but no installed container currently maps this host path.";
}

function buildAuditOperationLabel($operation) {
  $normalized = strtolower(trim((string)$operation));

  switch ( $normalized ) {
    case "quarantine":
      return "Quarantine";
    case "restore":
      return "Restore";
    case "purge":
      return "Purge";
    case "delete":
    case "cleanup":
      return "Cleanup";
    default:
      return ucfirst($normalized ? $normalized : "cleanup");
  }
}

function normalizeAuditSummary($summary) {
  $defaults = array(
    "ready" => 0,
    "quarantined" => 0,
    "deleted" => 0,
    "restored" => 0,
    "purged" => 0,
    "skipped" => 0,
    "conflicts" => 0,
    "missing" => 0,
    "blocked" => 0,
    "errors" => 0
  );

  if ( ! is_array($summary) ) {
    return $defaults;
  }

  foreach ( $defaults as $key => $defaultValue ) {
    $defaults[$key] = isset($summary[$key]) ? (int)$summary[$key] : $defaultValue;
  }

  return $defaults;
}

function buildLatestAuditMessage($entry) {
  $timestamp = isset($entry["timestamp"]) ? strtotime((string)$entry["timestamp"]) : 0;
  $summary = normalizeAuditSummary(isset($entry["summary"]) ? $entry["summary"] : array());
  $operation = isset($entry["operation"]) ? (string)$entry["operation"] : "cleanup";
  $parts = array();

  if ( ! empty($summary["quarantined"]) ) {
    $parts[] = $summary["quarantined"] . " moved to quarantine";
  }

  if ( ! empty($summary["deleted"]) ) {
    $parts[] = $summary["deleted"] . " deleted";
  }

  if ( ! empty($summary["restored"]) ) {
    $parts[] = $summary["restored"] . " restored";
  }

  if ( ! empty($summary["purged"]) ) {
    $parts[] = $summary["purged"] . " purged";
  }

  if ( ! empty($summary["skipped"]) ) {
    $parts[] = $summary["skipped"] . " skipped";
  }

  if ( ! empty($summary["conflicts"]) ) {
    $parts[] = $summary["conflicts"] . " conflict" . ($summary["conflicts"] === 1 ? "" : "s");
  }

  if ( ! empty($summary["missing"]) ) {
    $parts[] = $summary["missing"] . " already missing";
  }

  if ( ! empty($summary["blocked"]) ) {
    $parts[] = $summary["blocked"] . " blocked";
  }

  if ( ! empty($summary["errors"]) ) {
    $parts[] = $summary["errors"] . " error" . ($summary["errors"] === 1 ? "" : "s");
  }

  if ( empty($parts) ) {
    $parts[] = "no changes recorded";
  }

  $message = "Last " . strtolower(buildAuditOperationLabel($operation)) . " ran " . ($timestamp ? formatDateTimeLabel($timestamp) : "recently") . ". " . ucfirst(implode(", ", $parts)) . ".";

  if ( ! empty($entry["requestedCount"]) ) {
    $requestedCount = (int)$entry["requestedCount"];
    $message .= " " . $requestedCount . " item" . ($requestedCount === 1 ? " was" : "s were") . " submitted.";
  }

  return $message;
}

function buildAuditHistoryRows($limit=0) {
  $history = getAppdataCleanupPlusAuditHistory($limit);
  $rows = array();

  foreach ( $history as $index => $entry ) {
    $timestamp = isset($entry["timestamp"]) ? strtotime((string)$entry["timestamp"]) : 0;
    $summary = normalizeAuditSummary(isset($entry["summary"]) ? $entry["summary"] : array());
    $results = isset($entry["results"]) && is_array($entry["results"]) ? $entry["results"] : array();
    $rows[] = array(
      "id" => isset($entry["timestamp"]) ? sha1((string)$entry["timestamp"] . "|" . $index) : sha1((string)$index),
      "operation" => isset($entry["operation"]) ? (string)$entry["operation"] : "cleanup",
      "operationLabel" => buildAuditOperationLabel(isset($entry["operation"]) ? $entry["operation"] : "cleanup"),
      "timestamp" => isset($entry["timestamp"]) ? (string)$entry["timestamp"] : "",
      "timestampLabel" => $timestamp ? formatDateTimeLabel($timestamp) : "",
      "relativeLabel" => $timestamp ? formatRelativeAgeLabel($timestamp) : "",
      "requestedCount" => isset($entry["requestedCount"]) ? (int)$entry["requestedCount"] : count($results),
      "summary" => $summary,
      "message" => buildLatestAuditMessage($entry),
      "results" => array_values($results)
    );
  }

  return $rows;
}

function appdataCleanupPlusCreateCandidateVolume($hostDir, $sourceKind="template") {
  $normalizedHostDir = normalizeUserPath($hostDir);

  return array(
    "HostDir" => $normalizedHostDir,
    "Names" => array(),
    "Targets" => array(),
    "TemplateRefs" => array(),
    "SourceKind" => $sourceKind,
    "SourceLabel" => $sourceKind === "filesystem" ? "Discovery" : "Template",
    "SourceDisplay" => $sourceKind === "filesystem" ? "Appdata share scan" : ""
  );
}

function buildCandidateMap($allFiles) {
  $availableVolumes = array();

  foreach ( $allFiles as $xmlfile ) {
    try {
      $xml = readAppdataCleanupPlusTemplateFile($xmlfile);
      if ( ! $xml || ! isset($xml["Config"]) || ! is_array($xml["Config"]) ) {
        continue;
      }

      foreach ( $xml["Config"] as $volumeArray ) {
        if ( ! isset($volumeArray["@attributes"]) || ! isset($volumeArray["value"]) ) {
          continue;
        }
        if ( ! isset($volumeArray["@attributes"]["Type"]) || ! isset($volumeArray["@attributes"]["Target"]) ) {
          continue;
        }
        if ( $volumeArray["@attributes"]["Type"] !== "Path" ) {
          continue;
        }

        $hostDir = trim((string)$volumeArray["value"]);
        $targetPath = trim((string)$volumeArray["@attributes"]["Target"]);
        $appName = isset($xml["Name"]) && $xml["Name"] ? trim((string)$xml["Name"]) : basename($hostDir);
        $volumeList = array($hostDir . ":" . $targetPath);

        if ( ! $hostDir || ! $targetPath || ! findAppdata($volumeList) ) {
          continue;
        }

        $candidatePath = normalizeUserPath($hostDir);

        if ( ! isset($availableVolumes[$candidatePath]) ) {
          $availableVolumes[$candidatePath] = appdataCleanupPlusCreateCandidateVolume($candidatePath, "template");
        }

        $availableVolumes[$candidatePath]["Names"][$appName] = true;
        $availableVolumes[$candidatePath]["Targets"][$targetPath] = true;
        $availableVolumes[$candidatePath]["TemplateRefs"][$appName . "|" . $targetPath] = array(
          "name" => $appName,
          "target" => $targetPath,
          "file" => basename($xmlfile)
        );
      }
    } catch ( Throwable $throwable ) {
      error_log("Appdata Cleanup Plus template scan skipped " . basename((string)$xmlfile) . ": " . $throwable->getMessage());
    }
  }

  return $availableVolumes;
}

function resolveAppdataShareScanRoot() {
  $userRoot = getAppdataShareUserPath();

  if ( $userRoot && is_dir($userRoot) ) {
    return $userRoot;
  }

  $cacheRoot = getAppdataShareCachePath();

  if ( $cacheRoot && is_dir($cacheRoot) ) {
    return $cacheRoot;
  }

  if ( $userRoot ) {
    return $userRoot;
  }

  return $cacheRoot;
}

function buildFilesystemCandidateMap($templateVolumes, $containers, $settings, $dockerRunning) {
  $availableVolumes = array();

  if ( ! $dockerRunning ) {
    return $availableVolumes;
  }

  $shareRoot = resolveAppdataShareScanRoot();

  if ( ! $shareRoot || ! is_dir($shareRoot) ) {
    return $availableVolumes;
  }

  $entries = @scandir($shareRoot);

  if ( ! is_array($entries) ) {
    return $availableVolumes;
  }

  $templatePaths = array();
  $installedHostPaths = appdataCleanupPlusExtractDockerVolumeHostPaths($containers);
  $excludedRoots = array();
  $defaultQuarantineRoot = normalizeUserPath(getDefaultAppdataCleanupPlusQuarantineRoot());

  if ( $defaultQuarantineRoot ) {
    $excludedRoots[$defaultQuarantineRoot] = true;
  }

  if ( ! empty($settings["quarantineRoot"]) ) {
    $excludedRoots[normalizeUserPath($settings["quarantineRoot"])] = true;
  }

  foreach ( $templateVolumes as $volume ) {
    if ( empty($volume["HostDir"]) ) {
      continue;
    }

    $templatePaths[] = (string)$volume["HostDir"];
  }

  foreach ( array_diff($entries, array(".", "..")) as $entryName ) {
    $candidatePath = rtrim($shareRoot, "/") . "/" . $entryName;

    if ( ! is_dir($candidatePath) ) {
      continue;
    }

    $candidatePath = normalizeUserPath($candidatePath);

    if ( isset($excludedRoots[$candidatePath]) ) {
      continue;
    }

    if ( appdataCleanupPlusBuildVmManagerLockReason($candidatePath) !== "" ) {
      continue;
    }

    $skipCandidate = false;

    foreach ( $templatePaths as $referencePath ) {
      if ( pathMatchesOrIsDescendant($candidatePath, $referencePath) ) {
        $skipCandidate = true;
        break;
      }
    }

    if ( $skipCandidate ) {
      continue;
    }

    foreach ( $installedHostPaths as $referencePath ) {
      if ( pathMatchesOrIsDescendant($candidatePath, $referencePath) ) {
        $skipCandidate = true;
        break;
      }
    }

    if ( $skipCandidate ) {
      continue;
    }

    $availableVolumes[$candidatePath] = appdataCleanupPlusCreateCandidateVolume($candidatePath, "filesystem");
  }

  return $availableVolumes;
}

function removeVmManagerManagedCandidates($availableVolumes) {
  $filtered = $availableVolumes;

  foreach ( $availableVolumes as $volume ) {
    if ( empty($volume["HostDir"]) ) {
      continue;
    }

    if ( appdataCleanupPlusBuildVmManagerLockReason($volume["HostDir"]) !== "" ) {
      unset($filtered[$volume["HostDir"]]);
    }
  }

  return $filtered;
}

function removeInstalledVolumeMatches($availableVolumes, $containers) {
  foreach ( appdataCleanupPlusExtractDockerVolumeHostPaths($containers) as $hostPath ) {
    unset($availableVolumes[normalizeCachePath($hostPath)]);
    unset($availableVolumes[normalizeUserPath($hostPath)]);
  }

  return $availableVolumes;
}

function filterToExistingCandidates($availableVolumes) {
  $filtered = $availableVolumes;

  foreach ( $availableVolumes as $volume ) {
    $classification = classifyAppdataCandidate($volume["HostDir"]);
    $existingPath = resolveExistingPath($classification);

    if ( ! is_dir($existingPath) ) {
      unset($filtered[$volume["HostDir"]]);
    }
  }

  return $filtered;
}

function removeParentCandidates($availableVolumes) {
  $filtered = $availableVolumes;

  foreach ( $availableVolumes as $volume ) {
    foreach ( $availableVolumes as $testVolume ) {
      if ( $testVolume["HostDir"] === $volume["HostDir"] ) {
        continue;
      }

      if ( pathIsDescendant($volume["HostDir"], $testVolume["HostDir"]) ) {
        unset($filtered[$volume["HostDir"]]);
        break;
      }
    }
  }

  return $filtered;
}

function removeParentsUsedByInstalledContainers($availableVolumes, $containers) {
  $filtered = $availableVolumes;
  $installedHostPaths = appdataCleanupPlusExtractDockerVolumeHostPaths($containers);

  foreach ( $availableVolumes as $candidate ) {
    foreach ( $installedHostPaths as $hostPath ) {
      if ( pathIsDescendant($candidate["HostDir"], $hostPath) ) {
        unset($filtered[$candidate["HostDir"]]);
        break;
      }
    }
  }

  return $filtered;
}

function buildPathSecurityLockReason($resolvedPath) {
  if ( ! is_dir($resolvedPath) ) {
    return "Path no longer exists.";
  }

  $vmManagerLockReason = appdataCleanupPlusBuildVmManagerLockReason($resolvedPath);

  if ( $vmManagerLockReason !== "" ) {
    return $vmManagerLockReason;
  }

  if ( @is_link($resolvedPath) ) {
    return buildSymlinkLockReason($resolvedPath, "Folder");
  }

  if ( pathHasSymlinkSegment($resolvedPath) ) {
    return buildPathSymlinkSegmentLockReason($resolvedPath);
  }

  if ( pathIsMountPoint($resolvedPath) ) {
    return "Mount-point folders are locked for safety.";
  }

  if ( ! @realpath($resolvedPath) ) {
    return "Path could not be canonicalized safely.";
  }

  return "";
}

function applySafetyPolicyToRow($row, $settings) {
  $row["policyLocked"] = false;
  $row["policyReason"] = "";

  if ( ! empty($row["securityLockReason"]) ) {
    $row["policyLocked"] = true;
    $row["policyReason"] = $row["securityLockReason"];
    $row["canDelete"] = false;
    $row["risk"] = "blocked";
    $row["riskLabel"] = "Locked";
    $row["riskReason"] = $row["securityLockReason"];
    return $row;
  }

  if ( $row["risk"] === "review" && empty($settings["allowOutsideShareCleanup"]) ) {
    $row["policyLocked"] = true;
    $row["policyReason"] = "Outside-share cleanup is disabled in Safety settings.";
    $row["canDelete"] = false;
  }

  return $row;
}

function buildCandidateRows($availableVolumes, $dockerRunning, $settings, $includeHeavyStats=true) {
  $rows = array();
  $ignoredCandidates = getIgnoredAppdataCleanupPlusCandidates();

  foreach ( $availableVolumes as $volume ) {
    try {
      $sourceKind = isset($volume["SourceKind"]) ? trim((string)$volume["SourceKind"]) : "template";
      $sourceLabel = isset($volume["SourceLabel"]) && trim((string)$volume["SourceLabel"]) !== ""
        ? trim((string)$volume["SourceLabel"])
        : ($sourceKind === "filesystem" ? "Discovery" : "Template");
      $sourceNames = array_values(array_keys($volume["Names"]));
      $targetPaths = isset($volume["Targets"]) ? array_values(array_keys($volume["Targets"])) : array();
      $templateRefs = isset($volume["TemplateRefs"]) ? array_values($volume["TemplateRefs"]) : array();
      natcasesort($sourceNames);
      natcasesort($targetPaths);
      $sourceNames = array_values($sourceNames);
      $targetPaths = array_values($targetPaths);

      $classification = classifyAppdataCandidate($volume["HostDir"]);
      $resolvedPath = resolveExistingPath($classification);
      $folderName = basename(rtrim($resolvedPath, "/"));
      $sourceSummary = summarizeCandidateValues($sourceNames);
      $sourceDisplay = isset($volume["SourceDisplay"]) ? trim((string)$volume["SourceDisplay"]) : "";
      $targetSummary = summarizeCandidateValues($targetPaths);
      $candidateKey = appdataCleanupPlusCandidateKey($resolvedPath);
      $ignoredEntry = isset($ignoredCandidates[$candidateKey]) && is_array($ignoredCandidates[$candidateKey]) ? $ignoredCandidates[$candidateKey] : null;
      $ignoredAt = $ignoredEntry && ! empty($ignoredEntry["ignoredAt"]) ? strtotime((string)$ignoredEntry["ignoredAt"]) : 0;
      $securityLockReason = buildPathSecurityLockReason($resolvedPath);
      $pathStats = buildCandidatePathStats($resolvedPath, $classification, $securityLockReason, $includeHeavyStats);
      $realPath = @realpath($resolvedPath);

      if ( ! $sourceDisplay ) {
        if ( $sourceSummary ) {
          $sourceDisplay = $sourceSummary;
        } elseif ( $sourceKind === "filesystem" ) {
          $sourceDisplay = "Appdata share scan";
        } else {
          $sourceDisplay = "Saved Docker templates";
        }
      }

      if ( ! $sourceSummary ) {
        $sourceSummary = $sourceDisplay;
      }

      $row = array(
        "id" => md5($candidateKey),
        "name" => $folderName ? $folderName : $resolvedPath,
        "sourceKind" => $sourceKind,
        "sourceLabel" => $sourceLabel,
        "sourceDisplay" => $sourceDisplay,
        "sourceNames" => $sourceNames,
        "sourceSummary" => $sourceSummary,
        "sourceCount" => count($sourceNames),
        "targetPaths" => $targetPaths,
        "targetSummary" => $targetSummary,
        "targetCount" => count($targetPaths),
        "templateRefs" => $templateRefs,
        "path" => $resolvedPath,
        "displayPath" => $resolvedPath,
        "realPath" => $realPath ? $realPath : "",
        "risk" => $classification["risk"],
        "riskLabel" => $classification["riskLabel"],
        "riskReason" => $classification["riskReason"],
        "reason" => buildCandidateReason($sourceKind, $sourceNames, $targetPaths, $dockerRunning),
        "status" => $dockerRunning ? "orphaned" : "docker_offline",
        "statusLabel" => $dockerRunning ? "Orphaned" : "Docker offline",
        "canDelete" => $classification["canDelete"],
        "insideDefaultShare" => $classification["insideDefaultShare"],
        "shareName" => $classification["shareName"],
        "depth" => $classification["depth"],
        "sizeBytes" => $pathStats["sizeBytes"],
        "sizeLabel" => $pathStats["sizeLabel"],
        "lastModified" => $pathStats["lastModified"],
        "lastModifiedIso" => $pathStats["lastModifiedIso"],
        "lastModifiedLabel" => $pathStats["lastModifiedLabel"],
        "lastModifiedExact" => $pathStats["lastModifiedExact"],
        "statsPending" => ! empty($pathStats["statsPending"]),
        "securityLockReason" => $securityLockReason,
        "policyLocked" => false,
        "policyReason" => "",
        "ignored" => false,
        "ignoredAt" => "",
        "ignoredAtLabel" => "",
        "ignoredReason" => ""
      );

      if ( $ignoredEntry ) {
        $row["ignored"] = true;
        $row["ignoredAt"] = ! empty($ignoredEntry["ignoredAt"]) ? (string)$ignoredEntry["ignoredAt"] : "";
        $row["ignoredAtLabel"] = $ignoredAt ? formatDateTimeLabel($ignoredAt) : "";
        $row["ignoredReason"] = $row["ignoredAtLabel"]
          ? "Ignored on " . $row["ignoredAtLabel"] . ". Restore it to include this folder in cleanup scans again."
          : "This folder is hidden by your ignore list. Restore it to include this folder in cleanup scans again.";
        $row["status"] = "ignored";
        $row["statusLabel"] = "Ignored";
        $row["canDelete"] = false;
      }

      $rows[] = applySafetyPolicyToRow($row, $settings);
    } catch ( Throwable $throwable ) {
      error_log("Appdata Cleanup Plus candidate skipped " . (isset($volume["HostDir"]) ? (string)$volume["HostDir"] : "unknown") . ": " . $throwable->getMessage());
    }
  }

  usort($rows, function($left, $right) {
    return strcasecmp($left["displayPath"], $right["displayPath"]);
  });

  return $rows;
}

function buildSummary($rows) {
  $summary = array(
    "total" => 0,
    "safe" => 0,
    "review" => 0,
    "blocked" => 0,
    "deletable" => 0,
    "ignored" => 0
  );

  foreach ( $rows as $row ) {
    if ( ! empty($row["ignored"]) ) {
      $summary["ignored"]++;
      continue;
    }

    $summary["total"]++;

    if ( isset($summary[$row["risk"]]) ) {
      $summary[$row["risk"]]++;
    }

    if ( ! empty($row["canDelete"]) ) {
      $summary["deletable"]++;
    }
  }

  return $summary;
}

function buildSnapshotCandidateMap($rows) {
  $candidateMap = array();

  foreach ( $rows as $row ) {
    $candidateMap[$row["id"]] = array(
      "id" => $row["id"],
      "name" => $row["name"],
      "path" => $row["path"],
      "displayPath" => $row["displayPath"],
      "realPath" => $row["realPath"],
      "sourceKind" => isset($row["sourceKind"]) ? $row["sourceKind"] : "template",
      "sourceLabel" => isset($row["sourceLabel"]) ? $row["sourceLabel"] : "Template",
      "sourceDisplay" => isset($row["sourceDisplay"]) ? $row["sourceDisplay"] : $row["sourceSummary"],
      "sourceNames" => isset($row["sourceNames"]) ? $row["sourceNames"] : array(),
      "sourceSummary" => $row["sourceSummary"],
      "targetPaths" => isset($row["targetPaths"]) ? $row["targetPaths"] : array(),
      "targetSummary" => $row["targetSummary"],
      "templateRefs" => isset($row["templateRefs"]) ? $row["templateRefs"] : array(),
      "sizeBytes" => $row["sizeBytes"],
      "reason" => isset($row["reason"]) ? $row["reason"] : "",
      "ignored" => ! empty($row["ignored"])
    );
  }

  return $candidateMap;
}

function buildHydratedCandidateStatRow($candidate) {
  $candidateId = isset($candidate["id"]) ? (string)$candidate["id"] : "";
  $candidatePath = isset($candidate["path"]) ? (string)$candidate["path"] : (isset($candidate["displayPath"]) ? (string)$candidate["displayPath"] : "");
  $classification = classifyAppdataCandidate($candidatePath);
  $resolvedPath = resolveExistingPath($classification);
  $securityLockReason = buildPathSecurityLockReason($resolvedPath);
  $pathStats = buildCandidatePathStats($resolvedPath, $classification, $securityLockReason, true);

  return array(
    "id" => $candidateId ? $candidateId : md5(appdataCleanupPlusCandidateKey($resolvedPath)),
    "displayPath" => $resolvedPath,
    "sizeBytes" => $pathStats["sizeBytes"],
    "sizeLabel" => $pathStats["sizeLabel"],
    "lastModified" => $pathStats["lastModified"],
    "lastModifiedIso" => $pathStats["lastModifiedIso"],
    "lastModifiedLabel" => $pathStats["lastModifiedLabel"],
    "lastModifiedExact" => $pathStats["lastModifiedExact"],
    "statsPending" => false
  );
}
