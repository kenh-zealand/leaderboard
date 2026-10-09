import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
export class SQLiteD1{
 constructor(filename=':memory:'){
  this.sql=new DatabaseSync(filename);
  this.sql.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  for(const name of fs.readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort()){
   this.sql.exec('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)');
   if(!this.sql.prepare('SELECT name FROM local_migrations WHERE name=?').get(name)){
    this.sql.exec(fs.readFileSync('drizzle/'+name,'utf8'));
    this.sql.prepare('INSERT INTO local_migrations VALUES (?)').run(name);
   }
  }
 }
 prepare(sql){
  const database=this;
  return {bind(...args){return {
   async first(){return database.sql.prepare(sql).get(...args)||null;},
   async all(){return {results:database.sql.prepare(sql).all(...args)};},
   async run(){return this.runSync();},
   runSync(){const r=database.sql.prepare(sql).run(...args);return {success:true,meta:{changes:Number(r.changes)}};}
  };}};
 }
 async batch(statements){
  this.sql.exec('BEGIN IMMEDIATE');
  try{const result=statements.map(s=>s.runSync());this.sql.exec('COMMIT');return result;}
  catch(e){this.sql.exec('ROLLBACK');throw e;}
 }
 close(){this.sql.close();}
}
