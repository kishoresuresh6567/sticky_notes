self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
let operations=Promise.resolve();
const clearedTags=new Map();
function serialize(operation){const result=operations.catch(()=>{}).then(operation);operations=result;return result;}
function sameNote(a,b){return a.tag===b.tag||(a.tag?.startsWith('ticky-note:')&&a.data?.accountId&&a.data.accountId===b.data?.accountId&&a.data.noteId===b.data?.noteId);}
function newer(a,b){return (a.data?.updated||0)-(b.data?.updated||0)||(a.data?.issuedAt||0)-(b.data?.issuedAt||0);}
async function replace(title,options,onlyIfPresent){
  const existing=(await self.registration.getNotifications()).filter(n=>sameNote(n,options));
  if(onlyIfPresent&&!existing.length)return;
  if(onlyIfPresent&&clearedTags.has(options.tag))return;
  if(!onlyIfPresent)clearedTags.delete(options.tag);
  const newest=existing.reduce((best,n)=>newer(n,best)>0?n:best,{title,...options});
  if(existing.includes(newest)){
    existing.filter(n=>n!==newest).forEach(n=>n.close());
    return;
  }
  if(existing.length===1&&existing[0].title===title&&existing[0].body===options.body)return;
  // Do not close the canonical card before updating it: doing so turns every
  // checkbox save into a fresh system notification instead of a tag replacement.
  existing.filter(n=>n.tag!==options.tag).forEach(n=>n.close());
  await self.registration.showNotification(title,{...options,renotify:false});
  const remaining=(await self.registration.getNotifications()).filter(n=>sameNote(n,options));
  const keep=remaining.reduce((a,b)=>!a||newer(b,a)>=0?b:a,null);
  remaining.filter(n=>n!==keep).forEach(n=>n.close());
}
self.addEventListener('message',event=>{
  const message=event.data,kind=message?.type;
  if(!['clear-note-notification','replace-note-notification'].includes(kind))return;
  const tag=kind==='clear-note-notification'?message.tag:message.options?.tag;
  if(typeof tag!=='string'||!tag.startsWith('ticky-note:'))return;
  if(kind==='clear-note-notification')clearedTags.set(tag,Date.now());
  event.waitUntil(serialize(async()=>{
    try{
      if(kind==='clear-note-notification'){
        for(const notification of await self.registration.getNotifications())if(notification.tag===tag)notification.close();
        await changed();
      }else await replace(message.title,message.options,message.onlyIfPresent);
      event.ports[0]?.postMessage({ok:true});
    }catch{event.ports[0]?.postMessage({ok:false});}
  }));
});
async function changed(){
  for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true}))client.postMessage({type:'note-notifications-changed'});
}
self.addEventListener('notificationclose',event=>event.waitUntil(changed()));
self.addEventListener('notificationclick',event=>{
  event.waitUntil(serialize(async()=>{
    const notification=event.notification;
    if(event.action==='clear'){
      clearedTags.set(notification.tag,Date.now());notification.close();
      for(const existing of await self.registration.getNotifications())if(sameNote(existing,notification))existing.close();
      await changed();return;
    }
    if(clearedTags.has(notification.tag)){
      if((notification.data?.issuedAt||0)<=clearedTags.get(notification.tag))return;
      clearedTags.delete(notification.tag);
    }
    const existing=(await self.registration.getNotifications()).filter(n=>sameNote(n,notification));
    if(existing.length){
      const newest=existing.reduce((a,b)=>newer(a,b)>=0?a:b);
      existing.filter(n=>n!==newest).forEach(n=>n.close());
    }else{
      // Restore only when the browser consumed the clicked card. Never replace
      // a newer notification with the old content carried by a click event.
      await self.registration.showNotification(notification.title,{
        body:notification.body,tag:notification.tag,data:notification.data,
        requireInteraction:true,silent:true,renotify:false,
        actions:[{action:'clear',title:'Clear notification'}]
      });
    }
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    if(windows.length)await windows[0].focus();
    else await self.clients.openWindow('/');
  }));
});
