<?php

if ( ! function_exists("my_parse_ini_file") ) {
  function my_parse_ini_file($file,$mode=false,$scanner_mode=INI_SCANNER_NORMAL) {
    return parse_ini_string(preg_replace('/^#.*\\n/m', "", @file_get_contents($file)),$mode,$scanner_mode);
  }
}

if ( ! function_exists("my_parse_ini_string") ) {
  function my_parse_ini_string($string, $mode=false,$scanner_mode=INI_SCANNER_NORMAL) {
    return parse_ini_string(preg_replace('/^#.*\\n/m', "", $string),$mode,$scanner_mode);
  }
}

function getAppdataShareName() {
  static $shareName = null;

  if ( $shareName !== null ) {
    return $shareName;
  }

  $dockerOptions = @my_parse_ini_file("/boot/config/docker.cfg");
  $defaultShareName = isset($dockerOptions['DOCKER_APP_CONFIG_PATH']) ? basename($dockerOptions['DOCKER_APP_CONFIG_PATH']) : "";
  $shareName = str_replace("/mnt/user/","",$defaultShareName);
  $shareName = str_replace("/mnt/cache/","",$shareName);

  if ( $shareName && ! is_file("/boot/config/shares/$shareName.cfg") ) {
    $shareName = "";
  }

  return $shareName;
}

function normalizeUserPath($path) {
  return str_replace("/mnt/cache/","/mnt/user/",$path);
}

function normalizeCachePath($path) {
  return str_replace("/mnt/user/","/mnt/cache/",$path);
}

function appdataPathSegments($path) {
  $userPath = normalizeUserPath($path);
  $trimmedPath = preg_replace('#^/mnt/(?:user|cache)/#', '', $userPath);
  $segments = array_values(array_filter(explode("/", trim($trimmedPath, "/")), "strlen"));
  return $segments;
}

function classifyAppdataCandidate($path) {
  $userPath = normalizeUserPath($path);
  $cachePath = normalizeCachePath($path);
  $segments = appdataPathSegments($path);
  $shareName = isset($segments[0]) ? $segments[0] : "";
  $defaultShareName = getAppdataShareName();
  $insideDefaultShare = $defaultShareName && $shareName === $defaultShareName;

  $classification = array(
    "path" => $path,
    "userPath" => $userPath,
    "cachePath" => $cachePath,
    "shareName" => $shareName,
    "depth" => count($segments),
    "insideDefaultShare" => $insideDefaultShare ? true : false,
    "risk" => "safe",
    "riskLabel" => "Safe",
    "riskReason" => "Inside the configured appdata share and not used by installed containers.",
    "canDelete" => true
  );

  if ( ! $shareName || in_array($userPath, array("/", "/mnt", "/mnt/user", "/mnt/cache"), true) ) {
    $classification["risk"] = "blocked";
    $classification["riskLabel"] = "Blocked";
    $classification["riskReason"] = "This path looks like a mount root and cannot be deleted here.";
    $classification["canDelete"] = false;
    return $classification;
  }

  if ( $insideDefaultShare ) {
    if ( count($segments) <= 1 ) {
      $classification["risk"] = "blocked";
      $classification["riskLabel"] = "Blocked";
      $classification["riskReason"] = "This is the configured appdata share root and cannot be deleted here.";
      $classification["canDelete"] = false;
    }
    return $classification;
  }

  if ( count($segments) <= 1 ) {
    $classification["risk"] = "blocked";
    $classification["riskLabel"] = "Blocked";
    $classification["riskReason"] = "This path looks like a share root and cannot be deleted here.";
    $classification["canDelete"] = false;
    return $classification;
  }

  $classification["risk"] = "review";
  $classification["riskLabel"] = "Review";
  $classification["riskReason"] = "This path sits outside the configured appdata share. Review it carefully before deleting.";
  return $classification;
}

function findAppdata($volumes) {
  $path = false;
  $shareName = getAppdataShareName();

  if ( ! $shareName ) {
    $shareName = "****";
  }

  if ( is_array($volumes) ) {
    foreach ($volumes as $volume) {
      $temp = explode(":",$volume);
      $testPath = strtolower($temp[1]);

      if ( (startsWith($testPath,"/config")) || (startsWith($temp[0],"/mnt/user/$shareName")) || (startsWith($temp[0],"/mnt/cache/$shareName")) ) {
        $path = $temp[0];
        break;
      }
    }
  }

  return $path;
}

function dirContents($path) {
  $dirContents = @scandir($path);
  if ( ! $dirContents ) {
    $dirContents = array();
  }
  return array_diff($dirContents,array(".",".."));
}

function appdataCleanupPlusConfigDir() {
  return "/boot/config/plugins/appdata.cleanup.plus";
}

function appdataCleanupPlusStateFile($filename) {
  return appdataCleanupPlusConfigDir() . "/" . ltrim($filename, "/");
}

function ensureAppdataCleanupPlusConfigDir() {
  $configDir = appdataCleanupPlusConfigDir();

  if ( is_dir($configDir) ) {
    return true;
  }

  return @mkdir($configDir, 0777, true);
}

function readAppdataCleanupPlusJsonFile($path, $default=array()) {
  if ( ! is_file($path) ) {
    return $default;
  }

  $contents = @file_get_contents($path);
  if ( $contents === false || $contents === "" ) {
    return $default;
  }

  $decoded = json_decode($contents, true);
  return is_array($decoded) ? $decoded : $default;
}

function writeAppdataCleanupPlusJsonFile($path, $payload) {
  if ( ! ensureAppdataCleanupPlusConfigDir() ) {
    return false;
  }

  $tmpFile = $path . ".tmp";
  $encoded = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);

  if ( $encoded === false ) {
    return false;
  }

  if ( @file_put_contents($tmpFile, $encoded . "\n", LOCK_EX) === false ) {
    return false;
  }

  return @rename($tmpFile, $path);
}

function appdataCleanupPlusIgnoreListFile() {
  return appdataCleanupPlusStateFile("ignored-paths.json");
}

function appdataCleanupPlusAuditLogFile() {
  return appdataCleanupPlusStateFile("cleanup-audit.jsonl");
}

function appdataCleanupPlusCandidateKey($path) {
  return normalizeUserPath(rtrim($path, "/"));
}

function getIgnoredAppdataCleanupPlusCandidates() {
  return readAppdataCleanupPlusJsonFile(appdataCleanupPlusIgnoreListFile(), array());
}

function setIgnoredAppdataCleanupPlusCandidates($ignoredCandidates) {
  return writeAppdataCleanupPlusJsonFile(appdataCleanupPlusIgnoreListFile(), $ignoredCandidates);
}

function ignoreAppdataCleanupPlusCandidate($path, $metadata=array()) {
  $candidateKey = appdataCleanupPlusCandidateKey($path);
  $ignoredCandidates = getIgnoredAppdataCleanupPlusCandidates();
  $ignoredCandidates[$candidateKey] = array(
    "path" => $candidateKey,
    "ignoredAt" => date("c"),
    "name" => isset($metadata["name"]) ? (string)$metadata["name"] : basename($candidateKey),
    "sourceSummary" => isset($metadata["sourceSummary"]) ? (string)$metadata["sourceSummary"] : "",
    "targetSummary" => isset($metadata["targetSummary"]) ? (string)$metadata["targetSummary"] : ""
  );

  return setIgnoredAppdataCleanupPlusCandidates($ignoredCandidates);
}

function unignoreAppdataCleanupPlusCandidate($path) {
  $candidateKey = appdataCleanupPlusCandidateKey($path);
  $ignoredCandidates = getIgnoredAppdataCleanupPlusCandidates();

  if ( ! isset($ignoredCandidates[$candidateKey]) ) {
    return true;
  }

  unset($ignoredCandidates[$candidateKey]);
  return setIgnoredAppdataCleanupPlusCandidates($ignoredCandidates);
}

function appendAppdataCleanupPlusAuditEntry($entry) {
  if ( ! ensureAppdataCleanupPlusConfigDir() ) {
    return false;
  }

  $encoded = json_encode($entry, JSON_UNESCAPED_SLASHES);
  if ( $encoded === false ) {
    return false;
  }

  return @file_put_contents(appdataCleanupPlusAuditLogFile(), $encoded . "\n", FILE_APPEND | LOCK_EX) !== false;
}

function getLatestAppdataCleanupPlusAuditEntry() {
  $auditPath = appdataCleanupPlusAuditLogFile();

  if ( ! is_file($auditPath) ) {
    return null;
  }

  $lines = @file($auditPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
  if ( ! is_array($lines) || empty($lines) ) {
    return null;
  }

  $decoded = json_decode($lines[count($lines) - 1], true);
  return is_array($decoded) ? $decoded : null;
}

?>
