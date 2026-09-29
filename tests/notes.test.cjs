const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {createAuthHandler}=require('../lib/auth');
const {createNotesHandler,firebaseStore}=require('../lib/notes');
const env={GOOGLE_CLIENT_ID:'test.apps.googleusercontent.com',AUTH_SESSION_SECRET:'test-secret-'.repeat(5),APP_ORIGIN:'http://localhost:3000'};
const empty=()=>({notes:[],categories:[],vault:null});
const note=title=>({id:'note-1',title,body:'My note',type:'text',color:'yellow',checked:[],created:1,updated:1,pinned:false,trash:false,strike:false});

async function fixture(t){
  const rows=new Map();let identity,nonce;
  const auth=createAuthHandler({env,verifyToken:async()=>({sub:identity,email:identity+'@example.com',name:identity,email_verified:true,nonce})});
  const notes=createNotesHandler({env,store:{
    async load(id){return rows.get(id)||{version:0,data:empty()};},
    async save(id,version,data){if((rows.get(id)?.version||0)!==version)throw Object.assign(new Error('Save conflict'),{status:409});rows.set(id,{version:version+1,data});return {version:version+1};}
  }});
  const server=http.createServer((req,res)=>req.url.startsWith('/api/auth')?auth(req,res):notes(req,res));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function login(id){
    const jar=new Map();
    async function request(path,options={}){
      const response=await fetch(base+path,{...options,headers:{cookie:[...jar].map(([k,v])=>k+'='+v).join(';'),...options.headers}});
      for(const cookie of response.headers.getSetCookie()){const [pair]=cookie.split(';'),at=pair.indexOf('=');if(cookie.includes('Max-Age=0'))jar.delete(pair.slice(0,at));else jar.set(pair.slice(0,at),pair.slice(at+1));}
      return {status:response.status,data:await response.json()};
    }
    const challenge=(await request('/api/auth')).data;identity=id;nonce=challenge.nonce;
    assert.equal((await request('/api/auth?action=google',{method:'POST',headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json','X-CSRF-Token':challenge.csrf},body:JSON.stringify({credential:'test-token-that-is-long-enough'})})).status,200);
    const csrf=(await request('/api/auth')).data.csrf;
    const headers={'X-Account-Id':id,Origin:env.APP_ORIGIN,'X-CSRF-Token':csrf,'Content-Type':'application/json'};
    return {request,jar,headers,load:()=>request('/api/notes',{headers}),save:(data,version=0)=>request('/api/notes',{method:'PUT',headers,body:JSON.stringify({data,version})})};
  }
  return {login,base,rows};
}

test('notes belong to the verified account and follow it across browser sessions',async t=>{
  const {login,rows}=await fixture(t),a=await login('account-a'),b=await login('account-b');
  assert.equal((await a.save({...empty(),notes:[note('Only A')]})).status,200);
  assert.deepEqual((await b.load()).data.data.notes,[]);
  assert.equal((await b.save({...empty(),notes:[note('Only B')]})).status,200);
  assert.equal((await (await login('account-a')).load()).data.data.notes[0].title,'Only A');
  assert.equal((await b.load()).data.data.notes[0].title,'Only B');
  assert.equal((await a.request('/api/notes?account_id=account-b',{headers:a.headers})).data.data.notes[0].title,'Only A');
  assert.equal((await a.request('/api/notes',{headers:{...a.headers,'X-Account-Id':'account-b'}})).status,409);
  assert.equal(rows.size,2);
});

test('unsigned, tampered, signed-out and cross-origin requests cannot access or change notes',async t=>{
  const {login,base}=await fixture(t);
  assert.equal((await fetch(base+'/api/notes')).status,401);
  const a=await login('account-a');
  assert.equal((await a.request('/api/notes',{method:'PUT',headers:{...a.headers,Origin:'https://evil.example'},body:JSON.stringify({version:0,data:empty()})})).status,403);
  assert.equal((await a.request('/api/notes',{method:'PUT',headers:{...a.headers,'X-CSRF-Token':'bad'},body:JSON.stringify({version:0,data:empty()})})).status,403);
  assert.equal((await a.request('/api/notes',{headers:{...a.headers,cookie:'ticky_session=tampered'}})).status,401);
  assert.equal((await a.request('/api/auth?action=logout',{method:'POST',headers:a.headers})).status,200);
  assert.equal((await a.load()).status,401);
});

test('stale saves conflict and malformed or oversized documents are rejected',async t=>{
  const {login}=await fixture(t),a=await login('account-a');
  assert.equal((await a.save(empty())).status,200);
  assert.equal((await a.save({...empty(),notes:[note('Stale')]})).status,409);
  assert.deepEqual((await a.load()).data.data.notes,[]);
  assert.equal((await a.save({notes:'bad'},1)).status,400);
  assert.equal((await a.save({...empty(),notes:[{...note('Invalid'),color:'bad injected class'}]},1)).status,400);
  assert.equal((await a.request('/api/notes',{method:'PUT',headers:a.headers,body:JSON.stringify({version:1,data:empty(),padding:'x'.repeat(2*1024*1024)})})).status,413);
});

const firebaseEnv={FIREBASE_DATABASE_URL:'https://test.firebaseio.com'};
const token=async()=>'server-token';
const response=(data,etag='"v1"',status=200)=>({ok:status===200,status,headers:new Headers(etag?{etag}:{}),json:async()=>data});
test('Firebase scopes accounts, preserves JSON data, and uses conditional authenticated saves',async()=>{
  const rows=new Map(),calls=[];
  const store=firebaseStore(firebaseEnv,async(url,options)=>{
    const key=String(url);calls.push({url:key,options});
    if(options.method==='PUT')rows.set(key,JSON.parse(options.body));
    return response(rows.get(key)||null);
  },token);
  assert.deepEqual(await store.load('account-a'),{version:0,data:empty()});
  const data={...empty(),notes:[note('Round trip')]};
  assert.deepEqual(await store.save('account-a',0,data),{version:1});
  assert.deepEqual(await store.load('account-a'),{version:1,data});
  assert.deepEqual(await store.load('account-b'),{version:0,data:empty()});
  const put=calls.find(c=>c.options.method==='PUT');
  assert.equal(put.url,'https://test.firebaseio.com/account_notes/'+Buffer.from('account-a').toString('base64url')+'.json');
  assert.equal(put.options.headers.Authorization,'Bearer server-token');
  assert.equal(put.options.headers['if-match'],'"v1"');
  assert.equal(calls[1].options.headers['X-Firebase-ETag'],'true');
  await assert.rejects(store.save('account-a',0,empty()),e=>e.status===409);
});
test('Firebase detects concurrent writes and hides provider failures',async()=>{
  const conflict=firebaseStore(firebaseEnv,async(url,options)=>response(null,'"v1"',options.method==='PUT'?412:200),token);
  await assert.rejects(conflict.save('a',0,empty()),e=>e.status===409);
  const unavailable=firebaseStore(firebaseEnv,async()=>{throw new Error('private provider details');},token);
  await assert.rejects(unavailable.load('a'),e=>e.status===503&&!e.message.includes('private provider'));
  await assert.rejects(firebaseStore({}).load('a'),/not configured/);
  await assert.rejects(firebaseStore({...firebaseEnv,FIREBASE_SERVICE_ACCOUNT_JSON:'bad'}).load('a'),/not configured/);
  const missingTag=firebaseStore(firebaseEnv,async()=>response(null,null),token);
  await assert.rejects(missingTag.save('a',0,empty()),e=>e.status===503);
  const malformed=firebaseStore(firebaseEnv,async()=>response({version:1,data:'broken'}),token);
  await assert.rejects(malformed.load('a'),e=>e.status===503);
});
