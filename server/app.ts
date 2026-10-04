import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
export interface Database { query(text: string, params?: unknown[]): Promise<Record<string, unknown>[]> }
const derive = promisify(scrypt);
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const cookieName = '__Host-wa_session';
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z'); return Number.isFinite(+d) && d.toISOString().slice(0,10)===v;},'Invalid date').refine(v=>v<=new Date(Date.now()+86400000).toISOString().slice(0,10),'Future date');
const username=z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,20}$/);
const password=z.string().min(8).max(64);
const goal=z.string().trim().max(60);
const credentials=z.object({username,password,goal:goal.optional()}).strict();
const targets=z.object({weeklyGoal:z.number().int().min(0).max(7),calTarget:z.number().int().refine(v=>v===0 || v>=500&&v<=10000),proTarget:z.number().int().refine(v=>v===0 || v>=10&&v<=500)}).strict();
const workout=z.object({date,type:z.enum(['Gym','Run','Walk','Yoga','Sports','Cycling','Home workout']),min:z.number().int().min(1).max(600),weight:z.number().min(20).max(400).optional(),note:z.string().trim().max(80).default('')}).strict();
const meal=z.object({date,label:z.string().trim().max(40).default(''),cal:z.number().int().min(0).max(5000),pro:z.number().int().min(0).max(300)}).strict();
const pr=z.object({lift:z.enum(['Bench press','Squat','Deadlift','Overhead press','Pull-up (+kg)']),kg:z.number().min(1).max(700),date}).strict();
const importBody=z.object({goal:goal.optional(),targets:targets.optional(),logs:z.array(workout.extend({k:z.string().min(1).max(100),ts:z.number().finite().optional()})).max(1000),meals:z.array(meal.extend({ts:z.number().finite().optional()})).max(1000),prs:z.array(pr).max(5)}).strict();
class HttpError extends Error { constructor(readonly status:number,message:string){super(message);} }
function json(data:unknown,status=200,headers:Record<string,string>={}){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});}
function cookie(token:string,maxAge=2592000){return `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;}
async function hashPassword(value:string){const salt=randomBytes(16).toString('hex');const key=await derive(value,salt,64) as Buffer;return `${salt}:${key.toString('hex')}`;}
async function verifyPassword(value:string,stored:string){const [salt,key]=stored.split(':');if(!salt||!key)return false;const actual=await derive(value,salt,64) as Buffer;const expected=Buffer.from(key,'hex');return expected.length===actual.length&&timingSafeEqual(expected,actual);}
const dummyHash=hashPassword(randomBytes(32).toString('hex'));
async function rateLimit(db:Database,ip:string,user:string){
 await db.query('DELETE FROM winter_arc.rate_limits WHERE expires_at<now()');
 for(const [key,limit] of [[digest('ip:'+ip),10],[digest('user:'+user),50]] as const){
  const [row]=await db.query(`INSERT INTO winter_arc.rate_limits(key,hits,expires_at) VALUES($1,1,now()+interval '15 minutes')
    ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN winter_arc.rate_limits.expires_at<now() THEN 1 ELSE winter_arc.rate_limits.hits+1 END,
    expires_at=CASE WHEN winter_arc.rate_limits.expires_at<now() THEN now()+interval '15 minutes' ELSE winter_arc.rate_limits.expires_at END RETURNING hits`,[key]);
  if(Number(row.hits)>limit)throw new HttpError(429,'Too many attempts. Try again in 15 minutes.');
 }
}
async function session(db:Database,req:Request){
 const match=(req.headers.get('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName+'='));
 const token=match?.slice(cookieName.length+1)??'';
 if(!/^[a-f0-9]{64}$/.test(token))throw new HttpError(401,'Please log in.');
 const [row]=await db.query('SELECT user_id FROM winter_arc.sessions WHERE token_hash=$1 AND expires_at>now()',[digest(token)]);
 if(!row)throw new HttpError(401,'Your session expired. Please log in.');
 return {userId:String(row.user_id),tokenHash:digest(token)};
}
async function issueSession(db:Database,userId:string){
 const token=randomBytes(32).toString('hex');
 await db.query('DELETE FROM winter_arc.sessions WHERE expires_at<now()');
 await db.query("INSERT INTO winter_arc.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 days')",[digest(token),userId]);
 return cookie(token);
}
async function state(db:Database,userId:string,today:string){
 const [row]=await db.query(`SELECT json_build_object('user',json_build_object('username',u.username,'goal',u.goal,'weeklyGoal',coalesce(t.weekly_goal,0),'calTarget',coalesce(t.cal_target,0),'proTarget',coalesce(t.pro_target,0)),
 'logs',coalesce((SELECT json_agg(json_build_object('k',id,'date',date::text,'type',type,'min',minutes,'weight',weight,'note',note,'ts',extract(epoch from created_at)*1000) ORDER BY date,created_at) FROM winter_arc.workouts WHERE user_id=u.id),'[]'::json),
 'meals',coalesce((SELECT json_agg(json_build_object('date',date::text,'label',label,'cal',calories,'pro',protein,'ts',extract(epoch from created_at)*1000)) FROM winter_arc.meals WHERE user_id=u.id),'[]'::json),
 'prs',coalesce((SELECT json_agg(json_build_object('k',trim(both '-' from regexp_replace(lower(lift),'[^a-z]+','-','g')),'lift',lift,'kg',kg,'date',date::text)) FROM winter_arc.personal_records WHERE user_id=u.id),'[]'::json)) AS state
 FROM winter_arc.users u LEFT JOIN winter_arc.targets t ON t.user_id=u.id WHERE u.id=$1`,[userId]);
 if(!row)throw new HttpError(401,'Please log in.');
 const board=await db.query(`WITH days AS (SELECT DISTINCT user_id,date FROM winter_arc.workouts WHERE date<=$1::date),
 ranked AS (SELECT user_id,date,row_number() OVER(PARTITION BY user_id ORDER BY date DESC) AS rn,max(date) OVER(PARTITION BY user_id) AS anchor FROM days),
 streaks AS (SELECT user_id,count(*)::integer AS streak FROM ranked WHERE anchor >= $1::date-1 AND date=anchor-(rn-1)::integer GROUP BY user_id)
 SELECT u.username AS id,count(w.id)::integer AS sessions,coalesce(sum(w.minutes),0)::integer AS minutes,count(DISTINCT w.date)::integer AS active,coalesce(s.streak,0)::integer AS streak
 FROM winter_arc.users u LEFT JOIN winter_arc.workouts w ON w.user_id=u.id AND w.date<=$1::date LEFT JOIN streaks s ON s.user_id=u.id
 GROUP BY u.id,u.username,s.streak ORDER BY active DESC,minutes DESC,u.username LIMIT 100`,[today]);
 return {...row.state as Record<string,unknown>,board};
}
async function saveWorkout(db:Database,userId:string,input:z.infer<typeof workout>,importKey:string|null=null){
 await db.query(`INSERT INTO winter_arc.workouts(id,user_id,date,type,minutes,weight,note,import_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(user_id,import_key) DO NOTHING`,[randomUUID(),userId,input.date,input.type,input.min,input.weight??null,input.note,importKey]);
}
async function saveMeal(db:Database,userId:string,input:z.infer<typeof meal>,importKey:string|null=null){
 await db.query('INSERT INTO winter_arc.meals(id,user_id,date,label,calories,protein,import_key) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,import_key) DO NOTHING',[randomUUID(),userId,input.date,input.label,input.cal,input.pro,importKey]);
}
async function savePR(db:Database,userId:string,input:z.infer<typeof pr>){
 await db.query(`INSERT INTO winter_arc.personal_records(user_id,lift,kg,date) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,lift) DO UPDATE SET kg=excluded.kg,date=excluded.date WHERE excluded.kg>winter_arc.personal_records.kg`,[userId,input.lift,input.kg,input.date]);
}
async function saveTargets(db:Database,userId:string,input:z.infer<typeof targets>){
 await db.query(`INSERT INTO winter_arc.targets(user_id,weekly_goal,cal_target,pro_target) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET weekly_goal=excluded.weekly_goal,cal_target=excluded.cal_target,pro_target=excluded.pro_target`,[userId,input.weeklyGoal,input.calTarget,input.proTarget]);
}
export async function handle(req:Request,db:Database,ip:string){
 try {
  const url=new URL(req.url),action=url.searchParams.get('action')??'state';
  const today=date.parse(url.searchParams.get('today')??new Date().toISOString().slice(0,10));
  const utcDay=new Date().toISOString().slice(0,10);
  if(Math.abs(Date.parse(today)-Date.parse(utcDay))>86400000)throw new HttpError(400,'Invalid current date.');
  const pastDate=<T extends {date:string}>(input:T):T=>{if(input.date>today)throw new HttpError(400,'Choose today or an earlier date.');return input;};
  if(req.method!=='GET'&&req.method!=='POST')throw new HttpError(405,'Method not allowed.');
  if(req.method==='GET'&&action!=='state')throw new HttpError(405,'Use POST for this action.');
  let body:unknown;
  if(req.method==='POST'){
   if(req.headers.get('origin')!==(process.env.APP_ORIGIN||url.origin))throw new HttpError(403,'Request origin is not allowed.');
   if(req.headers.get('content-type')?.split(';')[0]!=='application/json')throw new HttpError(415,'Use application/json.');
   const text=await req.text();if(Buffer.byteLength(text)>262144)throw new HttpError(413,'Request is too large.');
   try{body=JSON.parse(text);}catch{throw new HttpError(400,'Invalid JSON.');}
  }
  if(action==='signup'||action==='login'){
   const input=credentials.parse(body);await rateLimit(db,ip,input.username);
   let userId:string;
   if(action==='signup'){
    userId=randomUUID();const hash=await hashPassword(input.password);
    const rows=await db.query('INSERT INTO winter_arc.users(id,username,password_hash,goal) VALUES($1,$2,$3,$4) ON CONFLICT(username) DO NOTHING RETURNING id',[userId,input.username,hash,input.goal??'']);
    if(!rows.length)throw new HttpError(409,'That username is taken.');
   }else{
    const [row]=await db.query('SELECT id,password_hash FROM winter_arc.users WHERE username=$1',[input.username]);
    const valid=await verifyPassword(input.password,row?String(row.password_hash):await dummyHash);
    if(!row||!valid)throw new HttpError(401,'Wrong username or password.');userId=String(row.id);
   }
   return json(await state(db,userId,today),action==='signup'?201:200,{'Set-Cookie':await issueSession(db,userId)});
  }
  const auth=await session(db,req),userId=auth.userId;
  if(action==='logout'){
   await db.query('DELETE FROM winter_arc.sessions WHERE token_hash=$1',[auth.tokenHash]);return json({ok:true},200,{'Set-Cookie':cookie('',0)});
  }
  if(action==='goal'){const input=z.object({goal}).strict().parse(body);await db.query('UPDATE winter_arc.users SET goal=$1 WHERE id=$2',[input.goal,userId]);}
  else if(action==='targets')await saveTargets(db,userId,targets.parse(body));
  else if(action==='workout')await saveWorkout(db,userId,pastDate(workout.parse(body)));
  else if(action==='deleteWorkout'){
   const {id}=z.object({id:z.uuid()}).strict().parse(body);
   const rows=await db.query('DELETE FROM winter_arc.workouts WHERE id=$1 AND user_id=$2 RETURNING id',[id,userId]);if(!rows.length)throw new HttpError(404,'Workout not found.');
  }
  else if(action==='meal')await saveMeal(db,userId,pastDate(meal.parse(body)));
  else if(action==='pr')await savePR(db,userId,pastDate(pr.parse(body)));
  else if(action==='import'){
   const input=importBody.parse(body);
   [...input.logs,...input.meals,...input.prs].forEach(pastDate);
   const payload={...input,logs:input.logs.map(item=>({...item,id:randomUUID(),importKey:'local:'+item.k})),
    meals:input.meals.map(item=>({...item,id:randomUUID(),importKey:'local:'+digest(JSON.stringify(item))}))};
   // One atomic statement imports the entire batch; retries cannot duplicate records.
   await db.query(`WITH imported_workouts AS (
    INSERT INTO winter_arc.workouts(id,user_id,date,type,minutes,weight,note,import_key)
    SELECT id::uuid,$1::uuid,date::date,type,min,weight,note,"importKey" FROM jsonb_to_recordset($2::jsonb->'logs')
    AS x(id text,date text,type text,min integer,weight double precision,note text,"importKey" text)
    ON CONFLICT(user_id,import_key) DO NOTHING
   ), imported_meals AS (
    INSERT INTO winter_arc.meals(id,user_id,date,label,calories,protein,import_key)
    SELECT id::uuid,$1::uuid,date::date,label,cal,pro,"importKey" FROM jsonb_to_recordset($2::jsonb->'meals')
    AS x(id text,date text,label text,cal integer,pro integer,"importKey" text)
    ON CONFLICT(user_id,import_key) DO NOTHING
   ), imported_prs AS (
    INSERT INTO winter_arc.personal_records(user_id,lift,kg,date)
    SELECT $1::uuid,lift,kg,date::date FROM (SELECT DISTINCT ON(lift) lift,kg,date FROM jsonb_to_recordset($2::jsonb->'prs') AS x(lift text,kg double precision,date text) ORDER BY lift,kg DESC,date DESC) best
    ON CONFLICT(user_id,lift) DO UPDATE SET kg=excluded.kg,date=excluded.date WHERE excluded.kg>winter_arc.personal_records.kg
   ), imported_targets AS (
    INSERT INTO winter_arc.targets(user_id,weekly_goal,cal_target,pro_target)
    SELECT $1::uuid,(t->>'weeklyGoal')::integer,(t->>'calTarget')::integer,(t->>'proTarget')::integer FROM (SELECT $2::jsonb->'targets' AS t) value WHERE t IS NOT NULL
    ON CONFLICT(user_id) DO UPDATE SET weekly_goal=excluded.weekly_goal,cal_target=excluded.cal_target,pro_target=excluded.pro_target
   ) UPDATE winter_arc.users SET goal=coalesce($2::jsonb->>'goal',goal) WHERE id=$1::uuid`,[userId,JSON.stringify(payload)]);
  }
  else if(action!=='state')throw new HttpError(404,'Unknown action.');
  else if(req.method!=='GET')throw new HttpError(405,'Use GET for state.');
  return json(await state(db,userId,today));
 }catch(e){
  if(e instanceof HttpError)return json({error:e.message},e.status,e.status===429?{'Retry-After':'900'}:{});
  if(e instanceof z.ZodError)return json({error:'Invalid input. Check the entered values.'},400);
  // Database/driver errors may contain credentials: never serialize or log them.
  return json({error:'Service unavailable. Please try again later.'},503);
 }
}
