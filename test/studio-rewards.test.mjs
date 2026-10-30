import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
async function setup(){
 const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE treasure_drops(id INTEGER PRIMARY KEY,title TEXT,status TEXT);CREATE TABLE tin_users(id INTEGER PRIMARY KEY,email TEXT);CREATE TABLE claims(id INTEGER PRIMARY KEY,user_id INTEGER,drop_id INTEGER,status TEXT);INSERT INTO treasure_drops VALUES(1,'Studio treasure','active');INSERT INTO tin_users VALUES(1,'alice@example.test'),(2,'bob@example.test');INSERT INTO claims VALUES(1,1,1,'claimed');");
 db.exec(await readFile(new URL('../migrations/0015_personal_studio_rewards.sql',import.meta.url),'utf8'));
 const env={DB:{prepare(sql){
  const bind=(...args)=>{const s=db.prepare(sql);return{first:async()=>s.get(...args)||null,all:async()=>({results:s.all(...args)}),run:async()=>s.run(...args)}};
  return {...bind(),bind};
 }}};
 const context=vm.createContext({Response,Request,Number,String,JSON});
 const bad=(message,status)=>{throw Object.assign(Error(message),{status})};
 function stub(values){return new vm.SyntheticModule(Object.keys(values),function(){for(const[k,v]of Object.entries(values))this.setExport(k,v)},{context})}
 const imports={
 './auth.js':stub({requireRole:(u,role)=>{if(!u||u.role!==role)bad('Not allowed',403)},verifyTinTicket:async(e,t,p)=>p==='studio-claims'&&t==='alice-ticket'?{email:'alice@example.test'}:p==='studio-claims'&&t==='bob-ticket'?{email:'bob@example.test'}:null}),
 './lib.js':stub({json:v=>Response.json(v),body:r=>r.json(),bad}),
 };
 const mod=new vm.SourceTextModule(await readFile(new URL('../src/studio-rewards.js',import.meta.url),'utf8'),{context});await mod.link(s=>imports[s]);await mod.evaluate();return{db,env,api:mod.namespace};
}
test('a GPS claim records one Studio pickup per user and treasure, including after cancel/reclaim',async()=>{
 const h=await setup();h.db.prepare('INSERT INTO studio_drop_rewards VALUES(1,2)').run();await h.api.recordStudioPickup(h.env,1,1);await h.api.recordStudioPickup(h.env,1,1);h.db.prepare('UPDATE studio_drop_rewards SET credits=10 WHERE drop_id=1').run();await h.api.recordStudioPickup(h.env,1,1);assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM studio_pickup_receipts').get().n,1);assert.equal(h.db.prepare('SELECT credits FROM studio_pickup_receipts').get().credits,2);
});
test('Studio receipt synchronization requires a valid purpose-specific ticket and returns only that user',async()=>{
 const h=await setup();h.db.prepare('INSERT INTO studio_drop_rewards VALUES(1,2)').run();await h.api.recordStudioPickup(h.env,1,1);
 const request=t=>new Request('https://hunt.tincommerce.com/api/tin/studio-claims',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ticket:t})});
 assert.equal((await(await h.api.studioClaims(request('alice-ticket'),h.env)).json()).claims.length,1);assert.equal((await(await h.api.studioClaims(request('bob-ticket'),h.env)).json()).claims.length,0);await assert.rejects(h.api.studioClaims(request('forged-ticket'),h.env),e=>e.status===401);
});
test('explorers cannot configure treasure rewards',async()=>{
 const h=await setup();await assert.rejects(h.api.studioAdmin(new Request('https://hunt.tincommerce.com/api/admin/studio-rewards'),h.env,{role:'explorer'}),e=>e.status===403);
});
