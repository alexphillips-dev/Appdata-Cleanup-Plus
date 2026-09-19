// Prepare trusted repository fixtures, not arbitrary/untrusted HTML. Preserve
// inline configuration while loading external scripts and styles explicitly.
async function setFixtureContent(page, html) {
  const documentHtml = await page.evaluate(markup => {
    const doc = new DOMParser().parseFromString(markup, 'text/html');
    doc.querySelectorAll('script[src], link').forEach(element => element.remove());
    return '<!DOCTYPE html>' + doc.documentElement.outerHTML;
  }, html);
  await page.setContent(documentHtml);
}

module.exports = {setFixtureContent};
