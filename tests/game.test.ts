import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,cpSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {Store,hashPassword,type Task} from '../backend/game.js';
import {evaluate,normalize,pool,pickExercise,loadPool,loadDrawings,requiresAnswer,type Exercise} from '../backend/pool.js';
import {nextConnections,type Connection} from '../backend/connections.js';
const settings={name:'Dienstabend',teamCount:4,roundCount:5,password:'Funk2026'};
function ready(count=4,roundCount=5){
 const store=new Store(':memory:');store.create({...settings,teamCount:count,roundCount});
 const tokens=Array.from({length:count},()=>store.join('Funk2026'));store.start();return {store,tokens};
}
function solve(store:Store,tokens:string[],tasks:Task[]){for(const t of tasks){const e=JSON.parse(t.exercise) as Exercise;if(requiresAnswer(e.type))store.answer(tokens[t.receiver-1],t.id,e.content);}}
function completeRound(store:Store,tokens:string[]){const tasks=store.tasks(store.current()!.id);solve(store,tokens,tasks);for(const t of tasks){store.confirm(tokens[t.sender-1],t.id,'sender');store.confirm(tokens[t.receiver-1],t.id,'receiver');}}
function assertConnections(edges:Connection[],count:number,previous:Connection[]=[]){
 assert.equal(edges.length,count);
 for(let group=1;group<=count;group++){
  const send=edges.filter(t=>t.sender===group),receive=edges.filter(t=>t.receiver===group);
  assert.equal(send.length,1);assert.equal(receive.length,1);assert.notEqual(send[0].receiver,group);
  if(count>2){assert.notEqual(send[0].receiver,receive[0].sender);if(previous.length){assert.notEqual(send[0].receiver,previous.find(t=>t.sender===group)!.receiver);assert.notEqual(receive[0].sender,previous.find(t=>t.receiver===group)!.sender);}}
 }
}
for(const count of [2,4,6])test(`${count} Gruppen erhalten über 15 Runden eindeutige wechselnde Funkpartner`,()=>{
 let previous:Connection[]=[];
 for(let i=0;i<15;i++){const current=nextConnections(Array.from({length:count},(_,j)=>j+1),previous);assertConnections(current,count,previous);previous=current;}
});
for(const count of [2,4,6])test(`Game mit ${count} Gruppen und genau einem Auftrag pro Richtung`,()=>{
 const {store:s,tokens}=ready(count);try{
  assert.equal(new Set(tokens).size,count);assert.equal(s.game()!.status,'RUNNING');
  const tasks=s.tasks(s.current()!.id);assertConnections(tasks,count);
  for(const session of tokens){const state=s.teamState(session);assert.equal(state.send!.partner,tasks.find(t=>t.sender===state.team.number)!.receiver);assert.equal(state.receive!.partner,tasks.find(t=>t.receiver===state.team.number)!.sender);}
 }finally{s.db.close();}
});
test('Beitrittspasswort, eindeutige Platzreihenfolge und Freigabe',()=>{
 const s=new Store(':memory:');try{
  s.create({...settings,teamCount:2});assert.throws(()=>s.join('falsch'),/Falsches/);assert.throws(()=>s.join({}),/Falsches/);
  const a=s.join('Funk2026'),b=s.join('Funk2026');assert.equal(s.team(a)!.number,1);assert.equal(s.team(b)!.number,2);assert.throws(()=>s.join('Funk2026'),/belegt/);
  s.release(1);assert.equal(s.team(a),undefined);assert.equal(s.team(s.join('Funk2026'))!.number,1);
 }finally{s.db.close();}
});
test('Ungültige Einstellungen werden abgelehnt; 1 und 15 Runden sind zulässig',()=>{
 const s=new Store(':memory:');try{
  s.create(settings);const id=s.game()!.id;
  for(const change of [{teamCount:3},{roundCount:0},{roundCount:16},{roundCount:1.5},{password:''},{name:'x'.repeat(101)}])assert.throws(()=>s.create({...settings,...change}));
  assert.equal(s.game()!.id,id);assert.throws(()=>s.start(),/alle Gruppen/);
  for(const roundCount of [1,15]){s.create({...settings,roundCount});assert.equal(s.game()!.round_count,roundCount);}
 }finally{s.db.close();}
});
for(const count of [2,4,6])test(`${count*2-1} Bestätigungen warten; die letzte wechselt genau einmal`,()=>{
 const {store:s,tokens}=ready(count);try{
  const round=s.current()!,tasks=s.tasks(round.id);
  for(const task of tasks)s.db.prepare('UPDATE round_tasks SET exercise=? WHERE id=?').run(JSON.stringify(pool.find(e=>e.type==='drawing')!),task.id);
  const confirmations=tasks.flatMap(t=>[{session:tokens[t.sender-1],id:t.id,role:'sender'},{session:tokens[t.receiver-1],id:t.id,role:'receiver'}]);
  for(const c of confirmations.slice(0,-1))s.confirm(c.session,c.id,c.role);
  assert.equal(s.current()!.number,1);
  const last=confirmations.at(-1)!;s.confirm(last.session,last.id,last.role);
  assert.equal(s.current()!.number,2);assertConnections(s.tasks(s.current()!.id),count,tasks);
  for(const c of confirmations)s.confirm(c.session,c.id,c.role);
  assert.equal(s.rounds().length,2);assert.equal(s.current()!.number,2);
  assert.throws(()=>s.confirm(tokens[tasks[0].receiver-1],tasks[0].id,'sender'),/gehört nicht/);
 }finally{s.db.close();}
});
for(const count of [2,4,6])test(`${count} Gruppen schließen alle gemeinsamen Runden ab`,()=>{
 const {store:s,tokens}=ready(count,3);try{
  for(let number=1;number<=3;number++){assert.equal(s.current()!.number,number);completeRound(s,tokens);}
  assert.equal(s.game()!.status,'FINISHED');assert.equal(s.rounds().length,3);assert.equal(s.stats().completedRounds,3);
  assert.equal(s.adminState(new Set()).review.length,3);
 }finally{s.db.close();}
});
test('Nur eine Runde erzeugt keine zusätzliche Runde',()=>{
 const {store:s,tokens}=ready(2,1);try{completeRound(s,tokens);assert.equal(s.game()!.status,'FINISHED');assert.equal(s.rounds().length,1);}finally{s.db.close();}
});
test('Überspringen wirkt gemeinsam und ist gegen doppelte Requests geschützt',()=>{
 const {store:s,tokens}=ready();try{
  const old=s.current()!,edges=s.tasks(old.id);s.skip(old.id);
  assert.equal(s.current()!.number,2);assertConnections(s.tasks(s.current()!.id),4,edges);assert.equal(s.rounds()[0].skipped,1);
  assert.throws(()=>s.skip(old.id),/geändert/);
  const task=s.tasks(s.current()!.id)[0];s.db.prepare('UPDATE round_tasks SET exercise=? WHERE id=?').run(JSON.stringify(pool.find(e=>e.type==='word')!),task.id);s.finish();assert.throws(()=>s.confirm(tokens[task.sender-1],task.id,'sender'),/läuft nicht/);
  assert.throws(()=>s.answer(tokens[task.receiver-1],task.id,'Test'),/abgeschlossen/);
  assert.equal(s.adminState(new Set()).review[1].finished,false);
 }finally{s.db.close();}
});
for(const type of ['word','equipment'] as const)test(`${type}: richtige Eingaben bestätigen den Empfang automatisch`,()=>{
 const {store:s,tokens}=ready(2);try{
  const task=s.tasks(s.current()!.id)[0],exercise=pool.find(e=>e.type===type)!;
  s.db.prepare('UPDATE round_tasks SET exercise=? WHERE id=?').run(JSON.stringify(exercise),task.id);
  const receiver=tokens[task.receiver-1];
  assert.throws(()=>s.confirm(receiver,task.id,'receiver'),/korrekt ausfüllen/);
  assert.throws(()=>s.answer(tokens[task.sender-1],task.id,'Test'),/gehört nicht/);
  s.confirm(tokens[task.sender-1],task.id,'sender');
  const wrong=type==='word'?'Falsch':(exercise.content as string[]).map((x,i)=>i===2?'Falsch':x);
  const feedback=s.answer(receiver,task.id,wrong);assert.equal(feedback.correct,false);
  if(type==='equipment')assert.deepEqual(feedback.fields,[true,true,false,true,true,true]);
  assert.throws(()=>s.confirm(receiver,task.id,'receiver'),/korrekt ausfüllen/);
  const correct=type==='word'?(exercise.content as string).toLowerCase():(exercise.content as string[]).map(x=>x.toLowerCase());
  s.answer(receiver,task.id,correct);
  assert.equal(s.tasks(task.round_id).find(t=>t.id===task.id)!.receiver_confirmed,1);
  s.answer(receiver,task.id,correct);
  assert.equal(s.stats(task.receiver).correct,1);assert.equal(s.stats(task.receiver).failedAttempts,1);
  assert.throws(()=>s.answer(receiver,task.id,wrong),/abgeschlossen/);
  s.confirm(receiver,task.id,'receiver');
 }finally{s.db.close();}
});
test('Lagemeldung verlangt keine Texteingabe und beide Seiten bestätigen separat',()=>{
 const {store:s,tokens}=ready(2);try{
  const task=s.tasks(s.current()!.id)[0],exercise=pool.find(e=>e.type==='message')!;
  s.db.prepare('UPDATE round_tasks SET exercise=? WHERE id=?').run(JSON.stringify(exercise),task.id);
  assert.throws(()=>s.answer(tokens[task.receiver-1],task.id,{}),/ausschließlich über Funk/);
  s.confirm(tokens[task.receiver-1],task.id,'receiver');assert.equal(s.tasks(task.round_id)[0].sender_confirmed,0);
  s.confirm(tokens[task.sender-1],task.id,'sender');assert.equal(s.current()!.number,1);
 }finally{s.db.close();}
});
test('Empfänger erhalten weder fremde Lösungen noch die Auswertung',()=>{
 const {store:s,tokens}=ready();try{
  const task=s.tasks(s.current()!.id)[0];
  for(const type of ['word','equipment','message','drawing']){
   const exercise=pool.find(e=>e.type===type)!;s.db.prepare('UPDATE round_tasks SET exercise=? WHERE id=?').run(JSON.stringify(exercise),task.id);
   const state=s.teamState(tokens[task.receiver-1]);assert.equal('content' in state.receive!,false);assert.equal('drawing' in state.receive!,false);assert.equal('review' in state,false);
   if(type==='drawing'){assert.throws(()=>s.drawing(tokens[task.receiver-1],task.id),/nicht freigegeben/);assert.match(s.drawing(tokens[task.sender-1],task.id),/\.svg$/);}
  }
  assert.deepEqual(s.adminState(new Set()).review,[]);assert.equal('password' in s.publicState().game!,false);
  s.confirm(tokens[task.receiver-1],task.id,'receiver');assert.ok(s.teamState(tokens[task.receiver-1]).receive!.drawing);
  s.finish();assert.equal('review' in s.teamState(tokens[0]),false);assert.equal('review' in s.publicState(),false);
 }finally{s.db.close();}
});
test('Auswertung zeigt Vorlagen, letzte Eingaben und Feldprüfung; Skizze und Meldung haben keine digitale Antwort',()=>{
 const {store:s,tokens}=ready(4);try{
  const tasks=s.tasks(s.current()!.id),types=['drawing','message','word','equipment'];
  tasks.forEach((task,i)=>s.db.prepare('UPDATE round_tasks SET exercise=? WHERE id=?').run(JSON.stringify(pool.find(e=>e.type===types[i])!),task.id));
  const word=tasks[2],equipment=tasks[3];
  s.answer(tokens[word.receiver-1],word.id,'Falsch');
  const list=pool.find(e=>e.type==='equipment')!.content as string[];s.answer(tokens[equipment.receiver-1],equipment.id,list);
  s.finish();const review=s.adminState(new Set()).review;
  assert.equal(review.length,1);assert.equal(review[0].finished,false);
  const drawing=review[0].tasks[0],message=review[0].tasks[1];
  assert.ok(drawing.drawing);assert.equal(drawing.content,undefined);assert.equal('answer' in drawing,false);assert.equal('feedback' in drawing,false);
  assert.deepEqual(message.content,pool.find(e=>e.type==='message')!.content);assert.equal('answer' in message,false);assert.equal('feedback' in message,false);
  assert.equal(review[0].tasks[2].answer,'Falsch');assert.deepEqual(review[0].tasks[2].feedback!.fields,[false]);
  assert.equal(review[0].tasks[2].failedAttempts,1);assert.deepEqual(review[0].tasks[3].answer,list);
  assert.ok(s.drawing('',drawing.id,true));
 }finally{s.db.close();}
});
test('Neues Game löscht Aufgaben, Auswertung und bisherige Gruppen-Sessions',()=>{
 const {store:s,tokens}=ready();try{s.finish();s.create({...settings,teamCount:2});assert.equal(s.team(tokens[0]),undefined);assert.equal(s.rounds().length,0);assert.deepEqual(s.adminState(new Set()).review,[]);assert.equal(s.publicState().game!.joined,0);}finally{s.db.close();}
});
test('Reload und Serverneustart erhalten Aufgaben, Verbindungen und fertige Auswertung',()=>{
 const dir=mkdtempSync(join(tmpdir(),'funk-test-'));let s=new Store(join(dir,'game.db'));try{
  s.create({...settings,teamCount:2,roundCount:1});const tokens=[s.join('Funk2026'),s.join('Funk2026')];s.start();
  const before=s.teamState(tokens[0]);s.db.close();s=new Store(join(dir,'game.db'));const after=s.teamState(tokens[0]);
  assert.deepEqual({...after,stats:null},{...before,stats:null});completeRound(s,tokens);
  const review=s.adminState(new Set()).review;s.db.close();s=new Store(join(dir,'game.db'));assert.deepEqual(s.adminState(new Set()).review,review);
 }finally{s.db.close();rmSync(dir,{recursive:true,force:true});}
});
test('Vorhandene Spielstände werden samt Antworten und Gruppen-Sessions übernommen',()=>{
 const dir=mkdtempSync(join(tmpdir(),'funk-alt-')),file=join(dir,'game.db');
 const db=new Database(file);
 db.exec(`
  CREATE TABLE games (id TEXT PRIMARY KEY,name TEXT,status TEXT,team_count INTEGER,round_count INTEGER,password TEXT,created_at INTEGER,started_at INTEGER,finished_at INTEGER);
  CREATE TABLE teams (id INTEGER PRIMARY KEY,number INTEGER UNIQUE,token TEXT UNIQUE,joined_at INTEGER);
  CREATE TABLE pairs (id INTEGER PRIMARY KEY,a INTEGER,b INTEGER,current_round INTEGER,finished_at INTEGER);
  CREATE TABLE rounds (id INTEGER PRIMARY KEY,pair_id INTEGER,number INTEGER,finished_at INTEGER,skipped INTEGER);
  CREATE TABLE tasks (id INTEGER PRIMARY KEY,round_id INTEGER,sender INTEGER,receiver INTEGER,exercise TEXT,sender_confirmed INTEGER,receiver_confirmed INTEGER,answer_correct INTEGER,failed_attempts INTEGER,answer TEXT,feedback TEXT);
 `);
 const word=pool.find(e=>e.type==='word')!;
 db.prepare('INSERT INTO games VALUES (?,?,?,?,?,?,?,?,?)').run('alt','Alte Übung','RUNNING',2,3,hashPassword('Funk2026'),1,2,null);
 db.exec("INSERT INTO teams VALUES (1,1,'gruppe-a',1),(2,2,'gruppe-b',1); INSERT INTO pairs VALUES (1,1,2,1,NULL); INSERT INTO rounds VALUES (1,1,1,NULL,0);");
 db.prepare('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(41,1,1,2,JSON.stringify(word),1,0,1,2,JSON.stringify(word.content),JSON.stringify({correct:true,fields:[true]}));
 db.prepare('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(42,1,2,1,JSON.stringify(pool.find(e=>e.type==='drawing')!),0,0,0,0,null,null);
 db.close();let s=new Store(file);try{
  assert.equal(s.teamState('gruppe-a').send!.id,41);assert.equal(s.teamState('gruppe-b').receive!.answer,word.content);
  assert.equal(s.tasks(s.current()!.id)[0].failed_attempts,2);
  s.db.close();s=new Store(file);assert.equal(s.tasks(s.current()!.id).length,2);
  s.confirm('gruppe-b',41,'receiver');s.confirm('gruppe-b',42,'sender');s.confirm('gruppe-a',42,'receiver');assert.equal(s.current()!.number,2);
  s.create(settings);assert.equal(s.team('gruppe-a'),undefined);assert.equal(s.rounds().length,0);
 }finally{s.db.close();rmSync(dir,{recursive:true,force:true});}
});
test('Normalisierung und positionsgenaue Ausrüstungslisten',()=>{
 assert.equal(normalize('  übung  auf der straße  '),'UEBUNG AUF DER STRASSE');
 assert.equal(normalize('ÄÖÜß'),normalize('aeoeuess'));
 const list=pool.find(e=>e.type==='equipment')!;
 const items=[...list.content as string[]];
 assert.equal(evaluate(list,items.map(item=>item.toLowerCase())).correct,true);
 items[2]='Falsch';
 assert.deepEqual(evaluate(list,items).fields,[true,true,false,true,true,true]);
 assert.equal(evaluate(list,null).correct,false);
 assert.throws(()=>evaluate(pool.find(e=>e.type==='message')!,{}),/keine automatische Prüfung/);
});
test('Aufgabenpool erfüllt Mindestgrößen und bleibt ausgewogen ohne Wiederholungen',()=>{
 for(const [type,min] of [['drawing',15],['word',40],['message',20],['equipment',20]] as const)assert.ok(pool.filter(e=>e.type===type).length>=min);
 const used:Exercise[]=[];for(let i=0;i<60;i++)used.push(pickExercise(used));assert.equal(new Set(used.map(e=>e.id)).size,60);for(const type of ['drawing','word','message','equipment'])assert.equal(used.filter(e=>e.type===type).length,15);
 const exhausted=pool.filter(e=>e.type==='drawing');const previous=[...exhausted,...pool.filter(e=>e.type!=='drawing').slice(0,0)];assert.ok(pickExercise(previous));
});

test('Aufgabeninhalte sind ohne Codeänderung austauschbar; ungültige Dateien werden abgelehnt',()=>{
 const dir=mkdtempSync(join(tmpdir(),'funk-pool-'));try{
  cpSync('backend/data',dir,{recursive:true});
  writeFileSync(join(dir,'words.json'),JSON.stringify(['NEUER BEGRIFF']));
  writeFileSync(join(dir,'messages.json'),JSON.stringify([{'Rufname':'Florian Test 1','Neue Lage':'Fiktive Übung','Zufahrt':'Nordtor'}]));
  const loaded=loadPool(dir);
  assert.deepEqual(loaded.filter(e=>e.type==='word').map(e=>e.content),['NEUER BEGRIFF']);
  assert.deepEqual(loaded.find(e=>e.type==='message')!.content,{'Rufname':'Florian Test 1','Neue Lage':'Fiktive Übung','Zufahrt':'Nordtor'});
  writeFileSync(join(dir,'equipment.json'),JSON.stringify([['Zu kurz']]));
  assert.throws(()=>loadPool(dir),/sechs Gegenständen/);
  writeFileSync(join(dir,'words.json'),'[]');assert.throws(()=>loadPool(dir),/nicht leere Liste/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('SVGs werden automatisch entdeckt und behalten beim Hinzufügen ihre Aufgabenkennung',()=>{
 const dir=mkdtempSync(join(tmpdir(),'funk-skizzen-'));try{
  assert.throws(()=>loadDrawings(dir),/mindestens eine SVG/);
  writeFileSync(join(dir,'b-skizze.svg'),'<svg xmlns="http://www.w3.org/2000/svg"/>');
  const original=loadDrawings(dir)[0];
  writeFileSync(join(dir,'a neue Skizze.SVG'),'<svg xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(join(dir,'hinweis.txt'),'Keine Skizze');
  mkdirSync(join(dir,'ordner.svg'));
  const drawings=loadDrawings(dir);
  assert.deepEqual(drawings.map(d=>d.content),['a neue Skizze.SVG','b-skizze.svg']);
  assert.deepEqual(drawings.find(d=>d.content==='b-skizze.svg'),original);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Reset löscht Lobby, Spielstände und Auswertung; während RUNNING wird er abgelehnt',()=>{
 const s=new Store(':memory:');try{
  s.reset();assert.equal(s.game(),undefined);
  s.create(settings);const old=s.join('Funk2026');s.reset();assert.equal(s.team(old),undefined);assert.equal(s.teams().length,0);
  s.create({...settings,teamCount:2,roundCount:1});const sessions=[s.join('Funk2026'),s.join('Funk2026')];s.start();
  assert.throws(()=>s.reset(),/laufende Übung/);assert.equal(s.game()!.status,'RUNNING');assert.equal(s.rounds().length,1);
  completeRound(s,sessions);assert.equal(s.adminState(new Set()).review.length,1);
  s.reset();assert.deepEqual(s.publicState(),{game:null});assert.equal(s.teams().length,0);assert.equal(s.rounds().length,0);
  assert.equal((s.db.prepare('SELECT COUNT(*) AS n FROM round_tasks').get() as {n:number}).n,0);
  assert.deepEqual(s.adminState(new Set()).review,[]);assert.equal(s.team(sessions[0]),undefined);s.reset();
 }finally{s.db.close();}
});
test('Eine richtige Prüfung als letzte Bestätigung wechselt nur einmal in die nächste Runde',()=>{
 const {store:s,tokens}=ready(2);try{
  const tasks=s.tasks(s.current()!.id),word=pool.find(e=>e.type==='word')!,drawing=pool.find(e=>e.type==='drawing')!;
  s.db.prepare('UPDATE round_tasks SET exercise=? WHERE id=?').run(JSON.stringify(word),tasks[0].id);
  s.db.prepare('UPDATE round_tasks SET exercise=? WHERE id=?').run(JSON.stringify(drawing),tasks[1].id);
  for(const task of tasks)s.confirm(tokens[task.sender-1],task.id,'sender');
  s.confirm(tokens[tasks[1].receiver-1],tasks[1].id,'receiver');assert.equal(s.current()!.number,1);
  assert.equal(s.answer(tokens[tasks[0].receiver-1],tasks[0].id,word.content).correct,true);assert.equal(s.current()!.number,2);
  s.answer(tokens[tasks[0].receiver-1],tasks[0].id,word.content);assert.equal(s.current()!.number,2);assert.equal(s.rounds().length,2);
 }finally{s.db.close();}
});
test('Die Live-Übersicht enthält konkrete Aufgaben und beide Bestätigungen ohne Gruppen-Sessions',()=>{
 const {store:s,tokens}=ready(4);try{
  const live=s.adminState(new Set([1])),tasks=s.tasks(s.current()!.id);
  assert.equal(live.round!.tasks.length,4);
  for(const task of tasks){const view=live.round!.tasks.find(t=>t.id===task.id)!,exercise=JSON.parse(task.exercise) as Exercise;
   assert.equal(view.sender,task.sender);assert.equal(view.receiver,task.receiver);
   if(exercise.type==='drawing')assert.ok(view.drawing);else assert.deepEqual(view.content,exercise.content);
   assert.equal(view.senderConfirmed,false);assert.equal(view.receiverConfirmed,false);
  }
  s.confirm(tokens[tasks[0].sender-1],tasks[0].id,'sender');
  assert.equal(s.adminState(new Set()).round!.tasks.find(t=>t.id===tasks[0].id)!.senderConfirmed,true);
  assert.equal('tasks' in s.teamState(tokens[0]).round!,false);
  assert.equal(JSON.stringify(live).includes(tokens[0]),false);
 }finally{s.db.close();}
});
