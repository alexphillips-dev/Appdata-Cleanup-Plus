const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const {spawnSync,execFileSync} = require('node:child_process');
const root=path.resolve(__dirname,'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'acp-review-check-'));
const plugin='source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus/locales';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const write=(file,data)=>fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n');
try {
  for(const file of ['scripts/review_i18n.mjs','scripts/i18n_review_scopes.json','scripts/i18n_reviews.json',`${plugin}/locales.json`,`${plugin}/en_US.json`,`${plugin}/de_DE.json`]){
    const target=path.join(temp,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,file),target);
  }
  const checker=path.join(temp,'scripts/review_i18n.mjs');
  const output=path.join(temp,'packet');
  execFileSync(process.execPath,[checker,'--locale','de_DE','--output',output]);
  const html=fs.readFileSync(path.join(output,'review.html'),'utf8');
  assert.match(html,/Awaiting native-speaker review/);
  assert.match(html,/Reference glossary/);
  let record=read(path.join(output,'review-records.json'))[0];
  const ledgerFile=path.join(temp,'scripts/i18n_reviews.json');
  const check=()=>spawnSync(process.execPath,[checker,'--check'],{encoding:'utf8'});
  write(ledgerFile,{schemaVersion:1,reviews:[record]});
  assert.notEqual(check().status,0,'Generated packets cannot count as human approval');
  // Only this isolated validator fixture uses a synthetic reviewer declaration.
  record={...record,status:'native-speaker-reviewed',reviewer:'synthetic-validator-fixture',reviewedAt:'2026-10-06T00:00:00Z',nativeSpeaker:true,glossaryChecked:true};
  write(ledgerFile,{schemaVersion:1,reviews:[record]});
  assert.equal(check().status,0,'A complete declaration with matching hashes is accepted');
  const scopesFile=path.join(temp,'scripts/i18n_review_scopes.json');
  const scopes=read(scopesFile);scopes.glossary.quarantine+=' Changed context.';write(scopesFile,scopes);
  assert.notEqual(check().status,0,'Glossary changes invalidate prior approvals');
  fs.copyFileSync(path.join(root,'scripts/i18n_review_scopes.json'),scopesFile);
  const catalogFile=path.join(temp,plugin,'de_DE.json');
  const catalog=read(catalogFile);catalog[scopes.phrases[0].source]+=' changed';write(catalogFile,catalog);
  assert.notEqual(check().status,0,'Translation changes require a new review');
  fs.copyFileSync(path.join(root,plugin,'de_DE.json'),catalogFile);
  write(ledgerFile,{schemaVersion:1,reviews:[record,record]});
  assert.notEqual(check().status,0,'Duplicate approvals are refused');
  write(ledgerFile,{schemaVersion:1,reviews:[]});
  catalog[scopes.phrases[0].source]='<script>private fixture</script>';write(catalogFile,catalog);
  execFileSync(process.execPath,[checker,'--locale','de_DE','--output',output]);
  const escaped=fs.readFileSync(path.join(output,'review.html'),'utf8');
  assert.ok(!escaped.includes('<script>') && escaped.includes('&lt;script&gt;'),'Review packets escape untrusted translations');
  console.log('i18n_reviews: OK (unreviewed state, explicit review evidence, stale wording/glossary detection, duplicates and escaped packets)');
} finally {
  assert.equal(fs.realpathSync(path.dirname(temp)),fs.realpathSync(os.tmpdir()));
  assert.ok(path.basename(temp).startsWith('acp-review-check-'));
  fs.rmSync(temp,{recursive:true,force:true});
}
