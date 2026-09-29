const {test}=require('node:test');
const assert=require('node:assert/strict');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const path=require('node:path');
const server=require('../server');

test('local server serves sign-in assets without exposing server files; vault checks still pass',async t=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base=`http://127.0.0.1:${server.address().port}`;
  const page=await (await fetch(base)).text();assert.ok(page.includes('id="account-dialog"'));
  const script=await fetch(`${base}/auth.js`);assert.equal(script.status,200);assert.match(script.headers.get('content-type'),/javascript/);
  for(const route of ['/.env.local','/lib/auth.js','/node_modules/google-auth-library/package.json','/package.json','/toString'])assert.equal((await fetch(base+route)).status,404);
  assert.equal((await fetch(`${base}/api/auth`)).status,200);
  const {stdout}=await promisify(execFile)(process.execPath,['verify.cjs'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,TEST_BASE_URL:base}});
  assert.match(stdout,/PASS: encryption round trip/);
});
