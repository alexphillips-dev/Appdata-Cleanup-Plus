// All-locale browser regression check. Requires Playwright, Chromium and jQuery in the
// maintainer's tooling environment; these are not shipped plugin dependencies.
const path = require('node:path');
const fs = require('node:fs');
const {execFileSync} = require('node:child_process');
const {setFixtureContent} = require('./browser_fixture.cjs');
const assert = require('node:assert/strict');
const modules = process.env.ACP_BROWSER_MODULES;
const dependency = name => modules ? path.join(modules, name) : name;
const {chromium} = require(dependency('playwright'));
const jquery = require.resolve(dependency('jquery/dist/jquery.js'));
const plugin = path.resolve(__dirname, '../source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus');
const locales = JSON.parse(fs.readFileSync(path.join(plugin, 'locales/locales.json'), 'utf8'));
const nativeRef = '41e8d5ad5db20b0e9aeea4334b39bea56729579a';
async function nativeCss(theme) {
  const files = ['default-color-palette.css', 'default-base.css', 'jquery.sweetalert.css', 'default-dynamix.css', `themes/${theme}.css`];
  return (await Promise.all(files.map(async file => {
    if (process.env.ACP_NATIVE_THEME_DIR) return fs.readFileSync(path.join(process.env.ACP_NATIVE_THEME_DIR, '7.3', file.replace('/', '-')), 'utf8');
    const response = await fetch(`https://raw.githubusercontent.com/unraid/webgui/${nativeRef}/emhttp/plugins/dynamix/styles/${file}`, {signal:AbortSignal.timeout(30000)});
    assert.ok(response.ok, `Cannot fetch pinned native stylesheet ${file}: ${response.status}`);
    return response.text();
  }))).join('\n');
}

async function checkActionLayout(page, locale, width) {
  const result = await page.evaluate(() => {
    const app = document.querySelector('#acp-app'), bar = document.querySelector('#acp-bottom-bar');
    const button = document.querySelector('.acp-mode-link'), card = button.closest('.acp-mode-card');
    const range = document.createRange(); range.selectNodeContents(button);
    const bounds = card.getBoundingClientRect();
    const toolbar = document.querySelector('#acp-action-toolbar'), toolbarBounds = toolbar.getBoundingClientRect();
    const controls = Array.from(toolbar.querySelectorAll('input, select, .acp-action-toolbar-actions button'));
    const searchBounds = document.querySelector('#acp-search').getBoundingClientRect();
    const sortBounds = document.querySelector('#acp-sort').getBoundingClientRect();
    const actions = toolbar.querySelector('.acp-action-toolbar-actions'), actionBounds = actions.getBoundingClientRect();
    const buttonBounds = Array.from(actions.querySelectorAll('button'), button => button.getBoundingClientRect());
    const sharedRow = actionBounds.top < sortBounds.bottom && actionBounds.bottom > sortBounds.top;
    const singleButtonRow = buttonBounds.every(rect => Math.abs(rect.top - buttonBounds[0].top) <= 1);
    return {position:getComputedStyle(bar).position, clearance:parseFloat(getComputedStyle(app).paddingBottom),
      height:bar.getBoundingClientRect().height, bottom:parseFloat(getComputedStyle(bar).bottom) || 0,
      searchInside:toolbar.contains(document.querySelector('#acp-search')), sortInside:toolbar.contains(document.querySelector('#acp-sort')),
      controlsFit:controls.every(control=>{const rect=control.getBoundingClientRect();return rect.left>=toolbarBounds.left && rect.right<=toolbarBounds.right && rect.top>=toolbarBounds.top && rect.bottom<=toolbarBounds.bottom;}),
      searchWidth:document.querySelector('#acp-search').getBoundingClientRect().width,
      actionGap:parseFloat(getComputedStyle(toolbar.querySelector('.acp-action-toolbar-actions')).columnGap),
      compactMargins:Array.from(toolbar.querySelectorAll('.acp-action-toolbar-actions button')).every(button=>{const css=getComputedStyle(button);return ['marginTop','marginRight','marginBottom','marginLeft'].every(side=>parseFloat(css[side])===0);}),
      sharedRow, alignedBottoms:Math.abs(actionBounds.bottom - sortBounds.bottom) <= 1,
      alignedTops:Math.abs(actionBounds.top - sortBounds.top) <= 1, singleButtonRow,
      matchingControlHeights:buttonBounds.every(rect => rect.height >= searchBounds.height - 1),
      clipped:Array.from(range.getClientRects()).some(rect => rect.left < bounds.left - 2 || rect.right > bounds.right + 2 || rect.bottom > bounds.bottom + 2)};
  });
  assert.equal(result.clipped, false, `${locale} ${width}px: Safe Mode label must fit its card`);
  assert.ok(result.searchInside && result.sortInside, `${locale}: search and sorting belong in the action bar`);
  assert.equal(result.controlsFit, true, `${locale} ${width}px: action-bar controls must fit without clipping`);
  assert.ok(result.searchWidth>=160, `${locale} ${width}px: search remains usable`);
  assert.ok(result.actionGap<=8, `${locale}: action buttons use compact spacing`);
  assert.equal(result.compactMargins, true, `${locale}: native button margins must not expand action-bar spacing`);
  assert.equal(result.matchingControlHeights, true, `${locale} ${width}px: action buttons must match the input control height`);
  if (result.sharedRow) {
    assert.equal(result.alignedBottoms, true, `${locale} ${width}px: action buttons must align with the sorting control, below its label`);
    if (result.singleButtonRow) assert.equal(result.alignedTops, true, `${locale} ${width}px: action buttons and sorting control must share their top edge`);
  }
  if (width <= 760) assert.equal(result.position, 'static', `${locale}: mobile actions must remain in page flow`);
  else {
    assert.equal(result.position, 'fixed');
    assert.ok(result.clearance >= result.height + result.bottom + 16, `${locale}: fixed actions need measured clearance`);
  }
}

(async () => {
  const [darkCss, lightCss] = await Promise.all([nativeCss('black'), nativeCss('white')]);
  const browser = await chromium.launch({headless:true});
  try {
    for (const [locale, definition] of Object.entries(locales)) {
      const html = execFileSync('php', [path.join(__dirname, 'render_i18n_page.php'), locale], {encoding:'utf8', maxBuffer:4e6});
      for (const width of [1670, 1280, 432, 390]) {
        const page = await browser.newPage({viewport:{width, height:810}});
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await setFixtureContent(page, html);
        const nativeStyle = await page.addStyleTag({content:darkCss});
        await page.addStyleTag({path:path.join(plugin, 'styles/appdata.cleanup.plus.css')});
        await page.addScriptTag({path:jquery});
        for (const name of ['appdata.cleanup.plus.shared.js', 'appdata.cleanup.plus.panels.js']) {
          await page.addScriptTag({path:path.join(plugin, 'scripts', name)});
        }
        const main = fs.readFileSync(path.join(plugin, 'scripts/appdata.cleanup.plus.js'), 'utf8');
        assert.equal(main.split('$(init);').length, 2);
        await page.addScriptTag({content:main.replace('$(init);', 'window.i18nLayoutFlows = {state,cacheElements,renderAll,installActionBarLayout,conflicts:buildRestoreConflictDialogHtml, operation:buildOperationContext, preview:buildOperationPreviewHtml};')});
        await page.evaluate(() => {
          const F = window.i18nLayoutFlows;
          F.cacheElements(); F.installActionBarLayout(); F.renderAll();
        });
        assert.equal(await page.locator('#acp-bottom-bar').isVisible(), false, `${locale}: empty scan hides cleanup actions`);
        await page.evaluate(() => {
          const F = window.i18nLayoutFlows;
          F.state.rows = [{id:'example',name:'Example',path:'/mnt/user/appdata/Example',displayPath:'/mnt/user/appdata/Example',sourceKind:'filesystem',sourceNames:[],targetPaths:[],templateRefs:[],canDelete:true,storageKind:'filesystem',risk:'safe',status:'orphaned',sizeLabel:'1 MB'}];
          F.state.summary = {total:1,safe:1,review:0,blocked:0,deletable:1,ignored:0};
          F.renderAll();
        });
        assert.equal(await page.locator('#acp-bottom-bar').isVisible(), true, `${locale}: candidates show cleanup actions`);
        await checkActionLayout(page, locale, width);
        if (width === 1280) {
          await page.locator('#acp-bottom-bar').evaluate(node => node.style.minHeight = '180px');
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await checkActionLayout(page, locale, width);
          await page.locator('#acp-bottom-bar').evaluate(node => node.style.minHeight = '');
        }
        const direction = definition.rtl ? 'rtl' : 'ltr';
        const initial = await page.evaluate(() => ({scroll:document.documentElement.scrollWidth, direction:getComputedStyle(document.querySelector('#acp-app')).direction}));
        assert.ok(initial.scroll <= width + 2, `${locale} ${width}px: page overflow ${initial.scroll}`);
        assert.equal(initial.direction, direction);
        await page.evaluate(() => {
          const ACP = window.AppdataCleanupPlus;
          const host = document.createElement('div');
          host.className = 'sweet-alert showSweetAlert acp-delete-modal acp-row-details-modal';
          host.style.display = 'block';
          host.innerHTML = '<h2></h2><p></p><div class="sa-button-container"><button class="cancel" style="display:none">Cancel</button><button class="confirm">Done</button></div>';
          document.body.append(host);
          const context = {strings:window.appdataCleanupPlusConfig.strings, state:{settings:ACP.defaultSafetySettings()}};
          const row = {name:'Delete', path:'/mnt/user/appdata/Delete', displayPath:'/mnt/user/appdata/Delete', sourceKind:'filesystem', sourceNames:[], targetPaths:[], templateRefs:[], canDelete:true, storageKind:'filesystem'};
          ACP.applyDeleteModalClass('acp-delete-modal acp-row-details-modal', ACP.buildRowDetailsModalHtml(context, row));
        });
        const modal = await page.evaluate(() => {
          const node = document.querySelector('.sweet-alert');
          return {direction:node.dir, scroll:document.documentElement.scrollWidth, text:node.textContent, codeDirection:getComputedStyle(node.querySelector('code')).direction};
        });
        assert.ok(modal.scroll <= width + 2, `${locale} ${width}px: modal overflow ${modal.scroll}`);
        assert.equal(modal.direction, direction);
        assert.equal(modal.codeDirection, 'ltr');
        assert.ok(modal.text.includes('/mnt/user/appdata/Delete'));
        assert.equal(await page.locator('.sweet-alert button.cancel').isVisible(), false, `${locale}: hidden Cancel must stay hidden`);
        assert.equal(await page.locator('.sweet-alert button.cancel').textContent(), await page.evaluate(() => window.AppdataCleanupPlus.tr('Cancel')), `${locale}: Cancel must use the locale`);
        for (const flow of ['quarantine', 'conflicts', 'confirmation', 'history', 'templates', 'mounts', 'unverified']) {
          await page.evaluate(flow => {
            const ACP = window.AppdataCleanupPlus;
            const context = {strings:window.appdataCleanupPlusConfig.strings,state:{settings:ACP.defaultSafetySettings()}};
            let html, modalClass;
            if (flow === 'unverified') {
              const row = {name:'Example',path:'/mnt/user/appdata/Example',displayPath:'/mnt/user/appdata/Example',sourceKind:'filesystem',sourceNames:[],targetPaths:[],templateRefs:[],canDelete:false,storageKind:'filesystem',scanVerificationLocked:true,policyLocked:true,policyReason:ACP.tr('Docker ownership verification is incomplete. Results are unverified and cleanup is blocked, even with Safe Mode disabled. Rescan; if the problem persists, export diagnostics from Tools.')};
              html = ACP.buildRowDetailsModalHtml(context,row);
              modalClass = 'acp-row-details-modal';
            } else if (flow === 'templates') {
              context.state.templateManager = {status:{templates:[{id:'example',name:'Example',filename:'my-example.xml'}],backups:[{id:'backup',name:'Saved Example',filename:'my-saved-example.xml',canRestore:false}]}};
              html = ACP.buildTemplateManagerModalHtml(context);
              modalClass = 'acp-template-manager-modal';
            } else if (flow === 'mounts') {
              html = ACP.buildMountEvidenceHtml([{name:'Container Example',paths:['/mnt/user/appdata/Example-long-mount-path']}]).replace('<details ', '<details open ') + ACP.buildMountEvidenceHtml([{name:'Broad viewer',paths:['/mnt/user']}],true).replace('<details ', '<details open ');
              modalClass = 'acp-row-details-modal';
            } else if (flow === 'quarantine') {
              context.state.quarantine = {summary:{count:21,sizeLabel:'0 B'},entries:[{id:'example',sourcePath:'/mnt/user/appdata/Delete',purgeBadgeLabel:ACP.plural('Purges in {count} days',21)}]};
              html = ACP.buildQuarantineManagerModalHtml(context);
              modalClass = 'acp-quarantine-manager-modal';
            } else if (flow === 'conflicts') {
              html = window.i18nLayoutFlows.conflicts({summary:{conflicts:2,ready:21},conflicts:[{id:'example',sourcePath:'/mnt/user/appdata/Delete',parentPath:'/mnt/user/appdata',suggestedName:'Delete-restored'}]});
              modalClass = 'acp-quarantine-manager-modal';
            } else if (flow === 'history') {
              context.state.auditHistory = [{requestedCount:1}];
              html = ACP.buildAuditHistoryModalHtml(context);
              modalClass = 'acp-audit-history-modal';
            } else {
              const row = {id:'example',name:'Delete',path:'/mnt/user/appdata/Delete',storageKind:'filesystem',canDelete:true};
              html = window.i18nLayoutFlows.preview([row],window.i18nLayoutFlows.operation('delete',[row]),{});
              modalClass = 'acp-delete-modal-review';
            }
            ACP.applyDeleteModalClass('acp-delete-modal ' + modalClass, html);
          }, flow);
          const result = await page.evaluate(() => ({scroll:document.documentElement.scrollWidth,dir:document.querySelector('.sweet-alert').dir}));
          assert.ok(result.scroll <= width + 2, `${locale} ${width}px ${flow}: overflow ${result.scroll}`);
          assert.equal(result.dir, direction);
          assert.equal(await page.locator('.sweet-alert button.cancel').isVisible(), false, `${locale} ${flow}: hidden Cancel must stay hidden`);
          if (flow === 'templates' && width <= 760) {
            const refresh = await page.locator('.acp-simple-modal-card-actions button').first().evaluate(node => {
              const range = document.createRange(); range.selectNodeContents(node);
              return {lines:new Set(Array.from(range.getClientRects()).map(rect => Math.round(rect.top))).size, overflow:node.scrollWidth > node.clientWidth + 2};
            });
            assert.equal(refresh.overflow, false, `${locale}: template Refresh must fit`);
            assert.equal(refresh.lines, 1, `${locale}: template Refresh must not split across lines`);
          }
        }
        await page.locator('.sweet-alert button.cancel').evaluate(node => node.style.display = 'inline-block');
        assert.equal(await page.locator('.sweet-alert button.cancel').isVisible(), true, `${locale}: requested Cancel stays available`);
        await nativeStyle.evaluate((node, css) => node.textContent = css, lightCss);
        await page.evaluate(() => { const app = document.querySelector('#acp-app'); [app, document.documentElement, document.body].forEach(node => node.setAttribute('data-acp-host-theme', 'white')); app.setAttribute('data-acp-theme-class', 'light'); });
        const light = await page.evaluate(() => { const style = getComputedStyle(document.querySelector('#acp-app')); return {direction:style.direction, panel:style.getPropertyValue('--acp-panel').trim()}; });
        assert.equal(light.direction, direction, 'Light theme preserves RTL');
        assert.equal(light.panel, '#f2f2f2');
        await page.evaluate(() => document.querySelector('.sweet-alert').style.display = 'none');
        await checkActionLayout(page, locale, width);
        assert.deepEqual(errors, []);
        await page.close();
      }
      console.log(`${locale}: desktop/mobile page, Details, quarantine, conflicts, confirmation, history, RTL and light theme passed`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
