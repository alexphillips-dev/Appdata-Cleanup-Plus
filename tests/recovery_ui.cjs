const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {setFixtureContent} = require('./browser_fixture.cjs');
const modules = process.env.ACP_BROWSER_MODULES;
const dependency = name => modules ? path.join(modules, name) : name;
const {chromium} = require(dependency('playwright'));
const plugin = path.resolve(__dirname, '../source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus');
const locales = JSON.parse(fs.readFileSync(path.join(plugin,'locales/locales.json'),'utf8'));
(async () => {
  const nativeCss=(await Promise.all(['default-color-palette.css','default-base.css','jquery.sweetalert.css','default-dynamix.css','themes/black.css'].map(async file=>{
    if(process.env.ACP_NATIVE_THEME_DIR)return fs.readFileSync(path.join(process.env.ACP_NATIVE_THEME_DIR,'7.3',file.replace('/','-')),'utf8');
    const response=await fetch(`https://raw.githubusercontent.com/unraid/webgui/41e8d5ad5db20b0e9aeea4334b39bea56729579a/emhttp/plugins/dynamix/styles/${file}`,{signal:AbortSignal.timeout(30000)});
    assert.ok(response.ok,'Pinned Unraid stylesheet unavailable');return response.text();
  }))).join('\n');
  const browser=await chromium.launch({headless:true});
  try {
    for (const locale of Object.keys(locales)) for (const width of [1280,390]) {
      const page=await browser.newPage({viewport:{width,height:950}});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await setFixtureContent(page,execFileSync('php',[path.join(__dirname,'render_i18n_page.php'),locale],{encoding:'utf8',maxBuffer:4e6}));
      await page.addStyleTag({content:nativeCss+'\nbody{font-family:Arial,sans-serif}'});
      await page.addStyleTag({path:path.join(plugin,'styles/appdata.cleanup.plus.css')});
      await page.addScriptTag({path:require.resolve(dependency('jquery/dist/jquery.js'))});
      await page.evaluate(()=>{
        window.requests=[];
        $.ajax=options=>{const deferred=$.Deferred();requests.push({options,deferred});return deferred.promise();};
        window.swal=(options,callback)=>{
          let host=document.querySelector('.sweet-alert');
          if (!host) {host=document.createElement('div');document.body.appendChild(host);}
          host.className='sweet-alert showSweetAlert';host.style.display='block';
          host.innerHTML='<h2></h2><p></p><div class="sa-button-container"><button class="cancel"></button><button class="confirm"></button></div>';
          host.querySelector('h2').textContent=options.title || '';
          host.querySelector('.cancel').textContent=options.cancelButtonText || '';
          host.querySelector('.confirm').textContent=options.confirmButtonText || '';
          host.querySelector('.cancel').style.display=options.showCancelButton ? '' : 'none';
          window.confirmCallback=callback;
        };
        swal.close=()=>{const host=document.querySelector('.sweet-alert');if(host){host.style.display='none';host.classList.remove('showSweetAlert');}};
        URL.createObjectURL=blob=>{window.downloadedBlob=blob;return 'blob:private-backup-fixture';};URL.revokeObjectURL=()=>{};
        document.addEventListener('click',e=>{if(e.target.tagName==='A' && e.target.download){window.downloadedFilename=e.target.download;e.preventDefault();}},true);
      });
      for(const file of ['appdata.cleanup.plus.shared.js','appdata.cleanup.plus.panels.js'])await page.addScriptTag({path:path.join(plugin,'scripts',file)});
      const main=fs.readFileSync(path.join(plugin,'scripts/appdata.cleanup.plus.js'),'utf8');
      const hook='window.recoveryTest={state,loadRecentOperations,openRecoveredOperation,loadRecoveredOperation,runCandidateOperation,runQuarantineManagerAction,runTemplateManagerAction,ensureTemplateManagerModal,renderTemplateManagerModal,buildDiagnosticsPayload,pollOperationProgress,stopOperationProgressPolling,startOperationProgressModal,buildOperationContext};cacheElements();bindEvents();loadScan=function(){};loadAuditHistory=function(){};loadQuarantineSummary=function(){};';
      await page.addScriptTag({content:main.replace('$(init);',hook)});
      await page.evaluate(()=>recoveryTest.loadRecentOperations());
      await page.evaluate(()=>requests.at(-1).deferred.resolve({ok:true,operations:[{id:'server-operation',operation:'quarantine',status:'interrupted',message:AppdataCleanupPlus.tr('Recorded results may be incomplete. Check audit history and rescan before taking further action.')}]}));
      await page.locator('[data-action="review-recent-operation"]').click();
      assert.equal(await page.evaluate(()=>requests.at(-1).options.data.action),'getOperationProgress');
      await page.evaluate(()=>requests.at(-1).deferred.resolve({ok:true,progress:{id:'server-operation',operation:'quarantine',status:'interrupted',completedRoots:24,results:Array.from({length:24},()=>({path:'<img src=x onerror=alert(1)>',status:'quarantined',message:'<script>bad</script>'}))}}));
      assert.equal(await page.locator('.acp-operation-recovery-modal img, .acp-operation-recovery-modal script').count(),0,'Recovered results remain escaped');
      const recoveryGeometry=await page.locator('.acp-operation-recovery-modal').evaluate(node=>{const host=node.querySelector('.acp-modal-host'),footer=node.querySelector('.sa-button-container').getBoundingClientRect();return {scroll:getComputedStyle(host).overflowY,inner:host.scrollHeight>host.clientHeight,footer:footer.top>=0 && footer.bottom<=innerHeight};});
      assert.equal(recoveryGeometry.scroll,'auto');assert.equal(recoveryGeometry.inner,true);assert.equal(recoveryGeometry.footer,true,'Long recovery results keep the Close control reachable');
      assert.equal(await page.locator('[data-action="dismiss-operation"]').count(),1);
      await page.locator('[data-action="dismiss-operation"]').click();
      assert.equal(await page.evaluate(()=>requests.at(-1).options.data.action),'acknowledgeOperation');
      await page.evaluate(()=>{requests.at(-1).deferred.resolve({ok:true});requests.at(-1).deferred.resolve({ok:true,operations:[]});});
      assert.equal(await page.locator('[data-action="review-recent-operation"]').count(),0,'Dismissal hides the reminder');
      // Real candidate request failure switches to status queries, never a replay.
      await page.evaluate(()=>recoveryTest.runCandidateOperation([{id:'server-candidate',path:'/mnt/user/appdata/example',displayPath:'/mnt/user/appdata/example',storageKind:'filesystem'}],'quarantine'));
      await page.evaluate(()=>{window.actionId=requests.at(-1).options.data.operationProgressId;requests.at(-1).deferred.reject({status:0});});
      assert.equal(await page.evaluate(()=>requests.filter(r=>r.options.data.action==='executeCandidateAction').length),1);
      const progressRequest=await page.evaluate(()=>requests.findLastIndex(r=>r.options.data.action==='getOperationProgress'));
      await page.evaluate(i=>requests[i].deferred.resolve({ok:true,progress:{operation:'quarantine',status:'complete',completedRoots:1,results:[],summary:{quarantined:1}}}),progressRequest);
      assert.equal(await page.locator('[data-action="dismiss-operation"]').count(),1,'A lost final response can recover terminal status');
      await page.evaluate(()=>{recoveryTest.openRecoveredOperation('never-recorded');recoveryTest.state.recovery.openedAt=Date.now()-20000;requests.at(-1).deferred.resolve({ok:true,progress:{status:'missing'}});});
      assert.equal(await page.locator('[data-action="dismiss-operation"]').count(),0,'Missing operations cannot manufacture an acknowledgement record');
      assert.equal(await page.evaluate(()=>recoveryTest.state.recovery.terminal),true,'Missing records stop polling after a bounded grace period');
      // Late polling cannot replace another modal.
      await page.evaluate(()=>{recoveryTest.openRecoveredOperation('old-operation');window.oldRequest=requests.at(-1);document.querySelector('.sweet-alert h2').textContent='Other modal';AppdataCleanupPlus.applyDeleteModalClass('acp-delete-modal acp-delete-results-modal acp-tools-modal','<p>Other modal</p>');});
      await page.evaluate(()=>oldRequest.deferred.resolve({ok:true,progress:{status:'interrupted'}}));
      assert.equal(await page.locator('.sweet-alert h2').textContent(),'Other modal');
      assert.equal(await page.locator('.acp-operation-recovery-modal').count(),0,'Modal reuse removes recovery identity');
      // A pending immediate-delete status request must not reclaim a newer dialog.
      await page.evaluate(()=>{
        const rows=[{id:'delete-fixture',path:'/mnt/user/appdata/fixture',displayPath:'/mnt/user/appdata/fixture',storageKind:'filesystem'}];
        window.deleteContext=recoveryTest.buildOperationContext('delete',rows);
        deleteContext.rows=rows;
        recoveryTest.runCandidateOperation(rows,'delete');recoveryTest.stopOperationProgressPolling();
        window.deleteAction=requests.findLast(r=>r.options.data.action==='executeCandidateAction');
        window.deleteId=deleteAction.options.data.operationProgressId;
        recoveryTest.pollOperationProgress(deleteId,deleteContext);
        requests.at(-1).deferred.resolve({ok:true,progress:{id:deleteId,status:'running',completedRoots:1,totalRoots:2,message:'Current progress'}});
        recoveryTest.stopOperationProgressPolling();
      });
      assert.equal(await page.evaluate(()=>recoveryTest.state.operationProgress.latest.completedRoots),1,'Current delete progress still renders');
      await page.evaluate(()=>{
        recoveryTest.pollOperationProgress(deleteId,deleteContext);window.lateDeletePoll=requests.at(-1);
        recoveryTest.pollOperationProgress(deleteId,deleteContext);window.lateDeleteFailure=requests.at(-1);
        deleteAction.deferred.reject({status:0});
        window.recoveryRequest=requests.findLast(r=>r.options.data.action==='getOperationProgress');
        lateDeletePoll.deferred.resolve({ok:true,progress:{id:deleteId,status:'running',message:'Stale progress'}});
      });
      assert.equal(await page.locator('.acp-operation-recovery-modal').count(),1,'Late delete progress cannot replace Recovery after connection loss');
      assert.equal(await page.locator('.sweet-alert button.confirm').isDisabled(),false,'Recovery Close remains usable');
      await page.evaluate(()=>{lateDeleteFailure.deferred.reject({status:0});});
      assert.equal(await page.evaluate(()=>recoveryTest.state.operationProgress.pollTimer),null,'Stale failures cannot restart delete polling');
      await page.evaluate(()=>{recoveryRequest.deferred.resolve({ok:true,progress:{id:deleteId,operation:'delete',status:'complete',completedRoots:1,results:[],summary:{deleted:1}}});});
      assert.equal(await page.locator('[data-action="dismiss-operation"]').count(),1,'Recovery can still show the finished delete');
      assert.equal(await page.evaluate(()=>requests.filter(r=>r.options.data.action==='executeCandidateAction' && r.options.data.operationProgressId===deleteId).length),1,'Connection loss never replays deletion');
      await page.evaluate(()=>{
        recoveryTest.runCandidateOperation(deleteContext.rows,'delete');recoveryTest.stopOperationProgressPolling();
        window.completedDeleteAction=requests.findLast(r=>r.options.data.action==='executeCandidateAction');
        window.completedDeleteId=completedDeleteAction.options.data.operationProgressId;
        recoveryTest.pollOperationProgress(completedDeleteId,deleteContext);window.completedDeletePoll=requests.at(-1);
        completedDeleteAction.deferred.resolve({ok:true,summary:{deleted:1},results:[]});
        window.completedProgress=recoveryTest.state.operationProgress.latest;
        completedDeletePoll.deferred.resolve({ok:true,progress:{status:'running',message:'Old running result'}});
      });
      assert.equal(await page.evaluate(()=>recoveryTest.state.operationProgress.latest===completedProgress),true,'Old polling cannot overwrite completed progress');
      assert.equal(await page.locator('.acp-delete-progress-ready button.confirm').isDisabled(),false);
      await page.evaluate(()=>{
        recoveryTest.startOperationProgressModal('old-delete',deleteContext);recoveryTest.stopOperationProgressPolling();
        recoveryTest.pollOperationProgress('old-delete',deleteContext);window.previousDeletePoll=requests.at(-1);
        recoveryTest.startOperationProgressModal('new-delete',deleteContext);recoveryTest.stopOperationProgressPolling();
        previousDeletePoll.deferred.resolve({ok:true,progress:{id:'old-delete',message:'Old operation'}});
      });
      assert.equal(await page.evaluate(()=>recoveryTest.state.operationProgress.latest.id),'new-delete','A previous operation cannot replace current progress');
      await page.evaluate(()=>{
        recoveryTest.pollOperationProgress('new-delete',deleteContext);window.reusedDeletePoll=requests.at(-1);
        AppdataCleanupPlus.applyDeleteModalClass('acp-delete-modal acp-tools-modal','<p>Replacement dialog</p>');
        reusedDeletePoll.deferred.resolve({ok:true,progress:{id:'new-delete',message:'Old dialog'}});
        recoveryTest.stopOperationProgressPolling();
      });
      assert.equal(await page.locator('.acp-tools-modal').count(),1,'Delete polling respects a replacement dialog even with the same operation ID');
      await page.evaluate(()=>{recoveryTest.state.operationProgress.activeId='';recoveryTest.state.operationProgress.pendingResult=null;});
      await page.evaluate(()=>{
        recoveryTest.state.templateManager={loading:false,message:'',status:{templates:[],backups:[{id:'server-backup',name:'Example app',filename:'my-example.xml',canRestore:true}]}};
        recoveryTest.ensureTemplateManagerModal();recoveryTest.renderTemplateManagerModal();
      });
      const overflowing = await page.locator('.acp-template-manager-modal').evaluate(node=>node.scrollWidth > node.clientWidth + 2);
      assert.equal(overflowing,false,`${locale} ${width}: backup controls must fit the modal`);
      assert.equal(await page.locator('.acp-template-list').evaluate(node=>node.scrollWidth > node.clientWidth + 2),false,`${locale} ${width}: backup actions cannot require horizontal scrolling`);
      await page.locator('[data-action="export-template-backups"]').first().click();
      assert.deepEqual(await page.evaluate(()=>JSON.parse(requests.at(-1).options.data.backupIds)),['server-backup']);
      await page.evaluate(()=>requests.at(-1).deferred.resolve({ok:true,backupArchive:{format:'appdata-cleanup-plus-template-backups',schemaVersion:1,backups:[{contents:'private-export-canary',timestampLabel:'literal-private-value'}]}}));
      assert.equal(await page.evaluate(()=>downloadedFilename),'appdata-cleanup-plus-private-template-backups.json');
      assert.match(await page.evaluate(async()=>downloadedBlob.text()),/private-export-canary/,'Private backup export intentionally preserves configuration');
      assert.ok(!await page.evaluate(()=>JSON.stringify(recoveryTest.buildDiagnosticsPayload()).includes('private-export-canary')),'Diagnostics must not retain private export responses');
      const unchanged=await page.evaluate(()=>{const data={backupArchive:{timestampLabel:'do not format',lastModifiedLabel:'do not translate',contents:'private'}};const before=JSON.stringify(data);return JSON.stringify(AppdataCleanupPlus.localizePresentation(data))===before;});
      assert.ok(unchanged,'Private archive is outside localization');
      await page.locator('[data-action="remove-template-backups"]').first().click();
      await page.evaluate(()=>confirmCallback(true));
      assert.equal(await page.locator('.acp-delete-confirm-checkbox').count(),1,'Unchecked backup removal stays in confirmation');
      assert.equal(await page.evaluate(()=>requests.filter(r=>r.options.data.managerAction==='remove-backups').length),0);
      await page.locator('.acp-delete-confirm-checkbox').check();await page.evaluate(()=>confirmCallback(true));
      assert.equal(await page.evaluate(()=>requests.at(-1).options.data.backupRemovalConfirmed),'yes');
      assert.deepEqual(await page.evaluate(()=>JSON.parse(requests.at(-1).options.data.backupIds)),['server-backup']);
      await page.evaluate(()=>requests.at(-1).deferred.resolve({ok:true,templateManager:{templates:[],backups:[]}}));
      assert.equal(await page.locator('[data-action="export-template-backups"]').isDisabled(),true);
      await page.locator('#acp-template-backup-file').setInputFiles({name:'private-backups.json',mimeType:'application/json',buffer:Buffer.from('{"fixture":"private-import-canary"}')});
      await page.waitForFunction(()=>requests.at(-1).options.data.managerAction==='import');
      assert.match(await page.evaluate(()=>requests.at(-1).options.data.backupJson),/private-import-canary/);
      await page.evaluate(()=>{requests.at(-1).deferred.reject({status:409,responseJSON:{message:AppdataCleanupPlus.tr('Backup import was refused. Check the file format, integrity, and size limits.')}});});
      assert.ok(!await page.evaluate(()=>JSON.stringify(recoveryTest.buildDiagnosticsPayload()).includes('private-import-canary')),'Import errors cannot leak private contents into diagnostics');
      // More than 50 records stay accessible through bounded selection groups.
      for (const count of [50,51,101]) {
        await page.evaluate(count=>{
          recoveryTest.state.templateManager={loading:false,message:'',selected:null,status:{templates:[],backups:Array.from({length:count},(_,i)=>({id:'batch-'+i,name:'Fixture '+i,filename:'my-fixture-'+i+'.xml',canRestore:true}))}};
          recoveryTest.ensureTemplateManagerModal();recoveryTest.renderTemplateManagerModal();
        },count);
        assert.equal(await page.locator('[data-action="select-template-backup"]:checked').count(),50);
        await page.locator('[data-action="export-template-backups"]').first().click();
        assert.deepEqual(await page.evaluate(()=>JSON.parse(requests.at(-1).options.data.backupIds)),Array.from({length:50},(_,i)=>'batch-'+i));
        await page.evaluate(()=>requests.at(-1).deferred.resolve({ok:true,backupArchive:{format:'appdata-cleanup-plus-template-backups',schemaVersion:1,backups:[]}}));
        if(count>50) {
          await page.locator('[data-action="select-template-backup"][data-backup-id="batch-50"]').evaluate(node=>{node.checked=true;node.dispatchEvent(new Event('change',{bubbles:true}));});
          assert.equal(await page.locator('[data-action="select-template-backup"]:checked').count(),50,'Checking a 51st record cannot exceed the limit');
          assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('data-backup-id')),'batch-50','Selection redraw preserves keyboard focus');
          if(count===101) {
            await page.locator('[data-action="select-template-backup-batch"]').selectOption('50');
            await page.locator('[data-action="export-template-backups"]').first().click();
            assert.deepEqual(await page.evaluate(()=>JSON.parse(requests.at(-1).options.data.backupIds)),Array.from({length:50},(_,i)=>'batch-'+(i+50)),'Middle groups retain every backup ID');
            await page.evaluate(()=>requests.at(-1).deferred.resolve({ok:true,backupArchive:{format:'appdata-cleanup-plus-template-backups',schemaVersion:1,backups:[]}}));
          }
          const start=count===51?50:100;
          await page.locator('[data-action="select-template-backup-batch"]').selectOption(String(start));
          assert.equal(await page.locator('[data-action="select-template-backup"]:checked').count(),1,'Final group remains reachable');
          await page.locator('[data-action="export-template-backups"]').first().click();
          assert.deepEqual(await page.evaluate(()=>JSON.parse(requests.at(-1).options.data.backupIds)),['batch-'+start]);
          await page.evaluate(()=>requests.at(-1).deferred.resolve({ok:true,backupArchive:{format:'appdata-cleanup-plus-template-backups',schemaVersion:1,backups:[]}}));
          await page.locator('[data-action="remove-template-backups"]').first().click();
          assert.equal(await page.locator('.acp-modal-host li').count(),1,'Removal confirmation lists only selected backups');
          await page.locator('.acp-delete-confirm-checkbox').check();await page.evaluate(()=>confirmCallback(true));
          assert.deepEqual(await page.evaluate(()=>JSON.parse(requests.at(-1).options.data.backupIds)),['batch-'+start]);
          await page.evaluate(()=>{requests.at(-1).deferred.reject({status:409,responseJSON:{message:'Fixture refused'}});});
        }
        await page.locator('[data-action="clear-template-backup-selection"]').click();
        assert.equal(await page.locator('[data-action="export-template-backups"]').first().isDisabled(),true,'Empty bulk selection cannot accidentally export all backups');
        assert.equal(await page.locator('[data-action="remove-template-backups"]').first().isDisabled(),true);
        await page.locator('[data-action="export-template-backups"][data-backup-id="batch-0"]').click();
        assert.deepEqual(await page.evaluate(()=>JSON.parse(requests.at(-1).options.data.backupIds)),['batch-0'],'Individual actions remain available');
        await page.evaluate(()=>requests.at(-1).deferred.resolve({ok:true,backupArchive:{format:'appdata-cleanup-plus-template-backups',schemaVersion:1,backups:[]}}));
        assert.equal(await page.locator('.acp-template-manager-modal').evaluate(node=>node.scrollWidth>node.clientWidth+2),false,`${locale} ${width}: bounded backup controls fit`);
      }
      assert.deepEqual(errors,[],`${locale} ${width}: browser errors`);
      await page.close();
    }
    console.log('recovery_ui: OK (42 locales, desktop/mobile recovery, lost responses, no replay, stale callbacks, private export/import, removal confirmation and diagnostics separation)');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
