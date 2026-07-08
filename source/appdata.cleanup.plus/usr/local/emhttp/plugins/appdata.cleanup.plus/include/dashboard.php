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

function appdataCleanupPlusDockerEngineReachable() {
  if ( ! is_dir(appdataCleanupPlusDockerRuntimePath()) || ! ensureAppdataCleanupPlusDockerClientLoaded() ) {
    return false;
  }

  try {
    $response = appdataCleanupPlusRunQuietly(function() {
      $DockerClient = new DockerClient();

      if ( method_exists($DockerClient, "getDockerJSON") ) {
        return $DockerClient->getDockerJSON("/version");
      }

      if ( method_exists($DockerClient, "getDockerInfo") ) {
        return $DockerClient->getDockerInfo();
      }

      return array("legacyDockerClient" => true);
    }, "Docker engine health query");

    return is_array($response) || is_object($response);
  } catch ( Throwable $throwable ) {
    error_log("Appdata Cleanup Plus Docker engine health query failed: " . $throwable->getMessage());
    return false;
  }
}

function appdataCleanupPlusComposeProjectsDir() {
  $override = trim((string)getenv("APPDATA_CLEANUP_PLUS_COMPOSE_PROJECTS_DIR"));
  return $override !== "" ? $override : "/boot/config/plugins/compose.manager/projects";
}

function appdataCleanupPlusParseEnvFileIntoMap($path, &$env) {
  if ( ! is_file($path) || ! is_readable($path) ) {
    return true;
  }

  $lines = @file($path, FILE_IGNORE_NEW_LINES);
  if ( ! is_array($lines) ) {
    return false;
  }

  foreach ( $lines as $line ) {
    $line = trim((string)$line);
    if ( $line === "" || strpos($line, "#") === 0 ) {
      continue;
    }

    $equals = strpos($line, "=");
    if ( $equals === false ) {
      continue;
    }

    $key = trim(substr($line, 0, $equals));
    $value = trim(substr($line, $equals + 1));

    if ( strlen($value) >= 2 && ($value[0] === '"' || $value[0] === "'") && substr($value, -1) === $value[0] ) {
      $value = substr($value, 1, -1);
    }

    if ( $key !== "" && ! isset($env[$key]) ) {
      $env[$key] = $value;
    }
  }

  return true;
}

function appdataCleanupPlusExpandComposeEnv($text, $env) {
  for ( $pass = 0; $pass < 2; $pass++ ) {
    $text = preg_replace_callback('/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?-([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/', function($matches) use ($env) {
      $name = isset($matches[1]) && $matches[1] !== "" ? $matches[1] : (isset($matches[3]) ? $matches[3] : "");

      if ( $name !== "" && isset($env[$name]) && $env[$name] !== "" ) {
        return $env[$name];
      }

      if ( isset($matches[2]) && $matches[2] !== "" ) {
        return $matches[2];
      }

      return $matches[0];
    }, $text);
  }

  return $text;
}

function appdataCleanupPlusComposeFileListForProject($projectDir) {
  $baseDir = $projectDir;

  if ( is_file($projectDir . "/indirect") ) {
    $indirect = trim((string)@file_get_contents($projectDir . "/indirect"));
    if ( $indirect !== "" ) {
      $baseDir = rtrim($indirect, "/");
    }
  }

  return array(
    "baseDir" => $baseDir,
    "files" => array_values(array_unique(array(
      $baseDir . "/compose.yaml",
      $baseDir . "/compose.yml",
      $baseDir . "/docker-compose.yaml",
      $baseDir . "/docker-compose.yml",
      $baseDir . "/compose.override.yaml",
      $baseDir . "/compose.override.yml",
      $baseDir . "/docker-compose.override.yaml",
      $baseDir . "/docker-compose.override.yml",
      $projectDir . "/compose.override.yaml",
      $projectDir . "/compose.override.yml",
      $projectDir . "/docker-compose.override.yaml",
      $projectDir . "/docker-compose.override.yml"
    )))
  );
}

function appdataCleanupPlusBuildComposeRootPattern($sourceRoots) {
  $escapedRoots = array();

  foreach ( $sourceRoots as $sourceRoot ) {
    foreach ( appdataCleanupPlusPathComparisonVariants($sourceRoot) as $variant ) {
      $variant = rtrim(appdataCleanupPlusCanonicalizePath($variant), "/");
      if ( $variant !== "" ) {
        $escapedRoots[$variant] = preg_quote($variant, "#");
      }
    }
  }

  if ( empty($escapedRoots) ) {
    return "";
  }

  return "#(" . implode("|", array_values($escapedRoots)) . ")/([^\\s:'\"\\\\]+)#";
}

function appdataCleanupPlusComposeReferencedPaths($settings=null, &$meta=null) {
  $protected = array();
  $projectsDir = appdataCleanupPlusComposeProjectsDir();
  $sourceRoots = getAppdataCleanupPlusConfiguredSourceRoots($settings);
  $pattern = appdataCleanupPlusBuildComposeRootPattern($sourceRoots);
  $projectCount = 0;
  $fileCount = 0;
  $uncertain = false;

  $meta = array(
    "projectsDir" => $projectsDir,
    "projectCount" => 0,
    "fileCount" => 0,
    "protectedCount" => 0,
    "uncertain" => false
  );

  if ( ! is_dir($projectsDir) || $pattern === "" ) {
    return array();
  }

  foreach ( (array)glob($projectsDir . "/*", GLOB_ONLYDIR) as $projectDir ) {
    $projectCount++;
    $fileInfo = appdataCleanupPlusComposeFileListForProject($projectDir);
    $baseDir = isset($fileInfo["baseDir"]) ? (string)$fileInfo["baseDir"] : $projectDir;
    $env = array();

    if ( ! appdataCleanupPlusParseEnvFileIntoMap($baseDir . "/.env", $env) ) {
      $uncertain = true;
    }

    if ( ! appdataCleanupPlusParseEnvFileIntoMap($projectDir . "/.env", $env) ) {
      $uncertain = true;
    }

    foreach ( isset($fileInfo["files"]) ? (array)$fileInfo["files"] : array() as $composeFile ) {
      if ( ! is_file($composeFile) ) {
        continue;
      }

      $contents = @file_get_contents($composeFile);
      if ( ! is_string($contents) ) {
        $uncertain = true;
        continue;
      }

      $fileCount++;
      $contents = appdataCleanupPlusExpandComposeEnv($contents, $env);

      if (
        preg_match('#^[ \t]*-[ \t]*["\']?[^\n:=]*\$\{?[A-Za-z_][^\n:]*:/#m', $contents) ||
        preg_match('#^[ \t]*source[ \t]*:[ \t]*["\']?[^\n]*\$[A-Za-z_{]#m', $contents)
      ) {
        $uncertain = true;
      }

      if ( preg_match_all($pattern, $contents, $matches, PREG_SET_ORDER) ) {
        foreach ( $matches as $match ) {
          $firstSegment = strtok($match[2], "/");
          $fullPath = "";

          if ( $firstSegment === false || $firstSegment === "" ) {
            continue;
          }

          $fullPath = appdataCleanupPlusCanonicalizePath($match[1] . "/" . $firstSegment);
          foreach ( appdataCleanupPlusPathComparisonVariants($fullPath) as $variant ) {
            $variant = appdataCleanupPlusCanonicalizePath($variant);
            if ( $variant !== "" ) {
              $protected[$variant] = true;
              $protected[appdataCleanupPlusPathComparisonKey($variant)] = true;
            }
          }
        }
      }

      if ( preg_match_all('#\$(?:\{[A-Za-z_][A-Za-z0-9_]*(?::?-[^}]*)?\}|[A-Za-z_][A-Za-z0-9_]*)/([A-Za-z0-9][A-Za-z0-9._-]*)#', $contents, $unresolvedMatches, PREG_SET_ORDER) ) {
        foreach ( $unresolvedMatches as $unresolvedMatch ) {
          $segment = $unresolvedMatch[1];
          foreach ( $sourceRoots as $sourceRoot ) {
            $candidate = appdataCleanupPlusCanonicalizePath(rtrim($sourceRoot, "/") . "/" . $segment);
            if ( is_dir($candidate) ) {
              $protected[$candidate] = true;
              $protected[appdataCleanupPlusPathComparisonKey($candidate)] = true;
            }
          }
        }
      }
    }
  }

  $paths = array_values(array_filter(array_keys($protected), "strlen"));
  $meta["projectCount"] = $projectCount;
  $meta["fileCount"] = $fileCount;
  $meta["protectedCount"] = count($paths);
  $meta["uncertain"] = $uncertain;

  return $paths;
}

function removeComposeReferencedCandidates($availableVolumes, $composeProtectedPaths) {
  $filtered = $availableVolumes;
  $protectedKeys = array();

  foreach ( $composeProtectedPaths as $protectedPath ) {
    $key = appdataCleanupPlusPathComparisonKey($protectedPath);
    if ( $key !== "" ) {
      $protectedKeys[$key] = true;
    }
  }

  if ( empty($protectedKeys) ) {
    return $filtered;
  }

  foreach ( $availableVolumes as $candidateKey => $candidate ) {
    $hostDir = isset($candidate["HostDir"]) ? (string)$candidate["HostDir"] : "";
    if ( $hostDir === "" ) {
      continue;
    }

    if ( isset($protectedKeys[appdataCleanupPlusPathComparisonKey($hostDir)]) ) {
      unset($filtered[$candidateKey]);
    }
  }

  return $filtered;
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

  if ( (int)$bytes === 0 ) {
    return "Empty";
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
    $minutes = (int) max(1, floor($delta / 60));
    return $minutes . " minute" . ($minutes === 1 ? "" : "s") . " ago";
  }

  if ( $delta < 86400 ) {
    $hours = (int) max(1, floor($delta / 3600));
    return $hours . " hour" . ($hours === 1 ? "" : "s") . " ago";
  }

  if ( $delta < 2592000 ) {
    $days = (int) max(1, floor($delta / 86400));
    return $days . " day" . ($days === 1 ? "" : "s") . " ago";
  }

  if ( $delta < 31536000 ) {
    $months = (int) max(1, floor($delta / 2592000));
    return $months . " month" . ($months === 1 ? "" : "s") . " ago";
  }

  $years = (int) max(1, floor($delta / 31536000));
  return $years . " year" . ($years === 1 ? "" : "s") . " ago";
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
    $measuredSize = appdataCleanupPlusDirectoryIsEmpty($path)
      ? 0
      : measureDirectoryBytes($path);

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
  return empty($securityLockReason) && ! empty($classification["insideConfiguredSource"]);
}

function buildCandidatePathStats($resolvedPath, $classification, $securityLockReason, $includeHeavyStats=true) {
  $canHydrate = candidateSupportsHeavyPathStats($classification, $securityLockReason);
  $pathStats = ($includeHeavyStats && $canHydrate)
    ? collectPathStats($resolvedPath)
    : collectLightweightPathStats($resolvedPath);

  $pathStats["statsPending"] = ! $includeHeavyStats && $canHydrate;
  return $pathStats;
}

function buildCandidateReason($sourceKind, $sourceNames, $targetPaths, $dockerRunning, $sourceRoot="") {
  if ( $sourceKind === "filesystem" ) {
    $sourceLead = $sourceRoot ? "Configured appdata source '" . $sourceRoot . "'" : "Configured appdata source scan";

    if ( ! $dockerRunning ) {
      return $sourceLead . " found this folder, but Docker is offline, so active container mappings could not be verified.";
    }

    return $sourceLead . " found this folder, and no saved Docker template or installed container currently references it.";
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

function appdataCleanupPlusTemplateActionLockReason($sourceNames=array(), $targetPaths=array()) {
  $sourceSummary = summarizeCandidateValues(is_array($sourceNames) ? $sourceNames : array());
  $targetSummary = summarizeCandidateValues(is_array($targetPaths) ? $targetPaths : array());
  $sourceLabel = $sourceSummary ? "Saved templates " . $sourceSummary : "Saved Docker templates";

  if ( ! $targetSummary ) {
    $targetSummary = "tracked container paths";
  }

  return $sourceLabel . " still point here at " . $targetSummary . ". If you clean this path, reinstalling from that saved template may expect or recreate it.";
}

function appdataCleanupPlusDockerInventoryUnverified($dockerRunning, $containers, $templateVolumes) {
  return ! empty($dockerRunning) &&
    is_array($containers) &&
    count($containers) === 0 &&
    is_array($templateVolumes) &&
    count($templateVolumes) > 0;
}

function appdataCleanupPlusDockerInventoryUnverifiedMessage() {
  return "Docker appears to be running, but Appdata Cleanup Plus could not verify any installed containers while saved Docker templates are present. Cleanup actions are disabled for this scan; refresh Docker state and rescan before quarantining or deleting folders.";
}

function appdataCleanupPlusComposeInventoryUncertainMessage() {
  return "Docker Compose Manager projects include unreadable files or unresolved bind-mount variables. Cleanup actions are disabled for this scan because compose-owned appdata could not be verified safely.";
}

function appdataCleanupPlusApplyDockerInventorySafetyToRows($rows, $message="") {
  $lockedRows = array();
  $lockMessage = $message !== "" ? $message : appdataCleanupPlusDockerInventoryUnverifiedMessage();

  foreach ( is_array($rows) ? $rows : array() as $row ) {
    if ( ! empty($row["ignored"]) ) {
      $lockedRows[] = $row;
      continue;
    }

    $row["scanVerificationLocked"] = true;
    $row["policyLocked"] = true;
    $row["policyReason"] = $lockMessage;
    $row["canDelete"] = false;

    if ( ! isset($row["risk"]) || $row["risk"] !== "blocked" ) {
      $row["risk"] = "blocked";
      $row["riskLabel"] = "Locked";
      $row["riskReason"] = $lockMessage;
    }

    $lockedRows[] = $row;
  }

  return $lockedRows;
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
    case "scheduled-purge":
      return "Scheduled purge";
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
  return buildAuditHistoryRowsFromEntries(getAppdataCleanupPlusAuditHistory($limit));
}

function buildAuditHistoryRowsFromEntries($history) {
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

function appdataCleanupPlusCreateCandidateVolume($hostDir, $sourceKind="template", $sourceDisplay="", $sourceRoot="") {
  $normalizedHostDir = appdataCleanupPlusCanonicalizePath($hostDir);

  return array(
    "HostDir" => $normalizedHostDir,
    "HostDirKey" => appdataCleanupPlusPathComparisonKey($normalizedHostDir),
    "Names" => array(),
    "Targets" => array(),
    "TemplateRefs" => array(),
    "SourceKind" => $sourceKind,
    "SourceRoot" => $sourceRoot !== "" ? appdataCleanupPlusCanonicalizePath($sourceRoot) : "",
    "SourceLabel" => $sourceKind === "filesystem" ? "Discovery" : "Template",
    "SourceDisplay" => $sourceDisplay
  );
}

function buildCandidateMap($allFiles, $settings=array()) {
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

        if ( ! $hostDir || ! $targetPath || ! findAppdata($volumeList, $settings) ) {
          continue;
        }

        $candidatePath = appdataCleanupPlusCanonicalizePath($hostDir);
        $candidateKey = appdataCleanupPlusPathComparisonKey($candidatePath);

        if ( $candidateKey === "" ) {
          continue;
        }

        if ( ! isset($availableVolumes[$candidateKey]) ) {
          $availableVolumes[$candidateKey] = appdataCleanupPlusCreateCandidateVolume($candidatePath, "template");
        }

        $availableVolumes[$candidateKey]["Names"][$appName] = true;
        $availableVolumes[$candidateKey]["Targets"][$targetPath] = true;
        $availableVolumes[$candidateKey]["TemplateRefs"][$appName . "|" . $targetPath] = array(
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
  return getDefaultAppdataCleanupPlusSourceRoot();
}

function appdataCleanupPlusShouldExcludeFilesystemDiscoveryEntry($entryName) {
  $normalizedEntryName = trim((string)$entryName);

  if ( $normalizedEntryName === "" ) {
    return false;
  }

  return in_array(strtolower($normalizedEntryName), array(
    ".recycle.bin",
    "lost+found"
  ), true);
}

function appdataCleanupPlusDirectoryIsEmpty($path) {
  if ( ! is_dir($path) ) {
    return false;
  }

  return count(dirContents($path)) === 0;
}

function appdataCleanupPlusResolveExistingNestedReferencePath($candidatePath, $referencePath) {
  foreach ( appdataCleanupPlusPathComparisonVariants($referencePath) as $referenceVariant ) {
    if ( $referenceVariant === "" || ! pathIsDescendant($candidatePath, $referenceVariant) ) {
      continue;
    }

    if ( is_dir($referenceVariant) ) {
      return $referenceVariant;
    }
  }

  return "";
}

function appdataCleanupPlusBuildEmptyParentRemnantReason($sourceRoot) {
  $sourceLead = $sourceRoot !== "" ? "Configured appdata source '" . $sourceRoot . "'" : "Configured appdata source scan";
  return $sourceLead . " found this empty parent folder after nested appdata mount paths under it were removed.";
}

function appdataCleanupPlusFilesystemDiscoveryCandidateLimit() {
  $override = (int)getenv("APPDATA_CLEANUP_PLUS_FILESYSTEM_CANDIDATE_LIMIT");
  return $override > 0 ? $override : 1000;
}

function appdataCleanupPlusResolveDirectChildPathForSourceRoot($sourceRoot, $referencePath) {
  $normalizedSourceRoot = appdataCleanupPlusCanonicalizePath($sourceRoot);

  if ( $normalizedSourceRoot === "" ) {
    return "";
  }

  foreach ( appdataCleanupPlusPathComparisonVariants($normalizedSourceRoot) as $sourceVariant ) {
    $sourcePrefix = rtrim($sourceVariant, "/");

    if ( $sourcePrefix === "" ) {
      continue;
    }

    foreach ( appdataCleanupPlusPathComparisonVariants($referencePath) as $referenceVariant ) {
      $relativePath = "";
      $segments = array();

      if ( $referenceVariant === "" ) {
        continue;
      }

      if ( $referenceVariant === $sourcePrefix ) {
        return $normalizedSourceRoot;
      }

      if ( ! startsWith($referenceVariant . "/", $sourcePrefix . "/") ) {
        continue;
      }

      $relativePath = ltrim(substr($referenceVariant, strlen($sourcePrefix)), "/");
      if ( $relativePath === "" ) {
        return $normalizedSourceRoot;
      }

      $segments = array_values(array_filter(explode("/", $relativePath), "strlen"));
      if ( empty($segments) ) {
        return $normalizedSourceRoot;
      }

      return appdataCleanupPlusCanonicalizePath($normalizedSourceRoot . "/" . $segments[0]);
    }
  }

  return "";
}

function appdataCleanupPlusBuildSourceRootReferenceIndex($sourceRoot, $referencePaths) {
  $index = array();
  $normalizedSourceRoot = appdataCleanupPlusCanonicalizePath($sourceRoot);

  if ( $normalizedSourceRoot === "" ) {
    return $index;
  }

  foreach ( $referencePaths as $referencePath ) {
    $candidatePath = appdataCleanupPlusResolveDirectChildPathForSourceRoot($normalizedSourceRoot, $referencePath);
    $candidateKey = "";

    if ( $candidatePath === "" || appdataCleanupPlusPathsEquivalent($candidatePath, $normalizedSourceRoot) ) {
      continue;
    }

    $candidateKey = appdataCleanupPlusPathComparisonKey($candidatePath);
    if ( $candidateKey === "" ) {
      continue;
    }

    if ( ! isset($index[$candidateKey]) ) {
      $index[$candidateKey] = array(
        "skipCandidate" => false,
        "hasStaleNestedReference" => false
      );
    }

    if ( appdataCleanupPlusPathsEquivalent($candidatePath, $referencePath) ) {
      $index[$candidateKey]["skipCandidate"] = true;
      continue;
    }

    if ( appdataCleanupPlusResolveExistingNestedReferencePath($candidatePath, $referencePath) !== "" ) {
      $index[$candidateKey]["skipCandidate"] = true;
      continue;
    }

    $index[$candidateKey]["hasStaleNestedReference"] = true;
  }

  return $index;
}

function buildFilesystemCandidateMap($templateVolumes, $containers, $settings, $dockerRunning, &$discoveryMeta=null, $composeProtectedPaths=array()) {
  $availableVolumes = array();
  $templatePaths = array();
  $installedHostPaths = appdataCleanupPlusExtractDockerVolumeHostPaths($containers);
  $nestedReferencePaths = array();
  $referenceIndexBySourceRoot = array();
  $excludedRoots = array();
  $composeProtectedKeys = array();
  $configuredSourceRoots = getAppdataCleanupPlusConfiguredSourceRoots($settings);
  $candidateLimit = appdataCleanupPlusFilesystemDiscoveryCandidateLimit();
  $directChildDirectoryCount = 0;
  $stopDiscovery = false;

  $discoveryMeta = array(
    "candidateLimit" => $candidateLimit,
    "candidateCount" => 0,
    "directChildDirectoryCount" => 0,
    "truncated" => false,
    "truncatedAtSourceRoot" => "",
    "rootMounted" => false,
    "rootMountedPath" => ""
  );

  if ( ! $dockerRunning ) {
    return $availableVolumes;
  }

  $defaultQuarantineRoot = appdataCleanupPlusCanonicalizePath(getDefaultAppdataCleanupPlusQuarantineRoot());

  if ( $defaultQuarantineRoot ) {
    $excludedRoots[appdataCleanupPlusPathComparisonKey($defaultQuarantineRoot)] = true;
  }

  if ( ! empty($settings["quarantineRoot"]) ) {
    $excludedRoots[appdataCleanupPlusPathComparisonKey($settings["quarantineRoot"])] = true;
  }

  foreach ( $templateVolumes as $volume ) {
    if ( empty($volume["HostDir"]) ) {
      continue;
    }

    $templatePaths[] = (string)$volume["HostDir"];
  }

  foreach ( $composeProtectedPaths as $composeProtectedPath ) {
    $composeKey = appdataCleanupPlusPathComparisonKey($composeProtectedPath);
    if ( $composeKey !== "" ) {
      $composeProtectedKeys[$composeKey] = true;
    }
  }

  $nestedReferencePaths = array_values(array_unique(array_merge($templatePaths, $installedHostPaths, $composeProtectedPaths)));

  foreach ( $configuredSourceRoots as $sourceRoot ) {
    $entries = array();
    $referenceIndexKey = "";
    $sourceRootReferenceIndex = array();

    if ( $stopDiscovery ) {
      break;
    }

    if ( ! $sourceRoot || ! is_dir($sourceRoot) ) {
      continue;
    }

    foreach ( $installedHostPaths as $installedHostPath ) {
      if ( appdataCleanupPlusPathsEquivalent($sourceRoot, $installedHostPath) ) {
        $discoveryMeta["rootMounted"] = true;
        $discoveryMeta["rootMountedPath"] = $sourceRoot;
        return $availableVolumes;
      }
    }

    $entries = @scandir($sourceRoot);
    if ( ! is_array($entries) ) {
      continue;
    }

    $excludedRoots[appdataCleanupPlusPathComparisonKey(rtrim($sourceRoot, "/") . "/.appdata-cleanup-plus-quarantine")] = true;
    $referenceIndexKey = appdataCleanupPlusPathComparisonKey($sourceRoot);
    if ( ! isset($referenceIndexBySourceRoot[$referenceIndexKey]) ) {
      $referenceIndexBySourceRoot[$referenceIndexKey] = appdataCleanupPlusBuildSourceRootReferenceIndex($sourceRoot, $nestedReferencePaths);
    }
    $sourceRootReferenceIndex = $referenceIndexBySourceRoot[$referenceIndexKey];

    foreach ( array_diff($entries, array(".", "..")) as $entryName ) {
      $candidatePath = "";
      $candidateKey = "";
      $skipCandidate = false;
      $hasStaleNestedReference = false;

      if ( appdataCleanupPlusShouldExcludeFilesystemDiscoveryEntry($entryName) ) {
        continue;
      }

      $candidatePath = appdataCleanupPlusCanonicalizePath(rtrim($sourceRoot, "/") . "/" . $entryName);

      if ( ! is_dir($candidatePath) ) {
        continue;
      }

      $directChildDirectoryCount++;

      $candidateKey = appdataCleanupPlusPathComparisonKey($candidatePath);

      if ( $candidateKey === "" || isset($excludedRoots[$candidateKey]) ) {
        continue;
      }

      if ( isset($composeProtectedKeys[$candidateKey]) ) {
        continue;
      }

      if ( appdataCleanupPlusBuildManagedSystemLockReason($candidatePath) !== "" ) {
        continue;
      }

      if ( isset($sourceRootReferenceIndex[$candidateKey]) ) {
        $skipCandidate = ! empty($sourceRootReferenceIndex[$candidateKey]["skipCandidate"]);
        $hasStaleNestedReference = ! empty($sourceRootReferenceIndex[$candidateKey]["hasStaleNestedReference"]);
      }

      if ( $skipCandidate || isset($availableVolumes[$candidateKey]) ) {
        continue;
      }

      if ( $hasStaleNestedReference && ! appdataCleanupPlusDirectoryIsEmpty($candidatePath) ) {
        continue;
      }

      if ( count($availableVolumes) >= $candidateLimit ) {
        $discoveryMeta["truncated"] = true;
        $discoveryMeta["truncatedAtSourceRoot"] = $sourceRoot;
        $stopDiscovery = true;
        break;
      }

      $availableVolumes[$candidateKey] = appdataCleanupPlusCreateCandidateVolume($candidatePath, "filesystem", $sourceRoot, $sourceRoot);

      if ( $hasStaleNestedReference ) {
        $availableVolumes[$candidateKey]["ReasonOverride"] = appdataCleanupPlusBuildEmptyParentRemnantReason($sourceRoot);
        $availableVolumes[$candidateKey]["RiskReasonOverride"] = "This empty parent folder sits inside a configured appdata source and no current nested appdata path still exists under it.";
      }
    }
  }

  $discoveryMeta["candidateCount"] = count($availableVolumes);
  $discoveryMeta["directChildDirectoryCount"] = $directChildDirectoryCount;

  return $availableVolumes;
}

function removeVmManagerManagedCandidates($availableVolumes) {
  $filtered = $availableVolumes;

  foreach ( $availableVolumes as $volumeKey => $volume ) {
    if ( empty($volume["HostDir"]) ) {
      continue;
    }

    if ( appdataCleanupPlusBuildManagedSystemLockReason($volume["HostDir"]) !== "" ) {
      unset($filtered[$volumeKey]);
    }
  }

  return $filtered;
}

function removeInstalledVolumeMatches($availableVolumes, $containers) {
  foreach ( appdataCleanupPlusExtractDockerVolumeHostPaths($containers) as $hostPath ) {
    unset($availableVolumes[appdataCleanupPlusPathComparisonKey($hostPath)]);
  }

  return $availableVolumes;
}

function filterToExistingCandidates($availableVolumes) {
  $filtered = $availableVolumes;

  foreach ( $availableVolumes as $volumeKey => $volume ) {
    $classification = classifyAppdataCandidate($volume["HostDir"]);
    $existingPath = resolveExistingPath($classification);

    if ( ! is_dir($existingPath) ) {
      unset($filtered[$volumeKey]);
    }
  }

  return $filtered;
}

function removeParentCandidates($availableVolumes) {
  $filtered = $availableVolumes;
  $variantOwners = array();
  $removeKeys = array();

  foreach ( $availableVolumes as $volumeKey => $volume ) {
    foreach ( appdataCleanupPlusPathComparisonVariants($volume["HostDir"]) as $variant ) {
      $variant = rtrim(appdataCleanupPlusCanonicalizePath($variant), "/");

      if ( $variant === "" ) {
        continue;
      }

      if ( ! isset($variantOwners[$variant]) ) {
        $variantOwners[$variant] = array();
      }

      $variantOwners[$variant][$volumeKey] = true;
    }
  }

  foreach ( $variantOwners as $variant => $owners ) {
    $segments = array_values(array_filter(explode("/", trim($variant, "/")), "strlen"));
    $prefix = "";

    for ( $index = 0; $index < count($segments) - 1; $index++ ) {
      $prefix .= "/" . $segments[$index];

      if ( empty($variantOwners[$prefix]) ) {
        continue;
      }

      foreach ( array_keys($variantOwners[$prefix]) as $parentKey ) {
        foreach ( array_keys($owners) as $childKey ) {
          if ( $parentKey !== $childKey ) {
            $removeKeys[$parentKey] = true;
          }
        }
      }
    }
  }

  foreach ( array_keys($removeKeys) as $removeKey ) {
    unset($filtered[$removeKey]);
  }

  return $filtered;
}

function removeParentsUsedByInstalledContainers($availableVolumes, $containers) {
  $filtered = $availableVolumes;
  $installedHostPaths = appdataCleanupPlusExtractDockerVolumeHostPaths($containers);

  foreach ( $availableVolumes as $candidateKey => $candidate ) {
    foreach ( $installedHostPaths as $hostPath ) {
      if ( pathIsDescendant($candidate["HostDir"], $hostPath) ) {
        unset($filtered[$candidateKey]);
        break;
      }
    }
  }

  return $filtered;
}

function buildPathSecurityLockReason($resolvedPath, $settings=null, $storageMeta=null) {
  if ( ! is_dir($resolvedPath) ) {
    return "Path no longer exists.";
  }

  if ( ! is_array($storageMeta) ) {
    $storageMeta = appdataCleanupPlusResolveStorageForPath($resolvedPath, $settings);
  }

  if ( ! empty($storageMeta["lockReason"]) ) {
    return (string)$storageMeta["lockReason"];
  }

  $managedSystemLockReason = appdataCleanupPlusBuildManagedSystemLockReason($resolvedPath);

  if ( $managedSystemLockReason !== "" ) {
    return $managedSystemLockReason;
  }

  if ( @is_link($resolvedPath) ) {
    return buildSymlinkLockReason($resolvedPath, "Folder");
  }

  if ( pathHasSymlinkSegment($resolvedPath) ) {
    return buildPathSymlinkSegmentLockReason($resolvedPath);
  }

  if ( pathIsMountPoint($resolvedPath) && (! isset($storageMeta["kind"]) || $storageMeta["kind"] !== "zfs") ) {
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

  if ( ! empty($row["ignored"]) ) {
    return $row;
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
      $sourceRoot = isset($volume["SourceRoot"]) ? trim((string)$volume["SourceRoot"]) : "";
      $reasonOverride = isset($volume["ReasonOverride"]) ? trim((string)$volume["ReasonOverride"]) : "";
      $riskReasonOverride = isset($volume["RiskReasonOverride"]) ? trim((string)$volume["RiskReasonOverride"]) : "";
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
      $storageMeta = appdataCleanupPlusResolveStorageForPath($resolvedPath, $settings);
      $zfsMappingMatched = ! empty($storageMeta["mappingMatched"]);
      $zfsResolutionMessage = "";
      $zfsResolutionDetail = isset($storageMeta["resolutionDetail"]) ? trim((string)$storageMeta["resolutionDetail"]) : "";
      $matchedZfsMapping = isset($storageMeta["matchedMapping"]) && is_array($storageMeta["matchedMapping"]) ? $storageMeta["matchedMapping"] : array();
      $securityLockReason = buildPathSecurityLockReason($resolvedPath, $settings, $storageMeta);
      $pathStats = buildCandidatePathStats($resolvedPath, $classification, $securityLockReason, $includeHeavyStats);
      $realPath = @realpath($resolvedPath);

      if ( $zfsMappingMatched && (! isset($storageMeta["kind"]) || $storageMeta["kind"] !== "zfs") ) {
        $zfsResolutionMessage = $zfsResolutionDetail !== ""
          ? $zfsResolutionDetail
          : "A configured ZFS mapping matched this path, but it does not resolve to an exact dataset mountpoint. It will be handled as a normal folder until the dataset mount root matches exactly.";
      }

      if ( ! $sourceDisplay ) {
        if ( $sourceSummary ) {
          $sourceDisplay = $sourceSummary;
        } elseif ( $sourceKind === "filesystem" ) {
          $sourceDisplay = $sourceRoot !== "" ? $sourceRoot : "Configured appdata source";
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
        "sourceRoot" => $sourceRoot,
        "sourceNames" => $sourceNames,
        "sourceSummary" => $sourceSummary,
        "sourceCount" => count($sourceNames),
        "targetPaths" => $targetPaths,
        "targetSummary" => $targetSummary,
        "targetCount" => count($targetPaths),
        "templateRefs" => $templateRefs,
        "storageKind" => isset($storageMeta["kind"]) ? $storageMeta["kind"] : "filesystem",
        "storageLabel" => isset($storageMeta["label"]) ? $storageMeta["label"] : "Filesystem",
        "storageDetail" => isset($storageMeta["detail"]) ? $storageMeta["detail"] : "",
        "datasetName" => isset($storageMeta["datasetName"]) ? $storageMeta["datasetName"] : "",
        "datasetMountpoint" => isset($storageMeta["datasetMountpoint"]) ? $storageMeta["datasetMountpoint"] : "",
        "zfsMappingMatched" => $zfsMappingMatched,
        "zfsResolutionKind" => isset($storageMeta["resolutionKind"]) ? $storageMeta["resolutionKind"] : "",
        "zfsResolutionMessage" => $zfsResolutionMessage,
        "zfsResolutionDetail" => $zfsResolutionDetail,
        "zfsMatchedShareRoot" => isset($matchedZfsMapping["shareRoot"]) ? $matchedZfsMapping["shareRoot"] : "",
        "zfsMatchedDatasetRoot" => isset($matchedZfsMapping["datasetRoot"]) ? $matchedZfsMapping["datasetRoot"] : "",
        "zfsResolutionVariants" => isset($storageMeta["resolutionVariants"]) && is_array($storageMeta["resolutionVariants"]) ? array_values($storageMeta["resolutionVariants"]) : array(),
        "path" => $resolvedPath,
        "displayPath" => $resolvedPath,
        "realPath" => $realPath ? $realPath : "",
        "risk" => $classification["risk"],
        "riskLabel" => $classification["riskLabel"],
        "riskReason" => $riskReasonOverride !== "" ? $riskReasonOverride : $classification["riskReason"],
        "reason" => $reasonOverride !== "" ? $reasonOverride : buildCandidateReason($sourceKind, $sourceNames, $targetPaths, $dockerRunning, $sourceRoot),
        "status" => $dockerRunning ? "orphaned" : "docker_offline",
        "statusLabel" => $dockerRunning ? "Orphaned" : "Docker offline",
        "canDelete" => $classification["canDelete"],
        "insideDefaultShare" => $classification["insideDefaultShare"],
        "insideConfiguredSource" => ! empty($classification["insideConfiguredSource"]),
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
      "sourceRoot" => isset($row["sourceRoot"]) ? $row["sourceRoot"] : "",
      "sourceNames" => isset($row["sourceNames"]) ? $row["sourceNames"] : array(),
      "sourceSummary" => $row["sourceSummary"],
      "targetPaths" => isset($row["targetPaths"]) ? $row["targetPaths"] : array(),
      "targetSummary" => $row["targetSummary"],
      "templateRefs" => isset($row["templateRefs"]) ? $row["templateRefs"] : array(),
      "scanVerificationLocked" => ! empty($row["scanVerificationLocked"]),
      "storageKind" => isset($row["storageKind"]) ? $row["storageKind"] : "filesystem",
      "storageLabel" => isset($row["storageLabel"]) ? $row["storageLabel"] : "Filesystem",
      "storageDetail" => isset($row["storageDetail"]) ? $row["storageDetail"] : "",
      "datasetName" => isset($row["datasetName"]) ? $row["datasetName"] : "",
      "datasetMountpoint" => isset($row["datasetMountpoint"]) ? $row["datasetMountpoint"] : "",
      "zfsMappingMatched" => ! empty($row["zfsMappingMatched"]),
      "zfsResolutionKind" => isset($row["zfsResolutionKind"]) ? $row["zfsResolutionKind"] : "",
      "zfsResolutionMessage" => isset($row["zfsResolutionMessage"]) ? $row["zfsResolutionMessage"] : "",
      "zfsResolutionDetail" => isset($row["zfsResolutionDetail"]) ? $row["zfsResolutionDetail"] : "",
      "zfsMatchedShareRoot" => isset($row["zfsMatchedShareRoot"]) ? $row["zfsMatchedShareRoot"] : "",
      "zfsMatchedDatasetRoot" => isset($row["zfsMatchedDatasetRoot"]) ? $row["zfsMatchedDatasetRoot"] : "",
      "zfsResolutionVariants" => isset($row["zfsResolutionVariants"]) && is_array($row["zfsResolutionVariants"]) ? $row["zfsResolutionVariants"] : array(),
      "sizeBytes" => $row["sizeBytes"],
      "risk" => isset($row["risk"]) ? $row["risk"] : "safe",
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
  $storageMeta = appdataCleanupPlusResolveStorageForPath($resolvedPath);
  $securityLockReason = buildPathSecurityLockReason($resolvedPath, null, $storageMeta);
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

function appdataCleanupPlusBuildCandidateDetailPayload($candidate, $settings=null) {
  $resolvedPath = isset($candidate["path"]) ? (string)$candidate["path"] : (isset($candidate["displayPath"]) ? (string)$candidate["displayPath"] : "");
  $storageMeta = appdataCleanupPlusResolveStorageForPath($resolvedPath, $settings);
  $matchedMapping = isset($storageMeta["matchedMapping"]) && is_array($storageMeta["matchedMapping"]) ? $storageMeta["matchedMapping"] : array();
  $payload = array(
    "id" => isset($candidate["id"]) ? (string)$candidate["id"] : md5(appdataCleanupPlusCandidateKey($resolvedPath)),
    "storageKind" => isset($storageMeta["kind"]) ? $storageMeta["kind"] : (isset($candidate["storageKind"]) ? (string)$candidate["storageKind"] : "filesystem"),
    "storageLabel" => isset($storageMeta["label"]) ? $storageMeta["label"] : (isset($candidate["storageLabel"]) ? (string)$candidate["storageLabel"] : "Filesystem"),
    "storageDetail" => isset($storageMeta["detail"]) ? (string)$storageMeta["detail"] : "",
    "datasetName" => isset($storageMeta["datasetName"]) ? (string)$storageMeta["datasetName"] : "",
    "datasetMountpoint" => isset($storageMeta["datasetMountpoint"]) ? (string)$storageMeta["datasetMountpoint"] : "",
    "zfsMappingMatched" => ! empty($storageMeta["mappingMatched"]),
    "zfsResolutionKind" => isset($storageMeta["resolutionKind"]) ? (string)$storageMeta["resolutionKind"] : "",
    "zfsResolutionDetail" => isset($storageMeta["resolutionDetail"]) ? (string)$storageMeta["resolutionDetail"] : "",
    "zfsMatchedShareRoot" => isset($matchedMapping["shareRoot"]) ? (string)$matchedMapping["shareRoot"] : "",
    "zfsMatchedDatasetRoot" => isset($matchedMapping["datasetRoot"]) ? (string)$matchedMapping["datasetRoot"] : "",
    "zfsResolutionVariants" => isset($storageMeta["resolutionVariants"]) && is_array($storageMeta["resolutionVariants"]) ? array_values($storageMeta["resolutionVariants"]) : array(),
    "zfsPreviewLoaded" => false,
    "zfsPreviewError" => "",
    "zfsRecursiveDestroy" => false,
    "zfsImpactSummary" => "",
    "zfsChildDatasets" => array(),
    "zfsSnapshots" => array(),
    "zfsChildDatasetCount" => 0,
    "zfsSnapshotCount" => 0
  );

  if ( $payload["storageKind"] === "zfs" && $payload["datasetName"] !== "" ) {
    $zfsPreview = appdataCleanupPlusPreviewZfsDatasetDestroy($payload["datasetName"]);

    if ( ! empty($zfsPreview["ok"]) ) {
      $payload["zfsPreviewLoaded"] = true;
      $payload["zfsRecursiveDestroy"] = ! empty($zfsPreview["recursive"]);
      $payload["zfsImpactSummary"] = isset($zfsPreview["impactSummary"]) ? (string)$zfsPreview["impactSummary"] : "";
      $payload["zfsChildDatasets"] = isset($zfsPreview["childDatasets"]) && is_array($zfsPreview["childDatasets"]) ? array_values($zfsPreview["childDatasets"]) : array();
      $payload["zfsSnapshots"] = isset($zfsPreview["snapshots"]) && is_array($zfsPreview["snapshots"]) ? array_values($zfsPreview["snapshots"]) : array();
      $payload["zfsChildDatasetCount"] = isset($zfsPreview["childDatasetCount"]) ? (int)$zfsPreview["childDatasetCount"] : 0;
      $payload["zfsSnapshotCount"] = isset($zfsPreview["snapshotCount"]) ? (int)$zfsPreview["snapshotCount"] : 0;
    } else {
      $payload["zfsPreviewError"] = isset($zfsPreview["message"]) ? (string)$zfsPreview["message"] : "The current ZFS destroy preview could not be loaded right now.";
    }
  }

  return $payload;
}
