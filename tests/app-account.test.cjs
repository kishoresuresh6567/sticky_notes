const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {webcrypto}=require('node:crypto');

function app(){
  const elements=new Map(),saved=[];
  function element(){return {value:'',textContent:'',dataset:{},open:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},append(){},replaceChildren(){},addEventListener(){},close(){this.open=false;},showModal(){this.open=true;},reset(){},focus(){}};}
  const document={documentElement:element(),querySelector(s){if(!elements.has(s))elements.set(s,element());return elements.get(s);},querySelectorAll(){return [];},createElement:element,createElementNS:element,addEventListener(){}};
  const cloud={id:null,ready:false,async open(id){this.id=id;this.ready=!!id;return id?{notes:[],categories:[],vault:null}:null;},async save(data){saved.push({id:this.id,data:structuredClone(data)});}};
  const context=vm.createContext({document,window:{accountCloud:cloud},localStorage:{getItem(k){assert.equal(k,'little-notes-theme');return null;},setItem(){throw Error('Notes must not be stored locally');}},crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,structuredClone,btoa,atob,setTimeout(){return 1;},clearTimeout(){}});
  vm.runInContext(fs.readFileSync('app.js','utf8'),context);
  return {run:s=>vm.runInContext(s,context),context,cloud,saved,elements};
}

test('account changes clear notes, drafts, categories and decrypted vault state',async()=>{
  const a=app();await a.run("activateNotes({id:'a'})");
  a.run("notes=[{id:'a-secret'}];categories=[{id:'private-category'}];privateNotes=[{body:'vault secret'}];key={};editing={body:'draft'};pendingVaultNote={body:'pending secret'};view='vault';$('#note-body').value='draft';$('#vault-password').value='password';");
  await a.run("activateNotes({id:'b'})");
  assert.equal(a.run('notes.length+categories.length+privateNotes.length'),0);
  assert.equal(a.run('key===null&&editing===null&&pendingVaultNote===null'),true);
  assert.equal(a.run("$('#vault-password').value"),'');
  await a.run('activateNotes(null)');assert.equal(a.cloud.ready,false);
});

test('cloud snapshots include categories and encrypted vault, never plaintext private notes',async()=>{
  const a=app();await a.run("activateNotes({id:'a'})");
  await a.run("(async()=>{const salt=crypto.getRandomValues(new Uint8Array(16));key=await derive('test-password',salt);vaultRecord={salt:b64(salt)};privateNotes=[{body:'private text'}];categories=[{id:'c',name:'Work'}];await persist();})()");
  assert.equal(a.saved[0].id,'a');assert.equal(a.saved[0].data.categories[0].name,'Work');
  assert.ok(a.saved[0].data.vault.data);assert.ok(!JSON.stringify(a.saved).includes('private text'));
});

test('switching accounts cancels an in-progress vault encryption before upload',async()=>{
  const a=app();await a.run("activateNotes({id:'a'})");
  let finish;
  a.context.slowEncrypt=()=>new Promise(resolve=>{finish=resolve;});
  a.run("encryptVault=slowEncrypt;key={};privateNotes=[{body:'a secret'}];");
  const pending=a.run('persist()');const rejected=assert.rejects(pending,/Account changed/);
  await new Promise(resolve=>setImmediate(resolve));
  await a.run("activateNotes({id:'b'})");finish({data:'encrypted'});await rejected;
  assert.equal(a.saved.length,0);
});

test('failed editor saves retain the draft and retry without duplicating the note',async()=>{
  const a=app();await a.run("activateNotes({id:'a'})");
  a.run("$('#note-title').value='Draft';$('#note-body').value='Keep this text';$('#note-type').value='text';$('#note-category').value='';");
  const save=a.cloud.save;
  a.cloud.save=async()=>{throw Error('Cloud unavailable');};
  await a.elements.get('#note-form').onsubmit({preventDefault(){}});
  assert.equal(a.run('notes.length'),0);
  assert.equal(a.elements.get('#note-body').value,'Keep this text');
  assert.equal(a.elements.get('#sync-error').hidden,false);
  a.cloud.save=save;
  await a.elements.get('#note-form').onsubmit({preventDefault(){}});
  assert.equal(a.run('notes.length'),1);assert.equal(a.saved.length,1);
  assert.equal(a.elements.get('#sync-error').hidden,true);
});
