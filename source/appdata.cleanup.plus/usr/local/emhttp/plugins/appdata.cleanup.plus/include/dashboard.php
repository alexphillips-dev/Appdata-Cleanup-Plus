<?php

$appdataCleanupPlusDockerClientPath = "/usr/local/emhttp/plugins/dynamix.docker.manager/include/DockerClient.php";
if ( ! class_exists("DockerClient") && is_file($appdataCleanupPlusDockerClientPath) ) {
  require_once($appdataCleanupPlusDockerClientPath);
}

function getDockerContainersSafe() {
  if ( ! is_dir("/var/lib/docker/tmp") || ! class_exists("DockerClient") ) {
    return array();
  }

  try {
    $DockerClient = new DockerClient();
    return $DockerClient->getDockerContainers();
  } catch ( Throwable $throwable ) {
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
  $size = measureDirectoryBytesWithDu($path);

  if ( $size !== null ) {
    return $size;
  }

  return measureDirectoryBytesWithIterator($path);
}

function collectPathStats($path) {
  $lastModified = @filemtime($path);
  $cached = getCachedAppdataCleanupPlusPathStats($path);
  $sizeBytes = null;

  if ( $cached && isset($cached["sizeBytes"]) ) {
    $cachedLastModified = isset($cached["lastModified"]) ? (int)$cached["lastModified"] : null;

    if ( $cachedLastModified !== null && $cachedLastModified === ( $lastModified ? (int)$lastModified : null ) ) {
      $sizeBytes = $cached["sizeBytes"];
    }
  }

  if ( $sizeBytes === null ) {
    $sizeBytes = measureDirectoryBytes($path);

    if ( $sizeBytes === null && $cached && isset($cached["sizeBytes"]) ) {
      $sizeBytes = $cached["sizeBytes"];
    } else {
      setCachedAppdataCleanupPlusPathStats($path, array(
        "sizeBytes" => $sizeBytes,
        "lastModified" => $lastModified ? (int)$lastModified : null
      ));
    }
  }

  return array(
    "sizeBytes" => $sizeBytes,
    "sizeLabel" => formatBytesLabel($sizeBytes),
    "lastModified" => $lastModified ? (int)$lastModified : null,
    "lastModifiedIso" => $lastModified ? date("c", $lastModified) : "",
    "lastModifiedLabel" => formatRelativeAgeLabel($lastModified),
    "lastModifiedExact" => formatDateTimeLabel($lastModified)
  );
}

function buildCandidateReason($sourceNames, $targetPaths, $dockerRunning) {
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

function buildCandidateMap($allFiles) {
  $availableVolumes = array();

  foreach ( $allFiles as $xmlfile ) {
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

      if ( ! isset($availableVolumes[$hostDir]) ) {
        $availableVolumes[$hostDir] = array(
          "HostDir" => $hostDir,
          "Names" => array(),
          "Targets" => array(),
          "TemplateRefs" => array()
        );
      }

      $availableVolumes[$hostDir]["Names"][$appName] = true;
      $availableVolumes[$hostDir]["Targets"][$targetPath] = true;
      $availableVolumes[$hostDir]["TemplateRefs"][$appName . "|" . $targetPath] = array(
        "name" => $appName,
        "target" => $targetPath,
        "file" => basename($xmlfile)
      );
    }
  }

  return $availableVolumes;
}

function removeInstalledVolumeMatches($availableVolumes, $containers) {
  foreach ( $containers as $installedDocker ) {
    if ( ! isset($installedDocker["Volumes"]) || ! is_array($installedDocker["Volumes"]) ) {
      continue;
    }

    foreach ( $installedDocker["Volumes"] as $volume ) {
      $folders = explode(":", $volume);
      $cacheFolder = normalizeCachePath($folders[0]);
      $userFolder = normalizeUserPath($folders[0]);
      unset($availableVolumes[$cacheFolder]);
      unset($availableVolumes[$userFolder]);
    }
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

  foreach ( $availableVolumes as $candidate ) {
    foreach ( $containers as $installedDocker ) {
      if ( ! isset($installedDocker["Volumes"]) || ! is_array($installedDocker["Volumes"]) ) {
        continue;
      }

      foreach ( $installedDocker["Volumes"] as $volume ) {
        $folders = explode(":", $volume);

        if ( pathIsDescendant($candidate["HostDir"], $folders[0]) ) {
          unset($filtered[$candidate["HostDir"]]);
          break 2;
        }
      }
    }
  }

  return $filtered;
}

function buildPathSecurityLockReason($resolvedPath) {
  if ( ! is_dir($resolvedPath) ) {
    return "Path no longer exists.";
  }

  if ( @is_link($resolvedPath) ) {
    return "Symlinked folders are locked for safety.";
  }

  if ( pathHasSymlinkSegment($resolvedPath) ) {
    return "Paths containing symlink segments are locked for safety.";
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

function buildCandidateRows($availableVolumes, $dockerRunning, $settings) {
  $rows = array();
  $ignoredCandidates = getIgnoredAppdataCleanupPlusCandidates();

  foreach ( $availableVolumes as $volume ) {
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
    $targetSummary = summarizeCandidateValues($targetPaths);
    $pathStats = collectPathStats($resolvedPath);
    $candidateKey = appdataCleanupPlusCandidateKey($resolvedPath);
    $ignoredEntry = isset($ignoredCandidates[$candidateKey]) && is_array($ignoredCandidates[$candidateKey]) ? $ignoredCandidates[$candidateKey] : null;
    $ignoredAt = $ignoredEntry && ! empty($ignoredEntry["ignoredAt"]) ? strtotime((string)$ignoredEntry["ignoredAt"]) : 0;
    $securityLockReason = buildPathSecurityLockReason($resolvedPath);
    $realPath = @realpath($resolvedPath);

    $row = array(
      "id" => md5($candidateKey),
      "name" => $folderName ? $folderName : $resolvedPath,
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
      "reason" => buildCandidateReason($sourceNames, $targetPaths, $dockerRunning),
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
      "sourceSummary" => $row["sourceSummary"],
      "targetSummary" => $row["targetSummary"],
      "sizeBytes" => $row["sizeBytes"],
      "ignored" => ! empty($row["ignored"])
    );
  }

  return $candidateMap;
}

function buildNotices($dockerRunning, $summary, $settings) {
  $notices = array();
  $latestAudit = getLatestAppdataCleanupPlusAuditEntry();

  if ( ! $dockerRunning ) {
    $notices[] = array(
      "type" => "warning",
      "title" => "Docker is offline",
      "message" => "Results are based only on saved Docker templates. Review every path before acting on anything."
    );
  }

  if ( empty($settings["enablePermanentDelete"]) ) {
    $notices[] = array(
      "type" => "info",
      "title" => "Safe mode is on",
      "message" => "The primary action moves selected folders into quarantine instead of permanently deleting them."
    );
  } else {
    $notices[] = array(
      "type" => "warning",
      "title" => "Permanent delete mode is enabled",
      "message" => "Selected folders will be permanently removed after confirmation. Use this mode carefully."
    );
  }

  if ( ! empty($summary["ignored"]) ) {
    $notices[] = array(
      "type" => "info",
      "title" => "Ignore list active",
      "message" => $summary["ignored"] . " path" . ($summary["ignored"] === 1 ? " is" : "s are") . " currently hidden from normal cleanup results. Turn on Show ignored to review or restore them."
    );
  }

  if ( $latestAudit ) {
    $notices[] = array(
      "type" => "info",
      "title" => "Last cleanup",
      "message" => buildLatestAuditMessage($latestAudit)
    );
  }

  if ( ! empty($summary["review"]) ) {
    if ( empty($settings["allowOutsideShareCleanup"]) ) {
      $notices[] = array(
        "type" => "info",
        "title" => "Outside-share cleanup is disabled",
        "message" => "Review paths stay visible but locked until you explicitly enable outside-share cleanup."
      );
    } else {
      $notices[] = array(
        "type" => "warning",
        "title" => "Outside-share cleanup is enabled",
        "message" => "Review paths sit outside the configured appdata share. Confirm each one carefully before acting."
      );
    }
  }

  if ( ! empty($summary["blocked"]) ) {
    $notices[] = array(
      "type" => "warning",
      "title" => "Locked paths stay blocked",
      "message" => "Any path that resolves to a share root, mount point, symlinked location, or other unsafe target cannot be acted on here."
    );
  }

  return $notices;
}
