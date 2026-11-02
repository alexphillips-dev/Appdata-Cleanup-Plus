// Diagnostics export behavior with native Unraid and pinned Aurora reference styles.
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
    $.ajax = options => { const deferred = $.Deferred(); if(window.throwExportApi && options.data.action === "getDiagnosticsBundle")throw new Error("Synthetic private API failure"); requests.push({options,deferred}); return deferred.promise(); };
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
  const hook = 'window.exportFixture={state,openRowDetailsModal,renderOpenRowDetailsModal,renderResults,openHelpModal,openAppdataSourcesModal,openRecoveredOperation,openToolsModal,openQuarantineManagerModal,openZfsPathMappingsModal,renderToolsModal,runFixtureManagerAction,resetDashboardState,exportDiagnostics,completeDiagnosticsExport,buildDiagnosticsPayload,recordDiagnosticsFailure,installDiagnosticsErrorCapture,recordDiagnosticsActivity,buildDiagnosticsActivity,getExportState:function(){return diagnosticsExportState;},buildHelpModalHtml}; cacheElements(); bindEvents(); installDiagnosticsErrorCapture(); var testOriginalBrowserCollector=buildDiagnosticsPayload; exportFixture.failBrowserCollector=function(enabled){buildDiagnosticsPayload=enabled?function(){throw new Error("Synthetic private collector failure");}:testOriginalBrowserCollector;}; loadScan=function(){window.scanRefreshes=(window.scanRefreshes||0)+1;}; loadRecentOperations=function(){};';
  await page.addScriptTag({content:source.replace('$(init);', hook)});
  await page.evaluate(() => {
    AppdataCleanupPlus.applyThemeState($('#acp-app'));
    const F = exportFixture; F.state.scanToken = 'synthetic-scan'; F.state.dockerRunning = true;
    F.state.rows = [makeDetailsRow('small',4), makeDetailsRow('large',30)];
    F.state.summary = {total:2, safe:2, blocked:0, deletable:2}; F.state.selected = {};
    F.state.fixtureTools={loading:false,ok:null,message:"",status:makeFixtureStatus(false)};
    F.state.auditHistoryLoaded=true;
    F.state.scanVerification='verified';
    F.state.scanMetrics={startedAt:'2026-11-01T12:00:00Z',totalMs:10,phases:[]};
    appdataCleanupPlusConfig.pluginVersion='2026.11.01.06';
    window.exportBlobs=[];window.exportDownloads=[];
    URL.createObjectURL=blob => {if(window.throwExportBlob)throw new Error('Synthetic private Blob failure');exportBlobs.push(blob);return `blob:synthetic-export-${exportBlobs.length}`;};
    URL.revokeObjectURL=() => {};
    document.addEventListener('click',event => {if(event.target.tagName==='A' && event.target.download){exportDownloads.push({filename:event.target.download});event.preventDefault();}},true);
    window.makeExportBundle=() => ({schemaVersion:5,generatedAt:'2026-11-01T12:01:00Z',redaction:{enabled:true,version:3},
      runtime:{pluginVersion:'2026.11.01.06',phpVersion:'8.3',unraidVersion:'7.3'},
      currentSnapshot:{status:'valid',collectedAt:'2026-11-01T12:01:00Z',issuedAt:'2026-11-01T12:00:00Z',expiresAt:'2026-11-01T12:15:00Z',candidateCount:2},
      state:{latestScanMetrics:{data:{startedAt:'2026-11-01T12:00:00Z',totalMs:10,phases:[]}}},
      collection:{status:'complete',sections:{runtime:{status:'complete'},currentSnapshot:{status:'complete'},latestScanMetrics:{status:'complete'},troubleshooting:{status:'complete'},logs:{status:'complete'}}},
      troubleshooting:{overview:{status:'ok',headline:'Synthetic runtime checks passed.',statusCounts:{ok:1,info:0,warning:0,error:0}},checks:[]},logs:[]});
    F.renderResults();
  });
  return {page, errors};
}

async function openTools(page) {
  const start=await page.evaluate(() => requests.length);
  await page.evaluate(() => exportFixture.openToolsModal());
  await page.waitForSelector('.sweet-alert.acp-tools-modal.visible .acp-tools-body');
  await page.evaluate(start => {
    for(const request of requests.slice(start))if(request.options.data.action === 'fixtureManagerAction' && request.options.data.managerAction === 'status')request.deferred.resolve({ok:true,status:makeFixtureStatus(false)});
  },start);
  await settle(page);
}

async function closeModal(page) {
  await page.waitForSelector('.sweet-alert.visible');
  await page.locator('.sweet-alert:visible button.confirm').click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.sweet-alert')).display === 'none');
}

async function beginExport(page) {
  const before=await page.evaluate(() => requests.filter(request => request.options.data.action === 'getDiagnosticsBundle').length);
  const label=await page.locator('[data-action="export-diagnostics"]').textContent();
  await page.locator('[data-action="export-diagnostics"]').click();
  assert.equal(await page.evaluate(() => requests.filter(request => request.options.data.action === 'getDiagnosticsBundle').length),before+1,'One click starts one diagnostics request');
  assert.equal(await page.locator('[data-action="export-diagnostics"]').isDisabled(),true,'Export is disabled while collecting');
  assert.notEqual(await page.locator('[data-action="export-diagnostics"]').textContent(),label,'The busy label explains collection progress');
  assert.equal(await page.locator('[data-action="open-zfs-path-mappings"]').isEnabled(),true,'Read-only navigation remains available');
}

async function finishExport(page,kind='complete') {
  const count=await page.evaluate(() => exportDownloads.length);
  await page.evaluate(kind => {
    const request=requests.filter(request => request.options.data.action === 'getDiagnosticsBundle').at(-1);
    if(kind === 'failed_request')request.deferred.reject({status:503,responseText:'Synthetic private error body'},'error');
    else if(kind === 'invalid_response')request.deferred.resolve({ok:false,message:'Synthetic private malformed response'});
    else if(kind === 'unsupported_schema')request.deferred.resolve({ok:true,bundle:{schemaVersion:999,privateValue:'SyntheticPrivateMalformedValue'}});
    else {
      const bundle=makeExportBundle();
      if(kind === 'normal_limits') {
        bundle.collection.status='partial';bundle.collection.sections.logs={status:'partial',omissionReason:'limit',includedCount:100,omittedCount:2};
        bundle.collection.sections.auditHistory={status:'partial',includedCount:25,omittedCount:2};
      }
      if(kind === 'specific_log_limits') {
        bundle.collection.status='partial';
        bundle.collection.sections['log-1']={status:'partial',omissionReason:'bounded_collection',includedCount:42,omittedCount:null};
        bundle.collection.sections['log-3']={status:'unavailable',omissionReason:'source_unavailable',includedCount:0,omittedCount:0};
      }
      if(kind === 'unexplained_partial')bundle.collection.status='partial';
      if(kind === 'required_missing') {
        bundle.collection.status='partial';bundle.collection.sections.runtime={status:'failed'};
        delete bundle.runtime;
      }
      if(kind === 'malformed_sections')bundle.collection={status:'complete',sections:{runtime:null}};
      if(kind === 'mismatch' || kind === 'long_mismatch') {
        bundle.runtime.pluginVersion='2026.11.01.05';bundle.currentSnapshot.status='expired';
        bundle.state.latestScanMetrics.data.startedAt='2026-11-01T11:00:00Z';
      }
      if(kind === 'long_mismatch') {
        bundle.troubleshooting.overview.status='warning';bundle.troubleshooting.overview.statusCounts.warning=8;
        bundle.troubleshooting.checks=Array.from({length:8},() => ({id:'runtime-locks',status:'warning',summary:'Synthetic runtime evidence requires review before another operation. '.repeat(4),details:{reasonCode:'missing'}}));
      }
      request.deferred.resolve({ok:true,bundle});
    }
  },kind);
  await page.waitForFunction(count => exportDownloads.length === count+1,count);
  await settle(page);
  assert.equal(await page.evaluate(() => exportDownloads.length),count+1,'Exactly one download starts for a completed export');
  return page.evaluate(async () => JSON.parse(await exportBlobs.at(-1).text()));
}

async function expandSummary(page) {
  await page.waitForSelector('details[data-tools-section="export_summary"].acp-diagnostics-summary',{state:'attached'});
  const details=page.locator('details[data-tools-section="export_summary"]');
  if(!await details.evaluate(node => node.open))await details.locator(':scope > summary').click();
  await settle(page);
  assert.equal(await page.locator('.acp-diagnostics-summary').isVisible(),true,'The latest export summary is readable inline');
}

async function assertToolsSurvives(page,title) {
  assert.equal(await page.locator('.sweet-alert.acp-tools-modal:visible').count(),1,'Export completion retains Tools');
  assert.equal(await page.locator('.sweet-alert > h2').textContent(),title,'Export completion does not replace the dialog title');
  assert.equal(await page.locator('.acp-tools-shell').count(),1);
  assert.equal(await page.locator('[data-action="export-diagnostics"]').isEnabled(),true,'Export can be retried after completion');
}

async function assertSummaryProvenance(page,payload) {
  assert.deepEqual(await page.evaluate(() => exportFixture.getExportState().summary),payload.supportSummary,'Readable UI receives the exact summary included in the sanitized download');
  assert.ok(Date.parse(payload.supportSummary.completedAt) >= Date.parse(payload.generatedAt),'Summary completion time follows browser snapshot creation');
  assert.ok(isFinite(Date.parse(payload.browserCapturedAt)) && Date.parse(payload.completedAt) >= Date.parse(payload.browserCapturedAt),'Browser and completed snapshots have explicit collection times');
}

async function assertSummaryGeometry(page,label) {
  const top=await page.locator('.sweet-alert.acp-tools-modal').evaluate(modal => {
    const rect=node => node.getBoundingClientRect().toJSON(),body=modal.querySelector('.acp-tools-body');
    const scrolls=[modal,...modal.querySelectorAll('*')].filter(node => /auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight+2);
    return {modal:rect(modal),title:rect(modal.querySelector(':scope > h2')),footer:rect(modal.querySelector(':scope > .sa-button-container')),
      width:innerWidth,height:innerHeight,onlyBody:scrolls.every(node => node === body),
      overflow:[body,...body.querySelectorAll('.acp-diagnostics-summary,.acp-diagnostics-summary *')].filter(node => node.scrollWidth > node.clientWidth+2).map(node => ({tag:node.tagName,cls:node.className})),
      align:[...modal.querySelectorAll('.acp-diagnostics-summary p,.acp-diagnostics-summary dt,.acp-diagnostics-summary dd')].map(node => getComputedStyle(node).textAlign),direction:getComputedStyle(body).direction};
  });
  assert.ok(top.modal.left >= -1 && top.modal.right <= top.width+1 && top.modal.top >= -1 && top.modal.bottom <= top.height+1,`${label}: dialog fits viewport`);
  assert.equal(top.onlyBody,true,`${label}: summary has no nested scrolling area`);
  assert.deepEqual(top.overflow,[],`${label}: long summary wraps without horizontal clipping`);
  assert.ok(top.align.every(value => ['start',top.direction === 'rtl' ? 'right' : 'left'].includes(value)),`${label}: summary copy follows reading direction`);
  await page.locator('.acp-tools-body').evaluate(node => {node.scrollTop=node.scrollHeight;});
  for(const key of ['title','footer']) {
    const after=await page.locator(key === 'title' ? '.sweet-alert > h2' : '.sweet-alert > .sa-button-container').boundingBox();
    assert.ok(Math.abs(after.y-top[key].top) <= 1.5,`${label}: ${key} stays fixed`);
  }
  assert.equal(await page.locator('.sweet-alert button.confirm').evaluate(node => {
    const box=node.getBoundingClientRect(),target=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);
    return box.top >= 0 && box.bottom <= innerHeight && (target === node || node.contains(target));
  }),true,`${label}: Done remains clickable`);
}

async function layoutCase(browser,options) {
  const {page,errors}=await createFixture(browser,options),label=`${options.locale} ${options.version} ${options.theme || 'black'} ${options.width}x${options.height}${options.aurora ? ' Aurora' : ''}`;
  try {
    await openTools(page);const title=await page.locator('.sweet-alert > h2').textContent();
    await beginExport(page);const payload=await finishExport(page,'long_mismatch');
    assert.equal(payload.schemaVersion,5);assert.equal(payload.redaction.version,3);
    assert.ok(payload.activity && payload.supportSummary,'Additive support and activity sections are exported');
    await assertToolsSurvives(page,title);await assertSummaryProvenance(page,payload);await expandSummary(page);
    const text=await page.locator('.acp-diagnostics-summary').textContent();
    assert.ok(text.includes('2026.11.01.06') && text.includes('2026.11.01.05'),'Inline summary reports both sanitized versions');
    assert.ok(payload.troubleshooting.findings.some(item => item.id === 'versionMatch'));
    await page.locator('.acp-tools-body details').evaluateAll(nodes => nodes.forEach(node => {node.open=true;}));
    await assertSummaryGeometry(page,label);await closeModal(page);
    assert.deepEqual(errors,[]);console.log(`diagnostics_export_ui: ${label}; actual download, inline summary, wrapping and fixed native controls passed.`);
  }finally{await page.close();}
}

async function lifecycleCases(browser) {
  const {page,errors}=await createFixture(browser,{version:'7.3',width:1440,height:650});
  try {
    await openTools(page);const title=await page.locator('.sweet-alert > h2').textContent();
    await beginExport(page);
    const count=await page.evaluate(() => requests.length);
    await page.evaluate(() => {exportFixture.exportDiagnostics();exportFixture.exportDiagnostics();});
    assert.equal(await page.evaluate(() => requests.length),count,'Direct duplicate attempts are ignored while collecting');
    const complete=await finishExport(page);
    assert.equal(complete.collection.status,'complete');await assertToolsSurvives(page,title);await expandSummary(page);
    const initialSummary=await page.locator('.acp-diagnostics-summary').textContent();assert.ok(initialSummary.trim().length > 40);
    // A refresh and completion preserve a reader's current disclosures, scroll
    // and summary focus even when the export was started programmatically.
    await page.locator('[data-tools-section="diagnostics_privacy"] > summary').click();
    await page.locator('[data-tools-section="diagnostics_privacy"] > summary').focus();
    const before=await page.evaluate(() => ({scroll:document.querySelector('.acp-tools-body').scrollTop,open:[...document.querySelectorAll('.acp-tools-body details[open]')].map(node => node.dataset.toolsSection)}));
    await page.evaluate(() => exportFixture.exportDiagnostics());const limited=await finishExport(page,'normal_limits');
    assert.ok(!limited.troubleshooting.findings.some(item => item.id === 'collection'),'Normal history/log limits do not become required-evidence failures');
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.acp-tools-body details[open]')].map(node => node.dataset.toolsSection)),before.open);
    assert.equal(await page.locator('[data-tools-section="diagnostics_privacy"] > summary').evaluate(node => document.activeElement === node),true,'Completion preserves disclosure focus');
    assert.ok(Math.abs(await page.locator('.acp-tools-body').evaluate(node => node.scrollTop)-before.scroll) <= 2,'Completion preserves body scroll');
    assert.ok(!limited.supportSummary.limitations.some(item => item.section === 'server'),'Detailed collection limits replace the redundant partial server entry');
    await beginExport(page);const logLimits=await finishExport(page,'specific_log_limits');
    assert.deepEqual(logLimits.supportSummary.limitations,[{section:'log-1',reason:'bounded_collection'},{section:'log-3',reason:'source_unavailable'}],'Specific bounded and unavailable log reasons survive without an aggregate unknown entry');
    assert.equal(logLimits.collection.sections.server.status,'partial','Raw collection metadata retains the aggregate status');
    assert.equal(logLimits.supportSummary.status,'partial');assert.equal(logLimits.supportSummary.health,'ok');
    await assertSummaryProvenance(page,logLimits);await expandSummary(page);
    assert.equal(await page.locator('.acp-diagnostics-limitations li').count(),2,'Tools renders the two specific log limitations');
    for(const phrase of ['Collection limit reached','Source unavailable'])assert.ok((await page.locator('.acp-diagnostics-limitations').textContent()).includes(phrase),'Tools retains each specific log reason');
    assert.ok(!(await page.locator('.acp-diagnostics-limitations').textContent()).includes('Server information'),'Tools omits the redundant server limitation');
    await beginExport(page);const unexplained=await finishExport(page,'unexplained_partial');
    assert.deepEqual(unexplained.supportSummary.limitations,[{section:'server',reason:'unknown'}],'An unexplained partial server response retains its fallback limitation');
    for(const outcome of ['failed_request','invalid_response','unsupported_schema','required_missing','malformed_sections']) {
      await beginExport(page);const payload=await finishExport(page,outcome);
      assert.equal(payload.collection.status,'partial',`${outcome}: useful browser-only/partial evidence is retained`);
      assert.ok(payload.supportSummary);await assertToolsSurvives(page,title);await expandSummary(page);
      if(outcome !== 'required_missing')assert.ok(payload.supportSummary.limitations.some(item => item.section === 'server' && item.reason === (outcome === 'failed_request' ? 'request_failed' : 'invalid_response')),'Failed or invalid server requests remain explicit in the summary');
      else assert.ok(payload.supportSummary.limitations.some(item => item.section === 'runtime'),'A required-section failure remains explicit without the redundant server entry');
      assert.ok(!JSON.stringify(payload).includes('SyntheticPrivateMalformedValue'));
    }
    // Navigation away does not give the old export permission to replace the
    // new dialog, rename its title, or steal its reader's focused control.
    await beginExport(page);await closeModal(page);
    await page.evaluate(() => exportFixture.openHelpModal());await page.waitForSelector('.sweet-alert.acp-help-modal.visible');await settle(page);
    const helpTitle=await page.locator('.sweet-alert > h2').textContent();await page.locator('.acp-help-question > summary').first().focus();
    await finishExport(page);
    assert.equal(await page.locator('.sweet-alert.acp-help-modal:visible').count(),1);
    assert.equal(await page.locator('.sweet-alert > h2').textContent(),helpTitle);
    assert.equal(await page.locator('.acp-help-question > summary').first().evaluate(node => document.activeElement === node),true);
    assert.equal(await page.locator('.acp-tools-shell').count(),0);
    await closeModal(page);await openTools(page);await expandSummary(page);
    assert.ok((await page.locator('.acp-diagnostics-summary').textContent()).trim().length > 40,'The completed export remains available on the next Tools visit');
    await beginExport(page);await page.locator('[data-action="open-zfs-path-mappings"]').click();
    await page.evaluate(() => {requests.filter(request => request.options.data.action === 'browseAppdataSourcePath').at(-1).deferred.resolve({ok:true,browser:{root:'/mnt',currentPath:'/mnt',entries:[],breadcrumbs:[]}});});
    await page.waitForSelector('.sweet-alert.acp-zfs-path-mappings-modal.visible');await settle(page);
    const mappingsTitle=await page.locator('.sweet-alert > h2').textContent();await page.locator('.sweet-alert button.confirm').focus();
    await finishExport(page);
    assert.equal(await page.locator('.sweet-alert.acp-zfs-path-mappings-modal:visible').count(),1);
    assert.equal(await page.locator('.sweet-alert > h2').textContent(),mappingsTitle);
    assert.equal(await page.locator('.sweet-alert button.confirm').evaluate(node => document.activeElement === node),true,'Completion leaves mapping-dialog focus intact');
    await closeModal(page);await openTools(page);
    const downloads=await page.evaluate(() => exportDownloads.length);
    await page.evaluate(() => {window.throwExportBlob=true;});await beginExport(page);
    await page.evaluate(() => {requests.filter(request => request.options.data.action === 'getDiagnosticsBundle').at(-1).deferred.resolve({ok:true,bundle:makeExportBundle()});});
    await settle(page);
    assert.equal(await page.evaluate(() => exportDownloads.length),downloads,'Blob failure never reports a successful download');
    await assertToolsSurvives(page,title);
    assert.equal(await page.locator('.acp-diagnostics-export-status.is-error[role="status"]').isVisible(),true,'Export failure has readable inline status');
    await beginExport(page);await closeModal(page);
    await page.evaluate(() => exportFixture.openHelpModal());await page.waitForSelector('.sweet-alert.acp-help-modal.visible');await settle(page);
    await page.locator('.acp-help-question > summary').first().focus();
    await page.evaluate(() => {requests.filter(request => request.options.data.action === 'getDiagnosticsBundle').at(-1).deferred.resolve({ok:true,bundle:makeExportBundle()});});
    await settle(page);
    assert.equal(await page.evaluate(() => exportDownloads.length),downloads);
    assert.equal(await page.locator('.sweet-alert > h2').textContent(),helpTitle,'A failed Blob download cannot rename another dialog');
    assert.equal(await page.locator('.acp-help-question > summary').first().evaluate(node => document.activeElement === node),true,'A failed download preserves the new dialog focus');
    assert.equal(await page.evaluate(() => exportFixture.getExportState().loading),false,'A failed download releases the in-flight guard');
    await closeModal(page);await openTools(page);
    assert.equal(await page.locator('.acp-diagnostics-export-status.is-error').isVisible(),true,'Download failure remains available on the next Tools visit');
    await page.evaluate(() => {window.throwExportBlob=false;window.throwExportApi=true;});
    await page.locator('[data-action="export-diagnostics"]').click();
    await page.waitForFunction(count => exportDownloads.length === count+1,downloads);
    const fallback=await page.evaluate(async () => JSON.parse(await exportBlobs.at(-1).text()));
    assert.equal(fallback.collection.status,'partial','Synchronous API setup failure still exports browser evidence');
    await page.evaluate(() => {window.throwExportApi=false;});await assertToolsSurvives(page,title);
    await page.evaluate(() => exportFixture.failBrowserCollector(true));await beginExport(page);
    const minimal=await finishExport(page);
    assert.equal(minimal.collection.status,'partial');assert.equal(minimal.collection.sections.browser.status,'failed','Browser collector failure is explicit in fallback metadata');
    for(const field of ['detected','blocked','selected','visible','omittedRows'])assert.equal(minimal.supportSummary.counts[field],null,'An unknown browser count is not presented as a verified zero');
    assert.ok(minimal.supportSummary);await page.evaluate(() => exportFixture.failBrowserCollector(false));
    assert.deepEqual(errors,[]);console.log('diagnostics_export_ui: complete/partial/failure, duplicates, preserved reading state, navigation and Blob/API failure cases passed.');
  }finally{await page.close();}
}

async function activityCase(browser) {
  const {page,errors}=await createFixture(browser);
  try {
    await openTools(page);
    await page.evaluate(() => {
      const F=exportFixture,before=F.buildDiagnosticsActivity().totalCount;
      F.recordDiagnosticsActivity('SyntheticPrivateEventName',{modal:'tools',path:'/home/SyntheticActivityPrivate/file'});
      if(F.buildDiagnosticsActivity().totalCount !== before)throw new Error('Unknown activity event was retained');
      for(let i=0;i<150;i++) {
        const details={action:'getDiagnosticsBundle',request:800000+i,modal:'tools',fixtureAction:'status',
          rawStack:'SyntheticActivityPrivate',path:'/home/SyntheticActivityPrivate/file',domText:'SyntheticActivityPrivate',html:'<img onerror=alert(1)>'};
        F.recordDiagnosticsActivity('request_started',details);F.recordDiagnosticsActivity('request_completed',details);
      }
      F.recordDiagnosticsActivity('request_started',{action:'SyntheticPrivateAction',request:999999,module:'SyntheticPrivateModule',reason:'SyntheticPrivateReason',rawStack:'SyntheticActivityPrivate'});
      F.openToolsModal();const older=requests.at(-1);
      F.openToolsModal();const newer=requests.at(-1);
      older.deferred.resolve({ok:true,status:makeFixtureStatus(true)});
      newer.deferred.resolve({ok:true,status:makeFixtureStatus(false)});
      document.querySelector('[data-tools-section="diagnostics_privacy"] > summary').textContent='SyntheticDomPrivate /home/SyntheticDomPrivate/file';
      window.dispatchEvent(new ErrorEvent('error',{filename:'https://SyntheticPrivateHost.example/plugins/appdata.cleanup.plus/scripts/appdata.cleanup.plus.js',message:'SyntheticErrorPrivate',lineno:321,colno:7,error:new TypeError('SyntheticErrorPrivate')}));
    });
    await beginExport(page);const payload=await finishExport(page);
    const activity=payload.activity;
    assert.equal(activity.limit,100);assert.equal(activity.includedCount,100);assert.equal(activity.events.length,100);
    assert.ok(activity.totalCount > 100 && activity.omittedCount > 0);assert.equal(activity.omittedCount,activity.totalCount-activity.includedCount);
    const names=new Set('modal_open modal_close request_started request_completed request_failed response_ignored export_started export_collected export_completed export_failed export_ignored javascript_error selection_changed'.split(' '));
    assert.ok(activity.events.every(event => names.has(event.event)),'Only fixed activity event codes survive export');
    const keys=new Set('event elapsedMs action request modal fixtureAction reason httpStatus durationMs module line column selectedCount'.split(' '));
    assert.ok(activity.events.every(event => Object.keys(event).every(key => keys.has(key))),'Activity drops arbitrary detail keys');
    assert.ok(activity.events.filter(event => event.request).every(event => typeof event.request === 'string' && /^request-\d+$/.test(event.request)),'Request correlation uses export-only aliases');
    // A bounded buffer can begin with a completion whose start was omitted.
    assert.ok(activity.events.some(completed => completed.event === 'request_completed' && completed.request && activity.events.some(started => started.event === 'request_started' && started.request === completed.request)),'Retained started/completed events correlate inside this export');
    assert.ok(activity.events.some(event => event.event === 'response_ignored' && event.reason === 'superseded'));
    assert.ok(activity.events.some(event => event.event === 'javascript_error' && event.module === 'main' && event.line === 321 && event.column === 7),'JavaScript failures keep a fixed module and numeric source position');
    for(const event of ['export_started','export_collected'])assert.ok(activity.events.some(item => item.event === event),`Current export records ${event} without claiming a completed file save`);
    assert.ok(!JSON.stringify(payload).includes('SyntheticActivityPrivate') && !JSON.stringify(activity).includes('SyntheticPrivate'),'Activity excludes private values, payloads and unknown enum inputs');
    for(const canary of ['SyntheticDomPrivate','SyntheticErrorPrivate','SyntheticPrivateHost'])assert.ok(!JSON.stringify(payload).includes(canary),'DOM text, raw errors and URL authorities never enter the support artifact');
    assert.ok(isFinite(Date.parse(activity.captureStartedAt)));
    assert.ok(Date.parse(activity.captureStartedAt) <= Date.parse(payload.browserCapturedAt));
    await assertSummaryProvenance(page,payload);assert.deepEqual(errors,[]);
    console.log('diagnostics_export_ui: bounded activity, safe enums/details, export-only request correlation and snapshot provenance passed.');
  }finally{await page.close();}
}

async function finalPrivacyCase(browser) {
  const {page,errors}=await createFixture(browser);
  try {
    await openTools(page);await beginExport(page);
    await page.evaluate(() => {
      const bundle=makeExportBundle();
      bundle.logs=[{path:'<path>',available:true,lines:[
        'appdata.cleanup.plus: read failed /boot/SyntheticPrivateLabel/SyntheticPrivateFile',
        'appdata.cleanup.plus: read failed /home/SyntheticPrivateName/file',
        'appdata.cleanup.plus: read failed /unfamiliar/SyntheticOtherBranch/private.txt',
        'appdata.cleanup.plus: read failed "/boot/Synthetic Private Label/Synthetic Private File"',
        'appdata.cleanup.plus: read failed "/home/Synthetic Private Person/data.txt"',
        'appdata.cleanup.plus: read failed "/unfamiliar/Synthetic Private Directory/file.txt"'
      ],matchedLineCount:6,scannedLineCount:6,truncated:false}];
      bundle.byRoot={'/home/SyntheticKeyName/secret':{count:1},'/unfamiliar/SyntheticKeyBranch/a':{count:2}};
      bundle.troubleshooting.overview.status='warning';bundle.troubleshooting.overview.statusCounts.warning=1;
      bundle.troubleshooting.checks=[{id:'runtime-locks',status:'warning',summary:'Synthetic finding <img src=x onerror=alert(1)>',details:{reasonCode:'missing'}}];
      requests.filter(request => request.options.data.action === 'getDiagnosticsBundle').at(-1).deferred.resolve({ok:true,bundle});
    });
    await page.waitForFunction(() => exportDownloads.length === 1);
    const text=await page.evaluate(async () => exportBlobs.at(-1).text());
    for(const canary of ['SyntheticPrivateLabel','SyntheticPrivateFile','SyntheticPrivateName','SyntheticOtherBranch','Synthetic Private Label','Synthetic Private File','Synthetic Private Person','Synthetic Private Directory','SyntheticKeyName','SyntheticKeyBranch'])assert.ok(!text.includes(canary),`Final downloaded JSON excludes ${canary}`);
    assert.ok(text.includes('read failed'),'Useful failure context survives redaction');
    const payload=JSON.parse(text);assert.equal(payload.redaction.version,3);
    await expandSummary(page);
    assert.equal(await page.locator('.acp-diagnostics-summary img,.acp-diagnostics-summary script,.acp-diagnostics-summary [onerror],.acp-diagnostics-summary [onload]').count(),0,'Server finding markup remains escaped text in the readable summary');
    assert.ok((await page.locator('.acp-diagnostics-summary').textContent()).includes('<img src=x onerror=alert(1)>'),'Useful finding text survives without becoming HTML');
    assert.deepEqual(errors,[]);console.log('diagnostics_export_ui: final Blob removes private boot/home/unfamiliar/spaced paths and path-shaped keys.');
  }finally{await page.close();}
}

async function boundedRowsCase(browser) {
  const {page,errors}=await createFixture(browser);
  try {
    await page.evaluate(() => {
      const F=exportFixture;F.state.rows=Array.from({length:501},(_,index) => ({id:`synthetic-limit-row-${index}`,
        name:index === 500 ? 'SyntheticBarePrivateApp501' : 'Synthetic retained row',path:'/mnt/user/appdata/synthetic-retained',displayPath:'/mnt/user/appdata/synthetic-retained',
        sourceKind:'filesystem',storageKind:'filesystem',risk:'safe',status:'orphaned',canDelete:true,insideConfiguredSource:true}));
      F.state.selected=Object.fromEntries(F.state.rows.map(row => [row.id,true]));
      F.state.summary={total:501,safe:501,deletable:501,blocked:0,ignored:0};
    });
    await openTools(page);await beginExport(page);
    await page.evaluate(() => {
      const bundle=makeExportBundle();bundle.currentSnapshot.candidateCount=501;
      bundle.logs=[{path:'<path>',available:true,lines:['appdata.cleanup.plus: SyntheticBarePrivateApp501 needs review'],matchedLineCount:1,scannedLineCount:1,truncated:false}];
      requests.filter(request => request.options.data.action === 'getDiagnosticsBundle').at(-1).deferred.resolve({ok:true,bundle});
    });
    await page.waitForFunction(() => exportDownloads.length === 1);
    const text=await page.evaluate(async () => exportBlobs.at(-1).text()),payload=JSON.parse(text);
    assert.equal(payload.rows.length,500);assert.equal(payload.collection.sections.rows.includedCount,500);assert.equal(payload.collection.sections.rows.omittedCount,1);
    assert.equal(payload.visibleRowIds.length,500);assert.equal(payload.selectedRowIds.length,500,'Output identifiers obey the same bound as row data');
    assert.equal(payload.supportSummary.counts.reportedRows,500);assert.equal(payload.supportSummary.counts.omittedRows,1);
    assert.ok(!text.includes('SyntheticBarePrivateApp501'),'Names known only from omitted rows are still removed from bare server log text');
    assert.ok(!text.includes('synthetic-limit-row-'),'Server-issued browser row identifiers never escape as stable raw IDs');
    await assertSummaryProvenance(page,payload);assert.deepEqual(errors,[]);
    console.log('diagnostics_export_ui: 500-row/identifier limit, exact omission counts and omitted-row private-name redaction passed.');
  }finally{await page.close();}
}

(async () => {
  auroraAssets=await readAurora();const browser=await chromium.launch({headless:true});
  try {
    if(!process.argv.includes('--interactions-only'))for(const options of [
      {locale:'en_US',version:'7.0',theme:'black',width:1440,height:900},
      {locale:'de_DE',version:'7.0',theme:'white',width:1440,height:650},
      {locale:'en_US',version:'7.3',theme:'white',width:1920,height:650},
      {locale:'ar_AR',version:'7.3',theme:'black',width:390,height:520},
      {locale:'de_DE',version:'7.3',theme:'black',width:1440,height:650,aurora:true},
      {locale:'ar_AR',version:'7.3',theme:'black',width:390,height:700,aurora:true}
    ])await layoutCase(browser,options);
    await lifecycleCases(browser);await finalPrivacyCase(browser);await activityCase(browser);await boundedRowsCase(browser);
  }finally{await browser.close();}
})().catch(error => {console.error(error);process.exitCode=1;});
