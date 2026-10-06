// Exercise both real package channels through Unraid's pinned Markdown parsers
// and the Plugins page's jQuery .html() insertion, with a local PHP session.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
const {execFileSync, spawn} = require('node:child_process');
const http = require('node:http');
const crypto = require('node:crypto');
const dependency = name => process.env.ACP_BROWSER_MODULES ? path.join(process.env.ACP_BROWSER_MODULES, name) : name;
const {chromium} = require(dependency('playwright'));
const root = path.resolve(__dirname, '..');
const pluginPath = 'usr/local/emhttp/plugins/appdata.cleanup.plus';
const locales = JSON.parse(fs.readFileSync(path.join(root, 'source/appdata.cleanup.plus', pluginPath, 'locales/locales.json')));
const refs = {'7.0':'25bc9e2d16525e4e4f9796c9c64c1a3e1c63402d','7.3':'41e8d5ad5db20b0e9aeea4334b39bea56729579a'};
const summary = 'Appdata Cleanup Plus scans for unused Docker appdata folders and exact ZFS dataset candidates, then lets you review, dry run, quarantine, restore, audit, or permanently delete them from a guided cleanup dashboard.';
const notice = 'Dev build: testing channel. Expect preview changes before main.';
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const bashPath = file => file.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive) => '/' + drive.toLowerCase());
async function availablePort() {
  const probe = http.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}
function packageSnapshot(directory) {
  return fs.readdirSync(directory).sort().map(name => {
    const file = path.join(directory, name);
    return [name, fs.statSync(file).isDirectory() ? packageSnapshot(file) : crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')];
  });
}
(async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-plugin-description-'));
  let server, browser;
  try {
    const readmes = {}, catalogs = {}, snapshots = {};
    for (const channel of ['main', 'dev']) {
      const build = path.join(fixture, channel);
      fs.mkdirSync(path.join(build, 'plugins'), {recursive:true});
      for (const file of ['pkg_build.sh', 'appdata.cleanup.plus.xml', 'plugins/appdata.cleanup.plus.plg']) fs.copyFileSync(path.join(root, file), path.join(build, file));
      fs.cpSync(path.join(root, 'source'), path.join(build, 'source'), {recursive:true});
      execFileSync(bash, ['pkg_build.sh', '--branch', channel, '--no-validate'], {cwd:build});
      const archive = path.join(build, 'archive', fs.readdirSync(path.join(build, 'archive'))[0]);
      const unpacked = path.join(build, 'package'); fs.mkdirSync(unpacked);
      execFileSync(bash, ['-c', 'tar -xf "$1" -C "$2"', 'fixture', bashPath(archive), bashPath(unpacked)]);
      readmes[channel] = path.join(unpacked, pluginPath, 'README.md');
      catalogs[channel] = path.join(unpacked, pluginPath, 'locales');
      snapshots[channel] = packageSnapshot(unpacked);
    }
    const markdown = {};
    for (const [version, ref] of Object.entries(refs)) {
      const parser = path.join(fixture, 'markdown-' + version); fs.mkdirSync(parser);
      for (const file of ['MarkdownExtra.inc.php', 'MarkdownInterface.php', 'Markdown.php', 'MarkdownExtra.php']) {
        const response = await fetch('https://raw.githubusercontent.com/unraid/webgui/' + ref + '/emhttp/plugins/dynamix/include/' + file, {signal:AbortSignal.timeout(30000)});
        assert.ok(response.ok, 'Pinned Markdown parser ' + version + '/' + file + ': ' + response.status);
        fs.writeFileSync(path.join(parser, file), await response.text());
      }
      markdown[version] = Object.fromEntries(Object.entries(readmes).map(([channel, file]) => [channel, execFileSync('php', [path.join(__dirname, 'render_plugin_readme.php'), parser, file], {encoding:'utf8'})]));
    }
    const sessions = path.join(fixture, 'sessions'); fs.mkdirSync(sessions);
    const port = await availablePort(), origin = 'http://127.0.0.1:' + port;
    let serverLog = '';
    server = spawn('php', ['-d', 'session.save_path="' + sessions.replace(/\\/g, '/') + '"', '-S', '127.0.0.1:' + port, path.join(__dirname, 'plugin_description_router.php')], {env:{...process.env, ACP_PLUGIN_DESCRIPTION_FIXTURE:fixture}, stdio:['ignore','pipe','pipe']});
    server.stdout.on('data', data => serverLog += data);
    server.stderr.on('data', data => serverLog += data);
    for (let attempt = 0; ; attempt++) {
      try { await fetch(origin + '/fixture/'); break; }
      catch (error) { if (attempt >= 50) throw Error('PHP fixture did not start: ' + serverLog); await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    browser = await chromium.launch({headless:true});
    for (const [locale, definition] of Object.entries(locales)) {
      const page = await browser.newPage();
      const errors = [], responses = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => { if (response.url().includes('/include/plugin-description.php')) responses.push(response); });
      await page.goto(origin + '/fixture/');
      await page.addScriptTag({path:require.resolve(dependency('jquery/dist/jquery.js'))});
      await page.request.get(origin + '/fixture/locale?locale=' + encodeURIComponent(locale));
      for (const version of Object.keys(refs)) for (const channel of ['main', 'dev']) for (const width of [1280, 390]) {
        await page.setViewportSize({width, height:810});
        await page.evaluate(html => $('#plugin_list').html('<span class="desc_readmore" style="display:block">' + html + '</span><a id="support-link" href="https://example.invalid/support">Support Thread</a>'), markdown[version][channel]);
        const catalog = JSON.parse(fs.readFileSync(path.join(catalogs[channel], locale + '.json')));
        const actual = await page.locator('#acp-plugin-description').evaluate(host => {
          const node = key => host.querySelector('[data-acp-plugin-text="' + key + '"]');
          return {title:node('title').textContent, summary:node('summary').textContent, notice:node('notice')?.textContent || '', lang:host.lang, dir:host.dir, overflow:host.scrollWidth > host.clientWidth + 2};
        });
        assert.deepEqual(actual, {title:channel === 'dev' ? catalog['Appdata Cleanup Plus (Dev)'] : 'Appdata Cleanup Plus', summary:catalog[summary], notice:channel === 'dev' ? catalog[notice] : '', lang:definition.tag, dir:definition.rtl ? 'rtl' : 'ltr', overflow:false}, version + '/' + channel + '/' + locale + '/' + width);
        assert.equal(await page.locator('#other-plugin').textContent(), 'Another plugin');
        assert.equal(await page.locator('#support-link').getAttribute('href'), 'https://example.invalid/support');
        assert.equal(responses.at(-1).status(), 200, await responses.at(-1).text());
        const headers = await responses.at(-1).allHeaders();
        assert.match(headers['content-type'], /application\/javascript/);
        assert.equal(headers['cache-control'], 'private, no-store');
        assert.equal(headers['x-content-type-options'], 'nosniff');
      }
      assert.equal(responses.length, 8, 'Every list reload fetches the current session language');
      // Switch the same session to English and an unsupported locale: no cached text.
      for (const fallback of ['', 'unsupported', '../../de_DE']) {
        await page.request.get(origin + '/fixture/locale?locale=' + encodeURIComponent(fallback));
        await page.evaluate(html => $('#plugin_list').html(html), markdown['7.3'].dev);
        assert.equal(await page.locator('[data-acp-plugin-text="summary"]').textContent(), summary);
        assert.equal(await page.locator('#acp-plugin-description').getAttribute('dir'), 'ltr');
      }
      // A failed script leaves the packaged English description readable.
      await page.route('**/include/plugin-description.php?channel=*', route => route.fulfill({status:503, body:''}));
      await page.evaluate(html => $('#plugin_list').html(html), markdown['7.3'].dev);
      assert.equal(await page.locator('[data-acp-plugin-text="summary"]').textContent(), summary);
      assert.deepEqual(errors, []);
      await page.close();
      console.log(locale + ': main/dev packages, native 7.0/7.3 Markdown, desktop/mobile, session switching and English fallback passed');
    }
    for (const channel of ['main', 'dev']) assert.deepEqual(packageSnapshot(path.join(fixture, channel, 'package')), snapshots[channel], 'Description requests must not change installed files');
    // Treat even a corrupted local catalog as text, never as executable markup.
    const catalogFile = path.join(catalogs.dev, 'de_DE.json');
    const catalog = JSON.parse(fs.readFileSync(catalogFile));
    catalog[summary] = '<img src=x onerror="window.catalogExecuted=true"><script>window.catalogExecuted=true</script>';
    fs.writeFileSync(catalogFile, JSON.stringify(catalog));
    const page = await browser.newPage();
    await page.goto(origin + '/fixture/');
    await page.addScriptTag({path:require.resolve(dependency('jquery/dist/jquery.js'))});
    await page.request.get(origin + '/fixture/locale?locale=de_DE');
    await page.evaluate(html => $('#plugin_list').html(html), markdown['7.3'].dev);
    assert.equal(await page.locator('[data-acp-plugin-text="summary"]').textContent(), catalog[summary]);
    assert.equal(await page.locator('#acp-plugin-description img, #acp-plugin-description script').count(), 0);
    assert.equal(await page.evaluate(() => window.catalogExecuted), undefined);
    delete catalog[summary]; fs.writeFileSync(catalogFile, JSON.stringify(catalog));
    await page.evaluate(html => $('#plugin_list').html(html), markdown['7.3'].dev);
    assert.equal(await page.locator('[data-acp-plugin-text="summary"]').textContent(), summary, 'Missing phrase falls back to English');
    await page.close();
    console.log('plugin_description_ui: all 42 languages and both channels passed; catalog markup remains inert text.');
  } finally {
    if (browser) await browser.close();
    if (server) { server.kill(); await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve)); }
    // Only remove the exact isolated fixture directory created by this test.
    assert.equal(path.dirname(fs.realpathSync(fixture)), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(fixture).startsWith('acp-plugin-description-'));
    fs.rmSync(fixture, {recursive:true, force:true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
