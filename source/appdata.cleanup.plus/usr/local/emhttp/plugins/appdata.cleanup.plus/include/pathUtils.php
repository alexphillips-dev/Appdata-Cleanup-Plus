<?php

function pathIsDescendant($parentPath, $childPath) {
  return appdataCleanupPlusPathMatchesOrIsDescendantByVariants($parentPath, $childPath, false);
}

function pathMatchesOrIsDescendant($parentPath, $childPath) {
  return appdataCleanupPlusPathMatchesOrIsDescendantByVariants($parentPath, $childPath, true);
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

function appdataCleanupPlusDecodeMountInfoPath($path) {
  return str_replace(
    array("\\040", "\\011", "\\012", "\\134"),
    array(" ", "\t", "\n", "\\"),
    (string)$path
  );
}

function appdataCleanupPlusReadMountInfoPaths() {
  $contents = false;
  $mountPaths = array();

  if ( array_key_exists("APPDATA_CLEANUP_PLUS_TEST_MOUNTINFO", $GLOBALS) ) {
    $contents = $GLOBALS["APPDATA_CLEANUP_PLUS_TEST_MOUNTINFO"];
  } elseif ( is_readable("/proc/self/mountinfo") ) {
    $contents = @file_get_contents("/proc/self/mountinfo");
  }

  if ( ! is_string($contents) || trim($contents) === "" ) return null;

  foreach ( preg_split('/\r\n|\r|\n/', $contents) as $line ) {
    $fields = preg_split('/\s+/', trim((string)$line));
    if ( trim((string)$line) === "" ) continue;
    if ( ! is_array($fields) || count($fields) < 10 || ! in_array("-", $fields, true) ) return null;

    $mountPath = appdataCleanupPlusCanonicalizePath(appdataCleanupPlusDecodeMountInfoPath($fields[4]));
    if ( $mountPath === "" ) return null;
    $mountPaths[$mountPath] = true;
  }

  return $mountPaths;
}

// Unknown is a separate result: even an exact ZFS mapping must not turn a
// failed filesystem/mount inspection into authorization to act.
function appdataCleanupPlusMountStatus($path) {
  $path = appdataCleanupPlusCanonicalizePath($path);
  clearstatcache(true, $path);

  if ( ! $path || ! is_dir($path) ) {
    return "unknown";
  }

  if ( isset($GLOBALS["APPDATA_CLEANUP_PLUS_TEST_MOUNT_POINTS"]) && is_array($GLOBALS["APPDATA_CLEANUP_PLUS_TEST_MOUNT_POINTS"]) ) {
    return ! empty($GLOBALS["APPDATA_CLEANUP_PLUS_TEST_MOUNT_POINTS"][$path]) ? "mount" : "directory";
  }

  $mountInfoPaths = appdataCleanupPlusReadMountInfoPaths();
  if ( $mountInfoPaths === null ) return "unknown";
  if ( isset($mountInfoPaths[$path]) ) {
    return "mount";
  }

  $parentPath = dirname($path);
  if ( $parentPath === $path ) {
    return "mount";
  }

  clearstatcache(true, $parentPath);
  $pathStat = @stat($path);
  $parentStat = @stat($parentPath);

  if ( ! is_array($pathStat) || ! is_array($parentStat) || ! isset($pathStat["dev"], $parentStat["dev"]) ) {
    return "unknown";
  }

  return $pathStat["dev"] !== $parentStat["dev"] ? "mount" : "directory";
}

function pathIsMountPoint($path) {
  return appdataCleanupPlusMountStatus($path) !== "directory";
}

function appdataCleanupPlusMountSafetyReason($path, $allowVerifiedMount=false) {
  $status = appdataCleanupPlusMountStatus($path);
  if ( $status === "unknown" ) return "Folder contents could not be inspected safely.";
  return $status === "mount" && ! $allowVerifiedMount ? "Mount-point folders are locked for safety." : "";
}

function buildSymlinkLockReason($path, $prefix="Path") {
  $normalizedPath = trim((string)$path);

  if ( ! $normalizedPath ) {
    return "Symlinked paths are locked for safety.";
  }

  $target = @readlink($normalizedPath);
  if ( is_string($target) && $target !== "" ) {
    return acpMessage("{message} '{path}' is a symlink to '{target}' and is locked for safety.", array("message" => $prefix, "path" => $normalizedPath, "target" => $target));
  }
  return acpMessage("{message} '{path}' is a symlink and is locked for safety.", array("message" => $prefix, "path" => $normalizedPath));
}

function appdataCleanupPlusAllowedSymlinkSegmentRoots() {
  static $allowedRoots = null;
  $roots = array();

  if ( $allowedRoots !== null ) {
    return $allowedRoots;
  }

  foreach ( getAppdataCleanupPlusConfiguredSourceRoots() as $rootPath ) {
    $normalizedRoot = appdataCleanupPlusCanonicalizePath($rootPath);

    if ( ! $normalizedRoot || isset($roots[$normalizedRoot]) ) {
      continue;
    }

    $roots[$normalizedRoot] = true;
  }

  $allowedRoots = array_keys($roots);
  return $allowedRoots;
}

function appdataCleanupPlusIsAllowedSymlinkSegment($segmentPath) {
  $normalizedSegmentPath = normalizeUserPath($segmentPath);

  if ( ! $normalizedSegmentPath ) {
    return false;
  }

  foreach ( appdataCleanupPlusAllowedSymlinkSegmentRoots() as $allowedRoot ) {
    if ( $normalizedSegmentPath === $allowedRoot ) {
      return true;
    }
  }

  return false;
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
      if ( appdataCleanupPlusIsAllowedSymlinkSegment($currentPath) ) {
        continue;
      }

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

function inspectDirectoryTreeForUnsafeEntries($path, $options=array()) {
  $allowSymlinkEntries = ! empty($options["allowSymlinkEntries"]);

  if ( @is_link($path) ) {
    return buildSymlinkLockReason($path, "Folder");
  }

  if ( ! is_dir($path) ) {
    return "Path no longer exists.";
  }

  $mountReason = appdataCleanupPlusMountSafetyReason($path);
  if ( $mountReason !== "" ) return $mountReason;

  try {
    $iterator = new RecursiveIteratorIterator(
      new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS),
      RecursiveIteratorIterator::SELF_FIRST
    );

    foreach ( $iterator as $item ) {
      $itemPath = $item->getPathname();

      if ( $item->isLink() && ! $allowSymlinkEntries ) {
        return buildSymlinkLockReason($itemPath, "Folder entry");
      }

      if ( $item->isDir() ) {
        $mountStatus = appdataCleanupPlusMountStatus($itemPath);
        if ( $mountStatus === "unknown" ) return "Folder contents could not be inspected safely.";
        if ( $mountStatus === "mount" ) return "Folders containing nested mount points are locked for safety.";
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

