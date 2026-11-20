import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {io as client,type Socket} from 'socket.io-client';
import {Store} from '../backend/game.js';
import {createApp} from '../backend/server.js';
import type {State} from '../frontend/src/types.js';

async function fixture(){
 const store=new Store(':memory:');const app=createApp(store,'Admin-Test');
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
 const address=app.server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
 const request=async(path:string,body?:unknown,headers:Record<string,string>={})=>{const response=await fetch(`${base}/api${path}`,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,headers:response.headers,data:await response.json()};};
 const login=await request('/admin/login',{password:'Admin-Test'});const cookie=login.headers.get('set-cookie')!.split(';')[0];
 const sockets:Socket[]=[];
 function socket(auth:Record<string,unknown>,withCookie=false,origin?:string){const s=client(base,{autoConnect:false,auth,extraHeaders:{...(withCookie?{cookie}:{}),...(origin?{origin}:{})},transports:['websocket'],reconnection:false});sockets.push(s);return s;}
 async function close(){sockets.forEach(s=>s.disconnect());await new Promise<void>(resolve=>app.io.close(()=>resolve()));store.db.close();}
 return {store,request,cookie,socket,close,base};
}
function nextState(s:Socket,predicate:(state:State)=>boolean=()=>true):Promise<State>{return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{s.off('state',listener);reject(new Error('Kein passender Socket-Zustand empfangen.'));},4000);function listener(state:State){if(predicate(state)){clearTimeout(timeout);s.off('state',listener);resolve(state);}}s.on('state',listener);});}

test('HTTP schützt Admin-Aktionen und setzt eine HttpOnly-Session',async()=>{
 const f=await fixture();try{
 assert.equal((await f.request('/admin/state')).status,401);assert.equal((await f.request('/admin/game',{})).status,401);
 assert.equal((await f.request('/admin/login',{password:'falsch'})).status,401);
 const login=await f.request('/admin/login',{password:'Admin-Test'});assert.match(login.headers.get('set-cookie')!,/HttpOnly/);assert.match(login.headers.get('set-cookie')!,/SameSite=Strict/);
 assert.equal((await f.request('/admin/game',{teamCount:2,roundCount:5,password:'Team'},{cookie:f.cookie})).status,200);
 assert.equal((await f.request('/join',{password:'falsch'})).data.error,'Falsches Beitrittspasswort.');
 const joined=await f.request('/join',{password:'Team'});assert.equal(joined.status,200);assert.equal((await f.request('/state',undefined,{Authorization:`Bearer ${joined.data.token}`})).data.team.number,1);
 assert.equal((await f.request('/admin/logout',{}, {cookie:f.cookie})).status,200);assert.equal((await f.request('/admin/state',undefined,{cookie:f.cookie})).status,401);
 }finally{await f.close();}
});
test('Anmeldung und Socket funktionieren mit abweichendem Host hinter dem Entwicklungsproxy',async()=>{
 const f=await fixture();try{
  const origin='http://localhost:5173';
  assert.equal((await f.request('/admin/login',{password:'falsch'},{origin})).status,401);
  const login=await f.request('/admin/login',{password:'Admin-Test'},{origin});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await f.request('/admin/state',undefined,{cookie,origin})).status,200);
  const socket=f.socket({admin:true},true,origin);
  const state=nextState(socket);socket.connect();
  assert.ok(Array.isArray((await state).teams));
 }finally{await f.close();}
});
test('Parallele HTTP-Beitritte vergeben jeden Platz einmal und liefern Live-Lobbyänderungen',async()=>{
 const f=await fixture();try{
 await f.request('/admin/game',{teamCount:6,roundCount:5,password:'Team'},{cookie:f.cookie});
 const observer=f.socket({});const first=nextState(observer);observer.connect();await first;
 const ready=nextState(observer,s=>s.game?.joined===6);
 const joins=await Promise.all(Array.from({length:10},()=>f.request('/join',{password:'Team'})));
 const success=joins.filter(r=>r.status===200);assert.equal(success.length,6);assert.deepEqual(success.map(r=>r.data.state.team.number).sort(),[1,2,3,4,5,6]);assert.equal(joins.filter(r=>r.status===409).length,4);
 const publicState=await ready;assert.equal('teams' in publicState,false);assert.equal('password' in publicState.game!,false);
 const start=await f.request('/admin/start',{}, {cookie:f.cookie});assert.equal(start.status,200);assert.equal(start.data.round.tasks.length,6);
 assert.equal((await f.request('/join',{password:'Team'})).status,409);
 }finally{await f.close();}
});
test('Sockets liefern getrennte Zustände, Präsenz und nach Reconnect den Spielstand',async()=>{
 const f=await fixture();try{
 await f.request('/admin/game',{teamCount:2,roundCount:5,password:'Team'},{cookie:f.cookie});
 const a=(await f.request('/join',{password:'Team'})).data.token,b=(await f.request('/join',{password:'Team'})).data.token;
 const admin=f.socket({admin:true},true),viewer=f.socket({admin:true});
 let pending=nextState(admin);admin.connect();await pending;pending=nextState(viewer);viewer.connect();const unauthorized=await pending;assert.equal('teams' in unauthorized,false);
 const team=f.socket({token:a}),presence=nextState(admin,s=>s.teams?.[0].online===true);pending=nextState(team);team.connect();await pending;await presence;
 pending=nextState(team,s=>Boolean(s.send&&s.receive));await f.request('/admin/start',{}, {cookie:f.cookie});const state=await pending;
 assert.equal(state.receive!.content,undefined);assert.equal(state.receive!.drawing,undefined);assert.equal('tasks' in state,false);
 const headers={Authorization:`Bearer ${a}`};assert.equal((await f.request(`/tasks/${state.receive!.id}/confirm`,{role:'sender'},headers)).status,403);
 await f.request(`/tasks/${state.send!.id}/confirm`,{role:'sender'},headers);
 const offline=nextState(admin,s=>s.teams?.[0].online===false);team.disconnect();await offline;
 pending=nextState(team,s=>s.send?.confirmed===true);team.connect();const restored=await pending;assert.equal(restored.team!.number,1);assert.equal(restored.send!.id,state.send!.id);
 assert.equal((await f.request('/state',undefined,{Authorization:`Bearer ${b}`})).data.team.number,2);
 const invalid=nextState(team,s=>s.sessionInvalid===true);await f.request('/admin/game',{teamCount:2,roundCount:5,password:'Neu'},{cookie:f.cookie});await invalid;assert.equal((await f.request('/state',undefined,headers)).status,401);
 }finally{await f.close();}
});
for(const count of [2,4,6])test(`${count} Gruppen: gleichzeitige und doppelte HTTP-Bestätigungen wechseln genau eine Runde`,async()=>{
 const f=await fixture();try{
 await f.request('/admin/game',{teamCount:count,roundCount:5,password:'Team'},{cookie:f.cookie});
 const tokens:string[]=[];for(let i=0;i<count;i++)tokens.push((await f.request('/join',{password:'Team'})).data.token);
 await f.request('/admin/start',{}, {cookie:f.cookie});const tasks=f.store.tasks(f.store.current()!.id);
 for(const task of tasks){const e=JSON.parse(task.exercise);if(e.type==='word'||e.type==='equipment')assert.equal((await f.request(`/tasks/${task.id}/answer`,{answer:e.content},{Authorization:`Bearer ${tokens[task.receiver-1]}`})).status,200);}
 const confirmations=tasks.flatMap(t=>[{id:t.id,role:'sender',token:tokens[t.sender-1]},{id:t.id,role:'receiver',token:tokens[t.receiver-1]}]);
 const result=await Promise.all([...confirmations,...confirmations].map(r=>f.request(`/tasks/${r.id}/confirm`,{role:r.role},{Authorization:`Bearer ${r.token}`})));
 assert.ok(result.every(r=>r.status===200));assert.equal(f.store.current()!.number,2);
 assert.equal((f.store.db.prepare('SELECT COUNT(*) AS count FROM game_rounds').get() as {count:number}).count,2);
 }finally{await f.close();}
});

test('Auswertung und Originalskizzen bleiben dem Gamemaster vorbehalten',async()=>{
 const f=await fixture();try{
  await f.request('/admin/game',{teamCount:4,roundCount:1,password:'Gruppe'},{cookie:f.cookie});
  const tokens:string[]=[];for(let i=0;i<4;i++)tokens.push((await f.request('/join',{password:'Gruppe'})).data.token);
  await f.request('/admin/start',{}, {cookie:f.cookie});
  const tasks=f.store.tasks(f.store.current()!.id);
  const {pool}=await import('../backend/pool.js');
  ['drawing','message','word','equipment'].forEach((type,i)=>f.store.db.prepare('UPDATE round_tasks SET exercise=? WHERE id=?').run(JSON.stringify(pool.find(e=>e.type===type)!),tasks[i].id));
  assert.deepEqual((await f.request('/admin/state',undefined,{cookie:f.cookie})).data.review,[]);
  const group=f.socket({token:tokens[0]}),pending=nextState(group,s=>s.game?.status==='FINISHED');group.connect();
  const finished=await f.request('/admin/finish',{}, {cookie:f.cookie});
  assert.equal(finished.data.review.length,1);assert.equal(finished.data.review[0].tasks.length,4);
  const drawing=finished.data.review[0].tasks[0],message=finished.data.review[0].tasks[1];
  assert.equal('answer' in drawing,false);assert.equal('answer' in message,false);
  const image=await fetch(f.base+drawing.drawing,{headers:{cookie:f.cookie}});
  assert.equal(image.status,200);assert.match(image.headers.get('content-type')!,/image\/svg\+xml/);assert.match(await image.text(),/<svg/);
  assert.equal((await fetch(f.base+drawing.drawing,{headers:{Authorization:`Bearer ${tokens[tasks[0].receiver-1]}`}})).status,403);
  assert.equal((await f.request('/admin/state')).status,401);
  assert.equal('review' in (await pending),false);
  assert.equal('review' in (await f.request('/state')).data,false);
  assert.equal('review' in (await f.request('/state',undefined,{Authorization:`Bearer ${tokens[0]}`})).data,false);
 }finally{await f.close();}
});

test('Reset ist geschützt, sperrt laufende Spiele und informiert verbundene Gruppen',async()=>{
 const f=await fixture();try{
  assert.equal((await f.request('/admin/reset',{})).status,401);
  await f.request('/admin/game',{teamCount:2,roundCount:1,password:'Gruppe'},{cookie:f.cookie});
  const session=(await f.request('/join',{password:'Gruppe'})).data.token;
  const group=f.socket({token:session}),initial=nextState(group);group.connect();await initial;
  const invalid=nextState(group,s=>s.sessionInvalid===true&&s.game===null);
  const reset=await f.request('/admin/reset',{}, {cookie:f.cookie});
  assert.equal(reset.status,200);assert.equal(reset.data.game,null);assert.deepEqual(reset.data.teams,[]);assert.deepEqual(reset.data.review,[]);await invalid;
  assert.equal((await f.request('/state',undefined,{Authorization:`Bearer ${session}`})).status,401);
  await f.request('/admin/game',{teamCount:2,roundCount:1,password:'Gruppe'},{cookie:f.cookie});
  await f.request('/join',{password:'Gruppe'});await f.request('/join',{password:'Gruppe'});await f.request('/admin/start',{}, {cookie:f.cookie});
  assert.equal((await f.request('/admin/reset',{}, {cookie:f.cookie})).status,409);
  await f.request('/admin/finish',{}, {cookie:f.cookie});assert.equal((await f.request('/admin/reset',{}, {cookie:f.cookie})).status,200);
 }finally{await f.close();}
});
test('Richtige Antwort bestätigt den Empfang und aktualisiert die Live-Übersicht',async()=>{
 const f=await fixture();try{
  await f.request('/admin/game',{teamCount:2,roundCount:2,password:'Gruppe'},{cookie:f.cookie});
  const tokens=[(await f.request('/join',{password:'Gruppe'})).data.token,(await f.request('/join',{password:'Gruppe'})).data.token];await f.request('/admin/start',{}, {cookie:f.cookie});
  const task=f.store.tasks(f.store.current()!.id)[0];
  const {pool}=await import('../backend/pool.js');const word=pool.find(e=>e.type==='word')!;
  f.store.db.prepare('UPDATE round_tasks SET exercise=? WHERE id=?').run(JSON.stringify(word),task.id);
  const admin=f.socket({admin:true},true),initial=nextState(admin);admin.connect();await initial;
  const updated=nextState(admin,s=>s.round?.tasks?.find(t=>t.id===task.id)?.receiverConfirmed===true);
  const headers={Authorization:`Bearer ${tokens[task.receiver-1]}`};
  assert.equal((await f.request(`/tasks/${task.id}/answer`,{answer:'Falsch'},headers)).data.correct,false);
  const result=await f.request(`/tasks/${task.id}/answer`,{answer:word.content},headers);assert.equal(result.status,200);assert.equal(result.data.correct,true);
  const live=await updated;assert.equal(live.round!.tasks!.find(t=>t.id===task.id)!.content,word.content);
  assert.equal((await f.request('/state',undefined,headers)).data.receive.confirmed,true);
  assert.equal((await f.request(`/tasks/${task.id}/answer`,{answer:word.content},headers)).status,200);
  assert.equal(f.store.stats(task.receiver).correct,1);
 }finally{await f.close();}
});
