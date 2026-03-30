<?php

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

function normalizeAppdataCleanupPlusQuarantineRecord($record) {
  $sizeBytes = null;

  if ( isset($record["sizeBytes"]) && $record["sizeBytes"] !== "" && $record["sizeBytes"] !== null ) {
    $sizeBytes = (int)$record["sizeBytes"];
  }

  $normalized = array(
    "id" => isset($record["id"]) ? trim((string)$record["id"]) : "",
    "name" => isset($record["name"]) ? trim((string)$record["name"]) : "",
    "sourcePath" => isset($record["sourcePath"]) ? trim((string)$record["sourcePath"]) : "",
    "destination" => isset($record["destination"]) ? trim((string)$record["destination"]) : "",
    "quarantineRoot" => isset($record["quarantineRoot"]) ? rtrim((string)$record["quarantineRoot"], "/") : "",
    "quarantinedAt" => isset($record["quarantinedAt"]) ? trim((string)$record["quarantinedAt"]) : "",
    "sourceSummary" => isset($record["sourceSummary"]) ? trim((string)$record["sourceSummary"]) : "",
    "targetSummary" => isset($record["targetSummary"]) ? trim((string)$record["targetSummary"]) : "",
    "sizeBytes" => $sizeBytes
  );

  if ( ! $normalized["id"] ) {
    $normalized["id"] = appdataCleanupPlusRandomToken();
  }

  if ( ! $normalized["name"] && $normalized["sourcePath"] ) {
    $normalized["name"] = basename(rtrim($normalized["sourcePath"], "/"));
  }

  if ( ! $normalized["quarantinedAt"] ) {
    $normalized["quarantinedAt"] = date("c");
  }

  return $normalized;
}

function registerAppdataCleanupPlusQuarantineRecord($record) {
  $normalized = normalizeAppdataCleanupPlusQuarantineRecord($record);
  $registry = getAppdataCleanupPlusQuarantineRegistry();
  $registry[$normalized["id"]] = $normalized;
  return setAppdataCleanupPlusQuarantineRegistry($registry);
}

function removeAppdataCleanupPlusQuarantineRecord($recordId) {
  $registry = getAppdataCleanupPlusQuarantineRegistry();

  if ( ! isset($registry[$recordId]) ) {
    return true;
  }

  unset($registry[$recordId]);
  return setAppdataCleanupPlusQuarantineRegistry($registry);
}

function pruneMissingAppdataCleanupPlusQuarantineRecords($registry) {
  $nextRegistry = array();
  $removed = false;

  foreach ( $registry as $recordId => $record ) {
    $normalized = normalizeAppdataCleanupPlusQuarantineRecord($record);

    if ( ! $normalized["destination"] || ! is_dir($normalized["destination"]) ) {
      $removed = true;
      continue;
    }

    $nextRegistry[$recordId] = $normalized;
  }

  if ( $removed ) {
    setAppdataCleanupPlusQuarantineRegistry($nextRegistry);
  }

  return $nextRegistry;
}

function buildQuarantineSummary($entries) {
  $summary = array(
    "count" => 0,
    "sizeBytes" => 0
  );

  foreach ( $entries as $entry ) {
    $summary["count"]++;

    if ( isset($entry["sizeBytes"]) && $entry["sizeBytes"] !== null ) {
      $summary["sizeBytes"] += (int)$entry["sizeBytes"];
    }
  }

  $summary["sizeLabel"] = $summary["sizeBytes"] > 0 ? formatBytesLabel($summary["sizeBytes"]) : "0 B";
  return $summary;
}

function getActiveAppdataCleanupPlusQuarantineEntries($includeStats=false) {
  $registry = pruneMissingAppdataCleanupPlusQuarantineRecords(getAppdataCleanupPlusQuarantineRegistry());
  $nextRegistry = $registry;
  $registryDirty = false;
  $entries = array();

  foreach ( $registry as $recordId => $record ) {
    $normalized = normalizeAppdataCleanupPlusQuarantineRecord($record);
    $timestamp = strtotime($normalized["quarantinedAt"]);
    $row = array(
      "id" => $normalized["id"],
      "name" => $normalized["name"],
      "sourcePath" => $normalized["sourcePath"],
      "destination" => $normalized["destination"],
      "quarantineRoot" => $normalized["quarantineRoot"],
      "quarantinedAt" => $normalized["quarantinedAt"],
      "quarantinedAtLabel" => $timestamp ? formatDateTimeLabel($timestamp) : "",
      "quarantinedAgeLabel" => $timestamp ? formatRelativeAgeLabel($timestamp) : "",
      "sourceSummary" => $normalized["sourceSummary"],
      "targetSummary" => $normalized["targetSummary"],
      "sizeBytes" => $normalized["sizeBytes"],
      "sizeLabel" => $normalized["sizeBytes"] !== null ? formatBytesLabel($normalized["sizeBytes"]) : "Unknown"
    );

    if ( $includeStats || $normalized["sizeBytes"] === null ) {
      $stats = collectPathStats($normalized["destination"]);
      $row["sizeBytes"] = $stats["sizeBytes"];
      $row["sizeLabel"] = $stats["sizeLabel"];

      if ( $normalized["sizeBytes"] !== $stats["sizeBytes"] ) {
        $normalized["sizeBytes"] = $stats["sizeBytes"];
        $nextRegistry[$recordId] = $normalized;
        $registryDirty = true;
      }
    }

    $entries[] = $row;
  }

  if ( $registryDirty ) {
    setAppdataCleanupPlusQuarantineRegistry($nextRegistry);
  }

  usort($entries, function($left, $right) {
    return strcmp((string)$right["quarantinedAt"], (string)$left["quarantinedAt"]);
  });

  return $entries;
}

function buildQuarantineManagerPayload($includeEntries=true) {
  $entries = getActiveAppdataCleanupPlusQuarantineEntries($includeEntries);

  return array(
    "summary" => buildQuarantineSummary($entries),
    "entries" => $includeEntries ? $entries : array()
  );
}

function resolveTrackedQuarantineEntries($entryIds) {
  $trackedEntries = getActiveAppdataCleanupPlusQuarantineEntries(false);
  $trackedById = array();
  $resolved = array();

  foreach ( $trackedEntries as $entry ) {
    $trackedById[$entry["id"]] = $entry;
  }

  foreach ( $entryIds as $entryId ) {
    if ( empty($trackedById[$entryId]) ) {
      return array(
        "ok" => false,
        "message" => "One or more quarantine entries are no longer valid. Refresh the manager and try again.",
        "statusCode" => 409
      );
    }

    $resolved[] = $trackedById[$entryId];
  }

  return array(
    "ok" => true,
    "entries" => $resolved
  );
}

function cleanupEmptyQuarantineParents($path, $quarantineRoot) {
  $rootPath = rtrim(normalizeUserPath($quarantineRoot), "/");
  $currentPath = dirname(rtrim((string)$path, "/"));

  while ( $rootPath && $currentPath && $currentPath !== $rootPath && startsWith(normalizeUserPath($currentPath) . "/", $rootPath . "/") ) {
    $contents = @scandir($currentPath);

    if ( ! is_array($contents) || count(array_diff($contents, array(".", ".."))) > 0 ) {
      break;
    }

    if ( ! @rmdir($currentPath) ) {
      break;
    }

    $currentPath = dirname($currentPath);
  }
}

function buildRestorePathSecurityReason($path) {
  $normalized = trim((string)$path);

  if ( ! startsWith($normalized, "/mnt/user/") && ! startsWith($normalized, "/mnt/cache/") ) {
    return "Restore targets must stay inside /mnt/user or /mnt/cache.";
  }

  if ( pathHasSymlinkSegment(dirname($normalized)) ) {
    return "Restore targets containing symlink segments are locked for safety.";
  }

  return "";
}

function buildQuarantineManagerActionSummary($results) {
  $summary = array(
    "restored" => 0,
    "purged" => 0,
    "missing" => 0,
    "blocked" => 0,
    "errors" => 0
  );

  foreach ( $results as $result ) {
    switch ( $result["status"] ) {
      case "restored":
        $summary["restored"]++;
        break;
      case "purged":
        $summary["purged"]++;
        break;
      case "missing":
        $summary["missing"]++;
        break;
      case "blocked":
        $summary["blocked"]++;
        break;
      default:
        $summary["errors"]++;
        break;
    }
  }

  return $summary;
}

function restoreTrackedQuarantineEntry($entry) {
  $sourcePath = isset($entry["sourcePath"]) ? trim((string)$entry["sourcePath"]) : "";
  $destination = isset($entry["destination"]) ? trim((string)$entry["destination"]) : "";
  $quarantineRoot = isset($entry["quarantineRoot"]) ? trim((string)$entry["quarantineRoot"]) : "";
  $securityReason = buildRestorePathSecurityReason($sourcePath);

  if ( $securityReason ) {
    return array(
      "status" => "blocked",
      "message" => $securityReason
    );
  }

  if ( ! $destination || ! is_dir($destination) ) {
    removeAppdataCleanupPlusQuarantineRecord($entry["id"]);
    return array(
      "status" => "missing",
      "message" => "Quarantine path no longer exists."
    );
  }

  if ( file_exists($sourcePath) ) {
    return array(
      "status" => "blocked",
      "message" => "The original path already exists. Move it first before restoring."
    );
  }

  if ( @is_link($destination) || pathHasSymlinkSegment($destination) || pathIsMountPoint($destination) ) {
    return array(
      "status" => "blocked",
      "message" => "This quarantine entry could not be restored safely."
    );
  }

  if ( ! ensureDirectoryExists(dirname($sourcePath)) ) {
    return array(
      "status" => "error",
      "message" => "The original parent folder could not be prepared."
    );
  }

  if ( ! @rename($destination, $sourcePath) ) {
    return array(
      "status" => "error",
      "message" => "Restore failed. The quarantined folder was left in place."
    );
  }

  clearCachedAppdataCleanupPlusPathStats($destination);
  clearCachedAppdataCleanupPlusPathStats($sourcePath);
  removeAppdataCleanupPlusQuarantineRecord($entry["id"]);
  cleanupEmptyQuarantineParents($destination, $quarantineRoot);

  return array(
    "status" => "restored",
    "message" => "Restored to the original location.",
    "destination" => $sourcePath
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

  clearCachedAppdataCleanupPlusPathStats($path);

  return array(
    "ok" => true,
    "message" => "Deleted successfully."
  );
}

function purgeTrackedQuarantineEntry($entry) {
  $destination = isset($entry["destination"]) ? trim((string)$entry["destination"]) : "";
  $quarantineRoot = isset($entry["quarantineRoot"]) ? trim((string)$entry["quarantineRoot"]) : "";

  if ( ! $destination || ! is_dir($destination) ) {
    removeAppdataCleanupPlusQuarantineRecord($entry["id"]);
    return array(
      "status" => "missing",
      "message" => "Quarantine path no longer exists."
    );
  }

  $deleteResult = nativeDeleteDirectory($destination);

  if ( ! $deleteResult["ok"] ) {
    return array(
      "status" => "error",
      "message" => $deleteResult["message"]
    );
  }

  removeAppdataCleanupPlusQuarantineRecord($entry["id"]);
  cleanupEmptyQuarantineParents($destination, $quarantineRoot);

  return array(
    "status" => "purged",
    "message" => "Permanently deleted from quarantine."
  );
}

function executeQuarantineManagerAction($entries, $action) {
  $results = array();

  foreach ( $entries as $entry ) {
    $result = array(
      "id" => $entry["id"],
      "name" => $entry["name"],
      "sourcePath" => $entry["sourcePath"],
      "destination" => $entry["destination"]
    );

    if ( $action === "restore" ) {
      $restoreResult = restoreTrackedQuarantineEntry($entry);
      $results[] = array_merge($result, $restoreResult);
      continue;
    }

    $purgeResult = purgeTrackedQuarantineEntry($entry);
    $results[] = array_merge($result, $purgeResult);
  }

  return array(
    "action" => $action,
    "results" => $results,
    "summary" => buildQuarantineManagerActionSummary($results)
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

function quarantineCandidatePath($candidate, $displayPath, $settings) {
  $destination = buildQuarantineDestination($displayPath, $settings);
  $quarantineRoot = buildCandidateQuarantineRoot($displayPath, $settings);

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
    registerAppdataCleanupPlusQuarantineRecord(array(
      "id" => appdataCleanupPlusRandomToken(),
      "name" => isset($candidate["name"]) ? (string)$candidate["name"] : basename(rtrim($displayPath, "/")),
      "sourcePath" => $displayPath,
      "destination" => $destination,
      "quarantineRoot" => $quarantineRoot,
      "quarantinedAt" => date("c"),
      "sourceSummary" => isset($candidate["sourceSummary"]) ? (string)$candidate["sourceSummary"] : "",
      "targetSummary" => isset($candidate["targetSummary"]) ? (string)$candidate["targetSummary"] : "",
      "sizeBytes" => isset($candidate["sizeBytes"]) && $candidate["sizeBytes"] !== null ? (int)$candidate["sizeBytes"] : null
    ));
    clearCachedAppdataCleanupPlusPathStats($displayPath);
    clearCachedAppdataCleanupPlusPathStats($destination);
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

function isPreviewOperation($operation) {
  return startsWith($operation, "preview_");
}

function getBaseOperation($operation) {
  return isPreviewOperation($operation) ? substr($operation, 8) : $operation;
}

function isSupportedOperation($operation) {
  $baseOperation = getBaseOperation($operation);
  return in_array($baseOperation, array("quarantine", "delete"), true);
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
      $quarantineResult = quarantineCandidatePath($candidate, $resolved["displayPath"], $settings);
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
    "restored" => 0,
    "purged" => 0,
    "missing" => 0,
    "blocked" => 0,
    "errors" => 0
  );

  foreach ( $results as $result ) {
    switch ( $result["status"] ) {
      case "ready":
        $summary["ready"]++;
        break;
      case "quarantined":
        $summary["quarantined"]++;
        break;
      case "deleted":
        $summary["deleted"]++;
        break;
      case "restored":
        $summary["restored"]++;
        break;
      case "purged":
        $summary["purged"]++;
        break;
      case "missing":
        $summary["missing"]++;
        break;
      case "blocked":
        $summary["blocked"]++;
        break;
      default:
        $summary["errors"]++;
        break;
    }
  }

  return $summary;
}
