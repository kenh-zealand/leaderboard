import {DB,Conflict} from './db.mjs';
import {uid,text,find,publicState,studentState,adminAction,studentAction} from './model.mjs';
const TTL=43200;
const sha=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(v=>v.toString(16).padStart(2,'0')).join('');
const cookieToken=req=>(req.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('session='))?.slice(8)||'';
function reply(status,data,cookie){
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
  if(cookie)headers['Set-Cookie']=cookie;return new Response(JSON.stringify(data),{status,headers});
}
const sessionCookie=(token,secure=true,clear=false)=>'session='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+(clear?0:TTL)+(secure?'; Secure':'');
async function auth(db,req){
  const digest=await sha(cookieToken(req));
  const a=await db.stmt('SELECT role,student,csrf FROM sessions WHERE token=? AND expires>?',digest,Date.now()/1000).first();
  if(a?.role==='student'){const p=(await db.read()).students.find(p=>p.id===a.student);if(!p||!p.active)return null;}
  return a;
}
async function createSession(db,role,student=''){
  const token=uid()+uid(),csrf=uid()+uid();
  await db.binding.batch([
    db.stmt('DELETE FROM sessions WHERE expires<?',Date.now()/1000),
    db.stmt('INSERT INTO sessions (token,role,student,csrf,expires) VALUES (?,?,?,?,?)',await sha(token),role,student,csrf,Date.now()/1000+TTL)
  ]);return token;
}
function constantEqual(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let result=0;for(let i=0;i<a.length;i++)result|=a.charCodeAt(i)^b.charCodeAt(i);return result===0;}
export default {
 async fetch(req,env){
  const url=new URL(req.url),path=url.pathname;
  if(!path.startsWith('/api/')){
    if(!['/','/app.js','/style.css','/favicon.svg'].includes(path))return reply(404,{error:'Siden findes ikke.'});
    if(req.method!=='GET'&&req.method!=='HEAD')return reply(405,{error:'Metoden er ikke tilladt.'});
    const response=await env.ASSETS.fetch(req),headers=new Headers(response.headers);
    headers.set('Cache-Control','no-store');headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');
    headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    return new Response(response.body,{status:response.status,headers});
  }
  try{
    const db=new DB(env.DB);await db.rollover();
    if(req.method==='GET'){
      if(path==='/api/public'){
        const s=await db.read(),cid=url.searchParams.get('class');
        return reply(200,cid?publicState(s,cid):{classes:s.classes.map(c=>({id:c.id,name:c.name}))});
      }
      if(path==='/api/me')return reply(200,await auth(db,req)||{role:'public'});
      if(path==='/api/state'){
        const a=await auth(db,req);if(!a)return reply(401,{error:'Log ind først.'});
        const s=await db.read();return reply(200,a.role==='admin'?s:studentState(s,a.student));
      }
      return reply(404,{error:'Siden findes ikke.'});
    }
    if(req.method!=='POST')return reply(405,{error:'Metoden er ikke tilladt.'});
    const base=(env.BASE_URL||url.origin).replace(/\/$/,'');
    if(req.headers.get('Origin')!==base||req.headers.get('Content-Type')?.split(';')[0]!=='application/json')return reply(403,{error:'Anmodningen skal komme fra appens egen adresse.'});
    if(Number(req.headers.get('Content-Length')||0)>100000)return reply(413,{error:'Anmodningen er for stor.'});
    const raw=await req.text();if(raw.length>100000)return reply(413,{error:'Anmodningen er for stor.'});
    const d=JSON.parse(raw);if(!d||typeof d!=='object'||Array.isArray(d))throw new Error('Ugyldige data.');
    if(path==='/api/login'||path==='/api/invite'){
      const ip=req.headers.get('CF-Connecting-IP')||'local',time=Date.now()/1000;
      const attempt=await db.stmt('SELECT count,expires FROM login_attempts WHERE ip=?',ip).first();
      if(attempt&&attempt.expires>time&&attempt.count>=12)return reply(429,{error:'For mange forsøg. Vent fem minutter.'});
      let valid=false,sid='';
      if(path==='/api/login'){
        if(!env.ADMIN_PASSWORD||env.ADMIN_PASSWORD.length<12)return reply(503,{error:'Underviseradgangen er endnu ikke konfigureret.'});
        if(typeof d.password!=='string'||d.password.length>1024)throw new Error('Ugyldig adgangskode.');
        valid=constantEqual(await sha(d.password),await sha(env.ADMIN_PASSWORD));
      }else if(typeof d.token==='string'&&d.token.length<200){
        const invitation=await db.stmt('SELECT student FROM invitations WHERE digest=?',await sha(d.token)).first();
        sid=invitation?.student||'';valid=!!(await db.read()).students.find(p=>p.id===sid&&p.active);
      }
      if(!valid){await db.stmt('INSERT INTO login_attempts (ip,count,expires) VALUES (?,1,?) ON CONFLICT(ip) DO UPDATE SET count=CASE WHEN expires>? THEN count+1 ELSE 1 END, expires=CASE WHEN expires>? THEN expires ELSE excluded.expires END',ip,time+300,time,time).run();return reply(401,{error:'Adgangen kunne ikke godkendes.'});}
      await db.stmt('DELETE FROM login_attempts WHERE ip=?',ip).run();
      const token=await createSession(db,sid?'student':'admin',sid);return reply(200,{ok:true},sessionCookie(token,base.startsWith('https:')));
    }
    const a=await auth(db,req);if(!a)return reply(401,{error:'Log ind først.'});
    if(!constantEqual(req.headers.get('X-CSRF-Token')||'',a.csrf))return reply(403,{error:'Opdatér siden og prøv igen.'});
    if(path==='/api/logout'){
      await db.stmt('DELETE FROM sessions WHERE token=?',await sha(cookieToken(req))).run();return reply(200,{ok:true},sessionCookie('',base.startsWith('https:'),true));
    }
    if(path.startsWith('/api/admin/')){
      if(a.role!=='admin')return reply(403,{error:'Kræver underviseradgang.'});
      if(path==='/api/admin/invite'){
        find((await db.read()).students,d.studentId);const token=uid()+uid();
        await db.binding.batch([
          db.stmt('INSERT INTO invitations (student,digest) VALUES (?,?) ON CONFLICT(student) DO UPDATE SET digest=excluded.digest',d.studentId,await sha(token)),
          db.stmt('DELETE FROM sessions WHERE student=?',d.studentId)
        ]);
        return reply(200,{url:base+'/#invite='+token});
      }
      if(path==='/api/admin/undo')await db.undo(d.version);
      else if(path==='/api/admin/action')await db.mutate('admin',text(d.reason||'Underviser: '+(d.op||'ændring'),1000),s=>adminAction(s,d),d.version);
      else return reply(404,{error:'Ukendt handling.'});
    }else if(path==='/api/student/action'&&a.role==='student')await db.mutate(a.student,'Studerende: '+text(d.op,30),s=>studentAction(s,a.student,d),d.version);
    else return reply(403,{error:'Handlingen er ikke tilladt.'});
    return reply(200,{ok:true});
  }catch(e){
    if(e instanceof Conflict)return reply(409,{error:e.message});
    if(/D1_|SQLITE|database|Databasen/.test(e.message)){console.error('Storage operation failed');return reply(503,{error:'Data kunne ikke gemmes. Bevar din besvarelse og prøv igen.'});}
    return reply(400,{error:e instanceof SyntaxError?'Ugyldige data.':e.message||'Udfyld alle felter korrekt.'});
  }
 }
};
