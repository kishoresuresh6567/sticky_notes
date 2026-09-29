const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
function fixture(){
  const elements=new Map(),events=[],activations=[];
  function element(){const classes=new Set(),listeners={};return {hidden:false,disabled:false,open:false,textContent:'',clientWidth:400,classList:{add:k=>classes.add(k),toggle(k,v){v?classes.add(k):classes.delete(k);},contains:k=>classes.has(k)},addEventListener(k,f){listeners[k]=f;},fire(k){return listeners[k]?.({});},showModal(){this.open=true;},close(){this.open=false;},setAttribute(){},replaceChildren(){}};}
  const document={body:element(),querySelector(s){if(!elements.has(s))elements.set(s,element());return elements.get(s);},querySelectorAll(){return [...elements.values()].filter(e=>e.open);},dispatchEvent(e){events.push(e);}};
  const user={id:'a',name:'Alice',email:'a@example.com'};
  let signedIn=true,failLogout=false,deferred=null;
  const window={location:{origin:'http://localhost:3000'},accountCloud:{ready:true,id:'a'},addEventListener(){},async activateNotes(user){activations.push(user);this.accountCloud.ready=!!user;this.accountCloud.id=user?.id||null;},google:{accounts:{id:{disableAutoSelect(){throw Error('SDK unavailable');}}}}};
  const fetch=async url=>{
    if(url.includes('logout')){if(failLogout)return {ok:false,json:async()=>({error:'Logout failed. Retry.'})};signedIn=false;return {ok:true,json:async()=>({ok:true})};}
    const data={configured:true,user:signedIn?user:null,csrf:'csrf',origin:window.location.origin};
    if(deferred){const fn=deferred;deferred=null;return fn(data);}
    return {ok:true,json:async()=>data};
  };
  vm.runInNewContext(fs.readFileSync('auth.js','utf8'),{document,window,fetch,AbortController,setTimeout,clearTimeout,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}}});
  return {elements,events,activations,window,setFail:()=>{failLogout=true;},defer(fn){deferred=fn;}};
}
test('account menu stays open and confirmed logout clears the workspace even if Google helper fails',async()=>{
  const f=fixture();await settle();
  const dialog=f.elements.get('#account-dialog');assert.equal(dialog.open,false);
  f.elements.get('#account-button').fire('click');await settle();
  assert.equal(dialog.open,true);assert.equal(f.elements.get('#signout-button').hidden,false);
  await f.elements.get('#signout-button').fire('click');
  assert.equal(f.window.accountCloud.ready,false);assert.equal(f.activations.at(-1),null);
  assert.equal(f.elements.get('#account-button').textContent,'Sign in');
  assert.equal(f.elements.get('#signout-button').hidden,true);
  assert.equal(f.elements.get('#auth-retry').hidden,false);
  assert.equal(f.events.at(-1).detail.signedIn,false);
});
test('failed logout preserves the signed-in account and allows retry',async()=>{
  const f=fixture();await settle();f.setFail();
  await f.elements.get('#signout-button').fire('click');
  assert.equal(f.window.accountCloud.ready,true);
  assert.equal(f.elements.get('#signout-button').disabled,false);
  assert.equal(f.elements.get('#auth-message').textContent,'Logout failed. Retry.');
});
test('a session response started before logout cannot restore the signed-in display',async()=>{
  const f=fixture();await settle();let release;
  f.defer(data=>new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>data});}));
  f.elements.get('#account-button').fire('click');await settle();
  await f.elements.get('#signout-button').fire('click');release();await settle();
  assert.equal(f.window.accountCloud.ready,false);
  assert.equal(f.elements.get('#account-button').textContent,'Sign in');
});
