const {test}=require('node:test');
const assert=require('node:assert/strict');
const {AccountCloud}=require('../cloud');
const result=data=>({ok:true,json:async()=>data});
const empty={notes:[],categories:[],vault:null};

test('client loads cloud data and serializes saves using the latest version',async()=>{
  const versions=[];
  const cloud=new AccountCloud(async(url,options)=>{
    if(url.includes('auth'))return result({user:{id:'a'},csrf:'csrf'});
    if(options.method==='PUT'){const body=JSON.parse(options.body);versions.push(body.version);assert.equal(options.headers['X-Account-Id'],'a');return result({version:body.version+1});}
    return result({version:4,data:empty});
  });
  assert.deepEqual(await cloud.open('a'),empty);
  await Promise.all([cloud.save(empty),cloud.save(empty)]);
  assert.deepEqual(versions,[4,5]);assert.equal(cloud.version,6);
  await cloud.open(null);await assert.rejects(cloud.save(empty),/Sign in/);
});

test('account switch during loading never applies the previous account response',async()=>{
  let finishA;
  const cloud=new AccountCloud(async(url,options)=>options.headers['X-Account-Id']==='a'?new Promise(resolve=>{finishA=resolve;}):result({version:2,data:empty}));
  const pending=cloud.open('a');const rejected=assert.rejects(pending,/Account changed/);
  await cloud.open('b');finishA(result({version:9,data:{...empty,notes:['a secret']}}));await rejected;
  assert.equal(cloud.id,'b');assert.equal(cloud.version,2);
});

test('cookie account changes stop old-tab writes and failed saves never advance versions',async()=>{
  let writes=0;
  const cloud=new AccountCloud(async(url,options)=>{
    if(url.includes('auth'))return result({user:{id:'b'},csrf:'csrf'});
    if(options.method==='PUT')writes++;
    return result({version:1,data:empty});
  });
  await cloud.open('a');await assert.rejects(cloud.save(empty),/account changed/);assert.equal(writes,0);assert.equal(cloud.version,1);
  cloud.request=async url=>url.includes('auth')?result({user:{id:'a'},csrf:'csrf'}):{ok:false,json:async()=>({error:'Save conflict'})};
  await assert.rejects(cloud.save(empty),/Save conflict/);assert.equal(cloud.version,1);
});
