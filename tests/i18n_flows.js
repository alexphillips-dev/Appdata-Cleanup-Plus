"use strict";
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '../source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus');
const locales = JSON.parse(fs.readFileSync(path.join(root, 'locales/locales.json'), 'utf8'));
const cases = JSON.parse(execFileSync('php', [path.join(__dirname, 'i18n_cases.php')], {encoding:'utf8', maxBuffer:10e6}));
const source = name => fs.readFileSync(path.join(root, 'scripts', name), 'utf8');
const main = source('appdata.cleanup.plus.js');
assert.equal(main.split('$(init);').length, 2, 'Test harness must intercept only page initialization');
const hook = 'window.flow = {state:state, buildSectionMetaHtml:buildSectionMetaHtml, buildOperationContext:buildOperationContext, buildActionConfirmButtonText:buildActionConfirmButtonText, buildRestoreConflictDialogHtml:buildRestoreConflictDialogHtml, buildQuarantineSelectionSummaryText:buildQuarantineSelectionSummaryText, applyLocalCandidateState:applyLocalCandidateState, getRowStateDescriptor:getRowStateDescriptor, buildOperationPreviewHtml:buildOperationPreviewHtml, buildOperationProgressHtml:buildOperationProgressHtml, buildTemplateActionLockReason:buildTemplateActionLockReason};';
for (const [locale, definition] of Object.entries(locales)) {
  const fixture = cases[locale];
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'locales', locale + '.json'), 'utf8'));
  const window = {appdataCleanupPlusConfig:{catalog, plurals:fixture.plurals, languageTag:definition.tag}};
  const $ = function() { throw Error('Unexpected DOM access in presentation fixture'); };
  Object.assign($, {isArray:Array.isArray, isPlainObject:v=>!!v && typeof v==='object' && !Array.isArray(v), trim:v=>String(v||'').trim(), extend:Object.assign,
    grep:(a,f)=>a.filter(f), map:(a,f)=>Object.keys(a||{}).map(k=>f(a[k],k)).filter(v=>v!==null), inArray:(v,a)=>a.indexOf(v),
    each:(a,f)=>Object.keys(a||{}).forEach(k=>f(k,a[k]))});
  const context = vm.createContext({window, document:{}, jQuery:$, Intl, Date, console});
  vm.runInContext(source('appdata.cleanup.plus.shared.js'), context);
  vm.runInContext(source('appdata.cleanup.plus.panels.js'), context);
  vm.runInContext(main.replace('$(init);', hook), context);
  const ACP = window.AppdataCleanupPlus, flow = window.flow;
  flow.state.settings = {enablePermanentDelete:true,enableZfsDatasetDelete:true};
  flow.state.dockerRunning = true;
  flow.state.rows = [{id:'unverified',risk:'deletable',scanVerificationLocked:true,policyReason:'verification failure',status:'unverified',canDelete:false}];
  flow.applyLocalCandidateState(['unverified'],'ignore');
  flow.applyLocalCandidateState(['unverified'],'unignore');
  assert.equal(flow.state.rows[0].canDelete,false,'Safe Mode disabled must not override failed verification');
  assert.equal(flow.state.rows[0].risk,'blocked','Restoring an ignored row must not count it as ready during an incomplete scan');
  assert.equal(flow.state.rows[0].policyReason,'verification failure','Local settings must preserve the actionable blocking reason');
  assert.equal(flow.state.rows[0].statusLabel,ACP.tr('Unverified'),'Repeated ignore/restore must not claim an unverified row is orphaned');
  const selector = new Intl.PluralRules(definition.tag);
  fixture.counts.forEach((n,i)=>{
    assert.equal(fixture.categories[i], selector.select(n), `${locale}: PHP category ${n}`);
    assert.equal(ACP.pluralCategory(n), selector.select(n), `${locale}: JS category ${n}`);
    const formatted = new Intl.NumberFormat(definition.tag).format(n);
    assert.equal(ACP.formatCount(n), formatted, `${locale}: JS count ${n}`);
    assert.equal(fixture.formattedCounts[i], formatted, `${locale}: PHP count ${n}`);
    assert.equal(fixture.countMessages[i], ACP.plural('{count} items were submitted.', n), `${locale}: PHP/JS rendered count ${n}`);
  });
  // Complete rendered flows cover zero, singular, dual, few, many and teen boundaries.
  for (const n of [0,1,2,3,5,11,21,22,101]) {
    const row = {id:'example',name:'<b>Delete</b>',sourceKind:'filesystem',sourceNames:[],targetPaths:[],canDelete:true,storageKind:'filesystem',risk:'deletable',path:'/mnt/user/Delete'};
    const operation = flow.buildOperationContext('delete', [row]);
    const button = flow.buildActionConfirmButtonText(operation,n);
    assert.equal(button, ACP.plural('Delete {count} folders',n));
    assert.equal(flow.buildActionConfirmButtonText(flow.buildOperationContext('delete',[{storageKind:'zfs'}]),n),ACP.plural('Destroy {count} datasets',n));
    assert.equal(flow.buildActionConfirmButtonText(flow.buildOperationContext('delete',[row,{storageKind:'zfs'}]),n),ACP.plural('Delete {count} items',n));
    assert.equal(flow.buildActionConfirmButtonText(flow.buildOperationContext('quarantine',[row]),n),ACP.plural('Quarantine {count} folders',n));
    const preview = flow.buildOperationPreviewHtml([Object.assign({},row,{path:'/mnt/user/<b>Delete</b>'})],operation,{});
    assert.ok(!preview.includes('<b>Delete</b>') && preview.includes('&lt;b&gt;Delete&lt;/b&gt;'));
    const progress = flow.buildOperationProgressHtml({completedRoots:n,totalRoots:n+1},operation,false);
    assert.ok(progress.includes(ACP.escapeHtml(ACP.plural('Processed {count} folders.',n))));
    assert.equal(flow.buildQuarantineSelectionSummaryText(n), ACP.plural('{count} folders selected',n));
    const conflict = flow.buildRestoreConflictDialogHtml({summary:{ready:n,conflicts:n},conflicts:[]});
    assert.ok(conflict.includes(ACP.escapeHtml(ACP.plural('{count} conflicts found.',n))));
    if (n) assert.ok(conflict.includes(ACP.escapeHtml(ACP.plural('{count} selected folders can still restore normally.',n))));
    const quarantine = ACP.buildQuarantineManagerModalHtml({strings:{},state:{settings:{},quarantine:{summary:{count:n,sizeLabel:'0 B'},entries:[]}}});
    if (n) assert.ok(quarantine.includes(ACP.escapeHtml(ACP.plural('{count} quarantined folders tracked',n))));
    if (locale !== 'en_US') {
      assert.ok(!conflict.includes('conflicts found') && !conflict.includes('still restore normally'));
      assert.ok(!quarantine.includes(' tracked'));
      assert.notEqual(button, `Delete ${n} folders`);
    }
  }
  const history = ACP.buildAuditHistoryModalHtml({strings:{},state:{auditHistory:[{requestedCount:1}]}});
  for (const n of [1,2,5,21,1000]) {
    for (const [key, row] of [['{count} items ready',{canDelete:true}],['{count} items blocked',{risk:'blocked'}],['{count} items ignored',{ignored:true}]]) {
      const badges = flow.buildSectionMetaHtml(Array.from({length:n}, () => row));
      assert.ok(badges.includes(ACP.escapeHtml(ACP.plural(key,n))), `${locale}: section badge ${key} ${n}`);
    }
    const entries = [{requestedCount:1000,pathCount:n+1,pathsPreview:[{path:'/literal/1000',status:'deleted'}],summary:{deleted:1000}}];
    const html = ACP.buildAuditHistoryModalHtml({strings:{},state:{auditHistory:entries}});
    assert.ok(html.includes(ACP.escapeHtml(ACP.plural('{count} more paths',n))));
    assert.ok(html.includes(ACP.escapeHtml(ACP.plural('Showing {shown} of {count} history entries.',1,{shown:ACP.formatCount(1)}))));
    assert.ok(html.includes(': '+ACP.escapeHtml(ACP.formatCount(1000))+'</span>'));
    assert.ok(html.includes('/literal/1000'), 'Path digits must remain literal');
    if (locale === 'en_US' && n === 1) {
      assert.ok(html.includes('1 more path</div>') && !html.includes('1 more paths'));
      assert.ok(html.includes('Showing 1 of 1 history entry.'));
    }
  }
  assert.ok(history.includes(ACP.escapeHtml(ACP.plural('{count} items submitted',1))));
  const filteredHistory = ACP.buildAuditHistoryModalHtml({strings:{},state:{auditQuery:'match-only',auditHistory:[{message:'match-only'},{message:'different'}]}});
  assert.ok(filteredHistory.includes(ACP.escapeHtml(ACP.plural('Showing {shown} of {count} history entries.',2,{shown:ACP.formatCount(1)}))), `${locale}: filtered History counts`);
  flow.state.rows = [{id:'example',sourceKind:'filesystem',canDelete:true,risk:'deletable'}];
  assert.equal(flow.applyLocalCandidateState(['example'],'ignore'),true);
  assert.equal(flow.getRowStateDescriptor(flow.state.rows[0]).label,catalog.Ignored);
  const evidenceRow = {sourceNames:['Delete','<b>Example</b>'],targetPaths:['/mnt/user/Delete']};
  const evidence = flow.buildTemplateActionLockReason(evidenceRow);
  assert.ok(evidence.includes('Delete') && evidence.includes('/mnt/user/Delete'));
  assert.ok(!evidence.includes('tracked container paths') && !evidence.includes('+2 more'));
  const payload = fixture.payload;
  assert.deepEqual(payload.bundle, fixture.original.bundle);
  assert.deepEqual(payload.settings, fixture.original.settings);
  assert.deepEqual(payload.candidate.sourceNames, fixture.original.candidate.sourceNames);
  assert.deepEqual(payload.candidate.targetPaths, fixture.original.candidate.targetPaths);
  assert.ok(payload.candidate.reason.includes('<b>ExampleC</b>') && payload.candidate.reason.includes('/mnt/user/Delete'));
  assert.ok(!payload.candidate.reason.includes('tracked container paths') && !payload.candidate.reason.includes('+2 more'));
  const tools = ACP.buildToolsModalHtml({state:{fixtureTools:{status:{zfsNote:payload.zfsNote}}},strings:{}});
  assert.ok(tools.includes(ACP.escapeHtml(payload.zfsNote)));
  const templateHtml = ACP.buildTemplateManagerHtml({status:{templates:[{id:'one',name:'<img src=x>',filename:'private.xml'}],backups:[{id:'backup',name:'Saved',filename:'saved.xml',canRestore:false}]}});
  assert.ok(templateHtml.includes(ACP.escapeHtml(ACP.tr('Archive template'))) && !templateHtml.includes('<img src=x>'));
  assert.ok(templateHtml.includes('data-action="restore-template"') && templateHtml.includes(' disabled'));
  assert.ok(templateHtml.includes(ACP.escapeHtml(ACP.tr('Template already exists'))));
  const mountHtml = ACP.buildMountEvidenceHtml([{name:'<b>PrivateApp</b>',paths:['/mnt/user/My App']}]);
  assert.ok(mountHtml.includes('<summary>') && !mountHtml.includes('<b>PrivateApp</b>'));
  assert.ok(mountHtml.includes('/mnt/user/My App') && mountHtml.includes(ACP.escapeHtml(ACP.tr('Specific container mounts'))));
  const broadHtml = ACP.buildMountEvidenceHtml([{name:'<b>Viewer</b>',paths:['/mnt/user']}],true);
  assert.ok(broadHtml.includes(ACP.escapeHtml(ACP.tr('Broad container access'))) && !broadHtml.includes('<b>Viewer</b>'));
  assert.ok(broadHtml.includes(ACP.escapeHtml(ACP.tr('These containers can access this folder through a mount above the appdata source. This does not establish ownership and does not block cleanup.'))));
  if (locale !== 'en_US') {
    for (const key of ['scanWarningMessage','reason','zfsNote','storageLabel']) assert.notEqual(payload[key],fixture.original[key],`${locale}: ${key}`);
    assert.ok(!payload.scanWarningMessage.includes('Filesystem discovery') && !payload.scanWarningMessage.includes('Scan results loaded'));
    assert.ok(!payload.history.message.includes('folders were deleted') && !payload.history.message.includes('items were submitted'));
    assert.ok(!fixture.legacyImpact.includes('Recursive destroy'));
    assert.equal(fixture.oldImpact, fixture.legacyImpact, 'Legacy stored impact uses current complete messages');
    for (const timer of fixture.purgeTimers) assert.ok(!timer.includes('Purges in'), `${locale}: purge countdown`);
  }
  if (locale === 'pl_PL') assert.equal(flow.buildActionConfirmButtonText(flow.buildOperationContext('delete',[{storageKind:'filesystem'}]),1),'Usuń 1 folder');
  if (locale === 'ja_JA') assert.equal(ACP.plural('Delete {count} folders',2),'2 個のフォルダーを削除');
  if (locale === 'ar_AR') assert.equal(ACP.plural('{count} snapshots',2),'لقطتان');
  if (locale === 'en_US') assert.equal(ACP.plural('{count} items submitted',1),'1 item submitted');
}
assert.deepEqual(cases.ru_RU.snapshots,['1 снимок','2 снимка','5 снимков','21 снимок']);
console.log('i18n_flows: all 42 locales; PHP/JS CLDR parity, confirmation, conflicts, selection, quarantine, ignore, Tools, warnings, history and literal data passed.');
