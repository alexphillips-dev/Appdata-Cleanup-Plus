<?php
$root = sys_get_temp_dir() . '/acp-pr-artifact-' . bin2hex(random_bytes(8));
mkdir($root, 0700);
try {
  $script = dirname(__DIR__) . '/scripts/build_pr_artifact.php';
  $output = array(); $status = 0;
  exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($script) . ' ' . escapeshellarg($root) . ' 2>&1', $output, $status);
  if ($status !== 0) throw new RuntimeException(implode("\n", $output));
  $text = file_get_contents($root . '/appdata.cleanup.plus.plg');
  $xml = simplexml_load_string($text, 'SimpleXMLElement', LIBXML_NONET | LIBXML_NOENT);
  if (!$xml || (string)$xml['pluginURL'] !== 'https://raw.githubusercontent.com/alexphillips-dev/Appdata-Cleanup-Plus/dev/plugins/appdata.cleanup.plus.plg') throw new RuntimeException('Test installer must retain canonical dev update identity.');
  if (strpos($text, '<URL>') !== false) throw new RuntimeException('Standalone artifact must not fetch an unpublished archive.');
  if (!preg_match("/ACP_TEST_ARCHIVE'\n([A-Za-z0-9+\/=\r\n]+)ACP_TEST_ARCHIVE/", html_entity_decode($text, ENT_QUOTES | ENT_XML1), $match)) throw new RuntimeException('Embedded archive missing.');
  $archive = base64_decode($match[1], true);
  preg_match('/<!ENTITY md5 "([a-f0-9]+)"/', $text, $checksum);
  if ($archive === false || md5($archive) !== $checksum[1]) throw new RuntimeException('Embedded package changed.');
  echo "pr_artifact: OK (canonical dev identity, offline transport, byte parity)\n";
} finally {
  if (is_file($root . '/appdata.cleanup.plus.plg')) unlink($root . '/appdata.cleanup.plus.plg');
  rmdir($root);
}
