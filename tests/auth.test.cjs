const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {generateKeyPairSync,sign}=require('node:crypto');
const {OAuth2Client}=require('google-auth-library');
const {createAuthHandler,verifyGoogleToken}=require('../lib/auth');
const env={GOOGLE_CLIENT_ID:'123456-test.apps.googleusercontent.com',AUTH_SESSION_SECRET:'test-only-secret-'.repeat(4),APP_ORIGIN:'https://ticky-tracker.vercel.app'};

async function app(t,options={}){
  const server=http.createServer(createAuthHandler({env,...options}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base=`http://127.0.0.1:${server.address().port}/api/auth`;
  const jar=new Map();
  async function request(action='session',options={}){
    const headers={cookie:[...jar].map(([k,v])=>`${k}=${v}`).join(';'),...options.headers};
    const response=await fetch(`${base}?action=${action}`,{...options,headers});
    for(const cookie of response.headers.getSetCookie()){
      const pair=cookie.split(';')[0],at=pair.indexOf('=');
      if(cookie.includes('Max-Age=0'))jar.delete(pair.slice(0,at));else jar.set(pair.slice(0,at),pair.slice(at+1));
    }
    return {status:response.status,headers:response.headers,data:await response.json()};
  }
  return {request,jar};
}
const loginOptions=(challenge,credential='example-google-token-value')=>({method:'POST',headers:{origin:env.APP_ORIGIN,'content-type':'application/json','x-csrf-token':challenge.csrf},body:JSON.stringify({credential})});
const profile=nonce=>({sub:'google-user-123',email:'test@example.com',name:'Test Person',email_verified:true,nonce});

test('missing/invalid configuration disables sign-in without breaking the page',async t=>{
  const {request}=await app(t,{env:{}});
  const session=await request();assert.deepEqual(session.data,{configured:false,user:null});
  assert.equal(session.headers.get('cache-control'),'no-store, private');
  assert.equal((await request('google',{method:'POST'})).status,503);
});
test('challenge uses a Secure HttpOnly host cookie and never sends the signing secret',async t=>{
  const {request}=await app(t);
  const result=await request();
  assert.equal(result.data.clientId,env.GOOGLE_CLIENT_ID);assert.equal(result.data.user,null);
  assert.match(result.data.nonce,/^[\w-]{43}$/);
  const cookie=result.headers.get('set-cookie');
  for(const attribute of ['__Host-ticky_auth=','HttpOnly','Secure','SameSite=Lax','Path=/'])assert.ok(cookie.includes(attribute));
  assert.ok(!JSON.stringify(result.data).includes(env.AUTH_SESSION_SECRET));
  assert.equal((await request()).data.nonce,result.data.nonce);
});
test('login verifies audience/nonce, persists a session, then logout clears it',async t=>{
  let nonce,verifiedAudience;
  const {request,jar}=await app(t,{verifyToken:async(token,audience)=>{verifiedAudience=audience;return profile(nonce);}});
  const challenge=(await request()).data;nonce=challenge.nonce;
  const login=await request('google',loginOptions(challenge));
  assert.equal(login.status,200);assert.equal(verifiedAudience,env.GOOGLE_CLIENT_ID);
  assert.equal(login.data.user.id,'google-user-123');assert.ok(jar.has('__Host-ticky_session'));
  assert.ok(!jar.has('__Host-ticky_auth'));
  const restored=await request();assert.deepEqual(restored.data.user,login.data.user);
  const logout=await request('logout',{method:'POST',headers:{origin:env.APP_ORIGIN,'x-csrf-token':restored.data.csrf}});
  assert.equal(logout.status,200);assert.equal(jar.size,0);assert.equal((await request()).data.user,null);
});
test('login rejects forged credentials without creating a session',async t=>{
  const {request,jar}=await app(t,{verifyToken:async()=>{throw new Error('Invalid signature');}});
  const result=await request('google',loginOptions((await request()).data));
  assert.equal(result.status,401);assert.ok(!jar.has('__Host-ticky_session'));
  assert.ok(!result.data.error.includes('signature'));
});
test('login rejects a mismatched nonce or unverified email',async t=>{
  let payload=profile('wrong-nonce');
  const {request,jar}=await app(t,{verifyToken:async()=>payload});
  const challenge=(await request()).data;
  assert.equal((await request('google',loginOptions(challenge))).status,401);
  payload={...profile(challenge.nonce),email_verified:false};
  assert.equal((await request('google',loginOptions(challenge))).status,401);assert.ok(!jar.has('__Host-ticky_session'));
});
test('cross-origin and missing CSRF requests are rejected before Google verification',async t=>{
  let verifications=0;
  const {request}=await app(t,{verifyToken:async()=>{verifications++;}});
  const challenge=(await request()).data;
  const requestOptions=loginOptions(challenge);requestOptions.headers.origin='https://evil.example';
  assert.equal((await request('google',requestOptions)).status,403);
  delete requestOptions.headers.origin;assert.equal((await request('google',requestOptions)).status,403);
  requestOptions.headers.origin=env.APP_ORIGIN;delete requestOptions.headers['x-csrf-token'];
  assert.equal((await request('google',requestOptions)).status,403);
  assert.equal((await request('logout',{method:'POST',headers:{origin:env.APP_ORIGIN}})).status,403);
  assert.equal(verifications,0);
});
test('tampered and expired sessions are not authenticated',async t=>{
  let now=Date.now(),nonce;
  const {request,jar}=await app(t,{clock:()=>now,verifyToken:async()=>profile(nonce)});
  const challenge=(await request()).data;nonce=challenge.nonce;
  await request('google',loginOptions(challenge));
  const cookie=jar.get('__Host-ticky_session');
  jar.set('__Host-ticky_session',cookie+'x');assert.equal((await request()).data.user,null);
  jar.set('__Host-ticky_session',cookie);now+=13*60*60*1000;assert.equal((await request()).data.user,null);
});
test('expired login challenges require a new attempt',async t=>{
  let now=Date.now(),calls=0;
  const {request}=await app(t,{clock:()=>now,verifyToken:async()=>{calls++;}});
  const challenge=(await request()).data;now+=11*60*1000;
  assert.equal((await request('google',loginOptions(challenge))).status,403);assert.equal(calls,0);
  assert.notEqual((await request()).data.nonce,challenge.nonce);
});
test('request validation enforces methods, JSON and body limits',async t=>{
  const {request}=await app(t);
  assert.equal((await request('google')).status,405);
  assert.equal((await request('session',{method:'POST'})).status,405);
  assert.equal((await request('unknown')).status,404);
  assert.equal((await request('toString')).status,404);
  const challenge=(await request()).data,options=loginOptions(challenge);
  options.headers['content-type']='text/plain';assert.equal((await request('google',options)).status,415);
  options.headers['content-type']='application/json';options.body='invalid';assert.equal((await request('google',options)).status,400);
  options.body=JSON.stringify({credential:'a'.repeat(22000)});assert.equal((await request('google',options)).status,413);
});
test('localhost cookies work over HTTP without weakening production cookies',async t=>{
  const {request}=await app(t,{env:{...env,APP_ORIGIN:'http://localhost:3000'}});
  const result=await request();const cookie=result.headers.get('set-cookie');
  assert.match(cookie,/^ticky_auth=/);assert.ok(!cookie.includes('; Secure'));assert.ok(cookie.includes('HttpOnly'));
});
test('real Google verifier rejects wrong audience, issuer, expiration and signature',async t=>{
  const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  t.mock.method(OAuth2Client.prototype,'getFederatedSignonCertsAsync',async()=>({certs:{test:publicKey.export({type:'spki',format:'pem'})}}));
  const now=Math.floor(Date.now()/1000);
  const claims={...profile('nonce'),aud:env.GOOGLE_CLIENT_ID,iss:'https://accounts.google.com',iat:now,exp:now+3600};
  function token(payload,key=privateKey){
    const unsigned=[{alg:'RS256',kid:'test'},payload].map(value=>Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
    return `${unsigned}.${sign('RSA-SHA256',Buffer.from(unsigned),key).toString('base64url')}`;
  }
  assert.equal((await verifyGoogleToken(token(claims),env.GOOGLE_CLIENT_ID)).sub,claims.sub);
  await assert.rejects(verifyGoogleToken(token({...claims,aud:'other-app'}),env.GOOGLE_CLIENT_ID));
  await assert.rejects(verifyGoogleToken(token({...claims,iss:'https://evil.example'}),env.GOOGLE_CLIENT_ID));
  await assert.rejects(verifyGoogleToken(token({...claims,iat:now-4000,exp:now-1000}),env.GOOGLE_CLIENT_ID));
  const wrongKey=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey;
  await assert.rejects(verifyGoogleToken(token(claims,wrongKey),env.GOOGLE_CLIENT_ID));
});
test('Vercel and local server apply the same Google-compatible security headers',()=>{
  const expected=require('../lib/security-headers');
  const deployed=Object.fromEntries(require('../vercel.json').headers[0].headers.map(header=>[header.key,header.value]));
  assert.deepEqual(deployed,expected);
});
