<?php
namespace I18nScheduledPurgeFixture;

// Run the shipped producer, but isolate all action/storage dependencies. No
// live folders or timers are touched and no production test hook is needed.
$function = new \ReflectionFunction('sweepExpiredAppdataCleanupPlusQuarantineEntries');
$lines = file($function->getFileName());
eval('namespace ' . __NAMESPACE__ . '; ' . implode('', array_slice($lines, $function->getStartLine() - 1, $function->getEndLine() - $function->getStartLine() + 1)));

function &state() { static $state = array(); return $state; }
function recoverMissingAppdataCleanupPlusQuarantineRecords() { return state()['registry']; }
function pruneMissingAppdataCleanupPlusQuarantineRecords($registry) { return $registry; }
function normalizeAppdataCleanupPlusQuarantineRecord($record) { return $record; }
function executeQuarantineManagerAction($entries, $action, $options) {
  if ($action !== 'purge' || $options !== array('scheduledPurge'=>true) || $entries !== array_values(state()['registry'])) throw new \RuntimeException('Unexpected scheduled purge invocation');
  $results = state()['results'];
  return array('action'=>$action, 'results'=>$results, 'summary'=>\buildQuarantineManagerActionSummary($results));
}
function mutateAppdataCleanupPlusQuarantineRegistry($callback) {
  state()['attemptedRegistry'] = $callback(state()['registry']);
  if (state()['saveSucceeds']) state()['registry'] = state()['attemptedRegistry'];
  return state()['saveSucceeds'];
}
function appendAppdataCleanupPlusAuditEntry($entry) {
  // JSON crosses a fresh PHP process in i18n_flows.js, just as persisted audit
  // records cross request boundaries without message-template registrations.
  state()['audit'] = json_decode(json_encode($entry, JSON_THROW_ON_ERROR), true, 512, JSON_THROW_ON_ERROR);
  return true;
}
function run($saveSucceeds=false) {
  $results = array(
    array('id'=>'blocked', 'status'=>'blocked', 'name'=>'Delete', 'path'=>'/mnt/user/Delete', 'message'=>\acpMessage('Quarantine provenance could not be verified. The folder was left in place.')),
    array('id'=>'error', 'status'=>'error', 'name'=>'Delete', 'path'=>'/mnt/user/Delete', 'message'=>\acpMessage('Delete failed: {error}', array('error'=>"/mnt/user/Delete/<b>literal</b>\nraw error"))),
    array('id'=>'opaque', 'status'=>'error', 'message'=>"Opaque backend error\n/mnt/user/Delete/<b>literal</b>"),
    array('id'=>'purged', 'status'=>'purged', 'message'=>\acpMessage('Path: {path}', array('path'=>'/mnt/user/Delete')))
  );
  $registry = array();
  foreach ($results as $result) $registry[$result['id']] = array('id'=>$result['id'], 'purgeAt'=>'2000-01-01T00:00:00Z');
  $state =& state();
  $state = array('registry'=>$registry, 'results'=>$results, 'saveSucceeds'=>$saveSucceeds);
  $execution = sweepExpiredAppdataCleanupPlusQuarantineEntries();
  return array('execution'=>$execution, 'audit'=>$state['audit'], 'before'=>$results, 'registry'=>$state['registry']);
}
