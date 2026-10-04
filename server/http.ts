import type { IncomingMessage, ServerResponse } from 'node:http';
import { handle } from './app.js';
import { database } from './database.js';
import type { Database } from './app.js';
export function createAPIHandler(getDatabase:()=>Database=database){
return async function(req:IncomingMessage & {body?:unknown},res:ServerResponse){
 try {
  const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(value)headers.set(key,Array.isArray(value)?value.join(','):value);
  const host=req.headers.host||'localhost',protocol=process.env.VERCEL?'https':'http';
  let body:string|undefined;
  if(req.method!=='GET'&&req.method!=='HEAD'){
   if(req.body!==undefined) body=typeof req.body==='string'?req.body:JSON.stringify(req.body);
   else{const chunks:Buffer[]=[];let size=0;for await(const part of req){const chunk=Buffer.from(part);size+=chunk.length;if(size>262144){res.writeHead(413,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Request is too large.'}));return;}chunks.push(chunk);}body=Buffer.concat(chunks).toString();}
  }
  const request=new Request(`${protocol}://${host}${req.url}`,{method:req.method,headers,body});
  const ip=process.env.VERCEL?(req.headers['x-forwarded-for']?.toString().split(',')[0].trim()||'unknown'):(req.socket.remoteAddress||'local');
  const response=await handle(request,getDatabase(),ip);
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
 }catch{res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'Service unavailable. Check the server configuration.'}));}
}

}
export const serveAPI=createAPIHandler();
