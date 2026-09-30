class NoteNotifications {
  constructor({notification=globalThis.Notification,workers=globalThis.navigator?.serviceWorker}={}){
    this.notification=notification;this.workers=workers;this.account=null;this.epoch=0;this.selected=new Set();this.cleared=new Set();this.pending=Promise.resolve();
  }
  supported(){return !!(this.notification&&this.workers);}
  async registration(){
    if(!this.supported())throw new Error('Notifications are not supported in this browser. Try Edge or Chrome over HTTPS.');
    await this.workers.register('/notification-worker.js');
    return this.workers.ready;
  }
  enqueue(task){const operation=this.pending.catch(()=>{}).then(task);this.pending=operation;return operation;}
  ours(notification){return notification.tag.startsWith('ticky-note:');}
  setAccount(id){
    this.account=id;this.epoch++;this.selected.clear();
    if(!this.supported())return Promise.resolve();
    return this.enqueue(async()=>{
      const registration=await this.registration();
      for(const notification of await registration.getNotifications()){
        if(!this.ours(notification))continue;
        if(this.cleared.has(notification.tag)||!this.account||notification.data?.accountId!==this.account)notification.close();
        else this.selected.add(notification.data.noteId);
      }
    });
  }
  options(note,id){
    const body=note.type==='text'?note.body:note.body.split('\n').map((line,i)=>`${note.type==='bullets'?'•':note.checked.includes(i)?'☑':'☐'} ${line}`).join('\n');
    return {body:body.slice(0,1500),tag:`ticky-note:${encodeURIComponent(id)}:${encodeURIComponent(note.id)}`,requireInteraction:true,silent:true,data:{accountId:id,noteId:note.id,issuedAt:Date.now()},actions:[{action:'clear',title:'Clear notification'}]};
  }
  clear(note){
    const id=this.account,tag=this.options(note,id).tag;
    this.cleared.add(tag);this.selected.delete(note.id);
    return this.enqueue(async()=>{
      const registration=await this.registration();
      // Also serialize the clear with click restoration inside the worker.
      if(registration.active){
        await new Promise((resolve,reject)=>{
          const channel=new MessageChannel();
          const finish=error=>{clearTimeout(timeout);channel.port1.close();error?reject(error):resolve();};
          const timeout=setTimeout(()=>finish(new Error('Could not confirm notification removal. Reload the app and try Clear again.')),8000);
          channel.port1.onmessage=event=>finish(event.data?.ok?null:new Error('Could not clear this notification. Please try again.'));
          try{registration.active.postMessage({type:'clear-note-notification',tag},[channel.port2]);}catch(error){finish(error);}
        });
      }
      for(const notification of await registration.getNotifications())if(notification.tag===tag)notification.close();
      this.selected.delete(note.id);return false;
    });
  }
  async toggle(note){
    const id=this.account,epoch=this.epoch;
    if(!id||note.trash)throw new Error('Sign in and select an active note first.');
    if(!this.supported())throw new Error('Notifications are not supported in this browser. Try Edge or Chrome over HTTPS.');
    // Request permission directly from the user's click, before any other await.
    const permission=this.notification.permission==='default'?await this.notification.requestPermission():this.notification.permission;
    if(permission!=='granted')throw new Error('Allow notifications in your browser site settings, then try again.');
    return this.enqueue(async()=>{
      if(epoch!==this.epoch)return;
      const registration=await this.registration();
      const existing=(await registration.getNotifications()).filter(n=>this.ours(n)&&n.data?.accountId===id&&n.data?.noteId===note.id);
      if(epoch!==this.epoch)return;
      if(existing.length){existing.forEach(n=>n.close());this.selected.delete(note.id);return false;}
      this.cleared.delete(this.options(note,id).tag);
      await registration.showNotification(note.title||'Untitled note',this.options(note,id));
      if(epoch!==this.epoch){for(const n of await registration.getNotifications())if(this.ours(n)&&n.data?.accountId===id)n.close();return;}
      this.selected.add(note.id);return true;
    });
  }
  sync(notes){
    const epoch=this.epoch,id=this.account;
    if(!this.supported()||!id)return Promise.resolve();
    return this.enqueue(async()=>{
      if(epoch!==this.epoch)return;
      const registration=await this.registration(),active=await registration.getNotifications(),selected=new Set();
      for(const notification of active){
        if(epoch!==this.epoch)return;
        if(!this.ours(notification)||notification.data?.accountId!==id)continue;
        if(this.cleared.has(notification.tag)){notification.close();continue;}
        const note=notes.find(n=>n.id===notification.data.noteId&&!n.trash);
        if(!note){notification.close();continue;}
        selected.add(note.id);
        const options=this.options(note,id),title=note.title||'Untitled note';
        if(notification.title!==title||notification.body!==options.body)await registration.showNotification(title,options);
      }
      if(epoch===this.epoch)this.selected=selected;
    });
  }
}
if(typeof module!=='undefined')module.exports={NoteNotifications};
else window.noteNotifications=new NoteNotifications();
