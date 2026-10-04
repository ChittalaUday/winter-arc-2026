import { readFile } from 'node:fs/promises';
import { database } from '../server/database.js';
try {
 const db=database();const sql=await readFile(new URL('../server/schema.sql',import.meta.url),'utf8');
 for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.query(statement);
 console.log('Database schema is ready.');
}catch{console.error('Database migration failed. Verify DATABASE_URL, permissions and network connectivity.');process.exitCode=1;}
