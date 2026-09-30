self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
let operations=Promise.resolve();
const clearedTags=new Map();
function serialize(operation){const result=operations.catch(()=>{}).then(operation);operations=result;return result;}
function sameNote(a,b){return a.tag===b.tag||(a.tag?.startsWith('ticky-note:')&&a.data?.accountId&&a.data.accountId===b.data?.accountId&&a.data.noteId===b.data?.noteId);}
function newer(a,b){return (a.data?.updated||0)-(b.data?.updated||0)||(a.data?.issuedAt||0)-(b.data?.issuedAt||0);}
async function removeAndConfirm(match){
  // close() has no completion promise. Re-read the browser's notification list
  // before allowing another card to be created for this note.
  for(let attempt=0;attempt<20;attempt++){
    const remaining=(await self.registration.getNotifications()).filter(match);
    if(!remaining.length)return;
    remaining.forEach(notification=>notification.close());
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  if((await self.registration.getNotifications()).some(match))throw new Error('notification-close-pending');
}
async function replace(title,options,onlyIfPresent){
  // Also suppress update requests sent by tabs still running the old client.
  if(onlyIfPresent)return;
  const existing=(await self.registration.getNotifications()).filter(n=>sameNote(n,options));
  if(onlyIfPresent&&!existing.length)return;
  if(onlyIfPresent&&clearedTags.has(options.tag))return;
  if(!onlyIfPresent)clearedTags.delete(options.tag);
  const newest=existing.reduce((best,n)=>newer(n,best)>0?n:best,{title,...options});
  if(existing.includes(newest)&&existing.length===1)return;
  if(existing.includes(newest)){
    title=newest.title;
    options={...options,body:newest.body,data:newest.data};
  }
  if(existing.length===1&&existing[0].title===title&&existing[0].body===options.body)return;
  // Remove every previous version first, including duplicate/legacy tags.
  // If removal cannot be confirmed, do not add yet another notification.
  await removeAndConfirm(notification=>sameNote(notification,options));
  if(clearedTags.has(options.tag))return;
  await self.registration.showNotification(title,{...options,renotify:false});
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
        await removeAndConfirm(notification=>notification.tag===tag);
        await changed();
      }else await replace(message.title,message.options,message.onlyIfPresent);
      event.ports[0]?.postMessage({ok:true});
    }catch(error){event.ports[0]?.postMessage({ok:false,code:error.message==='notification-close-pending'?'notification-close-pending':'notification-update-failed'});}
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
      await removeAndConfirm(existing=>sameNote(existing,notification));
      await changed();return;
    }
    if(clearedTags.has(notification.tag)){
      if((notification.data?.issuedAt||0)<=clearedTags.get(notification.tag))return;
      clearedTags.delete(notification.tag);
    }
    const existing=(await self.registration.getNotifications()).filter(n=>sameNote(n,notification));
    const snapshot=existing.reduce((a,b)=>newer(a,b)>=0?a:b,notification);
    // A clicked card can still appear in getNotifications() before the OS
    // dismisses it. Explicitly finish removing it before restoring one snapshot.
    notification.close();
    await removeAndConfirm(item=>sameNote(item,notification));
    if(clearedTags.has(notification.tag))return;
    await self.registration.showNotification(snapshot.title,{
      body:snapshot.body,tag:snapshot.tag,data:snapshot.data,
      requireInteraction:true,silent:true,renotify:false,
      actions:[{action:'clear',title:'Clear notification'}]
    });
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    if(windows.length)await windows[0].focus();
    else await self.clients.openWindow('/');
  }));
});
