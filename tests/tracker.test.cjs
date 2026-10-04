const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('index.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
async function setup(shared) {
 const {PGlite}=await import('@electric-sql/pglite'); const {handle}=await import('../server/app.ts');
 if(!shared){ const db=new PGlite();await db.exec(fs.readFileSync('server/schema.sql','utf8'));shared={db,cookie:'',storage:new Map()}; }
 const sql={query:async(text,params=[]) => (await shared.db.query(text,params)).rows};
 const elements=new Map(), alerts=[], downloads=[], blobs=[], pending=[];
 const element=id=>{if(!elements.has(id))elements.set(id,{id,value:'',hidden:false,style:{},dataset:{},handlers:{},textContent:'',innerHTML:'',addEventListener(type,fn){this.handlers[type]=fn;},scrollIntoView(){},click(){downloads.push(this.download);},remove(){}});return elements.get(id);};
 const localStorage={getItem:k=>shared.storage.get(k)??null,setItem:(k,v)=>shared.storage.set(k,String(v)),removeItem:k=>shared.storage.delete(k)};
 const context=vm.createContext({document:{getElementById:element,documentElement:{dataset:{}},activeElement:null,createElement:()=>element('download'),body:{appendChild(){}}},localStorage,TextEncoder,Uint8Array,Date,console,Blob,URL:{createObjectURL:blob=>{blobs.push(blob);return 'blob:test';},revokeObjectURL(){}},setTimeout,matchMedia:()=>({matches:false}),alert:m=>alerts.push(m),prompt:()=> 'New goal',fetch:(path,opts={})=>{
  const promise=handle(new Request('https://tracker.example'+path,{...opts,headers:{...opts.headers,origin:'https://tracker.example',cookie:shared.cookie}}),sql,'frontend-test').then(res=>{const cookie=res.headers.get('set-cookie');if(cookie)shared.cookie=cookie.split(';')[0];return res;});pending.push(promise);return promise;
 }});
 context.window=context;vm.runInContext(source,context);
 async function settle(){await Promise.all(pending);await new Promise(r=>setImmediate(r));}
 await settle();
 async function submit(id,values){for(const [key,value]of Object.entries(values))element(key).value=String(value);await element(id).handlers.submit({preventDefault(){}});await settle();}
 return {context,element,shared,alerts,downloads,blobs,submit,settle,run:s=>vm.runInContext(s,context)};
}
test('existing forms use server accounts and preserve all tracker flows',async()=>{
 const a=await setup();a.element('tSign').onclick();await a.submit('af',{u:'Tester',p:'password',g:'Get fit'});
 assert.equal(a.run('cur'),'tester',a.element('err').textContent);assert.equal(a.element('app').hidden,false);assert.equal(a.element('pGoal').textContent,'Goal: Get fit');
 const today=a.run('iso(new Date())');await a.submit('f',{d:today,t:'Gym',m:60,w:75,n:'=test'});
 assert.equal(a.run('stats().sessions'),1);assert.equal(a.run('stats().streak'),1);
 await a.submit('tf',{tw:3,tc:2000,tp:100});await a.submit('mf',{ml:'Lunch',mc:600,mp:30});assert.match(a.element('fuel').innerHTML,/600 \/ 2000/);
 await a.submit('prf',{pl:'Squat',pk:100});await a.submit('prf',{pl:'Squat',pk:90});assert.equal(a.run('prs[0].kg'),100);
 await a.element('editG').onclick();assert.equal(a.element('pGoal').textContent,'Goal: New goal');
 await a.element('exp').handlers.click();assert.deepEqual(a.downloads,['winter-arc-tester.csv']);assert.match(await a.blobs[0].text(),/'=test/);
 a.element('theme').onclick();const b=await setup(a.shared);assert.equal(b.run('cur'),'tester');assert.equal(b.run('logs.length'),1);assert.equal(b.context.document.documentElement.dataset.theme,'light');
 await b.element('out').onclick();b.element('tSign').onclick();await b.submit('af',{u:'tester',p:'password'});assert.match(b.element('err').textContent,/taken/);
 await b.submit('af',{u:'second',p:'password',g:''});assert.equal(b.run('logs.length'),0);assert.equal(b.run('meals.length'),0);assert.equal(b.run('prs.length'),0);assert.equal(b.run('boardRows.length'),2);
 b.element('lb').handlers.click({target:{closest:()=>({dataset:{id:'tester'}})}});assert.equal(b.element('cmp').hidden,false);
 await b.element('out').onclick();b.element('tLogin').onclick();await b.submit('af',{u:'tester',p:'wrong-pass'});assert.equal(b.run('cur'),null);
 await b.submit('af',{u:'tester',p:'password'});assert.equal(b.run('logs.length'),1);
 const key=b.run('logs[0].k');await b.element('logs').handlers.click({target:{dataset:{k:key}}});assert.equal(b.run('logs.length'),0);assert.equal(b.run('stats().streak'),0);assert.equal(b.alerts.length,0);
 assert.equal(a.shared.storage.has('wa_user'),false);assert.equal(a.shared.storage.has('wa_data_v1'),false);await a.shared.db.close();
});
test('browser data import does not transmit legacy passwords or erase local records',async()=>{
 const a=await setup();const original={'accounts/old':{hash:'DO_NOT_TRANSMIT',salt:'PRIVATE',goal:'Old goal'},'logs/old/entries/session':{date:'2026-01-01',type:'Gym',min:30,note:'Old',ts:1}};
 a.shared.storage.set('wa_data_v1',JSON.stringify(original));const b=await setup(a.shared);b.element('tSign').onclick();await b.submit('af',{u:'importer',p:'password',g:''});assert.equal(b.element('localImport').hidden,false);
 b.element('importUser').value='old';await b.element('importLocal').onclick();assert.equal(b.run('logs.length'),1);assert.equal(b.element('pGoal').textContent,'Goal: Old goal');assert.equal(b.shared.storage.get('wa_data_v1'),JSON.stringify(original));
 await b.element('importLocal').onclick();assert.equal(b.run('logs.length'),1);await a.shared.db.close();
});
test('frontend validates credentials and displays unavailable server errors',async()=>{
 const a=await setup();a.element('tSign').onclick();await a.submit('af',{u:'bad user',p:'password'});assert.equal(a.run('cur'),null);assert.match(a.element('err').textContent,/Username/);
 await a.submit('af',{u:'valid',p:'a'});assert.match(a.element('err').textContent,/8 characters/);
 a.context.fetch=async()=>new Response(JSON.stringify({error:'Service unavailable.'}),{status:503});await a.submit('af',{u:'valid',p:'password'});assert.equal(a.run('cur'),null);assert.match(a.element('err').textContent,/unavailable/);await a.shared.db.close();
});
