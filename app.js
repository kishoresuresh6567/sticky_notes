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
const cloud=window.accountCloud;
const notifications=window.noteNotifications;
async function syncNotifications(snapshot=notes){
 // An empty workspace while loading is not an authoritative deletion of notes.
 if(!accountId||!cloud.ready||cloud.id!==accountId)return;
 try{await notifications?.sync(snapshot);render();}catch(error){toast(error.message||'Could not update notifications. Check browser permissions.');}
}
window.navigator?.serviceWorker?.addEventListener('message',event=>{
 if(event.data?.type==='note-notifications-changed')void syncNotifications();
 if(event.data?.type==='open-note'){
  pendingNotificationNote=event.data;openNotificationNote();
  event.ports?.[0]?.postMessage({accepted:true});
 }
});
window.addEventListener?.('focus',()=>{if(accountId)void syncNotifications();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&accountId)void syncNotifications();});
let accountId=null,accountEpoch=0,cloudError='';
let pendingNotificationNote=null,highlightedNoteId=null,notificationScrollScheduled=false;
function readNotificationLink(){
 try{if(window.location?.hash.startsWith('#note='))pendingNotificationNote=JSON.parse(decodeURIComponent(window.location.hash.slice(6)));}catch{}
}
readNotificationLink();
window.addEventListener?.('hashchange',()=>{readNotificationLink();openNotificationNote();});
window.addEventListener?.('pageshow',()=>{readNotificationLink();openNotificationNote();});
window.addEventListener?.('focus',()=>openNotificationNote());
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')openNotificationNote();});
function scheduleNotificationScroll(){
 if(notificationScrollScheduled)return;
 notificationScrollScheduled=true;
 const schedule=window.requestAnimationFrame?.bind(window)||((callback)=>setTimeout(callback,16));
 schedule(()=>{notificationScrollScheduled=false;openNotificationNote();});
}
function openNotificationNote(){
 const target=pendingNotificationNote;
 if(!target||!accountId||!cloud.ready||cloud.id!==accountId)return;
 if(document.visibilityState==='hidden')return;
 if(document.body?.classList.contains('auth-locked')){scheduleNotificationScroll();return;}
 if(target.accountId!==accountId){pendingNotificationNote=null;toast('Sign in with the account that owns this notification.');return;}
 const note=notes.find(n=>n.id===target.noteId&&!n.trash);
 if(!note){pendingNotificationNote=null;toast('This note is no longer available.');return;}
 view='all';activeCategory='';$('#search').value='';highlightedNoteId=note.id;
 render();
 const card=[...document.querySelectorAll('[data-note-id]')].find(node=>node.dataset.noteId===note.id);
 // Keep the target until it has layout. Login and background restoration can
 // briefly hide the board even though its data has already loaded.
 if(!card||card.getClientRects?.().length===0){scheduleNotificationScroll();return;}
 card.scrollIntoView({block:'center',behavior:'instant'});card.focus({preventScroll:true});
 pendingNotificationNote=null;
 if(window.location?.hash.startsWith('#note='))window.history?.replaceState(null,'',window.location.pathname+window.location.search);
}
let categories=[],activeCategory='';

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
async function deleteCategory(id){
  if(!id||!categories.some(category=>category.id===id))return;
  if(categoryHasNotes(id)){toast('This category still contains notes, including possible notes in Trash.');return;}
  if(vaultRecord&&!key){toast('Unlock your vault to check for notes, then delete the category.');openVault();return;}
  const next=categories.filter(category=>category.id!==id);
  if(!await commit({categories:next}))return;
  categories=next;
  if(view==='category'&&activeCategory===id){view='all';activeCategory='';}
  render();toast('Empty category deleted');
}
async function renameCategory(id){
  const category=categories.find(item=>item.id===id);
  if(!category)return;
  const entered=window.prompt('Rename category:',category.name);
  if(entered===null)return;
  const name=entered.trim();
  if(!name||name.length>40){toast('Use a category name between 1 and 40 characters.');return;}
  if(name.toLowerCase()==='uncategorized'||categories.some(item=>item.id!==id&&item.name.toLowerCase()===name.toLowerCase())){toast('That category already exists.');return;}
  const next=categories.map(item=>item.id===id?{...item,name}:item);
  if(!await commit({categories:next}))return;
  categories=next;render();toast('Category renamed');
}
$('#category-form').onsubmit=async event=>{
  event.preventDefault();const input=$('#category-name'),name=input.value.trim();
  if(!name){$('#category-error').textContent='Enter a category name.';return;}
  if(name.toLowerCase()==='uncategorized'||categories.some(category=>category.name.toLowerCase()===name.toLowerCase())){$('#category-error').textContent='That category already exists.';return;}
  const category={id:crypto.randomUUID(),name},next=[...categories,category];
  if(!await commit({categories:next})){$('#category-error').textContent=cloudError;return;}
  categories=next;input.value='';$('#category-error').textContent='';renderCategories();toast('Category created — choose it when editing a note');
};
let notes=[], privateNotes=[], key=null, vaultRecord=null, view='all', editing=null, selectedColor='yellow', timer, saving=Promise.resolve();
async function activateNotes(user){
 const id=user?.id||null;
 if(id===accountId&&cloud.ready)return;
 const epoch=++accountEpoch;accountId=id;
 void notifications?.setAccount(id).catch(()=>toast('Could not clear notifications. Clear them in your notification center.'));
 clearTimeout(timer);key=null;privateNotes=[];notes=[];categories=[];vaultRecord=null;editing=null;pendingVaultNote=null;view='all';activeCategory='';cloudError='';
 $('#editor').close();$('#vault-dialog').close();$('#note-form').reset();resetListEditor();$('#vault-password').value='';$('#search').value='';$('#category-name').value='';
 $('#toast').classList.remove('visible');$('#sync-error').hidden=true;render();
 const data=await cloud.open(id);
 if(epoch!==accountEpoch)return;
 if(data){notes=data.notes;categories=data.categories;vaultRecord=data.vault;}
 void syncNotifications();
 document.querySelector('.save-status').textContent=id?'Saved to your account':'';
 render();openNotificationNote();
}
window.activateNotes=activateNotes;
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
 const wasPrivate=privateNotes.includes(note),source=wasPrivate?privateNotes:notes,target=wasPrivate?notes:privateNotes;
 if(!source.includes(note)||note.trash)return;
 const nextSource=source.filter(n=>n!==note),nextTarget=[...target,note];
 if(await commit({notes:wasPrivate?nextTarget:nextSource,privateNotes:wasPrivate?nextSource:nextTarget})){
   notes=wasPrivate?nextTarget:nextSource;privateNotes=wasPrivate?nextSource:nextTarget;
   render();toast(wasPrivate?'Moved out of private vault':'Moved into private vault');
 }
}
function b64(bytes){return btoa(String.fromCharCode(...bytes));}function unb64(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}
async function derive(password,salt){const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:600000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
async function encryptVault(data,vaultKey,record){const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},vaultKey,new TextEncoder().encode(JSON.stringify(data)));return {...record,iv:b64(iv),data:b64(new Uint8Array(encrypted))};}
function persist(overrides={}){
 const epoch=accountEpoch;
 const snapshot={notes:structuredClone(overrides.notes??notes),categories:structuredClone(overrides.categories??categories),vault:overrides.vault??vaultRecord};
 const privateSnapshot=structuredClone(overrides.privateNotes??privateNotes),currentKey=key;
 saving=saving.catch(()=>{}).then(async()=>{
   if(epoch!==accountEpoch)throw new Error('Account changed. Save cancelled.');
   if(currentKey)snapshot.vault=await encryptVault(privateSnapshot,currentKey,snapshot.vault);
   if(epoch!==accountEpoch)throw new Error('Account changed. Save cancelled.');
   await cloud.save(snapshot);
   if(epoch!==accountEpoch)throw new Error('Account changed while saving.');
   vaultRecord=snapshot.vault;
 });
 return saving;
}
async function commit(overrides={}){
 const epoch=accountEpoch;
 document.querySelector('.save-status').textContent='Saving to your account...';
 // Prevent a second edit from racing a snapshot save.
 const surfaces=document.querySelectorAll('main,aside,#editor,#vault-dialog');
 surfaces.forEach(node=>node.inert=true);
 try{await persist(overrides);if(epoch!==accountEpoch)return false;cloudError='';$('#sync-error').hidden=true;document.querySelector('.save-status').textContent='Saved to your account';void syncNotifications(overrides.notes??notes);return true;}
 catch(error){if(epoch===accountEpoch){cloudError=error.message;$('#sync-error').textContent=error.message;$('#sync-error').hidden=false;document.querySelector('.save-status').textContent='Not saved - retry or reload';toast(error.message);}return false;}
 finally{surfaces.forEach(node=>node.inert=false);}
}
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
async function lockVault(){const epoch=accountEpoch;await saving.catch(()=>{});if(epoch!==accountEpoch)return;key=null;privateNotes=[];clearTimeout(timer);if($('#editor').open){$('#editor').close();$('#note-form').reset();resetListEditor();}render();toast('Private vault locked');}
['pointerdown','keydown'].forEach(event=>document.addEventListener(event,resetTimer));
function render(){renderCategories();const titles={all:['All your notes','Big ideas, daily to-dos, and everything in between.'],pinned:['Keep these close','Your important things, always within reach.'],checklist:['One thing at a time','A little progress feels pretty good.'],vault:['Your private space','Encrypted notes for the things that are just for you.'],trash:['A second chance','Restore notes whenever you need them.'],category:[categoryName(activeCategory),'Everything in this category, in one place.']};$('#page-title').textContent=titles[view][0];$('#page-title').append(el('span','','.'));$('#page-subtitle').textContent=titles[view][1];$('#crumb').textContent={all:'All notes',pinned:'Pinned notes',checklist:'Checklists',vault:'Private vault',trash:'Trash',category:categoryName(activeCategory)}[view];document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',b.dataset.view===view));$('#count').textContent=notes.filter(n=>!n.trash).length;$('#lock-vault').hidden=!key;$('#board').replaceChildren();$('#vault-gate').hidden=true;
if(view==='vault'&&!key){const gate=$('#vault-gate');gate.hidden=false;gate.replaceChildren();const box=el('div','empty');box.append(el('div','','♙'),el('h2','',vaultRecord?'A little privacy goes a long way.':'Some things are just for you.'),el('p','','Store passwords, usernames, and bank details in your encrypted vault.\nYour password unlocks it on any device signed in to this account.'));const b=el('button','primary',vaultRecord?'Unlock your vault':'Create your vault');b.onclick=openVault;box.append(b);gate.append(box);$('#result-count').textContent='Private & encrypted';return;}
const q=$('#search').value.toLowerCase();let list=(view==='vault'?privateNotes:view==='trash'?[...notes,...privateNotes]:notes).filter(n=>(view==='trash'?n.trash:!n.trash)&&(view!=='category'||(n.category||'')===activeCategory)&&(view!=='pinned'||n.pinned)&&(view!=='checklist'||n.type==='checklist')&&(`${n.title}\n${n.body}`).toLowerCase().includes(q));list.sort((a,b)=>$('#sort').value==='title'?a.title.localeCompare(b.title):b[$('#sort').value||'created']-a[$('#sort').value||'created']);$('#result-count').textContent=`${list.length} note${list.length===1?'':'s'}`;
const pinned=list.filter(n=>n.pinned),other=list.filter(n=>!n.pinned);if(pinned.length&&view!=='trash')section('♧  PINNED',pinned);if(other.length||!list.length||view==='trash')section(view==='trash'?'DELETED NOTES':pinned.length?'EVERYTHING ELSE':'YOUR NOTES',view==='trash'?list:other,true);
}
function section(title,list,add=false){const board=$('#board');board.append(el('div','section-label',title));const grid=el('div','grid');list.forEach(n=>grid.append(card(n)));if(add&&view!=='trash'){const b=el('button','add-card');b.append(el('span','','＋'),el('div','','A little thought? Write it down.'),el('small','','Your next idea starts here'));b.onclick=()=>openEditor();grid.append(b);}if(!list.length&&view==='trash')grid.append(el('p','hint','No deleted notes. A clean little slate.'));board.append(grid);}
function card(n){const article=el('article',`note ${n.color}`),head=el('div','note-head');head.append(el('h2','',n.title||'Untitled note'));if(n.pinned){const pin=el('span','pin');pin.title='Pinned note';pin.append(cardIcon('pin'));head.append(pin);}article.append(head);article.append(el('span','category-badge',categoryName(n.category)));const body=el('div',`note-body${n.strike?' struck':''}`);if(n.type==='text')body.textContent=n.body;else if(n.type==='bullets'){const ul=el('ul');n.body.split('\n').forEach(line=>ul.append(el('li','',line)));body.append(ul);}else n.body.split('\n').forEach((line,i)=>{if(!line)return;const row=el('label',`check-row${n.checked.includes(i)?' done':''}`),check=el('input');check.type='checkbox';check.checked=n.checked.includes(i);check.disabled=n.trash;check.onchange=async()=>{const oldChecked=n.checked,oldUpdated=n.updated;n.checked=check.checked?[...n.checked,i]:n.checked.filter(x=>x!==i);n.updated=Date.now();row.classList.toggle('done',check.checked);if(!await commit()){n.checked=oldChecked;n.updated=oldUpdated;render();}};row.append(check,el('span','',line));body.append(row);});article.append(body);const bottom=el('div','note-bottom');bottom.append(el('span','',`${view==='vault'?'Encrypted · ':''}${new Date(n.updated).toLocaleDateString(undefined,{month:'short',day:'numeric'})}`));const actions=el('div','note-actions');if(n.trash){actions.append(action('Restore note','↶',async()=>{n.trash=false;if(!await commit()){n.trash=true;render();return;}render();toast('Note restored');}));const deleteButton=action('Permanently delete note','Delete forever',()=>deleteForever(n));deleteButton.classList.add('delete-forever');actions.append(deleteButton);}else{actions.append(action('Edit note','✎',()=>openEditor(n)),action(n.pinned?'Unpin note':'Pin note','♧',async()=>{n.pinned=!n.pinned;if(!await commit())n.pinned=!n.pinned;render();}),action('Copy note','⧉',async()=>{const text=(n.type==='text'?n.body:n.body.split('\n').map((l,i)=>(n.type==='bullets'?'• ':n.checked.includes(i)?'[x] ':'[ ] ')+l).join('\n'));try{await navigator.clipboard.writeText(text);toast('Note copied to clipboard');}catch{toast('Clipboard unavailable. Open the note to select and copy its text.');}}),action(privateNotes.includes(n)?'Move out of private vault':'Move into private vault','',()=>moveVaultNote(n)),action('Move to trash','♲',async()=>{if(view==='vault'){n.trash=true;if(!await commit()){n.trash=false;render();return;}render();toast('Moved to trash — restore while the vault is unlocked');}else{n.trash=true;if(!await commit()){n.trash=false;render();return;}render();toast('Moved to trash — restore it from Trash');}}));}bottom.append(actions);article.append(bottom);
if(!n.trash&&!privateNotes.includes(n)&&notifications){
 if(notifications.selected.has(n.id)){
  article.append(el('span','notification-status','Displayed in notification'));
 }else{
  const button=el('button','notification-toggle','Show in browser');
  button.type='button';button.title='Send a snapshot of this note. Later edits stay in the app and do not send more notifications.';
  button.onclick=async()=>{button.disabled=true;try{const shown=await notifications.show(n);if(shown)toast('Note shown in notifications on this device');render();}catch(error){toast(error.message);}finally{button.disabled=false;}};
  article.append(button);
 }
 article.append(el('small','notification-hint','Snapshot only. Dismiss it in your notification center. Edits stay in the app.'));
}
article.dataset.noteId=n.id;article.tabIndex=-1;
if(highlightedNoteId===n.id)article.classList.add('notification-target');
return article;}
function openEditor(n){if(!cloud.ready)return;editing=n||null;populateCategorySelect(n?.category||(view==='category'?activeCategory:''));selectedColor=n?.color||'yellow';$('#note-title').value=n?.title||'';$('#note-body').value=n?.body||'';$('#note-type').value=n?.type||(view==='checklist'?'checklist':'text');$('#note-pin').checked=n?.pinned||false;$('#note-private').checked=view==='vault';$('#note-private').disabled=!!n;$('#editor-error').textContent='';resetListEditor();editorItems=(n?.body||'').split('\n').map((text,i)=>({text,checked:!!n?.checked?.includes(i)}));renderEditorType();renderSwatches();$('#editor').showModal();$('#note-title').focus();}
let editorItems=[];
function resetListEditor(){editorItems=[];$('#editor-items').replaceChildren();$('#list-editor').hidden=true;$('#note-body').hidden=false;}
function syncEditorItems(){$('#note-body').value=editorItems.map(item=>item.text).join('\n');}
function reconcileEditorItems(){
 const previous=editorItems,used=new Set();
 editorItems=$('#note-body').value.split('\n').map(text=>{
  const i=previous.findIndex((item,index)=>item.text===text&&!used.has(index));
  if(i>=0)used.add(i);
  return {text,checked:i>=0&&previous[i].checked};
 });
}
function renderEditorType(){
 const type=$('#note-type').value,isList=type!=='text';
 $('#note-body').hidden=isList;$('#list-editor').hidden=!isList;
 $('#editor-hint').textContent=isList?'Press Enter for a new item. Paste multiple lines to add several items.':'Write your note below the title.';
 if(isList)renderEditorItems();
}
function renderEditorItems(focusIndex,caret){
 const holder=$('#editor-items');holder.replaceChildren();
 editorItems.forEach((item,i)=>{
  const row=el('div','editor-list-row'),input=el('input','editor-item-text');
  input.type='text';input.value=item.text;input.placeholder='List item';input.setAttribute('aria-label',`Item ${i+1}`);
  if($('#note-type').value==='checklist'){
   const check=el('input','editor-item-check');check.type='checkbox';check.checked=item.checked;check.setAttribute('aria-label',`Complete item ${i+1}`);
   row.classList.toggle('done',item.checked);
   check.onchange=()=>{item.checked=check.checked;row.classList.toggle('done',item.checked);};row.append(check);
  }else{const marker=el('span','editor-bullet','?');marker.setAttribute('aria-hidden','true');row.append(marker);}
  input.oninput=()=>{item.text=input.value;syncEditorItems();};
  function insertText(text){
   const start=input.selectionStart??item.text.length,end=input.selectionEnd??start;
   const lines=(item.text.slice(0,start)+text+item.text.slice(end)).split('\n');
   editorItems.splice(i,1,...lines.map((line,j)=>({text:line,checked:j===0&&item.checked})));
   syncEditorItems();renderEditorItems(i+lines.length-1,lines.at(-1).length-(item.text.length-end));
  }
  input.onkeydown=event=>{
   if(event.isComposing)return;
   if(event.key==='Enter'){event.preventDefault();insertText('\n');}
   else if(event.key==='Backspace'&&input.selectionStart===0&&input.selectionEnd===0&&i>0){
    event.preventDefault();const previous=editorItems[i-1],position=previous.text.length;previous.text+=item.text;
    editorItems.splice(i,1);syncEditorItems();renderEditorItems(i-1,position);
   }
  };
  input.onpaste=event=>{const text=event.clipboardData?.getData('text/plain').replace(/\r\n?/g,'\n');if(text?.includes('\n')){event.preventDefault();insertText(text);}};
  const remove=el('button','editor-item-remove','?');remove.type='button';remove.setAttribute('aria-label',`Remove item ${i+1}`);
  remove.onclick=()=>{editorItems.splice(i,1);if(!editorItems.length)editorItems.push({text:'',checked:false});syncEditorItems();renderEditorItems(Math.min(i,editorItems.length-1));};
  row.append(input,remove);holder.append(row);
  if(i===focusIndex){input.focus();const position=caret??input.value.length;input.setSelectionRange(position,position);}
 });
}
$('#note-type').onchange=()=>{reconcileEditorItems();renderEditorType();};
$('#add-editor-item').onclick=()=>{editorItems.push({text:'',checked:false});syncEditorItems();renderEditorItems(editorItems.length-1);};
function renderSwatches(){const editor=$('#editor');editor.classList.remove(...Object.keys(colors));editor.classList.add(selectedColor);const holder=$('#editor-colors');holder.replaceChildren();holder.append(el('span','palette-label',`Note color · ${colors[selectedColor]}`));Object.entries(colors).forEach(([c,label])=>{const b=el('button',`swatch ${c}${c===selectedColor?' selected':''}`,c===selectedColor?'✓':'');b.type='button';b.title=label;b.setAttribute('aria-label',label);b.setAttribute('aria-pressed',c===selectedColor);b.onclick=()=>{selectedColor=c;renderSwatches();};holder.append(b);});}
$('#note-form').onsubmit=async e=>{e.preventDefault();if($('#note-private').checked&&!key){$('#editor-error').textContent='Unlock or create your vault first. Your draft will stay here.';openVault();return;}if($('#note-type').value!=='text')syncEditorItems();else reconcileEditorItems();const body=$('#note-body').value;if(!body.trim()&&!$('#note-title').value.trim()){$('#editor-error').textContent='Add a title or a little thought first.';return;}const checked=editorItems.flatMap((item,i)=>item.checked?[i]:[]);const n={id:editing?.id||crypto.randomUUID(),created:editing?.created||Date.now(),updated:Date.now(),title:$('#note-title').value.trim(),body,type:$('#note-type').value,pinned:$('#note-pin').checked,strike:editing?.strike||false,color:selectedColor,category:document.querySelector('#note-category').value,checked,trash:false};const list=$('#note-private').checked?privateNotes:notes,previous=list.slice(),epoch=accountEpoch;if(editing)list[list.findIndex(x=>x.id===editing.id)]=n;else list.push(n);if(await commit()){$('#editor').close();$('#note-form').reset();render();toast('A little thought, saved');}else{list.splice(0,list.length,...previous);if(epoch===accountEpoch)$('#editor-error').textContent=cloudError+' Keep this window open and copy your text before reloading.';}};
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
function openVault(){if(!cloud.ready)return;$('#vault-title').textContent=vaultRecord?'Welcome back to your vault':'Create your private vault';$('#vault-description').textContent=vaultRecord?'Enter your password to decrypt your private notes.':'Your private notes are encrypted with AES-256-GCM before they are saved to your account. Keep your vault password safe; it cannot be recovered.';$('#vault-password').value='';$('#vault-password').autocomplete=vaultRecord?'current-password':'new-password';$('#vault-error').textContent='';$('#vault-dialog').showModal();}
$('#vault-form').onsubmit=async e=>{
 e.preventDefault();const button=e.submitter,epoch=accountEpoch,originalRecord=vaultRecord,pending=pendingVaultNote;button.disabled=true;
 try{
  const salt=originalRecord?unb64(originalRecord.salt):crypto.getRandomValues(new Uint8Array(16));
  const newKey=await derive($('#vault-password').value,salt);let decoded=[];
  if(originalRecord){const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(originalRecord.iv)},newKey,unb64(originalRecord.data));decoded=JSON.parse(new TextDecoder().decode(plaintext));}
  else{
   const record=await encryptVault([],newKey,{salt:b64(salt)});
   if(epoch!==accountEpoch)return;
   if(!await commit({vault:record}))throw new Error(cloudError);
  }
  if(epoch!==accountEpoch)return;
  key=newKey;privateNotes=decoded;$('#vault-password').value='';$('#vault-dialog').close();resetTimer();render();toast('Private vault unlocked');
  if(pending)await moveVaultNote(pending);
 }catch(error){if(epoch===accountEpoch)$('#vault-error').textContent=originalRecord?'Could not unlock. Check your password.':error.message||'Could not create vault.';}
 finally{button.disabled=false;}
};
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;render();});$('#new-note').onclick=()=>view==='vault'&&!key?openVault():openEditor();$('#search').oninput=render;$('#sort').onchange=render;$('#close-editor').onclick=()=>$('#editor').close();$('#close-vault').onclick=()=>{$('#vault-dialog').close();$('#vault-password').value='';};$('#lock-vault').onclick=lockVault;document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!$('dialog[open]')){e.preventDefault();$('#search').focus();}});render();
