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
 require('node:vm').runInNewContext(require('node:fs').readFileSync('notification-worker.js','utf8'),{self});
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
 require('node:vm').runInNewContext(require('node:fs').readFileSync('notification-worker.js','utf8'),{self});
 let completed;
 events.notificationclick({action:'clear',notification:{tag:'ticky-note:other',close(){closed++;}},waitUntil(p){completed=p;}});await completed;
 assert.equal(closed,1);assert.equal(messages[0].type,'note-notifications-changed');assert.equal(shown.length,0);
 events.notificationclick({action:'',notification:{title:'Shopping',body:'Milk',tag:'ticky-note:a:n1',data:{accountId:'a',noteId:'n1'},close(){closed++;}},waitUntil(p){completed=p;}});await completed;
 assert.equal(focused,1);assert.equal(closed,1);
 assert.equal(shown[0].title,'Shopping');assert.equal(shown[0].body,'Milk');
 assert.equal(shown[0].tag,'ticky-note:a:n1');assert.equal(shown[0].requireInteraction,true);
 assert.equal(shown[0].actions[0].action,'clear');
});


function workerFixture(){
 const handlers={},active=[],shown=[];
 const registration={
  async getNotifications(){return active.slice();},
  async showNotification(title,options){
   shown.push({title,...options});
   const notification={title,...options,close(){const i=active.indexOf(this);if(i>=0)active.splice(i,1);}};
   active.push(notification);
  }
 };
 const self={registration,addEventListener(name,fn){handlers[name]=fn;},clients:{async matchAll(){return [{async focus(){},postMessage(){}}];}}};
 require('node:vm').runInNewContext(require('node:fs').readFileSync('notification-worker.js','utf8'),{self});
 registration.active={postMessage(data,ports){handlers.message({data,ports,waitUntil(p){p.catch(()=>{});}});}};
 const manager=new NoteNotifications({notification:{permission:'granted'},workers:{async register(){},ready:Promise.resolve(registration)}});
 async function click(notification){let promise;handlers.notificationclick({notification,action:'',waitUntil(p){promise=p;}});await promise;}
 return {manager,registration,active,shown,click};
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
