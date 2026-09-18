<?php

function acpLocales() {
  static $locales;
  if ($locales === null) {
    $locales = json_decode((string)file_get_contents(__DIR__ . '/../locales/locales.json'), true) ?: array();
  }
  return $locales;
}

function acpLocale() {
  // Unraid's session locale is authoritative, including an empty English toggle.
  $value = $_SESSION['locale'] ?? $GLOBALS['locale'] ?? 'en_US';
  $value = is_string($value) ? str_replace('-', '_', $value) : '';
  $aliases = array('ja_JP'=>'ja_JA', 'ko_KR'=>'ko_KO', 'da_DK'=>'da_DA', 'ca_ES'=>'ca_CA', 'bn_BD'=>'bn_BN', 'nb_NO'=>'no_NO', 'zh_Hans'=>'zh_CN', 'zh_Hant'=>'zh_TW');
  $value = $aliases[$value] ?? $value;
  if (isset(acpLocales()[$value])) return $value;
  foreach (acpLocales() as $locale => $definition) {
    if ($value === explode('_', $locale)[0]) return $locale;
  }
  return 'en_US';
}

function acpCatalog($locale=null) {
  static $catalogs = array();
  $locale = $locale ?? acpLocale();
  if (!isset(acpLocales()[$locale])) $locale = 'en_US';
  if (!isset($catalogs[$locale])) {
    $contents = @file_get_contents(__DIR__ . '/../locales/' . $locale . '.json');
    $catalogs[$locale] = is_string($contents) ? (json_decode($contents, true) ?: array()) : array();
  }
  return $catalogs[$locale];
}

function acpT($text, $parameters=array()) {
  $catalog = acpCatalog();
  $translated = isset($catalog[$text]) && is_string($catalog[$text]) && $catalog[$text] !== '' ? $catalog[$text] : $text;
  $replace = array();
  foreach ($parameters as $key => $value) $replace['{' . $key . '}'] = (string)$value;
  return strtr($translated, $replace);
}

function acpH($text) {
  return htmlspecialchars(acpT($text), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

// Construct stable English messages for state/audit storage and match them only
// at the response boundary. Parameters such as paths and names remain literal.
function acpMessage($text, $parameters=array()) {
  $replace = array();
  foreach ($parameters as $key => $value) $replace['{' . $key . '}'] = (string)$value;
  return strtr($text, $replace);
}

function acpLocalizeText($text, $depth=0) {
  if (!is_string($text) || $text === '' || acpLocale() === 'en_US' || $depth > 8) return $text;
  $catalog = acpCatalog();
  if (isset($catalog[$text])) return $catalog[$text];
  static $patterns;
  if ($patterns === null) {
    $patterns = array();
    foreach (acpCatalog('en_US') as $template) {
      if (!preg_match_all('/\{(\w+)\}/', $template, $matches)) continue;
      $pattern = preg_quote($template, '~');
      foreach ($matches[1] as $name) $pattern = str_replace(preg_quote('{' . $name . '}', '~'), $name === 'count' ? '([0-9]+)' : '(.+?)', $pattern);
      $patterns[] = array($template, '~^' . $pattern . '$~sD', $matches[1]);
    }
    usort($patterns, function($a, $b) { return strlen(preg_replace('/\{\w+\}/', '', $b[0])) <=> strlen(preg_replace('/\{\w+\}/', '', $a[0])); });
  }
  foreach ($patterns as $entry) {
    if (!preg_match($entry[1], $text, $matches)) continue;
    $parameters = array();
    foreach ($entry[2] as $index => $name) {
      $value = $matches[$index + 1];
      // Only explicitly designated presentation parameters can be translated.
      if ($name === 'operation') $value = ucfirst($value);
      if ($name === 'summary' || $name === 'impact') {
        $separator = $name === 'summary' ? ', ' : ' and ';
        $parts = explode($separator, $value);
        $value = implode($name === 'summary' ? ', ' : ' ' . acpT('and') . ' ', array_map(function($part) use ($depth) { return acpLocalizeText($part, $depth + 1); }, $parts));
      }
      if ($name === 'date') $value = acpLocalizeDate($value);
      $parameters[$name] = in_array($name, array('message', 'operation', 'interval'), true) ? acpLocalizeText($value, $depth + 1) : $value;
    }
    return acpT($entry[0], $parameters);
  }
  return $text;
}

function acpLocalizeResponse($payload, $field='') {
  // Diagnostics are a stable, sanitized support format, not localized state.
  $skip = array('diagnostics', 'bundle', 'settings', 'metrics', 'environment', 'supportLogs', 'privacy', 'snapshot', 'breadcrumbs');
  if (in_array($field, $skip, true)) return $payload;
  if (is_array($payload)) {
    if (isset($payload['securityLockReason'])) {
      $payload['securityReasonCode'] = acpReasonCode($payload['securityLockReason']);
    }
    if (isset($payload['policyReason'])) {
      $payload['policyReasonCode'] = acpReasonCode($payload['policyReason']);
    }
    if (isset($payload['sourceNames']) && $payload['sourceNames'] === array()) {
      foreach (array('sourceDisplay', 'sourceSummary') as $key) {
        if (isset($payload[$key]) && in_array($payload[$key], array('Saved Docker templates', 'Configured appdata source'), true)) $payload[$key] = acpT($payload[$key]);
      }
    }
    if (isset($payload['targetPaths']) && $payload['targetPaths'] === array() && ($payload['targetSummary'] ?? '') === 'tracked container paths') $payload['targetSummary'] = acpT('tracked container paths');
    foreach ($payload as $key => $value) $payload[$key] = acpLocalizeResponse($value, is_int($key) ? $field : (string)$key);
    return $payload;
  }
  if (in_array($field, array('timestampLabel', 'lastModifiedExact', 'purgeAtLabel', 'ignoredAtLabel', 'createdAtLabel', 'restoredAtLabel', 'quarantinedAtLabel'), true)) return acpLocalizeDate($payload);
  $fields = array('message', 'reason', 'policyReason', 'securityLockReason', 'lockReason', 'ignoredReason', 'label', 'title', 'description', 'warnings', 'notices', 'errors', 'headline', 'recommendation', 'sourceLabel', 'statusLabel', 'storageLabel', 'operationLabel', 'sizeLabel', 'lastModifiedLabel', 'relativeLabel', 'purgeBadgeLabel', 'summary', 'riskLabel', 'riskReason', 'resolutionReason', 'resolutionMessage', 'zfsResolutionReason', 'zfsResolutionDetail', 'zfsResolutionMessage', 'zfsImpactSummary', 'zfsPreviewError');
  $fields = array_merge($fields, array('quarantinedAgeLabel', 'impactSummary', 'purgeErrorMessage', 'resolutionDetail', 'scanWarningMessage', 'validationMessage'));
  return in_array($field, $fields, true) ? acpLocalizeText($payload) : $payload;
}

function acpReasonCode($reason) {
  foreach (array('symlink'=>'symlink', 'mount-point'=>'mount_point', 'share root|mount root'=>'root_path', 'canonicalized safely'=>'unsafe_path', 'permanent delete'=>'permanent_delete', 'zfs dataset delete is disabled'=>'zfs_disabled') as $pattern=>$code) {
    if (preg_match('~' . $pattern . '~i', (string)$reason)) return $code;
  }
  return '';
}

function acpLocalizeDate($value) {
  if (!is_string($value) || $value === '' || acpLocale() === 'en_US') return $value;
  $date = DateTime::createFromFormat('M j, Y g:i A', $value);
  if (!$date) return acpT($value);
  if (class_exists('IntlDateFormatter')) {
    $formatter = new IntlDateFormatter(acpLocales()[acpLocale()]['tag'], IntlDateFormatter::MEDIUM, IntlDateFormatter::SHORT, date_default_timezone_get());
    $formatted = $formatter->format($date);
    if ($formatted !== false) return $formatted;
  }
  // No intl extension is required on Unraid. A numeric local timestamp avoids
  // introducing English month names when that optional formatter is absent.
  return $date->format('Y-m-d H:i');
}
