const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const source = fs.readFileSync('app.js', 'utf8');
const start = source.indexOf('function b64(');
const end = source.indexOf('function persist(');
vm.runInThisContext(source.slice(start,end));
(async()=>{
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const key=await derive('test-only-password-123',salt);
  const data=[{title:'Test private note',body:'fixture-secret-123'}];
  const first=await encryptVault(data,key,{salt:b64(salt)});
  const second=await encryptVault(data,key,{salt:b64(salt)});
  assert.notEqual(first.iv,second.iv);
  assert.ok(!JSON.stringify(first).includes('fixture-secret-123'));
  const reopened=await derive('test-only-password-123',unb64(first.salt));
  const decrypted=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(first.iv)},reopened,unb64(first.data));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(decrypted)),data);
  const wrong=await derive('wrong-password-123',salt);
  await assert.rejects(()=>crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(first.iv)},wrong,unb64(first.data)));
  const tampered=unb64(first.data);tampered[0]^=1;
  await assert.rejects(()=>crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(first.iv)},key,tampered));
  for(const route of ['/','/app.js','/style.css']){const response=await fetch(baseUrl+route);assert.equal(response.status,200);assert.ok(response.headers.get('content-security-policy'));}
  assert.equal((await fetch(baseUrl+'/missing')).status,404);
  console.log('PASS: encryption round trip, unique IVs, wrong password rejection, tamper rejection, server assets and 404.');
})().catch(error=>{console.error(error);process.exitCode=1;});
