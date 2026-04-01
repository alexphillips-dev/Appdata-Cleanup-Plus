<?php

function pathIsDescendant($parentPath, $childPath) {
  $normalizedParent = rtrim(normalizeUserPath($parentPath), "/");
  $normalizedChild = rtrim(normalizeUserPath($childPath), "/");

  if ( ! $normalizedParent || ! $normalizedChild || $normalizedParent === $normalizedChild ) {
    return false;
  }

  return startsWith($normalizedChild . "/", $normalizedParent . "/");
}

function pathMatchesOrIsDescendant($parentPath, $childPath) {
  $normalizedParent = rtrim(normalizeUserPath($parentPath), "/");
  $normalizedChild = rtrim(normalizeUserPath($childPath), "/");

  if ( ! $normalizedParent || ! $normalizedChild ) {
    return false;
  }

  return $normalizedParent === $normalizedChild || startsWith($normalizedChild . "/", $normalizedParent . "/");
}

function resolveExistingPath($classification) {
  if ( is_dir($classification["userPath"]) ) {
    return $classification["userPath"];
  }

  if ( $classification["cachePath"] !== $classification["userPath"] && is_dir($classification["cachePath"]) ) {
    return $classification["cachePath"];
  }

  return $classification["path"];
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

function buildSymlinkLockReason($path, $prefix="Path") {
  $normalizedPath = trim((string)$path);

  if ( ! $normalizedPath ) {
    return "Symlinked paths are locked for safety.";
  }

  $target = @readlink($normalizedPath);
  $message = $prefix . " '" . $normalizedPath . "' is a symlink";

  if ( is_string($target) && $target !== "" ) {
    $message .= " to '" . $target . "'";
  }

  return $message . " and is locked for safety.";
}

function getPathSymlinkSegment($path) {
  $trimmed = trim((string)$path);

  if ( ! $trimmed || $trimmed[0] !== "/" ) {
    return "";
  }

  $segments = array_values(array_filter(explode("/", trim($trimmed, "/")), "strlen"));
  $currentPath = "";

  foreach ( $segments as $segment ) {
    $currentPath .= "/" . $segment;

    if ( @is_link($currentPath) ) {
      return $currentPath;
    }
  }

  return "";
}

function buildPathSymlinkSegmentLockReason($path) {
  $segmentPath = getPathSymlinkSegment($path);

  if ( ! $segmentPath ) {
    return "";
  }

  return buildSymlinkLockReason($segmentPath, "Path segment");
}

function pathHasSymlinkSegment($path) {
  return getPathSymlinkSegment($path) !== "";
}

function inspectDirectoryTreeForUnsafeEntries($path) {
  if ( @is_link($path) ) {
    return buildSymlinkLockReason($path, "Folder");
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
        return buildSymlinkLockReason($itemPath, "Folder entry");
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

