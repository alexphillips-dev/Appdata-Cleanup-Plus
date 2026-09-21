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
  if (isset($parameters['count']) && acpPluralKey($text) !== null) return acpP($text, $parameters['count'], $parameters);
  $catalog = acpCatalog();
  $translated = isset($catalog[$text]) && is_string($catalog[$text]) && $catalog[$text] !== '' ? $catalog[$text] : $text;
  if (isset($parameters['count'])) $parameters['count'] = acpFormatCount($parameters['count']);
  $replace = array();
  foreach ($parameters as $key => $value) $replace['{' . $key . '}'] = (string)$value;
  return strtr($translated, $replace);
}

function acpPluralData() {
  static $data = array();
  $locale = acpLocale();
  if (!isset($data[$locale])) {
    $rules = json_decode(file_get_contents(__DIR__ . '/../locales/plural-rules.json'), true);
    $data[$locale] = array(
      'rules' => $rules['rules'][$locale],
      'messages' => json_decode(file_get_contents(__DIR__ . '/../locales/plural-messages.json'), true),
      'forms' => json_decode(file_get_contents(__DIR__ . '/../locales/plurals/' . $locale . '.json'), true)
    );
  }
  return $data[$locale];
}

function acpPluralKey($text) {
  foreach (acpPluralData()['messages'] as $other => $one) {
    if ($text === $other || $text === $one) return $other;
  }
  return null;
}

// Counts in this plugin are non-negative integers, never compact notation.
// Evaluate bundled CLDR relations as data; no eval or optional intl dependency.
function acpPluralCategory($count) {
  $count = max(0, (int)$count);
  foreach (acpPluralData()['rules'] as $category => $groups) {
    if ($category === 'other') continue;
    foreach ($groups as $terms) {
      $matches = true;
      foreach ($terms as $term) {
        $value = in_array($term[0], array('n', 'i'), true) ? $count : 0;
        if ($term[1]) $value %= $term[1];
        $inside = false;
        foreach ($term[3] as $range) if ($value >= $range[0] && $value <= $range[1]) $inside = true;
        if ($inside === $term[2]) { $matches = false; break; }
      }
      if ($matches) return $category;
    }
  }
  return 'other';
}

function acpFormatCount($count) {
  static $formats;
  if ($formats === null) $formats = json_decode(file_get_contents(__DIR__ . '/../locales/number-formats.json'), true);
  $format = $formats[acpLocale()];
  $digits = (string)max(0, (int)$count);
  $groups = array();
  if (strlen($digits) >= $format['minimum']) {
    $width = $format['primary'];
    while (strlen($digits) > $width) {
      array_unshift($groups, substr($digits, -$width));
      $digits = substr($digits, 0, -$width);
      $width = $format['secondary'];
    }
  }
  array_unshift($groups, $digits);
  return strtr(implode($format['group'], $groups), array_combine(range(0, 9), $format['digits']));
}

function acpP($text, $count, $parameters=array()) {
  $count = max(0, (int)$count);
  $data = acpPluralData();
  $key = acpPluralKey($text) ?? $text;
  $forms = $data['forms'][$key] ?? array();
  $template = $forms[acpPluralCategory($count)] ?? $forms['other'] ?? ($count === 1 ? ($data['messages'][$key] ?? $key) : $key);
  $parameters['count'] = acpFormatCount($count);
  $replace = array();
  foreach ($parameters as $name => $value) $replace['{' . $name . '}'] = (string)$value;
  return strtr($template, $replace);
}

function acpCountMessage($text, $count, $parameters=array()) {
  $data = acpPluralData();
  $parameters['count'] = max(0, (int)$count);
  return acpMessage($parameters['count'] === 1 ? ($data['messages'][$text] ?? $text) : $text, $parameters);
}

function acpH($text) {
  return htmlspecialchars(acpT($text), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

// Construct stable English messages for state/audit storage and match them only
// at the response boundary. Parameters such as paths and names remain literal.
function acpMessage($text, $parameters=array()) {
  $replace = array();
  foreach ($parameters as $key => $value) $replace['{' . $key . '}'] = (string)$value;
  $message = strtr($text, $replace);
  $GLOBALS['acpMessageTemplates'][$message] = array($text, $parameters);
  return $message;
}

function acpJoinMessages($messages) {
  $messages = array_values(array_filter($messages, 'strlen'));
  $text = implode(' ', $messages);
  if (count($messages) > 1) $GLOBALS['acpMessageParts'][$text] = $messages;
  return $text;
}

function acpLocalizeParameters($parameters, $depth) {
  foreach ($parameters as $name => $value) {
    if ($name === 'date') $value = acpLocalizeDate($value);
    if (in_array($name, array('message', 'operation', 'interval'), true)) $value = acpLocalizeText($value, $depth + 1);
    $parameters[$name] = $value;
  }
  return $parameters;
}

function acpLocalizeText($text, $depth=0) {
  if (!is_string($text) || $text === '' || $depth > 8) return $text;
  // Upgrade legacy stored impact/countdown text into complete plural messages.
  if (preg_match('/^(Recursive destroy|Destroy) will also remove (?:(\d+) child datasets?(?: and )?)?(?:(\d+) snapshots?)?\.$/D', $text, $legacy)) {
    $parts = array();
    if (!empty($legacy[2])) $parts[] = acpP('Recursive destroy will also remove {count} child datasets.', $legacy[2]);
    if (!empty($legacy[3])) $parts[] = acpP($legacy[1] === 'Recursive destroy' ? 'Recursive destroy will also remove {count} snapshots.' : 'Destroy will also remove {count} snapshots.', $legacy[3]);
    if ($parts) return implode(' ', $parts);
  }
  if (preg_match('/^Purges in (\d+)([dhm])$/D', $text, $legacy)) {
    $keys = array('d'=>'Purges in {count} days', 'h'=>'Purges in {count} hours', 'm'=>'Purges in {count} minutes');
    return acpP($keys[$legacy[2]], $legacy[1]);
  }
  $catalog = acpCatalog();
  if (isset($catalog[$text])) return $catalog[$text];
  if (isset($GLOBALS['acpMessageParts'][$text])) return implode(' ', array_map(function($part) use ($depth) { return acpLocalizeText($part, $depth + 1); }, $GLOBALS['acpMessageParts'][$text]));
  if (isset($GLOBALS['acpMessageTemplates'][$text])) {
    $entry = $GLOBALS['acpMessageTemplates'][$text];
    // Legacy impact/summary templates use the compatibility matcher below.
    if (!isset($entry[1]['impact']) && !isset($entry[1]['summary'])) return acpT($entry[0], acpLocalizeParameters($entry[1], $depth));
  }
  // Persisted ZFS impact messages contain only these complete count sentences.
  if (preg_match('/^Recursive destroy will also remove [0-9]+ child datasets?\. (?:Recursive destroy|Destroy) will also remove [0-9]+ snapshots?\.$/D', $text)) {
    return implode(' ', array_map(function($part) use ($depth) { return acpLocalizeText($part, $depth + 1); }, preg_split('/(?<=\.) /', $text)));
  }
  static $patterns;
  if ($patterns === null) {
    $patterns = array();
    $templates = array_values(acpCatalog('en_US'));
    foreach (acpPluralData()['messages'] as $other => $one) { $templates[] = $other; $templates[] = $one; }
    foreach (array_unique($templates) as $template) {
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
        if (isset($payload[$key]) && in_array($payload[$key], array('Saved Docker templates', 'Configured appdata source', 'Recovered from quarantine storage'), true)) $payload[$key] = acpT($payload[$key]);
      }
    }
    foreach (array('sourceNames' => array('sourceDisplay', 'sourceSummary'), 'targetPaths' => array('targetSummary')) as $list => $labels) {
      if (!empty($payload[$list]) && is_array($payload[$list])) {
        foreach ($labels as $label) if (isset($payload[$label])) $payload[$label] = summarizeCandidateValues($payload[$list], 2, true);
      }
    }
    if (isset($payload['targetPaths']) && $payload['targetPaths'] === array() && ($payload['targetSummary'] ?? '') === 'tracked container paths') $payload['targetSummary'] = acpT('tracked container paths');
    foreach ($payload as $key => $value) $payload[$key] = acpLocalizeResponse($value, is_int($key) ? $field : (string)$key);
    return $payload;
  }
  if (in_array($field, array('timestampLabel', 'lastModifiedExact', 'purgeAtLabel', 'ignoredAtLabel', 'createdAtLabel', 'restoredAtLabel', 'quarantinedAtLabel'), true)) return acpLocalizeDate($payload);
  $fields = array('message', 'reason', 'policyReason', 'securityLockReason', 'lockReason', 'ignoredReason', 'label', 'title', 'description', 'warnings', 'notices', 'errors', 'headline', 'recommendation', 'sourceLabel', 'statusLabel', 'storageLabel', 'operationLabel', 'sizeLabel', 'lastModifiedLabel', 'relativeLabel', 'purgeBadgeLabel', 'summary', 'riskLabel', 'riskReason', 'resolutionReason', 'resolutionMessage', 'zfsResolutionReason', 'zfsResolutionDetail', 'zfsResolutionMessage', 'zfsImpactSummary', 'zfsPreviewError');
  $fields = array_merge($fields, array('quarantinedAgeLabel', 'impactSummary', 'purgeErrorMessage', 'resolutionDetail', 'scanWarningMessage', 'validationMessage', 'zfsNote', 'rootMessage'));
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
