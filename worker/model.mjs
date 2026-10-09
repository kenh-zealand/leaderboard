import seed from './seed.json' with {type:'json'};
export const uid=()=>crypto.randomUUID().replaceAll('-','');
export const now=()=>new Date().toISOString();
export function weekKey(date=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Copenhagen',year:'numeric',month:'numeric',day:'numeric'}).formatToParts(date);
  const part=k=>Number(parts.find(x=>x.type===k).value);
  const d=new Date(Date.UTC(part('year'),part('month')-1,part('day')));
  d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));
  const year=d.getUTCFullYear(),start=new Date(Date.UTC(year,0,1));
  return year+'-W'+String(Math.ceil(((d-start)/86400000+1)/7)).padStart(2,'0');
}
export function initialState(){const s=structuredClone(seed);s.week=weekKey();s.classes.forEach(c=>c.week=s.week);s.tasks.forEach(t=>t.week=s.week);return s;}
export function text(v,max=500){if(typeof v!=='string'||!v.trim()||v.length>max)throw new Error('Udfyld feltet med en gyldig tekst.');return v.trim();}
export function num(v,max=1000000){if(typeof v==='boolean'||v===null||v==='')throw new Error('Brug et heltal.');const n=Number(v);if(!Number.isSafeInteger(n)||n<0||n>max)throw new Error('Brug et heltal mellem 0 og '+max+'.');return n;}
export function find(items,id){const x=items.find(x=>x.id===id);if(!x)throw new Error('Elementet findes ikke.');return x;}
export function resetWeek(s,cid){const c=find(s.classes,cid),teams=s.teams.filter(t=>t.classId===cid);s.archives.push({id:uid(),classId:cid,week:c.week,at:now(),scores:teams.map(t=>({name:t.name,score:t.score}))});s.archives=s.archives.slice(-200);teams.forEach(t=>{t.score=0;t.components=[0,0,0,0];});s.tasks.filter(t=>t.classId===cid).forEach(t=>t.open=false);c.week=weekKey();}
export function levelFor(s,p){if(p.levelOverride)return find(s.levels,p.levelOverride);const levels=[...s.levels].sort((a,b)=>a.xp-b.xp);return levels.filter(l=>l.xp<=p.xp).at(-1)||levels[0];}
export function publicState(s,cid){const c=find(s.classes,cid);let last,rank=0;const teams=s.teams.filter(t=>t.classId===cid).map(t=>({id:t.id,name:t.name,score:t.score,components:t.components})).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name)).map((t,i)=>{if(t.score!==last)rank=i+1;last=t.score;return {...t,rank};}).filter(t=>t.rank<=c.top);return {classroom:c,teams,tasks:s.tasks.filter(t=>t.classId===cid&&t.kind==='team'&&t.open),version:s.version};}
export function studentState(s,sid){
  const p=find(s.students,sid),team=s.teams.find(t=>t.id===p.teamId),owns=sub=>sub.studentId===sid||!!(team&&sub.teamId===team.id);
  return {student:p,team:team||null,classroom:find(s.classes,p.classId),level:levelFor(s,p),levels:s.levels,badges:s.badges,awards:s.awards,rewards:s.rewards,tasks:s.tasks.filter(t=>t.classId===p.classId),submissions:s.submissions.filter(owns),reviews:s.reviews.filter(r=>r.reviewer===sid).map(r=>{const sub=find(s.submissions,r.submissionId);return {...r,product:sub.body,task:find(s.tasks,sub.taskId)};}),feedback:s.reviews.filter(r=>r.approved&&owns(find(s.submissions,r.submissionId))).map(r=>({taskId:find(s.submissions,r.submissionId).taskId,strength:r.strength,improvement:r.improvement,evidence:r.evidence})),redemptions:s.redemptions.filter(r=>r.studentId===sid),scoreboard:publicState(s,p.classId),version:s.version};
}
export function adminAction(s,d){
 const op=d.op;
 if(op==='class'){
   const c=d.id?find(s.classes,d.id):{id:uid(),week:weekKey(),autoReset:false,top:3};
   c.name=text(d.name,120);c.top=num(d.top??c.top,20);if(c.top<1)throw new Error('Vis mindst én placering.');
   c.autoReset=!!(d.autoReset??c.autoReset);if(!d.id)s.classes.push(c);
 }else if(op==='team'){
   const cid=find(s.classes,d.classId).id,t=d.id?find(s.teams,d.id):{id:uid(),classId:cid,score:0,components:[0,0,0,0]};
   if(t.classId!==cid)throw new Error('Gruppen tilhører et andet hold.');t.name=text(d.name,120);if(!d.id)s.teams.push(t);
 }else if(op==='student'){
   const cid=find(s.classes,d.classId).id,tid=d.teamId||'';
   if(tid&&find(s.teams,tid).classId!==cid)throw new Error('Vælg en gruppe i samme undervisningshold.');
   const p=d.id?find(s.students,d.id):{id:uid(),classId:cid,xp:0,credits:0,badges:[],awards:[],levelOverride:'',active:true};
   if(p.classId!==cid)throw new Error('Den studerende tilhører et andet hold.');
   Object.assign(p,{name:text(d.name,120),teamId:tid,active:d.active!==false});if(!d.id)s.students.push(p);
 }else if(op==='metrics'){
   if(d.type==='team'){const t=find(s.teams,d.id);if(!Array.isArray(d.components)||d.components.length!==4)throw new Error('Angiv fire pointværdier.');t.components=d.components.map((v,i)=>num(v,[40,25,20,15][i]));t.score=t.components.reduce((a,b)=>a+b,0);}
   else{const p=find(s.students,d.id);p.xp=num(d.xp);p.credits=num(d.credits);if(d.levelOverride)find(s.levels,d.levelOverride);p.levelOverride=d.levelOverride||'';}
 }else if(op==='task'){
   const cid=find(s.classes,d.classId).id,t=d.id?find(s.tasks,d.id):{id:uid(),classId:cid,week:find(s.classes,cid).week};
   if(t.classId!==cid)throw new Error('Aktiviteten tilhører et andet hold.');
   if(!['team','individual'].includes(d.kind))throw new Error('Vælg hold eller individuel mission.');
   if(t.kind&&t.kind!==d.kind)throw new Error('Opret en ny aktivitet for at ændre typen.');
   Object.assign(t,{title:text(d.title,160),description:text(d.description,8000),criteria:text(d.criteria,4000),kind:d.kind,open:d.open!==false});if(!d.id)s.tasks.push(t);
 }else if(op==='catalog'){
   const kind=d.kind;if(!['levels','badges','awards','rewards'].includes(kind))throw new Error('Ukendt katalog.');
   const item=d.id?find(s[kind],d.id):{id:uid()};item.name=text(d.name,120);
   if(kind!=='levels')item.criteria=text(d.criteria,2000);if(['levels','badges'].includes(kind))item.xp=num(d.xp);
   if(kind==='rewards')item.price=num(d.price,10000);if(!d.id)s[kind].push(item);
 }else if(op==='grant'){
   const p=find(s.students,d.studentId),kind=d.kind;if(!['badges','awards'].includes(kind))throw new Error('Vælg badge eller award.');
   const item=find(s[kind],d.itemId);if(d.remove)p[kind]=p[kind].filter(x=>x.id!==item.id);
   else if(!p[kind].some(x=>x.id===item.id))p[kind].push({id:item.id,at:now(),reason:text(d.reason,1000)});
 }else if(op==='assign'){
   const sub=find(s.submissions,d.submissionId),task=find(s.tasks,sub.taskId),p=find(s.students,d.reviewer);
   if(p.classId!==task.classId||!p.active)throw new Error('Vælg en aktiv studerende på samme hold.');
   if(p.id===sub.studentId||(sub.teamId&&p.teamId===sub.teamId))throw new Error('Vurdereren skal være uden for den afleverende gruppe.');
   if(s.reviews.some(r=>r.reviewer===p.id&&r.submissionId===sub.id))throw new Error('Vurdereren er allerede tildelt.');
   s.reviews.push({id:uid(),submissionId:sub.id,reviewer:p.id,approved:false,sent:false,credited:false});
 }else if(op==='approve_review'){
   const r=find(s.reviews,d.id);if(!r.sent)throw new Error('Vurderingen er ikke afleveret.');
   const sub=find(s.submissions,r.submissionId),task=find(s.tasks,sub.taskId);
   if(!task.open)throw new Error('Aktiviteten er lukket.');
   const p=find(s.students,r.reviewer);if(!r.credited){const count=s.reviews.filter(x=>x.reviewer===p.id&&x.credited&&x.creditWeek===weekKey()).length;if(count<2)p.credits+=3;r.credited=true;r.creditWeek=weekKey();}
   r.approved=true;const approved=s.reviews.filter(x=>x.submissionId===sub.id&&x.approved);
   if(sub.teamId&&approved.length>=2&&!sub.scored){const t=find(s.teams,sub.teamId),first=approved.slice(0,2);t.components[0]=Math.round(first.reduce((a,x)=>a+x.ratings[0],0)/2/4*40);t.components[1]=Math.round(first.reduce((a,x)=>a+x.ratings[1],0)/2/4*25);t.score=t.components.reduce((a,b)=>a+b,0);sub.scored=true;}
 }else if(op==='grade'){
   const sub=find(s.submissions,d.id),task=find(s.tasks,sub.taskId);if(task.kind!=='individual')throw new Error('Brug holdets vurdering til holdmissioner.');if(!task.open)throw new Error('Aktiviteten er lukket.');
   const p=find(s.students,sub.studentId);if((d.reasoning||d.improved)&&!d.good)throw new Error('Godkend grundbesvarelsen før ekstra XP.');
   if(s.submissions.some(x=>x.id!==sub.id&&x.studentId===p.id&&x.granted?.good&&find(s.tasks,x.taskId).week===task.week))throw new Error('Ugens individuelle belønning er allerede optjent.');
   sub.granted??={good:false,reasoning:false,improved:false};
   for(const [key,xp,credits] of [['good',10,5],['reasoning',5,0],['improved',5,2]])if(d[key]&&!sub.granted[key]){p.xp+=xp;p.credits+=credits;sub.granted[key]=true;}
   sub.feedback=text(d.feedback,4000);
 }else if(op==='redemption'){
   const r=find(s.redemptions,d.id);if(!['fulfilled','refunded'].includes(d.status))throw new Error('Ukendt status.');if(r.status!=='pending')throw new Error('Indløsningen er allerede behandlet.');
   if(d.status==='refunded')find(s.students,r.studentId).credits+=r.price;r.status=d.status;
 }else if(op==='reset'){
   let people,teams;if(d.scope==='class'){const cid=find(s.classes,d.id).id;people=s.students.filter(p=>p.classId===cid);teams=s.teams.filter(t=>t.classId===cid);}
   else if(d.scope==='team'){const t=find(s.teams,d.id);teams=[t];people=s.students.filter(p=>p.teamId===t.id);}
   else if(d.scope==='student'){people=[find(s.students,d.id)];teams=[];}else throw new Error('Ukendt nulstillingsområde.');
   const fields=d.fields;if(!Array.isArray(fields)||!fields.length||fields.some(x=>!['week','xp','credits','level','badges','awards'].includes(x)))throw new Error('Vælg gyldige felter.');
   if(fields.includes('week')){if(d.scope==='class')resetWeek(s,d.id);else teams.forEach(t=>{t.score=0;t.components=[0,0,0,0];});}
   for(const p of people)for(const f of fields){if(['xp','credits'].includes(f))p[f]=0;else if(['badges','awards'].includes(f))p[f]=[];else if(f==='level')p.levelOverride=[...s.levels].sort((a,b)=>a.xp-b.xp)[0].id;}
 }else throw new Error('Ukendt handling.');
}
export function studentAction(s,sid,d){
 const p=find(s.students,sid);if(!p.active)throw new Error('Adgangen er deaktiveret.');
 if(d.op==='submit'){
   const task=find(s.tasks,d.taskId);if(task.classId!==p.classId||!task.open)throw new Error('Aktiviteten er ikke åben.');
   const tid=task.kind==='team'?p.teamId:'';if(task.kind==='team'&&!tid)throw new Error('Du skal først placeres i en gruppe.');
   const sub=s.submissions.find(x=>x.taskId===task.id&&(tid?x.teamId===tid:x.studentId===sid));
   const body=text(d.body,12000);if(sub){if(s.reviews.some(r=>r.submissionId===sub.id&&r.sent))throw new Error('Produktet er vurderet. Bed underviseren oprette en revisionsmission.');sub.body=body;sub.updatedAt=now();}
   else s.submissions.push({id:uid(),taskId:task.id,studentId:tid?'':sid,teamId:tid,body,feedback:'',updatedAt:now()});
 }else if(d.op==='review'){
   const r=find(s.reviews,d.id);if(r.reviewer!==sid||r.approved)throw new Error('Du kan ikke ændre vurderingen.');
   const sub=find(s.submissions,r.submissionId);if(!find(s.tasks,sub.taskId).open)throw new Error('Aktiviteten er lukket.');
   if(!Array.isArray(d.ratings)||d.ratings.length!==4)throw new Error('Vurder alle fire kriterier.');const ratings=d.ratings.map(v=>num(v,4));if(Math.min(...ratings)<1)throw new Error('Brug niveau 1–4.');
   Object.assign(r,{ratings,strength:text(d.strength,2000),improvement:text(d.improvement,2000),evidence:text(d.evidence,2000),sent:true});
 }else if(d.op==='buy'){
   const reward=find(s.rewards,d.id);if(p.credits<reward.price)throw new Error('Du har ikke nok AdminCredits.');p.credits-=reward.price;
   s.redemptions.push({id:uid(),studentId:sid,rewardId:reward.id,name:reward.name,price:reward.price,status:'pending',at:now()});
 }else throw new Error('Ukendt handling.');
}
