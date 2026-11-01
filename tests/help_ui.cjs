// Help modal behavior with native Unraid and pinned Aurora reference styles.
// All paths, names, requests, and operation records in this test are synthetic.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {setFixtureContent} = require('./browser_fixture.cjs');
const dependency = name => process.env.ACP_BROWSER_MODULES ? path.join(process.env.ACP_BROWSER_MODULES, name) : name;
const {chromium} = require(dependency('playwright'));
const plugin = path.resolve(__dirname, '../source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus');
const origin = 'https://unraid.example';
const nativeRefs = {'7.0':'25bc9e2d16525e4e4f9796c9c64c1a3e1c63402d', '7.3':'41e8d5ad5db20b0e9aeea4334b39bea56729579a'};
const auroraRef = '783dd3b68842efbc66ff4edbeef25159507f7bc1';
const auroraFiles = {
  'enhance.js':['plugin/src/scripts/enhance.js','e222bf562c547f0fc7e4809dd7335028b129365558b69eff32a64f676fa02452'],
  'enhance.css':['plugin/src/styles/enhance.css','79eb69e8e844566ef4599ce2f36869c49bc90093f5372d4a9935efcce57dfd0d'],
  'theme.css':['unraid-tapeory.css','d2d88802c0a39f088dfe41b944e3d519183ace9714d11dcb7ca24642937b35eb']
};
const cachedCss = new Map(), cachedPage = new Map();
const cachedAlert = new Map();
const cachedFonts = new Map();
const alertHashes = {
  '7.0':['a6018c4f73c83fa8684117b2067141ac8e8acb83e6367f9f1b771aff952e3a2a','af4a31e3c4f42e678468a147c5ab7f0ddbb935eca1ffbfdcf2cea3e95cf06a2f'],
  '7.3':['35bbdc9e33f441df5940de2a124eafe3808e12e893837985e5ce95c832f85c83','5f0a5a019cf065b4baabfc9e0314a603c0d7bcfc74d02e4e178cbf0eadd04a62']
};
let auroraAssets;

async function nativeFontCss(version) {
  if (!cachedFonts.has(version)) {
    const files = [
      ['clear-sans.woff','normal','fd593792fce2ca5c9f82e613221986f0b90424b2ed5fae8f0f099ff30f75044c'],
      ['clear-sans-bold.woff','bold','f43cf9dcf6683b750575cff48dbcf9d5cf950e6499d0b4c33b00c10608b37078']
    ];
    cachedFonts.set(version,(await Promise.all(files.map(async ([name,weight,hash]) => {
      const local = process.env.ACP_NATIVE_MODAL_REFERENCE_DIR && path.join(process.env.ACP_NATIVE_MODAL_REFERENCE_DIR,`${version}-${name}`);
      let buffer;
      if (local && fs.existsSync(local)) buffer = fs.readFileSync(local);
      else {
        const response = await fetch(`https://raw.githubusercontent.com/unraid/webgui/${nativeRefs[version]}/emhttp/plugins/dynamix/styles/${name}`,{signal:AbortSignal.timeout(30000)});
        assert.ok(response.ok,`Pinned native font unavailable: ${version}/${name}`);
        buffer = Buffer.from(await response.arrayBuffer());
      }
      assert.equal(crypto.createHash('sha256').update(buffer).digest('hex'),hash,`${version}: native ${name} hash`);
      return `@font-face{font-family:clear-sans;font-weight:${weight};font-style:normal;src:url(data:font/woff;base64,${buffer.toString('base64')}) format('woff')}`;
    }))).join('\n'));
  }
  return cachedFonts.get(version);
}

async function nativeAlert(version) {
  if (!cachedAlert.has(version)) {
    let buffer;
    if (process.env.ACP_NATIVE_MODAL_REFERENCE_DIR) buffer = fs.readFileSync(path.join(process.env.ACP_NATIVE_MODAL_REFERENCE_DIR, `${version}-sweetalert.js`));
    else {
      const response = await fetch(`https://raw.githubusercontent.com/unraid/webgui/${nativeRefs[version]}/emhttp/plugins/dynamix/javascript/dynamix.js`, {signal:AbortSignal.timeout(30000)});
      assert.ok(response.ok, `Pinned native SweetAlert bundle unavailable: ${version}`);
      const bundle = Buffer.from(await response.arrayBuffer());
      assert.equal(crypto.createHash('sha256').update(bundle).digest('hex'), alertHashes[version][0], `${version}: native bundle hash`);
      const lines = bundle.toString('utf8').split(/\r?\n/).filter(line => line.includes('sa-confirm-button-container') && line.includes('sweetAlert'));
      assert.equal(lines.length, 1, 'Extract the complete native SweetAlert IIFE unchanged');
      buffer = Buffer.from(lines[0] + '\n');
    }
    assert.equal(crypto.createHash('sha256').update(buffer).digest('hex'), alertHashes[version][1], `${version}: native SweetAlert IIFE hash`);
    cachedAlert.set(version, buffer.toString('utf8'));
  }
  return cachedAlert.get(version);
}

async function nativeCss(version, theme) {
  const key = `${version}/${theme}`;
  if (!cachedCss.has(key)) {
    const files = version === '7.0' ? [`default-${theme}.css`, 'jquery.sweetalert.css', `dynamix-${theme}.css`] : ['default-color-palette.css','default-base.css','jquery.sweetalert.css','default-dynamix.css',`themes/${theme}.css`];
    cachedCss.set(key, (await Promise.all(files.map(async file => {
      if (process.env.ACP_NATIVE_THEME_DIR) return fs.readFileSync(path.join(process.env.ACP_NATIVE_THEME_DIR, version, file.replace('/', '-')), 'utf8');
      const response = await fetch(`https://raw.githubusercontent.com/unraid/webgui/${nativeRefs[version]}/emhttp/plugins/dynamix/styles/${file}`, {signal:AbortSignal.timeout(30000)});
      assert.ok(response.ok, `Pinned native stylesheet unavailable: ${key}/${file}`);
      return response.text();
    }))).join('\n'));
  }
  return cachedCss.get(key);
}

async function readAurora() {
  return Object.fromEntries(await Promise.all(Object.entries(auroraFiles).map(async ([name, [source, hash]]) => {
    let buffer;
    if (process.env.ACP_AURORA_REFERENCE_DIR) buffer = fs.readFileSync(path.join(process.env.ACP_AURORA_REFERENCE_DIR, name));
    else {
      const response = await fetch(`https://raw.githubusercontent.com/Tunefish92/Aurora-Theme/${auroraRef}/${source}`, {signal:AbortSignal.timeout(30000)});
      assert.ok(response.ok, `Pinned Aurora source unavailable: ${name}`);
      buffer = Buffer.from(await response.arrayBuffer());
    }
    assert.equal(crypto.createHash('sha256').update(buffer).digest('hex'), hash, `Pinned Aurora ${name} hash`);
    return [name, buffer.toString('utf8')];
  })));
}

async function settle(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(document.getAnimations().filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
  });
}

async function createFixture(browser, {locale = 'en_US', version = '7.3', theme = 'black', width = 1440, height = 900, aurora = false} = {}) {
  const page = await browser.newPage({viewport:{width,height}, hasTouch:width <= 760});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === '/Settings/AppdataCleanupPlus') return route.fulfill({contentType:'text/html', body:'<!doctype html><html><head></head><body></body></html>'});
    const asset = url.pathname.match(/^\/plugins\/Aurora-Theme\/(scripts|styles)\/(enhance\.js|enhance\.css|theme\.css)$/);
    if (asset && auroraAssets && url.origin === origin) return route.fulfill({contentType:asset[1] === 'scripts' ? 'text/javascript' : 'text/css', body:auroraAssets[asset[2]]});
    return route.abort();
  });
  await page.goto(`${origin}/Settings/AppdataCleanupPlus`);
  const key = `${locale}/${theme}`;
  if (!cachedPage.has(key)) cachedPage.set(key, execFileSync('php', [path.join(__dirname, 'render_i18n_page.php'), locale, theme], {encoding:'utf8',maxBuffer:4e6}));
  await setFixtureContent(page, cachedPage.get(key));
  await page.evaluate(() => {
    const app = document.querySelector('#acp-app'), host = document.createElement('div'); host.id = 'displaybox';
    host.innerHTML = '<div class="content"><div class="title"><span class="left"><i class="fa fa-th title"></i>Appdata Cleanup Plus</span><span class="right"></span></div></div>';
    app.before(host); host.firstElementChild.append(app);
    document.title = 'Synthetic server / Settings'; window.auroraPageTitle = 'Appdata Cleanup Plus';
    const menu = document.createElement('div'); menu.id = 'menu'; menu.innerHTML = '<div class="nav-item active"><a href="/Settings">Settings</a></div>'; document.body.prepend(menu);
  });
  await page.addStyleTag({content:await nativeCss(version, theme)});
  await page.addStyleTag({content:await nativeFontCss(version)});
  await page.evaluate(() => Promise.all([document.fonts.load('13px clear-sans'),document.fonts.load('bold 13px clear-sans')]));
  if (aurora) {
    await page.evaluate(() => document.documentElement.classList.add('tp-enhance'));
    for (const name of ['theme.css','enhance.css']) await page.addStyleTag({url:`${origin}/plugins/Aurora-Theme/styles/${name}`});
    await page.addScriptTag({url:`${origin}/plugins/Aurora-Theme/scripts/enhance.js`});
  }
  await page.addStyleTag({path:path.join(plugin, 'styles/appdata.cleanup.plus.css')});
  await page.addScriptTag({path:require.resolve(dependency('jquery/dist/jquery.js'))});
  await page.addScriptTag({content:await nativeAlert(version)});
  await page.evaluate(() => {
    window.requests = [];
    $.ajax = options => { const deferred = $.Deferred(); requests.push({options,deferred}); return deferred.promise(); };
    // The real native SweetAlert owns its DOM, close callbacks, keyboard trap,
    // and button handlers. Only backend requests are synthetic.
    window.makeDetailsRow = (id, count = 4) => ({
      id, name:'Synthetic retired application with a deliberately long descriptive name '.repeat(2),
      path:'/mnt/user/appdata/Synthetic-application-with-a-long-path-for-wrapping-and-layout-validation',
      displayPath:'/mnt/user/appdata/Synthetic-application-with-a-long-path-for-wrapping-and-layout-validation',
      realPath:'/mnt/synthetic-pool/appdata/Synthetic-application-with-a-long-path-for-wrapping-and-layout-validation',
      sourceRoot:'/mnt/user/appdata', sourceKind:'template', sourceLabel:'Template', sourceDisplay:'Synthetic saved template',
      sourceNames:['Synthetic saved template'], targetPaths:['/config'], templateRefs:[{name:'Synthetic saved template',target:'/config'}],
      insideConfiguredSource:true, storageKind:'filesystem', storageLabel:'Filesystem', canDelete:true, risk:'safe', status:'orphaned',
      sizeLabel:'1 MB', lastModifiedLabel:'1 day ago', lastModifiedExact:'Nov 1, 2026 8:00 AM',
      broadMountEvidence:Array.from({length:count}, (_, i) => ({name:`Synthetic viewer ${i} with a long descriptive name`,paths:[`/mnt/synthetic-broad-root-${i}/a-long-path-component-to-test-reading-without-horizontal-scrolling`]})),
      zfsResolutionVariants:['/mnt/user/appdata/Synthetic-application-with-a-long-path-for-wrapping-and-layout-validation']
    });
  });
  for (const file of ['appdata.cleanup.plus.shared.js','appdata.cleanup.plus.panels.js']) await page.addScriptTag({path:path.join(plugin, 'scripts', file)});
  const source = fs.readFileSync(path.join(plugin, 'scripts/appdata.cleanup.plus.js'), 'utf8');
  assert.equal(source.split('$(init);').length, 2);
  const hook = 'window.helpFixture={state,openRowDetailsModal,renderOpenRowDetailsModal,renderResults,openHelpModal,openAppdataSourcesModal,openRecoveredOperation,openToolsModal,openQuarantineManagerModal,buildHelpModalHtml}; cacheElements(); bindEvents(); loadScan=function(){window.scanRefreshes=(window.scanRefreshes||0)+1;}; loadRecentOperations=function(){};';
  await page.addScriptTag({content:source.replace('$(init);', hook)});
  await page.evaluate(() => {
    AppdataCleanupPlus.applyThemeState($('#acp-app'));
    const F = helpFixture; F.state.scanToken = 'synthetic-scan'; F.state.dockerRunning = true;
    F.state.rows = [makeDetailsRow('small',4), makeDetailsRow('large',30)];
    F.state.summary = {total:2, safe:2, blocked:0, deletable:2}; F.state.selected = {};
    F.renderResults();
  });
  return {page, errors};
}

async function openHelp(page, permanentDelete = false) {
  await page.evaluate(value => {
    helpFixture.state.settings.enablePermanentDelete = value;
    helpFixture.openHelpModal();
  }, permanentDelete);
  await page.waitForSelector('.sweet-alert.acp-help-modal.visible .acp-help-body');
  await settle(page);
  assert.equal(await page.locator('.acp-help-shell').count(), 1);
  assert.equal(await page.locator('.acp-row-details-footer-actions').count(), 0, 'Help has only the native footer');
  assert.equal(await page.locator('.acp-help-body details[open]').count(), 0, 'Each Help visit starts with collapsed questions');
}

async function closeHelp(page, key) {
  if (key) await page.keyboard.press(key);
  else await page.locator('.sweet-alert:visible button.confirm').click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.sweet-alert')).display === 'none');
}

async function expandQuestions(page) {
  await page.locator('.acp-help-body details[data-help-topic]').evaluateAll(nodes => nodes.forEach(node => { node.open = true; }));
  await settle(page);
}

async function geometry(page) {
  return page.locator('.sweet-alert.acp-help-modal').evaluate(modal => {
    const rect = node => node.getBoundingClientRect().toJSON();
    const body = modal.querySelector('.acp-help-body');
    const scrolling = [modal,...modal.querySelectorAll('*')].filter(node => /auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 2);
    const steps = [...modal.querySelectorAll('.acp-help-step')];
    return {
      modal:rect(modal),title:rect(modal.querySelector(':scope > h2')),body:rect(body),footer:rect(modal.querySelector(':scope > .sa-button-container')),
      viewport:{width:innerWidth,height:innerHeight}, onlyBody:scrolling.every(node => node === body), scrollCount:scrolling.length,
      bodyScrolls:body.scrollHeight > body.clientHeight + 2,
      horizontal:[modal,body,...body.querySelectorAll('p,summary,dt,dd,.acp-help-step,.acp-help-status,.acp-help-mode-card')].some(node => node.scrollWidth > node.clientWidth + 2),
      overflowing:[modal,body,...body.querySelectorAll('p,summary,dt,dd,.acp-help-step,.acp-help-status,.acp-help-mode-card')].filter(node => node.scrollWidth > node.clientWidth + 2).map(node => ({tag:node.tagName,cls:node.className,client:node.clientWidth,scroll:node.scrollWidth})),
      pageOverflow:document.documentElement.scrollWidth > innerWidth + 2,
      direction:getComputedStyle(body).direction,textAlign:getComputedStyle(body).textAlign,
      copyAlign:[...body.querySelectorAll('p,summary,dt,dd')].map(node => ({tag:node.tagName,align:getComputedStyle(node).textAlign})),
      bodyAlign:getComputedStyle(body).alignContent,
      steps:steps.map(rect), stepListTag:modal.querySelector('.acp-help-step-list').tagName,
      statusList:rect(modal.querySelector('.acp-help-status-list')),statuses:[...modal.querySelectorAll('.acp-help-status')].map(rect),
      columnCount:getComputedStyle(modal.querySelector('.acp-help-step-list')).gridTemplateColumns.split(' ').length,
      font:getComputedStyle(body).fontFamily,hostFont:getComputedStyle(modal).fontFamily,
      mode:modal.querySelector('.acp-help-mode-state').textContent.trim()
    };
  });
}

async function assertGeometry(page, label, rtl, aurora) {
  const top = await geometry(page);
  assert.ok(top.modal.width <= 1102, `${label}: bounded width`);
  assert.ok(top.modal.left >= -1 && top.modal.right <= top.viewport.width + 1 && top.modal.top >= -1 && top.modal.bottom <= top.viewport.height + 1, `${label}: fits viewport`);
  assert.equal(top.onlyBody,true,`${label}: only Help body scrolls`);
  assert.equal(top.scrollCount,1,`${label}: expanded questions use one scrolling area`);
  assert.equal(top.bodyScrolls,true);
  assert.equal(top.horizontal || top.pageOverflow,false,`${label}: no clipped content or horizontal overflow ${JSON.stringify({nodes:top.overflowing,page:top.pageOverflow})}`);
  assert.equal(top.direction,rtl ? 'rtl' : 'ltr');
  assert.ok(['start',rtl ? 'right' : 'left'].includes(top.textAlign),`${label}: content follows reading direction`);
  assert.ok(top.copyAlign.every(value => ['start',rtl ? 'right' : 'left'].includes(value.align)),`${label}: paragraphs and references follow reading direction ${JSON.stringify(top.copyAlign.filter(value => !['start',rtl ? 'right' : 'left'].includes(value.align)))}`);
  assert.equal(top.bodyAlign,'start',`${label}: content stays aligned at its top`);
  if(aurora)assert.equal(top.font,top.hostFont,`${label}: body inherits the active Aurora dialog typography`);
  else assert.match(top.font,/clear-sans/i,`${label}: real native typography loaded`);
  assert.equal(top.stepListTag,'OL','Workflow is an ordered list');
  assert.ok(top.statuses.every((status,index) => Math.abs(status.width-top.statusList.width) <= 2 && (!index || status.top >= top.statuses[index-1].bottom-1)),`${label}: result states use full-width sequential rows rather than the native multi-column definition-list layout`);
  assert.equal(top.steps.length,3);
  if (top.viewport.width > 760) {
    assert.equal(top.columnCount,3,`${label}: desktop workflow has three columns`);
    assert.ok(top.steps.every(step => Math.abs(step.top-top.steps[0].top) <= 1));
  } else {
    assert.equal(top.columnCount,1,`${label}: mobile workflow stacks`);
    assert.ok(top.steps[1].top >= top.steps[0].bottom-1 && top.steps[2].top >= top.steps[1].bottom-1);
  }
  assert.ok(top.title.bottom <= top.body.top+2 && top.body.bottom <= top.footer.top+2,`${label}: title/body/footer order`);
  await page.locator('.acp-help-body').evaluate(node => { node.scrollTop=node.scrollHeight; });
  const bottom = await geometry(page);
  for (const key of ['title','footer']) assert.ok(Math.abs(top[key].top-bottom[key].top) <= 1.5 && Math.abs(top[key].bottom-bottom[key].bottom) <= 1.5,`${label}: ${key} remains fixed while reading`);
  assert.equal(await page.locator('.sweet-alert:visible button.confirm').evaluate(node => {
    const box=node.getBoundingClientRect(), target=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);
    return box.top >= 0 && box.bottom <= innerHeight && (target === node || node.contains(target));
  }),true,`${label}: Done is visible and receives clicks`);
}

async function layoutCase(browser, options) {
  const {page,errors} = await createFixture(browser,options);
  const label=`${options.locale} ${options.version} ${options.theme} ${options.width}x${options.height}${options.aurora ? ' Aurora' : ''}`;
  try {
    const modes=[];
    for (const permanentDelete of [false,true]) {
      await openHelp(page,permanentDelete);
      assert.equal(await page.locator('.acp-help-step-list > .acp-help-step').count(),3);
      assert.ok(await page.locator('.acp-help-status-list .acp-help-status').count() >= 5,'All result-state explanations remain available');
      assert.ok(await page.locator('.acp-help-status dt').count() >= 5);
      assert.equal(await page.locator('.acp-help-status dt').count(),await page.locator('.acp-help-status dd').count());
      assert.equal(await page.locator('.acp-help-zfs-note').isVisible(),true,'ZFS guidance is available without expanding a question');
      assert.equal(await page.locator('.acp-help-zfs-note').evaluate(node => !!node.closest('details')),false);
      const mode=page.locator('.acp-help-mode-card');
      assert.equal(await mode.evaluate((node,value) => node.classList.contains(value ? 'is-delete-mode' : 'is-safe-mode'),permanentDelete),true);
      assert.equal(await page.locator('.acp-help-mode-state').textContent(),await page.evaluate(value => AppdataCleanupPlus.tr(value ? 'OFF' : 'ON'),permanentDelete));
      const action=await page.evaluate(value => AppdataCleanupPlus.tr(value ? 'Selected folders will be permanently deleted after confirmation.' : 'Selected folders will be quarantined instead of permanently deleted.'),permanentDelete);
      assert.equal(await page.locator('.acp-help-current-action').textContent(),action,'Help explains the current cleanup action');
      modes.push(await page.locator('.acp-help-current-action').textContent());
      assert.deepEqual(await page.locator('details[data-help-topic]').evaluateAll(nodes => nodes.map(node => node.dataset.helpTopic)),['blocked','no_results','stopped_containers','quarantine','updates']);
      const question=page.locator('.acp-help-question > summary').first();
      await question.focus(); await page.keyboard.press('Enter');
      assert.equal(await question.evaluate(node => node.closest('details').open),true,'Enter opens a native question');
      await page.keyboard.press('Space');
      assert.equal(await question.evaluate(node => node.closest('details').open),false,'Space closes a native question');
      await expandQuestions(page);
      await assertGeometry(page,`${label} ${permanentDelete ? 'OFF' : 'ON'}`,options.locale === 'ar_AR',options.aurora);
      if (!permanentDelete && options.locale === 'en_US' && options.version === '7.3' && options.theme === 'black' && !options.aurora && ((options.width === 1440 && options.height === 900) || (options.width === 390 && options.height === 700))) {
        const output=path.join(__dirname,'.tmp/acp-help-redesign-review');fs.mkdirSync(output,{recursive:true});
        await page.locator('.acp-help-body').evaluate(node => {node.scrollTop=0;});
        await page.screenshot({path:path.join(output,options.width === 1440 ? 'desktop-expanded.png' : 'mobile-expanded.png')});
      }
      await closeHelp(page);
    }
    assert.notEqual(modes[0],modes[1],'Current mode changes its explanation as well as state');
    assert.deepEqual(await page.evaluate(() => requests.map(request => request.options.data)),[],'Opening/reading/closing Help never submits backend requests');
    assert.deepEqual(errors,[]);
    console.log(`help_ui: ${label}; both modes, workflow/status/ZFS, native questions, body scroll and fixed footer passed.`);
  } finally {await page.close();}
}

async function interactionsCase(browser,options) {
  const {page,errors}=await createFixture(browser,options);
  try {
    await openHelp(page);
    await expandQuestions(page);
    const originalSettings=await page.evaluate(() => JSON.stringify(helpFixture.state.settings));
    const count=await page.locator('.sweet-alert summary,.sweet-alert button').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length && !node.disabled).length);
    const seen=new Set();
    await page.locator('.sweet-alert button.confirm').focus();
    for (let i=0;i<count+2;i++) {
      await page.keyboard.press('Tab');
      const active=await page.evaluate(() => ({inside:!!document.activeElement.closest('.sweet-alert'),tag:document.activeElement.tagName,action:document.activeElement.dataset.action || '',done:document.activeElement.classList.contains('confirm')}));
      assert.equal(active.inside,true,'Tab remains inside Help');
      if(active.tag === 'SUMMARY')seen.add('question');if(active.action)seen.add(active.action);if(active.done)seen.add('done');
    }
    for(const kind of ['question','help-open-sources','help-open-tools','done'])assert.ok(seen.has(kind),`Tab reaches ${kind}`);
    await page.locator('.sweet-alert button.confirm').focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
    assert.equal(await page.locator('.sweet-alert button.confirm').evaluate(node => document.activeElement === node),true,'Shift+Tab reverses focus order');
    await page.locator('.acp-help-question > summary').last().focus();await page.keyboard.press('Escape');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.sweet-alert')).display === 'none');
    assert.deepEqual(await page.evaluate(() => requests),[],'Keyboard reading makes no requests');
    // Busy quick links must neither replace the active dialog nor make requests.
    for(const action of ['help-open-sources','help-open-tools']) {
      await openHelp(page);
      await expandQuestions(page);
      await page.evaluate(() => {helpFixture.state.busy=true;});
      await page.locator(`[data-action="${action}"]`).click();
      assert.equal(await page.locator('.sweet-alert.acp-help-modal:visible').count(),1);
      assert.deepEqual(await page.evaluate(() => requests),[]);
      await page.evaluate(() => {helpFixture.state.busy=false;});
      await closeHelp(page);
    }
    // Real quick-link clicks reuse the existing source browser and Tools status.
    await openHelp(page);
    await expandQuestions(page);
    await page.locator('[data-action="help-open-sources"]').click();
    assert.equal(await page.locator('.sweet-alert.acp-appdata-sources-modal:visible').count(),1);
    assert.equal(await page.evaluate(() => requests.at(-1).options.data.action),'browseAppdataSourcePath');
    await page.evaluate(() => requests.at(-1).deferred.resolve({ok:true,browser:{root:'/mnt',path:'/mnt',currentPath:'/mnt',entries:[],breadcrumbs:[]}}));
    assert.equal(await page.locator('.acp-help-shell').count(),0,'Sources replaces Help content');
    await closeHelp(page);
    await openHelp(page);
    await expandQuestions(page);
    await page.locator('[data-action="help-open-tools"]').click();
    assert.equal(await page.locator('.sweet-alert.acp-tools-modal:visible').count(),1);
    assert.deepEqual(await page.evaluate(() => ({action:requests.at(-1).options.data.action,managerAction:requests.at(-1).options.data.managerAction})),{action:'fixtureManagerAction',managerAction:'status'});
    await page.evaluate(() => requests.at(-1).deferred.resolve({ok:true,status:{available:false,reason:'no_sources',fixtureCount:0}}));
    assert.equal(await page.locator('.acp-help-shell').count(),0,'Tools replaces Help content');
    await closeHelp(page);
    for(const destination of ['details','recovery']) {
      await openHelp(page);await expandQuestions(page);
      await page.evaluate(destination => {
        if(destination === 'details')helpFixture.openRowDetailsModal(helpFixture.state.rows[0]);
        else helpFixture.openRecoveredOperation('synthetic-operation');
      },destination);
      if(destination === 'recovery')await page.evaluate(() => requests.at(-1).deferred.resolve({ok:true,progress:{status:'complete',operation:'quarantine',completedRoots:0,summary:{},results:[]}}));
      await settle(page);
      assert.equal(await page.locator('.acp-help-shell,.acp-help-body').count(),0,`${destination} removes Help content`);
      await page.evaluate(() => {swal.close();helpFixture.state.rowDetails.activeRowId='';});
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.sweet-alert')).display === 'none');
      await openHelp(page);
      assert.equal(await page.locator('.acp-row-details-shell,.acp-row-details-footer-actions').count(),0,'Returning to Help removes former Details footer and body');
      await closeHelp(page);
    }
    // Responses from a formerly open read-only panel may arrive after Help.
    // They must not replace Help's tree or steal a reader's keyboard focus.
    await openHelp(page);await expandQuestions(page);
    await page.locator('[data-action="help-open-sources"]').click();
    await page.evaluate(() => {window.lateHelpSource=requests.at(-1);});
    await page.waitForSelector('.sweet-alert.acp-appdata-sources-modal.visible');
    await openHelp(page);
    await page.locator('.acp-help-question > summary').first().focus();
    await page.evaluate(() => lateHelpSource.deferred.resolve({ok:true,browser:{root:'/mnt',path:'/mnt',currentPath:'/mnt',entries:[],breadcrumbs:[]}}));
    await settle(page);
    assert.equal(await page.locator('.acp-help-question > summary').first().evaluate(node => document.activeElement === node),true,'Late source response preserves Help focus');
    assert.equal(await page.locator('.acp-help-shell').count(),1,'Late source response cannot replace Help');
    await closeHelp(page);
    for(const outcome of ['resolve','reject']) {
      await page.evaluate(() => {helpFixture.openQuarantineManagerModal(true);window.lateHelpQuarantine=requests.at(-1);});
      await page.waitForSelector('.sweet-alert.acp-quarantine-manager-modal.visible');
      assert.equal(await page.evaluate(() => lateHelpQuarantine.options.data.action),'getQuarantineEntries');
      await closeHelp(page);
      await openHelp(page);
      await page.locator('.acp-help-question > summary').first().focus();
      await page.evaluate(outcome => {
        if(outcome === 'resolve')lateHelpQuarantine.deferred.resolve({ok:true,quarantine:{entries:[{id:'synthetic-entry',name:'Synthetic quarantined folder',originalPath:'/mnt/synthetic/appdata/retired',quarantinePath:'/mnt/synthetic/quarantine/retired',sizeLabel:'1 MB'}],summary:{count:1,sizeLabel:'1 MB'}}});
        else lateHelpQuarantine.deferred.reject({status:500,responseJSON:{message:'Synthetic read-only load failure'}});
      },outcome);
      await settle(page);
      assert.equal(await page.locator('.sweet-alert.acp-help-modal:visible').count(),1,`Late quarantine ${outcome} cannot replace Help`);
      assert.equal(await page.locator('.acp-help-question > summary').first().evaluate(node => document.activeElement === node),true,`Late quarantine ${outcome} preserves reader focus`);
      assert.equal(await page.evaluate(() => helpFixture.state.quarantine.loading),false,'Pending quarantine state is released');
      if(outcome === 'resolve') {
        assert.equal(await page.evaluate(() => helpFixture.state.quarantine.loaded),true,'Late successful read still fills the cache');
        assert.deepEqual(await page.evaluate(() => helpFixture.state.quarantine.entries.map(entry => entry.id)),['synthetic-entry']);
      }
      await closeHelp(page);
    }
    // The same read failure must still be reported while Quarantine is active.
    await page.evaluate(() => {helpFixture.openQuarantineManagerModal(true);});
    await page.waitForSelector('.sweet-alert.acp-quarantine-manager-modal.visible');
    await page.evaluate(() => {requests.at(-1).deferred.reject({status:500,responseJSON:{message:'Synthetic visible quarantine load failure'}});});
    await page.waitForFunction(() => document.querySelector('.sweet-alert > h2').textContent === AppdataCleanupPlus.t(appdataCleanupPlusConfig.strings || {},'quarantineFailedTitle','Quarantine failed'));
    assert.ok((await page.locator('.sweet-alert').textContent()).includes('Synthetic visible quarantine load failure'),'An active quarantine load failure remains visible');
    await closeHelp(page);
    assert.equal(await page.evaluate(() => JSON.stringify(helpFixture.state.settings)),originalSettings,'Help navigation never saves or changes settings');
    // A scan failure resets settings to defaults. Those defaults cannot support
    // a claim about the active cleanup mode until a valid scan is available.
    await page.evaluate(() => {helpFixture.state.scanToken='';});
    for(const permanentDelete of [false,true]) {
      await openHelp(page,permanentDelete);
      assert.equal(await page.locator('.acp-help-mode-state').textContent(),await page.evaluate(() => AppdataCleanupPlus.tr('Mode unavailable')));
      const text=await page.locator('.acp-help-mode-card').textContent();
      assert.ok(text.includes(await page.evaluate(() => AppdataCleanupPlus.tr('Run a successful scan to confirm the current cleanup mode.'))));
      assert.equal(await page.locator('.acp-help-current-action').count(),0,'An unknown scan mode does not claim a current action');
      assert.equal(await page.locator('.acp-help-mode-unavailable').textContent(),await page.evaluate(() => AppdataCleanupPlus.tr('Run a successful scan to confirm the current cleanup mode.')));
      assert.equal(await page.locator('.acp-help-mode-card').evaluate(node => node.classList.contains('is-safe-mode') || node.classList.contains('is-delete-mode')),false,'Unknown mode has no safe/delete presentation');
      await closeHelp(page);
    }
    const actions=await page.evaluate(() => requests.map(request => request.options.data));
    assert.ok(actions.every(data => data.action === 'browseAppdataSourcePath' || data.action === 'getOperationProgress' || data.action === 'getQuarantineEntries' || (data.action === 'fixtureManagerAction' && data.managerAction === 'status')),'Only existing read-only quick-link/recovery requests occur');
    assert.deepEqual(errors,[]);
    console.log(`help_ui: ${options.locale} ${options.version} ${options.width}px; native keyboard, busy guards, read-only quick links, fresh reopen and modal reuse passed.`);
  } finally {await page.close();}
}

(async () => {
  auroraAssets=await readAurora();
  const browser=await chromium.launch({headless:true});
  try {
    if(process.argv.includes('--screenshots-only')) {
      for(const [width,height]of [[1440,900],[390,700]])await layoutCase(browser,{locale:'en_US',version:'7.3',theme:'black',width,height});return;
    }
    if(!process.argv.includes('--interactions-only')) {
      for(const locale of ['en_US','de_DE','ar_AR'])for(const version of ['7.0','7.3'])for(const theme of ['black','white'])for(const [width,height]of [[1440,900],[1920,650],[390,700],[390,520]])await layoutCase(browser,{locale,version,theme,width,height});
      for(const locale of ['en_US','de_DE','ar_AR'])for(const [width,height]of [[1440,900],[390,520]])await layoutCase(browser,{locale,version:'7.3',theme:'black',width,height,aurora:true});
    }
    for(const locale of ['en_US','de_DE','ar_AR'])await interactionsCase(browser,{locale,version:'7.3',width:1440,height:650});
    for(const locale of ['en_US','ar_AR'])await interactionsCase(browser,{locale,version:'7.3',width:390,height:520});
    await interactionsCase(browser,{locale:'en_US',version:'7.0',width:1440,height:650});
  }finally{await browser.close();}
})().catch(error => {console.error(error);process.exitCode=1;});
