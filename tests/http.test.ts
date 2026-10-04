import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createAPIHandler} from '../server/http.js';
test('HTTP adapter handles real signup, cookie sessions, CSRF and body limits',async()=>{
 const db=new PGlite();await db.exec(await readFile('server/schema.sql','utf8'));
 const server=createServer(createAPIHandler(()=>({query:async(text,params=[]) => (await db.query(text,params)).rows as Record<string,unknown>[]})));
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');const origin=`http://127.0.0.1:${address.port}`;
 try{
  const signup=await fetch(origin+'/api/tracker?action=signup',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({username:'http_user',password:'strong-pass'})});
  assert.equal(signup.status,201);const cookie=signup.headers.get('set-cookie')!.split(';')[0];assert.match(signup.headers.get('set-cookie')!,/Secure/);
  const state=await fetch(origin+'/api/tracker?action=state',{headers:{cookie}});assert.equal(state.status,200);assert.equal((await state.json()).user.username,'http_user');
  const csrf=await fetch(origin+'/api/tracker?action=goal',{method:'POST',headers:{cookie,origin:'https://evil.example','content-type':'application/json'},body:'{"goal":"bad"}'});assert.equal(csrf.status,403);
  const huge=await fetch(origin+'/api/tracker?action=goal',{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify({goal:'x'.repeat(262144)})});assert.equal(huge.status,413);
 }finally{server.close();await once(server,'close');await db.close();}
});
