const http = require('http');
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'public');
const mime = { '.html':'text/html', '.css':'text/css', '.js':'application/javascript', '.webmanifest':'application/manifest+json', '.png':'image/png' };
http.createServer((req,res)=>{
  let p = req.url.split('?')[0];
  if(p==='/') p='/index.html';
  const fp = path.join(dir, p);
  fs.readFile(fp,(e,b)=>{
    if(e){ res.writeHead(404); return res.end('nf'); }
    res.writeHead(200,{'Content-Type': mime[path.extname(fp)] || 'application/octet-stream'});
    res.end(b);
  });
}).listen(4055, ()=>console.log('preview on 4055'));
