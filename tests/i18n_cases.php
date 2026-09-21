<?php
// Pure presentation fixtures. No live Unraid filesystem or action endpoints.
date_default_timezone_set('UTC');
$root = dirname(__DIR__) . '/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus';
require_once $root . '/include/helpers.php';
require_once $root . '/include/dashboard.php';
require_once $root . '/include/quarantine.php';
$counts = array_merge(range(0, 250), array(1000, 1001, 1002, 10000, 1000000, 2000000, 1000001, 1234567890));
$result = array();
foreach (acpLocales() as $locale => $definition) {
  $_SESSION['locale'] = $locale;
  $note = 'ZFS dataset fixture creation is intentionally manual. Existing exact ZFS dataset rows are still detected and can be tested from the scan results.';
  $warning = acpJoinMessages(array(
    acpMessage('Filesystem discovery reached the safety limit of {count} direct appdata candidates. Partial results are shown; narrow Appdata sources and rescan if expected folders are missing.', array('count'=>1000)),
    'Scan results loaded, but actions are disabled because a secure snapshot could not be created right now.'
  ));
  $names = array('Delete', 'ExampleA', 'ExampleB', '<b>ExampleC</b>');
  $paths = array('/mnt/user/Delete', '/config/<script>example</script>');
  $payload = array(
    'scanWarningMessage'=>$warning,
    'reason'=>appdataCleanupPlusBuildEmptyParentRemnantReason('/mnt/user/Delete'),
    'zfsNote'=>$note,
    'rootMessage'=>'The appdata source link does not resolve to a safe fixture root. Review Appdata Sources.',
    'rootReasonCode'=>'unsafe_symlink',
    'storageLabel'=>'ZFS unavailable',
    'candidate'=>array('reason'=>buildCandidateReason('template', $names, $paths, false), 'sourceNames'=>$names, 'targetPaths'=>$paths, 'sourceSummary'=>summarizeCandidateValues($names)),
    'history'=>array('message'=>buildLatestAuditMessage(array('timestamp'=>'2026-09-18T12:00:00Z','operation'=>'delete','summary'=>array('deleted'=>2,'conflicts'=>21),'requestedCount'=>23))),
    'bundle'=>array('message'=>$warning),
    'settings'=>array('name'=>'Delete')
  );
  $before = serialize($payload);
  // Candidate explanations are also read from snapshots in later requests.
  unset($GLOBALS['acpMessageTemplates'][$payload['candidate']['reason']]);
  $localized = acpLocalizeResponse($payload);
  if ($before !== serialize($payload)) throw new RuntimeException('Localization mutated input');
  // Simulate a later request reading English impact text saved in audit history.
  $impact = 'Recursive destroy will also remove 2 child datasets. Recursive destroy will also remove 21 snapshots.';
  unset($GLOBALS['acpMessageParts'][$impact], $GLOBALS['acpMessageTemplates'][$impact]);
  $categories = array();
  foreach ($counts as $count) $categories[] = acpPluralCategory($count);
  $result[$locale] = array('counts'=>$counts, 'categories'=>$categories, 'payload'=>$localized, 'original'=>$payload,
    'formattedCounts'=>array_map('acpFormatCount', $counts),
    'countMessages'=>array_map(function($n) { return acpLocalizeText(acpCountMessage('{count} items were submitted.', $n)); }, $counts),
    'legacyImpact'=>acpLocalizeText($impact), 'oldImpact'=>acpLocalizeText('Recursive destroy will also remove 2 child datasets and 21 snapshots.'),
    'purgeTimers'=>array_map(function($seconds) { return acpLocalizeText(formatAppdataCleanupPlusFutureIntervalLabel($seconds)); }, array(30,60,120,3600,7200,86400,1814400)),
    'snapshots'=>array_map(function($n) { return acpP('{count} snapshots', $n); }, array(1,2,5,21)),
    'plurals'=>acpPluralData());
}
echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
