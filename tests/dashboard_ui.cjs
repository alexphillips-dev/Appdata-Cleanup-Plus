// Browser coverage for dashboard explanations and Aurora's duplicate heading.
// Dependencies and upstream reference assets are test-only, never packaged.
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
const auroraRef = '783dd3b68842efbc66ff4edbeef25159507f7bc1';
const nativeRef = '41e8d5ad5db20b0e9aeea4334b39bea56729579a';
const references = {
  'enhance.js': ['plugin/src/scripts/enhance.js', 'e222bf562c547f0fc7e4809dd7335028b129365558b69eff32a64f676fa02452'],
  'enhance.css': ['plugin/src/styles/enhance.css', '79eb69e8e844566ef4599ce2f36869c49bc90093f5372d4a9935efcce57dfd0d'],
  'theme.css': ['unraid-tapeory.css', 'd2d88802c0a39f088dfe41b944e3d519183ace9714d11dcb7ca24642937b35eb']
};
const nativeCache = new Map();
const rendered = new Map();
let aurora;

async function readAuroraReferences() {
  const values = await Promise.all(Object.entries(references).map(async ([name, [source, expected]]) => {
    let buffer;
    if (process.env.ACP_AURORA_REFERENCE_DIR) buffer = fs.readFileSync(path.join(process.env.ACP_AURORA_REFERENCE_DIR, name));
    else {
      const response = await fetch(`https://raw.githubusercontent.com/Tunefish92/Aurora-Theme/${auroraRef}/${source}`, {signal:AbortSignal.timeout(30000)});
      assert.ok(response.ok, `Pinned Aurora reference unavailable: ${source} (${response.status})`);
      buffer = Buffer.from(await response.arrayBuffer());
    }
    assert.equal(crypto.createHash('sha256').update(buffer).digest('hex'), expected, `Pinned Aurora ${name} bytes changed`);
    return [name, buffer.toString('utf8')];
  }));
  return Object.fromEntries(values);
}

async function nativeCss(theme) {
  if (!nativeCache.has(theme)) {
    const files = ['default-color-palette.css', 'default-base.css', 'jquery.sweetalert.css', 'default-dynamix.css', `themes/${theme}.css`];
    nativeCache.set(theme, (await Promise.all(files.map(async file => {
      if (process.env.ACP_NATIVE_THEME_DIR) return fs.readFileSync(path.join(process.env.ACP_NATIVE_THEME_DIR, '7.3', file.replace('/', '-')), 'utf8');
      const response = await fetch(`https://raw.githubusercontent.com/unraid/webgui/${nativeRef}/emhttp/plugins/dynamix/styles/${file}`, {signal:AbortSignal.timeout(30000)});
      assert.ok(response.ok, `Pinned native stylesheet unavailable: ${file} (${response.status})`);
      return response.text();
    }))).join('\n'));
  }
  return nativeCache.get(theme);
}

async function settled(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(document.getAnimations().filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
  });
}

async function addAurora(page, {marker = true, script = true, foreign = false} = {}) {
  await page.addStyleTag({url:`${origin}/plugins/Aurora-Theme/styles/theme.css`});
  if (marker) await page.evaluate(() => document.documentElement.classList.add('tp-enhance'));
  if (script) {
    await page.addStyleTag({url:`${origin}/plugins/Aurora-Theme/styles/enhance.css`});
    // Run the real upstream entry point; it obtains Settings, the page title,
    // and the direct #displaybox child placement from the actual fixture host.
    await page.addScriptTag({url:`${foreign ? 'https://foreign.example' : origin}/plugins/Aurora-Theme/scripts/enhance-123456.js`});
    assert.equal(await page.locator('#displaybox > .tp-heading').count(), 1, 'Actual Aurora enhancer creates one heading');
    assert.equal(await page.locator('#displaybox > .tp-heading h1').textContent(), 'Appdata Cleanup Plus');
  }
}

async function createPage(browser, {locale = 'en_US', theme = 'black', width = 1920, touch = false, before = null} = {}) {
  const page = await browser.newPage({viewport:{width, height:1000}, hasTouch:touch});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === '/Settings/AppdataCleanupPlus') return route.fulfill({contentType:'text/html', body:'<!doctype html><html><head></head><body></body></html>'});
    const asset = url.pathname.match(/^\/plugins\/Aurora-Theme\/(scripts|styles)\/(enhance(?:-\d+)?\.js|enhance\.css|theme\.css)$/);
    if (asset && (url.origin === origin || url.origin === 'https://foreign.example')) {
      const name = asset[2].replace(/-\d+(?=\.js$)/, '');
      return route.fulfill({contentType:asset[1] === 'scripts' ? 'text/javascript' : 'text/css', body:aurora[name]});
    }
    return route.abort(); // No live Unraid endpoints, fonts, images, or actions.
  });
  await page.goto(`${origin}/Settings/AppdataCleanupPlus`);
  const key = `${locale}/${theme}`;
  if (!rendered.has(key)) rendered.set(key, execFileSync('php', [path.join(__dirname, 'render_i18n_page.php'), locale, theme], {encoding:'utf8', maxBuffer:4e6}));
  await setFixtureContent(page, rendered.get(key));
  await page.evaluate(() => {
    document.title = 'Synthetic server / Settings';
    window.auroraPageTitle = 'Appdata Cleanup Plus';
    const root = document.querySelector('#acp-app');
    const host = document.createElement('div'); host.id = 'displaybox';
    host.innerHTML = '<div class="content"><div class="title" id="fixture-native-title"><span class="left"><i class="fa fa-th title"></i>Appdata Cleanup Plus</span><span class="right"><button type="button" id="fixture-native-action">Native help</button></span></div><link rel="stylesheet" href="data:text/css,"></div>';
    root.before(host); host.firstElementChild.append(root);
    const menu = document.createElement('div'); menu.id = 'menu';
    menu.innerHTML = '<div class="nav-item active"><a href="/Settings">Settings</a></div>';
    document.body.prepend(menu);
    document.querySelector('#fixture-native-action').addEventListener('click', () => { window.nativeHelpClicks = (window.nativeHelpClicks || 0) + 1; });
  });
  await page.addStyleTag({content:await nativeCss(theme)});
  await page.addStyleTag({path:path.join(plugin, 'styles/appdata.cleanup.plus.css')});
  if (before) await addAurora(page, before);
  await page.addScriptTag({path:require.resolve(dependency('jquery/dist/jquery.js'))});
  await page.evaluate(() => {
    window.fixtureRequests = [];
    $.ajax = options => { fixtureRequests.push(options.data); return $.Deferred().promise(); };
  });
  for (const name of ['appdata.cleanup.plus.shared.js', 'appdata.cleanup.plus.panels.js']) await page.addScriptTag({path:path.join(plugin, 'scripts', name)});
  const main = fs.readFileSync(path.join(plugin, 'scripts/appdata.cleanup.plus.js'), 'utf8');
  assert.equal(main.split('$(init);').length, 2, 'Intercept only plugin initialization');
  const hook = 'window.dashboardFixture={cacheElements,bindEvents,renderSummaryCards,renderPanels,renderResults,updateActionBar,installAuroraHeaderSync,syncAuroraHeader,state};';
  await page.addScriptTag({content:main.replace('$(init);', hook)});
  await page.evaluate(() => {
    const F = dashboardFixture, ACP = AppdataCleanupPlus;
    F.cacheElements(); F.bindEvents(); F.installAuroraHeaderSync();
    ACP.applyThemeState($('#acp-app'));
    ACP.watchThemeChanges(F.syncAuroraHeader);
    F.state.scanToken = 'synthetic-scan-token'; F.state.dockerRunning = true;
    F.state.scanVerification = 'verified'; F.state.showIgnored = true;
    F.state.rows = [
      {id:'ready', name:'Available fixture', path:'/mnt/user/appdata/available', displayPath:'/mnt/user/appdata/available', sourceKind:'filesystem', sourceLabel:ACP.tr('Discovery'), sourceNames:[], targetPaths:[], templateRefs:[], canDelete:true, storageKind:'filesystem', risk:'safe', status:'orphaned', sizeLabel:'1 MB'},
      {id:'protected', name:'Protected fixture', path:'/mnt/user/appdata/protected', displayPath:'/mnt/user/appdata/protected', sourceKind:'template', sourceLabel:ACP.tr('Template'), sourceNames:['Saved fixture'], targetPaths:[], templateRefs:[], canDelete:false, storageKind:'filesystem', risk:'blocked', policyLocked:true, securityLockReason:'Synthetic ownership protection', mountEvidence:[{name:'Fixture mapper', paths:['/mnt/user/appdata/protected']}]},
      {id:'ignored', name:'Ignored fixture', path:'/mnt/user/appdata/ignored', displayPath:'/mnt/user/appdata/ignored', sourceKind:'filesystem', sourceLabel:ACP.tr('Discovery'), sourceNames:[], targetPaths:[], templateRefs:[], canDelete:false, storageKind:'filesystem', risk:'safe', ignored:true}
    ];
    F.state.summary = {total:2, safe:1, review:0, blocked:1, deletable:1, ignored:1};
    F.state.selected = {ready:true};
    F.renderSummaryCards(); F.renderPanels(); F.renderResults(); F.updateActionBar();
  });
  await settled(page);
  return {page, errors};
}

async function waitHeader(page, hidden) {
  await page.waitForFunction(expected => {
    const heading = document.querySelector('#displaybox > .tp-heading');
    return !!heading && (getComputedStyle(heading).display === 'none') === expected;
  }, hidden);
}

async function assertNativePreserved(page) {
  assert.equal(await page.locator('#fixture-native-title > .left').isVisible(), true, 'Native icon-and-title bar is preserved');
  assert.equal(await page.locator('#fixture-native-action').isVisible(), true, 'Native header actions are preserved');
  assert.equal(await page.locator('#menu .nav-item.active a').isVisible(), true, 'Native navigation is preserved');
  assert.equal(await page.locator('#acp-app .acp-title').isVisible(), true, 'Plugin hero is preserved');
  await page.locator('#fixture-native-action').click();
  assert.ok(await page.evaluate(() => window.nativeHelpClicks > 0), 'Native header action still receives real clicks');
}

async function headerCases(browser) {
  for (const before of [true, false]) {
    const {page, errors} = await createPage(browser, {before:before ? {} : null});
    try {
      if (!before) await addAurora(page);
      await waitHeader(page, true);
      await assertNativePreserved(page);
      const marker = await page.locator('#displaybox > .tp-heading').getAttribute('data-acp-aurora-duplicate');
      assert.equal(marker, 'true', 'Only confirmed Aurora duplicate receives the suppression marker');
      // Re-running the actual enhancer preserves its own heading idempotence.
      await page.addScriptTag({url:`${origin}/plugins/Aurora-Theme/scripts/enhance-654321.js`});
      assert.equal(await page.locator('#displaybox > .tp-heading').count(), 1);
      await waitHeader(page, true);
      await page.evaluate(() => {
        const button = document.createElement('button'); button.id = 'fixture-aurora-action'; button.textContent = 'Theme action';
        button.addEventListener('click', () => { window.auroraActionClicks = (window.auroraActionClicks || 0) + 1; });
        document.querySelector('#displaybox > .tp-heading').append(button);
      });
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#displaybox > .tp-heading')).display !== 'none');
      assert.equal(await page.locator('#displaybox > .tp-heading > .tp-heading-text').isVisible(), false, 'Hide duplicate text while retaining Aurora actions');
      await page.locator('#fixture-aurora-action').click();
      assert.ok(await page.evaluate(() => window.auroraActionClicks > 0));
      await page.evaluate(() => {
        const button = document.createElement('button'); button.id = 'fixture-aurora-text-action'; button.textContent = 'Text action';
        document.querySelector('#displaybox > .tp-heading > .tp-heading-text').append(button);
      });
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#displaybox > .tp-heading > .tp-heading-text')).display !== 'none');
      assert.equal(await page.locator('#fixture-aurora-text-action').isVisible(), true, 'Interactive text wrappers are never hidden');
      await page.evaluate(() => document.documentElement.classList.remove('tp-enhance'));
      await waitHeader(page, false);
      assert.equal(await page.locator('[data-acp-aurora-duplicate]').count(), 0, 'Disabling Aurora restores marked nodes');
      await page.evaluate(() => {
        document.querySelector('#fixture-aurora-action').remove(); document.querySelector('#fixture-aurora-text-action').remove();
        document.documentElement.classList.add('tp-enhance');
      });
      await waitHeader(page, true);
      await page.evaluate(() => document.querySelectorAll('script[src*="/plugins/Aurora-Theme/scripts/"]').forEach(node => node.remove()));
      await waitHeader(page, false);
      assert.equal(await page.locator('[data-acp-aurora-duplicate]').count(), 0, 'Removing the Aurora asset restores the heading');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
  for (const options of [{marker:false}, {foreign:true}, {script:false}]) {
    const {page, errors} = await createPage(browser);
    try {
      await addAurora(page, options);
      if (options.script !== false) await waitHeader(page, false);
      assert.equal(await page.locator('[data-acp-aurora-duplicate]').count(), 0, 'Inactive, colors-only, and foreign-origin Aurora lookalikes do not suppress headings');
      await assertNativePreserved(page);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
  const {page, errors} = await createPage(browser);
  try {
    await page.evaluate(() => {
      document.querySelector('#acp-app').remove();
      document.querySelector('#fixture-native-title > .left').lastChild.textContent = 'Other settings page';
    });
    await addAurora(page);
    await waitHeader(page, false);
    assert.equal(await page.locator('[data-acp-aurora-duplicate]').count(), 0, 'Other settings pages remain untouched');
    assert.equal(await page.locator('#fixture-native-title').isVisible(), true);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
  console.log('dashboard_ui: real pinned Aurora heading; early/late load, guards, native headers/actions and restoration passed.');
}

async function assertDashboard(page, locale, width) {
  const values = await page.locator('.acp-summary-value').allTextContents();
  const expected = await page.evaluate(() => [2,1,1,1].map(count => AppdataCleanupPlus.formatCount(count)));
  assert.deepEqual(values, expected, `${locale}: live summary counts exclude ignored rows from Detected`);
  assert.equal(await page.locator('.acp-summary-description').count(), 4);
  assert.ok((await page.locator('.acp-summary-description').allTextContents()).every(text => text.trim().length > 0), 'Every card explains its count');
  const buttons = page.locator('.acp-summary-info');
  assert.equal(await buttons.count(), 4);
  const relationships = await buttons.evaluateAll(nodes => nodes.map(node => ({
    label:node.getAttribute('aria-label'), expanded:node.getAttribute('aria-expanded'), id:node.getAttribute('aria-describedby'),
    svg:node.querySelectorAll('svg').length, box:node.getBoundingClientRect().toJSON()
  })));
  assert.equal(new Set(relationships.map(item => item.id)).size, 4, 'Tooltip descriptions have distinct targets');
  for (const item of relationships) {
    assert.ok(item.label && item.id, 'Info buttons have accessible names and descriptions');
    assert.equal(item.expanded, 'false'); assert.equal(item.svg, 1);
    const tooltip = page.locator(`[id="${item.id}"]`);
    assert.equal(await tooltip.count(), 1); assert.equal(await tooltip.getAttribute('role'), 'tooltip');
    assert.equal(await tooltip.isVisible(), false);
    assert.ok((await tooltip.textContent()).trim().length > 20, 'Tooltips contain a useful explanation');
    assert.ok(item.box.width >= (width <= 760 ? 44 : 36) && item.box.height >= (width <= 760 ? 44 : 36), 'Info target remains usable on desktop and touch');
  }
  assert.equal(await page.locator('.acp-row-badges .acp-badge-kind-actionability, .acp-row-badges .acp-badge-kind-status').count(), 0, 'Source omits Ready and other status badges');
  for (const source of await page.locator('.acp-row-badges').allTextContents()) {
    assert.ok(!source.includes(await page.evaluate(() => AppdataCleanupPlus.tr('Ready'))), 'Ready does not leak into Source');
  }
  const geometry = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('.acp-summary-card')];
    const cards = nodes.map(node => node.getBoundingClientRect().toJSON());
    const mode = document.querySelector('.acp-mode-card').getBoundingClientRect().toJSON();
    const textFits = nodes.every(node => {
      const box = node.getBoundingClientRect();
      return [...node.querySelectorAll('.acp-summary-label, .acp-summary-value, .acp-summary-subtitle, .acp-summary-description')].every(text => {
        const range = document.createRange(); range.selectNodeContents(text);
        return [...range.getClientRects()].every(rect => rect.left >= box.left - 1 && rect.right <= box.right + 1 && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1);
      });
    });
    return {cards, mode, textFits, overflow:document.documentElement.scrollWidth > innerWidth + 2, direction:getComputedStyle(document.querySelector('#acp-app')).direction};
  });
  assert.equal(geometry.overflow, false, `${locale} ${width}px: no horizontal page overflow`);
  assert.equal(geometry.textFits, true, `${locale} ${width}px: card descriptions and counts are not clipped`);
  assert.equal(geometry.direction, locale === 'ar_AR' ? 'rtl' : 'ltr');
  if (width === 1920) {
    for (const card of geometry.cards) {
      assert.ok(Math.abs(card.top - geometry.mode.top) <= 1.5, `${locale}: summary and Safe Mode share the same row`);
      assert.ok(Math.abs(card.height - geometry.mode.height) <= 1.5, `${locale}: all four summaries match Safe Mode height`);
    }
  }
}

async function tooltipState(page, index, visible) {
  await page.waitForFunction(({index, visible}) => {
    const button = document.querySelectorAll('.acp-summary-info')[index];
    if (!button) return false;
    const tooltip = document.getElementById(button.getAttribute('aria-describedby'));
    return !!tooltip && !tooltip.hidden === visible && (getComputedStyle(tooltip).display !== 'none') === visible && button.getAttribute('aria-expanded') === String(visible);
  }, {index, visible});
}

async function assertTooltipBounds(page, index) {
  const result = await page.locator('.acp-summary-info').nth(index).evaluate(button => {
    const tooltip = document.getElementById(button.getAttribute('aria-describedby'));
    const box = tooltip.getBoundingClientRect();
    return {position:getComputedStyle(tooltip).position, left:box.left, top:box.top, right:box.right, bottom:box.bottom, width:innerWidth, height:innerHeight};
  });
  assert.equal(result.position, 'fixed');
  assert.ok(result.left >= 0 && result.top >= 0 && result.right <= result.width + 1 && result.bottom <= result.height + 1, 'Tooltip stays inside the viewport');
}

async function exerciseTooltips(page, touch) {
  const first = page.locator('.acp-summary-info').first();
  if (!touch) {
    await first.hover(); await tooltipState(page, 0, true); await assertTooltipBounds(page, 0);
    const id = await first.getAttribute('aria-describedby');
    await page.locator(`[id="${id}"]`).hover();
    await tooltipState(page, 0, true); // Pointer can enter and read the popup.
    await page.mouse.move(0, 0); await tooltipState(page, 0, false);
    await first.focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
    assert.equal(await first.evaluate(node => node.matches(':focus-visible')), true, 'Keyboard modality reaches the info control');
    assert.notEqual(await first.evaluate(node => getComputedStyle(node).outlineStyle), 'none', 'Keyboard focus ring is visible');
    await tooltipState(page, 0, true);
    await page.keyboard.press('Escape'); await tooltipState(page, 0, false);
  }
  await page.locator('#acp-search').click();
  if (touch) await first.tap(); else await first.click();
  await tooltipState(page, 0, true); await assertTooltipBounds(page, 0);
  await page.mouse.move(0, 0); await tooltipState(page, 0, true); // Click pins it.
  await page.locator('#acp-search').click(); await tooltipState(page, 0, false);
  const last = page.locator('.acp-summary-info').last();
  if (touch) await last.tap(); else await last.click();
  await tooltipState(page, 3, true); await assertTooltipBounds(page, 3);
  await page.mouse.move(0, 0); await tooltipState(page, 3, true);
  await page.evaluate(() => dashboardFixture.renderSummaryCards());
  await tooltipState(page, 3, false);
  assert.equal(await page.locator('.acp-summary-info[aria-expanded="true"]').count(), 0, 'Rerender closes every tooltip');
  if (touch) await page.locator('.acp-summary-info').last().tap(); else await page.locator('.acp-summary-info').last().click();
  await tooltipState(page, 3, true);
  if (touch) await page.locator('.acp-summary-info').last().tap(); else await page.locator('.acp-summary-info').last().click();
  await tooltipState(page, 3, false);
  await page.locator('#acp-search').click(); await tooltipState(page, 3, false);
  assert.deepEqual(await page.evaluate(() => fixtureRequests), [], 'Dashboard information never submits an action');
}

(async () => {
  aurora = await readAuroraReferences();
  const browser = await chromium.launch({headless:true});
  try {
    await headerCases(browser);
    for (const locale of ['en_US', 'de_DE', 'ar_AR']) for (const theme of ['black', 'white']) for (const width of [1920, 390]) {
      const {page, errors} = await createPage(browser, {locale, theme, width, touch:width === 390});
      try {
        for (const deleteMode of [false, true]) {
          await page.evaluate(enabled => {
            dashboardFixture.state.settings.enablePermanentDelete = enabled;
            dashboardFixture.renderSummaryCards(); dashboardFixture.renderPanels();
          }, deleteMode);
          await settled(page);
          await assertDashboard(page, locale, width);
        }
        await exerciseTooltips(page, width === 390);
        await addAurora(page);
        await waitHeader(page, true);
        for (const deleteMode of [false, true]) {
          await page.evaluate(enabled => {
            dashboardFixture.state.settings.enablePermanentDelete = enabled;
            dashboardFixture.renderSummaryCards(); dashboardFixture.renderPanels();
          }, deleteMode);
          await settled(page);
          await assertDashboard(page, locale, width);
        }
        await exerciseTooltips(page, width === 390);
        assert.deepEqual(errors, []);
        console.log(`dashboard_ui: ${locale} ${theme} ${width}px native/Aurora; both modes, equal heights, counts, Source and accessible tooltips passed.`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
