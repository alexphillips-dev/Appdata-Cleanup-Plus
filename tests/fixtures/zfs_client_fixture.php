<?php

$args = array_slice($_SERVER["argv"], 1);
$shareRoot = rtrim(str_replace("\\", "/", (string)getenv("APPDATA_CLEANUP_PLUS_TEST_ZFS_SHARE_ROOT")), "/");
$datasetRoot = rtrim(str_replace("\\", "/", (string)getenv("APPDATA_CLEANUP_PLUS_TEST_ZFS_DATASET_ROOT")), "/");
$datasets = array(
  "templated-orphan" => "standard",
  "Sonarr" => "recursive"
);

function zfsFixtureDatasetName($datasetRoot, $childName) {
  $rootSegments = array_values(array_filter(explode("/", trim((string)$datasetRoot, "/")), "strlen"));
  if ( ! empty($rootSegments) && $rootSegments[0] === "mnt" ) {
    array_shift($rootSegments);
  }
  return implode("/", array_merge($rootSegments, array($childName)));
}

function zfsFixtureDeletePath($root, $childName) {
  return rtrim((string)$root, "/") . "/" . $childName;
}

function zfsFixtureRemoveTree($path) {
  if ( ! $path || ! file_exists($path) ) {
    return;
  }

  if ( is_file($path) || is_link($path) ) {
    @unlink($path);
    return;
  }

  $iterator = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS),
    RecursiveIteratorIterator::CHILD_FIRST
  );

  foreach ( $iterator as $entry ) {
    if ( $entry->isDir() && ! $entry->isLink() ) {
      @rmdir($entry->getPathname());
      continue;
    }

    @unlink($entry->getPathname());
  }

  @rmdir($path);
}

if ( empty($args) ) {
  fwrite(STDERR, "missing zfs fixture command\n");
  exit(1);
}

if ( $args[0] === "list" ) {
  foreach ( $datasets as $childName => $mode ) {
    echo zfsFixtureDatasetName($datasetRoot, $childName) . "\t" . zfsFixtureDeletePath($datasetRoot, $childName) . PHP_EOL;
  }
  exit(0);
}

if ( $args[0] !== "destroy" ) {
  fwrite(STDERR, "unsupported zfs fixture command\n");
  exit(1);
}

$recursive = in_array("-r", $args, true) || in_array("-nrvp", $args, true);
$preview = in_array("-nvp", $args, true) || in_array("-nrvp", $args, true);
$datasetName = trim((string)$args[count($args) - 1]);
$childName = basename($datasetName);
$mode = isset($datasets[$childName]) ? $datasets[$childName] : "";

if ( $mode === "" ) {
  fwrite(STDERR, "unknown dataset\n");
  exit(1);
}

if ( $preview ) {
  if ( $mode === "recursive" && ! $recursive ) {
    fwrite(STDERR, "cannot destroy '" . $datasetName . "': filesystem has children or snapshots\n");
    exit(1);
  }

  exit(0);
}

if ( $mode === "recursive" && ! $recursive ) {
  fwrite(STDERR, "cannot destroy '" . $datasetName . "': filesystem has children or snapshots\n");
  exit(1);
}

zfsFixtureRemoveTree(zfsFixtureDeletePath($shareRoot, $childName));
zfsFixtureRemoveTree(zfsFixtureDeletePath($datasetRoot, $childName));
exit(0);
