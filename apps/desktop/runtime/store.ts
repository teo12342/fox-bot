import Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import type {Snapshot,SyncEvent} from '@foxbot/protocol';
const collections=['bots','conversations','messages','runs','tools','approvals','providers','skills','routines','memories','artifacts','devices'] as const;
export class Store {
 readonly db:Database.Database;
 constructor(file:string){
  mkdirSync(dirname(file),{recursive:true});this.db=new Database(file);this.db.pragma('journal_mode = WAL');this.db.pragma('foreign_keys = ON');
  this.db.exec(`CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY); CREATE TABLE IF NOT EXISTS entities(collection TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(collection,id)); CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,type TEXT NOT NULL,entity_id TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS commands(id TEXT PRIMARY KEY,result TEXT NOT NULL); CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(id UNINDEXED,collection UNINDEXED,text); INSERT OR IGNORE INTO migrations VALUES(1);`);
 }
 get<T=any>(collection:string,id:string):T|undefined {const r=this.db.prepare('SELECT data FROM entities WHERE collection=? AND id=?').get(collection,id) as any;return r?JSON.parse(r.data):undefined;}
 list<T=any>(collection:string):T[]{return (this.db.prepare('SELECT data FROM entities WHERE collection=? ORDER BY rowid').all(collection) as any[]).map(r=>JSON.parse(r.data));}
 put(collection:string,entity:{id:string;[key:string]:any}){
  this.db.prepare('INSERT INTO entities VALUES(?,?,?) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data').run(collection,entity.id,JSON.stringify(entity));
  this.db.prepare('DELETE FROM search WHERE id=? AND collection=?').run(entity.id,collection);
  if(['bots','messages','skills','memories'].includes(collection))this.db.prepare('INSERT INTO search(id,collection,text) VALUES(?,?,?)').run(entity.id,collection,[entity.name,entity.content,entity.text,entity.markdown,entity.role].filter(Boolean).join(' '));
 }
 delete(collection:string,id:string){this.db.prepare('DELETE FROM entities WHERE collection=? AND id=?').run(collection,id);this.db.prepare('DELETE FROM search WHERE collection=? AND id=?').run(collection,id);}
 event(type:string,entityId:string,data:unknown):SyncEvent {const createdAt=new Date().toISOString();const r=this.db.prepare('INSERT INTO events(type,entity_id,data,created_at) VALUES(?,?,?,?)').run(type,entityId,JSON.stringify(data),createdAt);return{version:1,seq:Number(r.lastInsertRowid),type,entityId,data,createdAt};}
 events(after:number):SyncEvent[]{return (this.db.prepare('SELECT * FROM events WHERE seq>? ORDER BY seq LIMIT 1000').all(after) as any[]).map(r=>({version:1,seq:r.seq,type:r.type,entityId:r.entity_id,data:JSON.parse(r.data),createdAt:r.created_at}));}
 snapshot():Snapshot {const s:any={version:1,seq:(this.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM events').get() as any).seq};for(const c of collections)s[c]=this.list(c);return s;}
 search(text:string){if(!text.trim())return[];return this.db.prepare('SELECT id,collection,text FROM search WHERE search MATCH ? ORDER BY rank LIMIT 50').all('"'+text.replaceAll('"','""')+'"');}
 cached(id:string){const r=this.db.prepare('SELECT result FROM commands WHERE id=?').get(id) as any;return r?JSON.parse(r.result):undefined;}
 cache(id:string,result:unknown){this.db.prepare('INSERT OR IGNORE INTO commands VALUES(?,?)').run(id,JSON.stringify(result));}
 transaction<T>(fn:()=>T):T{return this.db.transaction(fn)();}
 seed(){if(this.list('bots').length)return;const now=new Date().toISOString();const id=randomUUID();this.put('bots',{id,name:'Fox',avatar:'fox',role:'Your local teammate',instructions:'Complete tasks with evidence. Use tools when needed. Ask before external or destructive actions. Never expose secrets.',providerId:'',model:'',pinned:true,hidden:false,revision:1,createdAt:now});this.put('conversations',{id:randomUUID(),title:'Fox',botIds:[id],group:false,draft:'',updatedAt:now});this.put('skills',{id:randomUUID(),name:'Research brief',description:'Find evidence and deliver a concise source-backed brief.',markdown:'# Research brief\nFind authoritative sources, compare evidence, explain uncertainty, and return links. Ask before external changes.'});}
 close(){this.db.close();}
}
