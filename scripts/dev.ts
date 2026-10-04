import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { serveAPI } from '../server/http.js';
createServer(async(req,res)=>{
 const url=new URL(req.url||'/', 'http://localhost');
 if(url.pathname==='/api/tracker'){await serveAPI(req,res);return;}
 if(url.pathname!=='/'&&url.pathname!=='/index.html'){res.writeHead(404);res.end('Not found');return;}
 res.writeHead(200,{'Content-Type':'text/html'});res.end(await readFile('index.html'));
}).listen(Number(process.env.PORT||8766),'127.0.0.1',()=>console.log('Tracker ready on http://127.0.0.1:8766'));
