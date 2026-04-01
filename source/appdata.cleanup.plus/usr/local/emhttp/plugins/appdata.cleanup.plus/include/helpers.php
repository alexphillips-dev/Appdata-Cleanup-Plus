<?php

if ( ! function_exists("appdataCleanupPlusParseIniFile") ) {
  function appdataCleanupPlusParseIniFile($file,$mode=false,$scanner_mode=INI_SCANNER_NORMAL) {
    $contents = @file_get_contents($file);

    if ( $contents === false || $contents === "" ) {
      return array();
    }

    return parse_ini_string(preg_replace('/^#.*\\n/m', "", (string)$contents),$mode,$scanner_mode);
  }
}

if ( ! function_exists("appdataCleanupPlusParseIniString") ) {
  function appdataCleanupPlusParseIniString($string, $mode=false,$scanner_mode=INI_SCANNER_NORMAL) {
    $string = (string)$string;

    if ( $string === "" ) {
      return array();
    }

    return parse_ini_string(preg_replace('/^#.*\\n/m', "", $string),$mode,$scanner_mode);
  }
}

if ( ! function_exists("startsWith") ) {
  function startsWith($haystack, $needle) {
    $haystack = (string)$haystack;
    $needle = (string)$needle;

    if ( $needle === "" ) {
      return true;
    }

    return strncmp($haystack, $needle, strlen($needle)) === 0;
  }
}

function appdataCleanupPlusDockerConfigPath() {
  $override = trim(str_replace("\\", "/", (string)getenv("APPDATA_CLEANUP_PLUS_DOCKER_CONFIG_PATH")));

  if ( $override ) {
    return $override;
  }

  return "/boot/config/docker.cfg";
}

function appdataCleanupPlusShareConfigDir() {
  $override = trim(str_replace("\\", "/", (string)getenv("APPDATA_CLEANUP_PLUS_SHARE_CONFIG_DIR")));

  if ( $override ) {
    return rtrim($override, "/");
  }

  return "/boot/config/shares";
}

function appdataCleanupPlusDockerTemplateDir() {
  $override = trim(str_replace("\\", "/", (string)getenv("APPDATA_CLEANUP_PLUS_DOCKER_TEMPLATE_DIR")));

  if ( $override ) {
    return rtrim($override, "/");
  }

  return "/boot/config/plugins/dockerMan/templates-user";
}

function appdataCleanupPlusVmConfigPath() {
  $override = trim(str_replace("\\", "/", (string)getenv("APPDATA_CLEANUP_PLUS_VM_CONFIG_PATH")));

  if ( $override ) {
    return $override;
  }

  return "/boot/config/domain.cfg";
}

function getAppdataCleanupPlusVmManagerConfig() {
  static $vmConfig = null;

  if ( $vmConfig !== null ) {
    return $vmConfig;
  }

  $vmConfig = @appdataCleanupPlusParseIniFile(appdataCleanupPlusVmConfigPath());
  return is_array($vmConfig) ? $vmConfig : array();
}

function appdataCleanupPlusNormalizeVmManagerStoragePath($path, $mode="dir") {
  $normalized = appdataCleanupPlusCanonicalizePath($path);

  if ( ! $normalized || $normalized[0] !== "/" ) {
    return "";
  }

  if ( $mode === "file_parent" ) {
    $normalized = appdataCleanupPlusCanonicalizePath(dirname($normalized));
  }

  if ( ! $normalized || $normalized[0] !== "/" ) {
    return "";
  }

  return $normalized;
}

function getAppdataCleanupPlusVmManagerManagedPaths() {
  static $managedPaths = null;
  $vmConfig = array();
  $pathSpecs = array();

  if ( $managedPaths !== null ) {
    return $managedPaths;
  }

  $vmConfig = getAppdataCleanupPlusVmManagerConfig();
  $pathSpecs = array(
    array(
      "key" => "DOMAINDIR",
      "label" => "VM Manager vdisk storage path",
      "mode" => "dir"
    ),
    array(
      "key" => "MEDIADIR",
      "label" => "VM Manager ISO storage path",
      "mode" => "dir"
    ),
    array(
      "key" => "IMAGE_FILE",
      "label" => "VM Manager libvirt storage path",
      "mode" => "file_parent"
    )
  );
  $managedPaths = array();

  foreach ( $pathSpecs as $pathSpec ) {
    $configuredPath = isset($vmConfig[$pathSpec["key"]]) ? trim((string)$vmConfig[$pathSpec["key"]]) : "";
    $normalizedPath = appdataCleanupPlusNormalizeVmManagerStoragePath($configuredPath, $pathSpec["mode"]);

    if ( ! $normalizedPath ) {
      continue;
    }

    $managedPaths[$normalizedPath] = array(
      "key" => $pathSpec["key"],
      "label" => $pathSpec["label"],
      "path" => $normalizedPath
    );
  }

  return array_values($managedPaths);
}

function appdataCleanupPlusNormalizeDockerManagedPath($path) {
  $normalized = appdataCleanupPlusCanonicalizePath($path);
  $baseName = basename($normalized);
  $extension = pathinfo($baseName, PATHINFO_EXTENSION);

  if ( ! $normalized || $normalized[0] !== "/" ) {
    return "";
  }

  if ( $extension !== "" ) {
    $normalized = appdataCleanupPlusCanonicalizePath(dirname($normalized));
  }

  if ( ! $normalized || $normalized[0] !== "/" ) {
    return "";
  }

  return $normalized;
}

function getAppdataCleanupPlusDockerManagedPaths() {
  static $managedPaths = null;
  $dockerConfig = array();
  $pathSpecs = array();

  if ( $managedPaths !== null ) {
    return $managedPaths;
  }

  $dockerConfig = @appdataCleanupPlusParseIniFile(appdataCleanupPlusDockerConfigPath());
  $pathSpecs = array(
    array(
      "key" => "DOCKER_IMAGE_FILE",
      "label" => "Docker image storage path"
    )
  );
  $managedPaths = array();

  foreach ( $pathSpecs as $pathSpec ) {
    $configuredPath = isset($dockerConfig[$pathSpec["key"]]) ? trim((string)$dockerConfig[$pathSpec["key"]]) : "";
    $normalizedPath = appdataCleanupPlusNormalizeDockerManagedPath($configuredPath);

    if ( ! $normalizedPath ) {
      continue;
    }

    $managedPaths[$normalizedPath] = array(
      "key" => $pathSpec["key"],
      "label" => $pathSpec["label"],
      "path" => $normalizedPath
    );
  }

  return array_values($managedPaths);
}

function appdataCleanupPlusFindManagedPathMatch($path, $managedPaths) {
  $normalizedPath = normalizeUserPath($path);

  if ( ! $normalizedPath ) {
    return null;
  }

  foreach ( $managedPaths as $managedPath ) {
    $managedRoot = normalizeUserPath(isset($managedPath["path"]) ? (string)$managedPath["path"] : "");

    if ( ! $managedRoot ) {
      continue;
    }

    if ( $normalizedPath === $managedRoot ) {
      $managedPath["relation"] = "exact";
      return $managedPath;
    }

    if ( startsWith($normalizedPath . "/", $managedRoot . "/") ) {
      $managedPath["relation"] = "inside";
      return $managedPath;
    }

    if ( startsWith($managedRoot . "/", $normalizedPath . "/") ) {
      $managedPath["relation"] = "contains";
      return $managedPath;
    }
  }

  return null;
}

function appdataCleanupPlusFindVmManagerPathMatch($path) {
  return appdataCleanupPlusFindManagedPathMatch($path, getAppdataCleanupPlusVmManagerManagedPaths());
}

function appdataCleanupPlusBuildVmManagerLockReason($path) {
  $managedMatch = appdataCleanupPlusFindVmManagerPathMatch($path);
  $managedRoot = "";
  $managedLabel = "";

  if ( ! is_array($managedMatch) ) {
    return "";
  }

  $managedRoot = isset($managedMatch["path"]) ? (string)$managedMatch["path"] : "";
  $managedLabel = isset($managedMatch["label"]) ? (string)$managedMatch["label"] : "VM Manager path";

  if ( isset($managedMatch["relation"]) && $managedMatch["relation"] === "contains" ) {
    return $managedLabel . " '" . $managedRoot . "' sits inside this folder and is excluded for safety.";
  }

  return $managedLabel . " '" . $managedRoot . "' is excluded for safety.";
}

function appdataCleanupPlusFindDockerManagedPathMatch($path) {
  return appdataCleanupPlusFindManagedPathMatch($path, getAppdataCleanupPlusDockerManagedPaths());
}

function appdataCleanupPlusBuildDockerManagedLockReason($path) {
  $managedMatch = appdataCleanupPlusFindDockerManagedPathMatch($path);
  $managedRoot = "";
  $managedLabel = "";

  if ( ! is_array($managedMatch) ) {
    return "";
  }

  $managedRoot = isset($managedMatch["path"]) ? (string)$managedMatch["path"] : "";
  $managedLabel = isset($managedMatch["label"]) ? (string)$managedMatch["label"] : "Docker managed path";

  if ( isset($managedMatch["relation"]) && $managedMatch["relation"] === "contains" ) {
    return $managedLabel . " '" . $managedRoot . "' sits inside this folder and is excluded for safety.";
  }

  return $managedLabel . " '" . $managedRoot . "' is excluded for safety.";
}

function appdataCleanupPlusBuildManagedSystemLockReason($path) {
  $vmManagerLockReason = appdataCleanupPlusBuildVmManagerLockReason($path);

  if ( $vmManagerLockReason !== "" ) {
    return $vmManagerLockReason;
  }

  return appdataCleanupPlusBuildDockerManagedLockReason($path);
}

function getAppdataShareName() {
  static $shareName = null;

  if ( $shareName !== null ) {
    return $shareName;
  }

  $dockerOptions = @appdataCleanupPlusParseIniFile(appdataCleanupPlusDockerConfigPath());
  $defaultShareName = isset($dockerOptions['DOCKER_APP_CONFIG_PATH']) ? basename($dockerOptions['DOCKER_APP_CONFIG_PATH']) : "";
  $shareName = str_replace("/mnt/user/","",$defaultShareName);
  $shareName = str_replace("/mnt/cache/","",$shareName);

  if ( $shareName && ! is_file(appdataCleanupPlusShareConfigDir() . "/$shareName.cfg") ) {
    $shareName = "";
  }

  return $shareName;
}

function getAppdataShareUserPath() {
  $shareName = getAppdataShareName();

  if ( ! $shareName ) {
    return "";
  }

  return "/mnt/user/" . $shareName;
}

function getAppdataShareCachePath() {
  $shareName = getAppdataShareName();

  if ( ! $shareName ) {
    return "";
  }

  return "/mnt/cache/" . $shareName;
}

function appdataCleanupPlusCanonicalizePath($path) {
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

function normalizeUserPath($path) {
  return appdataCleanupPlusCanonicalizePath(str_replace("/mnt/cache/","/mnt/user/",$path));
}

function normalizeCachePath($path) {
  return appdataCleanupPlusCanonicalizePath(str_replace("/mnt/user/","/mnt/cache/",$path));
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
    "riskLabel" => "Ready",
    "riskReason" => "Inside the configured appdata share and not used by installed containers.",
    "canDelete" => true
  );

  if ( ! $shareName || in_array($userPath, array("/", "/mnt", "/mnt/user", "/mnt/cache"), true) ) {
    $classification["risk"] = "blocked";
    $classification["riskLabel"] = "Locked";
    $classification["riskReason"] = "This path looks like a mount root and cannot be deleted here.";
    $classification["canDelete"] = false;
    return $classification;
  }

  if ( $insideDefaultShare ) {
    if ( count($segments) <= 1 ) {
      $classification["risk"] = "blocked";
      $classification["riskLabel"] = "Locked";
      $classification["riskReason"] = "This is the configured appdata share root and cannot be deleted here.";
      $classification["canDelete"] = false;
    }
    return $classification;
  }

  if ( count($segments) <= 1 ) {
    $classification["risk"] = "blocked";
    $classification["riskLabel"] = "Locked";
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

function appdataCleanupPlusConfiguredStateRoot() {
  $override = "";

  if ( defined("APPDATA_CLEANUP_PLUS_STATE_ROOT") ) {
    $override = trim(str_replace("\\", "/", (string)APPDATA_CLEANUP_PLUS_STATE_ROOT));
  }

  if ( ! $override ) {
    $override = trim(str_replace("\\", "/", (string)getenv("APPDATA_CLEANUP_PLUS_STATE_ROOT")));
  }

  if ( ! $override ) {
    return "";
  }

  return rtrim($override, "/");
}

function appdataCleanupPlusConfigDir() {
  $configuredRoot = appdataCleanupPlusConfiguredStateRoot();

  if ( $configuredRoot ) {
    return $configuredRoot;
  }

  return "/boot/config/plugins/appdata.cleanup.plus";
}

function appdataCleanupPlusStateFile($filename) {
  return appdataCleanupPlusConfigDir() . "/" . ltrim($filename, "/");
}

function appdataCleanupPlusSanitizeStateKey($value) {
  return preg_replace('/[^A-Za-z0-9._-]+/', '', (string)$value);
}

function &appdataCleanupPlusRuntimeStore() {
  static $store = array();
  return $store;
}

function appdataCleanupPlusDirectoryMode() {
  return 0755;
}

function ensureAppdataCleanupPlusDirectory($path) {
  $path = rtrim((string)$path, "/");

  if ( ! $path ) {
    return false;
  }

  if ( is_dir($path) ) {
    @chmod($path, appdataCleanupPlusDirectoryMode());
    return true;
  }

  if ( ! @mkdir($path, appdataCleanupPlusDirectoryMode(), true) ) {
    return false;
  }

  @chmod($path, appdataCleanupPlusDirectoryMode());
  return true;
}

function ensureAppdataCleanupPlusConfigDir() {
  return ensureAppdataCleanupPlusDirectory(appdataCleanupPlusConfigDir());
}

function readAppdataCleanupPlusTemplateFile($path) {
  if ( ! is_file($path) ) {
    return array();
  }

  $xml = @simplexml_load_file($path, "SimpleXMLElement", LIBXML_NOCDATA | LIBXML_NONET);
  if ( ! ($xml instanceof SimpleXMLElement) ) {
    return array();
  }

  $template = array(
    "Name" => isset($xml->Name) ? trim((string)$xml->Name) : "",
    "Config" => array()
  );

  foreach ( $xml->Config as $configNode ) {
    $attributes = array();

    foreach ( $configNode->attributes() as $attributeName => $attributeValue ) {
      $attributes[(string)$attributeName] = trim((string)$attributeValue);
    }

    $template["Config"][] = array(
      "@attributes" => $attributes,
      "value" => trim((string)$configNode)
    );
  }

  return $template;
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

function appdataCleanupPlusJsonFlags($flags=0) {
  $flags |= JSON_UNESCAPED_SLASHES;

  if ( defined("JSON_INVALID_UTF8_SUBSTITUTE") ) {
    $flags |= JSON_INVALID_UTF8_SUBSTITUTE;
  }

  return $flags;
}

function appdataCleanupPlusNormalizeUtf8Value($value) {
  if ( is_array($value) ) {
    foreach ( $value as $key => $item ) {
      $value[$key] = appdataCleanupPlusNormalizeUtf8Value($item);
    }

    return $value;
  }

  if ( ! is_string($value) || $value === "" ) {
    return $value;
  }

  if ( @preg_match('//u', $value) ) {
    return $value;
  }

  if ( function_exists("iconv") ) {
    $normalized = @iconv("UTF-8", "UTF-8//IGNORE", $value);

    if ( $normalized !== false ) {
      return $normalized;
    }
  }

  return preg_replace('/[^\x09\x0A\x0D\x20-\x7E]/', '', $value);
}

function appdataCleanupPlusJsonEncode($payload, $flags=0) {
  $encoded = json_encode($payload, appdataCleanupPlusJsonFlags($flags));

  if ( $encoded !== false ) {
    return $encoded;
  }

  return json_encode(appdataCleanupPlusNormalizeUtf8Value($payload), appdataCleanupPlusJsonFlags($flags));
}

function writeAppdataCleanupPlusJsonFile($path, $payload) {
  if ( ! ensureAppdataCleanupPlusConfigDir() ) {
    return false;
  }

  if ( ! ensureAppdataCleanupPlusDirectory(dirname($path)) ) {
    return false;
  }

  $tmpFile = $path . ".tmp";
  $encoded = appdataCleanupPlusJsonEncode($payload, JSON_PRETTY_PRINT);

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

function appdataCleanupPlusSafetySettingsFile() {
  return appdataCleanupPlusStateFile("safety-settings.json");
}

function appdataCleanupPlusSnapshotStorageDir() {
  return appdataCleanupPlusStateFile("snapshots");
}

function appdataCleanupPlusStatsCacheFile() {
  return appdataCleanupPlusStateFile("path-stats-cache.json");
}

function appdataCleanupPlusQuarantineRegistryFile() {
  return appdataCleanupPlusStateFile("quarantine-records.json");
}

function appdataCleanupPlusStatsCacheTtlSeconds() {
  return 900;
}

function appdataCleanupPlusSnapshotScopeKey() {
  if ( ! ensureAppdataCleanupPlusSession() ) {
    return "";
  }

  $sessionId = session_id();
  if ( ! $sessionId ) {
    return "";
  }

  return hash("sha256", $sessionId);
}

function appdataCleanupPlusSnapshotScopeDir($scopeKey="") {
  $safeScopeKey = appdataCleanupPlusSanitizeStateKey($scopeKey ? $scopeKey : appdataCleanupPlusSnapshotScopeKey());

  if ( ! $safeScopeKey ) {
    return "";
  }

  return appdataCleanupPlusSnapshotStorageDir() . "/" . $safeScopeKey;
}

function appdataCleanupPlusSnapshotFile($token="") {
  $safeToken = appdataCleanupPlusSanitizeStateKey($token);
  $scopeDir = appdataCleanupPlusSnapshotScopeDir();

  if ( ! $safeToken || ! $scopeDir ) {
    return "";
  }

  return $scopeDir . "/" . $safeToken . ".json";
}

function getDefaultAppdataCleanupPlusQuarantineRoot() {
  $shareName = getAppdataShareName();

  if ( $shareName ) {
    return "/mnt/user/" . $shareName . "/.appdata-cleanup-plus-quarantine";
  }

  return "/mnt/user/system/.appdata-cleanup-plus-quarantine";
}

function getDefaultAppdataCleanupPlusSafetySettings() {
  return array(
    "allowOutsideShareCleanup" => false,
    "enablePermanentDelete" => false,
    "quarantineRoot" => getDefaultAppdataCleanupPlusQuarantineRoot()
  );
}

function normalizeAppdataCleanupPlusSafetySettings($settings) {
  $defaults = getDefaultAppdataCleanupPlusSafetySettings();
  $normalized = array(
    "allowOutsideShareCleanup" => ! empty($settings["allowOutsideShareCleanup"]),
    "enablePermanentDelete" => ! empty($settings["enablePermanentDelete"]),
    "quarantineRoot" => isset($settings["quarantineRoot"]) ? trim((string)$settings["quarantineRoot"]) : $defaults["quarantineRoot"]
  );

  if ( ! $normalized["quarantineRoot"] ) {
    $normalized["quarantineRoot"] = $defaults["quarantineRoot"];
  }

  $normalized["quarantineRoot"] = rtrim($normalized["quarantineRoot"], "/");
  return $normalized;
}

function getAppdataCleanupPlusSafetySettings() {
  return normalizeAppdataCleanupPlusSafetySettings(readAppdataCleanupPlusJsonFile(appdataCleanupPlusSafetySettingsFile(), array()));
}

function setAppdataCleanupPlusSafetySettings($settings) {
  return writeAppdataCleanupPlusJsonFile(appdataCleanupPlusSafetySettingsFile(), normalizeAppdataCleanupPlusSafetySettings($settings));
}

function appdataCleanupPlusRandomToken() {
  if ( function_exists("random_bytes") ) {
    return bin2hex(random_bytes(18));
  }

  if ( function_exists("openssl_random_pseudo_bytes") ) {
    return bin2hex(openssl_random_pseudo_bytes(18));
  }

  return md5(uniqid((string)mt_rand(), true));
}

function ensureAppdataCleanupPlusSession() {
  if ( function_exists("session_status") && session_status() === PHP_SESSION_ACTIVE ) {
    return true;
  }

  if ( headers_sent() ) {
    return false;
  }

  @session_start();
  return function_exists("session_status") && session_status() === PHP_SESSION_ACTIVE;
}

function getAppdataCleanupPlusCsrfToken() {
  if ( ! ensureAppdataCleanupPlusSession() ) {
    return "";
  }

  if ( empty($_SESSION["appdataCleanupPlusCsrfToken"]) || ! is_string($_SESSION["appdataCleanupPlusCsrfToken"]) ) {
    $_SESSION["appdataCleanupPlusCsrfToken"] = appdataCleanupPlusRandomToken();
  }

  return (string)$_SESSION["appdataCleanupPlusCsrfToken"];
}

function validateAppdataCleanupPlusCsrfToken($token) {
  $providedToken = trim((string)$token);
  $storedToken = getAppdataCleanupPlusCsrfToken();

  if ( ! $providedToken || ! $storedToken ) {
    return false;
  }

  return hash_equals($storedToken, $providedToken);
}

function appdataCleanupPlusCandidateKey($path) {
  return normalizeUserPath($path);
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

  $encoded = appdataCleanupPlusJsonEncode($entry);
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

function getAppdataCleanupPlusAuditHistory($limit=0) {
  $auditPath = appdataCleanupPlusAuditLogFile();
  $entries = array();

  if ( ! is_file($auditPath) ) {
    return $entries;
  }

  $lines = @file($auditPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
  if ( ! is_array($lines) || empty($lines) ) {
    return $entries;
  }

  $lines = array_reverse($lines);

  foreach ( $lines as $line ) {
    $decoded = json_decode($line, true);

    if ( is_array($decoded) ) {
      $entries[] = $decoded;
    }

    if ( $limit > 0 && count($entries) >= $limit ) {
      break;
    }
  }

  return $entries;
}

function getAppdataCleanupPlusQuarantineRegistry() {
  $registry = readAppdataCleanupPlusJsonFile(appdataCleanupPlusQuarantineRegistryFile(), array());

  return is_array($registry) ? $registry : array();
}

function setAppdataCleanupPlusQuarantineRegistry($registry) {
  return writeAppdataCleanupPlusJsonFile(appdataCleanupPlusQuarantineRegistryFile(), is_array($registry) ? $registry : array());
}

function appdataCleanupPlusStatsCacheState($nextState=null, $replace=false) {
  $runtime =& appdataCleanupPlusRuntimeStore();

  if ( ! isset($runtime["statsCacheState"]) || ! is_array($runtime["statsCacheState"]) ) {
    $loaded = readAppdataCleanupPlusJsonFile(appdataCleanupPlusStatsCacheFile(), array());

    $runtime["statsCacheState"] = array(
      "entries" => is_array($loaded) ? $loaded : array(),
      "dirty" => false,
      "shutdownRegistered" => false
    );
  }

  if ( $replace && is_array($nextState) ) {
    $runtime["statsCacheState"] = $nextState;
  }

  return $runtime["statsCacheState"];
}

function persistAppdataCleanupPlusStatsCacheIfDirty() {
  $state = appdataCleanupPlusStatsCacheState();

  if ( empty($state["dirty"]) ) {
    return true;
  }

  $entries = isset($state["entries"]) && is_array($state["entries"]) ? $state["entries"] : array();
  uasort($entries, function($left, $right) {
    $leftTime = isset($left["cachedAt"]) ? (int)$left["cachedAt"] : 0;
    $rightTime = isset($right["cachedAt"]) ? (int)$right["cachedAt"] : 0;
    return $rightTime <=> $leftTime;
  });
  $entries = array_slice($entries, 0, 512, true);

  if ( ! writeAppdataCleanupPlusJsonFile(appdataCleanupPlusStatsCacheFile(), $entries) ) {
    return false;
  }

  $state["entries"] = $entries;
  $state["dirty"] = false;
  appdataCleanupPlusStatsCacheState($state, true);
  return true;
}

function registerAppdataCleanupPlusStatsCachePersistence() {
  $state = appdataCleanupPlusStatsCacheState();

  if ( ! empty($state["shutdownRegistered"]) ) {
    return;
  }

  $state["shutdownRegistered"] = true;
  appdataCleanupPlusStatsCacheState($state, true);
  register_shutdown_function("persistAppdataCleanupPlusStatsCacheIfDirty");
}

function appdataCleanupPlusPathStatsCacheKey($path) {
  return sha1(appdataCleanupPlusCandidateKey($path));
}

function getCachedAppdataCleanupPlusPathStats($path) {
  $state = appdataCleanupPlusStatsCacheState();
  $entries = isset($state["entries"]) && is_array($state["entries"]) ? $state["entries"] : array();
  $cacheKey = appdataCleanupPlusPathStatsCacheKey($path);
  $entry = isset($entries[$cacheKey]) && is_array($entries[$cacheKey]) ? $entries[$cacheKey] : null;

  if ( ! $entry ) {
    return null;
  }

  $cachedAt = isset($entry["cachedAt"]) ? (int)$entry["cachedAt"] : 0;
  if ( ! $cachedAt || ($cachedAt + appdataCleanupPlusStatsCacheTtlSeconds()) < time() ) {
    return null;
  }

  return $entry;
}

function setCachedAppdataCleanupPlusPathStats($path, $stats) {
  $state = appdataCleanupPlusStatsCacheState();
  $entries = isset($state["entries"]) && is_array($state["entries"]) ? $state["entries"] : array();
  $cacheKey = appdataCleanupPlusPathStatsCacheKey($path);

  $entries[$cacheKey] = array(
    "path" => appdataCleanupPlusCandidateKey($path),
    "sizeBytes" => isset($stats["sizeBytes"]) ? $stats["sizeBytes"] : null,
    "lastModified" => isset($stats["lastModified"]) ? $stats["lastModified"] : null,
    "cachedAt" => time()
  );

  $state["entries"] = $entries;
  $state["dirty"] = true;
  appdataCleanupPlusStatsCacheState($state, true);
  registerAppdataCleanupPlusStatsCachePersistence();
  return true;
}

function clearCachedAppdataCleanupPlusPathStats($path) {
  $state = appdataCleanupPlusStatsCacheState();
  $entries = isset($state["entries"]) && is_array($state["entries"]) ? $state["entries"] : array();
  $cacheKey = appdataCleanupPlusPathStatsCacheKey($path);

  if ( ! isset($entries[$cacheKey]) ) {
    return true;
  }

  unset($entries[$cacheKey]);
  $state["entries"] = $entries;
  $state["dirty"] = true;
  appdataCleanupPlusStatsCacheState($state, true);
  registerAppdataCleanupPlusStatsCachePersistence();
  return true;
}

function appdataCleanupPlusSnapshotTtlSeconds() {
  return 1800;
}

function cleanupExpiredAppdataCleanupPlusSnapshots() {
  $snapshotFiles = glob(appdataCleanupPlusSnapshotStorageDir() . "/*/*.json");

  if ( ! is_array($snapshotFiles) ) {
    return;
  }

  foreach ( $snapshotFiles as $snapshotFile ) {
    $snapshot = readAppdataCleanupPlusJsonFile($snapshotFile, array());
    $expiresAt = isset($snapshot["expiresAt"]) ? strtotime((string)$snapshot["expiresAt"]) : 0;

    if ( ! $expiresAt || $expiresAt < time() ) {
      @unlink($snapshotFile);
    }
  }
}

function writeAppdataCleanupPlusSnapshot($candidateMap) {
  cleanupExpiredAppdataCleanupPlusSnapshots();

  $snapshot = array(
    "token" => appdataCleanupPlusRandomToken(),
    "scope" => appdataCleanupPlusSnapshotScopeKey(),
    "issuedAt" => date("c"),
    "expiresAt" => date("c", time() + appdataCleanupPlusSnapshotTtlSeconds()),
    "candidates" => is_array($candidateMap) ? $candidateMap : array()
  );

  $snapshotFile = appdataCleanupPlusSnapshotFile($snapshot["token"]);
  if ( ! $snapshotFile || ! writeAppdataCleanupPlusJsonFile($snapshotFile, $snapshot) ) {
    return null;
  }

  return $snapshot;
}

function getAppdataCleanupPlusSnapshot($token) {
  $snapshotFile = appdataCleanupPlusSnapshotFile($token);

  if ( ! $snapshotFile ) {
    return array();
  }

  return readAppdataCleanupPlusJsonFile($snapshotFile, array());
}

function getValidatedAppdataCleanupPlusSnapshot($token) {
  cleanupExpiredAppdataCleanupPlusSnapshots();
  $snapshot = getAppdataCleanupPlusSnapshot($token);
  $expiresAt = isset($snapshot["expiresAt"]) ? strtotime((string)$snapshot["expiresAt"]) : 0;
  $scope = isset($snapshot["scope"]) ? (string)$snapshot["scope"] : "";

  if ( ! $token || empty($snapshot["token"]) || ! hash_equals((string)$snapshot["token"], (string)$token) ) {
    return null;
  }

  if ( ! $scope || ! hash_equals($scope, (string)appdataCleanupPlusSnapshotScopeKey()) ) {
    return null;
  }

  if ( ! $expiresAt || $expiresAt < time() ) {
    return null;
  }

  if ( empty($snapshot["candidates"]) || ! is_array($snapshot["candidates"]) ) {
    return null;
  }

  return $snapshot;
}

?>
