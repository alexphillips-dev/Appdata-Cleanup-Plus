// Maintainer-only, synthetic review packets; no live host or container data.
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {setFixtureContent} = require('./browser_fixture.cjs');
const modules = process.env.ACP_BROWSER_MODULES;
const dependency = name => modules ? path.join(modules, name) : name;
const {chromium} = require(dependency('playwright'));
const plugin = path.resolve(__dirname, '../source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus');
const locales = JSON.parse(fs.readFileSync(path.join(plugin, 'locales/locales.json'), 'utf8'));
const locale = process.argv[2];
const output = process.argv[3];
if (!locales[locale] || !output) throw Error('Expected a supported locale and output directory');
(async () => {
  const css = (await Promise.all(['default-color-palette.css','default-base.css','jquery.sweetalert.css','default-dynamix.css','themes/black.css'].map(async file => {
    if (process.env.ACP_NATIVE_THEME_DIR) return fs.readFileSync(path.join(process.env.ACP_NATIVE_THEME_DIR, '7.3', file.replace('/', '-')), 'utf8');
    const response = await fetch(`https://raw.githubusercontent.com/unraid/webgui/41e8d5ad5db20b0e9aeea4334b39bea56729579a/emhttp/plugins/dynamix/styles/${file}`, {signal:AbortSignal.timeout(30000)});
    if (!response.ok) throw Error('Pinned Unraid stylesheet unavailable');
    return response.text();
  }))).join('\n');
  const browser = await chromium.launch({headless:true});
  try {
    for (const [size, width] of [['desktop',1280],['mobile',390]]) {
      const page = await browser.newPage({viewport:{width,height:1000}});
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await setFixtureContent(page, execFileSync('php', [path.join(__dirname,'render_i18n_page.php'),locale], {encoding:'utf8',maxBuffer:4e6}));
      await page.addStyleTag({content:css+'\nbody{font-family:Arial,sans-serif}'});
      await page.addStyleTag({path:path.join(plugin,'styles/appdata.cleanup.plus.css')});
      await page.addScriptTag({path:require.resolve(dependency('jquery/dist/jquery.js'))});
      await page.evaluate(() => {
        window.swal = (options, callback) => {
          let host = document.querySelector('.sweet-alert');
          if (!host) { host = document.createElement('div'); document.body.appendChild(host); }
          host.className='sweet-alert showSweetAlert'; host.style.display='block';
          host.innerHTML='<h2></h2><p></p><div class="sa-button-container"><button class="cancel"></button><button class="confirm"></button></div>';
          host.querySelector('h2').textContent=options.title || '';
          host.querySelector('.confirm').textContent=options.confirmButtonText || AppdataCleanupPlus.tr('OK');
          host.querySelector('.cancel').textContent=AppdataCleanupPlus.tr('Cancel');
          host.querySelector('.cancel').style.display=options.showCancelButton ? '' : 'none';
          window.confirmCallback=callback;
        };
        $.ajax=()=>$.Deferred().resolve({ok:true,progress:{id:'synthetic-operation',operation:'quarantine',status:'interrupted',completedRoots:1,message:AppdataCleanupPlus.tr('The operation stopped before its final result was recorded. Review recorded results and audit history, then rescan before taking further action.'),results:[]}}).promise();
      });
      for (const file of ['appdata.cleanup.plus.shared.js','appdata.cleanup.plus.panels.js']) await page.addScriptTag({path:path.join(plugin,'scripts',file)});
      const main=fs.readFileSync(path.join(plugin,'scripts/appdata.cleanup.plus.js'),'utf8');
      await page.addScriptTag({content:main.replace('$(init);','window.reviewFlows={state,cacheElements,renderAll,buildOperationContext,buildOperationPreviewHtml,buildQuarantineActionConfirmHtml,buildRestoreConflictDialogHtml,buildDeleteConfirmationHtml,openRecoveredOperation};')});
      await page.evaluate(() => {
        const F=reviewFlows; F.cacheElements();
        F.state.rows=[{id:'synthetic-row',name:'Example app',path:'/mnt/user/appdata/example',displayPath:'/mnt/user/appdata/example',sourceKind:'filesystem',sourceNames:[],targetPaths:[],templateRefs:[],canDelete:true,storageKind:'filesystem',risk:'safe',status:'orphaned',sizeLabel:'1 MB'}];
        F.state.summary={total:1,safe:1,review:0,blocked:0,deletable:1,ignored:0}; F.renderAll();
      });
      for (const screen of ['dashboard','quarantine','delete','purge','restore-conflicts','recovery','backups']) {
        await page.evaluate(screen => {
          const F=reviewFlows, ACP=AppdataCleanupPlus;
          const host=document.querySelector('.sweet-alert');
          if (host) { host.style.display='none';host.classList.remove('showSweetAlert');ACP.releaseModalScrollLock(false); }
          if (screen==='dashboard') return;
          if (screen==='recovery') { F.openRecoveredOperation('synthetic-operation'); return; }
          let content='',title='';
          if (screen==='delete' || screen==='quarantine') {
            const context=F.buildOperationContext(screen==='delete' ? 'delete' : 'quarantine',F.state.rows);
            title=context.confirmTitle; content=F.buildOperationPreviewHtml(F.state.rows,context,{showConfirmationCheckbox:screen==='delete'});
          } else if (screen==='purge') { title=ACP.tr('Purge selected quarantined folders?');content=F.buildQuarantineActionConfirmHtml([{sourcePath:'/mnt/user/appdata/example'}],'purge'); }
          else if (screen==='restore-conflicts') { title=ACP.tr('Restore conflicts found');content=F.buildRestoreConflictDialogHtml({summary:{ready:0,conflicts:1},conflicts:[{id:'synthetic-entry',sourcePath:'/mnt/user/appdata/example',parentPath:'/mnt/user/appdata',suggestedName:'example-restored'}]}); }
          else {
            title=ACP.tr('Review templates and backups');
            content=ACP.buildTemplateManagerModalHtml({state:{templateManager:{status:{templates:[],backups:[{id:'synthetic-backup',name:'Example app',filename:'my-example.xml',canRestore:true}]}}}});
            content+='<p>'+ACP.escapeHtml(ACP.tr('This permanently removes the listed recovery backups. Export them first if needed. Saved templates and appdata will not change.'))+'</p>'+F.buildDeleteConfirmationHtml(ACP.tr('I understand these template backups will be permanently removed.'));
          }
          swal({title,text:'',showCancelButton:true,confirmButtonText:ACP.tr('OK')});
          ACP.applyDeleteModalClass('acp-delete-modal acp-delete-results-modal',content);
        }, screen);
        const locator=screen==='dashboard' ? page.locator('#acp-app') : page.locator('.sweet-alert');
        await locator.screenshot({path:path.join(output,`${screen}-${size}.png`)});
      }
      if (errors.length) throw Error(errors.join('\n'));
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
