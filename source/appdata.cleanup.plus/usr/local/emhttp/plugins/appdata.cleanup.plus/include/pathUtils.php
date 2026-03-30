<?php

function pathIsDescendant($parentPath, $childPath) {
  $normalizedParent = rtrim(normalizeUserPath($parentPath), "/");
  $normalizedChild = rtrim(normalizeUserPath($childPath), "/");

  if ( ! $normalizedParent || ! $normalizedChild || $normalizedParent === $normalizedChild ) {
    return false;
  }

  return startsWith($normalizedChild . "/", $normalizedParent . "/");
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

