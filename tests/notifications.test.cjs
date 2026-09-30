const {test}=require('node:test');
const assert=require('node:assert/strict');
const {NoteNotifications}=require('../notifications');
function fixture(permission='granted'){
 const shown=[],active=new Map();let requested=0;
 const registration={async getNotifications(){return [...active.values()];},async showNotification(title,options){shown.push({title,...options});active.set(options.tag,{title,...options,close(){active.delete(options.tag);}});}};
 const notification={permission,async requestPermission(){requested++;return 'granted';}};
 const workers={async register(path){assert.equal(path,'/notification-worker.js');},ready:Promise.resolve(registration)};
 const manager=new NoteNotifications({notification,workers});
 return {manager,notification,registration,active,shown,get requested(){return requested;}};
}
const note={id:'n1',title:'Shopping',body:'Milk\nBread',type:'checklist',checked:[1],trash:false};
test('selected notes persist through controller reload, clear individually, and never prompt on load',async()=>{
 const f=fixture('default');await f.manager.setAccount('a');assert.equal(f.requested,0);
 assert.equal(await f.manager.show(note),true);assert.equal(f.requested,1);
 assert.equal(f.shown[0].requireInteraction,true);assert.equal(f.shown[0].body,'\u2610 Milk\n\u2611 Bread');
 assert.equal(f.shown[0].data.accountId,'a');assert.equal(f.shown[0].actions[0].action,'clear');
 f.notification.permission='granted';
 await f.manager.show({...note,id:'n2'});assert.equal(f.active.size,2);
 await f.manager.setAccount('a');assert.equal(f.manager.selected.size,2);
 assert.equal(await f.manager.show(note),true);assert.equal(f.active.size,2);assert.equal(f.shown.length,2);
 [...f.active.values()][0].close();await f.manager.sync([note,{...note,id:'n2'}]);
 assert.equal(f.manager.selected.has('n1'),false);
});
test('sync preserves snapshots without re-creating dismissed ones and clears missing or trashed notes',async()=>{
 const f=fixture();await f.manager.setAccount('a');await f.manager.show(note);
 await f.manager.sync([{...note,body:'New text',type:'text'}]);assert.equal(f.shown.length,1);assert.equal(f.shown.at(-1).body,'\u2610 Milk\n\u2611 Bread');
 [...f.active.values()][0].close();await f.manager.sync([note]);assert.equal(f.active.size,0);assert.equal(f.manager.selected.size,0);
 await f.manager.show(note);await f.manager.sync([{...note,trash:true}]);assert.equal(f.active.size,0);
 await f.manager.show(note);await f.manager.sync([]);assert.equal(f.active.size,0);
});
test('logout and account switching clear notifications, including pending permission requests',async()=>{
 const f=fixture();await f.manager.setAccount('a');await f.manager.show(note);
 await f.manager.setAccount('b');assert.equal(f.active.size,0);
 await f.manager.show(note);await f.manager.setAccount(null);assert.equal(f.active.size,0);
 await f.manager.setAccount('a');f.notification.permission='default';let finish;
 f.notification.requestPermission=()=>new Promise(resolve=>{finish=resolve;});
 const pending=f.manager.show(note);await f.manager.setAccount(null);finish('granted');await pending;
 assert.equal(f.active.size,0);
});
test('denied permission and unsupported browsers give actionable errors',async()=>{
 const f=fixture('denied');await f.manager.setAccount('a');
 await assert.rejects(f.manager.show(note),/Allow notifications/);assert.equal(f.active.size,0);
 const unsupported=new NoteNotifications({notification:null,workers:null});await unsupported.setAccount('a');
 await assert.rejects(unsupported.show(note),/not supported/);
});
test('explicit clear never shows a missing notification and does not ask for permission',async()=>{
 const f=fixture();await f.manager.setAccount('a');await f.manager.show(note);
 f.active.clear();f.notification.permission='denied';
 await f.manager.clear(note);
 assert.equal(f.shown.length,1);assert.equal(f.requested,0);assert.equal(f.manager.selected.has(note.id),false);
});
test('clear removes only the selected note and stale notification snapshots cannot restore it',async()=>{
 const f=fixture();await f.manager.setAccount('a');await f.manager.show(note);await f.manager.show({...note,id:'n2'});
 const stale=[...f.active.values()][0];await f.manager.clear(note);
 assert.equal(f.active.size,1);assert.equal(f.manager.selected.has('n2'),true);
 f.registration.getNotifications=async()=>[stale];
 await f.manager.sync([{...note,body:'Updated'}]);
 assert.equal(f.shown.length,2);assert.equal(f.manager.selected.has(note.id),false);
});
function workerFixture({closeDelayReads=0,refuseClose=false,noWindow=false}={}){
 const handlers={},active=[],shown=[],liveAtShow=[],messages=[],opened=[];
 const registration={
  async getNotifications(){
   for(const notification of active.slice()){
    if(notification.closing&&!refuseClose&&--notification.readsLeft<=0)active.splice(active.indexOf(notification),1);
   }
   return active.slice();
  },
  async showNotification(title,options){
   liveAtShow.push(active.filter(n=>n.tag===options.tag).length);
   shown.push({title,...options});
   const notification={title,...options,close(){if(closeDelayReads||refuseClose){if(!this.closing){this.closing=true;this.readsLeft=closeDelayReads;}return;}const i=active.indexOf(this);if(i>=0)active.splice(i,1);}};
   active.push(notification);
  }
 };
 const self={registration,addEventListener(name,fn){handlers[name]=fn;},clients:{async matchAll(){return noWindow?[]:[{async focus(){},postMessage(message){messages.push(message);}}];},async openWindow(url){opened.push(url);}}};
 require('node:vm').runInNewContext(require('node:fs').readFileSync('notification-worker.js','utf8'),{self,setTimeout});
 registration.active={postMessage(data,ports){handlers.message({data,ports,waitUntil(p){p.catch(()=>{});}});}};
 const manager=new NoteNotifications({notification:{permission:'granted'},workers:{async register(){},ready:Promise.resolve(registration)}});
 async function click(notification,action=''){let promise;handlers.notificationclick({notification,action,waitUntil(p){promise=p;}});await promise;}
 return {manager,registration,active,shown,liveAtShow,click,messages,opened};
}

test('notification clicks target the correct note in existing and newly opened windows',async()=>{
 for(const noWindow of [false,true]){
  const f=workerFixture({noWindow});await f.manager.setAccount('account/a');await f.manager.show(note);
  await f.click(f.active[0]);
  const target=noWindow?JSON.parse(decodeURIComponent(f.opened[0].split('#note=')[1])):f.messages[0];
  assert.equal(target.accountId,'account/a');assert.equal(target.noteId,note.id);
  if(!noWindow)assert.equal(target.type,'open-note');
  assert.equal(f.active.length,1);
 }
});

test('every checkbox edit leaves the original snapshot unchanged without publishing another notification',async()=>{
 const f=workerFixture();await f.manager.setAccount('a');
 const shopping={...note,body:'Apple\nBanana\nMango',checked:[],updated:1};
 await f.manager.show(shopping);const original=f.active[0].body;
 for(let bought=1;bought<=3;bought++){
  await f.manager.sync([{...shopping,checked:Array.from({length:bought},(_,i)=>i),updated:bought+1}]);
  assert.equal(f.shown.length,1);assert.equal(f.active.length,1);assert.equal(f.active[0].body,original);
 }
 await f.manager.setAccount('a');await f.manager.sync([{...shopping,title:'Edited title',body:'Edited body',updated:5}]);
 assert.equal(f.shown.length,1);assert.equal(f.active[0].title,'Shopping');
 await f.manager.clear(shopping);assert.equal(f.active.length,0);
 await f.manager.show({...shopping,checked:[0,1,2],updated:6});
 assert.equal(f.shown.length,2);assert.equal(f.active.length,1);
 assert.equal(f.active[0].body.split('\n').every(line=>line.startsWith('\u2611')),true);
});

test('ten concurrent saves do not publish notifications, even when the browser reports no active cards',async()=>{
 const f=workerFixture();await f.manager.setAccount('a');await f.manager.show(note);
 f.registration.getNotifications=async()=>[];
 await Promise.all(Array.from({length:10},(_,i)=>f.manager.sync([{...note,body:`Edit ${i}`,updated:i+2}])));
 assert.equal(f.shown.length,1);
});

test('opening a notification restores one original snapshot whether dismissal is immediate or delayed',async()=>{
 for(const consumed of [true,false]){
  const f=workerFixture({closeDelayReads:3});await f.manager.setAccount('a');await f.manager.show(note);
  const original=f.active[0];
  await f.manager.sync([{...note,body:'Edited text',checked:[0,1]}]);
  if(consumed)f.active.splice(0);
  await f.click(original);
  assert.equal(f.active.length,1);assert.equal(f.shown.length,2);assert.equal(f.liveAtShow.at(-1),0);
  assert.equal(f.active[0].body,original.body);assert.equal(f.active[0].title,original.title);
  assert.equal(f.active[0].tag,original.tag);assert.equal(f.active[0].renotify,false);
  await f.manager.sync([{...note,body:'Another edit'}]);assert.equal(f.shown.length,2);
 }
});

test('explicit clear from the app or notification prevents restoration on a late click',async()=>{
 for(const source of ['app','notification']){
  const f=workerFixture();await f.manager.setAccount('a');await f.manager.show(note);
  const original=f.active[0];
  if(source==='app')await f.manager.clear(note);else await f.click(original,'clear');
  await f.click(original);assert.equal(f.active.length,0);assert.equal(f.shown.length,1);
 }
});

test('clear requested during delayed click removal prevents its replacement',async()=>{
 const f=workerFixture({closeDelayReads:3});await f.manager.setAccount('a');await f.manager.show(note);
 const opened=f.click(f.active[0]);
 await new Promise(resolve=>setImmediate(resolve));
 const cleared=f.manager.clear(note);
 await Promise.all([opened,cleared]);assert.equal(f.active.length,0);assert.equal(f.shown.length,1);
});

test('old client automatic update messages are ignored by the worker',async()=>{
 const f=workerFixture();await f.manager.setAccount('a');await f.manager.show(note);
 const result=await f.manager.workerRequest(f.registration,{type:'replace-note-notification',title:'Changed',options:f.manager.options({...note,body:'Changed'},'a'),onlyIfPresent:true});
 assert.equal(result.ok,true);assert.equal(f.shown.length,1);assert.equal(f.active[0].title,note.title);
 await f.manager.replace(f.registration,{...note,body:'Changed'},'a',true);assert.equal(f.shown.length,1);
});

test('existing duplicates are cleaned up without publishing a replacement',async()=>{
 const f=workerFixture();await f.manager.setAccount('a');await f.manager.show(note);
 await f.registration.showNotification(note.title,f.manager.options(note,'a'));
 await f.registration.showNotification(note.title,f.manager.options(note,'a'));
 const count=f.shown.length;await f.manager.sync([note]);
 assert.equal(f.active.length,1);assert.equal(f.shown.length,count);
});

test('clear still reports a failure if the browser refuses to remove its notification',async()=>{
 const f=workerFixture({refuseClose:true});await f.manager.setAccount('a');await f.manager.show(note);
 await assert.rejects(f.manager.clear(note),/No new notification was added/);
 assert.equal(f.active.length,1);assert.equal(f.shown.length,1);
});
