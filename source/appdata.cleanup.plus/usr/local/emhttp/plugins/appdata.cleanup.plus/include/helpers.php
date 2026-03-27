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

?>
