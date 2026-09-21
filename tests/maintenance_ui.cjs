// Optional browser regression: shipped event handlers with a synthetic server.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {setFixtureContent} = require('./browser_fixture.cjs');
const modules = process.env.ACP_BROWSER_MODULES;
const dependency = name => modules ? path.join(modules, name) : name;
const {chromium} = require(dependency('playwright'));
const plugin = path.resolve(__dirname, '../source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus');
(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000}});
    const errors = [];
    page.on('pageerror', e=>errors.push(e.message));
    const html = execFileSync('php', [path.join(__dirname,'render_i18n_page.php'),'en_US'], {encoding:'utf8',maxBuffer:4e6});
    await setFixtureContent(page, html);
    await page.addStyleTag({path:path.join(plugin,'styles/appdata.cleanup.plus.css')});
    await page.addScriptTag({path:require.resolve(dependency('jquery/dist/jquery.js'))});
    await page.evaluate(() => {
      window.requests = [];
      $.ajax = options => { const deferred = $.Deferred(); requests.push({options,deferred}); return deferred.promise(); };
      window.swal = (options, callback) => {
        let host = document.querySelector('.sweet-alert');
        if (!host) { host = document.createElement('div'); document.body.appendChild(host); }
        host.className = 'sweet-alert showSweetAlert';
        host.style.display = 'block';
        host.innerHTML = '<h2></h2><p></p><div class="sa-button-container"></div>';
        host.querySelector('h2').textContent = options.title || '';
        host.querySelector('p').textContent = options.text || '';
        window.confirmCallback = callback;
      };
    });
    for (const file of ['appdata.cleanup.plus.shared.js','appdata.cleanup.plus.panels.js']) await page.addScriptTag({path:path.join(plugin,'scripts',file)});
    const main = fs.readFileSync(path.join(plugin,'scripts/appdata.cleanup.plus.js'),'utf8');
    const hook = 'window.maintenance={buildOperationContext,buildOperationPreviewHtml,buildOperationResultsHtml,buildQuarantineManagerResultsHtml,showOperationResultsFromResponse,selectAllQuarantineEntries,getSelectedQuarantineEntryIds,startScanStatHydration,stopScanStatHydration,requestNextScanStatBatch,pauseScanStatHydrationForUserRequest,exportDiagnostics,recordDiagnosticsFailure,installDiagnosticsErrorCapture,state,openToolsModal,renderToolsModal,buildRowHtml,renderSummaryCards,renderResults,applyLocalSafetyStateToRow}; cacheElements(); bindEvents(); loadScan=function(){window.scanRefreshes=(window.scanRefreshes||0)+1;}; state.fixtureTools.status={};';
    await page.addScriptTag({content:main.replace('$(init);',hook)});
    await page.evaluate(()=>maintenance.openToolsModal());
    assert.equal(await page.locator('[data-action="copy-diagnostics-text"], [data-action="copy-support-summary"], .sweet-alert [data-action="review-templates"]').count(),0);
    assert.equal(await page.locator('[data-action="export-diagnostics"]').count(),1);
    await page.evaluate(()=>{
      document.querySelector('.sweet-alert').style.display='none';
      document.querySelector('.sweet-alert').classList.remove('showSweetAlert');
      AppdataCleanupPlus.releaseModalScrollLock(false);
    });
    await page.locator('[data-action="open-template-manager"]').click();
    assert.match(await page.locator('.sweet-alert h2').textContent(),/Saved template cleanup/);
    assert.equal(await page.evaluate(()=>requests.at(-1).options.data.managerAction),'status');
    await page.evaluate(()=>requests.at(-1).deferred.resolve({ok:true,templateManager:{templates:[{id:'server-template-id',name:'Saved app',filename:'saved.xml'}],backups:[]}}));
    await page.locator('[data-action="archive-template"]').click();
    assert.match(await page.locator('.sweet-alert h2').textContent(),/Archive/);
    await page.evaluate(()=>confirmCallback(false));
    assert.equal(await page.locator('.sweet-alert.acp-template-manager-modal').count(),1,'Cancel returns to the dedicated template manager');
    assert.equal(await page.evaluate(()=>requests.length),1,'Cancel must not submit an action');
    await page.locator('[data-action="archive-template"]').click();
    await page.evaluate(()=>confirmCallback(true));
    assert.deepEqual(await page.evaluate(()=>({id:requests.at(-1).options.data.templateId,action:requests.at(-1).options.data.managerAction})),{id:'server-template-id',action:'archive'});
    await page.evaluate(()=>requests.at(-1).deferred.resolve({ok:true,message:'Archived',templateManager:{templates:[],backups:[{id:'server-backup-id',name:'Saved app',filename:'saved.xml',canRestore:true}]}}));
    assert.equal(await page.evaluate(()=>window.scanRefreshes),1);
    await page.locator('[data-action="restore-template"]').click();
    await page.evaluate(()=>confirmCallback(true));
    await page.evaluate(()=>{ requests.at(-1).deferred.reject({status:409,responseJSON:{message:'Collision prevented',templateManager:{templates:[],backups:[{id:'server-backup-id',name:'Saved app',filename:'saved.xml',canRestore:false}]}}}); });
    assert.ok(await page.locator('[data-action="restore-template"]').isDisabled());
    assert.match(await page.locator('.sweet-alert').textContent(),/Collision prevented/);
    // Reopening loads fresh status; a late response must not replace Tools.
    const closeModal=async()=>page.evaluate(()=>{
      document.querySelector('.sweet-alert').style.display='none';
      document.querySelector('.sweet-alert').classList.remove('showSweetAlert');
      AppdataCleanupPlus.releaseModalScrollLock(false);
    });
    await closeModal();
    await page.locator('[data-action="open-template-manager"]').click();
    assert.equal(await page.evaluate(()=>requests.at(-1).options.data.managerAction),'status');
    await closeModal();
    await page.locator('[data-action="open-tools"]').click();
    await page.evaluate(()=>requests.at(-1).deferred.resolve({ok:true,templateManager:{templates:[],backups:[]}}));
    assert.equal(await page.locator('.sweet-alert.acp-tools-modal').count(),1,'Late template responses must not replace Tools');
    // Exercise the remaining diagnostics action through the actual download code.
    await page.evaluate(()=>{
      URL.createObjectURL=blob=>{window.downloadedBlob=blob;return 'blob:diagnostics-fixture';};
      URL.revokeObjectURL=()=>{};
      document.addEventListener('click',event=>{
        if(event.target.tagName==='A' && event.target.download){window.downloadedFilename=event.target.download;event.preventDefault();}
      },true);
    });
    await page.locator('[data-action="export-diagnostics"]').click();
    assert.equal(await page.evaluate(()=>requests.at(-1).options.data.action),'getDiagnosticsBundle');
    await page.evaluate(()=>requests.at(-1).deferred.resolve({ok:true,bundle:{schemaVersion:4,logs:[{lines:["Appdata Cleanup Plus: rename(/mnt/user/appdata/My Private App,/mnt/user/appdata/.quarantine/My Private App): Permission denied"]}]}}));
    assert.match(await page.evaluate(()=>downloadedFilename),/^appdata-cleanup-plus-diagnostics-.*\.json$/);
    assert.equal(await page.evaluate(async()=>JSON.parse(await downloadedBlob.text()).schemaVersion),5);
    const diagnosticsText = await page.evaluate(async()=>downloadedBlob.text());
    assert.ok(!diagnosticsText.includes('Private App'), 'Downloaded diagnostics must not retain spaced path fragments');
    assert.ok(diagnosticsText.includes('Permission denied'), 'Download must preserve the useful error context');
    // Preserve fixture failure evidence without exporting request/response content.
    await page.evaluate(()=>{maintenance.state.fixtureTools.status=null;maintenance.openToolsModal();});
    assert.equal(await page.evaluate(()=>requests.at(-1).options.data.managerAction),'status');
    await page.evaluate(()=>requests.at(-1).deferred.resolve({ok:true,status:{root:'',rootReasonCode:'unsafe_symlink',rootMessage:'Fixture root was rejected.'}}));
    assert.match(await page.locator('.acp-fixture-root').textContent(),/No usable fixture root/);
    assert.match(await page.locator('.acp-fixture-status').textContent(),/Fixture root was rejected/);
    await page.locator('[data-action="create-test-fixtures"]').click();
    await page.evaluate(()=>{requests.at(-1).deferred.reject({status:500,responseJSON:{ok:false,message:'Fixture creation failed.',status:{root:'',rootReasonCode:'missing',rootMessage:'Storage is unavailable.',privateCanary:'fixture-private-canary'}},responseText:'fixture-private-canary'});});
    assert.match(await page.locator('.acp-fixture-status').textContent(),/Storage is unavailable/,'Failed fixture responses must refresh root status');
    await page.evaluate(()=>{
      maintenance.recordDiagnosticsFailure('fixtureManagerAction',500,'error',10,{managerAction:'fixture-private-canary'},{status:{rootReasonCode:'fixture-private-canary'}});
      maintenance.exportDiagnostics();
      requests.at(-1).deferred.resolve({ok:true,bundle:{schemaVersion:5,collection:{status:'complete'}}});
    });
    const fixtureDiagnostics=await page.evaluate(async()=>JSON.parse(await downloadedBlob.text()));
    assert.ok(fixtureDiagnostics.recentFailures.data.some(item=>item.fixtureAction==='create' && item.fixtureRootReason==='missing'));
    assert.equal(fixtureDiagnostics.recentFailures.data.at(-1).fixtureAction,'none');
    assert.equal(fixtureDiagnostics.recentFailures.data.at(-1).fixtureRootReason,'unknown');
    assert.equal(fixtureDiagnostics.uiState.fixtureTools.rootReason,'missing');
    assert.equal(fixtureDiagnostics.uiState.fixtureTools.requestFailed,true);
    assert.ok(!JSON.stringify(fixtureDiagnostics).includes('fixture-private-canary'),'Fixture diagnostics must exclude arbitrary status fields and response bodies');
    await page.evaluate(() => {
      appdataCleanupPlusConfig.pluginVersion='2026.09.19.09';
      maintenance.state.scanToken='private-scan-token';
      maintenance.state.scanMetrics={startedAt:'2026-09-19T10:00:00Z',phases:[]};
      maintenance.state.rows=[{id:'private-row-id',name:'Private App',sourceKind:'filesystem',storageKind:'zfs',canDelete:true,mountEvidence:[],broadMountEvidence:[{name:'Private Viewer',paths:['/mnt/user']}]}];
      maintenance.exportDiagnostics();
      requests.at(-1).deferred.resolve({ok:true,bundle:{schemaVersion:5,runtime:{pluginVersion:'2026.09.19.10'},collection:{status:'complete'},currentSnapshot:{status:'expired'},state:{latestScanMetrics:{data:{startedAt:'2026-09-19T11:00:00Z',phases:[]}}}}});
    });
    const mismatch = await page.evaluate(async()=>JSON.parse(await downloadedBlob.text()));
    assert.equal(mismatch.freshness.versionMatch,'mismatch');
    assert.equal(mismatch.freshness.scanMatch,'mismatch');
    assert.equal(mismatch.freshness.currentSnapshot.status,'expired');
    assert.equal(mismatch.rows[0].decision.primaryBlocker,'none');
    assert.ok(mismatch.rows[0].decision.evidence.includes('broad_access'));
    assert.equal(mismatch.rows[0].decision.storage,'exact_dataset');
    assert.equal(mismatch.localization.locale,'en_US');
    assert.equal(mismatch.localization.viewport.width,1440);
    assert.ok(!JSON.stringify(mismatch).includes('private-scan-token'));
    await page.evaluate(() => {
      maintenance.startScanStatHydration(); // No pending sizes must retain scan evidence.
      maintenance.state.scanHydration={active:true,queue:[],requestToken:'finished'};
      maintenance.requestNextScanStatBatch('finished'); // Normal completion.
      maintenance.state.scanHydration.active=true;
      maintenance.pauseScanStatHydrationForUserRequest(); // User-request cancellation.
      maintenance.exportDiagnostics();
      requests.at(-1).deferred.resolve({ok:true,bundle:{schemaVersion:5,runtime:{pluginVersion:'2026.09.19.09'},collection:{status:'complete'},currentSnapshot:{status:'valid'},state:{latestScanMetrics:{data:{startedAt:'2026-09-19T06:00:00-04:00',phases:[]}}}}});
    });
    const hydrated = await page.evaluate(async()=>JSON.parse(await downloadedBlob.text()));
    assert.equal(hydrated.scan.metrics.startedAt,'2026-09-19T10:00:00Z','Stopping size hydration must preserve browser scan metrics');
    assert.equal(hydrated.freshness.scanMatch,'match','Freshness must compare retained scan evidence after hydration');
    await page.evaluate(() => {
      maintenance.installDiagnosticsErrorCapture();
      maintenance.installDiagnosticsErrorCapture();
      window.dispatchEvent(new ErrorEvent('error',{filename:'http://private-host/plugins/appdata.cleanup.plus/scripts/appdata.cleanup.plus.js',message:'Private JS secret',error:new TypeError('Private JS secret')}));
      for (let n=0;n<25;n++) maintenance.recordDiagnosticsFailure('private-action',503,'private-category',10);
      maintenance.exportDiagnostics();
      requests.at(-1).deferred.reject({status:503,responseText:'Private failure token=secret /mnt/user/Secret App',getResponseHeader:()=>null},'error');
    });
    const partial = await page.evaluate(async()=>JSON.parse(await downloadedBlob.text()));
    assert.equal(partial.collection.status,'partial');
    assert.equal(partial.collection.sections.server.status,'failed');
    assert.equal(partial.recentFailures.includedCount,20);
    assert.ok(partial.recentFailures.omittedCount>0);
    assert.equal(partial.recentFailures.data.at(-1).action,'getDiagnosticsBundle');
    assert.equal(partial.recentFailures.data.at(-1).httpStatus,503);
    assert.equal(partial.freshness.versionMatch,'unknown');
    assert.ok(!JSON.stringify(partial).includes('Private failure'), 'Partial exports must omit response bodies');
    assert.ok(!JSON.stringify(partial).includes('Private JS secret'));
    assert.ok(!JSON.stringify(partial).includes('private-action'));
    assert.ok(!JSON.stringify(partial).includes('private-host'));
    await page.evaluate(()=>{ maintenance.exportDiagnostics(); requests.at(-1).deferred.resolve({ok:false,message:'private-error'}); });
    const malformed = await page.evaluate(async()=>JSON.parse(await downloadedBlob.text()));
    assert.equal(malformed.collection.sections.server.category,'invalid_response');
    assert.ok(!JSON.stringify(malformed).includes('private-error'));
    await page.evaluate(() => {
      maintenance.state.auditHistoryLoaded=true;
      maintenance.state.auditHistoryHasMore=true;
      maintenance.exportDiagnostics();
      requests.at(-1).deferred.resolve({ok:true,bundle:{schemaVersion:5,runtime:{pluginVersion:'2026.09.19.09'},collection:{status:'partial',sections:{'log-1':{status:'partial'},'log-3':{status:'unavailable'},auditHistory:{status:'partial'}}},currentSnapshot:{status:'valid'},state:{latestScanMetrics:{data:{startedAt:'2026-09-19T10:00:00Z',phases:[]}}}}});
    });
    const limited = await page.evaluate(async()=>JSON.parse(await downloadedBlob.text()));
    assert.equal(limited.collection.status,'partial');
    assert.ok(!limited.troubleshooting.findings.some(f=>f.id==='collection'),'Normal history/log limits must not create a collection warning');
    await page.evaluate(() => {
      maintenance.exportDiagnostics();
      requests.at(-1).deferred.resolve({ok:true,bundle:{schemaVersion:5,collection:{status:'partial',sections:{runtime:{status:'failed'}}}}});
    });
    const failedCollector = await page.evaluate(async()=>JSON.parse(await downloadedBlob.text()));
    assert.ok(failedCollector.troubleshooting.findings.some(f=>f.id==='collection'),'Failed collectors still require attention');
    const refined = await page.evaluate(() => {
      const rows=[{id:'ok',path:'/fixture/ok',displayPath:'/fixture/ok',canDelete:true},{id:'retry',path:'/fixture/retry',displayPath:'/fixture/retry',canDelete:true}];
      const context=maintenance.buildOperationContext('delete',rows);
      const results=[{path:'/fixture/ok',status:'deleted'},{path:'/fixture/retry',status:'error',message:'Fixture error'}];
      const previewContext=maintenance.buildOperationContext('preview_delete',rows);
      const preview=maintenance.buildOperationResultsHtml({ready:2,blocked:1},[{status:'ready',path:'/fixture/folder'},{status:'ready',datasetName:'pool/fixture',path:'/fixture/zfs'},{status:'blocked',message:'Fixture protected',path:'/fixture/blocked'}],previewContext);
      const quarantinePreview=maintenance.buildOperationPreviewHtml(rows,maintenance.buildOperationContext('quarantine',rows),{});
      maintenance.state.rows=rows;
      maintenance.state.selected={ok:true,retry:true};
      maintenance.showOperationResultsFromResponse({summary:{deleted:1,errors:1},results,quarantineSummary:{count:0}},context);
      const selection=Object.keys(maintenance.state.selected);
      const resultHtml=document.querySelector('.sweet-alert').innerHTML;
      maintenance.state.quarantine.entries=[{id:'missing',restoreStatus:'missing'},{id:'conflict',restoreStatus:'conflict'}];
      maintenance.state.quarantine.selected={};
      maintenance.selectAllQuarantineEntries();
      const selectedQuarantine=maintenance.getSelectedQuarantineEntryIds();
      const quarantine=AppdataCleanupPlus.buildQuarantineManagerModalHtml({state:{quarantine:{entries:[{id:'missing',restoreStatus:'missing'},{id:'conflict',restoreStatus:'conflict'},{id:'ready',restoreStatus:'ready',recoveryOrigin:'marker'}],selected:{},summary:{count:3}},settings:{}},strings:{}});
      return {preview,quarantinePreview,selection,resultHtml,selectedQuarantine,quarantine};
    });
    assert.deepEqual(refined.selection,['retry'],'Partial cleanup must keep failed items selected and remove completed items');
    assert.deepEqual(refined.selectedQuarantine,['conflict'],'Missing quarantine records cannot be selected');
    assert.match(refined.preview,/Folders to permanently delete.*1/);
    assert.match(refined.preview,/Selected datasets to destroy.*1/);
    assert.match(refined.preview,/Items that will not be changed.*1/);
    assert.match(refined.preview,/Fixture protected/);
    assert.match(refined.quarantinePreview,/normally does not free space/);
    assert.match(refined.resultHtml,/data-result-group="failed"/);
    assert.match(refined.resultHtml,/data-result-group="completed"/);
    assert.match(refined.resultHtml,/Safety checks run again/);
    assert.match(refined.quarantine,/Missing from storage/);
    assert.match(refined.quarantine,/Restore destination conflict/);
    assert.match(refined.quarantine,/Recovered from an on-disk quarantine marker/);
    await page.evaluate(() => {
      maintenance.state.summary = {total:1234, safe:1234, blocked:0, deletable:1234};
      maintenance.renderSummaryCards();
    });
    assert.ok((await page.locator('.acp-summary-value').allTextContents()).includes('1,234'), 'Dashboard counts must use locale grouping');
    // Detection reasons use the scan evidence, with the same wording in Details.
    await page.evaluate(() => {
      const ACP = AppdataCleanupPlus;
      const rows = [
        {id:'discovery', sourceKind:'filesystem', canDelete:true},
        {id:'template', sourceKind:'template', canDelete:true},
        {id:'zfs', sourceKind:'filesystem', storageKind:'zfs', canDelete:true},
        {id:'incomplete', sourceKind:'filesystem', scanVerificationLocked:true, canDelete:false},
        {id:'ignored', sourceKind:'template', ignored:true, canDelete:true},
        {id:'zfs-template', sourceKind:'template', storageKind:'zfs', canDelete:true},
        {id:'zfs-incomplete', sourceKind:'filesystem', storageKind:'zfs', scanVerificationLocked:true, canDelete:false},
        {id:'zfs-mounted', sourceKind:'filesystem', storageKind:'zfs', mountEvidence:[{name:'Owner',paths:['/mnt/pool/appdata/example']}], canDelete:false},
        {id:'mapping-only', sourceKind:'filesystem', storageKind:'filesystem', zfsMappingMatched:true, canDelete:true}
      ];
      maintenance.state.rows = rows;
      maintenance.renderResults();
      window.reasonCases = rows.map(row => ({
        reason: ACP.getRowDetectionReason(row),
        details: ACP.buildRowDetailsModalHtml({strings:appdataCleanupPlusConfig.strings,state:maintenance.state}, row)
      }));
    });
    const reasons = await page.evaluate(() => reasonCases);
    assert.equal(reasons[0].reason, 'Appdata folder with no installed container mount or saved template reference.');
    assert.equal(reasons[1].reason, 'A saved template references this folder; no installed container mounts it.');
    assert.equal(reasons[2].reason, 'Exact ZFS dataset with no installed container mount or saved template reference.');
    assert.match(reasons[3].reason, /Folder ownership is unverified/);
    assert.equal(reasons[4].reason, reasons[1].reason, 'Ignoring a row must not change detection evidence');
    assert.equal(reasons[5].reason, 'A saved template references this ZFS dataset; no installed container mounts it.');
    assert.match(reasons[6].reason, /ZFS dataset ownership is unverified/);
    assert.match(reasons[7].reason, /mounts this ZFS dataset or a related path/);
    assert.match(reasons[8].reason, /ZFS mapping has no exact dataset match; treated as a folder/);
    assert.ok(!reasons[8].reason.includes('Exact ZFS dataset'), 'A mapping alone must not establish dataset identity');
    for (const entry of reasons) assert.ok(entry.details.includes(entry.reason), 'Details and column must share wording');
    for (const headings of await page.locator('.acp-results-table-head').allTextContents()) assert.match(headings, /SourceDetection reasonActions/);
    assert.ok(await page.locator('.acp-row-badges + .acp-row-detection-reason + .acp-row-side').count());
    // Broad access belongs in Details, while the candidate stays selectable.
    await page.evaluate(()=>{
      const row = {id:'mount',name:'Example',path:'/mnt/user/appdata/example',displayPath:'/mnt/user/appdata/example',canDelete:true,mountEvidence:[],broadMountEvidence:[{name:'Viewer',paths:['/mnt/user']}]};
      maintenance.state.rows=[row];
      document.querySelector('#acp-results').innerHTML=maintenance.buildRowHtml(row);
      document.querySelector('.sweet-alert').style.display='none';
      document.querySelector('.sweet-alert').classList.remove('showSweetAlert');
      AppdataCleanupPlus.releaseModalScrollLock(false);
    });
    assert.equal(await page.locator('#acp-results .acp-mount-evidence').count(),0,'Broad access must not clutter the Source column');
    assert.ok(!(await page.locator('.acp-row-detection-reason').textContent()).includes('Broad container access'), 'Broad access explanation stays in Details');
    const details=await page.evaluate(()=>AppdataCleanupPlus.buildRowDetailsModalHtml({strings:appdataCleanupPlusConfig.strings,state:maintenance.state},maintenance.state.rows[0]));
    assert.match(details,/Broad container access/);
    assert.match(details,/does not block cleanup/);
    assert.equal(await page.locator('.acp-row-checkbox').isDisabled(),false,'Broad access must leave the candidate selectable');
    assert.equal(await page.locator('.acp-row-checkbox').isChecked(),false);
    await page.locator('.acp-row-checkbox').check();
    assert.equal(await page.locator('.acp-row-checkbox').isChecked(),true,'The actual selection handler must accept a broadly accessible row');
    // Specific mount blockers still disclose safely with mouse and keyboard.
    await page.evaluate(()=>{
      const row={...maintenance.state.rows[0],id:'specific',canDelete:false,mountEvidence:[{name:'Owner',paths:['/mnt/user/appdata/example']}],broadMountEvidence:[]};
      maintenance.state.rows=[row];
      document.querySelector('#acp-results').innerHTML=maintenance.buildRowHtml(row);
    });
    await page.locator('.acp-mount-evidence summary').click();
    assert.match(await page.locator('.acp-row-detection-reason').textContent(), /cleanup is blocked even if stopped/);
    assert.match(await page.locator('.acp-mount-evidence').textContent(),/Specific container mounts/);
    assert.equal(await page.locator('.acp-row-checkbox').isChecked(),false);
    assert.equal(await page.locator('.acp-row-checkbox').isDisabled(),true);
    await page.locator('.acp-mount-evidence summary').press('Escape');
    assert.equal(await page.locator('.acp-mount-evidence').evaluate(el=>el.open),false);
    await page.evaluate(()=>{
      maintenance.state.scanVerification='incomplete';
      maintenance.state.scanWarningMessage='Ownership verification is incomplete.';
      maintenance.state.settings.enablePermanentDelete=true;
      maintenance.state.rows=[];
      maintenance.state.summary={total:0};
      maintenance.renderSummaryCards();
      maintenance.renderResults();
    });
    assert.match(await page.locator('#acp-app').textContent(),/Ownership check incomplete/);
    assert.ok(!(await page.locator('#acp-results').textContent()).includes('No orphaned appdata found'),'Incomplete empty results must not look like a successful clean scan');
    const locked=await page.evaluate(()=>maintenance.applyLocalSafetyStateToRow({id:'unverified',scanVerificationLocked:true,canDelete:true,policyReason:'Ownership verification is incomplete.'}));
    assert.equal(locked.canDelete,false);
    assert.equal(locked.policyLocked,true);
    assert.deepEqual(errors,[]);
    console.log('maintenance_ui: OK (confirm/cancel, server IDs, archive refresh, restore collision, mount disclosure keyboard and selection)');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
