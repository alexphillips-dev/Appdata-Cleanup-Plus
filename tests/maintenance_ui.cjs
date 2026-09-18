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
    await page.locator('[data-action="review-templates"]').click();
    assert.equal(await page.evaluate(()=>requests.at(-1).options.data.managerAction),'status');
    await page.evaluate(()=>requests.at(-1).deferred.resolve({ok:true,templateManager:{templates:[{id:'server-template-id',name:'Saved app',filename:'saved.xml'}],backups:[]}}));
    await page.locator('[data-action="archive-template"]').click();
    assert.match(await page.locator('.sweet-alert h2').textContent(),/Archive/);
    await page.evaluate(()=>confirmCallback(false));
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
    // Mouse and keyboard disclosure use must not select a cleanup row.
    await page.evaluate(()=>{
      const row = {id:'mount',name:'Example',path:'/mnt/user/appdata/example',displayPath:'/mnt/user/appdata/example',canDelete:true,mountEvidence:[{name:'Owner',paths:['/mnt/user/appdata']}]};
      maintenance.state.rows=[row];
      document.querySelector('#acp-results').innerHTML=maintenance.buildRowHtml(row);
      document.querySelector('.sweet-alert').style.display='none';
      document.querySelector('.sweet-alert').classList.remove('showSweetAlert');
      AppdataCleanupPlus.releaseModalScrollLock(false);
    });
    await page.locator('.acp-mount-evidence summary').evaluate(el=>el.scrollIntoView({block:'center'}));
    await page.locator('.acp-mount-evidence summary').click();
    assert.equal(await page.locator('.acp-row-checkbox').isChecked(),false);
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
