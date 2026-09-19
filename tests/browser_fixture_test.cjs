const assert = require('node:assert/strict');
const path = require('node:path');
const dependency = name => process.env.ACP_BROWSER_MODULES ? path.join(process.env.ACP_BROWSER_MODULES, name) : name;
const {chromium} = require(dependency('playwright'));
const {setFixtureContent} = require('./browser_fixture.cjs');

(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    const requests = [];
    await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
    await setFixtureContent(page, `<!doctype html><html lang="en"><head>
      <SCRIPT defer SRC='https://fixture.invalid/one.js'></SCRIPT >
      <script src=https://fixture.invalid/two.js></script\n>
      <LiNk rel=stylesheet href='https://fixture.invalid/style.css'>
      <script>window.fixtureConfig = {value: 'inline configuration retained'};</script>
      </head><body><main id="fixture">Fixture content</main></body></html>`);
    assert.equal(await page.locator('script[src], link').count(), 0);
    assert.equal(await page.evaluate(() => window.fixtureConfig.value), 'inline configuration retained');
    assert.equal(await page.locator('#fixture').textContent(), 'Fixture content');
    assert.equal(await page.evaluate(() => document.compatMode), 'CSS1Compat');
    assert.deepEqual(requests, [], 'Fixture assets must not be requested before explicit injection');
    console.log('browser_fixture: DOM preparation handles alternate tag syntax and preserves inline configuration.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
