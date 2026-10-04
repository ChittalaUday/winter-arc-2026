import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { database } from '../server/database.js';
import { handle } from '../server/app.js';
const db=database(),tag=randomBytes(4).toString('hex'),names=['test_'+tag,'other_'+tag],ip='live-test-'+tag;
const origin='https://tracker.example',password=randomBytes(16).toString('hex');
async function call(action:string,body?:unknown,cookie=''){
 const res=await handle(new Request(origin+'/api/tracker?action='+action,{method:body===undefined?'GET':'POST',headers:{origin,cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),db,ip);
 return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]||cookie};
}
try {
 const a=await call('signup',{username:names[0],password,goal:'Test'});assert.equal(a.status,201);
 const b=await call('signup',{username:names[1],password});assert.equal(b.status,201);
 const today=new Date().toISOString().slice(0,10);
 const w=await call('workout',{date:today,type:'Gym',min:30,note:'Test'},a.cookie);assert.equal(w.status,200);const id=w.data.logs[0].k;
 assert.equal((await call('deleteWorkout',{id},b.cookie)).status,404);
 assert.equal((await call('targets',{weeklyGoal:3,calTarget:2000,proTarget:100},a.cookie)).status,200);
 assert.equal((await call('meal',{date:today,label:'Test',cal:500,pro:20},a.cookie)).status,200);
 assert.equal((await call('pr',{date:today,lift:'Squat',kg:80},a.cookie)).status,200);
 const login=await call('login',{username:names[0],password});assert.equal(login.status,200);assert.equal(login.data.logs.length,1);assert.equal(login.data.meals.length,1);assert.equal(login.data.prs.length,1);
 assert.equal((await call('logout',{},login.cookie)).status,200);assert.equal((await call('state',undefined,login.cookie)).status,401);
 console.log('Live Neon checks passed: authentication, persistence, workouts, meals, targets, records, ownership, logout.');
}catch{console.error('Live Neon checks failed. No credentials or database errors were printed.');process.exitCode=1;}
finally {
 try {for(const username of names)await db.query('DELETE FROM winter_arc.users WHERE username=$1',[username]);
  for(const key of ['ip:'+ip,...names.map(n=>'user:'+n)])await db.query('DELETE FROM winter_arc.rate_limits WHERE key=$1',[createHash('sha256').update(key).digest('hex')]);
  console.log('Disposable test accounts cleaned up.');
 }catch{console.error('Test cleanup failed. Only disposable test accounts may remain.');process.exitCode=1;}
}
