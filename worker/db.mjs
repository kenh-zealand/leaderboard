import {initialState,uid,now,weekKey,resetWeek} from './model.mjs';
export class Conflict extends Error {}
export class DB {
  constructor(binding){if(!binding)throw new Error('Databasen er midlertidigt utilgængelig.');this.binding=binding;}
  stmt(sql,...args){return this.binding.prepare(sql).bind(...args);}
  async read(){await this.stmt('INSERT OR IGNORE INTO state (id,data,version) VALUES (1,?,0)',JSON.stringify(initialState())).run();const row=await this.stmt('SELECT data,version FROM state WHERE id=1').first();const s=JSON.parse(row.data);s.version=row.version;return s;}
  async mutate(actor,label,fn,version){
    const s=await this.read();if(!Number.isInteger(version)||s.version!==version)throw new Conflict('Data er ændret i en anden fane. Opdatér og prøv igen.');
    const before=JSON.stringify(s);fn(s);const event={id:uid(),at:now(),actor,label};s.version++;s.audit.push(event);s.audit=s.audit.slice(-100);
    const result=await this.binding.batch([
      this.stmt('INSERT INTO history (id,before) SELECT ?,? WHERE (SELECT version FROM state WHERE id=1)=?',event.id,before,version),
      this.stmt('UPDATE state SET data=?,version=? WHERE id=1 AND version=?',JSON.stringify(s),s.version,version)
    ]);
    if(!result[1].meta.changes)throw new Conflict('Data er ændret i en anden fane. Opdatér og prøv igen.');
    return s;
  }
  async rollover(){
    for(let tries=0;tries<3;tries++){const s=await this.read();const due=s.classes.filter(c=>c.autoReset&&c.week!==weekKey());if(!due.length)return;
      try{await this.mutate('system','Automatisk ugentlig nulstilling',state=>due.forEach(c=>resetWeek(state,c.id)),s.version);return;}catch(e){if(!(e instanceof Conflict))throw e;}
    }throw new Conflict('Opdatér siden efter ugeskiftet.');
  }
  async undo(version){
    const s=await this.read();if(s.version!==version||!s.audit.length)throw new Conflict('Ingen aktuel ændring at fortryde.');
    const last=s.audit.at(-1);if(last.label.startsWith('Fortryd:'))throw new Error('Den seneste ændring er allerede fortrudt.');
    const row=await this.stmt('SELECT before FROM history WHERE id=?',last.id).first();if(!row)throw new Error('Ændringen kan ikke længere fortrydes.');
    const restored=JSON.parse(row.before);restored.version=s.version+1;restored.audit=[...s.audit,{id:uid(),at:now(),actor:'admin',label:'Fortryd: '+last.label}].slice(-100);
    const r=await this.stmt('UPDATE state SET data=?,version=? WHERE id=1 AND version=?',JSON.stringify(restored),restored.version,version).run();if(!r.meta.changes)throw new Conflict('Data blev ændret. Opdatér siden.');
  }
}
