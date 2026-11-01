// Details modal behavior with native Unraid and pinned Aurora reference styles.
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
  const hook = 'window.detailsFixture={state,openRowDetailsModal,renderOpenRowDetailsModal,renderResults,openHelpModal,openAppdataSourcesModal,openRecoveredOperation,buildHelpModalHtml}; cacheElements(); bindEvents(); loadScan=function(){window.scanRefreshes=(window.scanRefreshes||0)+1;}; loadRecentOperations=function(){};';
  await page.addScriptTag({content:source.replace('$(init);', hook)});
  await page.evaluate(() => {
    AppdataCleanupPlus.applyThemeState($('#acp-app'));
    const F = detailsFixture; F.state.scanToken = 'synthetic-scan'; F.state.dockerRunning = true;
    F.state.rows = [makeDetailsRow('small',4), makeDetailsRow('large',30)];
    F.state.summary = {total:2, safe:2, blocked:0, deletable:2}; F.state.selected = {};
    F.renderResults();
  });
  return {page, errors};
}

async function openDetails(page, id) {
  await page.evaluate(id => detailsFixture.openRowDetailsModal(detailsFixture.state.rows.find(row => row.id === id)), id);
  await page.waitForSelector(`.acp-row-details-shell[data-row-id="${id}"] .acp-row-details-body`);
  await page.waitForSelector('.sweet-alert.visible'); // Native callback gate opens after its entrance timer.
  await settle(page);
  assert.equal(await page.locator('.sweet-alert:visible').count(), 1);
  assert.equal(await page.locator('.acp-row-details-shell').count(), 1, 'Only one Details content tree');
  assert.equal(await page.locator('.acp-row-details-footer-actions').count(), 1, 'Exactly one fixed custom footer');
  assert.equal(await page.locator('.acp-row-details-body .acp-row-details-actions').count(), 0, 'Actions are outside the scrolling body');
  const icons = await page.evaluate(id => {
    const row = [...document.querySelectorAll('.acp-row')].find(node => node.dataset.rowId === id);
    const icon = document.querySelector('.acp-row-details-icon');
    return {list:row?.querySelector('.acp-row-folder-icon svg')?.outerHTML, details:icon?.querySelector('svg')?.outerHTML,
      ignored:detailsFixture.state.rows.find(item => item.id === id)?.ignored, legacyBefore:icon && getComputedStyle(icon,'::before').content};
  },id);
  assert.ok(icons.details,'Details renders an SVG icon');
  if (icons.list) assert.equal(icons.details,icons.list,'Details uses the exact SVG rendered by the actual results-list row');
  else assert.equal(icons.ignored,true,'Only an ignored item hidden from the results can lack a comparison row');
  assert.ok(!icons.legacyBefore || icons.legacyBefore === 'none' || icons.legacyBefore === 'normal','Details does not layer the old CSS folder glyph over the shared SVG');
}

async function selectedRow(page, id) {
  await page.waitForFunction(id => {
    const row = [...document.querySelectorAll('.acp-row')].find(node => node.dataset.rowId === id);
    return row?.classList.contains('is-selection-highlight') && document.activeElement === row.querySelector('.acp-row-checkbox');
  },id);
  assert.equal(await page.locator('.sweet-alert:visible').count(),0,'Select folder closes native Details');
  assert.equal(await page.evaluate(() => detailsFixture.state.rowDetails.activeRowId),'','Selection clears Details identity');
  const status = await page.evaluate(id => {
    const row = [...document.querySelectorAll('.acp-row')].find(node => node.dataset.rowId === id), checkbox = row.querySelector('.acp-row-checkbox');
    const box = checkbox.getBoundingClientRect(), title = row.querySelector('.acp-row-title').getBoundingClientRect(), style = getComputedStyle(row);
    return {checked:checkbox.checked,label:checkbox.getAttribute('aria-label'),path:detailsFixture.state.rows.find(item => item.id === id).displayPath,
      focus:document.activeElement === checkbox, checkboxVisible:box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth,
      titleVisible:title.top >= 0 && title.bottom <= innerHeight, outlineStyle:style.outlineStyle,outlineWidth:style.outlineWidth,outlineColor:style.outlineColor,animation:style.animationName};
  },id);
  assert.equal(status.checked,true); assert.equal(status.focus,true);
  assert.equal(status.label,status.path,'Focused checkbox has the folder path as its accessible name');
  assert.ok(status.checkboxVisible && status.titleVisible,'Selected row checkbox and title are brought into view');
  assert.equal(status.outlineStyle,'solid'); assert.ok(parseFloat(status.outlineWidth) >= 2);
  assert.notEqual(status.outlineColor,'rgba(0, 0, 0, 0)'); assert.equal(status.animation,'none','Selection feedback has no blinking animation');
  return {style:status.outlineStyle,width:status.outlineWidth,color:status.outlineColor};
}

async function expandDetails(page) {
  await page.locator('.acp-row-details-body details').evaluateAll(nodes => nodes.forEach(node => { node.open = true; }));
  await settle(page);
}

async function modalGeometry(page) {
  return page.locator('.sweet-alert.acp-row-details-modal').evaluate(modal => {
    const rect = node => node.getBoundingClientRect().toJSON();
    const body = modal.querySelector('.acp-row-details-body');
    const scrollable = [modal, ...modal.querySelectorAll('*')].filter(node => /auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 2);
    return {modal:rect(modal),title:rect(modal.querySelector(':scope > h2')),hero:rect(modal.querySelector('.acp-row-details-hero')),body:rect(body),
      footer:rect(modal.querySelector('.sa-button-container')),onlyBodyScroll:scrollable.every(node => node === body),scrollCount:scrollable.length,
      bodyScrolls:body.scrollHeight > body.clientHeight + 2,
      horizontal:[body,modal.querySelector('.acp-row-details-hero')].some(node => node.scrollWidth > node.clientWidth + 2),
      viewport:{width:innerWidth,height:innerHeight}, pageOverflow:document.documentElement.scrollWidth > innerWidth + 2,
      nested: [...modal.querySelectorAll('.acp-row-details-body details')].some(node => /auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 2)};
  });
}

async function assertGeometry(page, label, requireScroll) {
  const top = await modalGeometry(page);
  assert.ok(top.modal.width <= 1102, `${label}: bounded dialog width`);
  assert.ok(top.modal.left >= -1 && top.modal.right <= top.viewport.width + 1 && top.modal.top >= -1 && top.modal.bottom <= top.viewport.height + 1, `${label}: dialog fits viewport`);
  assert.equal(top.onlyBodyScroll, true, `${label}: only the body can scroll vertically`);
  if (requireScroll) {
    assert.equal(top.scrollCount, 1, `${label}: long evidence has one vertical scrolling area`);
    assert.equal(top.bodyScrolls, true, `${label}: long evidence scrolls in body`);
  }
  assert.equal(top.horizontal || top.pageOverflow || top.nested, false, `${label}: no clipped paths, page overflow, or nested disclosure scrollbars`);
  assert.ok(top.title.top >= top.modal.top && top.hero.bottom <= top.body.top + 2 && top.footer.top >= top.body.bottom - 2, `${label}: fixed title/hero/body/footer order`);
  const footer = page.locator('.sweet-alert .sa-button-container');
  assert.equal(await footer.locator('button.confirm').isVisible(), true, `${label}: Done is visible`);
  const point = await footer.locator('button.confirm').evaluate(node => {
    const rect = node.getBoundingClientRect(), target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return node === target || node.contains(target);
  });
  assert.equal(point, true, `${label}: Done receives pointer clicks`);
  await page.locator('.acp-row-details-body').evaluate(node => { node.scrollTop = node.scrollHeight; });
  const bottom = await modalGeometry(page);
  for (const fixed of ['title','hero','footer']) assert.ok(Math.abs(top[fixed].top - bottom[fixed].top) <= 1.5 && Math.abs(top[fixed].bottom - bottom[fixed].bottom) <= 1.5, `${label}: ${fixed} stays fixed while evidence scrolls`);
  assert.equal(bottom.onlyBodyScroll, true);
}

async function closeDone(page) {
  await page.locator('.sweet-alert:visible .sa-button-container button.confirm').click();
  await page.waitForFunction(() => !document.querySelector('.sweet-alert.showSweetAlert'));
  await page.waitForFunction(() => detailsFixture.state.rowDetails.activeRowId === '');
}

async function layoutCase(browser, options) {
  const {page, errors} = await createFixture(browser, options);
  const label = `${options.locale} ${options.version} ${options.theme} ${options.width}x${options.height}${options.aurora ? ' Aurora' : ''}`;
  try {
    for (const id of ['small','large']) {
      await openDetails(page, id);
      const broad = page.locator('[data-detail-section="broad_access"]');
      assert.equal(await broad.evaluate(node => node.open), false, 'Informational access starts collapsed');
      await broad.locator('summary').focus(); await page.keyboard.press('Enter');
      assert.equal(await broad.evaluate(node => node.open), true, 'Native disclosure works from keyboard');
      await expandDetails(page);
      await assertGeometry(page, `${label} ${id}`, id === 'large');
      assert.equal(await page.locator('.acp-row-details-hero .acp-modal-path').textContent(), await page.evaluate(id => detailsFixture.state.rows.find(row => row.id === id).displayPath, id));
      const technicalText = await page.locator('[data-detail-section="technical"]').textContent();
      const forbidden = await page.evaluate(() => ['Dataset','Mountpoint','Child datasets','Snapshots'].map(value => AppdataCleanupPlus.tr(value)));
      for (const field of forbidden) assert.ok(!technicalText.includes(field), `${label}: ordinary folder does not contain an irrelevant empty ${field} field`);
      if (id === 'small' && options.locale === 'en_US' && options.version === '7.3' && options.theme === 'black' && !options.aurora && ((options.width === 1440 && options.height === 900) || (options.width === 390 && options.height === 700))) {
        const output = path.join(__dirname,'.tmp','acp-details-redesign-review');
        fs.mkdirSync(output,{recursive:true});
        await page.locator('.acp-row-details-body').evaluate(node => { node.scrollTop = 0; });
        await page.screenshot({path:path.join(output,options.width === 1440 ? 'desktop-expanded.png' : 'mobile-expanded.png')});
      }
      await closeDone(page);
    }
    assert.deepEqual(await page.evaluate(() => requests.map(request => request.options.data.action)), [], 'Opening, expanding, reading and closing ordinary Details never submits an action');
    assert.deepEqual(errors, []);
    console.log(`details_ui: ${label}; screenshot-sized and long evidence, one body scroll, fixed hero/footer, paths, keyboard and Done passed.`);
  } finally { await page.close(); }
}

async function stateAndActionCases(browser, options) {
  const {page, errors} = await createFixture(browser, options);
  try {
    await page.evaluate(() => {
      const row = makeDetailsRow('async',30); row.zfsMappingMatched = true; row.zfsResolutionMessage = 'Synthetic mapping did not match an exact dataset';
      detailsFixture.state.rows.push(row);
      detailsFixture.renderResults();
    });
    await openDetails(page, 'async');
    assert.equal(await page.evaluate(() => requests.at(-1).options.data.action), 'getCandidateDetails');
    await expandDetails(page);
    const keyboard = await page.evaluate(() => [...document.querySelectorAll('.sweet-alert summary, .sweet-alert button')]
      .filter(node => node.getClientRects().length && !node.disabled).length);
    await page.locator('.sweet-alert .sa-button-container button.confirm').focus();
    const visited = new Set();
    for (let i = 0; i < keyboard + 2; i++) {
      await page.keyboard.press('Tab');
      const active = await page.evaluate(() => ({inside:!!document.activeElement.closest('.sweet-alert'), tag:document.activeElement.tagName, action:document.activeElement.dataset.action || '', confirm:document.activeElement.classList.contains('confirm')}));
      assert.equal(active.inside, true, 'Details keyboard focus stays within the modal');
      if (active.tag === 'SUMMARY') visited.add('summary');
      if (active.action === 'row-detail-select') visited.add('select');
      if (active.action === 'row-detail-ignore') visited.add('ignore');
      if (active.confirm) visited.add('done');
    }
    assert.deepEqual([...visited].sort(), ['done','ignore','select','summary'], 'Native Tab reaches disclosures and every footer action');
    await page.locator('.sweet-alert .sa-button-container button.confirm').focus();
    await page.evaluate(() => { window.focusBeforeReverse = document.activeElement; });
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement === window.focusBeforeReverse), true, 'Shift+Tab reverses the focus cycle');
    await page.locator('[data-detail-section="technical"] > summary').focus();
    await page.locator('.acp-row-details-body').evaluate(node => { node.scrollTop = Math.min(240, node.scrollHeight - node.clientHeight); });
    const before = await page.evaluate(() => ({
      top:document.querySelector('.acp-row-details-body').scrollTop,
      open:[...document.querySelectorAll('.acp-row-details-body details[open]')].map(node => node.dataset.detailSection),
      focus:document.activeElement.closest('details')?.dataset.detailSection
    }));
    assert.ok(before.top > 0);
    await page.evaluate(() => requests.at(-1).deferred.resolve({ok:true,row:{id:'async',sizeLabel:'2 MB',zfsResolutionMessage:'Synthetic mapping did not match an exact dataset'}}));
    await settle(page);
    const after = await page.evaluate(() => ({
      top:document.querySelector('.acp-row-details-body').scrollTop,
      open:[...document.querySelectorAll('.acp-row-details-body details[open]')].map(node => node.dataset.detailSection),
      focus:document.activeElement.closest('details')?.dataset.detailSection
    }));
    assert.ok(Math.abs(after.top - before.top) <= 2, 'Same-row async refresh preserves scroll position');
    assert.deepEqual(after.open, before.open, 'Same-row async refresh preserves disclosure choices');
    assert.equal(after.focus, before.focus, 'Same-row async refresh restores keyboard focus');
    assert.match(await page.locator('.acp-row-details-shell').textContent(), /2 MB/);
    await openDetails(page, 'small');
    assert.equal(await page.locator('.acp-row-details-body').evaluate(node => node.scrollTop), 0, 'Switching rows resets scroll');
    assert.equal(await page.locator('[data-detail-section="technical"]').evaluate(node => node.open), false, 'Switching rows resets optional disclosures');
    const beforeSelect = await page.evaluate(() => requests.length);
    await page.locator('.acp-row-details-footer-actions [data-action="row-detail-select"]').click();
    assert.equal(await page.evaluate(() => !!detailsFixture.state.selected.small), true, 'Fixed footer Select uses the existing local selection flow');
    assert.equal(await page.evaluate(() => requests.length), beforeSelect, 'Select does not mutate files or send an action');
    await selectedRow(page,'small');
    await openDetails(page,'small');
    assert.equal(await page.locator('.acp-row-details-footer-actions [data-action="row-detail-select"]').count(), 1, 'Reopening selected Details never duplicates footer buttons');
    await page.locator('.acp-row-details-footer-actions [data-action="row-detail-ignore"]').click();
    const ignore = await page.evaluate(() => requests.at(-1).options.data);
    assert.equal(ignore.action,'updateCandidateState'); assert.equal(ignore.intent,'ignore'); assert.deepEqual(JSON.parse(ignore.candidateIds),['small']);
    assert.equal(ignore.path,undefined, 'Ignore submits server-issued IDs rather than arbitrary paths');
    await page.evaluate(() => requests.at(-1).deferred.resolve({ok:true,scanToken:'synthetic-scan'}));
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.sweet-alert')).display === 'none');
    await openDetails(page, 'small');
    assert.equal(await page.locator('[data-action="row-detail-select"]').count(), 0);
    await page.locator('.acp-row-details-footer-actions [data-action="row-detail-restore"]').click();
    assert.equal(await page.evaluate(() => requests.at(-1).options.data.intent),'unignore');
    await page.evaluate(() => requests.at(-1).deferred.resolve({ok:true,scanToken:'synthetic-scan'}));
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.sweet-alert')).display === 'none');
    // Reuse the same SweetAlert elements. Old content and footer actions must go.
    for (const destination of ['help','sources','recovery']) {
      await openDetails(page, 'large');
      await page.evaluate(destination => {
        if (destination === 'help') detailsFixture.openHelpModal();
        if (destination === 'sources') detailsFixture.openAppdataSourcesModal();
        if (destination === 'recovery') detailsFixture.openRecoveredOperation('synthetic-operation');
      }, destination);
      if (destination === 'sources') await page.evaluate(() => requests.at(-1).deferred.resolve({ok:true,browser:{root:'/mnt',path:'/mnt',currentPath:'/mnt',entries:[],breadcrumbs:[]}}));
      if (destination === 'recovery') await page.evaluate(() => requests.at(-1).deferred.resolve({ok:true,progress:{status:'complete',operation:'quarantine',completedRoots:0,summary:{},results:[]}}));
      await settle(page);
      assert.equal(await page.locator('.acp-row-details-body, .acp-row-details-footer-actions, .acp-row-details-actions').count(), 0, `${destination}: modal reuse removes old Details structure/actions`);
      assert.equal(await page.locator('.sweet-alert:visible .sa-button-container button.confirm').isVisible(), true, `${destination}: native footer survives reuse`);
      await page.evaluate(() => { swal.close(); detailsFixture.state.rowDetails.activeRowId = ''; });
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.sweet-alert')).display === 'none');
    }
    await page.evaluate(() => {
      const row = makeDetailsRow('late',4); row.zfsMappingMatched = true; detailsFixture.state.rows.push(row);
      detailsFixture.openRowDetailsModal(row); window.lateDetailsRequest = requests.at(-1);
      detailsFixture.openHelpModal();
    });
    await page.evaluate(() => lateDetailsRequest.deferred.resolve({ok:true,row:{id:'late',sizeLabel:'Unexpected late details'}}));
    await settle(page);
    assert.equal(await page.locator('.sweet-alert.acp-help-modal').count(), 1, 'Late detail response cannot replace Help');
    assert.equal(await page.locator('.acp-row-details-shell, .acp-row-details-footer-actions').count(), 0);
    const actions = await page.evaluate(() => requests.map(request => request.options.data.action));
    assert.ok(actions.every(action => ['getCandidateDetails','updateCandidateState','browseAppdataSourcePath','getOperationProgress'].includes(action)), 'No cleanup, settings, or unexpected requests are introduced by the redesign');
    assert.deepEqual(errors, []);
    console.log(`details_ui: ${options.locale} ${options.version || '7.3'} ${options.width}px async state/focus, row reset, select/ignore/unignore, modal reuse and late responses passed.`);
  } finally { await page.close(); }
}

async function evidenceCases(browser) {
  const {page, errors} = await createFixture(browser);
  try {
    const cases = await page.evaluate(() => {
      const mounted = {...makeDetailsRow('mounted',4),canDelete:false,risk:'blocked',securityLockReason:'Synthetic container mounts this path',mountEvidence:[{name:'Fixture owner',paths:['/mnt/user/appdata/synthetic-owner']}],broadMountEvidence:[]};
      const dataset = {...makeDetailsRow('dataset',4),storageKind:'zfs',storageLabel:'ZFS dataset',datasetName:'synthetic-pool/appdata/retired',datasetMountpoint:'/mnt/synthetic-pool/appdata/retired',zfsResolutionKind:'exact_dataset',zfsResolutionDetail:'Synthetic exact identity',zfsImpactSummary:'Synthetic destroy affects children and snapshots',zfsChildDatasets:['synthetic-pool/appdata/retired/child'],zfsSnapshots:['synthetic-pool/appdata/retired@saved'],zfsResolutionVariants:['/mnt/user/appdata/retired','/mnt/synthetic-pool/appdata/retired']};
      const mapped = {...makeDetailsRow('mapped',4),zfsMappingMatched:true,zfsResolutionKind:'no_exact_match',zfsResolutionMessage:'Synthetic no exact dataset match',zfsMatchedShareRoot:'/mnt/user/appdata',zfsMatchedDatasetRoot:'/mnt/synthetic-pool/appdata'};
      const unverified = {...makeDetailsRow('unverified',4),canDelete:false,risk:'blocked',scanVerificationLocked:true,policyReason:'Synthetic ownership verification incomplete'};
      const escaped = {...makeDetailsRow('escaped',4),name:'<img src=x onerror=alert(1)>',displayPath:'/mnt/user/appdata/<script>bad</script>',broadMountEvidence:[{name:'<svg onload=alert(1)>',paths:['/mnt/<img src=x>']}]};
      detailsFixture.state.rows.push(mounted,dataset,mapped,unverified,escaped); detailsFixture.state.settings.enablePermanentDelete = true;
      detailsFixture.renderResults();
      // Already-loaded records exercise the final renderer without manufacturing
      // a backend request for each pure presentation state.
      for (const row of [dataset,mapped]) detailsFixture.state.rowDetails.cache[row.id] = {detailLoaded:true};
      return [mounted,dataset,mapped,unverified,escaped].map(row => row.id);
    });
    for (const id of cases) {
      await openDetails(page, id); await expandDetails(page);
      const text = await page.locator('.acp-row-details-shell').textContent();
      if (id === 'mounted') {
        assert.equal(await page.locator('[data-detail-section="specific_mounts"]').evaluate(node => node.open), true);
        assert.ok(text.includes('Fixture owner') && text.includes('/mnt/user/appdata/synthetic-owner'));
      }
      if (id === 'dataset') for (const value of ['synthetic-pool/appdata/retired','/mnt/synthetic-pool/appdata/retired','Synthetic exact identity','Synthetic destroy affects children and snapshots','synthetic-pool/appdata/retired/child','synthetic-pool/appdata/retired@saved']) assert.ok(text.includes(value), `Dataset Details retains ${value}`);
      if (id === 'mapped') for (const value of ['Synthetic no exact dataset match','/mnt/user/appdata','/mnt/synthetic-pool/appdata']) assert.ok(text.includes(value), 'Mapping-only evidence is retained');
      if (id === 'mounted' || id === 'unverified') assert.equal(await page.locator('[data-action="row-detail-select"]').count(), 0, 'Protected/unknown ownership cannot acquire a selection action');
      if (id === 'unverified') assert.ok(text.includes('Synthetic ownership verification incomplete'));
      if (id === 'escaped') {
        assert.equal(await page.locator('.sweet-alert script, .sweet-alert img, .sweet-alert [onerror], .sweet-alert [onload]').count(), 0, 'Untrusted names/paths remain text');
        assert.ok(text.includes('<img src=x onerror=alert(1)>') && text.includes('<svg onload=alert(1)>'));
      }
      await closeDone(page);
    }
    assert.deepEqual(await page.evaluate(() => requests), [], 'Pure evidence views do not create operations');
    assert.deepEqual(errors, []);
    console.log('details_ui: specific/broad access, dataset impact, mapping-only, verification and escaping evidence passed.');
  } finally { await page.close(); }
}

async function selectionFeedbackCases(browser, options) {
  const {page, errors} = await createFixture(browser,options);
  try {
    await page.emulateMedia({reducedMotion:options.reducedMotion});
    await page.evaluate(() => {
      const rows = Array.from({length:12},(_,index) => ({...makeDetailsRow(`filler-${index}`,0),name:`Fixture ${String(index).padStart(2,'0')}`}));
      rows.push({...makeDetailsRow('target-a',0),name:'Synthetic target A'}, {...makeDetailsRow('target-b',0),name:'Synthetic target B'});
      detailsFixture.state.rows = rows; detailsFixture.state.selected = {};
      detailsFixture.state.summary = {total:rows.length,safe:rows.length,deletable:rows.length,blocked:0}; detailsFixture.renderResults();
      window.feedbackEvents = [];
      let previous = '';
      new MutationObserver(() => {
        const current = document.querySelector('.acp-row.is-selection-highlight')?.dataset.rowId || '';
        if (current !== previous) { feedbackEvents.push({id:current,time:performance.now()}); previous=current; }
      }).observe(document.querySelector('#acp-results'),{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
    });
    assert.ok(await page.locator('.acp-row[data-row-id="target-a"]').evaluate(node => node.getBoundingClientRect().top > innerHeight),'Target starts below the visible results');
    await openDetails(page,'target-a');
    await page.locator('[data-action="row-detail-select"]').click();
    const originalOutline = await selectedRow(page,'target-a');
    assert.deepEqual(await page.evaluate(() => requests),[],'Selection, focus and outline do not submit API requests');
    await page.evaluate(() => detailsFixture.renderResults());
    assert.equal(await page.locator('.acp-row.is-selection-highlight').getAttribute('data-row-id'),'target-a','Results rerender retains the active outline until its deadline');
    const elapsed = await page.evaluate(() => performance.now() - feedbackEvents.find(event => event.id === 'target-a').time);
    await page.waitForTimeout(Math.max(0,2800-elapsed));
    const steady = await page.locator('.acp-row[data-row-id="target-a"]').evaluate(node => {
      const style=getComputedStyle(node); return {present:node.classList.contains('is-selection-highlight'),style:style.outlineStyle,width:style.outlineWidth,color:style.outlineColor};
    });
    assert.equal(steady.present,true,'Outline remains visible near the end of the three-second interval');
    assert.deepEqual({style:steady.style,width:steady.width,color:steady.color},originalOutline,'Outline stays steady throughout its display interval');
    await page.waitForFunction(() => !document.querySelector('.acp-row.is-selection-highlight'));
    const duration = await page.evaluate(() => {
      const first=feedbackEvents.findIndex(event => event.id === 'target-a'); return feedbackEvents.slice(first+1).find(event => event.id === '').time-feedbackEvents[first].time;
    });
    assert.ok(duration >= 2990,`Outline lasts three seconds within browser callback resolution (${duration}ms)`);
    // A second selection replaces the old timer and highlights only its row.
    await openDetails(page,'target-a'); await page.locator('[data-action="row-detail-select"]').click(); await selectedRow(page,'target-a');
    const oldAdded = await page.evaluate(() => feedbackEvents.filter(event => event.id === 'target-a').at(-1).time);
    await openDetails(page,'target-b'); await page.locator('[data-action="row-detail-select"]').click(); await selectedRow(page,'target-b');
    assert.equal(await page.locator('.acp-row.is-selection-highlight').count(),1);
    assert.equal(await page.locator('.acp-row[data-row-id="target-a"]').evaluate(node => node.classList.contains('is-selection-highlight')),false,'Repeated selection removes the previous outline');
    const remaining = await page.evaluate(added => Math.max(0,3050-(performance.now()-added)),oldAdded);
    await page.waitForTimeout(remaining);
    assert.equal(await page.locator('.acp-row.is-selection-highlight').getAttribute('data-row-id'),'target-b','Previous selection expiry cannot clear the newest outline');
    await page.evaluate(() => { detailsFixture.state.selected['target-b']=false; detailsFixture.renderResults(); });
    assert.equal(await page.locator('.acp-row.is-selection-highlight').count(),0,'Deselecting and redrawing clears selection feedback');
    await page.evaluate(() => detailsFixture.renderResults());
    assert.equal(await page.locator('.acp-row.is-selection-highlight').count(),0,'A later redraw cannot revive the deselected outline');
    assert.deepEqual(await page.evaluate(() => requests),[]);
    assert.deepEqual(errors,[]);
    console.log(`details_ui: ${options.locale} ${options.version} ${options.width}px ${options.reducedMotion}; shared SVG, close/reveal/focus, steady three-second outline, rerender, replacement and deselection passed.`);
  } finally { await page.close(); }
}

(async () => {
  auroraAssets = await readAurora();
  const browser = await chromium.launch({headless:true});
  try {
    if (process.argv.includes('--screenshots-only')) {
      for (const [width,height] of [[1440,900],[390,700]]) await layoutCase(browser,{locale:'en_US',version:'7.3',theme:'black',width,height});
      return;
    }
    if (!process.argv.includes('--interactions-only')) {
      for (const locale of ['en_US','de_DE','ar_AR']) for (const version of ['7.0','7.3']) for (const theme of ['black','white']) for (const [width,height] of [[1440,900],[1920,650],[390,700],[390,520]]) await layoutCase(browser,{locale,version,theme,width,height});
      for (const locale of ['en_US','de_DE','ar_AR']) for (const [width,height] of [[1440,900],[390,520]]) await layoutCase(browser,{locale,version:'7.3',theme:'black',width,height,aurora:true});
    }
    for (const locale of ['en_US','de_DE','ar_AR']) await stateAndActionCases(browser,{locale,width:1440,height:650});
    for (const locale of ['en_US','ar_AR']) await stateAndActionCases(browser,{locale,width:390,height:520});
    await stateAndActionCases(browser,{locale:'en_US',version:'7.0',width:1440,height:650});
    await evidenceCases(browser);
    await selectionFeedbackCases(browser,{locale:'en_US',version:'7.3',width:1440,height:650,reducedMotion:'no-preference'});
    await selectionFeedbackCases(browser,{locale:'ar_AR',version:'7.0',width:390,height:520,reducedMotion:'reduce'});
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
