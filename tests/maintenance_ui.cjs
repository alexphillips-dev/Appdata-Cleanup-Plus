// Optional browser regression: shipped event handlers with a synthetic server.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
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
    const html = execFileSync('php', [path.join(__dirname,'render_i18n_page.php'),'en_US'], {encoding:'utf8',maxBuffer:4e6}).replace(/<script src="[^"]*"><\/script>/g,'').replace(/<link[^>]+>/g,'');
    await page.setContent(html);
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
    const hook = 'window.maintenance={state,openToolsModal,renderToolsModal,buildRowHtml,renderSummaryCards,renderResults,applyLocalSafetyStateToRow}; cacheElements(); bindEvents(); loadScan=function(){window.scanRefreshes=(window.scanRefreshes||0)+1;}; state.fixtureTools.status={};';
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
    await page.evaluate(()=>requests.at(-1).deferred.resolve({ok:true,bundle:{schemaVersion:4}}));
    assert.match(await page.evaluate(()=>downloadedFilename),/^appdata-cleanup-plus-diagnostics-.*\.json$/);
    assert.equal(await page.evaluate(async()=>JSON.parse(await downloadedBlob.text()).schemaVersion),4);
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
