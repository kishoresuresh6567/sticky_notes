self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
let operations=Promise.resolve();
const clearedTags=new Map();
function serialize(operation){const result=operations.catch(()=>{}).then(operation);operations=result;return result;}
self.addEventListener('message',event=>{
  if(event.data?.type!=='clear-note-notification'||typeof event.data.tag!=='string'||!event.data.tag.startsWith('ticky-note:'))return;
  const tag=event.data.tag;clearedTags.set(tag,Date.now());
  event.waitUntil(serialize(async()=>{
    try{
      for(const notification of await self.registration.getNotifications())if(notification.tag===tag)notification.close();
      await changed();event.ports[0]?.postMessage({ok:true});
    }catch{event.ports[0]?.postMessage({ok:false});}
  }));
});
async function changed(){
  for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true}))client.postMessage({type:'note-notifications-changed'});
}
self.addEventListener('notificationclose',event=>event.waitUntil(changed()));
self.addEventListener('notificationclick',event=>{
  event.waitUntil(serialize(async()=>{
    if(event.action==='clear'){event.notification.close();await changed();return;}
    // Some browsers consume a clicked notification. Replace it before focusing
    // the app so opening it is separate from the explicit Clear action.
    const notification=event.notification;
    notification.close();
    if(clearedTags.has(notification.tag)){
      if((notification.data?.issuedAt||0)<=clearedTags.get(notification.tag))return;
      clearedTags.delete(notification.tag);
    }
    await self.registration.showNotification(notification.title,{
      body:notification.body,tag:notification.tag,data:notification.data,
      requireInteraction:true,silent:true,
      actions:[{action:'clear',title:'Clear notification'}]
    });
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    if(windows.length)await windows[0].focus();
    else await self.clients.openWindow('/');
  }));
});
