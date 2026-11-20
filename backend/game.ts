import Database from 'better-sqlite3';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { evaluate, pickExercise, requiresAnswer, type Exercise } from './pool.js';
import { nextConnections, type Connection } from './connections.js';

export class GameError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export interface Game { id: string; name: string; status: 'LOBBY'|'RUNNING'|'FINISHED'; team_count: number; round_count: number; password: string; created_at: number; started_at: number|null; finished_at: number|null }
export interface Team { id: number; number: number; token: string|null; joined_at: number|null }
export interface Round { id: number; number: number; finished_at: number|null; skipped: number; legacy: number }
export interface Task { id: number; round_id: number; sender: number; receiver: number; exercise: string; sender_confirmed: number; receiver_confirmed: number; answer_correct: number; failed_attempts: number; answer: string|null; feedback: string|null }
export const token = () => randomBytes(32).toString('hex');
export function hashPassword(password: string) { const salt=randomBytes(16).toString('hex');return `${salt}:${scryptSync(password,salt,32).toString('hex')}`; }
export function verifyPassword(password: string, hash: string) { const [salt,hex]=hash.split(':');const actual=scryptSync(password,salt,32),expected=Buffer.from(hex,'hex');return expected.length===actual.length && timingSafeEqual(expected,actual); }
const requireThat: (condition: unknown, message: string, status?: number) => asserts condition = (condition,message,status=400)=>{if(!condition)throw new GameError(message,status);};

export class Store {
  db: Database.Database;
  constructor(path: string) {
    if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});
    this.db=new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL, team_count INTEGER NOT NULL, round_count INTEGER NOT NULL, password TEXT NOT NULL, created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER);
      CREATE TABLE IF NOT EXISTS teams (id INTEGER PRIMARY KEY, number INTEGER NOT NULL UNIQUE, token TEXT UNIQUE, joined_at INTEGER);
      CREATE TABLE IF NOT EXISTS game_rounds (id INTEGER PRIMARY KEY AUTOINCREMENT, number INTEGER NOT NULL UNIQUE, finished_at INTEGER, skipped INTEGER NOT NULL DEFAULT 0, legacy INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS round_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, round_id INTEGER NOT NULL REFERENCES game_rounds(id) ON DELETE CASCADE, sender INTEGER NOT NULL REFERENCES teams(id), receiver INTEGER NOT NULL REFERENCES teams(id), exercise TEXT NOT NULL, sender_confirmed INTEGER NOT NULL DEFAULT 0, receiver_confirmed INTEGER NOT NULL DEFAULT 0, answer_correct INTEGER NOT NULL DEFAULT 0, failed_attempts INTEGER NOT NULL DEFAULT 0, answer TEXT, feedback TEXT, UNIQUE(round_id,sender), UNIQUE(round_id,receiver));
    `);
    this.importLegacyRounds();
  }
  game() {return this.db.prepare('SELECT * FROM games LIMIT 1').get() as Game|undefined;}
  teams() {return this.db.prepare('SELECT * FROM teams ORDER BY number').all() as Team[];}
  team(session: unknown) {return typeof session==='string' && session ? this.db.prepare('SELECT * FROM teams WHERE token=?').get(session) as Team|undefined : undefined;}
  rounds() {return this.db.prepare('SELECT * FROM game_rounds ORDER BY number').all() as Round[];}
  current() {const rounds=this.rounds();return rounds.find(r=>!r.finished_at) ?? rounds.at(-1);}
  tasks(roundId: number) {return this.db.prepare('SELECT * FROM round_tasks WHERE round_id=? ORDER BY sender').all(roundId) as Task[];}
  private hasLegacyTables() {return Boolean(this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pairs'").get());}

  // Alte Spielstände bleiben erhalten. Bereits vergebene Aufträge werden nicht ausgetauscht.
  private importLegacyRounds() {
    if(!this.hasLegacyTables() || this.rounds().length || !this.game())return;
    const oldRounds=this.db.prepare('SELECT * FROM rounds ORDER BY number').all() as (Round & {pair_id:number})[];
    if(!oldRounds.length)return;
    this.db.transaction(()=>{
      const mapping=new Map<number,number>();
      for(const number of [...new Set(oldRounds.map(r=>r.number))]) {
        const related=oldRounds.filter(r=>r.number===number);
        const complete=related.length===this.game()!.team_count/2 && related.every(r=>r.finished_at);
        const finished=complete?Math.max(...related.map(r=>r.finished_at!)):null;
        const result=this.db.prepare('INSERT INTO game_rounds (number,finished_at,skipped,legacy) VALUES (?,?,?,1)').run(number,finished,Number(related.some(r=>r.skipped)));
        mapping.set(number,Number(result.lastInsertRowid));
      }
      const oldTasks=this.db.prepare('SELECT tasks.* FROM tasks ORDER BY id').all() as Task[];
      for(const t of oldTasks) {
        const old=oldRounds.find(r=>r.id===t.round_id)!;
        this.db.prepare('INSERT INTO round_tasks VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(t.id,mapping.get(old.number),t.sender,t.receiver,t.exercise,t.sender_confirmed,t.receiver_confirmed,t.answer_correct,t.failed_attempts,t.answer,t.feedback);
      }
      // Bei unterschiedlich weit fortgeschrittenen alten Funkpaaren fehlende Aufträge ergänzen.
      const oldPairs=this.db.prepare('SELECT a,b FROM pairs').all() as {a:number;b:number}[];
      for(const round of this.rounds()) {
        const existing=new Set(this.tasks(round.id).map(t=>t.sender));
        const missing=oldPairs.flatMap(p=>[{sender:p.a,receiver:p.b},{sender:p.b,receiver:p.a}]).filter(edge=>!existing.has(edge.sender));
        this.addTasks(round.id,missing);
      }
    }).immediate();
  }
  private clearGame() {
    this.db.exec('DELETE FROM round_tasks; DELETE FROM game_rounds;');
    if(this.hasLegacyTables())this.db.exec('DELETE FROM tasks; DELETE FROM rounds; DELETE FROM pairs;');
    this.db.exec('DELETE FROM teams; DELETE FROM games;');
  }
  reset() {
    this.db.transaction(()=>{
      requireThat(this.game()?.status!=='RUNNING','Eine laufende Übung kann nicht zurückgesetzt werden.',409);
      this.clearGame();
    }).immediate();
  }
  create(input: {name?: unknown; teamCount?: unknown; roundCount?: unknown; password?: unknown}) {
    requireThat([2,4,6].includes(input.teamCount as number),'Wähle 2, 4 oder 6 Gruppen.');
    requireThat(Number.isInteger(input.roundCount) && Number(input.roundCount)>=1 && Number(input.roundCount)<=15,'Wähle zwischen 1 und 15 Runden.');
    requireThat(typeof input.password==='string' && input.password.trim().length>0 && input.password.length<=128,'Ein Beitrittspasswort mit höchstens 128 Zeichen ist erforderlich.');
    requireThat(input.name===undefined || (typeof input.name==='string' && input.name.length<=100),'Der Spielname darf höchstens 100 Zeichen enthalten.');
    const password=hashPassword(input.password);
    this.db.transaction(()=>{
      this.clearGame();
      this.db.prepare('INSERT INTO games VALUES (?,?,?,?,?,?,?,?,?)').run(token(),(input.name as string)?.trim()||'Digitalfunkübung','LOBBY',input.teamCount,input.roundCount,password,Date.now(),null,null);
      for(let i=1;i<=Number(input.teamCount);i++)this.db.prepare('INSERT INTO teams (id,number) VALUES (?,?)').run(i,i);
    }).immediate();
  }
  join(password: unknown) {
    requireThat(typeof password==='string' && password.length<=128,'Falsches Beitrittspasswort.',401);
    const game=this.game();
    requireThat(game?.status==='LOBBY','Ein Beitritt ist derzeit nicht möglich.',409);
    requireThat(verifyPassword(password,game.password),'Falsches Beitrittspasswort.',401);
    return this.db.transaction(()=>{
      requireThat(this.game()?.id===game.id && this.game()?.status==='LOBBY','Das Game wurde geändert.',409);
      const team=this.db.prepare('SELECT * FROM teams WHERE token IS NULL ORDER BY number LIMIT 1').get() as Team|undefined;
      requireThat(team,'Alle Gruppenplätze sind bereits belegt.',409);
      const session=token();this.db.prepare('UPDATE teams SET token=?,joined_at=? WHERE id=?').run(session,Date.now(),team.id);
      return session;
    }).immediate();
  }
  release(teamId: number) {
    this.db.transaction(()=>{
      requireThat(this.game()?.status==='LOBBY','Gruppenplätze können nur in der Lobby freigegeben werden.',409);
      requireThat(this.teams().some(t=>t.id===teamId),'Gruppe nicht gefunden.',404);
      this.db.prepare('UPDATE teams SET token=NULL,joined_at=NULL WHERE id=?').run(teamId);
    }).immediate();
  }
  start() {
    this.db.transaction(()=>{
      requireThat(this.game()?.status==='LOBBY','Das Game kann nicht gestartet werden.',409);
      requireThat(this.teams().every(t=>t.token),'Es müssen alle Gruppen beigetreten sein.',409);
      this.db.prepare("UPDATE games SET status='RUNNING',started_at=?").run(Date.now());
      this.newRound(1);
    }).immediate();
  }
  private addTasks(roundId: number, connections: Connection[]) {
    for(const edge of connections) {
      const previous=(this.db.prepare('SELECT exercise FROM round_tasks WHERE sender IN (?,?) OR receiver IN (?,?) ORDER BY id').all(edge.sender,edge.receiver,edge.sender,edge.receiver) as {exercise:string}[]).map(t=>JSON.parse(t.exercise) as Exercise);
      const exercise=pickExercise(previous);
      this.db.prepare('INSERT INTO round_tasks (round_id,sender,receiver,exercise) VALUES (?,?,?,?)').run(roundId,edge.sender,edge.receiver,JSON.stringify(exercise));
    }
  }
  private newRound(number: number) {
    const previous=this.rounds().find(r=>r.number===number-1);
    const connections=nextConnections(this.teams().map(t=>t.id),previous?this.tasks(previous.id):[]);
    const id=Number(this.db.prepare('INSERT INTO game_rounds (number) VALUES (?)').run(number).lastInsertRowid);
    this.addTasks(id,connections);
  }
  private advance(round: Round, skipped=false) {
    requireThat(!round.finished_at,'Diese Runde ist bereits abgeschlossen.',409);
    this.db.prepare('UPDATE game_rounds SET finished_at=?,skipped=? WHERE id=?').run(Date.now(),Number(skipped),round.id);
    if(round.number>=this.game()!.round_count)this.db.prepare("UPDATE games SET status='FINISHED',finished_at=?").run(Date.now());
    else if(!this.rounds().some(r=>r.number===round.number+1))this.newRound(round.number+1);
  }
  confirm(session: string, taskId: number, role: unknown) {
    this.db.transaction(()=>{
      const team=this.team(session);requireThat(team,'Gruppen-Session ist ungültig.',401);
      requireThat(role==='sender'||role==='receiver','Ungültige Bestätigung.');
      const task=this.db.prepare('SELECT * FROM round_tasks WHERE id=?').get(taskId) as Task|undefined;
      requireThat(task && task[role]===team.id,'Dieser Auftrag gehört nicht zu deiner Gruppe.',403);
      if(task[role==='sender'?'sender_confirmed':'receiver_confirmed'])return;
      requireThat(this.game()?.status==='RUNNING','Das Game läuft nicht.',409);
      const round=this.current();requireThat(round && !round.finished_at && round.id===task.round_id,'Die Runde wurde bereits beendet.',409);
      if(role==='receiver' && requiresAnswer((JSON.parse(task.exercise) as Exercise).type))requireThat(evaluate(JSON.parse(task.exercise),task.answer?JSON.parse(task.answer):null).correct,'Bitte zuerst alle Eingaben korrekt ausfüllen und prüfen.',409);
      this.db.prepare(`UPDATE round_tasks SET ${role==='sender'?'sender_confirmed':'receiver_confirmed'}=1 WHERE id=?`).run(task.id);
      if(this.tasks(round.id).every(t=>t.sender_confirmed && t.receiver_confirmed))this.advance(round);
    }).immediate();
  }
  skip(roundId: number) {
    this.db.transaction(()=>{
      requireThat(this.game()?.status==='RUNNING','Das Game läuft nicht.',409);
      const round=this.current();requireThat(round && !round.finished_at && round.id===roundId,'Die Runde wurde bereits geändert.',409);
      this.advance(round,true);
    }).immediate();
  }
  finish() {
    this.db.transaction(()=>{
      requireThat(this.game()?.status==='RUNNING','Das Game läuft nicht.',409);
      this.db.prepare("UPDATE games SET status='FINISHED',finished_at=?").run(Date.now());
    }).immediate();
  }
  answer(session: string, taskId: number, answer: unknown) {
    return this.db.transaction(()=>{
      const team=this.team(session);requireThat(team,'Gruppen-Session ist ungültig.',401);
      const task=this.db.prepare('SELECT * FROM round_tasks WHERE id=?').get(taskId) as Task|undefined;
      requireThat(task?.receiver===team.id,'Dieser Empfangsauftrag gehört nicht zu deiner Gruppe.',403);
      const exercise=JSON.parse(task.exercise) as Exercise;
      requireThat(requiresAnswer(exercise.type),'Diese Aufgabe wird ausschließlich über Funk bestätigt.');
      requireThat(JSON.stringify(answer??null).length<=5000,'Die Antwort ist zu lang.');
      // Wiederholte richtige Prüfungen ändern weder Statistik noch Rundenfortschritt.
      if(task.receiver_confirmed) {
        const previous=task.feedback?JSON.parse(task.feedback) as ReturnType<typeof evaluate>:null;
        requireThat(previous?.correct && evaluate(exercise,answer).correct,'Dieser Empfangsauftrag ist bereits abgeschlossen.',409);
        return previous;
      }
      const round=this.current();requireThat(this.game()?.status==='RUNNING' && round && !round.finished_at && round.id===task.round_id,'Dieser Empfangsauftrag ist bereits abgeschlossen.',409);
      const feedback=evaluate(exercise,answer);
      this.db.prepare('UPDATE round_tasks SET answer=?,feedback=?,answer_correct=MAX(answer_correct,?),failed_attempts=failed_attempts+? WHERE id=?').run(JSON.stringify(answer??null),JSON.stringify(feedback),Number(feedback.correct),Number(!feedback.correct),task.id);
      if(feedback.correct) {
        this.db.prepare('UPDATE round_tasks SET receiver_confirmed=1 WHERE id=?').run(task.id);
        if(this.tasks(round.id).every(t=>t.sender_confirmed && t.receiver_confirmed))this.advance(round);
      }
      return feedback;
    }).immediate();
  }
  publicState() {
    const game=this.game();
    return {game:game?{id:game.id,name:game.name,status:game.status,teamCount:game.team_count,roundCount:game.round_count,joined:this.teams().filter(t=>t.token).length,startedAt:game.started_at,finishedAt:game.finished_at}:null};
  }
  stats(teamId?: number) {
    const tasks=this.db.prepare(`SELECT * FROM round_tasks ${teamId?'WHERE receiver=?':''}`).all(...(teamId?[teamId]:[])) as Task[];
    const game=this.game();
    return {completedRounds:this.rounds().filter(r=>r.finished_at).length,correct:tasks.filter(t=>t.answer_correct).length,failedAttempts:tasks.reduce((sum,t)=>sum+t.failed_attempts,0),duration:game?.started_at?(game.finished_at??Date.now())-game.started_at:0};
  }
  private taskView(t: Task, sender: boolean) {
    const e=JSON.parse(t.exercise) as Exercise;
    return {id:t.id,type:e.type,partner:sender?t.receiver:t.sender,confirmed:Boolean(sender?t.sender_confirmed:t.receiver_confirmed),
      ...(sender||t.receiver_confirmed?{content:e.type==='drawing'?undefined:e.content,drawing:e.type==='drawing'?`/api/drawings/${t.id}`:undefined}:{}),
      ...(!sender?{answer:t.answer?JSON.parse(t.answer):null,feedback:t.feedback?JSON.parse(t.feedback):null}:{})};
  }
  teamState(session: string) {
    const team=this.team(session);requireThat(team,'Gruppen-Session ist ungültig.',401);
    const round=this.current(),tasks=round?this.tasks(round.id):[];
    const send=tasks.find(t=>t.sender===team.id),receive=tasks.find(t=>t.receiver===team.id);
    return {...this.publicState(),team:{number:team.number},round:round?{id:round.id,number:round.number,finished:Boolean(round.finished_at)}:null,
      send:send?this.taskView(send,true):null,receive:receive?this.taskView(receive,false):null,stats:this.stats(team.id)};
  }
  drawing(session: string, taskId: number, admin=false) {
    const task=this.db.prepare('SELECT * FROM round_tasks WHERE id=?').get(taskId) as Task|undefined;
    const team=this.team(session);
    requireThat(task && (admin || (team && (task.sender===team.id || (task.receiver===team.id && task.receiver_confirmed)))),'Zeichnung nicht freigegeben.',403);
    const exercise=JSON.parse(task.exercise) as Exercise;requireThat(exercise.type==='drawing','Zeichnung nicht gefunden.',404);
    return exercise.content as string;
  }
  private review() {
    if(this.game()?.status!=='FINISHED')return [];
    return this.rounds().map(round=>({id:round.id,number:round.number,finished:Boolean(round.finished_at),skipped:Boolean(round.skipped),legacy:Boolean(round.legacy),tasks:this.tasks(round.id).map(t=>{
      const e=JSON.parse(t.exercise) as Exercise,automatic=requiresAnswer(e.type);
      return {id:t.id,sender:t.sender,receiver:t.receiver,type:e.type,content:e.type==='drawing'?undefined:e.content,drawing:e.type==='drawing'?`/api/drawings/${t.id}`:undefined,
        senderConfirmed:Boolean(t.sender_confirmed),receiverConfirmed:Boolean(t.receiver_confirmed),
        ...(automatic?{answer:t.answer?JSON.parse(t.answer):null,feedback:t.feedback?JSON.parse(t.feedback):null,correct:Boolean(t.answer_correct),failedAttempts:t.failed_attempts}:{})};
    })}));
  }
  adminState(online: Set<number>) {
    const round=this.current(),tasks=round?this.tasks(round.id):[];
    return {...this.publicState(),teams:this.teams().map(t=>({number:t.number,joined:Boolean(t.token),online:online.has(t.id),sendTo:tasks.find(x=>x.sender===t.id)?.receiver??null,receiveFrom:tasks.find(x=>x.receiver===t.id)?.sender??null})),
      round:round?{id:round.id,number:round.number,finished:Boolean(round.finished_at),tasks:tasks.map(t=>{const exercise=JSON.parse(t.exercise) as Exercise;return {id:t.id,sender:t.sender,receiver:t.receiver,type:exercise.type,content:exercise.type==='drawing'?undefined:exercise.content,drawing:exercise.type==='drawing'?`/api/drawings/${t.id}`:undefined,senderConfirmed:Boolean(t.sender_confirmed),receiverConfirmed:Boolean(t.receiver_confirmed)};})}:null,
      review:this.review(),stats:this.stats()};
  }
}
