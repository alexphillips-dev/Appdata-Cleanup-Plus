// Tools modal behavior with native Unraid and pinned Aurora reference styles.
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
    window.makeFixtureStatus = created => ({
      root:'/mnt/synthetic-appdata/with-a-deliberately-long-source-path-for-layout-validation',rootReasonCode:'ready',
      rootMessage:'Synthetic configured source is available for test data.',createdCount:created ? 3 : 0,
      fixtures:['empty','folder','template'].map((key,index) => ({key,name:`acp-test-${key}`,type:index === 2 ? 'Template-backed folder' : 'Folder',
        path:`/mnt/synthetic-appdata/acp-test-${key}`,exists:created,description:'Synthetic isolated test data for validating the existing cleanup workflow.'})),
      templatePath:'/boot/synthetic-template/acp-fixture.xml',templateExists:created,
      zfsNote:'Synthetic ZFS dataset creation is manual. Exact dataset rows can be reviewed from scan results.'
    });
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
  const hook = 'window.toolsFixture={state,openRowDetailsModal,renderOpenRowDetailsModal,renderResults,openHelpModal,openAppdataSourcesModal,openRecoveredOperation,openToolsModal,openQuarantineManagerModal,openZfsPathMappingsModal,renderToolsModal,runFixtureManagerAction,resetDashboardState,buildHelpModalHtml}; cacheElements(); bindEvents(); loadScan=function(){window.scanRefreshes=(window.scanRefreshes||0)+1;}; loadRecentOperations=function(){};';
  await page.addScriptTag({content:source.replace('$(init);', hook)});
  await page.evaluate(() => {
    AppdataCleanupPlus.applyThemeState($('#acp-app'));
    const F = toolsFixture; F.state.scanToken = 'synthetic-scan'; F.state.dockerRunning = true;
    F.state.rows = [makeDetailsRow('small',4), makeDetailsRow('large',30)];
    F.state.summary = {total:2, safe:2, blocked:0, deletable:2}; F.state.selected = {};
    F.state.fixtureTools={loading:false,ok:null,message:"",status:makeFixtureStatus(false)};
    F.renderResults();
  });
  return {page, errors};
}

async function openTools(page,resolveStatus=true) {
  const requestStart=await page.evaluate(() => requests.length);
  await page.evaluate(() => toolsFixture.openToolsModal());
  await page.waitForSelector('.sweet-alert.acp-tools-modal.visible .acp-tools-body');
  if(resolveStatus && await page.evaluate(start => requests.slice(start).some(request => request.options.data.action === 'fixtureManagerAction' && request.options.data.managerAction === 'status'),requestStart))await respondFixture(page);
  await settle(page);
  assert.equal(await page.locator('.acp-tools-shell').count(),1,'Tools has one content tree');
  assert.equal(await page.locator('.acp-tools-body details[open]').count(),0,'A fresh Tools visit starts with closed disclosures');
  assert.equal(await page.locator('.acp-row-details-footer-actions').count(),0,'Tools has only its native footer');
}

async function closeModal(page,key) {
  await page.waitForSelector('.sweet-alert.visible');
  if(key)await page.keyboard.press(key);
  else await page.locator('.sweet-alert:visible button.confirm').click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.sweet-alert')).display === 'none');
}

async function expandTools(page) {
  await page.locator('.acp-tools-body details[data-tools-section]').evaluateAll(nodes => nodes.forEach(node => {node.open=true;}));
  await settle(page);
}

async function geometry(page) {
  return page.locator('.sweet-alert.acp-tools-modal').evaluate(modal => {
    const rect=node => node.getBoundingClientRect().toJSON(), body=modal.querySelector('.acp-tools-body');
    const scrolling=[modal,...modal.querySelectorAll('*')].filter(node => /auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight+2);
    const nodes=[modal,body,...body.querySelectorAll('p,summary,dt,dd,code,button,.acp-fixture-row,.acp-tools-card,.acp-tools-advanced')];
    return {modal:rect(modal),body:rect(body),title:rect(modal.querySelector(':scope > h2')),footer:rect(modal.querySelector(':scope > .sa-button-container')),
      viewport:{width:innerWidth,height:innerHeight},onlyBody:scrolling.every(node => node === body),scrollCount:scrolling.length,
      overflow:nodes.filter(node => node.scrollWidth > node.clientWidth+2).map(node => ({tag:node.tagName,cls:node.className,client:node.clientWidth,scroll:node.scrollWidth})),
      pageOverflow:document.documentElement.scrollWidth > innerWidth+2,
      direction:getComputedStyle(body).direction,align:getComputedStyle(body).textAlign,
      copyAlign:[...body.querySelectorAll('p,summary,dt,dd')].map(node => getComputedStyle(node).textAlign),
      font:getComputedStyle(body).fontFamily,hostFont:getComputedStyle(modal).fontFamily,
      cards:[...body.querySelectorAll('.acp-tools-primary-grid > *')].map(rect),
      advancedSummary:rect(body.querySelector('.acp-tools-advanced > summary')),advancedTitle:rect(body.querySelector('.acp-tools-advanced-title')),
      columns:getComputedStyle(body.querySelector('.acp-tools-primary-grid')).gridTemplateColumns.split(' ').length};
  });
}

async function assertGeometry(page,label,options,expanded) {
  const top=await geometry(page), expected=['start',options.locale === 'ar_AR' ? 'right' : 'left'];
  assert.ok(top.modal.width <= 1102,`${label}: dialog width is bounded`);
  assert.ok(top.modal.left >= -1 && top.modal.right <= top.viewport.width+1 && top.modal.top >= -1 && top.modal.bottom <= top.viewport.height+1,`${label}: fits viewport`);
  assert.equal(top.onlyBody,true,`${label}: only Tools body scrolls`);
  if(expanded && options.height <= 650)assert.equal(top.scrollCount,1,`${label}: expanded Tools scrolls inside its body`);
  assert.deepEqual(top.overflow,[],`${label}: no nowrap/clipped content`);
  assert.equal(top.pageOverflow,false,`${label}: no horizontal page overflow`);
  assert.equal(top.direction,options.locale === 'ar_AR' ? 'rtl' : 'ltr');
  assert.ok(expected.includes(top.align) && top.copyAlign.every(value => expected.includes(value)),`${label}: copy follows reading direction`);
  if(options.aurora)assert.equal(top.font,top.hostFont,`${label}: inherits Aurora dialog typography`);
  else assert.match(top.font,/clear-sans/i,`${label}: pinned native typography`);
  assert.equal(top.cards.length,2,'Two primary tasks are visible before advanced test data');
  assert.ok(top.advancedTitle.top <= top.advancedSummary.top+3,`${label}: advanced title shares the disclosure marker's first line`);
  if(options.width > 760) {
    assert.equal(top.columns,2);assert.ok(Math.abs(top.cards[0].top-top.cards[1].top) <= 1);
  }else {
    assert.equal(top.columns,1);assert.ok(top.cards[1].top >= top.cards[0].bottom-1,'Mobile primary cards stack');
  }
  assert.ok(top.title.bottom <= top.body.top+2 && top.body.bottom <= top.footer.top+2,`${label}: fixed header/body/footer order`);
  await page.locator('.acp-tools-body').evaluate(node => {node.scrollTop=node.scrollHeight;});
  const bottom=await geometry(page);
  for(const key of ['title','footer'])assert.ok(Math.abs(top[key].top-bottom[key].top) <= 1.5 && Math.abs(top[key].bottom-bottom[key].bottom) <= 1.5,`${label}: ${key} stays fixed`);
  assert.equal(await page.locator('.sweet-alert:visible button.confirm').evaluate(node => {
    const box=node.getBoundingClientRect(),target=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);
    return box.top >= 0 && box.bottom <= innerHeight && (target === node || node.contains(target));
  }),true,`${label}: Done is visible/clickable`);
}

async function screenshot(page,options,expanded) {
  if(options.locale !== 'en_US' || options.version !== '7.3' || options.theme !== 'black' || options.aurora || !((options.width === 1440 && options.height === 900) || (options.width === 390 && options.height === 700)))return;
  const output=path.join(__dirname,'.tmp/acp-tools-redesign-review');fs.mkdirSync(output,{recursive:true});
  await page.locator('.acp-tools-body').evaluate(node => {node.scrollTop=0;});
  await page.screenshot({path:path.join(output,`${options.width === 1440 ? 'desktop' : 'mobile'}-${expanded ? 'expanded' : 'collapsed'}.png`)});
}

async function layoutCase(browser,options) {
  const {page,errors}=await createFixture(browser,options),label=`${options.locale} ${options.version} ${options.theme} ${options.width}x${options.height}${options.aurora ? ' Aurora' : ''}`;
  try {
    await openTools(page);
    assert.equal(await page.locator('details[data-tools-section="test_data"].acp-tools-advanced').count(),1);
    assert.equal(await page.locator('details[data-tools-section="diagnostics_privacy"]').count(),1);
    assert.equal(await page.locator('[data-action="export-diagnostics"]').isVisible(),true);
    assert.equal(await page.locator('[data-action="open-zfs-path-mappings"]').isVisible(),true);
    assert.equal(await page.locator('[data-action="create-test-fixtures"]').isVisible(),false,'Test-data mutations start behind a disclosure');
    await assertGeometry(page,`${label} collapsed`,options,false);await screenshot(page,options,false);
    const advanced=page.locator('[data-tools-section="test_data"]');
    await advanced.locator(':scope > summary').focus();await page.keyboard.press('Enter');
    assert.equal(await advanced.evaluate(node => node.open),true,'Native Enter expands advanced test data');
    await page.keyboard.press('Space');assert.equal(await advanced.evaluate(node => node.open),false,'Native Space collapses advanced test data');
    await expandTools(page);await assertGeometry(page,`${label} expanded`,options,true);await screenshot(page,options,true);
    await closeModal(page);
    const readingRequests=await page.evaluate(() => requests.map(request => ({action:request.options.data.action,managerAction:request.options.data.managerAction})));
    assert.deepEqual(readingRequests,[{action:'fixtureManagerAction',managerAction:'status'}],'Opening Tools refreshes status using only the existing read-only request');
    assert.deepEqual(errors,[]);
    console.log(`tools_ui: ${label}; primary cards, collapsed/expanded native disclosures, typography, body scrolling and fixed header/footer passed.`);
  }finally{await page.close();}
}

async function readingState(page) {
  return page.evaluate(() => ({top:document.querySelector('.acp-tools-body').scrollTop,
    open:[...document.querySelectorAll('.acp-tools-body details[open]')].map(node => node.dataset.toolsSection),
    focus:document.activeElement.closest('details')?.dataset.toolsSection || '',action:document.activeElement.dataset.action || ''}));
}

async function assertReadingState(page,before,label) {
  const after=await readingState(page);
  assert.deepEqual(after.open,before.open,`${label}: disclosure choices survive`);
  assert.equal(after.focus,before.focus,`${label}: focused disclosure survives`);
  assert.equal(after.action,before.action,`${label}: focused action survives`);
  assert.ok(Math.abs(after.top-before.top) <= 2,`${label}: body scroll survives (${before.top} -> ${after.top})`);
}

async function respondFixture(page,{created=false,fail=false,message}={}) {
  await page.evaluate(({created,fail,message}) => {
    const response={ok:!fail,status:makeFixtureStatus(created),message:message || (fail ? 'Synthetic fixture operation failed.' : 'Synthetic fixture status updated.')};
    if(fail)requests.at(-1).deferred.reject({status:500,responseJSON:response});
    else requests.at(-1).deferred.resolve(response);
  },{created,fail,message});
  await settle(page);
}

async function interactionsCase(browser,options) {
  const {page,errors}=await createFixture(browser,options);
  try {
    await page.evaluate(() => {toolsFixture.state.fixtureTools.status=null;});
    await openTools(page,false);
    assert.deepEqual(await page.evaluate(() => ({action:requests.at(-1).options.data.action,managerAction:requests.at(-1).options.data.managerAction})),{action:'fixtureManagerAction',managerAction:'status'});
    await respondFixture(page);
    await expandTools(page);
    const missing=await page.locator('.acp-fixture-row .acp-modal-stat').evaluateAll(nodes => nodes.map(node => ({text:node.textContent,blocked:node.classList.contains('is-blocked'),safe:node.classList.contains('is-safe')})));
    assert.equal(missing.length,3);
    assert.ok(missing.every(row => !row.blocked && !row.safe),'Uncreated test folders have a neutral state');
    assert.equal(await page.locator('.acp-fixture-row .acp-modal-stat').first().textContent(),await page.evaluate(() => AppdataCleanupPlus.tr('Not created')));
    const mappingRequests=await page.evaluate(() => requests.length);
    for(const count of [0,2]) {
      await page.evaluate(count => {
        toolsFixture.state.settings.zfsPathMappings=Array.from({length:count},(_,index) => ({shareRoot:`/mnt/user/synthetic-appdata-${index}`,datasetRoot:`/mnt/synthetic-pool/appdata-${index}`}));
        toolsFixture.renderToolsModal();
      },count);
      assert.equal(await page.locator('.acp-tools-mapping-count').textContent(),await page.evaluate(count => AppdataCleanupPlus.formatCount(count),count),'Mapping count comes from known scan settings');
    }
    await page.evaluate(() => {toolsFixture.state.scanToken='';toolsFixture.renderToolsModal();});
    assert.equal(await page.locator('.acp-tools-mapping-count').count(),0,'Missing scan context does not invent a zero mapping count');
    assert.ok((await page.locator('.acp-tools-mapping-status').textContent()).includes(await page.evaluate(() => AppdataCleanupPlus.tr('Mapping status unavailable'))));
    await page.evaluate(() => {toolsFixture.state.scanToken='synthetic-scan';toolsFixture.state.settings.zfsPathMappings=[];toolsFixture.renderToolsModal();});
    assert.equal(await page.evaluate(() => requests.length),mappingRequests,'Reading mapping status never fetches or saves settings');
    await page.evaluate(() => {
      const status=toolsFixture.state.fixtureTools.status;
      status.fixtures[0].name='<img src=x onerror=alert(1)>';
      status.fixtures[0].path='/mnt/synthetic/<svg onload=alert(1)>';
      status.fixtures[0].description='<script>unexpected()</script>';
      toolsFixture.renderToolsModal();
    });
    assert.equal(await page.locator('.acp-tools-body img,.acp-tools-body script,.acp-tools-body [onerror],.acp-tools-body [onload]').count(),0,'Fixture names/paths/descriptions stay text');
    assert.ok((await page.locator('.acp-tools-body').textContent()).includes('<img src=x onerror=alert(1)>'));
    await page.evaluate(() => {toolsFixture.state.fixtureTools.status=makeFixtureStatus(false);toolsFixture.renderToolsModal();});
    // Every disclosure, primary task, advanced task and Done participates in
    // the native dialog's scoped keyboard cycle, including reverse navigation.
    const count=await page.locator('.sweet-alert summary,.sweet-alert button').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length && !node.disabled).length);
    const seen=new Set();await page.locator('.sweet-alert button.confirm').focus();
    for(let i=0;i<count+2;i++) {
      await page.keyboard.press('Tab');
      const active=await page.evaluate(() => ({inside:!!document.activeElement.closest('.sweet-alert'),tag:document.activeElement.tagName,action:document.activeElement.dataset.action || '',done:document.activeElement.classList.contains('confirm')}));
      assert.equal(active.inside,true);if(active.tag === 'SUMMARY')seen.add('summary');if(active.action)seen.add(active.action);if(active.done)seen.add('done');
    }
    for(const action of ['summary','export-diagnostics','open-zfs-path-mappings','create-test-fixtures','remove-test-fixtures','refresh-test-fixtures','done'])assert.ok(seen.has(action),`Tab reaches ${action}`);
    await page.locator('.sweet-alert button.confirm').focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
    assert.equal(await page.locator('.sweet-alert button.confirm').evaluate(node => document.activeElement === node),true);
    // Use a visible summary focus target while the real pending request replaces
    // the body. Loading must disable mutations without discarding reading state.
    await page.locator('[data-tools-section="test_data"] > summary').focus();
    await page.locator('.acp-tools-body').evaluate(node => {node.scrollTop=Math.min(140,node.scrollHeight-node.clientHeight);});
    const before=await readingState(page);
    await page.evaluate(() => toolsFixture.runFixtureManagerAction('status'));
    await assertReadingState(page,before,'Pending refresh');
    for(const action of ['create-test-fixtures','remove-test-fixtures','refresh-test-fixtures'])assert.equal(await page.locator(`[data-action="${action}"]`).isDisabled(),true);
    const pendingCount=await page.evaluate(() => requests.length);
    await page.locator('[data-action="create-test-fixtures"]').evaluate(node => node.click());
    assert.equal(await page.evaluate(() => requests.length),pendingCount,'Disabled create cannot enqueue another operation');
    await respondFixture(page);
    await assertReadingState(page,before,'Completed refresh');
    await page.locator('[data-action="refresh-test-fixtures"]').click();
    await page.evaluate(() => {requests.at(-1).deferred.resolve({ok:true,status:{...makeFixtureStatus(false),root:'',rootReasonCode:'missing',rootMessage:'Synthetic source storage is unavailable.',fixtures:[]}});});
    await settle(page);
    assert.equal(await page.locator('.acp-tools-root-reason.is-error').isVisible(),true,'Unavailable storage is distinguished from ordinary uncreated test folders');
    assert.ok((await page.locator('.acp-fixture-status').textContent()).includes('Synthetic source storage is unavailable.'));
    for(const action of ['create-test-fixtures','remove-test-fixtures'])assert.equal(await page.locator(`[data-action="${action}"]`).isDisabled(),true,'An unavailable location cannot enable test-data changes');
    await page.evaluate(() => {toolsFixture.state.fixtureTools.status=makeFixtureStatus(false);toolsFixture.state.fixtureTools.message='';toolsFixture.state.fixtureTools.ok=null;toolsFixture.renderToolsModal();});
    for(const outcome of ['reject','empty_success']) {
      await page.locator('[data-action="refresh-test-fixtures"]').click();
      await page.evaluate(outcome => {
        if(outcome === 'reject')requests.at(-1).deferred.reject({status:500,responseJSON:{message:'Synthetic status failure without location'}});
        else requests.at(-1).deferred.resolve({ok:true,message:'Synthetic empty status response'});
      },outcome);
      await settle(page);
      assert.equal(await page.evaluate(() => toolsFixture.state.fixtureTools.status),null,`${outcome}: a fresh status without a location invalidates cached targets`);
      for(const action of ['create-test-fixtures','remove-test-fixtures'])assert.equal(await page.locator(`[data-action="${action}"]`).isDisabled(),true,`${outcome}: invalid status keeps mutations disabled`);
      assert.equal(await page.locator('[data-action="refresh-test-fixtures"]').isDisabled(),false,'Refresh stays available to recover from unknown status');
      await page.locator('[data-action="refresh-test-fixtures"]').click();await respondFixture(page);
      for(const action of ['create-test-fixtures','remove-test-fixtures'])assert.equal(await page.locator(`[data-action="${action}"]`).isDisabled(),false,'A verified fresh location re-enables test-data actions');
    }
    // Create/remove keep the existing request schema and follow-up scan behavior.
    await page.locator('[data-action="create-test-fixtures"]').click();
    assert.equal(await page.evaluate(() => requests.at(-1).options.data.managerAction),'create');
    assert.equal(await page.evaluate(() => requests.at(-1).options.data.path),undefined,'Browser never supplies an arbitrary fixture destination');
    await respondFixture(page,{created:true});
    assert.equal(await page.evaluate(() => scanRefreshes),1,'Successful creation refreshes the scan');
    assert.equal(await page.locator('.acp-fixture-row .acp-modal-stat.is-safe').count(),3,'Created test folders use the success state');
    await page.locator('[data-action="remove-test-fixtures"]').click();
    assert.equal(await page.evaluate(() => requests.at(-1).options.data.managerAction),'remove');
    await respondFixture(page,{created:true,fail:true});
    assert.equal(await page.locator('[data-tools-section="test_data"] .acp-modal-feedback.is-error').isVisible(),true,'A true failure remains visible in advanced test data');
    assert.equal(await page.locator('.sweet-alert.acp-tools-modal:visible').count(),1,'Fixture errors remain inside Tools');
    assert.equal(await page.evaluate(() => scanRefreshes),1,'A failed remove does not refresh the scan');
    await page.locator('[data-action="remove-test-fixtures"]').click();await respondFixture(page);
    assert.equal(await page.evaluate(() => scanRefreshes),2,'Successful removal refreshes the scan');
    assert.equal(await page.locator('.acp-fixture-row .acp-modal-stat.is-blocked').count(),0,'Absent folders after removal remain neutral');
    await closeModal(page);await openTools(page);
    // Every visit refreshes cached status while preserving fresh disclosure defaults.
    await page.evaluate(() => {toolsFixture.state.busy=true;});
    const guardedCount=await page.evaluate(() => requests.length);
    await page.locator('[data-action="export-diagnostics"]').evaluate(node => node.click());
    await page.locator('[data-action="open-zfs-path-mappings"]').evaluate(node => node.click());
    assert.equal(await page.evaluate(() => requests.length),guardedCount);assert.equal(await page.locator('.sweet-alert.acp-tools-modal:visible').count(),1);
    await page.evaluate(() => {toolsFixture.state.busy=false;});
    await closeModal(page);
    for(const outcome of ['resolve','reject']) {
      await page.evaluate(() => {toolsFixture.state.fixtureTools.status=null;});
      await openTools(page,false);
      await page.evaluate(() => {window.lateToolsRequest=requests.at(-1);});
      await closeModal(page);
      await page.evaluate(() => toolsFixture.openHelpModal());await page.waitForSelector('.sweet-alert.acp-help-modal.visible');await settle(page);
      await page.locator('.acp-help-question > summary').first().focus();
      await page.evaluate(outcome => {
        if(outcome === 'resolve')lateToolsRequest.deferred.resolve({ok:true,status:makeFixtureStatus(false)});
        else lateToolsRequest.deferred.reject({status:500,responseJSON:{message:'Synthetic late fixture failure',status:makeFixtureStatus(false)}});
      },outcome);
      await settle(page);
      assert.equal(await page.locator('.sweet-alert.acp-help-modal:visible').count(),1,`Late fixture ${outcome} cannot replace Help`);
      assert.equal(await page.locator('.acp-help-question > summary').first().evaluate(node => document.activeElement === node),true,'Late fixture response preserves Help focus');
      assert.equal(await page.evaluate(() => toolsFixture.state.fixtureTools.loading),false);
      assert.equal(await page.evaluate(() => toolsFixture.state.fixtureTools.status.fixtures.length),3,'Late response still updates the fixture cache');
      await closeModal(page);
    }
    await openTools(page,false);
    await page.evaluate(() => {window.olderToolsStatus=requests.at(-1);});
    await closeModal(page);await openTools(page,false);
    await page.evaluate(() => {window.newerToolsStatus=requests.at(-1);olderToolsStatus.deferred.resolve({ok:true,status:makeFixtureStatus(true)});});
    await settle(page);
    assert.equal(await page.evaluate(() => toolsFixture.state.fixtureTools.loading),true,'An older status response cannot end the newer loading state');
    assert.equal(await page.evaluate(() => toolsFixture.state.fixtureTools.status.createdCount),0,'An older status response cannot replace cached data while the new read is pending');
    assert.equal(await page.locator('[data-action="create-test-fixtures"]').isDisabled(),true,'An outdated status cannot re-enable mutations');
    await page.evaluate(() => {newerToolsStatus.deferred.resolve({ok:true,status:{...makeFixtureStatus(false),root:'/mnt/synthetic-current-source'}});});
    await settle(page);
    assert.equal(await page.evaluate(() => toolsFixture.state.fixtureTools.status.root),'/mnt/synthetic-current-source','The most recent read owns the displayed target');
    await expandTools(page);
    await page.locator('[data-action="create-test-fixtures"]').click();
    await page.evaluate(() => {window.pendingToolsCreate=requests.at(-1);});
    const pendingCreateCount=await page.evaluate(() => requests.length),scansBeforeReopen=await page.evaluate(() => scanRefreshes);
    await page.evaluate(() => {
      const F=toolsFixture;
      window.toolsBeforeReset={rows:F.state.rows,summary:F.state.summary,selected:F.state.selected,scanToken:F.state.scanToken,settings:F.state.settings,dockerRunning:F.state.dockerRunning};
      F.resetDashboardState();
    });
    assert.equal(await page.evaluate(() => toolsFixture.state.fixtureTools.loading),false,'A failed dashboard scan can reset cached fixture loading state');
    await closeModal(page);await openTools(page,false);
    assert.equal(await page.evaluate(() => requests.length),pendingCreateCount,'Reopening Tools never overlaps an in-flight create with a status query');
    assert.equal(await page.evaluate(() => toolsFixture.state.fixtureTools.loading),true,'Tools restores pending mutation progress after a failed scan reset');
    assert.equal(await page.locator('[data-action="remove-test-fixtures"]').isDisabled(),true);
    await page.evaluate(() => {toolsFixture.runFixtureManagerAction('status');toolsFixture.runFixtureManagerAction('remove');});
    assert.equal(await page.evaluate(() => requests.length),pendingCreateCount,'A pending mutation blocks direct status/remove dispatch after reset');
    await page.evaluate(() => {pendingToolsCreate.deferred.resolve({ok:true,status:makeFixtureStatus(true)});});
    await settle(page);
    assert.equal(await page.evaluate(() => scanRefreshes),scansBeforeReopen+1,'The existing pending create completes once and refreshes the scan');
    assert.equal(await page.evaluate(() => toolsFixture.state.fixtureTools.status.createdCount),3);
    assert.equal(await page.locator('[data-tools-section="test_data"]').evaluate(node => node.open),false,'Completing a pending create respects the fresh visit\'s collapsed advanced section');
    await page.evaluate(() => {Object.assign(toolsFixture.state,toolsBeforeReset);toolsFixture.renderResults();});
    await closeModal(page);
    for(const destination of ['mappings','details','recovery']) {
      await openTools(page);await expandTools(page);
      if(destination === 'mappings') {
        await page.locator('[data-action="open-zfs-path-mappings"]').click();
        assert.equal(await page.evaluate(() => requests.at(-1).options.data.action),'browseAppdataSourcePath');
        await page.evaluate(() => requests.at(-1).deferred.resolve({ok:true,browser:{root:'/mnt',currentPath:'/mnt',entries:[],breadcrumbs:[]}}));
      }else {
        await page.evaluate(destination => {
          if(destination === 'details')toolsFixture.openRowDetailsModal(toolsFixture.state.rows[0]);else toolsFixture.openRecoveredOperation('synthetic-operation');
        },destination);
        if(destination === 'recovery')await page.evaluate(() => requests.at(-1).deferred.resolve({ok:true,progress:{status:'complete',operation:'quarantine',completedRoots:0,summary:{},results:[]}}));
      }
      await settle(page);assert.equal(await page.locator('.acp-tools-shell').count(),0,`${destination} replaces Tools`);
      await closeModal(page);await openTools(page);
      assert.equal(await page.locator('.acp-row-details-shell,.acp-row-details-footer-actions').count(),0,'Reopening Tools clears former Details content/actions');
      await closeModal(page);
    }
    // Exercise the actual diagnostics download path with a synthetic redacted
    // server response. The dedicated privacy suites cover the wider scrub rules.
    await openTools(page);
    await page.evaluate(() => {
      URL.createObjectURL=blob => {window.toolsDownloadedBlob=blob;return 'blob:synthetic-tools-diagnostics';};URL.revokeObjectURL=() => {};
      document.addEventListener('click',event => {if(event.target.tagName === 'A' && event.target.download){window.toolsDownloadedFilename=event.target.download;event.preventDefault();}},true);
    });
    await page.locator('[data-action="export-diagnostics"]').click();
    assert.equal(await page.evaluate(() => requests.at(-1).options.data.action),'getDiagnosticsBundle');
    await page.evaluate(() => requests.at(-1).deferred.resolve({ok:true,bundle:{schemaVersion:5,collection:{status:'complete'}}}));
    assert.match(await page.evaluate(() => toolsDownloadedFilename),/^appdata-cleanup-plus-diagnostics-.*\.json$/);
    assert.equal(await page.evaluate(async () => JSON.parse(await toolsDownloadedBlob.text()).schemaVersion),5);
    const actions=await page.evaluate(() => requests.map(request => request.options.data));
    assert.ok(actions.every(data => ['fixtureManagerAction','getDiagnosticsBundle','browseAppdataSourcePath','getOperationProgress'].includes(data.action)),'No cleanup or settings mutation is introduced');
    assert.deepEqual(errors,[]);
    console.log(`tools_ui: ${options.locale} ${options.version} ${options.width}px${options.aurora ? ' Aurora' : ''}; keyboard, fixture lifecycle/guards, reading state, late callbacks, modal reuse and diagnostics download passed.`);
  }finally{await page.close();}
}

(async () => {
  auroraAssets=await readAurora();const browser=await chromium.launch({headless:true});
  try {
    if(process.argv.includes('--screenshots-only')) {for(const [width,height]of [[1440,900],[390,700]])await layoutCase(browser,{locale:'en_US',version:'7.3',theme:'black',width,height});return;}
    if(!process.argv.includes('--interactions-only')) {
      for(const locale of ['en_US','de_DE','ar_AR'])for(const version of ['7.0','7.3'])for(const theme of ['black','white'])for(const [width,height]of [[1440,900],[1920,650],[390,700],[390,520]])await layoutCase(browser,{locale,version,theme,width,height});
      for(const locale of ['en_US','de_DE','ar_AR'])for(const [width,height]of [[1440,900],[390,520]])await layoutCase(browser,{locale,version:'7.3',theme:'black',width,height,aurora:true});
    }
    await interactionsCase(browser,{locale:'en_US',version:'7.0',width:1440,height:650});
    await interactionsCase(browser,{locale:'ar_AR',version:'7.3',width:390,height:520});
    await interactionsCase(browser,{locale:'de_DE',version:'7.3',theme:'black',width:1440,height:650,aurora:true});
  }finally{await browser.close();}
})().catch(error => {console.error(error);process.exitCode=1;});
