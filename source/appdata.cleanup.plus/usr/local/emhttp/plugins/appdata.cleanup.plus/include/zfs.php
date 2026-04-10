<?php

function appdataCleanupPlusCanonicalizeZfsPath($path) {
  $normalized = trim(str_replace("\\", "/", (string)$path));

  if ( $normalized === "" ) {
    return "";
  }

  $normalized = preg_replace('#/+#', '/', $normalized);

  if ( $normalized !== "/" ) {
    $normalized = rtrim($normalized, "/");
  }

  return $normalized === "" ? "/" : $normalized;
}

function appdataCleanupPlusIsAbsoluteZfsPath($path) {
  $normalized = appdataCleanupPlusCanonicalizeZfsPath($path);
  return $normalized !== "" && isset($normalized[0]) && $normalized[0] === "/";
}

function appdataCleanupPlusPathMatchesZfsRoot($path, $root) {
  $normalizedPath = appdataCleanupPlusCanonicalizeZfsPath($path);
  $normalizedRoot = appdataCleanupPlusCanonicalizeZfsPath($root);

  if ( $normalizedPath === "" || $normalizedRoot === "" ) {
    return false;
  }

  if ( $normalizedPath === $normalizedRoot ) {
    return true;
  }

  return strpos($normalizedPath . "/", rtrim($normalizedRoot, "/") . "/") === 0;
}

function appdataCleanupPlusApplyZfsRootMapping($path, $fromRoot, $toRoot) {
  $normalizedPath = appdataCleanupPlusCanonicalizeZfsPath($path);
  $normalizedFromRoot = appdataCleanupPlusCanonicalizeZfsPath($fromRoot);
  $normalizedToRoot = appdataCleanupPlusCanonicalizeZfsPath($toRoot);

  if (
    $normalizedPath === "" ||
    $normalizedFromRoot === "" ||
    $normalizedToRoot === "" ||
    ! appdataCleanupPlusPathMatchesZfsRoot($normalizedPath, $normalizedFromRoot)
  ) {
    return "";
  }

  if ( $normalizedPath === $normalizedFromRoot ) {
    return $normalizedToRoot;
  }

  return rtrim($normalizedToRoot, "/") . substr($normalizedPath, strlen($normalizedFromRoot));
}

function appdataCleanupPlusNormalizeSingleZfsPathMapping($mapping) {
  $shareRoot = "";
  $datasetRoot = "";

  if ( is_string($mapping) ) {
    $parts = preg_split('/\s*=>\s*|\s*=\s*/', trim((string)$mapping), 2);
    if ( is_array($parts) ) {
      $shareRoot = isset($parts[0]) ? trim((string)$parts[0]) : "";
      $datasetRoot = isset($parts[1]) ? trim((string)$parts[1]) : "";
    }
  } elseif ( is_array($mapping) ) {
    $shareRoot = isset($mapping["shareRoot"]) ? trim((string)$mapping["shareRoot"]) : "";
    $datasetRoot = isset($mapping["datasetRoot"]) ? trim((string)$mapping["datasetRoot"]) : "";
  }

  $shareRoot = appdataCleanupPlusCanonicalizeZfsPath($shareRoot);
  $datasetRoot = appdataCleanupPlusCanonicalizeZfsPath($datasetRoot);

  if (
    ! appdataCleanupPlusIsAbsoluteZfsPath($shareRoot) ||
    ! appdataCleanupPlusIsAbsoluteZfsPath($datasetRoot) ||
    $shareRoot === $datasetRoot
  ) {
    return array();
  }

  return array(
    "shareRoot" => $shareRoot,
    "datasetRoot" => $datasetRoot
  );
}

function appdataCleanupPlusNormalizeZfsPathMappings($mappings) {
  static $cache = array();
  $cacheKey = md5(json_encode($mappings));
  $normalizedMappings = array();
  $seen = array();

  if ( isset($cache[$cacheKey]) ) {
    return $cache[$cacheKey];
  }

  if ( is_string($mappings) ) {
    $decodedMappings = json_decode($mappings, true);
    if ( is_array($decodedMappings) ) {
      $mappings = $decodedMappings;
    } else {
      $mappings = preg_split('/\r\n|\r|\n/', (string)$mappings);
    }
  }

  if ( ! is_array($mappings) ) {
    $cache[$cacheKey] = array();
    return $cache[$cacheKey];
  }

  foreach ( $mappings as $mapping ) {
    $normalizedMapping = appdataCleanupPlusNormalizeSingleZfsPathMapping($mapping);
    $mappingKey = "";

    if ( empty($normalizedMapping) ) {
      continue;
    }

    $mappingKey = $normalizedMapping["shareRoot"] . "=>" . $normalizedMapping["datasetRoot"];
    if ( isset($seen[$mappingKey]) ) {
      continue;
    }

    $seen[$mappingKey] = true;
    $normalizedMappings[] = $normalizedMapping;
  }

  $cache[$cacheKey] = array_values($normalizedMappings);
  return $cache[$cacheKey];
}

function appdataCleanupPlusGetConfiguredZfsPathMappings($settings=null) {
  if ( ! is_array($settings) ) {
    $settings = function_exists("getAppdataCleanupPlusSafetySettings")
      ? getAppdataCleanupPlusSafetySettings()
      : array();
  }

  return appdataCleanupPlusNormalizeZfsPathMappings(isset($settings["zfsPathMappings"]) ? $settings["zfsPathMappings"] : array());
}

function appdataCleanupPlusValidateZfsPathMapping($mapping) {
  $normalizedMapping = appdataCleanupPlusNormalizeSingleZfsPathMapping($mapping);

  if ( empty($normalizedMapping) ) {
    return "Each ZFS path mapping must use two absolute roots in the form '/mnt/user/appdata => /mnt/pool/appdata'.";
  }

  foreach ( array("shareRoot", "datasetRoot") as $field ) {
    if ( in_array($normalizedMapping[$field], array("/", "/mnt", "/mnt/user", "/mnt/cache"), true) ) {
      return "ZFS path mappings must point to dedicated appdata roots, not mount roots.";
    }
  }

  return "";
}

function appdataCleanupPlusExpandZfsMappedPathVariants($path, $settings=null) {
  $normalizedPath = appdataCleanupPlusCanonicalizeZfsPath($path);
  $variants = array();

  if ( $normalizedPath === "" ) {
    return array();
  }

  foreach ( appdataCleanupPlusGetConfiguredZfsPathMappings($settings) as $mapping ) {
    $mappedToDatasetRoot = appdataCleanupPlusApplyZfsRootMapping($normalizedPath, $mapping["shareRoot"], $mapping["datasetRoot"]);
    $mappedToShareRoot = appdataCleanupPlusApplyZfsRootMapping($normalizedPath, $mapping["datasetRoot"], $mapping["shareRoot"]);

    if ( $mappedToDatasetRoot !== "" ) {
      $variants[$mappedToDatasetRoot] = true;
    }

    if ( $mappedToShareRoot !== "" ) {
      $variants[$mappedToShareRoot] = true;
    }
  }

  return array_values(array_keys($variants));
}

function appdataCleanupPlusBuildZfsResolutionPathVariants($path, $settings=null) {
  $variants = array();
  $pending = array();
  $normalizedPath = appdataCleanupPlusCanonicalizeZfsPath($path);
  $realPath = $normalizedPath !== "" ? @realpath($normalizedPath) : false;

  if ( $normalizedPath === "" ) {
    return array();
  }

  $variants[$normalizedPath] = true;
  if ( $realPath ) {
    $variants[appdataCleanupPlusCanonicalizeZfsPath($realPath)] = true;
  }

  $pending = array_keys($variants);
  while ( ! empty($pending) ) {
    $currentPath = array_shift($pending);

    foreach ( appdataCleanupPlusExpandZfsMappedPathVariants($currentPath, $settings) as $variant ) {
      if ( $variant === "" || isset($variants[$variant]) ) {
        continue;
      }

      $variants[$variant] = true;
      $pending[] = $variant;
    }
  }

  return array_values(array_filter(array_keys($variants), "strlen"));
}

function appdataCleanupPlusZfsClientCommandPrefix() {
  $commandOverride = trim((string)getenv("APPDATA_CLEANUP_PLUS_ZFS_CLIENT_COMMAND"));
  $pathOverride = trim((string)getenv("APPDATA_CLEANUP_PLUS_ZFS_CLIENT_PATH"));

  if ( $commandOverride !== "" ) {
    return $commandOverride;
  }

  if ( $pathOverride !== "" ) {
    return escapeshellarg($pathOverride);
  }

  return "zfs";
}

function appdataCleanupPlusRunZfsCommand($arguments) {
  $command = appdataCleanupPlusZfsClientCommandPrefix();
  $output = array();
  $returnCode = 1;

  foreach ( (array)$arguments as $argument ) {
    $command .= " " . escapeshellarg((string)$argument);
  }

  @exec($command . " 2>&1", $output, $returnCode);

  return array(
    "ok" => $returnCode === 0,
    "command" => $command,
    "output" => array_values($output),
    "outputText" => trim(implode("\n", $output)),
    "statusCode" => (int)$returnCode
  );
}

function appdataCleanupPlusGetZfsDatasetMountMap() {
  static $cache = null;
  $commandResult = array();
  $mountMap = array();

  if ( $cache !== null ) {
    return $cache;
  }

  $commandResult = appdataCleanupPlusRunZfsCommand(array("list", "-H", "-o", "name,mountpoint", "-t", "filesystem"));
  if ( ! $commandResult["ok"] ) {
    $cache = array(
      "ok" => false,
      "message" => $commandResult["outputText"] !== ""
        ? $commandResult["outputText"]
        : "The zfs CLI could not be queried."
    );
    return $cache;
  }

  foreach ( $commandResult["output"] as $line ) {
    $parts = preg_split('/\t+/', trim((string)$line));
    $datasetName = isset($parts[0]) ? trim((string)$parts[0]) : "";
    $mountpoint = isset($parts[1]) ? appdataCleanupPlusCanonicalizeZfsPath($parts[1]) : "";

    if ( $datasetName === "" || ! appdataCleanupPlusIsAbsoluteZfsPath($mountpoint) ) {
      continue;
    }

    $mountMap[$mountpoint] = $datasetName;
  }

  $cache = array(
    "ok" => true,
    "mountMap" => $mountMap
  );
  return $cache;
}

function appdataCleanupPlusResolveStorageForPath($path, $settings=null) {
  static $cache = array();
  $normalizedPath = appdataCleanupPlusCanonicalizeZfsPath($path);
  $cacheKey = md5($normalizedPath . "|" . json_encode(appdataCleanupPlusGetConfiguredZfsPathMappings($settings)));
  $datasetMap = array();
  $variants = array();
  $mappingMatched = false;

  if ( isset($cache[$cacheKey]) ) {
    return $cache[$cacheKey];
  }

  $cache[$cacheKey] = array(
    "kind" => "filesystem",
    "label" => "Filesystem",
    "detail" => "",
    "datasetName" => "",
    "datasetMountpoint" => "",
    "mappingMatched" => false,
    "lockReason" => ""
  );

  if ( $normalizedPath === "" ) {
    return $cache[$cacheKey];
  }

  $variants = appdataCleanupPlusBuildZfsResolutionPathVariants($normalizedPath, $settings);
  foreach ( appdataCleanupPlusGetConfiguredZfsPathMappings($settings) as $mapping ) {
    foreach ( $variants as $variant ) {
      if (
        appdataCleanupPlusPathMatchesZfsRoot($variant, $mapping["shareRoot"]) ||
        appdataCleanupPlusPathMatchesZfsRoot($variant, $mapping["datasetRoot"])
      ) {
        $mappingMatched = true;
        break 2;
      }
    }
  }

  $datasetMap = appdataCleanupPlusGetZfsDatasetMountMap();
  if ( ! $datasetMap["ok"] ) {
    if ( $mappingMatched ) {
      $cache[$cacheKey] = array(
        "kind" => "zfs_unavailable",
        "label" => "ZFS unavailable",
        "detail" => "",
        "datasetName" => "",
        "datasetMountpoint" => "",
        "mappingMatched" => true,
        "lockReason" => "A configured ZFS path mapping matched this path, but the zfs CLI could not be queried safely."
      );
    }

    return $cache[$cacheKey];
  }

  foreach ( $variants as $variant ) {
    if ( empty($datasetMap["mountMap"][$variant]) ) {
      continue;
    }

    $cache[$cacheKey] = array(
      "kind" => "zfs",
      "label" => "ZFS dataset",
      "detail" => (string)$datasetMap["mountMap"][$variant],
      "datasetName" => (string)$datasetMap["mountMap"][$variant],
      "datasetMountpoint" => $variant,
      "mappingMatched" => $mappingMatched,
      "lockReason" => ""
    );
    return $cache[$cacheKey];
  }

  return $cache[$cacheKey];
}

function appdataCleanupPlusPreviewZfsDatasetDestroy($datasetName) {
  $normalizedDatasetName = trim((string)$datasetName);
  $basePreview = array();
  $recursivePreview = array();
  $impact = array();

  if ( $normalizedDatasetName === "" ) {
    return array(
      "ok" => false,
      "message" => "The ZFS dataset name was missing."
    );
  }

  $basePreview = appdataCleanupPlusRunZfsCommand(array("destroy", "-nvp", $normalizedDatasetName));
  if ( $basePreview["ok"] ) {
    $impact = appdataCleanupPlusDescribeZfsDatasetDestroyImpact($normalizedDatasetName, false);
    return array(
      "ok" => true,
      "recursive" => false,
      "message" => "Would destroy ZFS dataset '" . $normalizedDatasetName . "'.",
      "impactSummary" => isset($impact["summary"]) ? $impact["summary"] : "",
      "childDatasets" => isset($impact["childDatasets"]) ? $impact["childDatasets"] : array(),
      "snapshots" => isset($impact["snapshots"]) ? $impact["snapshots"] : array(),
      "childDatasetCount" => isset($impact["childDatasetCount"]) ? (int)$impact["childDatasetCount"] : 0,
      "snapshotCount" => isset($impact["snapshotCount"]) ? (int)$impact["snapshotCount"] : 0
    );
  }

  $recursivePreview = appdataCleanupPlusRunZfsCommand(array("destroy", "-nrvp", $normalizedDatasetName));
  if ( $recursivePreview["ok"] ) {
    $impact = appdataCleanupPlusDescribeZfsDatasetDestroyImpact($normalizedDatasetName, true);
    return array(
      "ok" => true,
      "recursive" => true,
      "message" => "Would destroy ZFS dataset '" . $normalizedDatasetName . "' recursively.",
      "impactSummary" => isset($impact["summary"]) ? $impact["summary"] : "",
      "childDatasets" => isset($impact["childDatasets"]) ? $impact["childDatasets"] : array(),
      "snapshots" => isset($impact["snapshots"]) ? $impact["snapshots"] : array(),
      "childDatasetCount" => isset($impact["childDatasetCount"]) ? (int)$impact["childDatasetCount"] : 0,
      "snapshotCount" => isset($impact["snapshotCount"]) ? (int)$impact["snapshotCount"] : 0
    );
  }

  return array(
    "ok" => false,
    "message" => $recursivePreview["outputText"] !== ""
      ? $recursivePreview["outputText"]
      : ($basePreview["outputText"] !== "" ? $basePreview["outputText"] : "The ZFS dataset could not be destroyed safely.")
  );
}

function appdataCleanupPlusSummarizeZfsImpactCount($count, $singular, $plural) {
  $normalizedCount = (int)$count;
  if ( $normalizedCount <= 0 ) {
    return "";
  }

  return $normalizedCount . " " . ($normalizedCount === 1 ? $singular : $plural);
}

function appdataCleanupPlusDescribeZfsDatasetDestroyImpact($datasetName, $recursive=false) {
  $normalizedDatasetName = trim((string)$datasetName);
  $childDatasets = array();
  $snapshots = array();
  $allChildDatasets = array();
  $allSnapshots = array();
  $commandResult = array();
  $summaryParts = array();
  $summary = "";
  $childDatasetCount = 0;
  $snapshotCount = 0;

  if ( $normalizedDatasetName === "" ) {
    return array(
      "summary" => "",
      "childDatasets" => array(),
      "snapshots" => array(),
      "childDatasetCount" => 0,
      "snapshotCount" => 0
    );
  }

  $commandResult = appdataCleanupPlusRunZfsCommand(array("list", "-H", "-o", "name", "-t", "filesystem,snapshot", "-r", $normalizedDatasetName));
  if ( ! $commandResult["ok"] ) {
    return array(
      "summary" => "",
      "childDatasets" => array(),
      "snapshots" => array(),
      "childDatasetCount" => 0,
      "snapshotCount" => 0
    );
  }

  foreach ( $commandResult["output"] as $line ) {
    $name = trim((string)$line);

    if ( $name === "" || $name === $normalizedDatasetName ) {
      continue;
    }

    if ( strpos($name, "@") !== false ) {
      if ( strpos($name, $normalizedDatasetName . "@") === 0 || strpos($name, $normalizedDatasetName . "/") === 0 ) {
        $allSnapshots[$name] = true;
      }
      continue;
    }

    if ( strpos($name, $normalizedDatasetName . "/") === 0 ) {
      $allChildDatasets[$name] = true;
    }
  }

  $childDatasetCount = count($allChildDatasets);
  $snapshotCount = count($allSnapshots);
  $childDatasets = array_values(array_slice(array_keys($allChildDatasets), 0, 4));
  $snapshots = array_values(array_slice(array_keys($allSnapshots), 0, 4));

  if ( $recursive ) {
    $summaryParts[] = appdataCleanupPlusSummarizeZfsImpactCount($childDatasetCount, "child dataset", "child datasets");
  }

  $summaryParts[] = appdataCleanupPlusSummarizeZfsImpactCount($snapshotCount, "snapshot", "snapshots");
  $summaryParts = array_values(array_filter($summaryParts, "strlen"));

  if ( $recursive ) {
    if ( ! empty($summaryParts) ) {
      $summary = "Recursive destroy will also remove " . implode(" and ", $summaryParts) . ".";
    } else {
      $summary = "Recursive destroy is required for this dataset.";
    }
  } elseif ( ! empty($summaryParts) ) {
    $summary = "Destroy will also remove " . implode(" and ", $summaryParts) . ".";
  }

  return array(
    "summary" => $summary,
    "childDatasets" => $childDatasets,
    "snapshots" => $snapshots,
    "childDatasetCount" => $recursive ? $childDatasetCount : 0,
    "snapshotCount" => $snapshotCount
  );
}

function appdataCleanupPlusDestroyZfsDataset($datasetName, $recursive=false) {
  $normalizedDatasetName = trim((string)$datasetName);
  $arguments = array("destroy");
  $result = array();

  if ( $normalizedDatasetName === "" ) {
    return array(
      "ok" => false,
      "message" => "The ZFS dataset name was missing."
    );
  }

  if ( $recursive ) {
    $arguments[] = "-r";
  }

  $arguments[] = $normalizedDatasetName;
  $result = appdataCleanupPlusRunZfsCommand($arguments);

  if ( ! $result["ok"] ) {
    return array(
      "ok" => false,
      "message" => $result["outputText"] !== ""
        ? $result["outputText"]
        : "The ZFS dataset could not be destroyed."
    );
  }

  return array(
    "ok" => true,
    "message" => $recursive
      ? "Destroyed ZFS dataset '" . $normalizedDatasetName . "' recursively."
      : "Destroyed ZFS dataset '" . $normalizedDatasetName . "'."
  );
}
