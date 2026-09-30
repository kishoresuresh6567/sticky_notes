self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
async function changed(){
  for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true}))client.postMessage({type:'note-notifications-changed'});
}
self.addEventListener('notificationclose',event=>event.waitUntil(changed()));
self.addEventListener('notificationclick',event=>{
  event.waitUntil((async()=>{
    if(event.action==='clear'){event.notification.close();await changed();return;}
    // Opening the app does not explicitly dismiss the selected notification.
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    if(windows.length)await windows[0].focus();
    else await self.clients.openWindow('/');
  })());
});
