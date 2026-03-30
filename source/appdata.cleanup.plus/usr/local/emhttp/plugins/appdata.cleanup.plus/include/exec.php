<?php

require_once("/usr/local/emhttp/plugins/dynamix.docker.manager/include/DockerClient.php");
require_once("/usr/local/emhttp/plugins/appdata.cleanup.plus/include/helpers.php");

function jsonResponse($payload, $statusCode=200) {
  http_response_code($statusCode);
  header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
  header("Content-Type: application/json");
  header("Pragma: no-cache");
  header("X-Content-Type-Options: nosniff");
  echo json_encode($payload, JSON_UNESCAPED_SLASHES);
  exit;
}

function getDockerContainersSafe() {
  if ( ! is_dir("/var/lib/docker/tmp") ) {
    return array();
  }

  $DockerClient = new DockerClient();
  return $DockerClient->getDockerContainers();
}

function pathIsDescendant($parentPath, $childPath) {
  $normalizedParent = rtrim(normalizeUserPath($parentPath), "/");
  $normalizedChild = rtrim(normalizeUserPath($childPath), "/");

  if ( ! $normalizedParent || ! $normalizedChild || $normalizedParent === $normalizedChild ) {
    return false;
  }

  return startsWith($normalizedChild . "/", $normalizedParent . "/");
}

function resolveExistingPath($classification) {
  if ( is_dir($classification['userPath']) ) {
    return $classification['userPath'];
  }

  if ( $classification['cachePath'] !== $classification['userPath'] && is_dir($classification['cachePath']) ) {
    return $classification['cachePath'];
  }

  return $classification['path'];
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
  $sizeBytes = measureDirectoryBytes($path);

  return array(
    "sizeBytes" => $sizeBytes,
    "sizeLabel" => formatBytesLabel($sizeBytes),
    "lastModified" => $lastModified ? (int)$lastModified : null,
    "lastModifiedIso" => $lastModified ? date("c", $lastModified) : "",
    "lastModifiedLabel" => formatRelativeAgeLabel($lastModified),
    "lastModifiedExact" => formatDateTimeLabel($lastModified)
  );
}

function pathIsMountPoint($path) {
  $path = rtrim((string)$path, "/");

  if ( ! $path || ! is_dir($path) ) {
    return false;
  }

  $parentPath = dirname($path);
  if ( $parentPath === $path ) {
    return true;
  }

  $pathStat = @stat($path);
  $parentStat = @stat($parentPath);

  if ( ! is_array($pathStat) || ! is_array($parentStat) ) {
    return false;
  }

  return isset($pathStat["dev"], $parentStat["dev"]) && $pathStat["dev"] !== $parentStat["dev"];
}

function pathHasSymlinkSegment($path) {
  $trimmed = trim((string)$path);

  if ( ! $trimmed || $trimmed[0] !== "/" ) {
    return false;
  }

  $segments = array_values(array_filter(explode("/", trim($trimmed, "/")), "strlen"));
  $currentPath = "";

  foreach ( $segments as $segment ) {
    $currentPath .= "/" . $segment;

    if ( @is_link($currentPath) ) {
      return true;
    }
  }

  return false;
}

function inspectDirectoryTreeForUnsafeEntries($path) {
  if ( @is_link($path) ) {
    return "Symlinked folders cannot be acted on here.";
  }

  if ( ! is_dir($path) ) {
    return "Path no longer exists.";
  }

  try {
    $iterator = new RecursiveIteratorIterator(
      new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS),
      RecursiveIteratorIterator::SELF_FIRST
    );

    foreach ( $iterator as $item ) {
      $itemPath = $item->getPathname();

      if ( $item->isLink() ) {
        return "Folders containing symlinks are locked for safety.";
      }

      if ( $item->isDir() && pathIsMountPoint($itemPath) ) {
        return "Folders containing nested mount points are locked for safety.";
      }

      if ( ! $item->isDir() && ! $item->isFile() ) {
        return "Folders containing special filesystem entries are locked for safety.";
      }
    }
  } catch ( Exception $exception ) {
    return "Folder contents could not be inspected safely.";
  }

  return "";
}

function ensureDirectoryExists($path) {
  return ensureAppdataCleanupPlusDirectory($path);
}

function buildCandidateQuarantineRoot($path, $settings) {
  $classification = classifyAppdataCandidate($path);

  if ( ! empty($classification["shareName"]) ) {
    return "/mnt/user/" . $classification["shareName"] . "/.appdata-cleanup-plus-quarantine";
  }

  return isset($settings["quarantineRoot"]) ? rtrim((string)$settings["quarantineRoot"], "/") : getDefaultAppdataCleanupPlusQuarantineRoot();
}

function buildQuarantineDestination($sourcePath, $settings) {
  $rootPath = rtrim(buildCandidateQuarantineRoot($sourcePath, $settings), "/");
  $relativePath = trim(normalizeUserPath($sourcePath), "/");

  if ( ! $rootPath || ! $relativePath ) {
    return "";
  }

  $safeRelativePath = preg_replace('/[^A-Za-z0-9._\/-]+/', '-', $relativePath);
  $safeRelativePath = trim($safeRelativePath, "/");

  if ( ! $safeRelativePath ) {
    return "";
  }

  return $rootPath . "/" . date("Ymd-His") . "/" . $safeRelativePath;
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

function buildLatestAuditMessage($entry) {
  $timestamp = isset($entry['timestamp']) ? strtotime((string)$entry['timestamp']) : 0;
  $summary = isset($entry['summary']) && is_array($entry['summary']) ? $entry['summary'] : array();
  $operation = isset($entry['operation']) ? (string)$entry['operation'] : "cleanup";
  $parts = array();

  if ( ! empty($summary['quarantined']) ) {
    $parts[] = $summary['quarantined'] . " moved to quarantine";
  }

  if ( ! empty($summary['deleted']) ) {
    $parts[] = $summary['deleted'] . " deleted";
  }

  if ( ! empty($summary['missing']) ) {
    $parts[] = $summary['missing'] . " already missing";
  }

  if ( ! empty($summary['blocked']) ) {
    $parts[] = $summary['blocked'] . " blocked";
  }

  if ( ! empty($summary['errors']) ) {
    $parts[] = $summary['errors'] . " error" . ($summary['errors'] === 1 ? "" : "s");
  }

  if ( empty($parts) ) {
    $parts[] = "no changes recorded";
  }

  $label = $operation === "quarantine" ? "quarantine" : "cleanup";
  $message = "Last " . $label . " ran " . ($timestamp ? formatDateTimeLabel($timestamp) : "recently") . ". " . ucfirst(implode(", ", $parts)) . ".";

  if ( ! empty($entry['requestedCount']) ) {
    $message .= " " . $entry['requestedCount'] . " path" . ($entry['requestedCount'] === 1 ? " was" : "s were") . " submitted.";
  }

  return $message;
}

function buildCandidateMap($allFiles) {
  $availableVolumes = array();

  foreach ( $allFiles as $xmlfile ) {
    $xml = readAppdataCleanupPlusTemplateFile($xmlfile);
    if ( ! $xml || ! isset($xml['Config']) || ! is_array($xml['Config']) ) {
      continue;
    }

    foreach ( $xml['Config'] as $volumeArray ) {
      if ( ! isset($volumeArray['@attributes']) || ! isset($volumeArray['value']) ) {
        continue;
      }
      if ( ! isset($volumeArray['@attributes']['Type']) || ! isset($volumeArray['@attributes']['Target']) ) {
        continue;
      }
      if ( $volumeArray['@attributes']['Type'] !== "Path" ) {
        continue;
      }

      $hostDir = trim((string)$volumeArray['value']);
      $targetPath = trim((string)$volumeArray['@attributes']['Target']);
      $appName = isset($xml['Name']) && $xml['Name'] ? trim((string)$xml['Name']) : basename($hostDir);
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

      $availableVolumes[$hostDir]['Names'][$appName] = true;
      $availableVolumes[$hostDir]['Targets'][$targetPath] = true;
      $availableVolumes[$hostDir]['TemplateRefs'][$appName . "|" . $targetPath] = array(
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
    if ( ! isset($installedDocker['Volumes']) || ! is_array($installedDocker['Volumes']) ) {
      continue;
    }

    foreach ( $installedDocker['Volumes'] as $volume ) {
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
    $classification = classifyAppdataCandidate($volume['HostDir']);
    $existingPath = resolveExistingPath($classification);

    if ( ! is_dir($existingPath) ) {
      unset($filtered[$volume['HostDir']]);
    }
  }

  return $filtered;
}

function removeParentCandidates($availableVolumes) {
  $filtered = $availableVolumes;

  foreach ( $availableVolumes as $volume ) {
    foreach ( $availableVolumes as $testVolume ) {
      if ( $testVolume['HostDir'] === $volume['HostDir'] ) {
        continue;
      }

      if ( pathIsDescendant($volume['HostDir'], $testVolume['HostDir']) ) {
        unset($filtered[$volume['HostDir']]);
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
      if ( ! isset($installedDocker['Volumes']) || ! is_array($installedDocker['Volumes']) ) {
        continue;
      }

      foreach ( $installedDocker['Volumes'] as $volume ) {
        $folders = explode(":", $volume);

        if ( pathIsDescendant($candidate['HostDir'], $folders[0]) ) {
          unset($filtered[$candidate['HostDir']]);
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
    $sourceNames = array_values(array_keys($volume['Names']));
    $targetPaths = isset($volume['Targets']) ? array_values(array_keys($volume['Targets'])) : array();
    $templateRefs = isset($volume['TemplateRefs']) ? array_values($volume['TemplateRefs']) : array();
    natcasesort($sourceNames);
    natcasesort($targetPaths);
    $sourceNames = array_values($sourceNames);
    $targetPaths = array_values($targetPaths);

    $classification = classifyAppdataCandidate($volume['HostDir']);
    $resolvedPath = resolveExistingPath($classification);
    $folderName = basename(rtrim($resolvedPath, "/"));
    $sourceSummary = summarizeCandidateValues($sourceNames);
    $targetSummary = summarizeCandidateValues($targetPaths);
    $pathStats = collectPathStats($resolvedPath);
    $candidateKey = appdataCleanupPlusCandidateKey($resolvedPath);
    $ignoredEntry = isset($ignoredCandidates[$candidateKey]) && is_array($ignoredCandidates[$candidateKey]) ? $ignoredCandidates[$candidateKey] : null;
    $ignoredAt = $ignoredEntry && ! empty($ignoredEntry['ignoredAt']) ? strtotime((string)$ignoredEntry['ignoredAt']) : 0;
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
      "risk" => $classification['risk'],
      "riskLabel" => $classification['riskLabel'],
      "riskReason" => $classification['riskReason'],
      "reason" => buildCandidateReason($sourceNames, $targetPaths, $dockerRunning),
      "status" => $dockerRunning ? "orphaned" : "docker_offline",
      "statusLabel" => $dockerRunning ? "Orphaned" : "Docker offline",
      "canDelete" => $classification['canDelete'],
      "insideDefaultShare" => $classification['insideDefaultShare'],
      "shareName" => $classification['shareName'],
      "depth" => $classification['depth'],
      "sizeBytes" => $pathStats['sizeBytes'],
      "sizeLabel" => $pathStats['sizeLabel'],
      "lastModified" => $pathStats['lastModified'],
      "lastModifiedIso" => $pathStats['lastModifiedIso'],
      "lastModifiedLabel" => $pathStats['lastModifiedLabel'],
      "lastModifiedExact" => $pathStats['lastModifiedExact'],
      "securityLockReason" => $securityLockReason,
      "policyLocked" => false,
      "policyReason" => "",
      "ignored" => false,
      "ignoredAt" => "",
      "ignoredAtLabel" => "",
      "ignoredReason" => ""
    );

    if ( $ignoredEntry ) {
      $row['ignored'] = true;
      $row['ignoredAt'] = ! empty($ignoredEntry['ignoredAt']) ? (string)$ignoredEntry['ignoredAt'] : "";
      $row['ignoredAtLabel'] = $ignoredAt ? formatDateTimeLabel($ignoredAt) : "";
      $row['ignoredReason'] = $row['ignoredAtLabel']
        ? "Ignored on " . $row['ignoredAtLabel'] . ". Restore it to include this folder in cleanup scans again."
        : "This folder is hidden by your ignore list. Restore it to include this folder in cleanup scans again.";
      $row['status'] = "ignored";
      $row['statusLabel'] = "Ignored";
      $row['canDelete'] = false;
    }

    $rows[] = applySafetyPolicyToRow($row, $settings);
  }

  usort($rows, function($left, $right) {
    return strcasecmp($left['displayPath'], $right['displayPath']);
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
    if ( ! empty($row['ignored']) ) {
      $summary['ignored']++;
      continue;
    }

    $summary['total']++;

    if ( isset($summary[$row['risk']]) ) {
      $summary[$row['risk']]++;
    }

    if ( ! empty($row['canDelete']) ) {
      $summary['deletable']++;
    }
  }

  return $summary;
}

function buildSnapshotCandidateMap($rows) {
  $candidateMap = array();

  foreach ( $rows as $row ) {
    $candidateMap[$row['id']] = array(
      "id" => $row["id"],
      "path" => $row["path"],
      "displayPath" => $row["displayPath"],
      "realPath" => $row["realPath"],
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

  if ( ! empty($summary['ignored']) ) {
    $notices[] = array(
      "type" => "info",
      "title" => "Ignore list active",
      "message" => $summary['ignored'] . " path" . ($summary['ignored'] === 1 ? " is" : "s are") . " currently hidden from normal cleanup results. Turn on Show ignored to review or restore them."
    );
  }

  if ( $latestAudit ) {
    $notices[] = array(
      "type" => "info",
      "title" => "Last cleanup",
      "message" => buildLatestAuditMessage($latestAudit)
    );
  }

  if ( ! empty($summary['review']) ) {
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

  if ( ! empty($summary['blocked']) ) {
    $notices[] = array(
      "type" => "warning",
      "title" => "Locked paths stay blocked",
      "message" => "Any path that resolves to a share root, mount point, symlinked location, or other unsafe target cannot be acted on here."
    );
  }

  return $notices;
}

function parseCandidateIds($rawIds) {
  $ids = array();

  if ( ! $rawIds ) {
    return $ids;
  }

  $decoded = json_decode($rawIds, true);
  if ( is_array($decoded) ) {
    $ids = $decoded;
  } else {
    $ids = explode("*", $rawIds);
  }

  $cleanIds = array();
  foreach ( $ids as $id ) {
    $id = trim((string)$id);
    if ( $id ) {
      $cleanIds[$id] = true;
    }
  }

  return array_keys($cleanIds);
}

function getRequestedToken() {
  return isset($_POST['scanToken']) ? trim((string)$_POST['scanToken']) : "";
}

function getPostedString($key) {
  if ( ! isset($_POST[$key]) || is_array($_POST[$key]) ) {
    return "";
  }

  return trim((string)$_POST[$key]);
}

function getRequestedOperation() {
  return getPostedString("operation");
}

function getRequestedCsrfToken() {
  if ( ! empty($_SERVER["HTTP_X_APPDATA_CLEANUP_PLUS_CSRF"]) ) {
    return trim((string)$_SERVER["HTTP_X_APPDATA_CLEANUP_PLUS_CSRF"]);
  }

  return isset($_POST["csrfToken"]) ? trim((string)$_POST["csrfToken"]) : "";
}

function getPostedBoolean($key) {
  if ( ! isset($_POST[$key]) ) {
    return false;
  }

  $value = strtolower(trim((string)$_POST[$key]));
  return in_array($value, array("1", "true", "yes", "on"), true);
}

function isPreviewOperation($operation) {
  return startsWith($operation, "preview_");
}

function getBaseOperation($operation) {
  return isPreviewOperation($operation) ? substr($operation, 8) : $operation;
}

function appdataCleanupPlusRequestHost() {
  $host = "";

  if ( ! empty($_SERVER["HTTP_HOST"]) ) {
    $host = (string)$_SERVER["HTTP_HOST"];
  } elseif ( ! empty($_SERVER["SERVER_NAME"]) ) {
    $host = (string)$_SERVER["SERVER_NAME"];
  }

  $host = strtolower(trim($host));
  return preg_replace('/:\d+$/', "", $host);
}

function appdataCleanupPlusUrlHost($url) {
  $host = parse_url((string)$url, PHP_URL_HOST);

  if ( ! is_string($host) || $host === "" ) {
    return "";
  }

  return strtolower($host);
}

function requestTargetsCurrentHost() {
  $expectedHost = appdataCleanupPlusRequestHost();

  if ( ! $expectedHost ) {
    return true;
  }

  foreach ( array("HTTP_ORIGIN", "HTTP_REFERER") as $headerName ) {
    if ( empty($_SERVER[$headerName]) ) {
      continue;
    }

    $headerHost = appdataCleanupPlusUrlHost($_SERVER[$headerName]);
    if ( $headerHost && ! hash_equals($expectedHost, $headerHost) ) {
      return false;
    }
  }

  return true;
}

function isSupportedOperation($operation) {
  $baseOperation = getBaseOperation($operation);
  return in_array($baseOperation, array("quarantine", "delete"), true);
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

function resolveCandidateForAction($candidate, $settings, $baseOperation) {
  $candidatePath = isset($candidate["path"]) ? (string)$candidate["path"] : "";
  $candidateDisplayPath = isset($candidate["displayPath"]) ? (string)$candidate["displayPath"] : $candidatePath;
  $snapshotRealPath = isset($candidate["realPath"]) ? (string)$candidate["realPath"] : "";

  if ( ! $candidatePath ) {
    return array(
      "ok" => false,
      "path" => $candidateDisplayPath,
      "displayPath" => $candidateDisplayPath,
      "status" => "blocked",
      "message" => "Candidate data is incomplete."
    );
  }

  if ( ! empty($candidate["ignored"]) ) {
    return array(
      "ok" => false,
      "path" => $candidatePath,
      "displayPath" => $candidateDisplayPath,
      "status" => "blocked",
      "message" => "Ignored paths must be restored before acting on them."
    );
  }

  $classification = classifyAppdataCandidate($candidatePath);
  $displayPath = resolveExistingPath($classification);
  $currentRealPath = @realpath($displayPath);

  if ( ! is_dir($displayPath) ) {
    return array(
      "ok" => false,
      "path" => $candidatePath,
      "displayPath" => $displayPath,
      "status" => "missing",
      "message" => "Path no longer exists."
    );
  }

  if ( ! $currentRealPath ) {
    return array(
      "ok" => false,
      "path" => $candidatePath,
      "displayPath" => $displayPath,
      "status" => "blocked",
      "message" => "Path could not be canonicalized safely."
    );
  }

  if ( $snapshotRealPath && ! hash_equals($snapshotRealPath, $currentRealPath) ) {
    return array(
      "ok" => false,
      "path" => $candidatePath,
      "displayPath" => $displayPath,
      "status" => "blocked",
      "message" => "Path changed since the last scan. Rescan before continuing."
    );
  }

  if ( @is_link($displayPath) || pathHasSymlinkSegment($displayPath) ) {
    return array(
      "ok" => false,
      "path" => $candidatePath,
      "displayPath" => $displayPath,
      "status" => "blocked",
      "message" => "Symlinked paths cannot be acted on here."
    );
  }

  if ( pathIsMountPoint($displayPath) || pathIsMountPoint($currentRealPath) ) {
    return array(
      "ok" => false,
      "path" => $candidatePath,
      "displayPath" => $displayPath,
      "status" => "blocked",
      "message" => "Mount-point folders cannot be acted on here."
    );
  }

  if ( ! $classification["canDelete"] ) {
    return array(
      "ok" => false,
      "path" => $candidatePath,
      "displayPath" => $displayPath,
      "status" => "blocked",
      "message" => $classification["riskReason"]
    );
  }

  if ( $classification["risk"] === "review" && empty($settings["allowOutsideShareCleanup"]) ) {
    return array(
      "ok" => false,
      "path" => $candidatePath,
      "displayPath" => $displayPath,
      "status" => "blocked",
      "message" => "Outside-share cleanup is disabled in Safety settings."
    );
  }

  if ( $baseOperation === "delete" && empty($settings["enablePermanentDelete"]) ) {
    return array(
      "ok" => false,
      "path" => $candidatePath,
      "displayPath" => $displayPath,
      "status" => "blocked",
      "message" => "Permanent delete mode is disabled."
    );
  }

  $quarantineRoot = buildCandidateQuarantineRoot($displayPath, $settings);
  $normalizedDisplayPath = normalizeUserPath($displayPath);
  $normalizedQuarantineRoot = normalizeUserPath($quarantineRoot);

  if ( $normalizedDisplayPath === $normalizedQuarantineRoot || pathIsDescendant($quarantineRoot, $displayPath) ) {
    return array(
      "ok" => false,
      "path" => $candidatePath,
      "displayPath" => $displayPath,
      "status" => "blocked",
      "message" => "Quarantine folders cannot be acted on here."
    );
  }

  return array(
    "ok" => true,
    "path" => $candidatePath,
    "displayPath" => $displayPath,
    "realPath" => $currentRealPath
  );
}

function quarantineCandidatePath($displayPath, $settings) {
  $destination = buildQuarantineDestination($displayPath, $settings);

  if ( ! $destination ) {
    return array(
      "ok" => false,
      "message" => "Quarantine destination could not be prepared.",
      "destination" => ""
    );
  }

  if ( ! ensureDirectoryExists(dirname($destination)) ) {
    return array(
      "ok" => false,
      "message" => "Quarantine destination could not be created.",
      "destination" => $destination
    );
  }

  if ( @rename($displayPath, $destination) ) {
    return array(
      "ok" => true,
      "message" => "Moved to quarantine.",
      "destination" => $destination
    );
  }

  return array(
    "ok" => false,
    "message" => "Quarantine move failed. The source folder was left in place.",
    "destination" => $destination
  );
}

function nativeDeleteDirectory($path) {
  $unsafeReason = inspectDirectoryTreeForUnsafeEntries($path);

  if ( $unsafeReason ) {
    return array(
      "ok" => false,
      "message" => $unsafeReason
    );
  }

  try {
    $iterator = new RecursiveIteratorIterator(
      new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS),
      RecursiveIteratorIterator::CHILD_FIRST
    );

    foreach ( $iterator as $item ) {
      $itemPath = $item->getPathname();

      if ( $item->isDir() ) {
        if ( ! @rmdir($itemPath) ) {
          return array(
            "ok" => false,
            "message" => "A directory could not be removed cleanly."
          );
        }
      } else {
        if ( ! @unlink($itemPath) ) {
          return array(
            "ok" => false,
            "message" => "A file could not be removed cleanly."
          );
        }
      }
    }
  } catch ( Exception $exception ) {
    return array(
      "ok" => false,
      "message" => "Delete walk did not complete cleanly."
    );
  }

  if ( ! @rmdir($path) ) {
    return array(
      "ok" => false,
      "message" => "The top-level folder could not be removed cleanly."
    );
  }

  return array(
    "ok" => true,
    "message" => "Deleted successfully."
  );
}

function executeCandidateOperation($candidates, $settings, $operation) {
  $results = array();
  $preview = isPreviewOperation($operation);
  $baseOperation = getBaseOperation($operation);

  foreach ( $candidates as $candidate ) {
    $resolved = resolveCandidateForAction($candidate, $settings, $baseOperation);

    if ( ! $resolved["ok"] ) {
      $results[] = array(
        "path" => $resolved["path"],
        "displayPath" => $resolved["displayPath"],
        "status" => $resolved["status"],
        "message" => $resolved["message"]
      );
      continue;
    }

    if ( $preview ) {
      $previewResult = array(
        "path" => $resolved["path"],
        "displayPath" => $resolved["displayPath"],
        "status" => "ready",
        "message" => $baseOperation === "quarantine" ? "Would move to quarantine." : "Would permanently delete."
      );

      if ( $baseOperation === "quarantine" ) {
        $previewResult["destination"] = buildQuarantineDestination($resolved["displayPath"], $settings);
      }

      $results[] = $previewResult;
      continue;
    }

    if ( $baseOperation === "quarantine" ) {
      $quarantineResult = quarantineCandidatePath($resolved["displayPath"], $settings);
      $result = array(
        "path" => $resolved["path"],
        "displayPath" => $resolved["displayPath"],
        "status" => $quarantineResult["ok"] ? "quarantined" : "error",
        "message" => $quarantineResult["message"]
      );

      if ( ! empty($quarantineResult["destination"]) ) {
        $result["destination"] = $quarantineResult["destination"];
      }

      $results[] = $result;
      continue;
    }

    $deleteResult = nativeDeleteDirectory($resolved["displayPath"]);
    $results[] = array(
      "path" => $resolved["path"],
      "displayPath" => $resolved["displayPath"],
      "status" => $deleteResult["ok"] ? "deleted" : "error",
      "message" => $deleteResult["message"]
    );
  }

  return array(
    "preview" => $preview,
    "operation" => $baseOperation,
    "results" => $results,
    "summary" => buildOperationSummary($results)
  );
}

function buildOperationSummary($results) {
  $summary = array(
    "ready" => 0,
    "quarantined" => 0,
    "deleted" => 0,
    "missing" => 0,
    "blocked" => 0,
    "errors" => 0
  );

  foreach ( $results as $result ) {
    switch ( $result['status'] ) {
      case "ready":
        $summary['ready']++;
        break;
      case "quarantined":
        $summary['quarantined']++;
        break;
      case "deleted":
        $summary['deleted']++;
        break;
      case "missing":
        $summary['missing']++;
        break;
      case "blocked":
        $summary['blocked']++;
        break;
      default:
        $summary['errors']++;
        break;
    }
  }

  return $summary;
}

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
    $settings = getAppdataCleanupPlusSafetySettings();
    $latestAudit = getLatestAppdataCleanupPlusAuditEntry();
    $allFiles = glob("/boot/config/plugins/dockerMan/templates-user/*.xml");
    $dockerRunning = is_dir("/var/lib/docker/tmp");
    $containers = getDockerContainersSafe();

    $availableVolumes = buildCandidateMap($allFiles);
    $availableVolumes = removeInstalledVolumeMatches($availableVolumes, $containers);
    $availableVolumes = filterToExistingCandidates($availableVolumes);
    $availableVolumes = removeParentCandidates($availableVolumes);
    $availableVolumes = removeParentsUsedByInstalledContainers($availableVolumes, $containers);

    $rows = buildCandidateRows($availableVolumes, $dockerRunning, $settings);
    $summary = buildSummary($rows);
    $snapshot = writeAppdataCleanupPlusSnapshot(buildSnapshotCandidateMap($rows));

    if ( ! $snapshot ) {
      jsonResponse(array(
        "ok" => false,
        "message" => "A secure scan snapshot could not be created right now."
      ), 500);
    }

    jsonResponse(array(
      "ok" => true,
      "dockerRunning" => $dockerRunning,
      "summary" => $summary,
      "notices" => buildNotices($dockerRunning, $summary, $settings),
      "latestAuditMessage" => $latestAudit ? buildLatestAuditMessage($latestAudit) : "",
      "rows" => $rows,
      "scanToken" => $snapshot["token"],
      "settings" => $settings
    ));
    break;

  case "saveSafetySettings":
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
    break;

  case "updateCandidateState":
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
        if ( ! ignoreAppdataCleanupPlusCandidate($candidate["displayPath"]) ) {
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
    break;

  case "executeCandidateAction":
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
      "summary" => $execution["summary"]
    ));
    break;

  default:
    jsonResponse(array(
      "ok" => false,
      "message" => "Unsupported action."
    ), 400);
}
