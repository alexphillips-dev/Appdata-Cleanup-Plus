<?php
// Unraid renders the Plugins-page README as Markdown without translation.
// This same-origin script localizes only our description, using bundled text.
require_once __DIR__ . '/i18n.php';
if (session_status() === PHP_SESSION_NONE) {
  session_start();
  session_write_close();
}

$acpDescriptionLocale = acpLocale();
$acpDescriptionDefinition = acpLocales()[$acpDescriptionLocale];
$acpDescriptionDev = ($_GET['channel'] ?? '') === 'dev';
$acpDescriptionText = array(
  'title' => $acpDescriptionDev ? acpT('Appdata Cleanup Plus (Dev)') : 'Appdata Cleanup Plus',
  'summary' => acpT('Appdata Cleanup Plus scans for unused Docker appdata folders and exact ZFS dataset candidates, then lets you review, dry run, quarantine, restore, audit, or permanently delete them from a guided cleanup dashboard.'),
  'notice' => $acpDescriptionDev ? acpT('Dev build: testing channel. Expect preview changes before main.') : ''
);
$acpDescriptionPayload = array(
  'lang' => $acpDescriptionDefinition['tag'],
  'dir' => !empty($acpDescriptionDefinition['rtl']) ? 'rtl' : 'ltr',
  'text' => $acpDescriptionText
);
header('Content-Type: application/javascript; charset=UTF-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: private, no-store');
echo '(function () { var description = ' . json_encode($acpDescriptionPayload, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_INVALID_UTF8_SUBSTITUTE) . ';';
?>
var host = document.getElementById("acp-plugin-description");
if (!host) return;
host.setAttribute("lang", description.lang);
host.setAttribute("dir", description.dir);
["title", "summary", "notice"].forEach(function (key) {
  var node = host.querySelector('[data-acp-plugin-text="' + key + '"]');
  if (node) node.textContent = description.text[key];
});
}());
