<?php
// Only synthetic files beneath this unique system-temp directory are written.
$root = str_replace('\\', '/', sys_get_temp_dir()) . '/acp-diagnostics-' . bin2hex(random_bytes(8));
mkdir($root, 0700);
mkdir($root . '/state', 0700);
putenv('APPDATA_CLEANUP_PLUS_STATE_ROOT=' . $root . '/state');
putenv('APPDATA_CLEANUP_PLUS_RUNTIME_ROOT=' . $root . '/runtime');
putenv('APPDATA_CLEANUP_PLUS_DOCKER_RUNTIME_PATH=' . $root . '/docker-unavailable');
putenv('APPDATA_CLEANUP_PLUS_SYSLOG_PATH=' . $root . '/synthetic.log');
$plugin = dirname(__DIR__) . '/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus/include/';
foreach (array('helpers.php', 'pathUtils.php', 'dashboard.php', 'quarantine.php', 'api.php', 'fixtures.php') as $file) require_once $plugin . $file;
function diagnosticCheck($ok, $message) { if (!$ok) throw new RuntimeException($message); }
function diagnosticFixtureHashes($root) {
  $hashes = array();
  foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS)) as $entry) {
    if ($entry->isFile() && !$entry->isLink()) $hashes[substr($entry->getPathname(), strlen($root))] = hash_file('sha256', $entry->getPathname());
  }
  ksort($hashes);
  return $hashes;
}
try {
  $settingsPath = appdataCleanupPlusSafetySettingsFile();
  $registryPath = appdataCleanupPlusQuarantineRegistryFile();
  $ignoredPath = appdataCleanupPlusIgnoreListFile();
  $metricsPath = appdataCleanupPlusLatestScanMetricsFile();
  $auditPath = appdataCleanupPlusAuditLogFile();
  $optional = appdataCleanupPlusDiagnosticsJsonFileHealth('missing', $settingsPath, false);
  $required = appdataCleanupPlusDiagnosticsJsonFileHealth('missing', $settingsPath, true);
  diagnosticCheck($optional['status'] === 'unavailable' && $optional['exists'] === false, 'Missing optional JSON is unavailable, not a validated empty object.');
  diagnosticCheck($required['status'] === 'failed' && $required['reasonCode'] === 'required_source_missing', 'Missing required JSON is a failure.');
  diagnosticCheck(!file_exists($root . '/runtime'), 'Reading missing state must not create runtime storage.');
  $metadata = array();
  appdataCleanupPlusDiagnosticsCollect(function() { return array('status' => 'missing'); }, $metadata);
  diagnosticCheck($metadata['status'] === 'unavailable', 'A missing current scan must not claim complete source collection.');
  appdataCleanupPlusDiagnosticsCollect(function() { return array('status' => 'unreadable'); }, $metadata);
  diagnosticCheck($metadata['status'] === 'failed', 'An unreadable current scan must report collection failure.');
  appdataCleanupPlusDiagnosticsCollect(function() { return array('status' => 'expired'); }, $metadata);
  diagnosticCheck($metadata['status'] === 'complete', 'Successfully inspecting expired historical evidence is complete collection.');

  $private = array('SyntheticPrivateBoot', 'SyntheticPrivateHome', 'SyntheticUnknownRoot', 'SyntheticPrivateFile');
  $lines = array(
    'appdata.cleanup.plus: read failed /boot/SyntheticPrivateBoot/SyntheticPrivateFile',
    'appdata.cleanup.plus: read failed /home/SyntheticPrivateHome/SyntheticPrivateFile',
    'appdata.cleanup.plus: read failed /boot/<path>/SyntheticPrivateFile Permission denied',
    'appdata.cleanup.plus: read failed "/SyntheticUnknownRoot/Private Name, With Punctuation/file"',
    'appdata.cleanup.plus: source /mnt/user/PrivateShare/PrivateApp',
    'appdata.cleanup.plus: supported versions 7.0/7.1'
  );
  file_put_contents($root . '/synthetic.log', implode("\n", $lines) . "\n");
  $redacted = appdataCleanupPlusDiagnosticsRedactValue(array(
    '/boot/SyntheticPrivateBoot/SyntheticPrivateFile' => '/home/SyntheticPrivateHome/SyntheticPrivateFile',
    'nested' => array('targetPath' => '/SyntheticUnknownRoot/SyntheticPrivateFile'),
    'log' => appdataCleanupPlusDiagnosticsReadMatchingLogTail($root . '/synthetic.log')
  ));
  foreach ($private as $canary) diagnosticCheck(strpos(json_encode($redacted), $canary) === false, 'Private absolute paths must be redacted in logs, nested values and object keys.');
  diagnosticCheck(strpos(json_encode($redacted, JSON_UNESCAPED_SLASHES), '7.0/7.1') !== false, 'Version comparisons must survive path redaction.');
  diagnosticCheck(strpos(json_encode($redacted), 'Permission denied') !== false, 'Known filesystem failure reasons must survive path redaction.');
  diagnosticCheck(appdataCleanupPlusDiagnosticsRedactPath('/boot/config/plugins/PrivatePlugin/private.json') === '/boot/config/plugins/<path>/<path>', 'Only reviewed boot prefixes may survive.');
  diagnosticCheck(appdataCleanupPlusDiagnosticsRedactPath('/mnt/user/appdata/PrivateApp') === '/mnt/user/appdata/<path>', 'Useful Unraid root context must survive.');
  diagnosticCheck(appdataCleanupPlusDiagnosticsRedactValue($redacted) === $redacted, 'Repeated final scrubs preserve aliases and already redacted path context.');

  $oversized = str_repeat(' ', 5242881) . '{}';
  foreach (array($settingsPath, $registryPath, $ignoredPath, $metricsPath) as $path) file_put_contents($path, $oversized);
  foreach (array($settingsPath, $registryPath, $ignoredPath, $metricsPath) as $path) {
    $read = appdataCleanupPlusDiagnosticsReadJsonFile($path);
    diagnosticCheck($read['status'] === 'partial' && $read['reasonCode'] === 'size_limit' && $read['valid'] === null, 'Oversized JSON must be unknown and partial before decoding.');
    diagnosticCheck($read['readByteCount'] === 0 && $read['data'] === array(), 'Known oversized JSON must not be read or decoded.');
  }
  $checks = array_column(appdataCleanupPlusDiagnosticsTroubleshootingSummary(array())['checks'], null, 'id');
  diagnosticCheck($checks['state-files']['status'] === 'warning' && $checks['state-files']['details']['unknownCount'] >= 4, 'Skipped large JSON must never receive a passed-validation health result.');
  diagnosticCheck($checks['latest-scan']['status'] === 'warning' && $checks['quarantine-state']['status'] === 'warning', 'Unavailable oversized scan and registry data must not appear healthy.');
  $largeBundle = buildAppdataCleanupPlusDiagnosticsBundle();
  foreach (array('safetySettings', 'quarantineRegistry', 'ignoredCandidates', 'latestScanMetrics') as $section) {
    diagnosticCheck($largeBundle['collection']['sections'][$section]['status'] === 'partial' && $largeBundle['collection']['sections'][$section]['omissionReason'] === 'size_limit', 'Every oversized state collector must disclose its input limit.');
    diagnosticCheck($largeBundle['state'][$section]['count'] === null && $largeBundle['state'][$section]['includedCount'] === 0, 'Unavailable source counts must stay unknown.');
  }
  unset($oversized, $largeBundle);
  file_put_contents($settingsPath, '{invalid-json');
  diagnosticCheck(appdataCleanupPlusDiagnosticsReadJsonFile($settingsPath)['status'] === 'failed', 'Malformed JSON must be distinguished from an empty state file.');
  if (PHP_OS_FAMILY !== 'Windows') {
    $linked = $root . '/linked.json';
    symlink($settingsPath, $linked);
    $linkedRead = appdataCleanupPlusDiagnosticsReadJsonFile($linked);
    diagnosticCheck($linkedRead['status'] === 'failed' && $linkedRead['reasonCode'] === 'inspection_refused' && $linkedRead['readByteCount'] === 0, 'Persistent diagnostics must not follow a linked JSON file.');
    unlink($linked);
    if (function_exists('posix_geteuid') && posix_geteuid() !== 0) {
      mkdir($root . '/unreadable', 0700);
      file_put_contents($root . '/unreadable/state.json', '{}');
      chmod($root . '/unreadable', 0000);
      try {
        $refused = appdataCleanupPlusDiagnosticsReadJsonFile($root . '/unreadable/state.json');
        diagnosticCheck($refused['status'] === 'failed' && $refused['reasonCode'] === 'unreadable' && $refused['exists'] === null, 'Unavailable metadata beneath an unreadable directory must not be described as a missing file.');
      } finally { chmod($root . '/unreadable', 0700); }
    }
  }
  file_put_contents($settingsPath, json_encode(array('quarantineRoot' => $root . '/quarantine', 'manualAppdataSources' => array())));
  file_put_contents($metricsPath, json_encode(array('startedAt' => '2020-01-01T00:00:00Z', 'phases' => array(array('name' => 'row_build', 'durationMs' => 3)))));

  $records = array('invalid-record');
  $ignored = array('invalid-record');
  for ($i = 0; $i < 55; $i++) {
    $records[] = array('sourcePath' => '/mnt/user/appdata/SyntheticPrivateFile', 'destination' => $root . '/absent', 'sizeBytes' => $i);
    $ignored['/mnt/user/appdata/SyntheticPrivateFile-' . $i] = array('path' => '/mnt/user/appdata/SyntheticPrivateFile-' . $i);
  }
  file_put_contents($registryPath, json_encode($records));
  file_put_contents($ignoredPath, json_encode($ignored));
  foreach (array(appdataCleanupPlusDiagnosticsQuarantineRegistrySummary(50), appdataCleanupPlusDiagnosticsIgnoredCandidatesSummary(50)) as $summary) {
    diagnosticCheck($summary['status'] === 'partial' && $summary['count'] === 56 && $summary['includedCount'] === 50, 'Bounded record summaries must retain the source count and actual included count.');
    diagnosticCheck($summary['invalidRecordCount'] === 1 && $summary['omittedCount'] === 6 && count($summary['data']) === 50, 'Malformed records must be counted separately and included in omissions.');
  }
  file_put_contents($registryPath, '["invalid",{}]');
  $mixed = appdataCleanupPlusDiagnosticsQuarantineRegistrySummary();
  diagnosticCheck($mixed['status'] === 'partial' && $mixed['includedCount'] === 1 && $mixed['omittedCount'] === 1 && count($mixed['data']) === 1, 'A skipped invalid record must never be counted as exported.');
  file_put_contents($registryPath, '[]');
  file_put_contents($ignoredPath, '{}');

  $auditLines = array();
  for ($i = 0; $i < 50; $i++) $auditLines[] = $i === 20 ? '{invalid-record' : json_encode(array('operation' => 'delete', 'results' => array()));
  file_put_contents($auditPath, implode("\n", $auditLines) . "\n");
  $audit = appdataCleanupPlusDiagnosticsAuditHistory();
  $health = appdataCleanupPlusDiagnosticsJsonFileHealth('audit', $auditPath, false, 'jsonl');
  diagnosticCheck($audit['includedCount'] === 49 && $audit['invalidRecordCount'] === 1 && $audit['omittedCount'] === 1 && $audit['status'] === 'partial', 'Malformed records anywhere in the full fifty-line audit window must be disclosed.');
  diagnosticCheck($health['valid'] === false && $health['validation'] === 'invalid', 'Audit health and export must validate the same window.');
  $bundle = buildAppdataCleanupPlusDiagnosticsBundle();
  diagnosticCheck($bundle['collection']['sections']['auditHistory']['invalidRecordCount'] === 1 && $bundle['collection']['sections']['auditHistory']['omittedCount'] === 1, 'Bundle completeness must preserve audit corruption metadata.');
  $validLine = json_encode(array('operation' => 'delete', 'results' => array()));
  file_put_contents($auditPath, str_repeat($validLine . "\n", 50));
  $audit = appdataCleanupPlusDiagnosticsAuditHistory();
  diagnosticCheck($audit['status'] === 'complete' && $audit['includedCount'] === 50 && $audit['omittedCount'] === 0, 'Exactly fifty valid audit records are complete.');
  file_put_contents($auditPath, str_repeat($validLine . "\n", 51));
  $audit = appdataCleanupPlusDiagnosticsAuditHistory();
  diagnosticCheck($audit['status'] === 'partial' && $audit['includedCount'] === 50 && $audit['omittedCount'] === null && $audit['omissionReason'] === 'bounded_collection', 'Older audit history must be identified as a normal bounded collection.');
  file_put_contents($auditPath, str_repeat('x', 2097153) . "\n" . $validLine . "\n");
  $audit = appdataCleanupPlusDiagnosticsAuditHistory();
  diagnosticCheck($audit['scannedByteCount'] <= $audit['scannedByteLimit'] && $audit['includedCount'] === 1 && $audit['status'] === 'partial', 'Audit input scanning must remain byte bounded while retaining recent records.');
  file_put_contents($auditPath, $validLine . "\n");

  $snapshotDir = appdataCleanupPlusSnapshotStorageDir() . '/synthetic-scope';
  mkdir($snapshotDir, 0700, true);
  file_put_contents($snapshotDir . '/ffffffff.json', json_encode(array('issuedAt' => '2000-01-01T00:00:00Z', 'candidates' => array())));
  file_put_contents($snapshotDir . '/00000000.json', json_encode(array('issuedAt' => '2020-01-01T00:00:00Z', 'candidates' => array())));
  file_put_contents($snapshotDir . '/fallback.json', '{"issuedAt":"tomorrow","candidates":[]}');
  touch($snapshotDir . '/fallback.json', strtotime('2010-01-01T00:00:00Z'));
  file_put_contents($snapshotDir . '/large.json', str_repeat(' ', 5242881));
  $snapshots = appdataCleanupPlusDiagnosticsSnapshotSummary();
  diagnosticCheck($snapshots['recent'][0]['issuedAt'] === '2020-01-01T00:00:00+00:00' || strtotime($snapshots['recent'][0]['issuedAt']) === strtotime('2020-01-01T00:00:00Z'), 'Snapshot recency must use chronological issue time rather than token names.');
  diagnosticCheck($snapshots['recent'][1]['timestampSource'] === 'file_modified_at', 'Snapshots without valid issue dates use an explicit file-time fallback.');
  diagnosticCheck($snapshots['invalidRecordCount'] === 1 && $snapshots['reasonCounts']['size_limit'] === 1 && $snapshots['omittedCount'] === 1, 'Oversized snapshots must be skipped with explicit omission metadata.');
  for ($i = 0; $i < 101; $i++) file_put_contents($snapshotDir . '/extra-' . $i . '.json', '{"issuedAt":"2005-01-01T00:00:00Z","candidates":[]}');
  $snapshots = appdataCleanupPlusDiagnosticsSnapshotSummary();
  diagnosticCheck($snapshots['inspectedCount'] === 100 && $snapshots['count'] === 105 && $snapshots['includedCount'] === 10 && $snapshots['omittedCount'] === 95, 'Snapshot content inspection and exported recency must remain bounded and disclose omissions.');
  diagnosticCheck($snapshots['uninspectedCount'] === 5 && $snapshots['selectionScope'] === 'newest_among_inspected_files', 'A capped snapshot inspection must not claim globally newest results.');

  $token = str_repeat('a', 36);
  $scope = appdataCleanupPlusSnapshotScopeKey();
  $currentFile = appdataCleanupPlusSnapshotFile($token);
  diagnosticCheck($scope !== '' && $currentFile !== '', 'The synthetic current scan needs a valid isolated session scope.');
  if (!is_dir(dirname($currentFile))) mkdir(dirname($currentFile), 0700, true);
  file_put_contents($currentFile, json_encode(array('token' => $token, 'scope' => $scope, 'issuedAt' => '2000-01-01T00:00:00Z', 'expiresAt' => '2000-01-01T01:00:00Z', 'candidates' => array())));
  $before = diagnosticFixtureHashes($root);
  $bundle = buildAppdataCleanupPlusDiagnosticsBundle($token);
  diagnosticCheck($bundle['currentSnapshot']['status'] === 'expired' && is_file($currentFile), 'Expired scan inspection must not prune the scan.');
  diagnosticCheck(diagnosticFixtureHashes($root) === $before && !file_exists($root . '/runtime'), 'Complete diagnostics collection must not modify files or create runtime storage.');
  diagnosticCheck($bundle['schemaVersion'] === 5 && $bundle['redaction']['version'] === 3, 'The existing schema is retained with an updated privacy revision.');
  diagnosticCheck($bundle['troubleshooting']['latestScan']['ageSeconds'] > 0 && $bundle['troubleshooting']['latestScan']['evidenceScope'] === 'latest_persisted_scan', 'Persisted scan evidence retains age and historical scope.');
  $json = json_encode($bundle);
  foreach ($private as $canary) diagnosticCheck(strpos($json, $canary) === false, 'The complete server bundle must exclude private path canaries.');
  diagnosticCheck(strpos($json, $token) === false && strpos($json, $scope) === false, 'Current-scan tokens and stable session scope identifiers must not be exported.');
  echo "diagnostics_server: OK\n";
} finally {
  $real = realpath($root);
  if ($real && dirname($real) === realpath(sys_get_temp_dir()) && strpos(basename($real), 'acp-diagnostics-') === 0) {
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($real, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST) as $entry) {
      if ($entry->isDir() && !$entry->isLink()) rmdir($entry->getPathname());
      else unlink($entry->getPathname());
    }
    rmdir($real);
  }
}
