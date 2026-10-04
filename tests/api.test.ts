import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { handle } from '../server/app.js';
const origin='https://tracker.example';
const db=new PGlite();
await db.exec(await readFile(new URL('../server/schema.sql',import.meta.url),'utf8'));
const sql={query:async(text:string,params:unknown[]=[]) => (await db.query(text,params)).rows as Record<string,unknown>[]};
let sequence=0;
async function call(action:string,body?:unknown,cookie='',headers:Record<string,string>={}) {
 const res=await handle(new Request(`${origin}/api/tracker?action=${action}`,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',cookie,...headers},body:body===undefined?undefined:JSON.stringify(body)}),sql,`test-${++sequence}`);
 return {res,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]??cookie};
}
test('server accounts, tracker persistence, ownership, records, leaderboard and logout',async()=>{
 const a=await call('signup',{username:'alice',password:'strong-pass',goal:'Get fit'}); assert.equal(a.res.status,201); assert.ok(a.cookie.includes('__Host-wa_session=')); assert.match(a.res.headers.get('set-cookie')!,/HttpOnly/);
 let state=(await call('state',undefined,a.cookie)).data; assert.equal(state.user.username,'alice'); assert.equal(state.user.goal,'Get fit');
 const today=new Date().toISOString().slice(0,10);
 const w=await call('workout',{date:today,type:'Gym',min:60,weight:75,note:'=test'},a.cookie); assert.equal(w.res.status,200); const id=w.data.logs[0].k;
 assert.equal(w.data.board.find((r:any)=>r.id==='alice').minutes,60);
 const b=await call('signup',{username:'bob',password:'strong-pass'}); assert.equal(b.res.status,201);
 assert.equal((await call('deleteWorkout',{id},b.cookie)).res.status,404);
 assert.equal((await call('state',undefined,b.cookie)).data.logs.length,0);
 state=(await call('targets',{weeklyGoal:3,calTarget:2000,proTarget:100},a.cookie)).data; assert.equal(state.user.weeklyGoal,3);
 state=(await call('meal',{date:today,label:'Lunch',cal:600,pro:30},a.cookie)).data; assert.equal(state.meals[0].cal,600);
 state=(await call('pr',{lift:'Squat',kg:100,date:today},a.cookie)).data; assert.equal(state.prs[0].kg,100);
 state=(await call('pr',{lift:'Squat',kg:90,date:today},a.cookie)).data; assert.equal(state.prs[0].kg,100);
 assert.equal((await call('goal',{goal:'New goal'},a.cookie)).data.user.goal,'New goal');
 const duplicate=await call('signup',{username:'ALICE',password:'strong-pass'}); assert.equal(duplicate.res.status,409);
 assert.equal((await call('login',{username:'alice',password:'bad-pass'})).res.status,401);
 const logged=await call('login',{username:'alice',password:'strong-pass'}); assert.equal(logged.res.status,200);
 assert.equal((await call('state',undefined,logged.cookie)).data.logs.length,1);
 assert.equal((await call('deleteWorkout',{id},a.cookie)).data.logs.length,0);
 assert.equal((await call('logout',{},a.cookie)).res.status,200); assert.equal((await call('state',undefined,a.cookie)).res.status,401);
 const rows=await sql.query('SELECT password_hash FROM winter_arc.users'); assert.ok(rows.every(r=>!String(r.password_hash).includes('strong-pass')));
 assert.ok(!JSON.stringify(state).includes('password_hash')); assert.ok(!JSON.stringify(state.board).includes('goal'));
});
test('validation, CSRF, database errors and expired sessions are safe',async()=>{
 const a=await call('signup',{username:'valid',password:'strong-pass'}); assert.equal(a.res.status,201);
 for(const body of [{date:'2099-01-01',type:'Gym',min:30},{date:'2026-02-30',type:'Gym',min:30},{date:'2026-01-01',type:'Gym',min:'30'},{date:'2026-01-01',type:'Gym',min:-1},{date:'2026-01-01',type:'Gym',min:30,userId:'alice'}]) assert.equal((await call('workout',body,a.cookie)).res.status,400);
 assert.equal((await call('targets',{weeklyGoal:8,calTarget:2000,proTarget:100},a.cookie)).res.status,400);
 assert.equal((await call('goal',{goal:'attack'},a.cookie,{origin:'https://evil.example'})).res.status,403);
 assert.equal((await call('goal',{goal:'attack'},a.cookie,{'content-type':'text/plain'})).res.status,415);
 assert.equal((await call('state',undefined,'__Host-wa_session=invalid')).res.status,401);
 await sql.query("UPDATE winter_arc.sessions SET expires_at=now()-interval '1 day'");
 assert.equal((await call('state',undefined,a.cookie)).res.status,401);
 const res=await handle(new Request(`${origin}/api/tracker?action=state`,{headers:{cookie:a.cookie}}),{query:async()=>{throw new Error('postgresql://PRIVATE_PASSWORD');}},'failure');
 assert.equal(res.status,503); assert.ok(!(await res.text()).includes('PRIVATE_PASSWORD'));
});
test('persistent auth rate limits and idempotent local data imports',async()=>{
 const request=()=>new Request(`${origin}/api/tracker?action=login`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({username:'missing',password:'bad-password'})});
 for(let i=0;i<10;i++) assert.equal((await handle(request(),sql,'same-ip')).status,401);
 assert.equal((await handle(request(),sql,'same-ip')).status,429);
 const a=await call('signup',{username:'importer',password:'strong-pass'});
 const body={goal:'Imported',targets:{weeklyGoal:4,calTarget:2000,proTarget:100},logs:[{k:'legacy-1',date:'2026-01-01',type:'Run',min:30,note:'Old',ts:1}],meals:[{date:'2026-01-01',label:'Meal',cal:500,pro:20,ts:2}],prs:[{lift:'Squat',kg:80,date:'2026-01-01'}]};
 const first=await call('import',body,a.cookie); assert.equal(first.res.status,200); assert.equal(first.data.logs.length,1);
 const second=await call('import',body,a.cookie); assert.equal(second.res.status,200); assert.equal(second.data.logs.length,1); assert.equal(second.data.meals.length,1);
});
test('imports use a bounded number of database round trips',async()=>{
 const a=await call('signup',{username:'bulk_user',password:'strong-pass'});
 let queries=0;const counted={query:async(text:string,params:unknown[]=[])=>{queries++;return sql.query(text,params);}};
 const input={logs:Array.from({length:8},(_,i)=>({k:'bulk-'+i,date:'2026-01-01',type:'Gym',min:30})),meals:[],prs:[]};
 const res=await handle(new Request(origin+'/api/tracker?action=import',{method:'POST',headers:{origin,cookie:a.cookie,'content-type':'application/json'},body:JSON.stringify(input)}),counted,'bulk-test');
 assert.equal(res.status,200);assert.ok(queries<=5,`Import made ${queries} database round trips`);
});
test('workouts cannot be logged after the client local date',async()=>{
 const a=await call('signup',{username:'date_user',password:'strong-pass'});
 const today=new Date().toISOString().slice(0,10),tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10);
 const req=new Request(origin+'/api/tracker?action=workout&today='+today,{method:'POST',headers:{origin,cookie:a.cookie,'content-type':'application/json'},body:JSON.stringify({date:tomorrow,type:'Gym',min:30})});
 assert.equal((await handle(req,sql,'date-test')).status,400);
});
