<?php

require_once("/usr/local/emhttp/plugins/dynamix.docker.manager/include/DockerClient.php");
require_once("/usr/local/emhttp/plugins/community.applications/include/helpers.php");
require_once("/usr/local/emhttp/plugins/appdata.cleanup.plus/include/helpers.php");

function jsonResponse($payload, $statusCode=200) {
  http_response_code($statusCode);
  header("Content-Type: application/json");
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
  $parts = array();

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

  $message = "Last cleanup ran " . ($timestamp ? formatDateTimeLabel($timestamp) : "recently") . ". " . ucfirst(implode(", ", $parts)) . ".";

  if ( ! empty($entry['requestedCount']) ) {
    $message .= " " . $entry['requestedCount'] . " path" . ($entry['requestedCount'] === 1 ? " was" : "s were") . " submitted.";
  }

  return $message;
}

function buildCandidateMap($allFiles) {
  $availableVolumes = array();

  foreach ( $allFiles as $xmlfile ) {
    $xml = readXmlFile($xmlfile);
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

function buildCandidateRows($availableVolumes, $dockerRunning) {
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

    $rows[] = $row;
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

function buildNotices($dockerRunning, $summary) {
  $notices = array();
  $latestAudit = getLatestAppdataCleanupPlusAuditEntry();

  if ( ! $dockerRunning ) {
    $notices[] = array(
      "type" => "warning",
      "title" => "Docker is offline",
      "message" => "Results are based only on saved Docker templates. Review every path before deleting anything."
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
    $notices[] = array(
      "type" => "info",
      "title" => "Review outside-share paths carefully",
      "message" => "Some candidates sit outside the configured appdata share and require extra confirmation before delete."
    );
  }

  if ( ! empty($summary['blocked']) ) {
    $notices[] = array(
      "type" => "warning",
      "title" => "Blocked paths are locked",
      "message" => "Any path that resolves to a share root or mount root stays visible for review but cannot be deleted here."
    );
  }

  return $notices;
}

function parseDeletePaths($rawPaths) {
  $paths = array();

  if ( ! $rawPaths ) {
    return $paths;
  }

  $decoded = json_decode($rawPaths, true);
  if ( is_array($decoded) ) {
    $paths = $decoded;
  } else {
    $paths = explode("*", $rawPaths);
  }

  $cleanPaths = array();
  foreach ( $paths as $path ) {
    $path = trim($path);
    if ( $path ) {
      $cleanPaths[$path] = true;
    }
  }

  return array_keys($cleanPaths);
}

function getRequestedPath() {
  return isset($_POST['path']) ? trim((string)$_POST['path']) : "";
}

function deleteCandidatePaths($paths) {
  $results = array();

  foreach ( $paths as $path ) {
    $classification = classifyAppdataCandidate($path);
    $displayPath = resolveExistingPath($classification);

    if ( ! $classification['canDelete'] ) {
      $results[] = array(
        "path" => $path,
        "displayPath" => $displayPath,
        "status" => "blocked",
        "message" => $classification['riskReason']
      );
      continue;
    }

    if ( ! is_dir($displayPath) ) {
      $results[] = array(
        "path" => $path,
        "displayPath" => $displayPath,
        "status" => "missing",
        "message" => "Path no longer exists."
      );
      continue;
    }

    $output = array();
    $returnCode = 0;
    exec("rm -rf " . escapeshellarg($displayPath), $output, $returnCode);

    if ( $returnCode === 0 && ! is_dir($displayPath) ) {
      $results[] = array(
        "path" => $path,
        "displayPath" => $displayPath,
        "status" => "deleted",
        "message" => "Deleted successfully."
      );
      continue;
    }

    $results[] = array(
      "path" => $path,
      "displayPath" => $displayPath,
      "status" => "error",
      "message" => "Delete command did not complete cleanly."
    );
  }

  return $results;
}

function buildDeleteSummary($results) {
  $summary = array(
    "deleted" => 0,
    "missing" => 0,
    "blocked" => 0,
    "errors" => 0
  );

  foreach ( $results as $result ) {
    switch ( $result['status'] ) {
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
$action = isset($_POST['action']) ? $_POST['action'] : "";

switch ( $action ) {
  case "getOrphanAppdata":
    $allFiles = glob("/boot/config/plugins/dockerMan/templates-user/*.xml");
    $dockerRunning = is_dir("/var/lib/docker/tmp");
    $containers = getDockerContainersSafe();

    $availableVolumes = buildCandidateMap($allFiles);
    $availableVolumes = removeInstalledVolumeMatches($availableVolumes, $containers);
    $availableVolumes = filterToExistingCandidates($availableVolumes);
    $availableVolumes = removeParentCandidates($availableVolumes);
    $availableVolumes = removeParentsUsedByInstalledContainers($availableVolumes, $containers);

    $rows = buildCandidateRows($availableVolumes, $dockerRunning);
    $summary = buildSummary($rows);

    jsonResponse(array(
      "ok" => true,
      "dockerRunning" => $dockerRunning,
      "summary" => $summary,
      "notices" => buildNotices($dockerRunning, $summary),
      "rows" => $rows
    ));
    break;

  case "ignoreCandidate":
    $path = getRequestedPath();

    if ( ! $path ) {
      jsonResponse(array(
        "ok" => false,
        "message" => "No path was provided."
      ), 400);
    }

    $classification = classifyAppdataCandidate($path);
    $displayPath = resolveExistingPath($classification);

    if ( ! ignoreAppdataCleanupPlusCandidate($displayPath) ) {
      jsonResponse(array(
        "ok" => false,
        "message" => "The ignore list could not be updated."
      ), 500);
    }

    jsonResponse(array(
      "ok" => true
    ));
    break;

  case "unignoreCandidate":
    $path = getRequestedPath();

    if ( ! $path ) {
      jsonResponse(array(
        "ok" => false,
        "message" => "No path was provided."
      ), 400);
    }

    if ( ! unignoreAppdataCleanupPlusCandidate($path) ) {
      jsonResponse(array(
        "ok" => false,
        "message" => "The ignore list could not be updated."
      ), 500);
    }

    jsonResponse(array(
      "ok" => true
    ));
    break;

  case "deleteAppdata":
    $paths = parseDeletePaths(getPost("paths","no"));

    if ( empty($paths) ) {
      jsonResponse(array(
        "ok" => false,
        "message" => "No paths were selected.",
        "results" => array(),
        "summary" => array("deleted" => 0, "missing" => 0, "blocked" => 0, "errors" => 0)
      ), 400);
    }

    $results = deleteCandidatePaths($paths);
    $summary = buildDeleteSummary($results);
    appendAppdataCleanupPlusAuditEntry(array(
      "timestamp" => date("c"),
      "requestedCount" => count($paths),
      "requestedPaths" => array_values($paths),
      "summary" => $summary,
      "results" => $results
    ));

    jsonResponse(array(
      "ok" => $summary['errors'] === 0,
      "results" => $results,
      "summary" => $summary
    ));
    break;

  default:
    jsonResponse(array(
      "ok" => false,
      "message" => "Unsupported action."
    ), 400);
}
