const $ = s => document.querySelector(s);
function setTheme(theme){
  document.documentElement.dataset.theme=theme;
  document.querySelectorAll('button[data-theme]').forEach(button=>button.setAttribute('aria-pressed',button.dataset.theme===theme));
}
let savedTheme='light';
try{savedTheme=localStorage.getItem('little-notes-theme')==='dark'?'dark':'light';}catch{}
setTheme(savedTheme);
document.querySelectorAll('button[data-theme]').forEach(button=>button.addEventListener('click',()=>{
  setTheme(button.dataset.theme);
  try{localStorage.setItem('little-notes-theme',button.dataset.theme);}catch{toast('Theme changed, but your browser could not save this preference.');}
}));
const colors = {yellow:'Butter yellow',green:'Sage green',pink:'Soft rose',blue:'Sky blue',purple:'Lavender',cream:'Warm neutral',gold:'Sunshine',orange:'Tangerine',coral:'Coral red',teal:'Deep teal',cobalt:'Cobalt blue',violet:'Royal violet',berry:'Berry',navy:'Midnight blue',charcoal:'Charcoal'};
const STORE='little-notes-v1', VAULT='little-notes-vault-v1';
const CATEGORY_STORE='little-notes-categories-v1';
let categories=[],activeCategory='';
try{categories=JSON.parse(localStorage.getItem(CATEGORY_STORE)||'[]');}catch{toast('Could not load categories.');}
function categoryName(id){return categories.find(category=>category.id===id)?.name||'Uncategorized';}
function populateCategorySelect(selected=''){
  const select=$('#note-category');select.replaceChildren();
  [{id:'',name:'Uncategorized'},...categories].forEach(category=>{const option=el('option','',category.name);option.value=category.id;select.append(option);});
  select.value=categories.some(category=>category.id===selected)?selected:'';
}
function renderCategories(){
  const list=$('#category-list');list.replaceChildren();
  [{id:'',name:'Uncategorized'},...categories].forEach(category=>{
    const button=el('button','category-link',category.name);button.type='button';
    button.classList.toggle('active',view==='category'&&activeCategory===category.id);
    button.setAttribute('aria-pressed',view==='category'&&activeCategory===category.id);
    const count=notes.filter(note=>!note.trash&&(note.category||'')===category.id).length;
    button.append(el('span','',String(count)));
    button.onclick=()=>{activeCategory=category.id;view='category';render();};
    const row=el('div','category-row');row.append(button);
    if(category.id){
      row.append(action(`Rename ${category.name}`,'✎',()=>renameCategory(category.id)));
      const remove=action(`Delete ${category.name}`,'×',()=>deleteCategory(category.id));
      remove.disabled=categoryHasNotes(category.id);
      if(remove.disabled)remove.title='Remove or reassign all notes, including Trash notes, before deleting this category';
      row.append(remove);
    }
    list.append(row);
  });
}
function categoryHasNotes(id){return [...notes,...privateNotes].some(note=>note.category===id);}
function deleteCategory(id){
  if(!id||!categories.some(category=>category.id===id))return;
  if(categoryHasNotes(id)){toast('This category still contains notes, including possible notes in Trash.');return;}
  if(vaultRecord&&!key){toast('Unlock your vault to check for notes, then delete the category.');openVault();return;}
  const next=categories.filter(category=>category.id!==id);
  try{localStorage.setItem(CATEGORY_STORE,JSON.stringify(next));}catch{toast('Could not delete the category.');return;}
  categories=next;
  if(view==='category'&&activeCategory===id){view='all';activeCategory='';}
  render();toast('Empty category deleted');
}
function renameCategory(id){
  const category=categories.find(item=>item.id===id);
  if(!category)return;
  const entered=window.prompt('Rename category:',category.name);
  if(entered===null)return;
  const name=entered.trim();
  if(!name||name.length>40){toast('Use a category name between 1 and 40 characters.');return;}
  if(name.toLowerCase()==='uncategorized'||categories.some(item=>item.id!==id&&item.name.toLowerCase()===name.toLowerCase())){toast('That category already exists.');return;}
  const next=categories.map(item=>item.id===id?{...item,name}:item);
  try{localStorage.setItem(CATEGORY_STORE,JSON.stringify(next));}catch{toast('Could not save the category name.');return;}
  categories=next;render();toast('Category renamed');
}
$('#category-form').onsubmit=event=>{
  event.preventDefault();const input=$('#category-name'),name=input.value.trim();
  if(!name){$('#category-error').textContent='Enter a category name.';return;}
  if(name.toLowerCase()==='uncategorized'||categories.some(category=>category.name.toLowerCase()===name.toLowerCase())){$('#category-error').textContent='That category already exists.';return;}
  const category={id:crypto.randomUUID(),name},next=[...categories,category];
  try{localStorage.setItem(CATEGORY_STORE,JSON.stringify(next));}catch{$('#category-error').textContent='Could not save this category.';return;}
  categories=next;input.value='';$('#category-error').textContent='';renderCategories();toast('Category created — choose it when editing a note');
};
let notes=[], privateNotes=[], key=null, vaultRecord=null, view='all', editing=null, selectedColor='yellow', timer, saving=Promise.resolve();
const now=Date.now();
const sample=(title,body,color,type='text',pinned=false)=>({id:crypto.randomUUID(),title,body,color,type,pinned,checked:[],created:now,updated:now,trash:false,strike:false});
try{const stored=localStorage.getItem(STORE);notes=stored?JSON.parse(stored):[
sample('A fresh little start ✨','A place for all the things floating around in your head.\n\nMake a note. Pick a color. Make a little room.','yellow','text',true),
sample('Today, one thing at a time','Make a little plan for the day\nTake a proper lunch break\nFinish that thing I’ve been putting off\nGo for an evening walk','green','checklist',true),
sample('Ideas worth keeping','A Sunday morning book club\nA tiny herb garden by the window\nThat side project I keep thinking about','purple','bullets'),
sample('The weekend list','Pick up fresh flowers\nFind a new coffee spot\nCall home\nAbsolutely nothing, for a little while','pink','checklist'),
sample('A little reminder','You don’t have to do it all today.\n\nSmall steps still move you forward. ☁','blue'),
sample('Good things to come back to','That recipe from a friend\nThe book everyone keeps mentioning\nA place to visit when it rains','cream','bullets')]; if(!stored){notes[1].checked=[0];notes[3].checked=[0];localStorage.setItem(STORE,JSON.stringify(notes));}vaultRecord=JSON.parse(localStorage.getItem(VAULT)||'null');}catch(e){toast('Could not load saved notes. Browser storage may be unavailable.');}
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toast.timeout);toast.timeout=setTimeout(()=>$('#toast').classList.remove('visible'),3500);}
function el(tag,cls,text){const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;}
const cardIcons={
edit:'M16 3l5 5M4 20l4-1L21 6l-4-4L4 15v5Z',
pin:'m16 3 5 5-4 1-4 4v4l-3-3-6 6m6-6-3-3h4l4-4 1-4Z',
copy:'M8 8h12v13H8ZM16 8V3H3v13h5',
trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
restore:'M3 4v6h6M3 10a9 9 0 1 1 1 9',
lock:'M5 10h14v11H5ZM8 10V7a4 4 0 0 1 8 0v3m-4 5v2',
unlock:'M5 10h14v11H5ZM8 10V7a4 4 0 0 1 7.5-2m-3.5 10v2'
};
function cardIcon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('class','card-icon');svg.setAttribute('aria-hidden','true');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',cardIcons[name]);svg.append(path);return svg;}
function action(label,text,fn){const b=el('button','icon-btn');const name=label.includes('Edit')?'edit':label.includes('pin')||label.includes('Pin')?'pin':label.includes('Copy')?'copy':label.includes('Restore')?'restore':label.includes('out of')?'unlock':label.includes('vault')?'lock':label.includes('trash')||label.includes('delete')?'trash':null;if(name)b.append(cardIcon(name));else b.textContent=text;if(label==='Permanently delete note')b.append(document.createTextNode('Delete forever'));b.type='button';b.title=label;b.setAttribute('aria-label',label);b.addEventListener('click',fn);return b;}
let pendingVaultNote=null;
async function moveVaultNote(note){
 if(!key){pendingVaultNote=note;openVault();return;}
 const wasPrivate=privateNotes.includes(note),source=wasPrivate?privateNotes:notes,target=wasPrivate?notes:privateNotes,index=source.indexOf(note);
 if(index<0||note.trash)return;
 await saving.catch(()=>{});
 const nextSource=source.filter(n=>n!==note),nextTarget=[...target,note];
 try{
  const record=await encryptVault(wasPrivate?nextSource:nextTarget,key,vaultRecord);
  // Save the destination first so a storage failure cannot lose the note.
  if(wasPrivate){localStorage.setItem(STORE,JSON.stringify(nextTarget));localStorage.setItem(VAULT,JSON.stringify(record));}
  else{localStorage.setItem(VAULT,JSON.stringify(record));localStorage.setItem(STORE,JSON.stringify(nextSource));}
  vaultRecord=record;source.splice(index,1);target.push(note);render();toast(wasPrivate?'Moved out of private vault':'Moved into private vault');
 }catch{toast('Could not move note. Browser storage may be full or unavailable.');}
}
function b64(bytes){return btoa(String.fromCharCode(...bytes));}function unb64(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}
async function derive(password,salt){const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:600000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
async function encryptVault(data,vaultKey,record){const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},vaultKey,new TextEncoder().encode(JSON.stringify(data)));return {...record,iv:b64(iv),data:b64(new Uint8Array(encrypted))};}
function persist(){const publicSnapshot=JSON.stringify(notes);const privateSnapshot=structuredClone(privateNotes), currentKey=key, record=vaultRecord;saving=saving.catch(()=>{}).then(async()=>{let encrypted;if(currentKey)encrypted=await encryptVault(privateSnapshot,currentKey,record);localStorage.setItem(STORE,publicSnapshot);if(encrypted){localStorage.setItem(VAULT,JSON.stringify(encrypted));vaultRecord=encrypted;}});return saving;}
async function commit(){try{await persist();return true;}catch{toast('Could not save. Your browser storage may be full or unavailable.');return false;}}
async function deleteForever(note){
  if(!note.trash||!window.confirm(`Permanently delete "${note.title||'Untitled note'}"? This cannot be undone.`))return;
  const list=notes.includes(note)?notes:privateNotes;
  const index=list.indexOf(note);
  if(index<0)return;
  list.splice(index,1);
  if(await commit()){render();toast('Note permanently deleted');}
  else{list.splice(index,0,note);render();}
}
function resetTimer(){clearTimeout(timer);if(key)timer=setTimeout(lockVault,5*60*1000);}
async function lockVault(){await saving.catch(()=>{});key=null;privateNotes=[];clearTimeout(timer);if($('#editor').open){$('#editor').close();$('#note-form').reset();}render();toast('Private vault locked');}
['pointerdown','keydown'].forEach(event=>document.addEventListener(event,resetTimer));
function render(){renderCategories();const titles={all:['All your notes','Big ideas, daily to-dos, and everything in between.'],pinned:['Keep these close','Your important things, always within reach.'],checklist:['One thing at a time','A little progress feels pretty good.'],vault:['Your private space','Encrypted notes for the things that are just for you.'],trash:['A second chance','Restore notes whenever you need them.'],category:[categoryName(activeCategory),'Everything in this category, in one place.']};$('#page-title').textContent=titles[view][0];$('#page-title').append(el('span','','.'));$('#page-subtitle').textContent=titles[view][1];$('#crumb').textContent={all:'All notes',pinned:'Pinned notes',checklist:'Checklists',vault:'Private vault',trash:'Trash',category:categoryName(activeCategory)}[view];document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',b.dataset.view===view));$('#count').textContent=notes.filter(n=>!n.trash).length;$('#lock-vault').hidden=!key;$('#board').replaceChildren();$('#vault-gate').hidden=true;
if(view==='vault'&&!key){const gate=$('#vault-gate');gate.hidden=false;gate.replaceChildren();const box=el('div','empty');box.append(el('div','','♙'),el('h2','',vaultRecord?'A little privacy goes a long way.':'Some things are just for you.'),el('p','','Store passwords, usernames, and bank details in your encrypted vault.\nYour password unlocks it only on this device.'));const b=el('button','primary',vaultRecord?'Unlock your vault':'Create your vault');b.onclick=openVault;box.append(b);gate.append(box);$('#result-count').textContent='Private & encrypted';return;}
const q=$('#search').value.toLowerCase();let list=(view==='vault'?privateNotes:view==='trash'?[...notes,...privateNotes]:notes).filter(n=>(view==='trash'?n.trash:!n.trash)&&(view!=='category'||(n.category||'')===activeCategory)&&(view!=='pinned'||n.pinned)&&(view!=='checklist'||n.type==='checklist')&&(`${n.title}\n${n.body}`).toLowerCase().includes(q));list.sort((a,b)=>$('#sort').value==='title'?a.title.localeCompare(b.title):b[$('#sort').value]-a[$('#sort').value]);$('#result-count').textContent=`${list.length} note${list.length===1?'':'s'}`;
const pinned=list.filter(n=>n.pinned),other=list.filter(n=>!n.pinned);if(pinned.length&&view!=='trash')section('♧  PINNED',pinned);if(other.length||!list.length||view==='trash')section(view==='trash'?'DELETED NOTES':pinned.length?'EVERYTHING ELSE':'YOUR NOTES',view==='trash'?list:other,true);
}
function section(title,list,add=false){const board=$('#board');board.append(el('div','section-label',title));const grid=el('div','grid');list.forEach(n=>grid.append(card(n)));if(add&&view!=='trash'){const b=el('button','add-card');b.append(el('span','','＋'),el('div','','A little thought? Write it down.'),el('small','','Your next idea starts here'));b.onclick=()=>openEditor();grid.append(b);}if(!list.length&&view==='trash')grid.append(el('p','hint','No deleted notes. A clean little slate.'));board.append(grid);}
function card(n){const article=el('article',`note ${n.color}`),head=el('div','note-head');head.append(el('h2','',n.title||'Untitled note'));if(n.pinned){const pin=el('span','pin');pin.title='Pinned note';pin.append(cardIcon('pin'));head.append(pin);}article.append(head);article.append(el('span','category-badge',categoryName(n.category)));const body=el('div',`note-body${n.strike?' struck':''}`);if(n.type==='text')body.textContent=n.body;else if(n.type==='bullets'){const ul=el('ul');n.body.split('\n').forEach(line=>ul.append(el('li','',line)));body.append(ul);}else n.body.split('\n').forEach((line,i)=>{if(!line)return;const row=el('label',`check-row${n.checked.includes(i)?' done':''}`),check=el('input');check.type='checkbox';check.checked=n.checked.includes(i);check.disabled=n.trash;check.onchange=async()=>{n.checked=check.checked?[...n.checked,i]:n.checked.filter(x=>x!==i);n.updated=Date.now();row.classList.toggle('done',check.checked);await commit();};row.append(check,el('span','',line));body.append(row);});article.append(body);const bottom=el('div','note-bottom');bottom.append(el('span','',`${view==='vault'?'Encrypted · ':''}${new Date(n.updated).toLocaleDateString(undefined,{month:'short',day:'numeric'})}`));const actions=el('div','note-actions');if(n.trash){actions.append(action('Restore note','↶',async()=>{n.trash=false;await commit();render();toast('Note restored');}));const deleteButton=action('Permanently delete note','Delete forever',()=>deleteForever(n));deleteButton.classList.add('delete-forever');actions.append(deleteButton);}else{actions.append(action('Edit note','✎',()=>openEditor(n)),action(n.pinned?'Unpin note':'Pin note','♧',async()=>{n.pinned=!n.pinned;await commit();render();}),action('Copy note','⧉',async()=>{const text=(n.type==='text'?n.body:n.body.split('\n').map((l,i)=>(n.type==='bullets'?'• ':n.checked.includes(i)?'[x] ':'[ ] ')+l).join('\n'));try{await navigator.clipboard.writeText(text);toast('Note copied to clipboard');}catch{toast('Clipboard unavailable. Open the note to select and copy its text.');}}),action(privateNotes.includes(n)?'Move out of private vault':'Move into private vault','',()=>moveVaultNote(n)),action('Move to trash','♲',async()=>{if(view==='vault'){n.trash=true;await commit();render();toast('Moved to trash — restore while the vault is unlocked');}else{n.trash=true;await commit();render();toast('Moved to trash — restore it from Trash');}}));}bottom.append(actions);article.append(bottom);return article;}
function openEditor(n){editing=n||null;populateCategorySelect(n?.category||(view==='category'?activeCategory:''));selectedColor=n?.color||'yellow';$('#note-title').value=n?.title||'';$('#note-body').value=n?.body||'';$('#note-type').value=n?.type||(view==='checklist'?'checklist':'text');$('#note-pin').checked=n?.pinned||false;$('#note-private').checked=view==='vault';$('#note-private').disabled=!!n;$('#editor-error').textContent='';renderSwatches();$('#editor').showModal();$('#note-title').focus();}
function renderSwatches(){const editor=$('#editor');editor.classList.remove(...Object.keys(colors));editor.classList.add(selectedColor);const holder=$('#editor-colors');holder.replaceChildren();holder.append(el('span','palette-label',`Note color · ${colors[selectedColor]}`));Object.entries(colors).forEach(([c,label])=>{const b=el('button',`swatch ${c}${c===selectedColor?' selected':''}`,c===selectedColor?'✓':'');b.type='button';b.title=label;b.setAttribute('aria-label',label);b.setAttribute('aria-pressed',c===selectedColor);b.onclick=()=>{selectedColor=c;renderSwatches();};holder.append(b);});}
$('#note-form').onsubmit=async e=>{e.preventDefault();if($('#note-private').checked&&!key){$('#editor-error').textContent='Unlock or create your vault first. Your draft will stay here.';openVault();return;}const body=$('#note-body').value;if(!body.trim()&&!$('#note-title').value.trim()){$('#editor-error').textContent='Add a title or a little thought first.';return;}const oldLines=editing?.body.split('\n')||[],newLines=body.split('\n');const checked=[];const used=new Set();newLines.forEach((line,i)=>{const old=oldLines.findIndex((v,j)=>v===line&&!used.has(j)&&editing.checked.includes(j));if(old>=0){checked.push(i);used.add(old);}});const n={id:editing?.id||crypto.randomUUID(),created:editing?.created||Date.now(),updated:Date.now(),title:$('#note-title').value.trim(),body,type:$('#note-type').value,pinned:$('#note-pin').checked,strike:editing?.strike||false,color:selectedColor,category:document.querySelector('#note-category').value,checked,trash:false};const list=$('#note-private').checked?privateNotes:notes;if(editing)list[list.findIndex(x=>x.id===editing.id)]=n;else list.push(n);if(await commit()){$('#editor').close();$('#note-form').reset();render();toast('A little thought, saved');}else $('#editor-error').textContent='Save failed. Keep this window open and copy your text.';};
const noteEditor=$('#editor');
let editorPointerStartedOutside=false;
function isOutsideEditor(event){
  const rect=noteEditor.getBoundingClientRect();
  return event.target===noteEditor&&(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom);
}
noteEditor.addEventListener('pointerdown',event=>{
  editorPointerStartedOutside=event.button===0&&isOutsideEditor(event);
});
noteEditor.addEventListener('click',event=>{
  if(editorPointerStartedOutside&&isOutsideEditor(event))noteEditor.close();
  editorPointerStartedOutside=false;
});
noteEditor.addEventListener('close',()=>{editorPointerStartedOutside=false;});
noteEditor.addEventListener('pointercancel',()=>{editorPointerStartedOutside=false;});
$('#vault-dialog').addEventListener('close',()=>{pendingVaultNote=null;});
function openVault(){$('#vault-title').textContent=vaultRecord?'Welcome back to your vault':'Create your private vault';$('#vault-description').textContent=vaultRecord?'Enter your password to decrypt your private notes.':'Your private notes are encrypted with AES-256-GCM before they are saved in this browser. Clearing browser data removes your notes.';$('#vault-password').value='';$('#vault-password').autocomplete=vaultRecord?'current-password':'new-password';$('#vault-error').textContent='';$('#vault-dialog').showModal();}
$('#vault-form').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{const salt=vaultRecord?unb64(vaultRecord.salt):crypto.getRandomValues(new Uint8Array(16));const newKey=await derive($('#vault-password').value,salt);let decoded=[];if(vaultRecord){const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(vaultRecord.iv)},newKey,unb64(vaultRecord.data));decoded=JSON.parse(new TextDecoder().decode(plaintext));}else{const record=await encryptVault([],newKey,{salt:b64(salt)});localStorage.setItem(VAULT,JSON.stringify(record));vaultRecord=record;}key=newKey;privateNotes=decoded;$('#vault-password').value='';$('#vault-dialog').close();resetTimer();render();toast('Private vault unlocked');if(pendingVaultNote){const note=pendingVaultNote;pendingVaultNote=null;await moveVaultNote(note);}}catch{$('#vault-error').textContent=vaultRecord?'Could not unlock. Check your password.':'Could not create vault. Check browser storage and use localhost or HTTPS.';}finally{button.disabled=false;}};
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;render();});$('#new-note').onclick=()=>view==='vault'&&!key?openVault():openEditor();$('#search').oninput=render;$('#sort').onchange=render;$('#close-editor').onclick=()=>$('#editor').close();$('#close-vault').onclick=()=>{$('#vault-dialog').close();$('#vault-password').value='';};$('#lock-vault').onclick=lockVault;document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!$('dialog[open]')){e.preventDefault();$('#search').focus();}});render();
