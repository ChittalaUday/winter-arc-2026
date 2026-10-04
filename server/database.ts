import { neon } from '@neondatabase/serverless';
import type { Database } from './app.js';
export function database():Database {
 const url=process.env.DATABASE_URL;
 if(!url)throw new Error('Database is not configured');
 return {query:async(text,params=[])=>{
  const sql=neon(url,{fetchOptions:{signal:AbortSignal.timeout(15000)}});
  return await sql.query(text,params) as Record<string,unknown>[];
 }};
}
