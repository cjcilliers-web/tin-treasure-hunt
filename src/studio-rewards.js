import { verifyTinTicket, requireRole } from './auth.js';
import { json, body, bad } from './lib.js';

// The normal GPS claim flow records this receipt. Cancel/reclaim cannot create a second reward.
export async function recordStudioPickup(env,userId,dropId){
 await env.DB.prepare(`INSERT OR IGNORE INTO studio_pickup_receipts(user_id,drop_id,credits)
  SELECT ?,drop_id,credits FROM studio_drop_rewards WHERE drop_id=? AND credits>0`).bind(userId,dropId).run();
}
export async function studioClaims(req,env){
 const b=await body(req,2000),who=await verifyTinTicket(env,b.ticket,'studio-claims');
 if(!who?.email)bad('Invalid or expired Studio ticket',401);
 const claims=await env.DB.prepare(`SELECT p.id,p.credits FROM studio_pickup_receipts p JOIN tin_users u ON u.id=p.user_id
  WHERE lower(u.email)=lower(?) AND EXISTS(SELECT 1 FROM claims c WHERE c.user_id=p.user_id AND c.drop_id=p.drop_id AND c.status IN ('claimed','redeemed')) ORDER BY p.id DESC LIMIT 100`).bind(who.email).all();
 return json({claims:claims.results});
}
export async function studioAdmin(req,env,user){
 requireRole(user,'admin');
 if(req.method==='GET'){
  const drops=await env.DB.prepare(`SELECT d.id,d.title,COALESCE(s.credits,0) AS credits FROM treasure_drops d LEFT JOIN studio_drop_rewards s ON s.drop_id=d.id WHERE d.status IN ('active','paused','pending') ORDER BY d.id DESC LIMIT 500`).all();
  return json({drops:drops.results});
 }
 const b=await body(req,2000),drop=Number(b.dropId),credits=Number(b.credits);
 if(!Number.isSafeInteger(drop)||drop<1||!Number.isInteger(credits)||credits<0||credits>100)bad('Choose a valid treasure and 0–100 Studio Credits',400);
 if(!await env.DB.prepare('SELECT id FROM treasure_drops WHERE id=?').bind(drop).first())bad('Treasure not found',404);
 await env.DB.prepare('INSERT INTO studio_drop_rewards(drop_id,credits) VALUES(?,?) ON CONFLICT(drop_id) DO UPDATE SET credits=excluded.credits').bind(drop,credits).run();
 return json({ok:true});
}
