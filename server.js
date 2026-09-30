const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const securityHeaders=require('./lib/security-headers');

const envFile=path.join(__dirname,'.env.local');
if(fs.existsSync(envFile))process.loadEnvFile(envFile);
const auth=require('./api/auth');
const notes=require('./api/notes');
const files=new Map([['/','index.html'],['/index.html','index.html'],['/app.js','app.js'],['/auth.js','auth.js'],['/cloud.js','cloud.js'],['/notifications.js','notifications.js'],['/notification-worker.js','notification-worker.js'],['/style.css','style.css']]);

const server=http.createServer(async(req,res)=>{
  for(const [name,value] of Object.entries(securityHeaders))res.setHeader(name,value);
  const pathname=req.url.split('?')[0];
  if(pathname==='/api/auth')return auth(req,res);
  if(pathname==='/api/notes')return notes(req,res);
  const file=files.get(pathname);
  if(!file){res.writeHead(404);return res.end('Not found');}
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});return res.end('Method not allowed');}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');
  if(req.method==='HEAD')return res.end();
  const stream=fs.createReadStream(path.join(__dirname,file));
  stream.on('error',()=>{if(!res.headersSent)res.writeHead(500);res.end('Could not load this file');});
  stream.pipe(res);
});

if(require.main===module){
  const port=Number(process.env.PORT)||3000;
  server.listen(port,'127.0.0.1',()=>console.log(`Ticky Track: http://localhost:${port}`));
}
module.exports=server;
