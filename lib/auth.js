const {createHmac,randomBytes,timingSafeEqual}=require('node:crypto');
const {OAuth2Client}=require('google-auth-library');

const SESSION_SECONDS=12*60*60;
const CHALLENGE_SECONDS=10*60;
const MAX_BODY_BYTES=20*1024;
const googleClient=new OAuth2Client({transporterOptions:{timeout:8000}});

function configuration(env){
  const clientId=(env.GOOGLE_CLIENT_ID||'').trim();
  const secret=env.AUTH_SESSION_SECRET||'';
  let origin;
  try{
    const url=new URL(env.APP_ORIGIN);
    const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if((url.protocol!=='https:'&&!(local&&url.protocol==='http:'))||url.username||url.password||url.pathname!=='/'||url.search||url.hash)return null;
    origin=url.origin;
  }catch{return null;}
  if(!/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId)||Buffer.byteLength(secret)<32)return null;
  return {clientId,secret,origin,secure:origin.startsWith('https:')};
}

function equal(a,b){
  if(typeof a!=='string'||typeof b!=='string')return false;
  const first=Buffer.from(a),second=Buffer.from(b);
  return first.length===second.length&&timingSafeEqual(first,second);
}
function sign(data,config){
  const payload=Buffer.from(JSON.stringify({...data,aud:config.origin})).toString('base64url');
  return `${payload}.${createHmac('sha256',config.secret).update(payload).digest('base64url')}`;
}
function readSigned(value,kind,config,now){
  if(typeof value!=='string'||value.length>4096)return null;
  const parts=value.split('.');if(parts.length!==2)return null;
  const expected=createHmac('sha256',config.secret).update(parts[0]).digest('base64url');
  if(!equal(parts[1],expected))return null;
  try{
    const data=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
    return data.kind===kind&&data.aud===config.origin&&Number.isFinite(data.exp)&&data.exp>now?data:null;
  }catch{return null;}
}
function cookies(req){
  const result=Object.create(null);
  for(const part of (req.headers.cookie||'').split(';')){
    const index=part.indexOf('=');if(index<0)continue;
    result[part.slice(0,index).trim()]=part.slice(index+1).trim();
  }
  return result;
}
function cookieName(kind,config){return `${config.secure?'__Host-':''}ticky_${kind}`;}
function setCookie(res,kind,value,maxAge,config){
  const cookie=`${cookieName(kind,config)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.secure?'; Secure':''}`;
  const previous=res.getHeader('Set-Cookie')||[];
  res.setHeader('Set-Cookie',[...(Array.isArray(previous)?previous:[previous]),cookie]);
}
function json(res,status,body){res.statusCode=status;res.end(JSON.stringify(body));}
function httpError(status,message){return Object.assign(new Error(message),{status});}
async function readBody(req){
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))throw httpError(415,'Use a JSON request.');
  if(Number(req.headers['content-length'])>MAX_BODY_BYTES)throw httpError(413,'Request is too large.');
  let raw=req.body;
  if(raw===undefined){
    const chunks=[];let size=0;
    for await(const chunk of req){size+=Buffer.byteLength(chunk);if(size>MAX_BODY_BYTES)throw httpError(413,'Request is too large.');chunks.push(Buffer.from(chunk));}
    raw=Buffer.concat(chunks).toString('utf8');
  }
  if(Buffer.isBuffer(raw))raw=raw.toString('utf8');
  if(typeof raw==='object'&&raw!==null){if(Buffer.byteLength(JSON.stringify(raw))>MAX_BODY_BYTES)throw httpError(413,'Request is too large.');}
  else{try{raw=JSON.parse(raw);}catch{throw httpError(400,'Invalid request.');}}
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw httpError(400,'Invalid request.');
  return raw;
}
async function verifyGoogleToken(credential,clientId){
  const ticket=await googleClient.verifyIdToken({idToken:credential,audience:clientId});
  return ticket.getPayload();
}

// The verifier is injectable for tests only; HTTP requests cannot replace it.
function createAuthHandler({env=process.env,verifyToken=verifyGoogleToken,clock=()=>Date.now()}={}){
  return async function auth(req,res){
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Cache-Control','no-store, private');
    res.setHeader('Vary','Cookie');
    res.setHeader('X-Content-Type-Options','nosniff');
    try{
      const action=new URL(req.url,'http://localhost').searchParams.get('action')||'session';
      const methods=new Map([['session','GET'],['google','POST'],['logout','POST']]);
      const method=methods.get(action);
      if(!method)return json(res,404,{error:'Not found.'});
      if(req.method!==method){res.setHeader('Allow',method);return json(res,405,{error:'Method not allowed.'});}
      const config=configuration(env);
      if(!config)return json(res,action==='session'?200:503,action==='session'?{configured:false,user:null}:{error:'Google sign-in is not configured yet.'});
      const now=Math.floor(clock()/1000),jar=cookies(req);
      if(action==='session'){
        let challenge=readSigned(jar[cookieName('auth',config)],'challenge',config,now);
        if(!challenge){
          challenge={kind:'challenge',csrf:randomBytes(32).toString('base64url'),nonce:randomBytes(32).toString('base64url'),exp:now+CHALLENGE_SECONDS};
          setCookie(res,'auth',sign(challenge,config),CHALLENGE_SECONDS,config);
        }
        const session=readSigned(jar[cookieName('session',config)],'session',config,now);
        return json(res,200,{configured:true,clientId:config.clientId,origin:config.origin,csrf:challenge.csrf,nonce:challenge.nonce,user:session?.user||null,expiresAt:session?.exp||null});
      }
      if(req.headers.origin!==config.origin||req.headers['sec-fetch-site']==='cross-site')throw httpError(403,'Sign-in request came from a different website.');
      const challenge=readSigned(jar[cookieName('auth',config)],'challenge',config,now);
      if(!challenge||!equal(req.headers['x-csrf-token'],challenge.csrf))throw httpError(403,'Your sign-in request expired. Please try again.');
      if(action==='logout'){
        setCookie(res,'session','',0,config);setCookie(res,'auth','',0,config);
        return json(res,200,{ok:true});
      }
      const body=await readBody(req);
      if(typeof body.credential!=='string'||body.credential.length<20||body.credential.length>16000)throw httpError(400,'Missing or invalid Google credential.');
      let payload;
      try{payload=await verifyToken(body.credential,config.clientId);}catch{throw httpError(401,'Google could not verify this sign-in. Please try again.');}
      if(!payload||!equal(payload.nonce,challenge.nonce)||typeof payload.sub!=='string'||!payload.sub||payload.sub.length>255||typeof payload.email!=='string'||!payload.email||payload.email_verified!==true)throw httpError(401,'Google could not verify this sign-in. Please try again.');
      const user={id:payload.sub,email:payload.email.slice(0,254),name:typeof payload.name==='string'?payload.name.slice(0,120):payload.email.slice(0,120)};
      const expiresAt=now+SESSION_SECONDS;
      setCookie(res,'session',sign({kind:'session',user,exp:expiresAt},config),SESSION_SECONDS,config);
      // Consume the browser's challenge so the same login is not accepted again in this session.
      setCookie(res,'auth','',0,config);
      return json(res,200,{user,expiresAt});
    }catch(error){
      return json(res,error.status||500,{error:error.status?error.message:'Sign-in is temporarily unavailable. Please try again.'});
    }
  };
}

module.exports={createAuthHandler,verifyGoogleToken};
