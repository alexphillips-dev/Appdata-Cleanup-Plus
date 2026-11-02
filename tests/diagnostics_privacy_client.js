"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repoRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(repoRoot, "source", "appdata.cleanup.plus", "usr", "local", "emhttp", "plugins", "appdata.cleanup.plus", "scripts", "appdata.cleanup.plus.js");
const source = fs.readFileSync(sourcePath, "utf8");
const startMarker = "  function buildDiagnosticsRedactor()";
const endMarker = "  function sanitizeDiagnosticsSettings(";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);

assert.notStrictEqual(start, -1, "diagnostics redactor functions should exist");
assert.notStrictEqual(end, -1, "diagnostics redactor extraction boundary should exist");

const jquery = {
  trim(value) {
    return String(value === null || value === undefined ? "" : value).trim();
  },
  each(collection, callback) {
    if (Array.isArray(collection)) {
      collection.forEach((value, index) => callback(index, value));
      return collection;
    }
    Object.keys(collection || {}).forEach((key) => callback(key, collection[key]));
    return collection;
  },
  isArray: Array.isArray,
  isPlainObject(value) {
    return !!value && Object.getPrototypeOf(value) === Object.prototype;
  },
  map(collection, callback) {
    return (Array.isArray(collection) ? collection : []).map((value, index) => callback(value, index));
  },
  extend(target, sourceValue, deepSource) {
    if (target === true) return JSON.parse(JSON.stringify(deepSource || {}));
    return Object.assign(target || {}, sourceValue || {});
  }
};

const context = { $: jquery };
vm.runInNewContext(
  source.slice(start, end) + "\nthis.privacy = { buildDiagnosticsDecision, buildDiagnosticsRedactor, sanitizeDiagnosticsFreeText, diagnosticsKeyLooksLikePath, sanitizeDiagnosticsValue, sanitizeDiagnosticsPath, sanitizeDiagnosticsTemplateRefs, sanitizeDiagnosticsRow, sanitizeDiagnosticsScanMetrics, sanitizeDiagnosticsAuditHistory };",
  context,
  { filename: sourcePath }
);

const privacy = context.privacy;
const historicalZfs = [{message:"Earlier reference to PrivatePool/RetiredApp/Child@saved",results:[]},{results:[{
  datasetName:'PrivatePool/RetiredApp',datasetMountpoint:'/mnt/PrivatePool/RetiredApp',status:'deleted',recursive:true,
  zfsChildDatasets:['PrivatePool/RetiredApp/Child'],zfsSnapshots:['PrivatePool/RetiredApp/Child@saved'],
  zfsChildDatasetCount:1,zfsSnapshotCount:1,zfsImpactSummary:'PrivatePool/RetiredApp/Child and PrivatePool/RetiredApp/Child@saved',
  message:"Destroyed ZFS dataset 'PrivatePool/RetiredApp'."
}]}];
const historyBefore=JSON.stringify(historicalZfs);
const auditRedactor=privacy.buildDiagnosticsRedactor();
const historicalExport=privacy.sanitizeDiagnosticsValue(privacy.sanitizeDiagnosticsAuditHistory(historicalZfs,auditRedactor),auditRedactor,'');
assert.ok(!/PrivatePool|RetiredApp|Child|saved/.test(JSON.stringify(historicalExport).replace(/zfsChildDatasets|zfsChildDatasetCount/g,'')),'Historical ZFS identifiers must be redacted without current scan rows');
assert.equal(historicalExport[1].results[0].status,'deleted');
assert.equal(historicalExport[1].results[0].zfsSnapshotCount,1);
assert.ok(historicalExport[0].message.includes(historicalExport[1].results[0].zfsSnapshots[0]),'Aliases must match earlier messages and later result fields');
assert.ok(historicalExport[1].results[0].message.includes(historicalExport[1].results[0].datasetName));
assert.equal(JSON.stringify(historicalZfs),historyBefore,'Export must not modify stored/browser audit records');
const codeCollision=privacy.sanitizeDiagnosticsAuditHistory([{results:[{datasetName:'deleted',status:'deleted',message:"Destroyed ZFS dataset 'deleted'."},{datasetName:'dataset',message:"Destroyed ZFS dataset 'dataset'."}]}],privacy.buildDiagnosticsRedactor());
assert.equal(codeCollision[0].results[0].status,'deleted','Dataset aliases must not change status codes');
assert.match(codeCollision[0].results[1].datasetName,/^<audit-dataset-\d+>$/);
const serverAliases=privacy.sanitizeDiagnosticsAuditHistory([{results:[{datasetName:'<audit-dataset-1>',message:"Destroyed ZFS dataset '<audit-dataset-1>'."}]}],privacy.buildDiagnosticsRedactor());
assert.equal(serverAliases[0].results[0].datasetName,'<audit-dataset-1>','Already-sanitized server aliases remain intact');
const decision = privacy.buildDiagnosticsDecision({sourceKind:'template',storageKind:'zfs',canDelete:false,scanVerificationLocked:true,mountEvidence:[{name:'private-canary'}],broadMountEvidence:[{paths:['/private-canary']}],securityLockReason:'private-canary',securityReasonCode:'private-canary'});
assert.equal(decision.primaryBlocker,'ownership_unverified');
assert.equal(decision.specificMountCount,1);
assert.equal(decision.broadAccessCount,1);
assert.equal(decision.storage,'exact_dataset');
assert.ok(!JSON.stringify(decision).includes('private-canary'),'Decision evidence must use fixed codes, not names or prose');
assert.equal(privacy.buildDiagnosticsDecision({canDelete:true,broadMountEvidence:[{}]}).primaryBlocker,'none');
for (const row of [
  {storageKind:'zfs_unavailable',zfsResolutionKind:'zfs_unavailable'},
  {storageKind:'filesystem',zfsResolutionKind:'zfs_unavailable'},
  {storageKind:'zfs_unavailable',zfsResolutionKind:'mapped_no_exact_mountpoint'}
]) {
  const unavailable = privacy.buildDiagnosticsDecision({...row,sourceKind:'template',canDelete:false,zfsMappingMatched:true});
  assert.equal(unavailable.storage,'unavailable','A failed ZFS query is not evidence of ordinary folder storage');
  assert.equal(unavailable.primaryBlocker,'zfs_unavailable');
  assert.ok(unavailable.evidence.includes('zfs_unavailable'));
  assert.ok(!unavailable.evidence.includes('mapping_without_exact_dataset'),'Failed lookup must not claim an exact dataset was absent');
  const final = privacy.sanitizeDiagnosticsValue({decision:unavailable},privacy.buildDiagnosticsRedactor(),'').decision;
  assert.equal(final.storage,'unavailable');
  assert.equal(final.primaryBlocker,'zfs_unavailable','Unavailable decision codes survive the final recursive scrub');
}
const unknownStorage = privacy.buildDiagnosticsDecision({storageKind:'future-private-canary',canDelete:false});
assert.equal(unknownStorage.storage,'unknown');
assert.equal(unknownStorage.primaryBlocker,'storage_unknown');
assert.ok(!JSON.stringify(unknownStorage).includes('private-canary'));
assert.equal(privacy.sanitizeDiagnosticsValue({decision:unknownStorage},privacy.buildDiagnosticsRedactor(),'').decision.primaryBlocker,'storage_unknown');
assert.equal(privacy.buildDiagnosticsDecision({storageKind:'filesystem',canDelete:true}).storage,'folder');
assert.equal(privacy.buildDiagnosticsDecision({storageKind:'zfs',canDelete:true}).storage,'exact_dataset');
assert.ok(privacy.buildDiagnosticsDecision({storageKind:'filesystem',zfsMappingMatched:true,zfsResolutionKind:'mapped_no_exact_mountpoint',canDelete:true}).evidence.includes('mapping_without_exact_dataset'));
assert.ok(!privacy.buildDiagnosticsDecision({storageKind:'filesystem',zfsMappingMatched:true,canDelete:true}).evidence.includes('mapping_without_exact_dataset'),'Missing resolution metadata must not imply a completed lookup');
assert.equal(privacy.buildDiagnosticsDecision({storageKind:'zfs_unavailable',scanVerificationLocked:true,canDelete:false}).primaryBlocker,'ownership_unverified');
for (const code of ['mount_inventory_unavailable','mount_inventory_empty','mount_inventory_invalid','filesystem_metadata_failed']) {
  const decision = privacy.buildDiagnosticsDecision({canDelete:false,securityLockReason:'localized message',mountReasonCode:code});
  assert.equal(decision.primaryBlocker,code,'Mount failures retain distinct reasons regardless of UI language');
  assert.equal(privacy.sanitizeDiagnosticsValue({decision},privacy.buildDiagnosticsRedactor(),'').decision.primaryBlocker,code);
}
assert.equal(privacy.buildDiagnosticsDecision({canDelete:false,securityLockReason:'locked',mountReasonCode:'private-canary'}).primaryBlocker,'protected_path');
const mountTelemetry = privacy.sanitizeDiagnosticsScanMetrics({mountInspection:{status:'verified',reasonCounts:{directory:2,mount_inventory_invalid:1,filesystem_metadata_failed:2,'private-canary':99},raw:'private-canary'}});
assert.equal(mountTelemetry.mountInspection.status,'incomplete');
assert.equal(mountTelemetry.mountInspection.failedCheckCount,3);
assert.equal(mountTelemetry.mountInspection.checkCount,5);
assert.ok(!JSON.stringify(mountTelemetry).includes('private-canary'));
assert.equal(privacy.sanitizeDiagnosticsScanMetrics({}).mountInspection.status,'not_checked');
const healthRedactor = privacy.buildDiagnosticsRedactor();
privacy.sanitizeDiagnosticsRow({name:'runtime',path:'/mnt/user/appdata/runtime',sourceNames:['unsafe_permissions','mountInspection','verified']},healthRedactor);
const health = privacy.sanitizeDiagnosticsValue({statsCache:{storage:'runtime',reasonCode:'unsafe_permissions',entryCount:null},mountInspection:mountTelemetry.mountInspection,reasonCounts:{unsafe_hardlink:1,'private-canary':2}},healthRedactor,'');
assert.equal(health.statsCache.storage,'runtime','Storage classification is not a user name');
assert.equal(health.statsCache.reasonCode,'unsafe_permissions','Fixed health reason codes survive name alias collisions');
assert.equal(health.mountInspection.failedCheckCount,3);
assert.deepEqual(Object.keys(health.reasonCounts),['unsafe_hardlink']);
const decisionRedactor = privacy.buildDiagnosticsRedactor();
privacy.sanitizeDiagnosticsRow({name:'folder',canDelete:true,storageKind:'filesystem'},decisionRedactor);
const stableDecision = privacy.sanitizeDiagnosticsValue({decision:privacy.buildDiagnosticsDecision({canDelete:true,storageKind:'filesystem'})},decisionRedactor,'');
assert.equal(stableDecision.decision.storage,'folder','Export-scoped name aliases must not corrupt fixed decision codes');
const redactor = privacy.buildDiagnosticsRedactor();
for (const message of [
  "rename(/mnt/user/appdata/My Private App,/mnt/user/appdata/.quarantine/My Private App): Permission denied",
  "cannot open '/mnt/user/appdata/Private, Financial Records': Permission denied",
  'cannot open "/mnt/user/appdata/Private (Financial) Records": Permission denied'
]) {
  const result = privacy.sanitizeDiagnosticsValue({logs:[{lines:[message]}]}, privacy.buildDiagnosticsRedactor(), "");
  assert.ok(!JSON.stringify(result).includes("Private"), "Final export scrub must remove the complete path, not only its first word");
  assert.ok(!JSON.stringify(result).includes("Records"), "Quoted path punctuation must not leave a private suffix");
  assert.ok(JSON.stringify(result).includes("Permission denied"), "Diagnostic failure context should remain useful");
}
// Final server/client log and key scrubs must cover arbitrary absolute roots,
// not only paths learned from the current scan or a small set of known roots.
for (const message of [
  "cannot open '/home/PrivateCustomer/Private Records/report.json': Permission denied; retry allowed",
  'cannot open "/srv/PrivateCustomer/Private (Financial) Records": Permission denied; retry allowed',
  'rename(/arbitraryPrivateRoot/PrivateCustomer/Private Records,/boot/PrivateCustomer): Permission denied; retry allowed',
  'cannot open /home/PrivateCustomer/records.json Permission denied; retry allowed',
  'cannot open /boot/PrivateCustomer/Private Records: Permission denied; retry allowed',
  'cannot open /boot/config/PrivateCustomer: Permission denied; retry allowed',
  'cannot open /boot/config/plugins/PrivateCustomer/records.json: Permission denied; retry allowed',
  'cannot open /arbitraryPrivateRoot: Permission denied; retry allowed',
  'cannot open /home/<path-1>/PrivateCustomer: Permission denied; retry allowed',
  'cannot open //PrivateCustomer/PrivateRecords/file.json: Permission denied; retry allowed',
  'source=>/home/PrivateCustomer/records.json: Permission denied; retry allowed',
  'source|/arbitraryPrivateRoot/PrivateCustomer: Permission denied; retry allowed',
  'source=///home/PrivateCustomer/records.json: Permission denied; retry allowed',
  'cannot open "/arbitraryPrivateRoot/PrivateCustomer: Permission denied; retry allowed',
  String.raw`{"path":"\/home\/PrivateCustomer\/Private Records","error":"Permission denied; retry allowed"}`,
  String.raw`cannot open \"\/home\/PrivateCustomer\/Private Records\": Permission denied; retry allowed`,
  String.raw`cannot open \PrivateCustomer\PrivateRecords: Permission denied; retry allowed`,
  String.raw`cannot open \\\\PrivateCustomer\\PrivateRecords: Permission denied; retry allowed`,
  'cannot open "C:\\Users\\PrivateCustomer\\Private Records\\file.json": Permission denied; retry allowed',
  'cannot open \\\\PrivateCustomer\\PrivateRecords\\file.json: Permission denied; retry allowed'
]) {
  const local = privacy.buildDiagnosticsRedactor();
  const source = {serverDiagnostics:{logs:[{lines:[message]}]},[message]:{status:'failed'}};
  const before = JSON.stringify(source);
  const result = privacy.sanitizeDiagnosticsValue(source,local,'');
  const json = JSON.stringify(result);
  assert.ok(!/PrivateCustomer|Private Records|PrivateRecords|Financial|arbitraryPrivateRoot/.test(json),'Arbitrary absolute path canaries must be removed from values and unknown keys');
  assert.ok(json.includes('Permission denied') && json.includes('retry allowed'),'Path redaction retains bounded failure and retry context');
  assert.ok(!json.includes('diagnosticspath'),'Temporary path protection markers must never be exported');
  assert.equal(JSON.stringify(source),before,'Final redaction must not change the server response');
  assert.equal(JSON.stringify(privacy.sanitizeDiagnosticsValue(result,local,'')),json,'Repeated scrubbing preserves aliases and fixed root context');
}
for (const [raw,prefix] of [
  ['/home/PrivateCustomer/records','/home/'],
  ['/srv/PrivateCustomer/records','/srv/'],
  ['/opt/PrivateCustomer/records','/opt/'],
  ['/boot/PrivateCustomer','/boot/'],
  ['/boot/config/PrivateCustomer','/boot/config/'],
  ['/boot/config/plugins/PrivateCustomer','/boot/config/plugins/']
]) {
  const sanitized = privacy.sanitizeDiagnosticsPath(raw,privacy.buildDiagnosticsRedactor());
  assert.ok(sanitized.startsWith(prefix),'Only explicit safe system prefixes remain literal');
  assert.ok(!sanitized.includes('PrivateCustomer'));
}
assert.ok(!privacy.sanitizeDiagnosticsPath('/arbitraryPrivateRoot',privacy.buildDiagnosticsRedactor()).includes('arbitraryPrivateRoot'),'Unknown absolute root names themselves must be aliased');
assert.ok(!privacy.sanitizeDiagnosticsPath('/home/<PrivateCustomer>/records',privacy.buildDiagnosticsRedactor()).includes('PrivateCustomer'),'Arbitrary angle-bracket path components are not trusted aliases');
const rootNameCollision = privacy.buildDiagnosticsRedactor();
privacy.sanitizeDiagnosticsRow({name:'home',sourceNames:['data']},rootNameCollision);
assert.ok(privacy.sanitizeDiagnosticsFreeText('open /home/PrivateCustomer/file.json: Permission denied',rootNameCollision).includes('/home/'),'Name collisions must not remove fixed path context or bypass path redaction');
const storageCodeCollision = privacy.buildDiagnosticsRedactor();
privacy.sanitizeDiagnosticsRow({name:'zfs_unavailable',sourceNames:['filesystem','mapped_no_exact_mountpoint']},storageCodeCollision);
const storageCodes = privacy.sanitizeDiagnosticsValue({storageKind:'zfs_unavailable',zfsResolutionKind:'mapped_no_exact_mountpoint'},storageCodeCollision,'');
assert.equal(storageCodes.storageKind,'zfs_unavailable');
assert.equal(storageCodes.zfsResolutionKind,'mapped_no_exact_mountpoint','Known storage-resolution codes survive private name collisions');
// The same export registry is reused for browser, server and final passes.
// App names can coincide with public telemetry, but that must not create a
// blanket exemption for arbitrary strings or nested future fields.
const metadataRedactor = privacy.buildDiagnosticsRedactor();
const metadataKeys = 'activity events event elapsedMs request modal module line column durationMs httpStatus action fixtureAction reason captureStartedAt limit totalCount includedCount omittedCount browser family majorVersion auroraEnhanced reducedMotion coarsePointer dialog openSections focus scroll top clientHeight scrollHeight horizontalOverflow fixtureOperation pending exportCompletion supportSummary health headline versions match freshness counts reportedRows omittedRows failedRequests activityEvents omittedEvents findings severity nextStep limitations section completedAt browserCapturedAt selectedCount fixtureTools statusLoaded loading requestFailed rootAvailable rootReason fixtureRootReason detected visible selected'.split(' ');
const capturedAt = '2026-11-01T13:51:30.123Z';
const serverAt = '2026-11-01T09:51:30-04:00';
const publicVersion = '2026.11.01.02';
privacy.sanitizeDiagnosticsRow({name:'tools',sourceNames:[...metadataKeys,'main','complete','export_collected','getDiagnosticsBundle','create','ready','chromium','test_data','export-diagnostics','warning','error','rescan','collection','runtime','bounded_collection','match','partial','request-1',capturedAt,serverAt,publicVersion,'PrivateMetadataCanary']},metadataRedactor);
const metadataSource = {
  pluginVersion:publicVersion,generatedAt:capturedAt,browserCapturedAt:capturedAt,completedAt:capturedAt,
  browser:{family:'chromium',majorVersion:140,auroraEnhanced:true,reducedMotion:false,coarsePointer:false},
  activity:{status:'complete',captureStartedAt:capturedAt,limit:100,totalCount:1,includedCount:1,omittedCount:0,
    events:[{event:'export_collected',elapsedMs:23,request:'request-1',action:'getDiagnosticsBundle',modal:'tools',module:'main',line:40,column:3,fixtureAction:'create',reason:'collection_failed'}]},
  recentFailures:{status:'partial',data:[{occurredAt:serverAt,action:'fixtureManagerAction',category:'TypeError',fixtureRootReason:'ready'}]},
  uiState:{dialog:{modal:'tools',openSections:['test_data'],focus:'export-diagnostics',scroll:{top:1,clientHeight:600,scrollHeight:700,horizontalOverflow:false},fixtureOperation:{pending:false,action:'create'}},
    fixtureTools:{statusLoaded:true,rootReason:'ready'},exportCompletion:{modal:'tools'}},
  freshness:{browserVersion:publicVersion,serverVersion:publicVersion,versionMatch:'match',scanMatch:'match',currentSnapshot:{status:'valid',issuedAt:serverAt,expiresAt:serverAt}},
  supportSummary:{status:'complete',health:'warning',headline:'Review tools and main before acting.',generatedAt:capturedAt,completedAt:capturedAt,
    versions:{browser:publicVersion,server:publicVersion,match:'match'},freshness:{scanMatch:'match',currentSnapshot:'valid'},
    counts:{detected:3,visible:2,selected:1,reportedRows:3,omittedRows:0,failedRequests:1,activityEvents:1,omittedEvents:0},
    findings:[{id:'collection',severity:'error',summary:'PrivateMetadataCanary prevents tools review.',nextStep:'rescan'}],
    limitations:[{section:'runtime',reason:'bounded_collection'},{section:'tools',reason:'PrivateMetadataCanary'}],
    PrivateMetadataCanary:{headline:'PrivateMetadataCanary',event:{PrivateMetadataCanary:'/home/PrivateMetadataCanary/records'},section:{PrivateMetadataCanary:'tools'}}}
};
const metadataBefore = JSON.stringify(metadataSource);
const metadataResult = privacy.sanitizeDiagnosticsValue(metadataSource,metadataRedactor,'');
assert.equal(metadataResult.activity.events[0].modal,'tools');
assert.equal(metadataResult.activity.events[0].module,'main');
assert.equal(metadataResult.activity.events[0].event,'export_collected');
assert.equal(metadataResult.activity.events[0].request,'request-1');
assert.equal(metadataResult.activity.events[0].action,'getDiagnosticsBundle');
assert.equal(metadataResult.activity.status,'complete');
assert.equal(metadataResult.uiState.dialog.openSections[0],'test_data');
assert.equal(metadataResult.uiState.dialog.focus,'export-diagnostics');
assert.equal(metadataResult.uiState.dialog.fixtureOperation.action,'create');
assert.equal(metadataResult.uiState.fixtureTools.rootReason,'ready');
assert.equal(metadataResult.browser.family,'chromium');
assert.equal(metadataResult.supportSummary.health,'warning');
assert.equal(metadataResult.supportSummary.findings[0].id,'collection');
assert.equal(metadataResult.supportSummary.findings[0].severity,'error');
assert.equal(metadataResult.supportSummary.findings[0].nextStep,'rescan');
assert.equal(metadataResult.supportSummary.limitations[0].section,'runtime');
assert.equal(metadataResult.supportSummary.limitations[0].reason,'bounded_collection');
assert.notEqual(metadataResult.supportSummary.limitations[1].section,'tools','A recognized modal is not a recognized summary section');
for (const date of [metadataResult.generatedAt,metadataResult.browserCapturedAt,metadataResult.completedAt,metadataResult.activity.captureStartedAt]) assert.equal(date,capturedAt,'Public capture timestamps remain intact');
assert.equal(metadataResult.recentFailures.data[0].occurredAt,serverAt);
assert.equal(metadataResult.freshness.currentSnapshot.issuedAt,serverAt);
assert.equal(metadataResult.pluginVersion,publicVersion);
assert.equal(metadataResult.freshness.browserVersion,publicVersion);
assert.equal(metadataResult.supportSummary.versions.browser,publicVersion);
assert.equal(metadataResult.supportSummary.versions.server,publicVersion);
assert.equal(metadataResult.supportSummary.versions.match,'match');
const findingIds = 'versionMatch scanMatch current-snapshot collection config-directory state-files runtime-locks runtime-safety stats-cache mount-inventory-current quarantine-state docker-runtime command-execution support-logs latest-scan docker-ownership'.split(' ');
privacy.sanitizeDiagnosticsRow({sourceNames:findingIds},metadataRedactor);
for (const id of findingIds) assert.equal(privacy.sanitizeDiagnosticsValue({id},metadataRedactor,'').id,id,'Actual fixed troubleshooting IDs remain usable after the final scrub: '+id);
assert.ok(!/tools|main/.test(metadataResult.supportSummary.headline),'Summary prose still redacts private names that coincide with enums');
assert.ok(!/PrivateMetadataCanary/.test(JSON.stringify(metadataResult)),'Unknown extra keys, nested objects and free text still receive the full recursive scrub');
assert.equal(JSON.stringify(metadataSource),metadataBefore,'Metadata preservation never mutates the source payload');
assert.equal(JSON.stringify(privacy.sanitizeDiagnosticsValue(metadataResult,metadataRedactor,'')),JSON.stringify(metadataResult),'Reusing one registry for repeated final passes is idempotent');
const schemaCollision = privacy.sanitizeDiagnosticsValue(Object.fromEntries(metadataKeys.map(key=>[key,1])),metadataRedactor,'');
assert.deepEqual(Object.keys(schemaCollision),metadataKeys,'Every fixed telemetry schema key survives an app-name collision');
for (const key of ['event','modal','module','action','fixtureAction','rootReason','family','openSections','focus','health','severity','nextStep','section','browser','server','pluginVersion','generatedAt','request']) {
  const unknown = privacy.sanitizeDiagnosticsValue({[key]:'PrivateMetadataCanary',futureField:'tools'},metadataRedactor,'');
  assert.ok(!JSON.stringify(unknown).includes('PrivateMetadataCanary'),'Recognized metadata keys never bypass unknown private values: '+key);
  assert.notEqual(unknown.futureField,'tools','Recognized enum words are private in arbitrary fields');
}
assert.notEqual(privacy.sanitizeDiagnosticsValue(capturedAt,metadataRedactor,'futureTimestamp'),capturedAt,'Timestamp-looking private names remain private outside capture metadata');
assert.notEqual(privacy.sanitizeDiagnosticsValue(publicVersion,metadataRedactor,'futureVersion'),publicVersion,'Numeric names remain private outside version metadata');
assert.ok(!privacy.sanitizeDiagnosticsValue(publicVersion+' PrivateMetadataCanary',metadataRedactor,'pluginVersion').includes('PrivateMetadataCanary'),'Version preservation requires the whole value to match');
assert.ok(!privacy.sanitizeDiagnosticsValue(capturedAt+' PrivateMetadataCanary',metadataRedactor,'generatedAt').includes('PrivateMetadataCanary'),'Timestamp preservation requires the whole value to match');
const serverMetadataKeys = 'invalidRecordCount inspectedLineCount scannedByteCount scannedByteLimit recordLimit inspectionLimit recentLimit readByteLimitPerFile inspectedCount uninspectedCount selectionScope timestampSource modifiedAt readByteCount readByteLimit sourceStatus sourceReasonCode evidenceScope unknownCount missingCount auditValidationWindow jsonReadByteLimitPerFile snapshotInspectionLimit'.split(' ');
const serverCodePairs = [
  ['reasonCode','invalid_records'],['reasonCode','bounded_collection'],['reasonCode','required_source_missing'],
  ['sourceStatus','complete'],['sourceStatus','partial'],['sourceStatus','unavailable'],['sourceStatus','failed'],
  ['sourceReasonCode','invalid_json'],['sourceReasonCode','verified'],['sourceReasonCode','size_limit'],
  ['timestampSource','issued_at'],['timestampSource','file_modified_at'],
  ['selectionScope','newest_among_inspected_files'],['selectionScope','all_snapshot_files'],
  ['evidenceScope','latest_persisted_scan'],['omissionReason','required_source_missing'],['modifiedAt',serverAt]
];
const serverMetadataRedactor = privacy.buildDiagnosticsRedactor();
privacy.sanitizeDiagnosticsRow({sourceNames:[...serverMetadataKeys,...serverCodePairs.map(pair=>pair[1]),'PrivateServerCanary']},serverMetadataRedactor);
const serverSchema = privacy.sanitizeDiagnosticsValue(Object.fromEntries(serverMetadataKeys.map(key=>[key,1])),serverMetadataRedactor,'');
assert.deepEqual(Object.keys(serverSchema),serverMetadataKeys,'Server bounded-read and inspection metadata keys survive app-name collisions');
for (const [key,value] of serverCodePairs) {
  assert.equal(privacy.sanitizeDiagnosticsValue({[key]:value},serverMetadataRedactor,'')[key],value,'Only source-defined server metadata values bypass name replacement: '+key);
  const privateValue = privacy.sanitizeDiagnosticsValue({[key]:'PrivateServerCanary',futureField:value},serverMetadataRedactor,'');
  assert.ok(!JSON.stringify(privateValue).includes('PrivateServerCanary'),'Server metadata keys never exempt arbitrary private values: '+key);
  assert.notEqual(privateValue.futureField,value,'Server metadata codes remain private names outside their typed field: '+key);
}
const serverCounts = privacy.sanitizeDiagnosticsValue({reasonCounts:{invalid_records:2,invalid_json:3,size_limit:4,PrivateServerCanary:10}},serverMetadataRedactor,'').reasonCounts;
assert.deepEqual(Object.keys(serverCounts).sort(),['invalid_json','invalid_records','size_limit']);
assert.equal(serverCounts.invalid_records,2,'Snapshot validation failures remain visible as bounded counters');
assert.equal(serverCounts.invalid_json,3);
assert.equal(serverCounts.size_limit,4);
const unknownServerField = privacy.sanitizeDiagnosticsValue({sourceStatus:{PrivateServerCanary:'/home/PrivateServerCanary/records'},evidenceScope:'PrivateServerCanary'},serverMetadataRedactor,'');
assert.ok(!JSON.stringify(unknownServerField).includes('PrivateServerCanary'),'Server enum rules never bypass recursive objects or private absolute paths');
const prototypeNames = privacy.buildDiagnosticsRedactor();
for (const part of ['constructor','toString','__proto__']) {
  const path = privacy.sanitizeDiagnosticsPath('/home/' + part,prototypeNames);
  assert.ok(/^\/home\/<path-\d+>$/.test(path),'Valid path names must never resolve through object prototypes');
  assert.equal(privacy.sanitizeDiagnosticsPath('/home/' + part,prototypeNames),path,'Aliases remain stable for prototype-like directory names');
}
assert.equal(privacy.sanitizeDiagnosticsFreeText('HTTP/2 read/write on 2026/11/01; retry 1/2. Permission denied',privacy.buildDiagnosticsRedactor()),'HTTP/2 read/write on 2026/11/01; retry 1/2. Permission denied','Ordinary slash-separated prose, dates and counts are not filesystem paths');
const target = privacy.sanitizeDiagnosticsPath("/data/TaxRecords/customer-a", redactor);

assert.ok(target.startsWith("/data/"), "container target root should remain useful");
assert.ok(!target.includes("TaxRecords"), "container target details should be aliased");
assert.ok(!target.includes("customer-a"), "all private container target segments should be aliased");
assert.strictEqual(privacy.diagnosticsKeyLooksLikePath("target"), true, "target keys should be treated as paths");

const refs = privacy.sanitizeDiagnosticsTemplateRefs([{ name: "PrivateApp", file: "private.xml", target: "/private-target/customer-a" }], redactor);
const refsJson = JSON.stringify(refs);
assert.ok(!refsJson.includes("PrivateApp"), "template app names should be aliased");
assert.ok(!refsJson.includes("private.xml"), "template filenames should be aliased");
assert.ok(!refsJson.includes("private-target"), "template target paths should be aliased");
assert.ok(!refsJson.includes("customer-a"), "template target path segments should be aliased");

const url = privacy.sanitizeDiagnosticsFreeText("request https://[2001:db8::1234]:8443/private?q=1", redactor);
assert.ok(url.includes("<url>"), "Complete URLs should be removed before path redaction");
assert.ok(!url.includes("2001:db8::1234"), "bracketed IPv6 addresses should not remain in URLs");
for (const message of [
  'creating: /boot/config/plugins/sample/package.txz https://private.example/PrivateRepo/archive.txz?key=secret',
  'creating: /boot/config/plugins/<path>/<path>://private.example/PrivateRepo/archive.txz',
  'request wss://user:secret@[2001:db8::1234]:8443/PrivateRepo',
  String.raw`request https:\/\/user:secret@private.example\/PrivateRepo?key=secret`
]) {
  const result = JSON.stringify(privacy.sanitizeDiagnosticsValue({logs:[{lines:[message]}]}, privacy.buildDiagnosticsRedactor(), ''));
  assert.ok(!/private\.example|PrivateRepo|secret|2001:db8/.test(result), 'Installer URLs and previously scrubbed scheme fragments must not survive');
}

const scrubbed = privacy.sanitizeDiagnosticsValue({ target: "/data/TaxRecords/customer-a" }, privacy.buildDiagnosticsRedactor(), "");
assert.ok(!JSON.stringify(scrubbed).includes("TaxRecords"), "recursive target fields should be path-sanitized");

const privateMountRow = {name:'PrivateApp',path:'/mnt/user/appdata/PrivateApp',mountEvidence:[{name:'PrivateContainer',paths:['/mnt/user/customer-records'],futureSecret:'private-canary'}],broadMountEvidence:[{name:'PrivateContainer',paths:['/mnt/user'],raw:'private-canary'}]};
const mountRedactor = privacy.buildDiagnosticsRedactor();
const privateMountExport = privacy.sanitizeDiagnosticsValue(privacy.sanitizeDiagnosticsRow(privateMountRow, mountRedactor), mountRedactor, '');
assert.equal(privateMountExport.mountEvidence.length,1,'Diagnostics must retain specific mount evidence');
assert.equal(privateMountExport.broadMountEvidence.length,1,'Diagnostics must distinguish broad access');
assert.equal(privateMountExport.mountEvidence[0].name,privateMountExport.broadMountEvidence[0].name,'Export-scoped aliases must correlate the same container');
assert.ok(!/PrivateContainer|customer-records|private-canary|PrivateApp/.test(JSON.stringify(privateMountExport)),'Names, private paths and unknown fields must not be exported');
assert.deepEqual(Object.keys(privateMountExport.mountEvidence[0]).sort(),['name','paths']);
assert.equal(privateMountRow.mountEvidence.length, 1, 'Export must not mutate UI evidence');
const collisionRedactor = privacy.buildDiagnosticsRedactor();
collisionRedactor.replacements = [{raw:'data',sanitized:'<app-1>'},{raw:'path',sanitized:'<app-2>'},{raw:'appdata',sanitized:'<app-3>'}];
const collision = privacy.sanitizeDiagnosticsValue({datasetName:'private data', appdataSources:{count:1}, '/mnt/user/private-data':{name:'data'}}, collisionRedactor, '');
assert.ok(Object.hasOwn(collision,'datasetName') && Object.hasOwn(collision,'appdataSources'), 'Private words must not corrupt fixed schema field names');
assert.ok(!JSON.stringify(collision).includes('/mnt/user/private-data'), 'Path-based keys must still be sanitized');
assert.ok(!collision.datasetName.includes('private data'), 'Schema-key preservation must not preserve private values');
assert.equal(privacy.sanitizeDiagnosticsFreeText('A dataset contains data. <path-1>',collisionRedactor),'A dataset contains <app-1>. <path-1>','Whole-word redaction must preserve prose and existing aliases');
const telemetry = privacy.sanitizeDiagnosticsScanMetrics({startedAt:'2026-09-18T12:00:00-04:00',phases:[{name:'docker_query',containerCount:53,raw:'private-canary'},{name:'private-canary',durationMs:5}],dockerInventory:{reasonCode:'incomplete_inventory',acceptedCount:53,issues:{invalid_mounts:1,'private-canary':1},raw:'private-canary'}});
assert.equal(telemetry.dockerInventory.reasonCode,'incomplete_inventory');
assert.equal(telemetry.dockerInventory.acceptedCount,53);
assert.equal(telemetry.dockerInventory.issues.invalid_mounts,1);
assert.equal(telemetry.phases.length,1);
assert.ok(!JSON.stringify(telemetry).includes('private-canary'),'Browser telemetry must drop unknown fields, phase names and issue codes');
collisionRedactor.replacements.push({raw:'incomplete_inventory',sanitized:'<app-4>'});
assert.equal(privacy.sanitizeDiagnosticsValue({dockerInventory:telemetry.dockerInventory},collisionRedactor,'').dockerInventory.reasonCode,'incomplete_inventory','Allowlisted support codes must remain stable');
console.log("diagnostics_privacy_client: executable client redaction checks passed.");
