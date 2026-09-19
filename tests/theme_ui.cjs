// Browser contract against pinned, official Unraid 7.0 and 7.3 stylesheets.
// These test-only dependencies and reference styles are never packaged.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {setFixtureContent} = require('./browser_fixture.cjs');
const dependency = name => process.env.ACP_BROWSER_MODULES ? path.join(process.env.ACP_BROWSER_MODULES, name) : name;
const {chromium} = require(dependency('playwright'));
const plugin = path.resolve(__dirname, '../source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus');
const refs = {'7.0':'25bc9e2d16525e4e4f9796c9c64c1a3e1c63402d','7.3':'41e8d5ad5db20b0e9aeea4334b39bea56729579a'};
const cache = new Map();
async function nativeCss(version, theme) {
  const files = version === '7.0' ? [`default-${theme}.css`,'jquery.sweetalert.css',`dynamix-${theme}.css`] : ['default-color-palette.css','default-base.css','jquery.sweetalert.css','default-dynamix.css',`themes/${theme}.css`];
  return (await Promise.all(files.map(async file => {
    const key = `${version}/${file}`;
    if (!cache.has(key)) {
      const local = process.env.ACP_NATIVE_THEME_DIR;
      if (local) cache.set(key, fs.readFileSync(path.join(local,version,file.replace('/','-')),'utf8'));
      else {
        const response = await fetch(`https://raw.githubusercontent.com/unraid/webgui/${refs[version]}/emhttp/plugins/dynamix/styles/${file}`, {signal:AbortSignal.timeout(30000)});
        assert.ok(response.ok, `Cannot fetch pinned native stylesheet ${key}: ${response.status}`);
        cache.set(key,await response.text());
      }
    }
    return cache.get(key);
  }))).join('\n');
}
(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    for (const version of Object.keys(refs)) for (const theme of ['black','white','azure','gray']) for (const width of [1440,390]) {
      const page = await browser.newPage({viewport:{width,height:1000}});
      const errors = [];
      page.on('pageerror',error=>errors.push(error.message));
      const html = execFileSync('php',[path.join(__dirname,'render_i18n_page.php'),'en_US',theme],{encoding:'utf8',maxBuffer:4e6});
      await setFixtureContent(page, html);
      const hostStyle = await page.addStyleTag({content:await nativeCss(version,theme)});
      await hostStyle.evaluate(el=>el.id='native-theme');
      await page.addStyleTag({path:path.join(plugin,'styles/appdata.cleanup.plus.css')});
      await page.addScriptTag({path:require.resolve(dependency('jquery/dist/jquery.js'))});
      for (const file of ['appdata.cleanup.plus.shared.js','appdata.cleanup.plus.panels.js']) await page.addScriptTag({path:path.join(plugin,'scripts',file)});
      const main = fs.readFileSync(path.join(plugin,'scripts/appdata.cleanup.plus.js'),'utf8');
      await page.addScriptTag({content:main.replace('$(init);','window.themeFlows={state,cacheElements,renderSummaryCards,renderResults,buildHelpModalHtml,buildOperationContext,buildOperationPreviewHtml,buildOperationResultsHtml,buildOperationProgressHtml,buildRestoreConflictDialogHtml};')});
      await page.evaluate(()=>{
        const T=window.themeFlows, ACP=window.AppdataCleanupPlus;
        T.cacheElements();
        ACP.applyThemeState($('#acp-app'));
        ACP.watchThemeChanges(()=>{ ACP.applyThemeState($('#acp-app')); ACP.syncDeleteModalThemeTokens($('.sweet-alert')); });
        T.state.rows=[{id:'example',name:'Example',path:'/mnt/user/appdata/Example',displayPath:'/mnt/user/appdata/Example',sourceKind:'filesystem',sourceNames:[],targetPaths:[],templateRefs:[],canDelete:true,storageKind:'filesystem',risk:'safe',status:'orphaned',sizeLabel:'1 MB'}];
        T.state.summary={total:1,safe:1,review:0,blocked:0,deletable:1,ignored:0};
        T.renderSummaryCards(); T.renderResults();
        const modal=document.createElement('div'); modal.className='sweet-alert showSweetAlert'; modal.style.display='block';
        modal.innerHTML='<h2>Theme test</h2><p></p><div class="sa-button-container"><button class="cancel">Cancel</button><button class="confirm">Done</button></div>'; document.body.append(modal);
      });
      // Fast runners can reach the assertions during the initial native-to-plugin
      // color transition. Compare settled styles without disabling animations.
      await page.evaluate(()=>{
        void document.body.offsetWidth;
        return Promise.all(document.getAnimations().filter(animation=>animation.effect.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})));
      });
      const expectedClass=['white','azure'].includes(theme)?'light':'dark';
      const baseline=await page.evaluate(()=>{
        const app=document.querySelector('#acp-app'), css=getComputedStyle(app), body=getComputedStyle(document.body);
        return {page:css.backgroundColor,host:body.backgroundColor,text:css.color,hostText:body.color,kind:app.dataset.acpThemeClass,card:getComputedStyle(document.querySelector('.acp-summary-card')).backgroundColor};
      });
      assert.equal(baseline.page,baseline.host,`${version} ${theme}: page must match Unraid`);
      assert.equal(baseline.text,baseline.hostText,`${version} ${theme}: text must match Unraid`);
      assert.equal(baseline.card,baseline.host,`${version} ${theme}: cards must use native surfaces`);
      assert.equal(baseline.kind,expectedClass);
      const controls=await page.evaluate(()=>{
        const probe=document.createElement('div'); probe.style.cssText='position:fixed;left:-10000px'; probe.innerHTML='<input type="text"><button>Native</button>';document.body.append(probe);
        const pick=el=>{const c=getComputedStyle(el);return {text:c.color,bg:c.backgroundColor,image:c.backgroundImage,border:c.borderTopColor,borderWidth:c.borderTopWidth};};
        const result={input:pick(document.querySelector('#acp-app .acp-input')),nativeInput:pick(probe.querySelector('input')),button:pick(document.querySelector('#acp-app .acp-button')),nativeButton:pick(probe.querySelector('button'))};
        probe.remove(); return result;
      });
      assert.equal(controls.input.text,controls.nativeInput.text,`${version} ${theme}: native input text`);
      assert.equal(controls.input.bg,controls.nativeInput.bg,`${version} ${theme}: native input surface`);
      assert.equal(controls.button.text,baseline.text,`${version} ${theme}: neutral plugin button text`);
      assert.equal(controls.button.image,'none',`${version} ${theme}: flat plugin buttons`);
      assert.equal(controls.button.borderWidth,'1px',`${version} ${theme}: plugin button border width`);
      assert.notEqual(controls.button.border,'rgba(0, 0, 0, 0)',`${version} ${theme}: visible subtle button border`);
      if (theme==='black' || theme==='white') assert.match(controls.nativeButton.image,/gradient/, 'Host buttons outside the plugin retain native styling');
      await page.locator('#acp-app .acp-input').first().focus();
      assert.notEqual(await page.locator('#acp-app .acp-input').first().evaluate(el=>getComputedStyle(el).borderColor),controls.input.bg,'Focused inputs need a visible border');
      await page.locator('#acp-app .acp-button').first().focus();
      assert.notEqual(await page.locator('#acp-app .acp-button').first().evaluate(el=>getComputedStyle(el).outlineStyle),'none','Keyboard focus must remain visible');
      await page.evaluate(()=>document.activeElement.blur());
      // Enabled cleanup actions keep their semantic foreground on tinted surfaces,
      // including hover; native white hover text needs a filled native button.
      await page.evaluate(()=>{
        document.querySelector('.sweet-alert').style.display='none';
        document.querySelector('#acp-primary-action').classList.add('acp-button-danger');
      });
      const ordinaryButton=page.locator('#acp-app .acp-button').first();
      await ordinaryButton.hover();
      await ordinaryButton.evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished)));
      assert.equal(await ordinaryButton.evaluate(el=>getComputedStyle(el).color),baseline.text,'Hovered plugin buttons retain neutral text');
      assert.equal(await ordinaryButton.evaluate(el=>getComputedStyle(el).backgroundImage),'none','Hover must not restore native gradients');
      await ordinaryButton.evaluate(el=>el.disabled=true);
      assert.equal(await ordinaryButton.evaluate(el=>getComputedStyle(el).backgroundImage),'none','Disabled buttons stay flat');
      await ordinaryButton.evaluate(el=>el.disabled=false);
      for (const [kind,token] of [['warning','review'],['danger','locked']]) {
        const action=page.locator(`#acp-app .acp-bottom-actions .acp-button-${kind}`).first();
        await action.evaluate(el=>el.disabled=false);
        const expected=await action.evaluate((el,token)=>{
          const probe=document.createElement('span');probe.style.color=`var(--acp-${token}-text)`;el.append(probe);
          const color=getComputedStyle(probe).color;probe.remove();return color;
        },token);
        await page.waitForFunction(({kind,expected})=>getComputedStyle(document.querySelector(`#acp-app .acp-bottom-actions .acp-button-${kind}`)).color===expected,{kind,expected});
        assert.equal(await action.evaluate(el=>getComputedStyle(el).color),expected,`${theme}: ${kind} action text`);
        await action.hover();
        await action.evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished)));
        assert.equal(await action.evaluate(el=>getComputedStyle(el).color),expected,`${theme}: ${kind} hover text`);
        await action.evaluate(el=>el.disabled=true);
      }
      await page.mouse.move(0,0);
      await page.evaluate(()=>document.querySelector('.sweet-alert').style.display='block');
      for (const flow of ['help','details','sources','mappings','tools','templates','quarantine','history','confirmation','progress','results','conflicts']) {
        await page.evaluate(flow=>{
          const T=themeFlows, ACP=AppdataCleanupPlus, row=T.state.rows[0], context={strings:appdataCleanupPlusConfig.strings,state:T.state};
          const operation=T.buildOperationContext('delete',[row]);
          if (flow==='templates') context.state.templateManager={status:{templates:Array.from({length:30},(_,i)=>({id:`template-${i}`,name:`Saved app ${i}`,filename:`my-saved-app-${i}.xml`})),backups:[{id:'backup',name:'Saved backup',filename:'my-backup.xml',canRestore:true}]}};
          const builders={help:()=>T.buildHelpModalHtml(),details:()=>ACP.buildRowDetailsModalHtml(context,row),sources:()=>ACP.buildAppdataSourcesModalHtml(context),mappings:()=>ACP.buildZfsPathMappingsModalHtml(context),tools:()=>ACP.buildToolsModalHtml(context),templates:()=>ACP.buildTemplateManagerModalHtml(context),quarantine:()=>ACP.buildQuarantineManagerModalHtml(context),history:()=>ACP.buildAuditHistoryModalHtml(context),confirmation:()=>T.buildOperationPreviewHtml([row],operation,{}),progress:()=>T.buildOperationProgressHtml({processed:0,total:1},operation,false),results:()=>T.buildOperationResultsHtml({deleted:1},[{path:row.path,status:'deleted',message:'Deleted'}],operation),conflicts:()=>T.buildRestoreConflictDialogHtml({summary:{conflicts:1,ready:0},conflicts:[{id:'example',sourcePath:row.path,parentPath:'/mnt/user/appdata',suggestedName:'Example-restored'}]})};
          const classes={help:'acp-help-modal',details:'acp-row-details-modal',sources:'acp-appdata-sources-modal',mappings:'acp-zfs-path-mappings-modal',tools:'acp-tools-modal',templates:'acp-template-manager-modal',quarantine:'acp-quarantine-manager-modal',history:'acp-audit-history-modal'};
          ACP.applyDeleteModalClass('acp-delete-modal '+(classes[flow]||'acp-delete-modal-review'),builders[flow]());
        },flow);
        const result=await page.evaluate(()=>{
          const modal=document.querySelector('.sweet-alert'),css=getComputedStyle(modal);
          return {bg:css.backgroundColor,text:css.color,kind:modal.dataset.acpThemeClass,overflow:document.documentElement.scrollWidth};
        });
        assert.equal(result.bg,baseline.page,`${version} ${theme} ${flow}: modal surface`);
        assert.equal(result.text,baseline.text,`${version} ${theme} ${flow}: modal text`);
        assert.equal(result.kind,expectedClass);
        if (flow==='templates') {
          await page.setViewportSize({width,height:650});
          const geometry=await page.evaluate(()=>{
            const modal=document.querySelector('.sweet-alert'),list=modal.querySelector('.acp-template-list'),done=modal.querySelector('button.confirm');
            return {height:modal.getBoundingClientRect().height,outerOverflow:modal.scrollHeight-modal.clientHeight,listOverflow:list.scrollHeight-list.clientHeight,doneBottom:done.getBoundingClientRect().bottom};
          });
          assert.ok(geometry.height<=570 && geometry.outerOverflow<=2,`${version} ${theme}: template dialog must stay compact without outer scrolling ${JSON.stringify(geometry)}`);
          assert.ok(geometry.listOverflow>0,'Long template lists scroll internally');
          assert.ok(geometry.doneBottom<=650,'Done remains visible');
          await page.locator('.acp-template-list').evaluate(el=>el.scrollTop=el.scrollHeight);
          assert.ok(await page.locator('[data-action="restore-template"]').isVisible(),'Backups remain reachable in the scrolling list');
          await page.setViewportSize({width,height:1000});
        }
        const gradientButtons=await page.evaluate(()=>Array.from(document.querySelectorAll('#acp-app .acp-button, .sweet-alert button')).filter(el=>getComputedStyle(el).backgroundImage!=='none').map(el=>el.className));
        assert.deepEqual(gradientButtons,[],`${version} ${theme} ${flow}: page and dialog buttons stay flat`);
        const confirm=page.locator('.sweet-alert button.confirm');
        await confirm.hover();
        await confirm.evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished)));
        assert.equal(await confirm.evaluate(el=>getComputedStyle(el).backgroundImage),'none',`${flow}: dialog hover stays flat`);
        assert.equal(await confirm.evaluate(el=>getComputedStyle(el).color),baseline.text,`${flow}: dialog hover keeps neutral text`);
        await page.mouse.move(0,0);
        if (result.overflow>width+2) console.error(await page.evaluate(()=>Array.from(document.querySelectorAll('#acp-app *, .sweet-alert *')).filter(el=>el.getBoundingClientRect().right>innerWidth+2).slice(0,12).map(el=>({tag:el.tagName,cls:el.className,width:el.getBoundingClientRect().width,cssWidth:getComputedStyle(el).width}))));
        assert.ok(result.overflow<=width+2,`${version} ${theme} ${flow} ${width}: page overflow ${result.overflow}`);
      }
      if (process.env.ACP_THEME_SCREENSHOTS && version==='7.3' && width===1440) {
        await page.evaluate(()=>document.querySelector('.sweet-alert').style.display='none');
        await page.screenshot({path:path.join(process.env.ACP_THEME_SCREENSHOTS,`${theme}-page.png`),fullPage:true});
        await page.evaluate(()=>{document.querySelector('.sweet-alert').style.display='block';AppdataCleanupPlus.applyDeleteModalClass('acp-delete-modal acp-help-modal',themeFlows.buildHelpModalHtml());});
        await page.screenshot({path:path.join(process.env.ACP_THEME_SCREENSHOTS,`${theme}-help.png`),fullPage:true});
      }
      // Reuse an open dialog after the host stylesheet changes; no copied colors.
      const next=theme==='white'?'black':'white';
      await page.evaluate(({css,next})=>{document.querySelector('#native-theme').textContent=css;document.documentElement.setAttribute('data-acp-host-theme',next);}, {css:await nativeCss(version,next),next});
      await page.waitForFunction(next=>document.querySelector('.sweet-alert').dataset.acpHostTheme===next,next);
      assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.sweet-alert')).backgroundColor),await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'Open dialogs must track theme changes');
      if (theme==='white' && width===1440) {
        await page.route('https://unraid.example/styles/themes/azure.css',route=>route.fulfill({contentType:'text/css',body:cache.get(`${version}/${version==='7.0'?'default-azure.css':'themes/azure.css'}`)}));
        // Prime the pinned stylesheet cache before simulating an asynchronous host switch.
        await nativeCss(version,'azure');
        await page.evaluate(()=>{const link=document.createElement('link');link.rel='stylesheet';link.href='https://unraid.example/styles/themes/azure.css';document.head.append(link);});
        await page.waitForFunction(()=>document.querySelector('.sweet-alert').dataset.acpHostTheme==='azure');
        assert.equal(await page.evaluate(()=>document.querySelector('#acp-app').dataset.acpThemeClass),'light','Loaded host stylesheet must take priority over stale bootstrap metadata');
      }
      assert.deepEqual(errors,[]);
      await page.close();
      console.log(`theme_ui: Unraid ${version} ${theme} ${width}px page, 12 dialog flows and live switch passed`);
    }
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
