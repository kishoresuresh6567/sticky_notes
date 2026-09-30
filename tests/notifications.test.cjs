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
 assert.equal(await f.manager.toggle(note),true);assert.equal(f.requested,1);
 assert.equal(f.shown[0].requireInteraction,true);assert.equal(f.shown[0].body,'\u2610 Milk\n\u2611 Bread');
 assert.equal(f.shown[0].data.accountId,'a');assert.equal(f.shown[0].actions[0].action,'clear');
 f.notification.permission='granted';
 await f.manager.toggle({...note,id:'n2'});assert.equal(f.active.size,2);
 await f.manager.setAccount('a');assert.equal(f.manager.selected.size,2);
 assert.equal(await f.manager.toggle(note),false);assert.equal(f.active.size,1);
 assert.equal(f.manager.selected.has('n1'),false);
});
test('sync updates selected notes without re-creating dismissed ones and clears missing or trashed notes',async()=>{
 const f=fixture();await f.manager.setAccount('a');await f.manager.toggle(note);
 await f.manager.sync([{...note,body:'New text',type:'text'}]);assert.equal(f.shown.at(-1).body,'New text');
 [...f.active.values()][0].close();await f.manager.sync([note]);assert.equal(f.active.size,0);assert.equal(f.manager.selected.size,0);
 await f.manager.toggle(note);await f.manager.sync([{...note,trash:true}]);assert.equal(f.active.size,0);
 await f.manager.toggle(note);await f.manager.sync([]);assert.equal(f.active.size,0);
});
test('logout and account switching clear notifications, including pending permission requests',async()=>{
 const f=fixture();await f.manager.setAccount('a');await f.manager.toggle(note);
 await f.manager.setAccount('b');assert.equal(f.active.size,0);
 await f.manager.toggle(note);await f.manager.setAccount(null);assert.equal(f.active.size,0);
 await f.manager.setAccount('a');f.notification.permission='default';let finish;
 f.notification.requestPermission=()=>new Promise(resolve=>{finish=resolve;});
 const pending=f.manager.toggle(note);await f.manager.setAccount(null);finish('granted');await pending;
 assert.equal(f.active.size,0);
});
test('denied permission and unsupported browsers give actionable errors',async()=>{
 const f=fixture('denied');await f.manager.setAccount('a');
 await assert.rejects(f.manager.toggle(note),/Allow notifications/);assert.equal(f.active.size,0);
 const unsupported=new NoteNotifications({notification:null,workers:null});await unsupported.setAccount('a');
 await assert.rejects(unsupported.toggle(note),/not supported/);
});
test('explicit clear never shows a missing notification and does not ask for permission',async()=>{
 const f=fixture();await f.manager.setAccount('a');await f.manager.toggle(note);
 f.active.clear();f.notification.permission='denied';
 await f.manager.clear(note);
 assert.equal(f.shown.length,1);assert.equal(f.requested,0);assert.equal(f.manager.selected.has(note.id),false);
});
test('clear removes only the selected note and stale notification snapshots cannot restore it',async()=>{
 const f=fixture();await f.manager.setAccount('a');await f.manager.toggle(note);await f.manager.toggle({...note,id:'n2'});
 const stale=[...f.active.values()][0];await f.manager.clear(note);
 assert.equal(f.active.size,1);assert.equal(f.manager.selected.has('n2'),true);
 f.registration.getNotifications=async()=>[stale];
 await f.manager.sync([{...note,body:'Updated'}]);
 assert.equal(f.shown.length,2);assert.equal(f.manager.selected.has(note.id),false);
});
test('worker clear wins over an in-flight click restoration',async()=>{
 const handlers={},active=new Map();let release,reply;
 const original={title:'Note',body:'Text',tag:'ticky-note:a:n1',data:{issuedAt:1},close(){active.delete(this.tag);}};
 // The browser has already consumed the clicked notification.
 const self={addEventListener(name,fn){handlers[name]=fn;},registration:{async getNotifications(){return [...active.values()];},async showNotification(title,options){await new Promise(resolve=>{release=resolve;});active.set(options.tag,{...original,...options});}},clients:{async matchAll(){return [{async focus(){},postMessage(){}}];}}};
 require('node:vm').runInNewContext(require('node:fs').readFileSync('notification-worker.js','utf8'),{self,setTimeout});
 let clicked,cleared;
 handlers.notificationclick({action:'',notification:original,waitUntil(p){clicked=p;}});
 await new Promise(resolve=>setImmediate(resolve));
 handlers.message({data:{type:'clear-note-notification',tag:original.tag},ports:[{postMessage(value){reply=value;}}],waitUntil(p){cleared=p;}});
 release();await clicked;await cleared;
 assert.equal(active.size,0);assert.equal(reply.ok,true);
});
test('notification worker clears only on clear and replaces clicked notifications before opening the app',async()=>{
 const events={},messages=[],shown=[];let closed=0,focused=0;
 const self={registration:{async getNotifications(){return [];},async showNotification(title,options){shown.push({title,...options});}},addEventListener(name,fn){events[name]=fn;},clients:{async matchAll(){return [{postMessage(message){messages.push(message);},async focus(){assert.equal(shown.length,1);focused++;}}];}}};
 require('node:vm').runInNewContext(require('node:fs').readFileSync('notification-worker.js','utf8'),{self,setTimeout});
 let completed;
 events.notificationclick({action:'clear',notification:{tag:'ticky-note:other',close(){closed++;}},waitUntil(p){completed=p;}});await completed;
 assert.equal(closed,1);assert.equal(messages[0].type,'note-notifications-changed');assert.equal(shown.length,0);
 events.notificationclick({action:'',notification:{title:'Shopping',body:'Milk',tag:'ticky-note:a:n1',data:{accountId:'a',noteId:'n1'},close(){closed++;}},waitUntil(p){completed=p;}});await completed;
 assert.equal(focused,1);assert.equal(closed,1);
 assert.equal(shown[0].title,'Shopping');assert.equal(shown[0].body,'Milk');
 assert.equal(shown[0].tag,'ticky-note:a:n1');assert.equal(shown[0].requireInteraction,true);
 assert.equal(shown[0].actions[0].action,'clear');
});


function workerFixture({closeDelayReads=0,refuseClose=false}={}){
 const handlers={},active=[],shown=[],liveAtShow=[];
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
 const self={registration,addEventListener(name,fn){handlers[name]=fn;},clients:{async matchAll(){return [{async focus(){},postMessage(){}}];}}};
 require('node:vm').runInNewContext(require('node:fs').readFileSync('notification-worker.js','utf8'),{self,setTimeout});
 registration.active={postMessage(data,ports){handlers.message({data,ports,waitUntil(p){p.catch(()=>{});}});}};
 const manager=new NoteNotifications({notification:{permission:'granted'},workers:{async register(){},ready:Promise.resolve(registration)}});
 async function click(notification){let promise;handlers.notificationclick({notification,action:'',waitUntil(p){promise=p;}});await promise;}
 return {manager,registration,active,shown,liveAtShow,click};
}
test('updates close older cards even when the platform does not replace notifications by tag',async()=>{
 const f=workerFixture();await f.manager.setAccount('a');
 await f.manager.toggle({...note,updated:1});
 await f.manager.sync([{...note,body:'Second',updated:2}]);
 await f.manager.sync([{...note,body:'Latest',updated:3}]);
 assert.equal(f.active.length,1);assert.match(f.active[0].body,/Latest/);
 const count=f.shown.length;
 await f.manager.sync([{...note,body:'Stale',updated:2}]);
 assert.equal(f.active.length,1);assert.equal(f.shown.length,count);assert.match(f.active[0].body,/Latest/);
 await f.manager.clear(note);assert.equal(f.active.length,0);
});
test('existing duplicates collapse on sync and clicking an older card cannot restore older content',async()=>{
 const f=workerFixture();await f.manager.setAccount('a');
 await f.manager.toggle({...note,updated:1});const old=f.active[0];
 const latest={...note,body:'Latest',updated:3};
 await f.registration.showNotification(latest.title,f.manager.options(latest,'a'));
 await f.registration.showNotification(latest.title,f.manager.options(latest,'a'));
 assert.equal(f.active.length,3);
 await f.manager.sync([latest]);assert.equal(f.active.length,1);
 const count=f.shown.length;await f.click(old);
 assert.equal(f.active.length,1);assert.equal(f.shown.length,count);assert.match(f.active[0].body,/Latest/);
});

test('ten rapid checkbox saves produce one final update after removing the previous card',async t=>{
 const f=workerFixture();await f.manager.setAccount('a');await f.manager.toggle({...note,updated:1});
 t.mock.timers.enable({apis:['setTimeout']});
 const pending=[];
 for(let i=1;i<=10;i++){
  pending.push(f.manager.scheduleSync([{...note,body:Array.from({length:10},(_,j)=>`Item ${j+1}`).join('\n'),checked:Array.from({length:i},(_,j)=>j),updated:i+1}]));
  t.mock.timers.tick(100);
 }
 assert.equal(f.shown.length,1);
 t.mock.timers.tick(1399);assert.equal(f.shown.length,1);
 t.mock.timers.tick(1);await Promise.all(pending);
 assert.equal(f.shown.length,2);assert.equal(f.active.length,1);
 assert.equal(f.liveAtShow[1],0);
 assert.equal(f.active[0].body.split('\n').filter(line=>line.startsWith('\u2611')).length,10);
 assert.equal(f.active[0].renotify,false);
});

test('pending checkbox notification updates are cancelled on sign-out',async t=>{
 const f=workerFixture();await f.manager.setAccount('a');await f.manager.toggle(note);
 t.mock.timers.enable({apis:['setTimeout']});
 const pending=f.manager.scheduleSync([{...note,body:'Queued edit',updated:2}]);
 await f.manager.setAccount(null);t.mock.timers.tick(2000);await pending;
 assert.equal(f.active.length,0);assert.equal(f.shown.length,1);
});


test('Apple Banana Mango: every individual checkbox update waits for old-card removal and leaves one latest card',async()=>{
 const f=workerFixture({closeDelayReads:3});await f.manager.setAccount('a');
 const shopping={...note,body:'Apple\nBanana\nMango',checked:[],updated:1};
 await f.manager.toggle(shopping);
 for(let bought=1;bought<=3;bought++){
  await f.manager.sync([{...shopping,checked:Array.from({length:bought},(_,i)=>i),updated:bought+1}]);
  assert.equal(f.active.length,1);
  assert.equal(f.liveAtShow.at(-1),0,'a replacement must never be shown while an old card remains');
  assert.equal(f.active[0].body.split('\n').filter(line=>line.startsWith('\u2611')).length,bought);
 }
 assert.equal(f.shown.length,4);
});

test('when the browser refuses to remove the previous card, updates fail without creating another card',async()=>{
 const f=workerFixture({refuseClose:true});await f.manager.setAccount('a');await f.manager.toggle({...note,updated:1});
 await assert.rejects(f.manager.sync([{...note,body:'Updated',updated:2}]),/No new notification was added/);
 assert.equal(f.active.length,1);assert.equal(f.shown.length,1);
});
