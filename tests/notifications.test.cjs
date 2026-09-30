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
test('notification worker clears on the clear action and focuses the app on an ordinary click',async()=>{
 const events={},messages=[];let closed=0,focused=0;
 const self={addEventListener(name,fn){events[name]=fn;},clients:{async matchAll(){return [{postMessage(message){messages.push(message);},async focus(){focused++;}}];}}};
 require('node:vm').runInNewContext(require('node:fs').readFileSync('notification-worker.js','utf8'),{self});
 let completed;
 events.notificationclick({action:'clear',notification:{close(){closed++;}},waitUntil(p){completed=p;}});await completed;
 assert.equal(closed,1);assert.equal(messages[0].type,'note-notifications-changed');
 events.notificationclick({action:'',notification:{close(){closed++;}},waitUntil(p){completed=p;}});await completed;
 assert.equal(focused,1);assert.equal(closed,1);
});
