// Optional local browser check. Requires Playwright, Chromium and jQuery in the
// maintainer's tooling environment; these are not shipped plugin dependencies.
const path = require('node:path');
const fs = require('node:fs');
const {execFileSync} = require('node:child_process');
const assert = require('node:assert/strict');
const modules = process.env.ACP_BROWSER_MODULES;
const dependency = name => modules ? path.join(modules, name) : name;
const {chromium} = require(dependency('playwright'));
const jquery = require.resolve(dependency('jquery/dist/jquery.js'));
const plugin = path.resolve(__dirname, '../source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus');
const locales = JSON.parse(fs.readFileSync(path.join(plugin, 'locales/locales.json'), 'utf8'));

(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    for (const [locale, definition] of Object.entries(locales)) {
      const html = execFileSync('php', [path.join(__dirname, 'render_i18n_page.php'), locale], {encoding:'utf8', maxBuffer:4e6})
        .replace(/<script src="[^"]*"><\/script>/g, '').replace(/<link[^>]+>/g, '');
      for (const width of [1280, 390]) {
        const page = await browser.newPage({viewport:{width, height:900}});
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent(html);
        await page.addStyleTag({path:path.join(plugin, 'styles/appdata.cleanup.plus.css')});
        await page.addScriptTag({path:jquery});
        for (const name of ['appdata.cleanup.plus.shared.js', 'appdata.cleanup.plus.panels.js']) {
          await page.addScriptTag({path:path.join(plugin, 'scripts', name)});
        }
        const main = fs.readFileSync(path.join(plugin, 'scripts/appdata.cleanup.plus.js'), 'utf8');
        assert.equal(main.split('$(init);').length, 2);
        await page.addScriptTag({content:main.replace('$(init);', 'window.i18nLayoutFlows = {conflicts:buildRestoreConflictDialogHtml, operation:buildOperationContext, preview:buildOperationPreviewHtml};')});
        const direction = definition.rtl ? 'rtl' : 'ltr';
        const initial = await page.evaluate(() => ({scroll:document.documentElement.scrollWidth, direction:getComputedStyle(document.querySelector('#acp-app')).direction}));
        assert.ok(initial.scroll <= width + 2, `${locale} ${width}px: page overflow ${initial.scroll}`);
        assert.equal(initial.direction, direction);
        await page.evaluate(() => {
          const ACP = window.AppdataCleanupPlus;
          const host = document.createElement('div');
          host.className = 'sweet-alert showSweetAlert acp-delete-modal acp-row-details-modal';
          host.style.display = 'block';
          host.innerHTML = '<h2></h2><p></p><div class="sa-button-container"></div>';
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
        for (const flow of ['quarantine', 'conflicts', 'confirmation', 'history', 'templates', 'mounts']) {
          await page.evaluate(flow => {
            const ACP = window.AppdataCleanupPlus;
            const context = {strings:window.appdataCleanupPlusConfig.strings,state:{settings:ACP.defaultSafetySettings()}};
            let html, modalClass;
            if (flow === 'templates') {
              context.state.templateManager = {status:{templates:[{id:'example',name:'Example',filename:'my-example.xml'}],backups:[{id:'backup',name:'Saved Example',filename:'my-saved-example.xml',canRestore:false}]}};
              html = ACP.buildToolsModalHtml(context);
              modalClass = 'acp-tools-modal';
            } else if (flow === 'mounts') {
              html = ACP.buildMountEvidenceHtml([{name:'Container Example',paths:['/mnt/user/appdata/Example-long-mount-path']}]).replace('<details ', '<details open ');
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
        }
        await page.evaluate(() => { const app = document.querySelector('#acp-app'); [app, document.documentElement, document.body].forEach(node => node.setAttribute('data-acp-host-theme', 'white')); app.setAttribute('data-acp-theme-class', 'light'); });
        const light = await page.evaluate(() => { const style = getComputedStyle(document.querySelector('#acp-app')); return {direction:style.direction, panel:style.getPropertyValue('--acp-panel').trim()}; });
        assert.equal(light.direction, direction, 'Light theme preserves RTL');
        assert.equal(light.panel, 'rgba(255, 255, 255, 0.98)');
        assert.deepEqual(errors, []);
        await page.close();
      }
      console.log(`${locale}: desktop/mobile page, Details, quarantine, conflicts, confirmation, history, RTL and light theme passed`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
