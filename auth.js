(()=>{
  const button=document.querySelector('#account-button');
  const dialog=document.querySelector('#account-dialog');
  const message=document.querySelector('#auth-message');
  const googleButton=document.querySelector('#google-signin');
  const retry=document.querySelector('#auth-retry');
  const signout=document.querySelector('#signout-button');
  const account=document.querySelector('#account-details');
  let session=null,sdkPromise=null,revision=0,busy=false;
  const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('ticky-track-auth'):null;

  async function api(action,options={}){
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetch(`/api/auth?action=${action}`,{credentials:'same-origin',cache:'no-store',...options,signal:controller.signal});
      let data;
      try{data=await response.json();}catch{throw new Error('Sign-in is unavailable. Please try again later.');}
      if(!response.ok)throw new Error(data.error||'Sign-in failed. Please try again.');
      return data;
    }catch(error){
      if(error.name==='AbortError')throw new Error('Sign-in took too long. Check your connection and try again.');
      throw error;
    }finally{clearTimeout(timeout);}
  }
  function status(text,isError=false){message.textContent=text;message.classList.toggle('error',isError);}
  function render(){
    const user=session?.user;
    document.body.classList.toggle('auth-locked',!user);
    document.querySelector('#close-account').hidden=!user;
    if(!user){
      document.querySelectorAll('dialog[open]').forEach(item=>{if(item!==dialog)item.close();});
      if(!dialog.open)dialog.showModal();
    }
    button.textContent=user?user.name.split(' ')[0]||'Account':'Sign in';
    button.setAttribute('aria-label',user?`Account: ${user.email}`:'Sign in');
    button.title=user?user.email:'Sign in to Ticky Track';
    account.hidden=!user;
    document.querySelector('.account-description').hidden=!!user;
    document.querySelector('#account-title').textContent=user?'Your account':'Welcome to Ticky Track';
    document.querySelector('#account-name').textContent=user?.name||'';
    document.querySelector('#account-email').textContent=user?.email||'';
    googleButton.hidden=!!user;
    signout.hidden=!user;
  }
  async function refresh(){
    const current=++revision;
    const data=await api('session');
    if(current!==revision)return false;
    session=data;render();return true;
  }
  function loadGoogle(){
    if(window.google?.accounts?.id)return Promise.resolve();
    if(sdkPromise)return sdkPromise;
    sdkPromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      const timeout=setTimeout(()=>fail(),12000);
      function fail(){clearTimeout(timeout);script.remove();sdkPromise=null;reject(new Error('Google sign-in could not load. Check your connection or content blocker, then retry.'));}
      script.src='https://accounts.google.com/gsi/client';script.async=true;
      script.onload=()=>{clearTimeout(timeout);if(window.google?.accounts?.id)resolve();else fail();};
      script.onerror=fail;document.head.append(script);
    });
    return sdkPromise;
  }
  async function prepare(){
    if(busy)return;
    retry.hidden=true;retry.textContent='Try again';googleButton.replaceChildren();status('Loading sign-in…');
    try{
      if(!await refresh()||!dialog.open)return;
      if(session.user){status('You are signed in.');return;}
      if(!session.configured){status('Google sign-in is not available yet. Please try again later.');return;}
      if(session.origin!==window.location.origin){status(`Open ${session.origin} to sign in.`,true);return;}
      await loadGoogle();
      if(!dialog.open)return;
      window.google.accounts.id.initialize({client_id:session.clientId,nonce:session.nonce,callback:receiveCredential,auto_select:false,ux_mode:'popup'});
      window.google.accounts.id.renderButton(googleButton,{type:'standard',theme:'outline',size:'large',text:'continue_with',shape:'rectangular',width:Math.min(320,dialog.clientWidth-56)});
      status('Choose your Google account to continue.');
    }catch(error){status(error.message,true);retry.hidden=false;}
  }
  async function receiveCredential(response){
    if(busy)return;
    busy=true;++revision;retry.hidden=true;googleButton.hidden=true;status('Signing you in…');
    try{
      const result=await api('google',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf},body:JSON.stringify({credential:response.credential})});
      session={...session,user:result.user,expiresAt:result.expiresAt};render();status('You are signed in.');dialog.close();
      channel?.postMessage('changed');
      document.dispatchEvent(new CustomEvent('accountchange',{detail:{signedIn:true}}));
    }catch(error){status(error.message,true);retry.hidden=false;}
    finally{busy=false;}
  }
  button.addEventListener('click',()=>{if(!dialog.open)dialog.showModal();void prepare();});
  retry.addEventListener('click',()=>void prepare());
  document.querySelector('#close-account').addEventListener('click',()=>{if(session?.user)dialog.close();});
  dialog.addEventListener('cancel',event=>{if(!session?.user)event.preventDefault();});
  let backdropDown=false;
  function outside(event){const bounds=dialog.getBoundingClientRect();return event.target===dialog&&(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom);}
  dialog.addEventListener('pointerdown',event=>{backdropDown=event.button===0&&outside(event);});
  dialog.addEventListener('click',event=>{if(session?.user&&backdropDown&&outside(event))dialog.close();backdropDown=false;});
  dialog.addEventListener('close',()=>{backdropDown=false;});
  signout.addEventListener('click',async()=>{
    if(busy)return;busy=true;signout.disabled=true;status('Signing out…');
    try{
      await refresh();
      await api('logout',{method:'POST',headers:{'X-CSRF-Token':session.csrf}});
      window.google?.accounts?.id?.disableAutoSelect();
      session={...session,user:null};render();status('Signed out. Your notes are still saved in this browser.');
      channel?.postMessage('changed');
      document.dispatchEvent(new CustomEvent('accountchange',{detail:{signedIn:false}}));
      googleButton.replaceChildren();retry.textContent='Sign in again';retry.hidden=false;
    }catch(error){status(error.message,true);}
    finally{busy=false;signout.disabled=false;}
  });
  async function checkSession(){
    if(busy)return;
    try{
      await refresh();
      if(!session?.user)await prepare();
    }catch(error){
      session=null;render();status(error.message,true);retry.hidden=false;
    }
  }
  if(channel)channel.onmessage=()=>void checkSession();
  window.addEventListener('focus',()=>{if(!dialog.open)void checkSession();});
  render();
  void prepare().then(()=>{if(session?.user)dialog.close();});
})();
