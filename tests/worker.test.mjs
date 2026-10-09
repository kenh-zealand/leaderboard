import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
import {SQLiteD1} from '../scripts/sqlite-d1.mjs';
import {DB} from '../worker/db.mjs';
import {initialState,weekKey,studentState} from '../worker/model.mjs';
const URL='https://test.example',password='test-admin-password-123';
async function fixture(){
 const binding=new SQLiteD1(),db=new DB(binding),env={DB:binding,BASE_URL:URL,ADMIN_PASSWORD:password,ASSETS:{fetch:async()=>new Response('page')}};
 const cookies={},csrf={};
 async function call(path,data,role='admin',override={}){
  const headers={...((data!==undefined)?{'Content-Type':'application/json',Origin:URL,'X-CSRF-Token':csrf[role]||''}:{}),Cookie:cookies[role]||'',...override};
  const res=await worker.fetch(new Request(URL+path,{method:data===undefined?'GET':'POST',headers,...(data!==undefined?{body:JSON.stringify(data)}:{})}),env);
  const cookie=res.headers.get('Set-Cookie');if(cookie)cookies[role]=cookie.split(';')[0];
  const result=await res.json();return {status:res.status,data:result};
 }
 assert.equal((await call('/api/login',{password})).status,200);
 csrf.admin=(await call('/api/me')).data.csrf;
 async function invite(sid,role='student'){
  const r=await call('/api/admin/invite',{studentId:sid});const token=r.data.url.split('#invite=')[1];
  assert.equal((await call('/api/invite',{token},role)).status,200);csrf[role]=(await call('/api/me',undefined,role)).data.csrf;
 }
 await invite('demo-A');
 async function action(d,role='admin',expected=200){
  const version=(await db.read()).version;
  const r=await call('/api/'+(role==='admin'?'admin':'student')+'/action',{...d,version},role);
  assert.equal(r.status,expected,JSON.stringify(r.data));return r;
 }
 return {binding,db,env,call,invite,action};
}
test('Student projection and server-side role/CSRF boundaries',async()=>{
 const f=await fixture();try{
  const s=(await f.call('/api/state',undefined,'student')).data;
  assert.equal(s.student.id,'demo-A');assert.equal(s.students,undefined);assert.equal(s.audit,undefined);
  assert.equal((await f.call('/api/admin/invite',{studentId:'demo-B'},'student')).status,403);
  assert.equal((await f.call('/api/admin/action',{op:'class'},'admin',{'X-CSRF-Token':''})).status,403);
  assert.equal((await f.call('/api/login',{password},'public',{Origin:'https://evil.example'})).status,403);
  const publicData=(await f.call('/api/public?class=demo-class',undefined,'public')).data;
  assert.ok(!JSON.stringify(publicData).includes('Demostuderende'));
  assert.equal((await f.call('/api/state',undefined,'public')).status,401);
 }finally{f.binding.close();}
});
test('Invitation rotation revokes old student sessions',async()=>{
 const f=await fixture();try{await f.call('/api/admin/invite',{studentId:'demo-A'});assert.equal((await f.call('/api/state',undefined,'student')).status,401);}finally{f.binding.close();}
});
test('Individual grading is idempotent and credits spend/refund exactly once',async()=>{
 const f=await fixture();try{
  await f.action({op:'submit',taskId:'demo-individual',body:'Resultatet er 15.000 kr.'},'student');
  const sub=(await f.db.read()).submissions.at(-1),grade={op:'grade',id:sub.id,good:true,reasoning:true,improved:true,feedback:'Korrekt.'};
  await f.action(grade);await f.action(grade);
  const p=(await f.db.read()).students.find(p=>p.id==='demo-A');assert.equal(p.xp,55);assert.equal(p.credits,17);
  const reward=(await f.db.read()).rewards[0],version=(await f.db.read()).version;
  await f.action({op:'buy',id:reward.id},'student');
  assert.equal((await f.call('/api/student/action',{op:'buy',id:reward.id,version},'student')).status,409);
  let s=await f.db.read();assert.equal(s.students[0].credits,12);
  const r=s.redemptions[0];await f.action({op:'redemption',id:r.id,status:'refunded'});await f.action({op:'redemption',id:r.id,status:'refunded'},'admin',400);
  assert.equal((await f.db.read()).students[0].credits,17);
 }finally{f.binding.close();}
});
test('Peer feedback, credits and 65-point calculation',async()=>{
 const f=await fixture();try{
  await f.action({op:'submit',taskId:'demo-team',body:'En bedre arbejdsgang.'},'student');
  const sub=(await f.db.read()).submissions.at(-1);
  await f.action({op:'assign',submissionId:sub.id,reviewer:'demo-A'},'admin',400);
  for(const [sid,role] of [['demo-C','judge1'],['demo-E','judge2']]){
   await f.action({op:'assign',submissionId:sub.id,reviewer:sid});await f.invite(sid,role);
   const review=(await f.db.read()).reviews.at(-1);
   await f.action({op:'review',id:review.id,ratings:[4,4,3,3],strength:'Konkret.',improvement:'Uddyb.',evidence:'Metoden i afsnit 2.'},role);
   await f.action({op:'approve_review',id:review.id});await f.action({op:'approve_review',id:review.id});
  }
  const s=await f.db.read();assert.equal(s.teams[0].components[0]+s.teams[0].components[1],65);
  assert.equal(s.students.find(p=>p.id==='demo-C').credits,13);
  await f.action({op:'submit',taskId:'demo-team',body:'Changed.'},'student',400);
 }finally{f.binding.close();}
});
test('Selected reset, durable undo and stale-write protection',async()=>{
 const f=await fixture();try{
  const before=await f.db.read();
  await f.action({op:'reset',scope:'class',id:'demo-class',fields:['week']});
  const s=await f.db.read();assert.equal(s.teams[0].score,0);assert.equal(s.students[0].xp,before.students[0].xp);assert.equal(s.students[0].credits,10);assert.equal(s.tasks[0].open,false);assert.equal(s.archives.length,1);
  assert.equal((await f.call('/api/admin/undo',{version:s.version})).status,200);
  assert.equal((await f.db.read()).teams[0].score,78);
  assert.equal((await f.call('/api/admin/undo',{version:s.version})).status,409);
  await f.action({op:'metrics',type:'student',id:'demo-A',xp:-1,credits:10},'admin',400);
  assert.equal((await f.db.read()).students[0].xp,35);
 }finally{f.binding.close();}
});
test('Concurrent credit purchases cannot overspend',async()=>{
 const f=await fixture();try{
  await f.action({op:'metrics',type:'student',id:'demo-A',xp:35,credits:5,levelOverride:''});
  const s=await f.db.read(),payload={op:'buy',id:s.rewards[0].id,version:s.version};
  const results=await Promise.all([f.call('/api/student/action',payload,'student'),f.call('/api/student/action',payload,'student')]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal((await f.db.read()).students[0].credits,0);assert.equal((await f.db.read()).redemptions.length,1);
 }finally{f.binding.close();}
});
test('Automatic rollover and Danish timezone boundary',async()=>{
 const f=await fixture();try{
  assert.equal(weekKey(new Date('2026-10-11T21:59:00Z')),'2026-W41');
  assert.equal(weekKey(new Date('2026-10-11T22:00:00Z')),'2026-W42');
  const s=await f.db.read();s.classes[0].autoReset=true;s.classes[0].week='2000-W01';
  await f.db.stmt('UPDATE state SET data=? WHERE id=1',JSON.stringify(s)).run();
  await f.call('/api/state');assert.equal((await f.db.read()).teams[0].score,0);
  await f.call('/api/state');assert.equal((await f.db.read()).archives.length,1);
 }finally{f.binding.close();}
});
test('Login rate limit persists across requests',async()=>{
 const f=await fixture();try{
  for(let i=0;i<12;i++)assert.equal((await f.call('/api/login',{password:'wrong'},'public')).status,401);
  assert.equal((await f.call('/api/login',{password},'public')).status,429);
 }finally{f.binding.close();}
});
