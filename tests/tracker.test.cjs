const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const source = fs.readFileSync('index.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function setup(storage = new Map()) {
  const elements = new Map(), alerts = [], downloads = [];
  const element = id => {
    if(!elements.has(id)) elements.set(id,{id,value:'',hidden:false,style:{},dataset:{},handlers:{},textContent:'',innerHTML:'',addEventListener(type,fn){this.handlers[type]=fn;},scrollIntoView(){},click(){downloads.push(this.download);},remove(){}});
    return elements.get(id);
  };
  const localStorage = {getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};
  const context = vm.createContext({document:{getElementById:element,documentElement:{dataset:{}},activeElement:null,createElement:()=>element('download'),body:{appendChild(){}}},localStorage,sessionStorage:localStorage,crypto:webcrypto,TextEncoder,Uint8Array,atob,btoa,Date,console,Blob,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},setTimeout,queueMicrotask,matchMedia:()=>({matches:false}),alert:m=>alerts.push(m),prompt:()=> 'New goal',addEventListener(){}});
  context.window=context;
  vm.runInContext(source,context);
  async function submit(id,values) { for(const [key,value] of Object.entries(values)) element(key).value=String(value); await element(id).handlers.submit({preventDefault(){}}); await new Promise(r=>setImmediate(r)); }
  return {context,element,storage,alerts,downloads,submit,run:s=>vm.runInContext(s,context)};
}
test('signup, login, persistence, tracker features, isolation and CSV work without Claude',async()=>{
 const a=setup();
 a.element('tSign').onclick();
 await a.submit('af',{u:'Tester',p:'password',g:'Get fit'});
 assert.equal(a.run('cur'),'tester',a.element('err').textContent);
 assert.equal(a.element('app').hidden,false);
 assert.equal(a.element('pGoal').textContent,'Goal: Get fit');
 const today=a.run('iso(new Date())');
 await a.submit('f',{d:today,t:'Gym',m:60,w:75,n:'=test'});
 assert.equal(a.run('stats().sessions'),1);
 assert.equal(a.run('stats().streak'),1);
 await a.submit('tf',{tw:3,tc:2000,tp:100});
 await a.submit('mf',{ml:'Lunch',mc:600,mp:30});
 assert.match(a.element('fuel').innerHTML,/600 \/ 2000/);
 await a.submit('prf',{pl:'Squat',pk:100});
 await a.submit('prf',{pl:'Squat',pk:90});
 assert.equal(a.run('prs[0].kg'),100);
 await a.element('editG').onclick();
 assert.equal(a.element('pGoal').textContent,'Goal: New goal');
 await a.element('exp').handlers.click();
 assert.deepEqual(a.downloads,['winter-arc-tester.csv']);
 a.element('theme').onclick();
 const b=setup(a.storage); await new Promise(r=>setImmediate(r));
 assert.equal(b.run('cur'),'tester'); assert.equal(b.run('logs.length'),1);
 assert.equal(b.context.document.documentElement.dataset.theme,'light');
 b.element('out').onclick(); b.element('tSign').onclick();
 await b.submit('af',{u:'tester',p:'password'});
 assert.match(b.element('err').textContent,/taken/);
 await b.submit('af',{u:'second',p:'password',g:''});
 assert.equal(b.run('logs.length'),0); assert.equal(b.run('meals.length'),0); assert.equal(b.run('prs.length'),0);
 assert.equal(b.run('boardRows.length'),2);
 b.element('lb').handlers.click({target:{closest:()=>({dataset:{id:'tester'}})}});
 assert.equal(b.element('cmp').hidden,false);
 b.element('out').onclick(); b.element('tLogin').onclick();
 await b.submit('af',{u:'tester',p:'wrong'}); assert.equal(b.run('cur'),null);
 await b.submit('af',{u:'tester',p:'password'}); assert.equal(b.run('logs.length'),1);
 const key=b.run('logs[0].k');
 await b.element('logs').handlers.click({target:{dataset:{k:key}}});
 assert.equal(b.run('logs.length'),0); assert.equal(b.run('stats().streak'),0);
 assert.equal(b.alerts.length,0);
 const records=JSON.parse(a.storage.get('wa_data_v1'));
 assert.ok(records['accounts/tester'].hash); assert.ok(records['accounts/tester'].salt);
 assert.ok(!JSON.stringify(records).includes('password'));
});
test('invalid credentials and unavailable or corrupt storage produce errors',async()=>{
 const a=setup(); a.element('tSign').onclick();
 await a.submit('af',{u:'bad user',p:'password'}); assert.equal(a.run('cur'),null);
 await a.submit('af',{u:'valid',p:'a'}); assert.equal(a.run('cur'),null);
 const b=setup(new Map([['wa_data_v1','{bad json']]));
 await new Promise(r=>setImmediate(r));
 assert.ok(b.element('err').textContent); assert.equal(b.storage.get('wa_data_v1'),'{bad json');
});
test('storage write failures do not claim to save a workout',async()=>{
 const a=setup(); a.element('tSign').onclick();
 await a.submit('af',{u:'tester',p:'password'});
 const write=a.context.localStorage.setItem;
 a.context.localStorage.setItem=()=>{throw new Error('Quota exceeded');};
 await a.submit('f',{d:a.run('iso(new Date())'),t:'Gym',m:30,w:'',n:''});
 assert.equal(a.run('logs.length'),0); assert.match(a.alerts[0],/Could not save/);
 a.context.localStorage.setItem=write;
});
test('future workouts are rejected and multiple same-day workouts remain distinct',async()=>{
 const a=setup(); a.element('tSign').onclick(); await a.submit('af',{u:'tester',p:'password'});
 await a.submit('f',{d:'2099-01-01',t:'Gym',m:30,w:'',n:''}); assert.equal(a.run('logs.length'),0);
 for(let i=0;i<2;i++) await a.submit('f',{d:a.run('iso(new Date())'),t:'Gym',m:30,w:'',n:''});
 assert.equal(a.run('logs.length'),2); assert.equal(a.run('stats().active'),1); assert.equal(a.run('stats().mins'),60);
});
