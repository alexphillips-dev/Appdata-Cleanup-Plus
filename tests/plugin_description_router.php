<?php
// Local browser fixture only. Never point this router at a live Unraid host.
$fixture = getenv('ACP_PLUGIN_DESCRIPTION_FIXTURE');
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($path === '/fixture/locale') {
  session_start();
  $_SESSION['locale'] = $_GET['locale'] ?? '';
  session_write_close();
  header('Content-Type: application/json');
  echo '{}';
} elseif ($path === '/plugins/appdata.cleanup.plus/include/plugin-description.php') {
  $channel = ($_GET['channel'] ?? '') === 'dev' ? 'dev' : 'main';
  require $fixture . '/' . $channel . '/package/usr/local/emhttp/plugins/appdata.cleanup.plus/include/plugin-description.php';
} elseif ($path === '/fixture/') {
  echo '<!doctype html><html><body><div id="plugin_list"></div><div id="other-plugin">Another plugin</div></body></html>';
} else {
  http_response_code(404);
}
