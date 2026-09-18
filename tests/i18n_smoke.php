<?php
date_default_timezone_set('UTC');
$plugin = dirname(__DIR__) . '/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus';
require_once $plugin . '/include/helpers.php';
require_once $plugin . '/include/dashboard.php';
require_once $plugin . '/include/quarantine.php';
function expectI18n($condition, $message) {
  if (!$condition) throw new RuntimeException($message);
}
$english = acpCatalog('en_US');
expectI18n(count(acpLocales()) === 42, 'Every registered Unraid language and official pack must be covered');
foreach (acpLocales() as $locale => $definition) {
  $_SESSION['locale'] = $locale;
  expectI18n(acpLocale() === $locale, 'Locale resolution: ' . $locale);
  $catalog = acpCatalog();
  expectI18n(array_keys($catalog) === array_keys($english), 'Complete catalog: ' . $locale);
  expectI18n(acpT('Delete') !== '' && ($locale === 'en_US' || acpT('Delete') !== 'Delete'), 'Translated destructive action: ' . $locale);
  foreach ($english as $key => $_value) {
    preg_match_all('/\{\w+\}/', $key, $expected);
    preg_match_all('/\{\w+\}/', $catalog[$key], $actual);
    sort($expected[0]); sort($actual[0]);
    expectI18n($expected[0] === $actual[0], 'Placeholder integrity: ' . $locale . ' ' . $key);
  }
  $message = acpMessage("Would destroy ZFS dataset '{dataset}' recursively.", array('dataset' => 'pool/Delete'));
  $payload = array('operation'=>'delete', 'status'=>'ready', 'id'=>'Delete', 'name'=>'Delete', 'path'=>'/mnt/user/Delete', 'message'=>$message, 'breadcrumbs'=>array(array('label'=>'Delete', 'path'=>'/mnt/user/Delete')), 'bundle'=>array('message'=>'Delete', 'name'=>'Delete'), 'settings'=>array('label'=>'Delete'));
  $translated = acpLocalizeResponse($payload);
  foreach (array('operation', 'status', 'id', 'name', 'path', 'breadcrumbs', 'bundle', 'settings') as $field) expectI18n($translated[$field] === $payload[$field], 'Literal machine/user data: ' . $locale . ' ' . $field);
  expectI18n(strpos($translated['message'], 'pool/Delete') !== false, 'Dataset parameter preserved: ' . $locale);
  expectI18n($payload['message'] === $message, 'Response localization cannot mutate stored audit input');
  $reasonPayload = acpLocalizeResponse(array('securityLockReason'=>'Symlinked paths are locked for safety.', 'policyReason'=>'ZFS dataset-backed rows require permanent delete mode and cannot be quarantined.'));
  expectI18n($reasonPayload['securityReasonCode'] === 'symlink' && $reasonPayload['policyReasonCode'] === 'permanent_delete', 'Presentation classifications are independent of language: ' . $locale);
  if ($locale !== 'en_US') {
    expectI18n($translated['message'] !== $message, 'Dynamic result translated: ' . $locale);
    $reason = buildCandidateReason('filesystem', array(), array(), false, '/mnt/user/Delete');
    expectI18n(acpLocalizeText($reason) !== $reason && strpos(acpLocalizeText($reason), '/mnt/user/Delete') !== false, 'Nested scan reason translated with path preserved: ' . $locale);
    expectI18n(acpLocalizeText('Purges in 3d') !== 'Purges in 3d', 'Purge timer translated: ' . $locale);
    $history = buildLatestAuditMessage(array('timestamp'=>'2026-09-18T12:00:00Z', 'operation'=>'delete', 'summary'=>array('deleted'=>2), 'requestedCount'=>2));
    expectI18n(acpLocalizeText($history) !== $history && strpos(acpLocalizeText($history), '2 deleted') === false, 'History message and counts translated: ' . $locale);
  }
}
foreach (array('ja_JP'=>'ja_JA', 'ko_KR'=>'ko_KO', 'da_DK'=>'da_DA', 'ca_ES'=>'ca_CA', 'nb_NO'=>'no_NO', 'zh-Hant'=>'zh_TW') as $alias=>$expected) {
  $_SESSION['locale'] = $alias;
  expectI18n(acpLocale() === $expected, 'Unraid locale alias: ' . $alias);
}
$GLOBALS['locale'] = 'de_DE';
foreach (array('', '../../de_DE', 'unsupported', array('de_DE')) as $invalid) {
  $_SESSION['locale'] = $invalid;
  expectI18n(acpLocale() === 'en_US' && acpT('Delete') === 'Delete', 'English toggle and unsupported locale fallback');
}
$_SESSION['locale'] = 'de_DE';
expectI18n(acpT('A future missing string') === 'A future missing string', 'Missing phrase fallback');
expectI18n(acpH('<script>"&') === '&lt;script&gt;&quot;&amp;', 'HTML escaping');
expectI18n(acpMessage('Path: {path}', array('path'=>'/mnt/user/Delete')) === 'Path: /mnt/user/Delete', 'Storage formatter remains English');
echo 'i18n_smoke: locale switching, catalogs, templates, immutable data and escaping passed.' . PHP_EOL;
