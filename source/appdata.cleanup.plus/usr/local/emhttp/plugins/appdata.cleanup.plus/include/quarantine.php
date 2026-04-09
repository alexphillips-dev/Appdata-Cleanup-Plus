<?php

function buildCandidateQuarantineRoot($path, $settings) {
  $classification = classifyAppdataCandidate($path, $settings);

  if ( ! empty($classification["matchedSourceRoot"]) ) {
    return rtrim((string)$classification["matchedSourceRoot"], "/") . "/.appdata-cleanup-plus-quarantine";
  }

  return isset($settings["quarantineRoot"]) ? rtrim((string)$settings["quarantineRoot"], "/") : getDefaultAppdataCleanupPlusQuarantineRoot();
}

function buildQuarantineDestination($sourcePath, $settings) {
  $rootPath = rtrim(buildCandidateQuarantineRoot($sourcePath, $settings), "/");
  $relativePath = trim(appdataCleanupPlusCanonicalizePath($sourcePath), "/");

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

function normalizeAppdataCleanupPlusQuarantinePurgeAt($purgeAt) {
  $rawValue = trim((string)$purgeAt);
  $timestamp = $rawValue !== "" ? strtotime($rawValue) : 0;

  if ( ! $timestamp ) {
    return "";
  }

  return date("c", $timestamp);
}

function buildAppdataCleanupPlusDefaultPurgeAtForTimestamp($settings, $baseTimestamp=0) {
  $defaultPurgeDays = isset($settings["defaultQuarantinePurgeDays"]) ? (int)$settings["defaultQuarantinePurgeDays"] : 0;
  $anchorTimestamp = (int)$baseTimestamp;

  if ( $defaultPurgeDays <= 0 ) {
    return "";
  }

  if ( $anchorTimestamp <= 0 ) {
    $anchorTimestamp = time();
  }

  return date("c", $anchorTimestamp + ($defaultPurgeDays * 86400));
}

function normalizeAppdataCleanupPlusQuarantinePurgeScheduleSource($source, $purgeAt="") {
  $normalizedSource = strtolower(trim((string)$source));
  $normalizedPurgeAt = normalizeAppdataCleanupPlusQuarantinePurgeAt($purgeAt);

  if ( in_array($normalizedSource, array("default", "manual"), true) ) {
    return $normalizedSource;
  }

  return $normalizedPurgeAt !== "" ? "default" : "";
}

function syncTrackedQuarantineEntriesToDefaultPurgeSchedule($settings, $previousSettings=null) {
  $registry = pruneMissingAppdataCleanupPlusQuarantineRecords(getAppdataCleanupPlusQuarantineRegistry());
  $updatedCount = 0;
  $registryDirty = false;

  foreach ( $registry as $recordId => $record ) {
    $normalized = normalizeAppdataCleanupPlusQuarantineRecord($record);
    $quarantinedTimestamp = strtotime($normalized["quarantinedAt"]);
    $defaultPurgeAt = buildAppdataCleanupPlusDefaultPurgeAtForTimestamp($settings, $quarantinedTimestamp);

    if ( $normalized["purgeScheduleSource"] === "manual" ) {
      continue;
    }

    if (
      $previousSettings !== null &&
      $normalized["purgeAt"] !== ""
    ) {
      $previousDefaultPurgeAt = buildAppdataCleanupPlusDefaultPurgeAtForTimestamp($previousSettings, $quarantinedTimestamp);

      if ( $previousDefaultPurgeAt === "" || $normalized["purgeAt"] !== $previousDefaultPurgeAt ) {
        if ( $normalized["purgeScheduleSource"] !== "manual" ) {
          $normalized["purgeScheduleSource"] = "manual";
          $registry[$recordId] = $normalized;
          $registryDirty = true;
        }
        continue;
      }
    }

    if ( $normalized["purgeAt"] === $defaultPurgeAt ) {
      continue;
    }

    $normalized["purgeAt"] = $defaultPurgeAt;
    $normalized["purgeScheduleSource"] = $defaultPurgeAt !== "" ? "default" : "";
    $registry[$recordId] = $normalized;
    $updatedCount++;
    $registryDirty = true;
  }

  if ( $registryDirty ) {
    setAppdataCleanupPlusQuarantineRegistry($registry);
  }

  return array(
    "updatedCount" => $updatedCount
  );
}

function formatAppdataCleanupPlusFutureIntervalLabel($secondsRemaining) {
  $seconds = max(0, (int)$secondsRemaining);
  $units = array(
    array("seconds" => 86400, "suffix" => "d"),
    array("seconds" => 3600, "suffix" => "h"),
    array("seconds" => 60, "suffix" => "m")
  );

  if ( $seconds < 60 ) {
    return "in under 1m";
  }

  foreach ( $units as $unit ) {
    if ( $seconds >= $unit["seconds"] ) {
      $value = (int)floor($seconds / $unit["seconds"]);
      return "in " . $value . $unit["suffix"];
    }
  }

  return "in under 1m";
}

function buildAppdataCleanupPlusScheduledPurgeMeta($purgeAt) {
  $normalizedPurgeAt = normalizeAppdataCleanupPlusQuarantinePurgeAt($purgeAt);
  $timestamp = $normalizedPurgeAt !== "" ? strtotime($normalizedPurgeAt) : 0;
  $secondsRemaining = $timestamp ? ($timestamp - time()) : 0;
  $tone = "is-selected";
  $badgeLabel = "";

  if ( ! $timestamp ) {
    return array(
      "scheduled" => false,
      "purgeAt" => "",
      "purgeAtLabel" => "",
      "purgeBadgeLabel" => "",
      "purgeBadgeTone" => "",
      "purgeDue" => false
    );
  }

  if ( $secondsRemaining <= 0 ) {
    $badgeLabel = "Due now";
    $tone = "is-blocked";
  } else {
    $badgeLabel = "Purges " . formatAppdataCleanupPlusFutureIntervalLabel($secondsRemaining);

    if ( $secondsRemaining <= 3 * 86400 ) {
      $tone = "is-review";
    }
  }

  return array(
    "scheduled" => true,
    "purgeAt" => $normalizedPurgeAt,
    "purgeAtLabel" => formatDateTimeLabel($timestamp),
    "purgeBadgeLabel" => $badgeLabel,
    "purgeBadgeTone" => $tone,
    "purgeDue" => $secondsRemaining <= 0
  );
}

function normalizeAppdataCleanupPlusQuarantineRecord($record) {
  $sizeBytes = null;
  $sourceNames = isset($record["sourceNames"]) && is_array($record["sourceNames"]) ? array_values($record["sourceNames"]) : array();
  $targetPaths = isset($record["targetPaths"]) && is_array($record["targetPaths"]) ? array_values($record["targetPaths"]) : array();
  $templateRefs = isset($record["templateRefs"]) && is_array($record["templateRefs"]) ? array_values($record["templateRefs"]) : array();

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
    "purgeAt" => normalizeAppdataCleanupPlusQuarantinePurgeAt(isset($record["purgeAt"]) ? $record["purgeAt"] : ""),
    "purgeScheduleSource" => normalizeAppdataCleanupPlusQuarantinePurgeScheduleSource(
      isset($record["purgeScheduleSource"]) ? $record["purgeScheduleSource"] : "",
      isset($record["purgeAt"]) ? $record["purgeAt"] : ""
    ),
    "sourceKind" => isset($record["sourceKind"]) ? trim((string)$record["sourceKind"]) : "template",
    "sourceLabel" => isset($record["sourceLabel"]) ? trim((string)$record["sourceLabel"]) : "",
    "sourceDisplay" => isset($record["sourceDisplay"]) ? trim((string)$record["sourceDisplay"]) : "",
    "sourceRoot" => isset($record["sourceRoot"]) ? trim((string)$record["sourceRoot"]) : "",
    "sourceSummary" => isset($record["sourceSummary"]) ? trim((string)$record["sourceSummary"]) : "",
    "targetSummary" => isset($record["targetSummary"]) ? trim((string)$record["targetSummary"]) : "",
    "sourceNames" => $sourceNames,
    "targetPaths" => $targetPaths,
    "templateRefs" => $templateRefs,
    "reason" => isset($record["reason"]) ? trim((string)$record["reason"]) : "",
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

function appdataCleanupPlusQuarantineEntryMarkerFile($destination) {
  $normalizedDestination = rtrim(trim((string)$destination), "/");

  if ( ! $normalizedDestination ) {
    return "";
  }

  return $normalizedDestination . "/.appdata-cleanup-plus-entry.json";
}

function readAppdataCleanupPlusQuarantineEntryMarker($destination) {
  $markerFile = appdataCleanupPlusQuarantineEntryMarkerFile($destination);

  if ( ! $markerFile ) {
    return array();
  }

  $marker = readAppdataCleanupPlusJsonFile($markerFile, array());
  return is_array($marker) ? $marker : array();
}

function writeAppdataCleanupPlusQuarantineEntryMarker($record) {
  $normalized = normalizeAppdataCleanupPlusQuarantineRecord($record);
  $markerFile = appdataCleanupPlusQuarantineEntryMarkerFile($normalized["destination"]);

  if ( ! $markerFile || ! is_dir($normalized["destination"]) ) {
    return false;
  }

  return writeAppdataCleanupPlusJsonFile($markerFile, $normalized);
}

function deleteAppdataCleanupPlusQuarantineEntryMarker($destination) {
  $markerFile = appdataCleanupPlusQuarantineEntryMarkerFile($destination);

  if ( ! $markerFile || ! file_exists($markerFile) ) {
    return true;
  }

  return @unlink($markerFile);
}

function appdataCleanupPlusDiscoverShareStyleQuarantineRoots($baseRoot) {
  $normalizedBaseRoot = rtrim(normalizeUserPath($baseRoot), "/");
  $roots = array();

  if ( ! $normalizedBaseRoot || ! is_dir($normalizedBaseRoot) ) {
    return $roots;
  }

  foreach ( dirContents($normalizedBaseRoot) as $shareName ) {
    $candidateRoot = $normalizedBaseRoot . "/" . trim((string)$shareName, "/") . "/.appdata-cleanup-plus-quarantine";

    if ( is_dir($candidateRoot) ) {
      $roots[normalizeUserPath($candidateRoot)] = $candidateRoot;
    }
  }

  return array_values($roots);
}

function getKnownAppdataCleanupPlusQuarantineRoots($registry=array()) {
  $settings = getAppdataCleanupPlusSafetySettings();
  $configuredStateRoot = appdataCleanupPlusConfiguredStateRoot();
  $shareName = getAppdataShareName();
  $roots = array();

  $candidateRoots = array(
    isset($settings["quarantineRoot"]) ? $settings["quarantineRoot"] : "",
    getDefaultAppdataCleanupPlusQuarantineRoot()
  );

  foreach ( $registry as $record ) {
    if ( ! empty($record["quarantineRoot"]) ) {
      $candidateRoots[] = $record["quarantineRoot"];
    }
  }

  foreach ( $candidateRoots as $candidateRoot ) {
    $normalizedRoot = rtrim(normalizeUserPath($candidateRoot), "/");

    if ( $normalizedRoot && is_dir($normalizedRoot) ) {
      $roots[$normalizedRoot] = $normalizedRoot;
    }
  }

  if ( $configuredStateRoot ) {
    if ( $shareName ) {
      foreach ( array("/mnt/user", "/mnt/cache") as $shareBaseRoot ) {
        $candidateRoot = rtrim(normalizeUserPath($shareBaseRoot), "/") . "/" . $shareName . "/.appdata-cleanup-plus-quarantine";
        $normalizedRoot = rtrim(normalizeUserPath($candidateRoot), "/");

        if ( $normalizedRoot && is_dir($normalizedRoot) ) {
          $roots[$normalizedRoot] = $normalizedRoot;
        }
      }
    }
  } else {
    foreach ( array("/mnt/user", "/mnt/cache") as $shareBaseRoot ) {
      foreach ( appdataCleanupPlusDiscoverShareStyleQuarantineRoots($shareBaseRoot) as $discoveredRoot ) {
        $normalizedRoot = rtrim(normalizeUserPath($discoveredRoot), "/");

        if ( $normalizedRoot ) {
          $roots[$normalizedRoot] = $normalizedRoot;
        }
      }
    }
  }

  return array_values($roots);
}

function appdataCleanupPlusRecoverQuarantineTimestampToIso($timestampKey, $fallbackPath="") {
  $timestampKey = trim((string)$timestampKey);

  if ( preg_match('/^\d{8}-\d{6}$/', $timestampKey) ) {
    $parsed = DateTime::createFromFormat("Ymd-His", $timestampKey);

    if ( $parsed instanceof DateTime ) {
      return $parsed->format("c");
    }
  }

  $fallbackTimestamp = $fallbackPath !== "" ? @filemtime($fallbackPath) : 0;
  return $fallbackTimestamp ? date("c", $fallbackTimestamp) : date("c");
}

function appdataCleanupPlusBuildRecoveredQuarantineRecord($sourcePath, $destination, $quarantineRoot, $quarantinedAt, $marker=array()) {
  $sourcePath = normalizeUserPath($sourcePath);
  $destination = normalizeUserPath($destination);
  $quarantineRoot = rtrim(normalizeUserPath($quarantineRoot), "/");
  $markerRecord = is_array($marker) ? $marker : array();
  $record = array(
    "id" => md5("recovered:" . $destination),
    "name" => basename(rtrim($sourcePath, "/")),
    "sourcePath" => $sourcePath,
    "destination" => $destination,
    "quarantineRoot" => $quarantineRoot,
    "quarantinedAt" => $quarantinedAt,
    "purgeAt" => "",
    "purgeScheduleSource" => "",
    "sourceKind" => "recovered",
    "sourceLabel" => "Recovered",
    "sourceDisplay" => "Recovered from quarantine storage",
    "sourceSummary" => "Recovered from quarantine storage",
    "targetSummary" => "",
    "sourceNames" => array(),
    "targetPaths" => array(),
    "templateRefs" => array(),
    "reason" => "Recovered from existing quarantine storage after plugin state was reset.",
    "sizeBytes" => null
  );

  if ( ! empty($markerRecord) ) {
    $record = array_merge($record, $markerRecord);
    $record["sourcePath"] = $sourcePath;
    $record["destination"] = $destination;
    $record["quarantineRoot"] = $quarantineRoot;
    $record["quarantinedAt"] = $quarantinedAt !== "" ? $quarantinedAt : (isset($record["quarantinedAt"]) ? (string)$record["quarantinedAt"] : "");
  }

  return normalizeAppdataCleanupPlusQuarantineRecord($record);
}

function appdataCleanupPlusRecoverQuarantineRecordsFromRoot($quarantineRoot, $knownDestinations=array()) {
  $normalizedRoot = rtrim(normalizeUserPath($quarantineRoot), "/");
  $recovered = array();
  $markerManagedDestinations = array();

  if ( ! $normalizedRoot || ! is_dir($normalizedRoot) ) {
    return $recovered;
  }

  foreach ( dirContents($normalizedRoot) as $timestampDirName ) {
    $timestampRoot = $normalizedRoot . "/" . trim((string)$timestampDirName, "/");

    if ( ! is_dir($timestampRoot) || is_link($timestampRoot) ) {
      continue;
    }

    try {
      $markerIterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($timestampRoot, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::LEAVES_ONLY
      );
    } catch ( Exception $exception ) {
      continue;
    }

    foreach ( $markerIterator as $markerEntry ) {
      if ( ! $markerEntry->isFile() || $markerEntry->getFilename() !== ".appdata-cleanup-plus-entry.json" ) {
        continue;
      }

      $destination = normalizeUserPath(dirname($markerEntry->getPathname()));
      $destinationKey = normalizeUserPath($destination);

      if ( isset($knownDestinations[$destinationKey]) || ! is_dir($destination) ) {
        continue;
      }

      $markerRecord = readAppdataCleanupPlusQuarantineEntryMarker($destination);
      $sourcePath = isset($markerRecord["sourcePath"]) ? normalizeUserPath($markerRecord["sourcePath"]) : "";

      if ( ! $sourcePath ) {
        continue;
      }

      $quarantinedAt = isset($markerRecord["quarantinedAt"]) && trim((string)$markerRecord["quarantinedAt"]) !== ""
        ? trim((string)$markerRecord["quarantinedAt"])
        : appdataCleanupPlusRecoverQuarantineTimestampToIso($timestampDirName, $destination);

      $recovered[$destinationKey] = appdataCleanupPlusBuildRecoveredQuarantineRecord(
        $sourcePath,
        $destination,
        $normalizedRoot,
        $quarantinedAt,
        $markerRecord
      );
      $knownDestinations[$destinationKey] = true;
      $markerManagedDestinations[$destinationKey] = true;
    }

    try {
      $legacyIterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($timestampRoot, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::SELF_FIRST
      );
    } catch ( Exception $exception ) {
      continue;
    }

    foreach ( $legacyIterator as $legacyEntry ) {
      $destination = normalizeUserPath($legacyEntry->getPathname());
      $destinationKey = normalizeUserPath($destination);
      $relativePath = ltrim(substr($destinationKey, strlen(rtrim(normalizeUserPath($timestampRoot), "/"))), "/");
      $sourcePath = normalizeUserPath("/" . $relativePath);
      $pathSegments = array_values(array_filter(explode("/", trim($sourcePath, "/")), "strlen"));
      $parentSourcePath = dirname($sourcePath);

      if ( ! $legacyEntry->isDir() || $legacyEntry->isLink() ) {
        continue;
      }

      if ( isset($knownDestinations[$destinationKey]) || isset($markerManagedDestinations[$destinationKey]) ) {
        continue;
      }

      if ( ! startsWith($sourcePath, "/mnt/user/") && ! startsWith($sourcePath, "/mnt/cache/") ) {
        continue;
      }

      if ( count($pathSegments) < 4 ) {
        continue;
      }

      if ( file_exists($sourcePath) || ! is_dir($parentSourcePath) ) {
        continue;
      }

      $recovered[$destinationKey] = appdataCleanupPlusBuildRecoveredQuarantineRecord(
        $sourcePath,
        $destination,
        $normalizedRoot,
        appdataCleanupPlusRecoverQuarantineTimestampToIso($timestampDirName, $destination)
      );
      $knownDestinations[$destinationKey] = true;
    }
  }

  return $recovered;
}

function recoverMissingAppdataCleanupPlusQuarantineRecords() {
  $registry = pruneMissingAppdataCleanupPlusQuarantineRecords(getAppdataCleanupPlusQuarantineRegistry());
  $nextRegistry = $registry;
  $knownDestinations = array();
  $registryDirty = false;

  foreach ( $registry as $recordId => $record ) {
    $normalized = normalizeAppdataCleanupPlusQuarantineRecord($record);
    $destinationKey = normalizeUserPath($normalized["destination"]);

    if ( $destinationKey ) {
      $knownDestinations[$destinationKey] = true;
    }

    $nextRegistry[$recordId] = $normalized;
  }

  foreach ( getKnownAppdataCleanupPlusQuarantineRoots($nextRegistry) as $quarantineRoot ) {
    foreach ( appdataCleanupPlusRecoverQuarantineRecordsFromRoot($quarantineRoot, $knownDestinations) as $recoveredRecord ) {
      $normalizedRecovered = normalizeAppdataCleanupPlusQuarantineRecord($recoveredRecord);
      $destinationKey = normalizeUserPath($normalizedRecovered["destination"]);

      if ( isset($knownDestinations[$destinationKey]) ) {
        continue;
      }

      $nextRegistry[$normalizedRecovered["id"]] = $normalizedRecovered;
      $knownDestinations[$destinationKey] = true;
      $registryDirty = true;
    }
  }

  if ( $registryDirty ) {
    setAppdataCleanupPlusQuarantineRegistry($nextRegistry);
  }

  return $nextRegistry;
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
  $registry = pruneMissingAppdataCleanupPlusQuarantineRecords(recoverMissingAppdataCleanupPlusQuarantineRecords());
  $nextRegistry = $registry;
  $registryDirty = false;
  $entries = array();

  foreach ( $registry as $recordId => $record ) {
    $normalized = normalizeAppdataCleanupPlusQuarantineRecord($record);
    $timestamp = strtotime($normalized["quarantinedAt"]);
    $scheduledPurge = buildAppdataCleanupPlusScheduledPurgeMeta(isset($normalized["purgeAt"]) ? $normalized["purgeAt"] : "");
    $row = array(
      "id" => $normalized["id"],
      "name" => $normalized["name"],
      "sourcePath" => $normalized["sourcePath"],
      "destination" => $normalized["destination"],
      "quarantineRoot" => $normalized["quarantineRoot"],
      "quarantinedAt" => $normalized["quarantinedAt"],
      "quarantinedAtLabel" => $timestamp ? formatDateTimeLabel($timestamp) : "",
      "quarantinedAgeLabel" => $timestamp ? formatRelativeAgeLabel($timestamp) : "",
      "purgeAt" => $scheduledPurge["purgeAt"],
      "purgeAtLabel" => $scheduledPurge["purgeAtLabel"],
      "purgeScheduled" => $scheduledPurge["scheduled"],
      "purgeBadgeLabel" => $scheduledPurge["purgeBadgeLabel"],
      "purgeBadgeTone" => $scheduledPurge["purgeBadgeTone"],
      "purgeDue" => $scheduledPurge["purgeDue"],
      "sourceKind" => $normalized["sourceKind"],
      "sourceLabel" => $normalized["sourceLabel"],
      "sourceDisplay" => $normalized["sourceDisplay"],
      "sourceRoot" => $normalized["sourceRoot"],
      "sourceSummary" => $normalized["sourceSummary"],
      "targetSummary" => $normalized["targetSummary"],
      "sourceNames" => $normalized["sourceNames"],
      "targetPaths" => $normalized["targetPaths"],
      "templateRefs" => $normalized["templateRefs"],
      "reason" => $normalized["reason"],
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

function buildQuarantinePurgeScheduleSummary($results) {
  $summary = array(
    "scheduled" => 0,
    "cleared" => 0,
    "missing" => 0,
    "errors" => 0
  );

  foreach ( $results as $result ) {
    switch ( isset($result["status"]) ? $result["status"] : "" ) {
      case "scheduled":
        $summary["scheduled"]++;
        break;
      case "cleared":
        $summary["cleared"]++;
        break;
      case "missing":
        $summary["missing"]++;
        break;
      default:
        $summary["errors"]++;
        break;
    }
  }

  return $summary;
}

function updateTrackedQuarantinePurgeSchedule($entries, $mode, $purgeAfterDays=0, $purgeAt="") {
  $registry = getAppdataCleanupPlusQuarantineRegistry();
  $results = array();
  $normalizedMode = strtolower(trim((string)$mode));
  $effectiveDays = max(0, (int)$purgeAfterDays);
  $scheduledPurgeAt = "";
  $registryDirty = false;

  if ( $normalizedMode === "set" ) {
    $scheduledPurgeAt = $purgeAt !== ""
      ? normalizeAppdataCleanupPlusQuarantinePurgeAt($purgeAt)
      : date("c", time() + ($effectiveDays * 86400));
  }

  foreach ( $entries as $entry ) {
    $entryId = isset($entry["id"]) ? trim((string)$entry["id"]) : "";
    $normalized = $entryId && isset($registry[$entryId])
      ? normalizeAppdataCleanupPlusQuarantineRecord($registry[$entryId])
      : normalizeAppdataCleanupPlusQuarantineRecord($entry);
    $result = array(
      "id" => $entryId,
      "name" => isset($normalized["name"]) ? $normalized["name"] : "",
      "sourcePath" => isset($normalized["sourcePath"]) ? $normalized["sourcePath"] : "",
      "destination" => isset($normalized["destination"]) ? $normalized["destination"] : ""
    );

    if ( ! $normalized["destination"] || ! is_dir($normalized["destination"]) ) {
      if ( $entryId ) {
        removeAppdataCleanupPlusQuarantineRecord($entryId);
      }
      $results[] = array_merge($result, array(
        "status" => "missing",
        "message" => "Quarantine path no longer exists."
      ));
      continue;
    }

    if ( $normalizedMode === "set" ) {
      $normalized["purgeAt"] = $scheduledPurgeAt;
      $normalized["purgeScheduleSource"] = $scheduledPurgeAt !== "" ? "manual" : "";
      $results[] = array_merge($result, array(
        "status" => "scheduled",
        "message" => $scheduledPurgeAt !== ""
          ? "Scheduled to purge on " . formatDateTimeLabel(strtotime($scheduledPurgeAt)) . "."
          : "Scheduled to purge in " . $effectiveDays . " day" . ($effectiveDays === 1 ? "" : "s") . ".",
        "purgeAt" => $scheduledPurgeAt
      ));
    } else {
      $hadSchedule = $normalized["purgeAt"] !== "";
      $normalized["purgeAt"] = "";
      $normalized["purgeScheduleSource"] = "";
      $results[] = array_merge($result, array(
        "status" => "cleared",
        "message" => $hadSchedule ? "Scheduled purge cleared." : "No scheduled purge was set."
      ));
    }

    if ( $entryId ) {
      $registry[$entryId] = $normalized;
      $registryDirty = true;
    }
  }

  if ( $registryDirty ) {
    setAppdataCleanupPlusQuarantineRegistry($registry);
  }

  return array(
    "action" => $normalizedMode === "set" ? "schedule-purge" : "clear-purge-schedule",
    "results" => $results,
    "summary" => buildQuarantinePurgeScheduleSummary($results)
  );
}

function buildQuarantineManagerPayload($includeEntries=true) {
  sweepExpiredAppdataCleanupPlusQuarantineEntries();
  $entries = getActiveAppdataCleanupPlusQuarantineEntries($includeEntries);

  return array(
    "summary" => buildQuarantineSummary($entries),
    "entries" => $includeEntries ? $entries : array()
  );
}

function buildCandidateRowFromQuarantineEntry($entry, $dockerRunning, $settings, $restoredPath="") {
  $sourcePath = $restoredPath !== ""
    ? trim((string)$restoredPath)
    : (isset($entry["sourcePath"]) ? trim((string)$entry["sourcePath"]) : "");
  $sourceNames = isset($entry["sourceNames"]) && is_array($entry["sourceNames"]) ? array_values($entry["sourceNames"]) : array();
  $targetPaths = isset($entry["targetPaths"]) && is_array($entry["targetPaths"]) ? array_values($entry["targetPaths"]) : array();
  $templateRefs = isset($entry["templateRefs"]) && is_array($entry["templateRefs"]) ? array_values($entry["templateRefs"]) : array();
  $sourceKind = isset($entry["sourceKind"]) ? trim((string)$entry["sourceKind"]) : "template";
  $sourceLabel = isset($entry["sourceLabel"]) && trim((string)$entry["sourceLabel"]) !== ""
    ? trim((string)$entry["sourceLabel"])
    : ($sourceKind === "filesystem" ? "Discovery" : "Template");
  $sourceDisplay = isset($entry["sourceDisplay"]) ? trim((string)$entry["sourceDisplay"]) : "";
  $sourceSummary = isset($entry["sourceSummary"]) ? trim((string)$entry["sourceSummary"]) : "";
  $targetSummary = isset($entry["targetSummary"]) ? trim((string)$entry["targetSummary"]) : "";
  $reason = isset($entry["reason"]) ? trim((string)$entry["reason"]) : "";
  $sourceRoot = isset($entry["sourceRoot"]) ? trim((string)$entry["sourceRoot"]) : "";

  if ( ! $sourcePath || ! is_dir($sourcePath) ) {
    return null;
  }

  natcasesort($sourceNames);
  natcasesort($targetPaths);
  $sourceNames = array_values($sourceNames);
  $targetPaths = array_values($targetPaths);

  $classification = classifyAppdataCandidate($sourcePath, $settings);
  $resolvedPath = resolveExistingPath($classification);
  $securityLockReason = buildPathSecurityLockReason($resolvedPath);
  $pathStats = ($securityLockReason || empty($classification["insideConfiguredSource"]))
    ? collectLightweightPathStats($resolvedPath)
    : collectPathStats($resolvedPath);
  $candidateKey = appdataCleanupPlusCandidateKey($resolvedPath);
  $realPath = @realpath($resolvedPath);
  $folderName = basename(rtrim($resolvedPath, "/"));

  if ( ! $sourceSummary ) {
    $sourceSummary = summarizeCandidateValues($sourceNames);
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

  if ( ! $targetSummary ) {
    $targetSummary = summarizeCandidateValues($targetPaths);
  }

  if ( ! $reason ) {
    $reason = buildCandidateReason($sourceKind, $sourceNames, $targetPaths, $dockerRunning, $sourceRoot);
  }

  return applySafetyPolicyToRow(array(
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
    "path" => $resolvedPath,
    "displayPath" => $resolvedPath,
    "realPath" => $realPath ? $realPath : "",
    "risk" => $classification["risk"],
    "riskLabel" => $classification["riskLabel"],
    "riskReason" => $classification["riskReason"],
    "reason" => $reason,
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
    "securityLockReason" => $securityLockReason,
    "policyLocked" => false,
    "policyReason" => "",
    "ignored" => false,
    "ignoredAt" => "",
    "ignoredAtLabel" => "",
    "ignoredReason" => ""
  ), $settings);
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
    return buildPathSymlinkSegmentLockReason(dirname($normalized));
  }

  return "";
}

function buildRestoreSuffixDestination($sourcePath) {
  $normalizedPath = rtrim(trim((string)$sourcePath), "/");
  $parentPath = dirname($normalizedPath);
  $folderName = basename($normalizedPath);
  $candidatePath = "";
  $attempt = 1;

  if ( ! $normalizedPath || ! $parentPath || $parentPath === "." || ! $folderName ) {
    return "";
  }

  do {
    $candidatePath = $parentPath . "/" . $folderName . "-restored";
    if ( $attempt > 1 ) {
      $candidatePath .= "-" . $attempt;
    }

    if ( ! file_exists($candidatePath) ) {
      return $candidatePath;
    }

    $attempt++;
  } while ( $attempt <= 1000 );

  return "";
}

function buildRestoreCustomDestination($sourcePath, $restoreName) {
  $normalizedSourcePath = appdataCleanupPlusCanonicalizePath($sourcePath);
  $parentPath = dirname($normalizedSourcePath);
  $cleanRestoreName = trim((string)$restoreName);

  if ( ! $normalizedSourcePath || ! $parentPath || $parentPath === "." || ! $cleanRestoreName ) {
    return "";
  }

  if ( $cleanRestoreName === "." || $cleanRestoreName === ".." ) {
    return "";
  }

  if ( strpos($cleanRestoreName, "/") !== false || strpos($cleanRestoreName, "\\") !== false ) {
    return "";
  }

  if ( preg_match('/[\x00-\x1F]/', $cleanRestoreName) ) {
    return "";
  }

  return $parentPath . "/" . $cleanRestoreName;
}

function inspectTrackedQuarantineRestoreConflicts($entries) {
  $conflicts = array();
  $summary = array(
    "selected" => 0,
    "ready" => 0,
    "conflicts" => 0
  );

  foreach ( $entries as $entry ) {
    $sourcePath = isset($entry["sourcePath"]) ? trim((string)$entry["sourcePath"]) : "";
    $destination = isset($entry["destination"]) ? trim((string)$entry["destination"]) : "";
    $suggestedPath = buildRestoreSuffixDestination($sourcePath);
    $sourceName = basename(rtrim($sourcePath, "/"));
    $parentPath = dirname(rtrim($sourcePath, "/"));

    $summary["selected"]++;

    if ( $sourcePath && file_exists($sourcePath) ) {
      $conflicts[] = array(
        "id" => isset($entry["id"]) ? (string)$entry["id"] : "",
        "name" => isset($entry["name"]) ? (string)$entry["name"] : $sourceName,
        "sourcePath" => $sourcePath,
        "destination" => $destination,
        "parentPath" => $parentPath,
        "sourceName" => $sourceName,
        "suggestedName" => $suggestedPath ? basename($suggestedPath) : ($sourceName ? ($sourceName . "-restored") : ""),
        "suggestedPath" => $suggestedPath
      );
      $summary["conflicts"]++;
      continue;
    }

    $summary["ready"]++;
  }

  return array(
    "summary" => $summary,
    "conflicts" => $conflicts
  );
}

function buildQuarantineManagerActionSummary($results) {
  $summary = array(
    "restored" => 0,
    "purged" => 0,
    "skipped" => 0,
    "conflicts" => 0,
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
      case "skipped":
        $summary["skipped"]++;
        break;
      case "conflict":
        $summary["conflicts"]++;
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

function restoreTrackedQuarantineEntry($entry, $options=array()) {
  $entryId = isset($entry["id"]) ? trim((string)$entry["id"]) : "";
  $sourcePath = isset($entry["sourcePath"]) ? trim((string)$entry["sourcePath"]) : "";
  $destination = isset($entry["destination"]) ? trim((string)$entry["destination"]) : "";
  $quarantineRoot = isset($entry["quarantineRoot"]) ? trim((string)$entry["quarantineRoot"]) : "";
  $securityReason = buildRestorePathSecurityReason($sourcePath);
  $conflictMode = isset($options["conflictMode"]) ? trim((string)$options["conflictMode"]) : "block";
  $customRestoreNames = isset($options["customRestoreNames"]) && is_array($options["customRestoreNames"]) ? $options["customRestoreNames"] : array();
  $customRestoreName = $entryId && isset($customRestoreNames[$entryId]) ? trim((string)$customRestoreNames[$entryId]) : "";
  $restorePath = $sourcePath;

  if ( ! in_array($conflictMode, array("block", "skip", "suffix", "custom"), true) ) {
    $conflictMode = "block";
  }

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
    $suggestedPath = buildRestoreSuffixDestination($sourcePath);

    if ( $conflictMode === "skip" ) {
      return array(
        "status" => "skipped",
        "message" => "Skipped because the original path already exists. The folder remains in quarantine.",
        "suggestedPath" => $suggestedPath,
        "quarantinePath" => $destination
      );
    }

    if ( $conflictMode === "suffix" ) {
      if ( ! $suggestedPath ) {
        return array(
          "status" => "error",
          "message" => "A suffix restore path could not be prepared safely."
        );
      }

      $restorePath = $suggestedPath;
    } elseif ( $conflictMode === "custom" ) {
      $restorePath = buildRestoreCustomDestination($sourcePath, $customRestoreName);

      if ( ! $restorePath ) {
        return array(
          "status" => "error",
          "message" => "The edited restore name was invalid. Use a folder name without slashes.",
          "requestedRestorePath" => $customRestoreName ? dirname(rtrim($sourcePath, "/")) . "/" . $customRestoreName : "",
          "suggestedPath" => $suggestedPath,
          "quarantinePath" => $destination
        );
      }

      if ( file_exists($restorePath) ) {
        return array(
          "status" => "conflict",
          "message" => "The edited restore destination already exists. Choose a different name or skip this folder.",
          "requestedRestorePath" => $restorePath,
          "suggestedPath" => $suggestedPath,
          "quarantinePath" => $destination
        );
      }
    } else {
      return array(
        "status" => "conflict",
        "message" => "The original path already exists. Choose skip or restore with suffix to continue.",
        "suggestedPath" => $suggestedPath,
        "quarantinePath" => $destination
      );
    }
  }

  if ( $restorePath && buildRestorePathSecurityReason($restorePath) ) {
    return array(
      "status" => "blocked",
      "message" => buildRestorePathSecurityReason($restorePath)
    );
  }

  if ( @is_link($destination) ) {
    return array(
      "status" => "blocked",
      "message" => buildSymlinkLockReason($destination, "Quarantine path")
    );
  }

  if ( pathHasSymlinkSegment($destination) ) {
    return array(
      "status" => "blocked",
      "message" => buildPathSymlinkSegmentLockReason($destination)
    );
  }

  if ( pathIsMountPoint($destination) ) {
    return array(
      "status" => "blocked",
      "message" => "This quarantine entry could not be restored safely."
    );
  }

  if ( ! ensureDirectoryExists(dirname($restorePath)) ) {
    return array(
      "status" => "error",
      "message" => "The original parent folder could not be prepared."
    );
  }

  if ( ! @rename($destination, $restorePath) ) {
    return array(
      "status" => "error",
      "message" => "Restore failed. The quarantined folder was left in place."
    );
  }

  deleteAppdataCleanupPlusQuarantineEntryMarker($restorePath);
  clearCachedAppdataCleanupPlusPathStats($destination);
  clearCachedAppdataCleanupPlusPathStats($restorePath);
  removeAppdataCleanupPlusQuarantineRecord($entry["id"]);
  cleanupEmptyQuarantineParents($destination, $quarantineRoot);

  return array(
    "status" => "restored",
    "message" => $restorePath === $sourcePath
      ? "Restored to the original location."
      : ($conflictMode === "custom"
        ? "Original path already existed, so the folder was restored to the edited destination."
        : "Original path already existed, so the folder was restored with a suffix."),
    "destination" => $restorePath,
    "restoredPath" => $restorePath
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

function purgeTrackedQuarantineEntry($entry, $options=array()) {
  $destination = isset($entry["destination"]) ? trim((string)$entry["destination"]) : "";
  $quarantineRoot = isset($entry["quarantineRoot"]) ? trim((string)$entry["quarantineRoot"]) : "";
  $scheduledPurge = ! empty($options["scheduledPurge"]);

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
    "message" => $scheduledPurge
      ? "Permanently deleted from quarantine after the scheduled purge window expired."
      : "Permanently deleted from quarantine."
  );
}

function executeQuarantineManagerAction($entries, $action, $options=array()) {
  $results = array();
  $settings = getAppdataCleanupPlusSafetySettings();
  $dockerRunning = is_dir(appdataCleanupPlusDockerRuntimePath());

  foreach ( $entries as $entry ) {
    $result = array(
      "id" => $entry["id"],
      "name" => $entry["name"],
      "sourcePath" => $entry["sourcePath"],
      "destination" => $entry["destination"]
    );

    if ( $action === "restore" ) {
      $restoreResult = restoreTrackedQuarantineEntry($entry, $options);
      if ( isset($restoreResult["status"]) && $restoreResult["status"] === "restored" ) {
        $restoredRow = buildCandidateRowFromQuarantineEntry(
          $entry,
          $dockerRunning,
          $settings,
          isset($restoreResult["restoredPath"]) ? (string)$restoreResult["restoredPath"] : ""
        );
        if ( $restoredRow ) {
          $restoreResult["row"] = $restoredRow;
        }
      }
      $results[] = array_merge($result, $restoreResult);
      continue;
    }

    $purgeResult = purgeTrackedQuarantineEntry($entry, $options);
    $results[] = array_merge($result, $purgeResult);
  }

  return array(
    "action" => $action,
    "results" => $results,
    "summary" => buildQuarantineManagerActionSummary($results)
  );
}

function sweepExpiredAppdataCleanupPlusQuarantineEntries() {
  $dueEntries = array();
  $registry = pruneMissingAppdataCleanupPlusQuarantineRecords(recoverMissingAppdataCleanupPlusQuarantineRecords());
  $nowTimestamp = time();
  $execution = array(
    "action" => "scheduled-purge",
    "results" => array(),
    "summary" => buildQuarantineManagerActionSummary(array())
  );

  foreach ( $registry as $record ) {
    $normalized = normalizeAppdataCleanupPlusQuarantineRecord($record);
    $purgeTimestamp = $normalized["purgeAt"] !== "" ? strtotime($normalized["purgeAt"]) : 0;

    if ( $purgeTimestamp && $purgeTimestamp <= $nowTimestamp ) {
      $dueEntries[] = $normalized;
    }
  }

  if ( empty($dueEntries) ) {
    return $execution;
  }

  $execution = executeQuarantineManagerAction($dueEntries, "purge", array(
    "scheduledPurge" => true
  ));
  $execution["action"] = "scheduled-purge";

  appendAppdataCleanupPlusAuditEntry(array(
    "timestamp" => date("c"),
    "operation" => "scheduled-purge",
    "requestedCount" => count($dueEntries),
    "requestedIds" => array_values(array_map(function($entry) {
      return isset($entry["id"]) ? (string)$entry["id"] : "";
    }, $dueEntries)),
    "summary" => $execution["summary"],
    "results" => $execution["results"]
  ));

  return $execution;
}

function resolveCandidateForAction($candidate, $settings, $baseOperation) {
  $candidatePath = isset($candidate["path"]) ? (string)$candidate["path"] : "";
  $candidateDisplayPath = isset($candidate["displayPath"]) ? (string)$candidate["displayPath"] : $candidatePath;
  $snapshotRealPath = isset($candidate["realPath"]) ? (string)$candidate["realPath"] : "";
  $snapshotDatasetName = isset($candidate["datasetName"]) ? trim((string)$candidate["datasetName"]) : "";

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
  $storageMeta = appdataCleanupPlusResolveStorageForPath($displayPath, $settings);

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

  $managedSystemLockReason = appdataCleanupPlusBuildManagedSystemLockReason($displayPath);

  if ( $managedSystemLockReason !== "" ) {
    return array(
      "ok" => false,
      "path" => $candidatePath,
      "displayPath" => $displayPath,
      "status" => "blocked",
      "message" => $managedSystemLockReason
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

  if ( $snapshotDatasetName !== "" ) {
    if ( $storageMeta["kind"] !== "zfs" || ! hash_equals($snapshotDatasetName, (string)$storageMeta["datasetName"]) ) {
      return array(
        "ok" => false,
        "path" => $candidatePath,
        "displayPath" => $displayPath,
        "status" => "blocked",
        "message" => "ZFS dataset mapping changed since the last scan. Rescan before continuing."
      );
    }
  }

  if ( @is_link($displayPath) ) {
    return array(
      "ok" => false,
      "path" => $candidatePath,
      "displayPath" => $displayPath,
      "status" => "blocked",
      "message" => buildSymlinkLockReason($displayPath, "Folder")
    );
  }

  if ( pathHasSymlinkSegment($displayPath) ) {
    return array(
      "ok" => false,
      "path" => $candidatePath,
      "displayPath" => $displayPath,
      "status" => "blocked",
      "message" => buildPathSymlinkSegmentLockReason($displayPath)
    );
  }

  if (
    (pathIsMountPoint($displayPath) || pathIsMountPoint($currentRealPath)) &&
    $storageMeta["kind"] !== "zfs"
  ) {
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

  if ( $classification["risk"] === "review" && empty($settings["allowOutsideShareCleanup"]) && ! appdataCleanupPlusCandidateHasLockOverride($candidate) ) {
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

  if ( ! empty($storageMeta["lockReason"]) ) {
    return array(
      "ok" => false,
      "path" => $candidatePath,
      "displayPath" => $displayPath,
      "status" => "blocked",
      "message" => $storageMeta["lockReason"]
    );
  }

  if ( $storageMeta["kind"] === "zfs" ) {
    if ( empty($settings["enableZfsDatasetDelete"]) ) {
      return array(
        "ok" => false,
        "path" => $candidatePath,
        "displayPath" => $displayPath,
        "status" => "blocked",
        "message" => "ZFS dataset delete is disabled in Safety settings."
      );
    }

    if ( $baseOperation !== "delete" ) {
      return array(
        "ok" => false,
        "path" => $candidatePath,
        "displayPath" => $displayPath,
        "status" => "blocked",
        "message" => "ZFS dataset-backed paths cannot be quarantined. Enable permanent delete mode to destroy the dataset."
      );
    }
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
    "realPath" => $currentRealPath,
    "storage" => $storageMeta
  );
}

function quarantineCandidatePath($candidate, $displayPath, $settings) {
  $destination = buildQuarantineDestination($displayPath, $settings);
  $quarantineRoot = buildCandidateQuarantineRoot($displayPath, $settings);
  $quarantinedAt = date("c");
  $defaultPurgeAt = buildAppdataCleanupPlusDefaultPurgeAtForTimestamp($settings, strtotime($quarantinedAt));

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
    $quarantineRecord = array(
      "id" => appdataCleanupPlusRandomToken(),
      "name" => isset($candidate["name"]) ? (string)$candidate["name"] : basename(rtrim($displayPath, "/")),
      "sourcePath" => $displayPath,
      "destination" => $destination,
      "quarantineRoot" => $quarantineRoot,
      "quarantinedAt" => $quarantinedAt,
      "purgeAt" => $defaultPurgeAt,
      "purgeScheduleSource" => $defaultPurgeAt !== "" ? "default" : "",
      "sourceKind" => isset($candidate["sourceKind"]) ? (string)$candidate["sourceKind"] : "template",
      "sourceLabel" => isset($candidate["sourceLabel"]) ? (string)$candidate["sourceLabel"] : "Template",
      "sourceDisplay" => isset($candidate["sourceDisplay"]) ? (string)$candidate["sourceDisplay"] : "",
      "sourceRoot" => isset($candidate["sourceRoot"]) ? (string)$candidate["sourceRoot"] : "",
      "sourceSummary" => isset($candidate["sourceSummary"]) ? (string)$candidate["sourceSummary"] : "",
      "targetSummary" => isset($candidate["targetSummary"]) ? (string)$candidate["targetSummary"] : "",
      "sourceNames" => isset($candidate["sourceNames"]) && is_array($candidate["sourceNames"]) ? array_values($candidate["sourceNames"]) : array(),
      "targetPaths" => isset($candidate["targetPaths"]) && is_array($candidate["targetPaths"]) ? array_values($candidate["targetPaths"]) : array(),
      "templateRefs" => isset($candidate["templateRefs"]) && is_array($candidate["templateRefs"]) ? array_values($candidate["templateRefs"]) : array(),
      "reason" => isset($candidate["reason"]) ? (string)$candidate["reason"] : "",
      "sizeBytes" => isset($candidate["sizeBytes"]) && $candidate["sizeBytes"] !== null ? (int)$candidate["sizeBytes"] : null
    );
    registerAppdataCleanupPlusQuarantineRecord($quarantineRecord);
    writeAppdataCleanupPlusQuarantineEntryMarker($quarantineRecord);
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
      } elseif ( ! empty($resolved["storage"]["kind"]) && $resolved["storage"]["kind"] === "zfs" ) {
        $previewResult["datasetName"] = (string)$resolved["storage"]["datasetName"];
        $previewResult["datasetMountpoint"] = (string)$resolved["storage"]["datasetMountpoint"];
        $zfsPreview = appdataCleanupPlusPreviewZfsDatasetDestroy($previewResult["datasetName"]);
        $previewResult["message"] = $zfsPreview["message"];
        $previewResult["recursive"] = ! empty($zfsPreview["recursive"]);
        if ( ! $zfsPreview["ok"] ) {
          $previewResult["status"] = "error";
        }
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

    if ( ! empty($resolved["storage"]["kind"]) && $resolved["storage"]["kind"] === "zfs" ) {
      $datasetName = (string)$resolved["storage"]["datasetName"];
      $zfsPreview = appdataCleanupPlusPreviewZfsDatasetDestroy($datasetName);
      $deleteResult = $zfsPreview["ok"]
        ? appdataCleanupPlusDestroyZfsDataset($datasetName, ! empty($zfsPreview["recursive"]))
        : $zfsPreview;

      if ( ! empty($deleteResult["ok"]) ) {
        clearCachedAppdataCleanupPlusPathStats($resolved["displayPath"]);
        clearCachedAppdataCleanupPlusPathStats((string)$resolved["storage"]["datasetMountpoint"]);
      }

      $results[] = array(
        "path" => $resolved["path"],
        "displayPath" => $resolved["displayPath"],
        "datasetName" => $datasetName,
        "datasetMountpoint" => (string)$resolved["storage"]["datasetMountpoint"],
        "recursive" => ! empty($zfsPreview["recursive"]),
        "status" => $deleteResult["ok"] ? "deleted" : "error",
        "message" => $deleteResult["message"]
      );
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
