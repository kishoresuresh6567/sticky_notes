const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {webcrypto}=require('node:crypto');

function app(){
  const elements=new Map(),saved=[];
  function element(){return {value:'',textContent:'',children:[],dataset:{},open:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},addEventListener(){},close(){this.open=false;},showModal(){this.open=true;},reset(){},focus(){},setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}};}
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


test('editor switches between plain text, checklist and bullets without losing text or completion',async()=>{
 const a=app();await a.run("activateNotes({id:'a'})");
 a.run("openEditor();$('#note-body').value='First\\nSecond';$('#note-type').value='checklist';$('#note-type').onchange();");
 assert.equal(a.elements.get('#note-body').hidden,true);
 assert.equal(a.elements.get('#list-editor').hidden,false);
 const rows=a.elements.get('#editor-items').children;
 assert.equal(rows.length,2);assert.equal(rows[0].children[0].type,'checkbox');
 rows[1].children[0].checked=true;rows[1].children[0].onchange();
 rows[1].children[1].value='Updated';rows[1].children[1].oninput();
 a.run("$('#note-type').value='bullets';$('#note-type').onchange();");
 assert.equal(a.elements.get('#editor-items').children[0].children[0].textContent,'?');
 a.run("$('#note-type').value='text';$('#note-type').onchange();");
 assert.equal(a.elements.get('#note-body').hidden,false);
 assert.equal(a.elements.get('#note-body').value,'First\nUpdated');
 a.run("$('#note-type').value='checklist';$('#note-type').onchange();");
 assert.equal(a.elements.get('#editor-items').children[1].children[0].checked,true);
 await a.elements.get('#note-form').onsubmit({preventDefault(){}});
 assert.equal(a.saved[0].data.notes[0].body,'First\nUpdated');
 assert.deepEqual(a.saved[0].data.notes[0].checked,[1]);
});

test('list editor splits, merges, pastes and removes items and clears drafts on account switch',async()=>{
 const a=app();await a.run("activateNotes({id:'a'})");
 a.run("openEditor();$('#note-body').value='FirstSecond';$('#note-type').value='checklist';$('#note-type').onchange();");
 let input=a.elements.get('#editor-items').children[0].children[1];
 input.selectionStart=5;input.selectionEnd=5;
 input.onkeydown({key:'Enter',preventDefault(){}});
 assert.equal(a.elements.get('#note-body').value,'First\nSecond');
 input=a.elements.get('#editor-items').children[1].children[1];input.selectionStart=0;input.selectionEnd=0;
 input.onkeydown({key:'Backspace',preventDefault(){}});
 assert.equal(a.elements.get('#note-body').value,'FirstSecond');
 input=a.elements.get('#editor-items').children[0].children[1];input.selectionStart=5;input.selectionEnd=5;
 input.onpaste({clipboardData:{getData:()=> '\r\nMiddle\r\n'},preventDefault(){}});
 assert.equal(a.elements.get('#note-body').value,'First\nMiddle\nSecond');
 a.elements.get('#editor-items').children[1].children[2].onclick();
 assert.equal(a.elements.get('#note-body').value,'First\nSecond');
 a.elements.get('#add-editor-item').onclick();assert.equal(a.elements.get('#editor-items').children.length,3);
 await a.run('activateNotes(null)');assert.equal(a.elements.get('#editor-items').children.length,0);
 assert.equal(a.run('editorItems.length'),0);
});
