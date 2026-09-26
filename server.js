const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const files = {'/':'index.html','/index.html':'index.html','/app.js':'app.js','/style.css':'style.css'};
http.createServer((req,res)=>{const file=files[req.url.split('?')[0]]; if(!file){res.writeHead(404);return res.end('Not found');} res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"); fs.createReadStream(path.join(__dirname,file)).pipe(res);}).listen(3000,'127.0.0.1',()=>console.log('Ticky Track: http://localhost:3000'));
