<?php
// Render the trusted repository page without an Unraid server or live actions.
$plugin = dirname(__DIR__) . '/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus';
require_once $plugin . '/include/helpers.php';
session_start();
$_SESSION['locale'] = $argv[1] ?? 'en_US';
$display = array('theme' => 'black');
$page = file_get_contents($plugin . '/AppdataCleanupPlus.page');
$page = preg_replace('/\A.*?---\r?\n/s', '', $page);
$page = str_replace('require_once("/usr/local/emhttp/plugins/appdata.cleanup.plus/include/helpers.php");', '', $page);
$fixture = tempnam(sys_get_temp_dir(), 'acp-page-');
try {
  file_put_contents($fixture, $page);
  ob_start();
  require $fixture;
  $html = ob_get_clean();
} finally {
  unlink($fixture);
  session_destroy();
}
echo $html;
