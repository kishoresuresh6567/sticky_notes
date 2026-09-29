// Only the server's verified account ID selects a cloud workspace.
class AccountCloud {
  constructor(request=(...args)=>globalThis.fetch(...args)){this.request=request;this.epoch=0;this.id=null;this.version=0;this.ready=false;this.pending=Promise.resolve();}
  async json(url,options={}){
    const response=await this.request(url,{credentials:'same-origin',cache:'no-store',...options,signal:AbortSignal.timeout(15000)});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||'Could not access cloud notes.');
    return data;
  }
  async open(id){
    if(id===this.id&&this.ready)return null;
    const epoch=++this.epoch;this.id=id;this.ready=false;this.version=0;
    if(!id)return null;
    const result=await this.json('/api/notes',{headers:{'X-Account-Id':id}});
    if(epoch!==this.epoch)throw new Error('Account changed while loading notes.');
    this.version=result.version;this.ready=true;return result.data;
  }
  save(data){
    if(!this.ready||!this.id)return Promise.reject(new Error('Sign in and load your notes before saving.'));
    const id=this.id,epoch=this.epoch,snapshot=structuredClone(data);
    const operation=this.pending.catch(()=>{}).then(async()=>{
      if(epoch!==this.epoch)throw new Error('Account changed. Save cancelled.');
      const session=await this.json('/api/auth?action=session');
      if(epoch!==this.epoch||session.user?.id!==id)throw new Error('Your signed-in account changed. Reload before editing notes.');
      const result=await this.json('/api/notes',{method:'PUT',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf,'X-Account-Id':id},body:JSON.stringify({version:this.version,data:snapshot})});
      if(epoch!==this.epoch)throw new Error('Account changed while saving.');
      this.version=result.version;
    });
    this.pending=operation;return operation;
  }
}
if(typeof module!=='undefined')module.exports={AccountCloud};
else window.accountCloud=new AccountCloud();
