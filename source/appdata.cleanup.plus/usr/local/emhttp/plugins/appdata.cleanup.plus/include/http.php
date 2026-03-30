<?php

function jsonResponse($payload, $statusCode=200) {
  http_response_code($statusCode);
  header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
  header("Content-Type: application/json");
  header("Pragma: no-cache");
  header("X-Content-Type-Options: nosniff");
  echo json_encode($payload, JSON_UNESCAPED_SLASHES);
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

function requestTargetsCurrentHost() {
  $expectedHost = appdataCleanupPlusRequestHost();

  if ( ! $expectedHost ) {
    return true;
  }

  foreach ( array("HTTP_ORIGIN", "HTTP_REFERER") as $headerName ) {
    if ( empty($_SERVER[$headerName]) ) {
      continue;
    }

    $headerHost = appdataCleanupPlusUrlHost($_SERVER[$headerName]);
    if ( $headerHost && ! hash_equals($expectedHost, $headerHost) ) {
      return false;
    }
  }

  return true;
}

