'use strict';
const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let identity={role:'public'}, data={}, currentClass='', tab='overview', busy=false, toastTimer;
const adminTabs=[['overview','Overblik'],['people','Hold & studerende'],['tasks','Aktiviteter'],['reviews','Vurderinger'],['catalog','Levels & anerkendelser'],['shop','Belønninger'],['history','Historik & nulstilling']];
const studentTabs=[['overview','Mit scoreboard'],['tasks','Mine missioner'],['reviews','Giv feedback'],['catalog','Badges & awards'],['shop','Belønningsbutik']];
const btn=(title,action,id='',kind='',style='secondary')=>'<button type="button" class="btn '+style+'" data-action="'+action+'" data-id="'+esc(id)+'" data-kind="'+esc(kind)+'">'+esc(title)+'</button>';
const empty=(title,desc)=>'<div class="empty"><h3>'+esc(title)+'</h3>'+esc(desc)+'</div>';
const field=(name,label,value='',type='text',extra='')=>'<div class="field"><label for="f-'+esc(name)+'">'+esc(label)+'</label><input id="f-'+esc(name)+'" name="'+esc(name)+'" type="'+type+'" value="'+esc(value)+'" '+extra+' required></div>';
const area=(name,label,value='',max=4000)=>'<div class="field"><label for="f-'+name+'">'+esc(label)+'</label><textarea id="f-'+name+'" name="'+name+'" maxlength="'+max+'" required>'+esc(value)+'</textarea></div>';
const options=(items,value,key='id',label='name')=>items.map(x=>'<option value="'+esc(x[key])+'" '+(x[key]===value?'selected':'')+'>'+esc(x[label])+'</option>').join('');
const select=(name,label,items,value,blank=false)=>'<div class="field"><label for="f-'+name+'">'+esc(label)+'</label><select id="f-'+name+'" name="'+name+'">'+(blank?'<option value="">Ingen / automatisk</option>':'')+options(items,value)+'</select></div>';
const check=(name,label,checked=false)=>'<label><input type="checkbox" name="'+name+'" '+(checked?'checked':'')+'>'+esc(label)+'</label>';
const form=(type,content,id='',kind='')=>'<form data-form="'+type+'" data-id="'+esc(id)+'" data-kind="'+esc(kind)+'">'+content+'<div class="actions"><button class="btn" type="submit">Gem</button>'+btn('Annullér','close')+'</div><p class="form-error notice error" hidden role="alert"></p></form>';
const stat=(value,label)=>'<div class="stat"><strong>'+esc(value)+'</strong><span>'+esc(label)+'</span></div>';
const classTeams=()=>data.teams.filter(t=>t.classId===currentClass);
const classStudents=()=>data.students.filter(p=>p.classId===currentClass);
const classroom=()=>identity.role==='admin'?data.classes.find(c=>c.id===currentClass):data.classroom;
const get=(kind,id)=>data[kind]?.find(x=>x.id===id);
const entityName=sub=>sub.teamId?get('teams',sub.teamId)?.name:get('students',sub.studentId)?.name;
function notify(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),4500);}
function modal(title,body){$('#dialog-content').innerHTML='<div class="dialog-head"><h2>'+esc(title)+'</h2><button class="close" data-action="close" type="button" aria-label="Luk">×</button></div>'+body;$('#dialog').showModal();}
async function api(url,payload){
  const res=await fetch(url,payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':identity.csrf||''},body:JSON.stringify(payload)});
  const result=await res.json();
  if(!res.ok)throw new Error(result.error||'Handlingen kunne ikke gennemføres.');
  return result;
}
async function refresh(){
  identity=await api('/api/me');
  if(identity.role==='public'){
    const classes=await api('/api/public');data=classes;
    if(currentClass && !classes.classes.some(c=>c.id===currentClass))currentClass='';
    if(!currentClass)currentClass=classes.classes[0]?.id||'';
    if(currentClass)data={...classes,...await api('/api/public?class='+encodeURIComponent(currentClass))};
  }else{
    data=await api('/api/state');
    if(identity.role==='admin'){
      if(!data.classes.some(c=>c.id===currentClass))currentClass=data.classes[0]?.id||'';
    }else currentClass=data.classroom.id;
  }
  render();
}
function scoreboard(teams,top){
  const sorted=[...teams].sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name));
  let rank=0,last;
  const rows=sorted.map((t,i)=>{if(t.score!==last)rank=i+1;last=t.score;return {...t,rank:t.rank||rank};}).filter(t=>t.rank<=top);
  return rows.length?rows.map(t=>'<div class="row"><span class="rank '+(t.rank===1?'first':'')+'">'+t.rank+'</span><div class="row-name"><strong>'+esc(t.name)+'</strong><small>Faglighed '+t.components[0]+' · Begrundelse '+t.components[1]+' · Forbedring '+t.components[2]+' · Samarbejde '+t.components[3]+'</small></div><span class="score">'+t.score+' <small class="mini">pt</small></span></div>').join(''):empty('En ny uge begynder','Holdenes resultater vises her, når underviseren har oprettet grupper.');
}
function render(){
  const role=identity.role,c=classroom(),tabs=role==='admin'?adminTabs:role==='student'?studentTabs:[['overview','Ugens scoreboard']];
  if(!tabs.some(x=>x[0]===tab))tab='overview';
  const title=tabs.find(x=>x[0]===tab)[1];
  const picker=role!=='student'?'<label for="class-picker">Undervisningshold</label><select id="class-picker">'+(data.classes?.length?options(data.classes,currentClass):'<option>Ingen hold endnu</option>')+'</select>':'<span class="pill green">'+esc(c?.name)+'</span>';
  $('#app').innerHTML='<div class="shell"><aside class="sidebar"><div class="brand"><div class="mark">◈</div><div><strong>Administrationsligaen</strong><small>Læring i fremdrift</small></div></div>'+picker+'<nav class="nav" aria-label="Navigation">'+tabs.map(([id,label])=>'<button type="button" data-tab="'+id+'" class="'+(tab===id?'active':'')+'" '+(tab===id?'aria-current="page"':'')+'>'+label+'</button>').join('')+'</nav><div class="sidebar-footer"><div>'+esc(role==='admin'?'Underviseradgang':role==='student'?data.student.name:'Fælles scoreboard')+'<br><span>Ugepoint starter på ny. Læring består.</span></div>'+btn(role==='public'?'Underviserlogin':'Log ud',role==='public'?'login':'logout','','','ghost')+'</div></aside><main class="main"><div class="topline"><div><div class="eyebrow">'+esc(role==='student'?'Din udvikling · '+c.name:role==='admin'?'Underviserens arbejdsrum':'Samarbejde · mestring · fremgang')+'</div><h1>'+esc(title)+'</h1></div><div class="actions"><span class="pill">'+esc(c?.week||'Første udkast')+'</span>'+btn('Opdatér','refresh')+'</div></div>'+view()+'<p class="footer-note">Administrationsligaen · Faglige kriterier før point · Første udkast</p></main></div>';
}
function view(){
  if(identity.role==='public')return '<section class="hero"><div><div class="eyebrow">Hver uge er en ny mulighed</div><h2>Sammen om bedre løsninger</h2><p>Holdene løser faglige missioner og får point for kvalitet, begrundelser, forbedring og samarbejde.</p></div><div class="hero-emblem">◈</div></section>'+(data.classroom?'<section class="card"><div class="sectionhead"><h2>Ugens top '+data.classroom.top+'</h2><span class="pill green">Op til 100 point</span></div>'+scoreboard(data.teams,data.classroom.top)+'</section>'+taskCards(data.tasks,false):empty('Velkommen til Administrationsligaen','Underviseren kan logge ind og oprette det første hold. Studerende åbner deres personlige invitationslink.'));
  if(identity.role==='admin')return adminView();
  return studentView();
}
function adminView(){
  const c=classroom();
  if(!c)return '<section class="hero"><div><h2>Begynd med dit undervisningshold</h2><p>Opret holdet, tilføj grupper og studerende, og del deres personlige links.</p><div class="card-foot">'+btn('Opret første hold','edit','','class','')+'</div></div><div class="hero-emblem">◈</div></section>';
  if(tab==='overview')return '<section class="hero"><div><div class="eyebrow">'+esc(c.name)+'</div><h2>Gør fremskridt synlige</h2><p>Ugens holdkonkurrence starter på ny. Personlige XP, badges og credits følger de studerende gennem forløbet.</p><div class="actions card-foot">'+btn('Ny aktivitet','edit','','task','')+btn('Del fælles scoreboard','public-link')+'</div></div><div class="hero-emblem">◈</div></section><div class="stats">'+stat(classTeams().length,'Grupper')+stat(classStudents().length,'Studerende')+stat(data.tasks.filter(t=>t.classId===currentClass&&t.open).length,'Åbne missioner')+stat(data.reviews.filter(r=>r.sent&&!r.approved&&get('tasks',get('submissions',r.submissionId)?.taskId)?.classId===currentClass).length,'Vurderinger til godkendelse')+'</div><div class="grid"><section class="card"><div class="sectionhead"><h2>Ugens top '+c.top+'</h2>'+btn('Justér point','goto','','people')+'</div>'+scoreboard(classTeams(),c.top)+'</section><section class="card"><h2>Sådan tæller pointene</h2><div class="row"><span>Faglig kvalitet</span><strong>40</strong></div><div class="row"><span>Begrundelse og anvendelse</span><strong>25</strong></div><div class="row"><span>Forbedring efter feedback</span><strong>20</strong></div><div class="row"><span>Samarbejde og videndeling</span><strong>15</strong></div><p class="muted mini">Automatisk ugeskift: '+(c.autoReset?'Slået til':'Slået fra')+'. Du styrer nulstilling og regler fra administrationen.</p></section></div>';
  if(tab==='people')return '<div class="sectionhead"><h2>'+esc(c.name)+'</h2><div class="actions">'+btn('Redigér hold','edit',c.id,'class')+btn('Nyt undervisningshold','edit','','class')+btn('Ny gruppe','edit','','team','')+btn('Ny studerende','edit','','student','')+'</div></div><section class="card"><h2>Grupper</h2>'+(classTeams().map(t=>'<div class="row"><div class="row-name"><strong>'+esc(t.name)+'</strong><small>'+classStudents().filter(p=>p.teamId===t.id).length+' studerende · '+t.score+' ugepoint</small></div><div class="actions">'+btn('Navn','edit',t.id,'team')+btn('Point','metrics',t.id,'team')+'</div></div>').join('')||empty('Ingen grupper endnu','Opret grupper før du fordeler de studerende.'))+'</section><section class="card"><h2>Studerende</h2>'+(classStudents().length?'<div class="table-wrap"><table><thead><tr><th>Navn / gruppe</th><th>XP</th><th>Credits</th><th>Handlinger</th></tr></thead><tbody>'+classStudents().map(p=>'<tr><td><strong>'+esc(p.name)+'</strong>'+(!p.active?' <span class="capsule">Deaktiveret</span>':'')+'<br><small>'+esc(get('teams',p.teamId)?.name||'Ingen gruppe')+'</small></td><td>'+p.xp+'</td><td>'+p.credits+'</td><td><div class="actions">'+btn('Redigér','edit',p.id,'student')+btn('Point / level','metrics',p.id,'student')+btn('Badge / award','grant',p.id)+btn('Adgangslink','invite',p.id)+'</div></td></tr>').join('')+'</tbody></table></div>':empty('Ingen studerende endnu','Tilføj navne og vælg en gruppe.'))+'</section>';
  if(tab==='tasks')return '<div class="sectionhead"><h2>Missioner & afleveringer</h2>'+btn('Opret aktivitet','edit','','task','')+'</div>'+taskCards(data.tasks.filter(t=>t.classId===currentClass),true)+adminSubmissions();
  if(tab==='reviews')return adminReviews();
  if(tab==='catalog')return catalogAdmin();
  if(tab==='shop')return '<div class="sectionhead"><h2>Belønninger</h2>'+btn('Ny belønning','catalog-edit','','rewards','')+'</div>'+rewardCards(true)+redemptionsAdmin();
  if(tab==='history')return historyAdmin();
  return '';
}
function taskCards(tasks,admin){
  return tasks.length?'<div class="grid">'+tasks.map(t=>'<section class="card"><div class="mission-kind">'+(t.kind==='team'?'Holdmission · op til 100 ugepoint':'Individuel mission · op til 20 XP + 7 credits')+'</div><h3>'+esc(t.title)+'</h3><p class="preline">'+esc(t.description)+'</p><div class="notice"><strong>Kriterier</strong><p class="preline">'+esc(t.criteria)+'</p></div><div class="sectionhead"><span class="capsule">'+(t.open?'Åben':'Lukket')+' · '+esc(t.week)+'</span>'+(admin?btn('Redigér','edit',t.id,'task'):identity.role==='student'&&t.open?btn('Åbn og aflever','submit',t.id,'',''):'')+'</div></section>').join('')+'</div>':empty('Ingen missioner endnu','Aktiviteterne vises her, når underviseren har oprettet dem.');
}
function adminSubmissions(){
  const subs=data.submissions.filter(s=>get('tasks',s.taskId)?.classId===currentClass);
  return '<section class="card"><h2>Afleveringer</h2>'+(subs.length?subs.map(s=>'<div class="row"><div class="row-name"><strong>'+esc(entityName(s))+'</strong><small>'+esc(get('tasks',s.taskId)?.title)+'</small></div><div class="actions">'+btn('Se produkt','product',s.id)+btn('Tildel vurderer','assign',s.id)+(s.studentId?btn('Vurdér individuelt','grade',s.id,'',''):'')+'</div></div>').join(''):empty('Afventer afleveringer','Studerende afleverer via deres personlige oversigt.'))+'</section>';
}
function adminReviews(){
  const reviews=data.reviews.filter(r=>get('tasks',get('submissions',r.submissionId)?.taskId)?.classId===currentClass);
  return '<div class="notice">Tildel vurderere under Aktiviteter. To forskellige, godkendte vurderinger beregner de første 65 holdpoint. Justér forbedring og samarbejde under Hold & studerende.</div>'+(reviews.length?reviews.map(r=>'<section class="card"><div class="sectionhead"><h3>'+esc(get('students',r.reviewer)?.name)+' → '+esc(entityName(get('submissions',r.submissionId)))+'</h3><span class="capsule">'+(r.approved?'Godkendt':r.sent?'Afventer godkendelse':'Afventer feedback')+'</span></div><p class="muted">'+esc(get('tasks',get('submissions',r.submissionId)?.taskId)?.title)+'</p>'+(r.sent?'<p><strong>Niveauer:</strong> '+r.ratings.join(' / ')+'</p><p><strong>Styrke:</strong> '+esc(r.strength)+'</p><p><strong>Forbedring:</strong> '+esc(r.improvement)+'</p><p><strong>Begrundelse:</strong> '+esc(r.evidence)+'</p><div class="card-foot">'+(!r.approved?btn('Godkend vurdering','approve-review',r.id,'',''):'')+'</div>':'')+'</section>').join(''):empty('Ingen vurderinger tildelt','Vælg en aflevering og tildel to vurderere uden for gruppen.'));
}
function catalogAdmin(){
  return ['levels','badges','awards'].map(kind=>'<section class="card"><div class="sectionhead"><h2>'+({levels:'Levels',badges:'Badges',awards:'Awards'})[kind]+'</h2>'+btn('Opret','catalog-edit','',kind)+'</div>'+[...data[kind]].sort((a,b)=>(a.xp||0)-(b.xp||0)).map(x=>'<div class="row"><div class="row-name"><strong>'+esc(x.name)+'</strong><small>'+esc(kind==='levels'?x.xp+' XP':x.criteria)+(kind==='badges'?' · '+x.xp+' XP som vejledende milepæl':'')+'</small></div>'+btn('Redigér','catalog-edit',x.id,kind)+'</div>').join('')+'</section>').join('')+'<div class="notice">XP-grænser ændrer automatiske levels med det samme. Et manuelt valgt level bevares, indtil du vælger “automatisk” igen. Badgekrav skal kontrolleres fagligt af underviseren.</div>';
}
function rewardCards(admin){
  return '<div class="grid three">'+data.rewards.map(r=>'<section class="card"><div class="badge-icon">✧</div><h3>'+esc(r.name)+'</h3><p>'+esc(r.criteria)+'</p><div class="sectionhead card-foot"><strong>'+r.price+' credits</strong>'+(admin?btn('Redigér','catalog-edit',r.id,'rewards'): '<button type="button" class="btn" data-action="buy" data-id="'+r.id+'" '+(data.student.credits<r.price?'disabled':'')+'>Indløs</button>')+'</div></section>').join('')+'</div>';
}
function redemptionsAdmin(){
  const rows=data.redemptions.filter(r=>get('students',r.studentId)?.classId===currentClass);
  return '<section class="card"><h2>Indløsninger</h2>'+(rows.length?rows.map(r=>'<div class="row"><div class="row-name"><strong>'+esc(r.name)+'</strong><small>'+esc(get('students',r.studentId)?.name)+' · '+r.price+' credits · '+esc(statusName(r.status))+'</small></div><div class="actions">'+(r.status==='pending'?btn('Leveret','redeem',r.id,'fulfilled')+btn('Refundér','redeem',r.id,'refunded'):'')+'</div></div>').join(''):empty('Ingen indløsninger','Studerende kan bruge deres credits i belønningsbutikken.'))+'</section>';
}
function historyAdmin(){
  return '<section class="card"><h2>Nulstilling med fuld kontrol</h2><p>Vælg én studerende, én gruppe eller hele undervisningsholdet. Kun de markerede felter nulstilles.</p><div class="actions card-foot">'+btn('Nulstil udvalgte felter','reset','','','danger')+btn('Fortryd seneste ændring','undo')+btn('Eksportér data','export')+'</div></section><section class="card"><h2>Tidligere uger</h2>'+(data.archives.filter(a=>a.classId===currentClass).reverse().map(a=>'<div class="row"><strong>'+esc(a.week)+'</strong><span>'+a.scores.map(t=>esc(t.name)+': '+t.score).join(' · ')+'</span></div>').join('')||'<p class="muted">Uger gemmes ved nulstilling af undervisningsholdets ugepoint.</p>')+'</section><section class="card"><h2>Ændringshistorik</h2><p class="muted">Begrundelser og tidspunkter for de seneste 100 ændringer på tværs af undervisningshold.</p>'+[...data.audit].reverse().map(a=>'<div class="row"><div class="row-name"><strong>'+esc(a.label)+'</strong><small>'+esc(new Date(a.at).toLocaleString('da-DK'))+' · '+(a.actor==='admin'?'Underviser':a.actor==='system'?'Automatisk':esc(get('students',a.actor)?.name||'Studerende'))+'</small></div></div>').join('')+'</section>';
}
function studentView(){
  const p=data.student,levels=[...data.levels].sort((a,b)=>a.xp-b.xp),next=levels.find(l=>l.xp>p.xp);
  if(tab==='overview')return '<section class="hero"><div><div class="eyebrow">Velkommen, '+esc(p.name)+'</div><h2>'+esc(data.level.name)+'</h2><p>Hver mission er et skridt videre. Følg dine fremskridt, hjælp andre og brug dine credits på nye muligheder.</p></div><div class="hero-emblem">◈</div></section><div class="stats">'+stat(p.xp,'Personlige XP')+stat(p.credits,'AdminCredits')+stat(p.badges.length,'Optjente badges')+stat(p.awards.length,'Awards')+'</div><div class="grid"><section class="card"><h2>Næste milepæl</h2>'+progress(p.xp,next?.xp||p.xp)+(next?'<p><strong>'+esc(next.name)+'</strong> · '+Math.max(0,next.xp-p.xp)+' XP tilbage</p>':'<p>Du har nået den højeste automatiske XP-milepæl.</p>')+(p.levelOverride?'<p class="muted mini">Dit aktuelle level er valgt af underviseren.</p>':'')+'<div class="card-foot">'+btn('Se alle levels og kriterier','goto','','catalog')+'</div></section><section class="card"><h2>Mit hold</h2>'+(data.team?'<p><strong>'+esc(data.team.name)+'</strong></p><div class="row"><span>Ugens score</span><strong class="score">'+data.team.score+' / 100</strong></div><p class="muted">Faglighed '+data.team.components[0]+' · Begrundelse '+data.team.components[1]+' · Forbedring '+data.team.components[2]+' · Samarbejde '+data.team.components[3]+'</p>': '<p>Underviseren placerer dig i en gruppe.</p>')+'</section></div><section class="card"><div class="sectionhead"><h2>Ugens top '+data.classroom.top+'</h2><span class="pill">Ny chance hver uge</span></div>'+scoreboard(data.scoreboard.teams,data.classroom.top)+'</section>';
  if(tab==='tasks')return taskCards(data.tasks.filter(t=>t.open),false)+'<section class="card"><h2>Mine afleveringer og feedback</h2>'+(data.submissions.map(s=>'<div class="card"><h3>'+esc(data.tasks.find(t=>t.id===s.taskId)?.title)+'</h3><div class="product">'+esc(s.body)+'</div><p><strong>Underviserfeedback:</strong> '+esc(s.feedback||'Afventer vurdering')+'</p>'+(s.granted?'<p class="muted">Optjent: '+(s.granted.good?10:0)+' + '+(s.granted.reasoning?5:0)+' + '+(s.granted.improved?5:0)+' XP</p>':'')+data.feedback.filter(f=>f.taskId===s.taskId).map(f=>'<div class="notice"><strong>Medstuderendes feedback</strong><p>Styrke: '+esc(f.strength)+'</p><p>Forbedring: '+esc(f.improvement)+'</p><p>Begrundelse: '+esc(f.evidence)+'</p></div>').join('')+'</div>').join('')||empty('Ingen afleveringer endnu','Åbn en mission og aflever din besvarelse.'))+'</section>';
  if(tab==='reviews')return '<div class="notice">Vurdér produktet ud fra kriterierne. Giv en konkret styrke, et forbedringsforslag og en begrundelse. Godkendt feedback kan give 3 credits, højst to gange om ugen.</div>'+(data.reviews.map(r=>'<section class="card"><div class="sectionhead"><h3>'+esc(r.task.title)+'</h3><span class="capsule">'+(r.approved?'Godkendt':r.sent?'Afleveret':'Din feedback mangler')+'</span></div><p>'+esc(r.task.criteria)+'</p><div class="product">'+esc(r.product)+'</div>'+(!r.approved&&r.task.open?btn(r.sent?'Redigér feedback':'Giv feedback','review',r.id,'',''):'')+'</section>').join('')||empty('Ingen vurderinger tildelt','Underviseren tildeler dig et produkt fra andre studerende.'));
  if(tab==='catalog')return '<section class="card"><h2>Levels og XP-milepæle</h2>'+levels.map(l=>'<div class="row"><div class="row-name"><strong>'+esc(l.name)+'</strong><small>'+l.xp+' XP · '+(p.xp>=l.xp?'XP-krav opfyldt':l.xp-p.xp+' XP tilbage')+'</small></div>'+(data.level.id===l.id?'<span class="pill green">Dit level</span>':'')+'</div>').join('')+'</section><h2>Badges — opnået og opnåeligt</h2><p class="muted">XP viser fremdrift. Underviseren kontrollerer de faglige kriterier og tildeler badget.</p><div class="grid three">'+data.badges.map(b=>{const earned=p.badges.find(x=>x.id===b.id);return '<section class="card"><div class="badge-icon '+(earned?'':'locked')+'">'+(earned?'✦':'◇')+'</div><h3>'+esc(b.name)+'</h3><p>'+esc(b.criteria)+'</p>'+progress(p.xp,b.xp)+'<p class="mini">'+(earned?'Optjent '+esc(new Date(earned.at).toLocaleDateString('da-DK'))+' · '+esc(earned.reason):p.xp>=b.xp?'XP-milepæl nået. Faglig godkendelse mangler.':Math.max(0,b.xp-p.xp)+' XP til vejledende milepæl. Faglige krav skal også opfyldes.')+'</p></section>';}).join('')+'</div><section class="card"><h2>Awards</h2>'+data.awards.map(a=>{const earned=p.awards.find(x=>x.id===a.id);return '<div class="row"><div class="row-name"><strong>'+esc(a.name)+'</strong><small>'+esc(a.criteria)+(earned?' · Tildelt: '+esc(earned.reason):' · Kan tildeles af underviseren')+'</small></div><span class="pill">'+(earned?'Opnået':'Opnåeligt')+'</span></div>';}).join('')+'</section>';
  if(tab==='shop')return '<div class="sectionhead"><h2>Vælg din næste mulighed</h2><span class="pill green">'+p.credits+' AdminCredits</span></div>'+rewardCards(false)+'<section class="card"><h2>Mine indløsninger</h2>'+ (data.redemptions.map(r=>'<div class="row"><div class="row-name"><strong>'+esc(r.name)+'</strong><small>'+r.price+' credits · '+esc(statusName(r.status))+'</small></div></div>').join('')||'<p class="muted">Du har ikke indløst belønninger endnu.</p>')+'</section>';
  return '';
}
function progress(value,max){const pct=max===0?100:Math.min(100,Math.round(value/max*100));return '<progress class="native-progress" value="'+pct+'" max="100" aria-label="XP-fremdrift"></progress><div class="progress-meta"><span>'+value+' XP</span><span>'+max+' XP</span></div>';}
function statusName(s){return {pending:'Afventer underviseren',fulfilled:'Leveret',refunded:'Refunderet'}[s]||s;}
function edit(kind,id){
  let x=id?get(kind==='class'?'classes':kind==='team'?'teams':kind==='student'?'students':'tasks',id):{};
  if(kind==='class')modal(id?'Redigér undervisningshold':'Nyt undervisningshold',form('class',field('name','Holdnavn',x.name||'','text','maxlength="120"')+field('top','Vis topplaceringer',x.top||3,'number','min="1" max="20"')+check('autoReset','Nulstil ugepoint automatisk ved nyt ugeskift',x.autoReset),id));
  if(kind==='team')modal(id?'Redigér gruppe':'Ny gruppe',form('team',field('name','Gruppenavn',x.name||'','text','maxlength="120"'),id));
  if(kind==='student')modal(id?'Redigér studerende':'Ny studerende',form('student',field('name','Navn eller visningsnavn',x.name||'','text','maxlength="120"')+select('teamId','Gruppe',classTeams(),x.teamId||'',true)+check('active','Adgang aktiv',x.active!==false),id));
  if(kind==='task')modal(id?'Redigér aktivitet':'Ny aktivitet',form('task',field('title','Titel',x.title||'','text','maxlength="160"')+select('kind','Aktivitetstype',[{id:'team',name:'Holdmission'},{id:'individual',name:'Individuel ugemission'}],x.kind||'team')+area('description','Opgave og forventet produkt',x.description||'',8000)+area('criteria','Synlige faglige vurderingskriterier',x.criteria||'Faglig korrekthed, tydelig begrundelse og relevant anvendelse.')+check('open','Åben for afleveringer og feedback',x.open!==false),id));
}
function catalogEdit(kind,id){
  const x=get(kind,id)||{};
  modal('Redigér '+({levels:'level',badges:'badge',awards:'award',rewards:'belønning'})[kind],form('catalog',field('name','Navn',x.name||'','text','maxlength="120"')+(kind!=='levels'?area('criteria','Kriterier / betingelser',x.criteria||'',2000):'')+(['levels','badges'].includes(kind)?field('xp','XP-grænse',x.xp||0,'number','min="0" max="1000000"'):'')+(kind==='rewards'?field('price','Pris i credits',x.price||0,'number','min="0" max="10000"'):'')+area('reason','Begrundelse for ændringen','Opdateret kriterium eller regel.',1000),id,kind));
}
function metrics(kind,id){
  const x=get(kind==='team'?'teams':'students',id);
  modal('Justér '+x.name,form('metrics',(kind==='team'?'<div class="form-grid">'+['Faglig kvalitet (0–40)','Begrundelse (0–25)','Forbedring (0–20)','Samarbejde (0–15)'].map((label,i)=>field('c'+i,label,x.components[i],'number','min="0" max="'+[40,25,20,15][i]+'"')).join('')+'</div>':field('xp','Personlige XP',x.xp,'number','min="0" max="1000000"')+field('credits','AdminCredits',x.credits,'number','min="0" max="1000000"')+select('levelOverride','Manuelt level (tomt = automatisk)',data.levels,x.levelOverride,true))+area('reason','Begrundelse','Faglig vurdering eller korrektion.',1000),id,kind));
}
function grant(id){
  const p=get('students',id);
  modal('Anerkendelse til '+p.name,form('grant',select('kind','Type',[{id:'badges',name:'Badge'},{id:'awards',name:'Award'}],'badges')+'<div id="grant-items">'+select('itemId','Vælg badge',data.badges,data.badges[0]?.id)+'</div>'+check('remove','Fjern eksisterende tildeling')+area('reason','Faglig begrundelse','Kriteriet er opfyldt og kontrolleret.',1000),id));
}
function assign(id){
  const sub=get('submissions',id);
  const candidates=classStudents().filter(p=>p.active&&p.id!==sub.studentId&&(!sub.teamId||p.teamId!==sub.teamId));
  if(!candidates.length)return notify('Opret en studerende uden for den afleverende gruppe først.');
  modal('Tildel en medstuderendevurdering',form('assign',select('reviewer','Vurderer',candidates,candidates[0].id)+'<p class="notice">Tildel to forskellige vurderere. Hver tildeling giver adgang til dette produkt, men ikke til private point eller kontooplysninger.</p>',id));
}
function grade(id){
  const sub=get('submissions',id),g=sub.granted||{};
  modal('Vurdér individuel mission',form('grade','<div class="product">'+esc(sub.body)+'</div><div class="stack">'+check('good','Godkendt besvarelse: 10 XP + 5 credits',g.good)+check('reasoning','Tydelig begrundelse: 5 XP',g.reasoning)+check('improved','Forbedring efter feedback: 5 XP + 2 credits',g.improved)+'</div><p class="notice">Hver del belønnes én gang. Tidligere tildelte point fjernes kun via en manuel justering.</p>'+area('feedback','Feedback',sub.feedback||'',4000),id));
}
function submitMission(id){
  const task=data.tasks.find(t=>t.id===id);
  const sub=data.submissions.find(s=>s.taskId===id);
  modal(task.title,form('submit','<p class="preline">'+esc(task.description)+'</p><div class="notice">'+esc(task.criteria)+'</div>'+area('body',task.kind==='team'?'Holdets fælles besvarelse':'Din individuelle besvarelse',sub?.body||'',12000),id));
}
function reviewMission(id){
  const r=data.reviews.find(r=>r.id===id);
  const labels=['Faglig kvalitet','Begrundelse og metode','Tydelig formidling','Dokumentation og anvendelse'];
  modal('Giv faglig feedback',form('review','<div class="product">'+esc(r.product)+'</div><div class="notice">1: Væsentlige mangler · 2: Delvist opfyldt · 3: Opfyldt · 4: Stærkt opfyldt. Brug også aktivitetens konkrete kriterier.</div><div class="form-grid">'+labels.map((label,i)=>select('r'+i,label,[{id:'1',name:'1 — På vej'},{id:'2',name:'2 — Delvist opfyldt'},{id:'3',name:'3 — Opfyldt'},{id:'4',name:'4 — Stærkt opfyldt'}],String(r.ratings?.[i]||'3'))).join('')+'</div>'+area('strength','Én konkret styrke',r.strength||'',2000)+area('improvement','Ét konkret forbedringsforslag',r.improvement||'',2000)+area('evidence','Eksempel og begrundelse',r.evidence||'',2000),id));
}
function resetModal(){
  const targets=[{id:'class:'+currentClass,name:'Hele undervisningsholdet'},...classTeams().map(t=>({id:'team:'+t.id,name:'Gruppe: '+t.name})),...classStudents().map(p=>({id:'student:'+p.id,name:'Studerende: '+p.name}))];
  modal('Nulstil udvalgte værdier',form('reset',select('target','Område',targets,targets[0].id)+'<div class="checks">'+[['week','Ugepoint (og luk ugens aktiviteter ved helhold-reset)'],['xp','Personlige XP'],['credits','AdminCredits'],['level','Level til begynderniveau'],['badges','Badges'],['awards','Awards']].map(([name,label])=>check(name,label,name==='week')).join('')+'</div>'+area('reason','Begrundelse','Ny uge eller nyt undervisningsforløb.',1000)+'<div class="notice">XP, credits og anerkendelser slettes kun, hvis de markeres. Nulstilling af en gruppe omfatter dens medlemmer for de personlige felter.</div>'));
}
async function mutate(url,payload){
  if(busy)return;
  busy=true;
  try{await api(url,{...payload,version:data.version});$('#dialog').close();await refresh();notify('Gemt. Oversigten er opdateret.');}
  finally{busy=false;}
}
document.addEventListener('click',async e=>{
  const nav=e.target.closest('[data-tab]');
  if(nav){tab=nav.dataset.tab;render();return;}
  const b=e.target.closest('[data-action]');if(!b||busy)return;
  const {action,id,kind}=b.dataset;
  try{
    if(action==='close')return $('#dialog').close();
    if(action==='refresh')return await refresh();
    if(action==='goto'){tab=kind;return render();}
    if(action==='login')return modal('Underviserlogin',form('login',field('password','Adminadgangskode','','password','autocomplete="current-password" maxlength="1024"')));
    if(action==='logout'){await api('/api/logout',{});tab='overview';return await refresh();}
    if(action==='edit')return edit(kind,id);
    if(action==='catalog-edit')return catalogEdit(kind,id);
    if(action==='metrics')return metrics(kind,id);
    if(action==='grant')return grant(id);
    if(action==='assign')return assign(id);
    if(action==='grade')return grade(id);
    if(action==='submit')return submitMission(id);
    if(action==='review')return reviewMission(id);
    if(action==='reset')return resetModal();
    if(action==='product')return modal('Afleveret produkt','<div class="product">'+esc(get('submissions',id).body)+'</div>');
    if(action==='public-link'){
      const url=location.origin+'/?class='+encodeURIComponent(currentClass);
      return modal('Fælles scoreboard','<p>Del dette link med holdet. Det viser fælles resultater og giver ikke personlig adgang.</p>'+field('link','Link',url,'text','readonly')+btn('Kopiér link','copy'));
    }
    if(action==='invite'){
      if(!confirm('Opret et nyt personligt link? Et tidligere link og eksisterende sessioner for denne studerende bliver ugyldige.'))return;
      const result=await api('/api/admin/invite',{studentId:id});
      return modal('Personligt link til '+get('students',id).name,'<p>Linket giver adgang til denne studerendes konto. Del det kun med den rette person.</p>'+field('link','Adgangslink',result.url,'text','readonly')+btn('Kopiér link','copy'));
    }
    if(action==='copy'){const input=$('#f-link');input.select();try{await navigator.clipboard.writeText(input.value);notify('Link kopieret.');}catch{notify('Markér og kopiér linket fra feltet.');}return;}
    if(action==='approve-review')return await mutate('/api/admin/action',{op:'approve_review',id});
    if(action==='redeem')return await mutate('/api/admin/action',{op:'redemption',id,status:kind});
    if(action==='buy'){
      const r=data.rewards.find(r=>r.id===id);
      if(confirm('Brug '+r.price+' credits på “'+r.name+'”?'))await mutate('/api/student/action',{op:'buy',id});
      return;
    }
    if(action==='undo'){
      if(confirm('Fortryd den seneste dataændring på tværs af alle undervisningshold?'))await mutate('/api/admin/undo',{});
      return;
    }
    if(action==='export'){
      const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download='administrationsligaen-'+new Date().toISOString().slice(0,10)+'.json';a.click();URL.revokeObjectURL(url);
    }
  }catch(err){notify(err.message);}
});
document.addEventListener('change',async e=>{
  if(e.target.id==='class-picker'){currentClass=e.target.value;try{await refresh();}catch(err){notify(err.message);}}
  if(e.target.name==='kind'&&e.target.closest('[data-form="grant"]')){
    const kind=e.target.value;$('#grant-items').innerHTML=select('itemId','Vælg '+(kind==='badges'?'badge':'award'),data[kind],data[kind][0]?.id);
  }
});
document.addEventListener('submit',async e=>{
  const f=e.target.closest('[data-form]');if(!f)return;e.preventDefault();if(busy)return;
  const values=Object.fromEntries(new FormData(f)),type=f.dataset.form,id=f.dataset.id,kind=f.dataset.kind;
  const checked=name=>!!f.querySelector('[name="'+name+'"]')?.checked;
  let payload={...values,op:type,id,classId:currentClass},url='/api/admin/action';
  const submit=f.querySelector('[type=submit]');submit.disabled=true;
  try{
    if(type==='login'){await api('/api/login',{password:values.password});$('#dialog').close();tab='overview';await refresh();return;}
    if(type==='class'){payload.top=Number(values.top);payload.autoReset=checked('autoReset');}
    if(type==='student')payload.active=checked('active');
    if(type==='task')payload.open=checked('open');
    if(type==='catalog'){payload.kind=kind;payload.xp=Number(values.xp||0);payload.price=Number(values.price||0);}
    if(type==='metrics'){payload.type=kind;if(kind==='team')payload.components=[0,1,2,3].map(i=>Number(values['c'+i]));else{payload.xp=Number(values.xp);payload.credits=Number(values.credits);}}
    if(type==='grant'){payload.studentId=id;payload.remove=checked('remove');}
    if(type==='assign')payload.submissionId=id;
    if(type==='grade'){payload.good=checked('good');payload.reasoning=checked('reasoning');payload.improved=checked('improved');}
    if(type==='reset'){
      [payload.scope,payload.id]=values.target.split(':');payload.fields=['week','xp','credits','level','badges','awards'].filter(checked);
      if(!payload.fields.length)throw new Error('Vælg mindst ét felt.');
      if(!confirm('Bekræft nulstilling af: '+payload.fields.join(', ')+'.'))return;
    }
    if(type==='submit'){payload.taskId=id;url='/api/student/action';}
    if(type==='review'){payload.ratings=[0,1,2,3].map(i=>Number(values['r'+i]));url='/api/student/action';}
    await mutate(url,payload);
  }catch(err){const error=f.querySelector('.form-error');error.textContent=err.message;error.hidden=false;}
  finally{submit.disabled=false;}
});
async function init(){
  currentClass=new URLSearchParams(location.search).get('class')||'';
  const invitation=new URLSearchParams(location.hash.slice(1)).get('invite');
  if(invitation){
    // Exchange fragment secret for a server session; remove it from the address bar.
    history.replaceState({},'',location.pathname+location.search);
    try{await api('/api/invite',{token:invitation});}catch(err){notify(err.message);}
  }
  try{await refresh();}
  catch(err){$('#app').innerHTML='<main class="loading"><h1>Appen kunne ikke indlæses</h1><p>'+esc(err.message)+'</p>'+btn('Prøv igen','refresh')+'</main>';}
}
init();
