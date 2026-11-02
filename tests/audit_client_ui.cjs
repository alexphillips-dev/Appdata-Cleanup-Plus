// Native browser regressions for the client audit. Only backend responses and
// page initialization are controlled; inputs, events, modal lifecycle and CSS
// execute shipped code. Every path and record below is synthetic.
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {setFixtureContent} = require('./browser_fixture.cjs');
const dependency = name => process.env.ACP_BROWSER_MODULES ? path.join(process.env.ACP_BROWSER_MODULES, name) : name;
const {chromium} = require(dependency('playwright'));
const plugin = path.resolve(__dirname, '../source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus');
const references = {
  '7.0': {ref:'25bc9e2d16525e4e4f9796c9c64c1a3e1c63402d',bundle:'a6018c4f73c83fa8684117b2067141ac8e8acb83e6367f9f1b771aff952e3a2a',alert:'af4a31e3c4f42e678468a147c5ab7f0ddbb935eca1ffbfdcf2cea3e95cf06a2f'},
  '7.3': {ref:'41e8d5ad5db20b0e9aeea4334b39bea56729579a',bundle:'35bbdc9e33f441df5940de2a124eafe3808e12e893837985e5ce95c832f85c83',alert:'5f0a5a019cf065b4baabfc9e0314a603c0d7bcfc74d02e4e178cbf0eadd04a62'}
};
const assets = new Map();
async function reference(version, file) {
  const key = version + '/' + file;
  if (assets.has(key)) return assets.get(key);
  let text;
  const local = file === 'alert' ? process.env.ACP_NATIVE_MODAL_REFERENCE_DIR && path.join(process.env.ACP_NATIVE_MODAL_REFERENCE_DIR, version + '-sweetalert.js') : process.env.ACP_NATIVE_THEME_DIR && path.join(process.env.ACP_NATIVE_THEME_DIR,version,file.replace('/','-'));
  if (local && fs.existsSync(local)) text = fs.readFileSync(local, 'utf8');
  else {
    const source = file === 'alert' ? 'javascript/dynamix.js' : 'styles/' + file;
    const response = await fetch(`https://raw.githubusercontent.com/unraid/webgui/${references[version].ref}/emhttp/plugins/dynamix/${source}`, {signal:AbortSignal.timeout(30000)});
    assert.ok(response.ok, 'Pinned native asset available: ' + key);
    text = await response.text();
    if (file === 'alert') {
      assert.equal(crypto.createHash('sha256').update(text).digest('hex'), references[version].bundle);
      const lines = text.split(/\r?\n/).filter(line => line.includes('sa-confirm-button-container') && line.includes('sweetAlert'));
      assert.equal(lines.length,1);
      text = lines[0] + '\n';
    }
  }
  if (file === 'alert') assert.equal(crypto.createHash('sha256').update(text).digest('hex'), references[version].alert);
  assets.set(key,text);
  return text;
}
async function fixture(browser, {version='7.3', theme='black', timezoneId='America/New_York', known=true, startup=false} = {}) {
  const page = await browser.newPage({viewport:{width:1440,height:1000},timezoneId});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.abort());
  await setFixtureContent(page,execFileSync('php',[path.join(__dirname,'render_i18n_page.php'),'en_US',theme],{encoding:'utf8',maxBuffer:4e6}));
  const css = version === '7.0' ? [`default-${theme}.css`,'jquery.sweetalert.css',`dynamix-${theme}.css`] : ['default-color-palette.css','default-base.css','jquery.sweetalert.css','default-dynamix.css',`themes/${theme}.css`];
  for (const file of css) await page.addStyleTag({content:await reference(version,file)});
  await page.addStyleTag({path:path.join(plugin,'styles/appdata.cleanup.plus.css')});
  await page.addScriptTag({path:require.resolve(dependency('jquery/dist/jquery.js'))});
  await page.addScriptTag({content:await reference(version,'alert')});
  await page.evaluate(() => {
    window.requests = [];
    window.pending = action => requests.findLast(item => !item.settled && item.data.action === action);
    $.ajax = options => {
      const deferred = $.Deferred();
      const request = {data:options.data,deferred,settled:false};
      requests.push(request);
      deferred.always(() => { request.settled = true; });
      return deferred.promise();
    };
    window.row = (id, extra={}) => Object.assign({id,name:'Synthetic ' + id,storageKind:'filesystem',sourceKind:'filesystem',path:'/synthetic/appdata/' + id,displayPath:'/synthetic/appdata/' + id,risk:'safe',canDelete:true},extra);
  });
  for (const suffix of ['shared','panels']) await page.addScriptTag({path:path.join(plugin,'scripts/appdata.cleanup.plus.'+suffix+'.js')});
  const main = fs.readFileSync(path.join(plugin,'scripts/appdata.cleanup.plus.js'),'utf8');
  assert.equal(main.split('$(init);').length,2);
  if (startup) {
    await page.addScriptTag({content:main});
    await page.waitForFunction(()=>!!pending('getOrphanAppdata'));
    return {page,errors};
  }
  const hook = 'window.client={state,loadScan,saveSafetySettings,openRowDetailsModal,openHelpModal,openToolsModal,openQuarantineManagerModal,startScanStatHydration,apiPostForUserAction,renderAll}; cacheElements(); bindEvents();';
  await page.addScriptTag({content:main.replace('$(init);',hook)});
  await page.evaluate(known => {
    client.state.settingsLoaded = known;
    client.state.scanToken = 'synthetic-scan';
    client.state.rows = [row('one')];
    client.state.summary = {total:1,blocked:0,deletable:1};
    client.renderAll();
  },known);
  return {page,errors};
}
async function close(page, escape=false) {
  if (!await page.locator('.sweet-alert:visible').count()) return;
  await page.waitForSelector('.sweet-alert.visible');
  if (escape) await page.keyboard.press('Escape');
  else await page.locator('.sweet-alert button.confirm').click();
  await page.waitForTimeout(240);
  assert.equal(await page.locator('.sweet-alert:visible').count(),0);
}
async function check(browser, name, fn, options) {
  const {page,errors} = await fixture(browser,options);
  try { await fn(page); assert.deepEqual(errors,[],name + ': no browser errors'); console.log('audit_client_ui: ' + name + ' passed'); }
  finally { await page.close(); }
}
async function scheduling(page) {
  await page.evaluate(() => {
    client.state.quarantine.loaded=true;
    client.state.quarantine.entries=[{id:'quarantined-one',name:'Synthetic',originalPath:'/synthetic/appdata/one'}];
    client.state.quarantine.selected={'quarantined-one':true};
    client.openQuarantineManagerModal(false);
    document.querySelector('.acp-quarantine-default-purge-input').closest('details').open=true;
  });
  const input=page.locator('.acp-quarantine-default-purge-input');
  await input.fill('1e2');
  assert.equal(await input.evaluate(node=>node.checkValidity()),true);
  await input.dispatchEvent('change');
  assert.equal(await page.evaluate(()=>pending('saveSafetySettings').data.defaultQuarantinePurgeDays),'100','AUD-08: numeric notation preserves full number');
  await page.evaluate(()=>pending('saveSafetySettings').deferred.resolve({settings:{defaultQuarantinePurgeDays:100}}));
  await page.locator('.acp-quarantine-default-purge-input').evaluate(node=>{node.closest('details').open=true;});
  await page.locator('.acp-quarantine-default-purge-input').fill('1.5');
  await page.locator('.acp-quarantine-default-purge-input').dispatchEvent('change');
  assert.equal(await page.evaluate(()=>requests.filter(item=>item.data.action==='saveSafetySettings').length),1,'AUD-08: fractional days never save');
  assert.equal(await page.locator('.sweet-alert > p').isVisible(),true,'Validation message is visible in native alert');
  await close(page);
  for(const invalid of ['-1','3651','1e']) {
    await page.evaluate(()=>client.openQuarantineManagerModal(false));
    const invalidInput=page.locator('.acp-quarantine-default-purge-input');
    await invalidInput.evaluate(node=>{node.closest('details').open=true;});
    await invalidInput.fill('');
    await invalidInput.pressSequentially(invalid);
    assert.equal(await invalidInput.evaluate(node=>node.checkValidity()),false,'Invalid native numeric input '+invalid);
    await invalidInput.dispatchEvent('change');
    assert.equal(await page.evaluate(()=>requests.filter(item=>item.data.action==='saveSafetySettings').length),1,'Invalid value never updates saved default: '+invalid);
    await close(page);
  }
  await page.evaluate(()=>client.openQuarantineManagerModal(false));
  const timezone=await page.evaluate(()=>Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.ok(['America/New_York','Asia/Tokyo'].includes(timezone),'Scheduling fixture has an explicit supported timezone');
  // Fixed expectations independently exercise the browser TZDB at both DST
  // boundaries. Ambiguous fall-back 01:30 uses the browser's first occurrence.
  const scheduleCases=timezone==='America/New_York' ? [
    ['2035-06-01T12:00','2035-06-01T16:00:00.000Z'],
    ['2035-03-11T01:30','2035-03-11T06:30:00.000Z'],
    ['2035-03-11T03:30','2035-03-11T07:30:00.000Z'],
    ['2035-11-04T01:30','2035-11-04T05:30:00.000Z'],
    ['2035-11-04T02:30','2035-11-04T07:30:00.000Z']
  ] : [['2035-06-01T12:00','2035-06-01T03:00:00.000Z']];
  for(const [local,expectedUtc] of scheduleCases) {
    await page.evaluate(()=>{
      const previous=pending('updateQuarantinePurgeSchedule');
      if(previous) previous.deferred.resolve({quarantine:{entries:client.state.quarantine.entries,summary:client.state.quarantine.summary}});
    });
    await page.locator('.acp-quarantine-schedule-at-input').evaluate(node=>{node.closest('details').open=true;});
    await page.locator('.acp-quarantine-schedule-at-input').fill(local);
    await page.locator('[data-action="set-quarantine-purge-schedule"]').click();
    assert.equal(await page.evaluate(()=>pending('updateQuarantinePurgeSchedule').data.purgeAt),expectedUtc,`AUD-09: ${timezone} ${local} preserves the expected UTC instant`);
    assert.equal(await page.evaluate(()=>client.state.quarantine.purgeAtInput),local,'Picker state stays browser-local');
  }
}
async function settings(page) {
  const saved={enablePermanentDelete:true,quarantineRoot:'/synthetic/custom-quarantine',defaultQuarantinePurgeDays:100,manualAppdataSources:['/synthetic/custom-appdata'],zfsPathMappings:[{shareRoot:'/synthetic/share',datasetRoot:'/synthetic/pool'}]};
  await page.evaluate(saved=>{Object.assign(client.state.settings,saved);client.loadScan();pending('getOrphanAppdata').deferred.reject({status:500,responseJSON:{message:'Synthetic scan failure'}});},saved);
  assert.deepEqual(await page.evaluate(()=>Object.fromEntries(['quarantineRoot','defaultQuarantinePurgeDays','manualAppdataSources','zfsPathMappings'].map(key=>[key,client.state.settings[key]]))),Object.fromEntries(Object.entries(saved).filter(([key])=>key!=='enablePermanentDelete')),'AUD-10: failed rescan retains confirmed settings');
  await page.locator('[data-action="toggle-safe-mode"]').click();
  const request=await page.evaluate(()=>pending('saveSafetySettings').data);
  assert.equal(request.enablePermanentDelete,'0');
  for(const key of ['quarantineRoot','defaultQuarantinePurgeDays','manualAppdataSources','zfsPathMappings'])assert.equal(Object.hasOwn(request,key),false,'AUD-10: mode toggle omits unrelated '+key);
  const persisted={...saved,enablePermanentDelete:false};
  await page.evaluate(persisted=>{pending('saveSafetySettings').deferred.resolve({settings:persisted});client.loadScan();pending('getOrphanAppdata').deferred.resolve({settings:persisted,scanToken:'reloaded',rows:[],summary:{total:0}});},persisted);
  assert.deepEqual(await page.evaluate(()=>client.state.settings.manualAppdataSources),saved.manualAppdataSources,'Unrelated settings survive server-backed reload');
  assert.equal(await page.evaluate(()=>client.state.settings.defaultQuarantinePurgeDays),100);
}
async function unknownSettings(page) {
  await page.evaluate(()=>{client.loadScan();pending('getOrphanAppdata').deferred.reject({status:500});});
  assert.equal(await page.locator('[data-action="toggle-safe-mode"]').count(),0);
  assert.match(await page.locator('#acp-mode-strip').textContent(),/Mode unavailable/);
  await page.evaluate(()=>{client.state.quarantine.loaded=true;client.openQuarantineManagerModal(false);});
  const days=page.locator('.acp-quarantine-default-purge-input');
  assert.equal(await days.isDisabled(),true,'Unknown saved default is not editable as a guessed zero');
  assert.equal(await days.inputValue(),'');
  assert.equal(await days.getAttribute('placeholder'),'Unavailable');
  await close(page);
  await page.evaluate(()=>client.saveSafetySettings({manualAppdataSources:['/synthetic/repair']}));
  assert.equal(await page.evaluate(()=>pending('saveSafetySettings').data.manualAppdataSources),'/synthetic/repair','Explicit source repair remains available without known settings');
}
async function startup(page) {
  await page.evaluate(()=>{pending('getOrphanAppdata').deferred.reject({status:500,responseJSON:{message:'Synthetic startup failure'}});pending('getRecentOperations').deferred.resolve({operations:[]});});
  assert.match(await page.locator('#acp-mode-strip').textContent(),/Mode unavailable/,'Unmodified startup keeps guessed settings unavailable');
  await page.locator('#acp-rescan').click();
  await page.evaluate(()=>{window.savedSettings={enablePermanentDelete:true,quarantineRoot:'/synthetic/saved-quarantine',defaultQuarantinePurgeDays:100,manualAppdataSources:['/synthetic/saved-appdata'],zfsPathMappings:[]};pending('getOrphanAppdata').deferred.resolve({scanToken:'startup-retry',settings:savedSettings,rows:[row('startup')],summary:{total:1}});});
  assert.equal(await page.locator('.acp-row').count(),1,'Real rescan renders results');
  assert.equal(await page.locator('[data-action="toggle-safe-mode"]').textContent(),'Enable Safe Mode');
  await page.locator('[data-action="toggle-safe-mode"]').click();
  assert.deepEqual(await page.evaluate(()=>Object.keys(pending('saveSafetySettings').data).filter(key=>!['action','scanToken','csrfToken'].includes(key)).sort()),['enablePermanentDelete'],'Real event sends only the changed setting');
  await page.evaluate(()=>{savedSettings.enablePermanentDelete=false;pending('saveSafetySettings').deferred.resolve({settings:savedSettings});});
  assert.equal(await page.locator('[data-action="toggle-safe-mode"]').textContent(),'Disable Safe Mode');
  await page.locator('#acp-rescan').click();
  await page.evaluate(()=>pending('getOrphanAppdata').deferred.resolve({scanToken:'startup-reload',settings:savedSettings,rows:[row('startup')],summary:{total:1}}));
  assert.equal(await page.locator('[data-action="toggle-safe-mode"]').textContent(),'Disable Safe Mode','Authoritative mode survives rescan through unchanged initialization/events');
}
async function details(page) {
  await page.evaluate(()=>{client.state.settings.enablePermanentDelete=true;client.state.rows=[row('a',{storageKind:'zfs'}),row('b',{storageKind:'zfs'})];client.openRowDetailsModal(client.state.rows[0]);});
  await close(page);
  await page.evaluate(()=>pending('getCandidateDetails').deferred.resolve({row:row('a',{storageKind:'zfs',zfsImpactSummary:'Synthetic completed preview'})}));
  await page.evaluate(()=>client.openRowDetailsModal(client.state.rows[0]));
  assert.equal(await page.evaluate(()=>client.state.rowDetails.cache.a.detailLoading),false,'AUD-15: close then completion does not strand loading');
  assert.equal(await page.evaluate(()=>requests.filter(r=>r.data.action==='getCandidateDetails').length),1,'Completed cached details reused');
  await close(page,true);
  assert.equal(await page.evaluate(()=>client.state.rowDetails.activeRowId),'','Escape clears active Details identity');
  await page.evaluate(()=>{client.state.rowDetails.cache={};client.openRowDetailsModal(client.state.rows[0]);});
  await close(page);
  await page.evaluate(()=>client.openRowDetailsModal(client.state.rows[1]));
  await page.evaluate(()=>{requests.find(r=>!r.settled&&r.data.candidateId==='a').deferred.resolve({row:row('a',{storageKind:'zfs',zfsImpactSummary:'A preview'})});pending('getCandidateDetails').deferred.resolve({row:row('b',{storageKind:'zfs',zfsImpactSummary:'B preview'})});});
  assert.equal(await page.locator('.acp-row-details-shell').getAttribute('data-row-id'),'b','Other row completion does not steal current modal');
  assert.equal(await page.evaluate(()=>client.state.rowDetails.cache.a.detailLoaded),true,'Per-row request remains independently cacheable');
  await close(page);
  await page.evaluate(()=>{client.state.rowDetails.cache={};client.openRowDetailsModal(client.state.rows[0]);});
  await close(page);
  await page.evaluate(()=>client.openRowDetailsModal(client.state.rows[0]));
  const pendingCount=await page.evaluate(()=>requests.filter(r=>r.data.action==='getCandidateDetails').length);
  await page.evaluate(()=>{pending('getCandidateDetails').deferred.reject({status:503,responseJSON:{message:'Synthetic preview failure'}});});
  assert.equal(await page.locator('.acp-row-details-status.is-error').isVisible(),true,'AUD-15: reopened pending request reports failure visibly');
  assert.equal(await page.evaluate(()=>client.state.rowDetails.cache.a.detailLoading),false);
  await close(page);
  await page.evaluate(()=>client.openRowDetailsModal(client.state.rows[0]));
  assert.equal(await page.evaluate(()=>requests.filter(r=>r.data.action==='getCandidateDetails').length),pendingCount+1,'AUD-15: failed details can retry');
  await page.evaluate(()=>pending('getCandidateDetails').deferred.resolve({row:row('a',{storageKind:'zfs'})}));
  await close(page);
  await page.evaluate(()=>{client.state.rowDetails.cache={};client.openRowDetailsModal(client.state.rows[0]);});
  await close(page,true);
  await page.evaluate(()=>{client.saveSafetySettings({enablePermanentDelete:false});pending('saveSafetySettings').deferred.resolve({settings:{enablePermanentDelete:false}});pending('getCandidateDetails').deferred.resolve({row:row('a',{storageKind:'zfs',canDelete:true})});});
  assert.equal(await page.evaluate(()=>client.state.rows[0].canDelete),false,'AUD-16: old Details response cannot undo newer Safe Mode lock');
  assert.equal(await page.locator('.acp-row-checkbox').first().isDisabled(),true);
  await page.evaluate(()=>{client.openRowDetailsModal(client.state.rows[0]);client.openHelpModal();pending('getCandidateDetails').deferred.resolve({row:row('a',{storageKind:'zfs',canDelete:true})});});
  assert.equal(await page.locator('.sweet-alert.acp-help-modal').count(),1,'Late response never replaces Help');
  assert.equal(await page.evaluate(()=>client.state.rows[0].canDelete),false,'Current policy also applies to accepted fresh Details');
  await close(page);
  await page.evaluate(()=>{client.state.rowDetails.cache={};client.state.settings.enablePermanentDelete=true;client.state.rows=[row('selected',{storageKind:'zfs'})];client.state.selected={selected:true};client.renderAll();client.openRowDetailsModal(client.state.rows[0]);pending('getCandidateDetails').deferred.resolve({row:row('selected',{storageKind:'zfs',canDelete:false,risk:'blocked',securityLockReason:'Synthetic current protection'})});});
  assert.deepEqual(await page.evaluate(()=>client.state.selected),{},'Fresh protection reconciles selection');
  assert.equal(await page.locator('#acp-primary-action').isDisabled(),true,'Fresh protection updates the action bar');
  assert.equal(await page.locator('#acp-selection-summary').textContent(),'0 folders selected','Fresh protection updates selection count');
}
async function scanGeneration(page) {
  await page.evaluate(()=>{client.loadScan();client.loadScan();const scans=requests.filter(r=>r.data.action==='getOrphanAppdata');scans[1].deferred.resolve({scanToken:'new-scan',settings:{},rows:[row('new')],summary:{total:1}});scans[0].deferred.resolve({scanToken:'old-scan',settings:{enablePermanentDelete:true},rows:[row('old')],summary:{total:1}});});
  assert.equal(await page.evaluate(()=>client.state.scanToken),'new-scan','Superseded scan never replaces latest scan');
  await page.evaluate(()=>{client.state.rows=[row('a',{storageKind:'zfs'})];client.openRowDetailsModal(client.state.rows[0]);client.loadScan();pending('getOrphanAppdata').deferred.resolve({scanToken:'third-scan',settings:{},rows:[row('a',{storageKind:'zfs',canDelete:false})],summary:{total:1}});pending('getCandidateDetails').deferred.resolve({row:row('a',{storageKind:'zfs',name:'Stale preview',canDelete:true})});});
  assert.equal(await page.evaluate(()=>client.state.rows[0].name),'Synthetic a','AUD-15/16: old scan Details never updates matching new ID');
  assert.equal(await page.evaluate(()=>client.state.rows[0].canDelete),false);
}
async function hydration(page) {
  for(const fails of [false,true]) {
    await page.evaluate(()=>{client.state.rows=Array.from({length:12},(_,i)=>row('size-'+i,{statsPending:true}));client.startScanStatHydration();client.apiPostForUserAction({action:'getQuarantineEntries'});});
    const before=await page.evaluate(()=>requests.filter(r=>r.data.action==='hydrateCandidateStats').length);
    await page.evaluate(fails=>{const request=pending('getQuarantineEntries');if(fails)request.deferred.reject({status:503});else request.deferred.resolve({entries:[]});},fails);
    await page.waitForTimeout(40);
    assert.equal(await page.evaluate(()=>requests.filter(r=>r.data.action==='hydrateCandidateStats').length),before,'AUD-17: foreground completion waits for abandoned in-flight batch');
    await page.evaluate(()=>pending('hydrateCandidateStats').deferred.resolve({rows:[]}));
    await page.waitForFunction(before=>requests.filter(r=>r.data.action==='hydrateCandidateStats').length>before,before);
    for(let batch=0;batch<2;batch++) {
      await page.evaluate(()=>{const request=pending('hydrateCandidateStats');request.deferred.resolve({rows:JSON.parse(request.data.candidateIds).map(id=>({id,sizeLabel:'1 MB',sizeBytes:1048576}))});});
      await page.waitForTimeout(30);
    }
    assert.equal(await page.evaluate(()=>client.state.rows.some(r=>r.statsPending)),false,'AUD-17: sizes finish after foreground '+(fails?'failure':'success'));
    assert.equal(await page.evaluate(()=>client.state.rows.every(r=>r.sizeLabel==='1 MB')),true);
  }
}
async function nativeError(page) {
  await page.evaluate(()=>{client.state.quarantine.loaded=false;client.openQuarantineManagerModal(true);pending('getQuarantineEntries').deferred.reject({status:503,responseJSON:{message:'Synthetic failure detail'}});});
  assert.equal(await page.locator('.sweet-alert > p').isVisible(),true,'AUD-18: generic error paragraph visible');
  assert.equal(await page.locator('.sweet-alert > p').textContent(),'Synthetic failure detail');
  assert.equal(await page.locator('.acp-modal-host').count(),0,'Old custom body removed');
  await close(page);
  await page.evaluate(()=>client.openHelpModal());
  await close(page,true);
  await page.evaluate(()=>AppdataCleanupPlus.showModal('Synthetic error','Visible after closed Help','error'));
  assert.equal(await page.locator('.sweet-alert > p').isVisible(),true,'Closed custom modal also resets before next native alert');
  assert.equal(await page.locator('.acp-modal-host').count(),0);
}
async function ignored(page) {
  await page.evaluate(()=>{client.state.rows=[row('ignored',{ignored:true,canDelete:false}),row('normal')];client.state.showIgnored=true;client.renderAll();});
  await page.locator('#acp-search').fill('normal');
  assert.equal(await page.locator('.acp-row').count(),1,'AUD-21: visible ignored rows share search filter');
  await page.locator('#acp-search').fill('ignored');
  assert.equal(await page.locator('.acp-row').count(),1);
  await page.locator('#acp-search').fill('no-match');
  assert.equal(await page.locator('.acp-row').count(),0);
  assert.match(await page.locator('#acp-results').textContent(),/No folders match/);
}
async function colors(page) {
  await page.evaluate(()=>{AppdataCleanupPlus.showModal({title:'Synthetic styles',text:'',html:true});AppdataCleanupPlus.applyDeleteModalClass('acp-delete-modal','<p class="acp-modal-feedback is-success">Success</p><p class="acp-modal-feedback is-error">Failure</p><input class="acp-restore-conflict-name is-error"><p class="acp-restore-conflict-feedback is-visible">Invalid name</p>');});
  const colors=await page.evaluate(()=>{const modal=document.querySelector('.sweet-alert');const tokens=getComputedStyle(modal);return {safe:tokens.getPropertyValue('--acp-safe-text').trim(),locked:tokens.getPropertyValue('--acp-locked-text').trim(),success:getComputedStyle(modal.querySelector('.is-success')).color,error:getComputedStyle(modal.querySelector('.acp-modal-feedback.is-error')).color,border:getComputedStyle(modal.querySelector('input')).borderTopColor,feedback:getComputedStyle(modal.querySelector('.acp-restore-conflict-feedback')).color};});
  // Normalize CSS color syntax through an actual element, independent of theme.
  const expected=await page.evaluate(colors=>{const node=document.createElement('span');document.body.append(node);node.style.color=colors.safe;const safe=getComputedStyle(node).color;node.style.color=colors.locked;const locked=getComputedStyle(node).color;node.remove();return {safe,locked};},colors);
  assert.equal(colors.success,expected.safe,'AUD-22: success uses safe semantic token');
  assert.equal(colors.error,expected.locked);
  assert.equal(colors.border,expected.locked);
  assert.equal(colors.feedback,expected.locked);
}
(async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    await check(browser,'AUD-08/09 native schedule inputs, New York',scheduling);
    await check(browser,'AUD-08/09 native schedule inputs, Tokyo',scheduling,{timezoneId:'Asia/Tokyo',version:'7.0'});
    await check(browser,'AUD-10 settings preservation and reload',settings);
    await check(browser,'AUD-10 initial unknown settings',unknownSettings,{known:false});
    await check(browser,'AUD-10 unmodified startup and rescan events',startup,{startup:true});
    await check(browser,'AUD-15/16 independent Details and mode generations',details);
    await check(browser,'AUD-15/16 scan generations',scanGeneration);
    await check(browser,'AUD-17 balanced statistics resume',hydration);
    await check(browser,'AUD-18 native modal errors and closed host cleanup',nativeError);
    await check(browser,'AUD-21 ignored search',ignored);
    for(const version of ['7.0','7.3'])for(const theme of ['black','white'])await check(browser,'AUD-22 feedback '+version+'/'+theme,colors,{version,theme});
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
