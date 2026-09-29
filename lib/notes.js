const {requireAccount,readBody,httpError}=require('./auth');

function validateData(data){
  const fail=()=>{throw httpError(400,'Invalid notes data.');};
  if(!data||!Array.isArray(data.notes)||!Array.isArray(data.categories)||data.notes.length>5000||data.categories.length>500)fail();
  const text=(v,max)=>typeof v==='string'&&v.length<=max;
  const ids=new Set();
  for(const n of data.notes){
    if(!n||!text(n.id,100)||!n.id||ids.has(n.id)||!text(n.title,160)||!text(n.body,200000)||!['text','checklist','bullets'].includes(n.type)||!text(n.color,30)||!['yellow','green','pink','blue','purple','cream','gold','orange','coral','teal','cobalt','violet','berry','navy','charcoal'].includes(n.color)||!Array.isArray(n.checked)||!n.checked.every(i=>Number.isInteger(i)&&i>=0)||!Number.isFinite(n.created)||!Number.isFinite(n.updated)||!['pinned','trash','strike'].every(k=>typeof n[k]==='boolean')||(n.category!==undefined&&!text(n.category,100)))fail();
    ids.add(n.id);
  }
  ids.clear();
  for(const c of data.categories){if(!c||!text(c.id,100)||!c.id||ids.has(c.id)||!text(c.name,40)||!c.name.trim())fail();ids.add(c.id);}
  if(data.vault!==null){
    const v=data.vault,base64=(s,max)=>text(s,max)&&/^[A-Za-z0-9+/]+={0,2}$/.test(s);
    if(!v||!base64(v.salt,24)||Buffer.from(v.salt,'base64').length!==16||!base64(v.iv,16)||Buffer.from(v.iv,'base64').length!==12||!base64(v.data,1400000)||Buffer.from(v.data,'base64').length<16)fail();
  }
  return {notes:data.notes,categories:data.categories,vault:data.vault};
}

function firebaseStore(env,fetcher=fetch,tokenProvider){
  let auth;
  const setting=value=>{
    const text=typeof value==='string'?value.trim():'';
    return text.length>=2&&((text.startsWith("'")&&text.endsWith("'"))||(text.startsWith('"')&&text.endsWith('"')))?text.slice(1,-1).trim():text;
  };
  const configError=message=>httpError(503,'Cloud storage is not configured. '+message+' Update the server environment variables, then restart locally or redeploy on Vercel.');
  function configuration(){
      const databaseURL=setting(env.FIREBASE_DATABASE_URL);
      if(!databaseURL)throw configError('FIREBASE_DATABASE_URL is missing.');
      let url;
      try{url=new URL(databaseURL);}catch{throw configError('FIREBASE_DATABASE_URL must be the HTTPS URL from Firebase Console > Realtime Database > Data.');}
      if(url.protocol!=='https:'||!/^([a-z0-9-]+\.firebaseio\.com|[a-z0-9-]+\.[a-z0-9-]+\.firebasedatabase\.app)$/.test(url.hostname)||url.pathname!=='/'||url.search||url.hash||url.username||url.password||url.port)throw configError('FIREBASE_DATABASE_URL must be a Firebase Realtime Database root URL.');
      if(!tokenProvider&&!auth){
        const raw=setting(env.FIREBASE_SERVICE_ACCOUNT_JSON);
        if(!raw)throw configError('FIREBASE_SERVICE_ACCOUNT_JSON is missing.');
        let credentials;
        try{credentials=JSON.parse(raw);}catch{throw configError('FIREBASE_SERVICE_ACCOUNT_JSON must contain the complete downloaded service-account JSON.');}
        if(!credentials||typeof credentials!=='object'||Array.isArray(credentials)||!['project_id','client_email','private_key'].every(key=>typeof credentials[key]==='string'&&credentials[key].trim()))throw configError('FIREBASE_SERVICE_ACCOUNT_JSON must be a JSON object containing project_id, client_email, and private_key.');
        credentials.private_key=credentials.private_key.replace(/\\n/g,'\n');
        try{require('node:crypto').createPrivateKey(credentials.private_key);}catch{throw configError('FIREBASE_SERVICE_ACCOUNT_JSON contains an invalid private_key. Use the original downloaded key.');}
        const {GoogleAuth}=require('google-auth-library');
        auth=new GoogleAuth({credentials,scopes:['https://www.googleapis.com/auth/firebase.database','https://www.googleapis.com/auth/userinfo.email']});
      }
      return url;
  }
  async function call(id,options={}){
    const base=configuration();
    // Encode the verified Google subject into a safe, collision-free database key.
    const url=new URL('account_notes/'+Buffer.from(id).toString('base64url')+'.json',base);
    try{
      const token=await (tokenProvider?tokenProvider():auth.getAccessToken());
      if(!token)throw new Error();
      const response=await fetcher(url,{...options,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,...options.headers},signal:AbortSignal.timeout(12000)});
      if(response.status===412)throw httpError(409,'These notes changed on another device. Copy any unsaved text, then reload to get the latest notes.');
      if(!response.ok)throw new Error();
      return {data:await response.json(),etag:response.headers.get('etag')};
    }catch(error){if(error.status===409)throw error;throw httpError(503,'Cloud storage is unavailable. Your changes have not been confirmed saved.');}
  }
  const decode=row=>row?{version:row.version,data:JSON.parse(row.data)}:{version:0,data:{notes:[],categories:[],vault:null}};
  return {
    async load(id){try{return decode((await call(id)).data);}catch(error){if(error.status)throw error;throw httpError(503,'Cloud storage contains unreadable notes.');}},
    async save(id,version,data){
      const current=await call(id,{headers:{'X-Firebase-ETag':'true'}});
      if((current.data?.version||0)!==version)throw httpError(409,'These notes changed on another device. Copy any unsaved text, then reload to get the latest notes.');
      if(!current.etag)throw httpError(503,'Cloud storage did not confirm the notes version.');
      // JSON preserves empty arrays, nulls, and checklist indexes exactly in RTDB.
      await call(id,{method:'PUT',headers:{'if-match':current.etag},body:JSON.stringify({version:version+1,data:JSON.stringify(data)})});
      return {version:version+1};
    }
  };
}

function createNotesHandler({env=process.env,store=firebaseStore(env)}={}){
  return async(req,res)=>{
    res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store, private');res.setHeader('Vary','Cookie');
    try{
      if(!['GET','PUT'].includes(req.method)){res.setHeader('Allow','GET, PUT');throw httpError(405,'Method not allowed.');}
      const user=requireAccount(req,env,req.method==='PUT');
      let result;
      if(req.method==='GET')result=await store.load(user.id);
      else{
        const body=await readBody(req,2*1024*1024);
        if(!Number.isSafeInteger(body.version)||body.version<0)throw httpError(400,'Invalid notes version.');
        result=await store.save(user.id,body.version,validateData(body.data));
      }
      res.statusCode=200;res.end(JSON.stringify(result));
    }catch(error){res.statusCode=error.status||500;res.end(JSON.stringify({error:error.status?error.message:'Could not access your notes. Please try again.'}));}
  };
}
module.exports={createNotesHandler,firebaseStore,validateData};
