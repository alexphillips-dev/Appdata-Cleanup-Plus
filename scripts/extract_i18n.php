<?php
// Tokenize PHP rather than interpreting source. Only public source text is read.
$root = dirname(__DIR__) . '/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus';
$messages = array();
foreach (array_merge(glob($root . '/include/*.php'), glob($root . '/*.page')) as $file) {
  if (basename($file) === 'i18n.php') continue;
  $contents = file_get_contents($file);
  preg_match_all('/acpMessage\("((?:[^"\\\\]|\\\\.)*)"/', $contents, $explicit);
  foreach ($explicit[1] as $raw) { $value = stripcslashes($raw); $messages[$value] = $value; }
  foreach (token_get_all($contents) as $token) {
    if (!is_array($token) || $token[0] !== T_CONSTANT_ENCAPSED_STRING) continue;
    $raw = $token[1];
    $value = $raw[0] === '"' ? stripcslashes(substr($raw, 1, -1)) : str_replace(array("\\'", "\\\\"), array("'", "\\"), substr($raw, 1, -1));
    // Include complete prose and labels; omit paths, code, markup and protocol keys.
    if (!preg_match('/^[A-Za-z][A-Za-z0-9 ,.!?():;\x27\x22%+\/{}=>_-]*$/D', $value)) continue;
    if (!preg_match('/[a-z] [A-Za-z]|^[A-Z][a-z]+$/', $value)) continue;
    if (preg_match('/^(SELECT |INSERT |UPDATE |DELETE |CREATE |Content-|Cache-|Retry-|X-|Appdata Cleanup Plus (exec|fatal|discarded))/', $value)) continue;
    $messages[$value] = $value;
  }
}
ksort($messages);
echo json_encode($messages, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
