<?php

function appdataCleanupPlusDrainOutputBuffers() {
  $captured = array();

  while ( ob_get_level() > 0 ) {
    $captured[] = (string)ob_get_clean();
  }

  return implode("", array_reverse($captured));
}

function jsonResponse($payload, $statusCode=200) {
  $strayOutput = appdataCleanupPlusDrainOutputBuffers();

  if ( trim($strayOutput) !== "" ) {
    error_log("Appdata Cleanup Plus discarded unexpected exec output: " . substr(trim(preg_replace('/\s+/', ' ', $strayOutput)), 0, 400));
  }

  http_response_code($statusCode);
  header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
  header("Content-Type: application/json");
  header("Pragma: no-cache");
  header("X-Content-Type-Options: nosniff");
  echo appdataCleanupPlusJsonEncode($payload);
  exit;
}

function parseCandidateIds($rawIds) {
  $ids = array();

  if ( ! $rawIds ) {
    return $ids;
  }

  $decoded = json_decode($rawIds, true);
  if ( is_array($decoded) ) {
    $ids = $decoded;
  } else {
    $ids = explode("*", $rawIds);
  }

  $cleanIds = array();
  foreach ( $ids as $id ) {
    $id = trim((string)$id);
    if ( $id ) {
      $cleanIds[$id] = true;
    }
  }

  return array_keys($cleanIds);
}

function getRequestedToken() {
  return isset($_POST["scanToken"]) ? trim((string)$_POST["scanToken"]) : "";
}

function getPostedString($key) {
  if ( ! isset($_POST[$key]) || is_array($_POST[$key]) ) {
    return "";
  }

  return trim((string)$_POST[$key]);
}

function getRequestedOperation() {
  return getPostedString("operation");
}

function getRequestedCsrfToken() {
  if ( ! empty($_SERVER["HTTP_X_APPDATA_CLEANUP_PLUS_CSRF"]) ) {
    return trim((string)$_SERVER["HTTP_X_APPDATA_CLEANUP_PLUS_CSRF"]);
  }

  return isset($_POST["csrfToken"]) ? trim((string)$_POST["csrfToken"]) : "";
}

function getPostedBoolean($key) {
  if ( ! isset($_POST[$key]) ) {
    return false;
  }

  $value = strtolower(trim((string)$_POST[$key]));
  return in_array($value, array("1", "true", "yes", "on"), true);
}

function appdataCleanupPlusRequestHost() {
  $host = "";

  if ( ! empty($_SERVER["HTTP_HOST"]) ) {
    $host = (string)$_SERVER["HTTP_HOST"];
  } elseif ( ! empty($_SERVER["SERVER_NAME"]) ) {
    $host = (string)$_SERVER["SERVER_NAME"];
  }

  $host = strtolower(trim($host));
  return preg_replace('/:\d+$/', "", $host);
}

function appdataCleanupPlusUrlHost($url) {
  $host = parse_url((string)$url, PHP_URL_HOST);

  if ( ! is_string($host) || $host === "" ) {
    return "";
  }

  return strtolower($host);
}

function appdataCleanupPlusExpectedHosts() {
  $hosts = array();
  $headerValues = array(
    appdataCleanupPlusRequestHost(),
    isset($_SERVER["HTTP_X_FORWARDED_HOST"]) ? (string)$_SERVER["HTTP_X_FORWARDED_HOST"] : "",
    isset($_SERVER["HTTP_X_FORWARDED_SERVER"]) ? (string)$_SERVER["HTTP_X_FORWARDED_SERVER"] : ""
  );

  foreach ( $headerValues as $headerValue ) {
    if ( ! $headerValue ) {
      continue;
    }

    foreach ( explode(",", $headerValue) as $candidateHost ) {
      $candidateHost = strtolower(trim((string)$candidateHost));
      $candidateHost = preg_replace('/:\d+$/', "", $candidateHost);

      if ( $candidateHost ) {
        $hosts[$candidateHost] = true;
      }
    }
  }

  return array_keys($hosts);
}

function requestTargetsCurrentHost() {
  $expectedHosts = appdataCleanupPlusExpectedHosts();

  if ( empty($expectedHosts) ) {
    return true;
  }

  foreach ( array("HTTP_ORIGIN", "HTTP_REFERER") as $headerName ) {
    if ( empty($_SERVER[$headerName]) ) {
      continue;
    }

    $headerHost = appdataCleanupPlusUrlHost($_SERVER[$headerName]);
    if ( $headerHost && ! in_array($headerHost, $expectedHosts, true) ) {
      return false;
    }
  }

  return true;
}
