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

      $hostDir = $volumeArray['value'];
      $appName = isset($xml['Name']) && $xml['Name'] ? $xml['Name'] : basename($hostDir);
      $volumeList = array($hostDir . ":" . $volumeArray['@attributes']['Target']);

      if ( ! findAppdata($volumeList) ) {
        continue;
      }

      if ( ! isset($availableVolumes[$hostDir]) ) {
        $availableVolumes[$hostDir] = array(
          "HostDir" => $hostDir,
          "Names" => array()
        );
      }

      $availableVolumes[$hostDir]['Names'][$appName] = true;
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

  foreach ( $availableVolumes as $volume ) {
    $sourceNames = array_values(array_keys($volume['Names']));
    natcasesort($sourceNames);
    $sourceNames = array_values($sourceNames);

    $classification = classifyAppdataCandidate($volume['HostDir']);
    $resolvedPath = resolveExistingPath($classification);
    $folderName = basename(rtrim($resolvedPath, "/"));
    $sourceSummary = count($sourceNames) === 1 ? $sourceNames[0] : implode(", ", array_slice($sourceNames, 0, 2));
    if ( count($sourceNames) > 2 ) {
      $sourceSummary .= " +" . (count($sourceNames) - 2) . " more";
    }

    $rows[] = array(
      "id" => md5(normalizeUserPath($resolvedPath)),
      "name" => $folderName ? $folderName : $resolvedPath,
      "sourceNames" => $sourceNames,
      "sourceSummary" => $sourceSummary,
      "sourceCount" => count($sourceNames),
      "path" => $resolvedPath,
      "displayPath" => $resolvedPath,
      "risk" => $classification['risk'],
      "riskLabel" => $classification['riskLabel'],
      "riskReason" => $classification['riskReason'],
      "reason" => $dockerRunning ? "Not used by any currently installed container." : "Docker is offline, so this result is based only on saved templates.",
      "status" => $dockerRunning ? "orphaned" : "docker_offline",
      "statusLabel" => $dockerRunning ? "Orphaned" : "Docker offline",
      "canDelete" => $classification['canDelete'],
      "insideDefaultShare" => $classification['insideDefaultShare'],
      "shareName" => $classification['shareName'],
      "depth" => $classification['depth']
    );
  }

  usort($rows, function($left, $right) {
    return strcasecmp($left['displayPath'], $right['displayPath']);
  });

  return $rows;
}

function buildSummary($rows) {
  $summary = array(
    "total" => count($rows),
    "safe" => 0,
    "review" => 0,
    "blocked" => 0,
    "deletable" => 0
  );

  foreach ( $rows as $row ) {
    if ( isset($summary[$row['risk']]) ) {
      $summary[$row['risk']]++;
    }
    if ( $row['canDelete'] ) {
      $summary['deletable']++;
    }
  }

  return $summary;
}

function buildNotices($dockerRunning, $summary) {
  $notices = array();

  if ( ! $dockerRunning ) {
    $notices[] = array(
      "type" => "warning",
      "title" => "Docker is offline",
      "message" => "Results are based only on saved Docker templates. Review every path before deleting anything."
    );
  }

  if ( $summary['review'] > 0 ) {
    $notices[] = array(
      "type" => "info",
      "title" => "Review outside-share paths carefully",
      "message" => "Some candidates sit outside the configured appdata share and require extra confirmation before delete."
    );
  }

  if ( $summary['blocked'] > 0 ) {
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
