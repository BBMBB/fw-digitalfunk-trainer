import React, {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {io} from 'socket.io-client';
import {taskTitles,type State,type TaskView,type Stats} from './types';
import './style.css';

const adminPage=window.location.pathname.replace(/\/$/,'')==='/admin';
function readToken(){try{return localStorage.getItem('digitalfunk-team')||'';}catch{return '';}}
class ApiError extends Error {constructor(message:string,public status:number){super(message);}}
async function api(path:string,body?:unknown,token='') {
 const response=await fetch(`/api${path}`,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json();if(!response.ok)throw new ApiError(data.error||'Die Anfrage ist fehlgeschlagen.',response.status);return data;
}
function RadioIcon({small=false}:{small?:boolean}){return <svg className={small?'icon':'radio-icon'} viewBox="0 0 40 48" fill="none" aria-hidden="true"><path d="M27 13V2M31 2h-4M12 12h19a4 4 0 0 1 4 4v25a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4V16a4 4 0 0 1 4-4Z" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round"/><rect x="14" y="19" width="15" height="9" rx="1" stroke="currentColor" strokeWidth="2"/><path d="M15 34h13M15 38h9M3 19v9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>}
function duration(ms:number){const seconds=Math.max(0,Math.floor(ms/1000));return `${Math.floor(seconds/3600)?`${Math.floor(seconds/3600)}:`:''}${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
const statusText={LOBBY:'Lobby geöffnet',RUNNING:'Übung läuft',FINISHED:'Übung beendet'};
function Badge({children,tone='muted'}:{children:React.ReactNode;tone?:string}){return <span className={`badge ${tone}`}>{children}</span>}
function App(){
 const [state,setState]=useState<State|null>(null),[token,setToken]=useState(readToken),[authenticated,setAuthenticated]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[connected,setConnected]=useState(false),[busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(true),[now,setNow]=useState(Date.now());
 function acceptState(next:State){setState(current=>current?._server===next._server && (current?._revision ?? -1)>(next._revision ?? -1)?current:next);}
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 function saveToken(value:string){try{value?localStorage.setItem('digitalfunk-team',value):localStorage.removeItem('digitalfunk-team');}catch{setNotice('Die Gruppenzuordnung kann in diesem Browser nicht dauerhaft gespeichert werden.');}setToken(value);}
 useEffect(()=>{
  let alive=true;setLoading(true);
  api(adminPage?'/admin/state':'/state',undefined,adminPage?'':token).then(data=>{if(!alive)return;acceptState(data);if(adminPage)setAuthenticated(true);setError('');}).catch(e=>{if(!alive)return;if(e.status===401){if(adminPage)setAuthenticated(false);else{saveToken('');setNotice('Dein Gruppenplatz wurde freigegeben oder die Übung wurde ersetzt.');}}else setError(e.message);}).finally(()=>{if(alive)setLoading(false);});
  return()=>{alive=false;};
 },[token,authenticated]);
 useEffect(()=>{
  if(adminPage&&!authenticated)return;
  const socket=io({auth:adminPage?{admin:true}:{token}});
  socket.on('connect',()=>{setConnected(true);setError('');});socket.on('disconnect',()=>setConnected(false));
  socket.on('connect_error',()=>{setConnected(false);});
  socket.on('state',(data:State)=>{
   if(data.adminExpired){setAuthenticated(false);setNotice('Die Admin-Session ist abgelaufen. Bitte erneut anmelden.');return;}
   if(data.sessionInvalid){saveToken('');setNotice('Dein Gruppenplatz wurde freigegeben oder die Übung wurde ersetzt.');}
   acceptState(data);
  });
  return()=>{socket.disconnect();setConnected(false);};
 },[token,authenticated]);
 async function action(path:string,body:unknown){setBusy(true);setError('');try{const data=await api(path,body,adminPage?'':token);if('game' in data)acceptState(data);return data;}catch(e){const err=e as ApiError;setError(err.message);if(err.status===401){if(adminPage)setAuthenticated(false);else if(token)saveToken('');}return null;}finally{setBusy(false);}}
 return <><header className="topbar"><a href={adminPage?'/admin':'/'} className="brand"><span className="brand-mark"><RadioIcon small/></span><span>Digitalfunk<span className="brand-light">-Trainer</span></span></a><div className="header-right">{adminPage&&<><a className="button quiet" href="/">Gruppenansicht</a><Badge tone="red">Gamemaster</Badge></>}{authenticated&&adminPage&&<button className="button quiet" disabled={busy} onClick={async()=>{if(await action('/admin/logout',{})){setAuthenticated(false);setState(null);}}}>Abmelden</button>}</div></header>
 <main className={adminPage?'main dashboard':'main team-main'}>
 {notice&&<div className="notice" role="status">{notice}<button className="dismiss" onClick={()=>setNotice('')} aria-label="Hinweis schließen">×</button></div>}
 {error&&<div className="error" role="alert">{error}<button className="button quiet" onClick={()=>{setError('');window.location.reload();}}>Erneut laden</button></div>}
 {loading&&!state?<div className="panel loading">Verbindung zur Übung wird hergestellt …</div>:adminPage?authenticated&&state?<Dashboard state={state} busy={busy} action={action} now={now} connected={connected}/>:<Login busy={busy} onLogin={async(password)=>{const data=await action('/admin/login',{password});if(data){setAuthenticated(true);acceptState(data);setNotice('');}}}/>:state?.team?<TeamScreen state={state} token={token} busy={busy} action={action} connected={connected} now={now}/>:<Home state={state} busy={busy} connected={connected} onJoin={async(password)=>{const data=await action('/join',{password});if(data){saveToken(data.token);acceptState(data.state);setNotice('');}}}/>}
 </main></>;
}
function Connection({connected}:{connected:boolean}){return <Badge tone={connected?'green':'amber'}>{connected?'Live verbunden':'Verbindung wird hergestellt …'}</Badge>}
function Home({state,busy,onJoin,connected}:{state:State|null;busy:boolean;onJoin:(p:string)=>void;connected:boolean}){
 const [join,setJoin]=useState(false),[password,setPassword]=useState('');const game=state?.game;
 return <div className="home">
  <section className="panel join-panel">
   <div className="join-content">
    <div className="spread">
     <Badge tone={game?.status==='LOBBY'?'amber':'muted'}>{game?statusText[game.status]:'Keine aktive Übung'}</Badge>
     <Connection connected={connected}/>
    </div>
    {game&&<h1>{game.name}</h1>}
    <p>{!game?'Aktuell ist keine Funkübung verfügbar.':game.status==='LOBBY'?'Eine Funkübung wartet auf Teilnehmer.':game.status==='RUNNING'?'Die Funkübung läuft bereits. Neue Gruppen können jetzt nicht mehr beitreten.':'Diese Funkübung ist beendet.'}</p>
    {game&&<div className="game-facts">
     <span><strong>{game.joined} / {game.teamCount}</strong> Gruppen beigetreten</span>
     <span><strong>{game.roundCount}</strong> Runden</span>
    </div>}
    {game?.status==='LOBBY'&&(game.joined>=game.teamCount
     ?<div className="notice">Alle Gruppenplätze sind bereits belegt.</div>
     :!join?<button className="button primary full" onClick={()=>setJoin(true)}>Als Gruppe beitreten</button>
     :<form onSubmit={e=>{e.preventDefault();onJoin(password);}}>
       <label>Beitrittspasswort<input autoFocus required maxLength={128} type="password" autoComplete="off" value={password} onChange={e=>setPassword(e.target.value)}/></label>
       <button className="button primary full" disabled={busy}>{busy?'Beitritt wird geprüft …':'Gruppe beitreten'}</button>
      </form>)}
   </div>
  </section>
 </div>;
}
function Login({busy,onLogin}:{busy:boolean;onLogin:(p:string)=>void}){const [password,setPassword]=useState('');return <section className="panel login"><div className="eyebrow">ÜBUNGSLEITUNG</div><h1>Gamemaster</h1><form onSubmit={e=>{e.preventDefault();onLogin(password);}}><label>Administratorpasswort<input type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="button primary full" disabled={busy}>{busy?'Anmeldung läuft …':'Anmelden'}</button></form></section>}
function Summary({stats,heading}:{stats?:Stats;heading:string}){return <section className="panel summary"><span className="finish-icon">✓</span><h2>{heading}</h2>{stats&&<div className="summary-grid"><div><strong>{stats.completedRounds}</strong><span>Abgeschlossene Runden</span></div><div><strong>{stats.correct}</strong><span>Korrekt gelöste Eingabeaufgaben</span></div><div><strong>{stats.failedAttempts}</strong><span>Fehlversuche</span></div><div><strong>{duration(stats.duration)}</strong><span>Gesamtdauer</span></div></div>}</section>}
function TeamScreen({state,token,busy,action,connected,now}:{state:State;token:string;busy:boolean;action:(p:string,b:unknown)=>Promise<any>;connected:boolean;now:number}){
 const game=state.game!,round=state.round;
 if(game.status==='LOBBY')return <section className="panel lobby">
  <Badge tone="amber">Lobby geöffnet</Badge>
  <div className="team-number">{String(state.team!.number).padStart(2,'0')}</div>
  <h1>Du bist Gruppe {state.team!.number}</h1>
  <p>Warte auf den Spielstart durch den Gamemaster.</p>
  <div className="ready-track">{Array.from({length:game.teamCount},(_,i)=><span className={i<game.joined?'ready':''} key={i}>{i+1}</span>)}</div>
  <strong>{game.joined} von {game.teamCount} Gruppen sind bereit.</strong>
  <div className="lobby-connection"><Connection connected={connected}/></div>
 </section>;
 if(game.status==='FINISHED')return <>
  <div className="page-heading"><div><div className="eyebrow">GRUPPE {state.team!.number}</div><h1>Übung abgeschlossen</h1></div><Connection connected={connected}/></div>
  <Summary heading="Die Übung ist beendet." stats={state.stats}/>
 </>;
 return <>
  <div className="page-heading"><div><div className="eyebrow">{game.name}</div><h1>Gruppe {state.team!.number}</h1></div><Connection connected={connected}/></div>
  <section className="partner-banner" aria-label="Funkpartner">
   <div><span>Du sendest an</span><strong>Gruppe {state.send!.partner}</strong></div>
   <div><span>Du empfängst von</span><strong>Gruppe {state.receive!.partner}</strong></div>
  </section>
  <div className="pending-confirmations" role="status" aria-label="Deine Bestätigungen">
   <span className={state.send?.confirmed?'done':'pending'}>{state.send?.confirmed?'✓ Senden bestätigt':'Senden noch nicht bestätigt'}</span>
   <span className={state.receive?.confirmed?'done':'pending'}>{state.receive?.confirmed?'✓ Empfang bestätigt':'Empfang noch nicht bestätigt'}</span>
  </div>
  <div className="round-strip"><span>Runde <strong>{round!.number}</strong> von {game.roundCount}</span><span className="mono">{duration(now-game.startedAt!)}</span></div>
  <progress className="progress" value={round!.number-1} max={game.roundCount} aria-label="Abgeschlossene Runden"/>
  {state.send?.confirmed&&state.receive?.confirmed&&<div className="notice">Deine Aufgaben sind abgeschlossen. Warte auf die übrigen Gruppen.</div>}
  {state.send&&<TaskCard key={`send-${state.send.id}`} task={state.send} sender partner={state.send.partner} token={token} busy={busy} connected={connected} action={action}/>}
  {state.receive&&<TaskCard key={`receive-${state.receive.id}`} task={state.receive} sender={false} partner={state.receive.partner} token={token} busy={busy} connected={connected} action={action}/>}
 </>;
}

function Drawing({task,token}:{task:TaskView;token:string}){const [url,setUrl]=useState(''),[error,setError]=useState('');useEffect(()=>{const ctrl=new AbortController();let objectUrl='';fetch(task.drawing!,{headers:token?{Authorization:`Bearer ${token}`}:{},credentials:'same-origin',signal:ctrl.signal}).then(r=>{if(!r.ok)throw new Error('Zeichnung konnte nicht geladen werden.');return r.blob();}).then(blob=>{objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>{ctrl.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};},[task.drawing,token]);return error?<p role="alert">{error}</p>:url?<img className="drawing" src={url} alt="Schwarz-weiße Übungszeichnung zum Beschreiben"/>:<p>Zeichnung wird geladen …</p>;}
function Content({task,token}:{task:TaskView;token:string}){if(task.type==='drawing')return <Drawing task={task} token={token}/>;if(task.type==='word')return <div className="word-content">{task.content as string}</div>;if(task.type==='equipment')return <ol className="equipment-list">{(task.content as string[]).map((x,i)=><li key={i}>{x}</li>)}</ol>;return <dl className="message-content">{Object.entries(task.content as Record<string,string>).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
function TaskCard({task,sender,partner,token,busy,connected,action}:{task:TaskView;sender:boolean;partner:number;token:string;busy:boolean;connected:boolean;action:(p:string,b:unknown)=>Promise<any>}){
 type LocalFeedback={correct:boolean;fields:(boolean|null)[]};
 const [answer,setAnswer]=useState<string|string[]>(typeof task.answer==='string'||Array.isArray(task.answer)?task.answer as string|string[]:task.type==='word'?'':Array(6).fill(''));
 const [feedback,setFeedback]=useState<LocalFeedback|null>(task.feedback ?? null);
 const requiresInput=task.type==='word'||task.type==='equipment';
 const instructions=sender?{
  drawing:'Beschreibe deinem Funkpartner diese Zeichnung möglichst genau.',
  word:'Buchstabiere diesen Begriff über Funk.',
  message:'Übermittle die Meldung. Höre dir die Wiederholung deines Funkpartners an und bestätige erst, wenn sie vollständig korrekt ist.',
  equipment:'Übermittle die folgenden Gegenstände in der angegebenen Reihenfolge.'
 }:{
  drawing:'Dein Funkpartner beschreibt dir eine Zeichnung. Zeichne sie möglichst genau auf Papier nach.',
  word:'Dein Funkpartner buchstabiert dir einen Feuerwehrbegriff. Gib das empfangene Wort ein.',
  message:'Empfange die Meldung und wiederhole sie vollständig über Funk. Lass dir die richtige Wiederholung vom Funkpartner bestätigen und bestätige anschließend den korrekten Empfang.',
  equipment:'Trage die empfangenen Ausrüstungsgegenstände in der richtigen Reihenfolge ein.'
 };
 const disabled=busy||!connected||task.confirmed;
 function changeAnswer(index:number,value:string){
  setAnswer(current=>task.type==='word'?value:(Array.isArray(current)?current:Array(6).fill('')).map((item,i)=>i===index?value:item));
  // Unveränderte Felder behalten ihre Rückmeldung; nur das bearbeitete Feld muss erneut geprüft werden.
  setFeedback(current=>current?{correct:false,fields:current.fields.map((value,i)=>i===index?null:value)}:null);
 }
 function field(label:string,index:number){
  const result=feedback?.fields[index];
  const statusId=`answer-${task.id}-${index}`;
  return <label key={index}>
   {label}
   <input disabled={task.confirmed||busy} autoComplete="off" maxLength={250}
    value={typeof answer==='string'?answer:answer[index]??''}
    className={result===true?'input-correct':result===false?'input-wrong':''}
    aria-invalid={result===false} aria-describedby={result!=null?statusId:undefined}
    onChange={e=>changeAnswer(index,e.target.value)}/>
   {result!=null&&<span id={statusId} className={result?'field-correct':'field-wrong'}>{result?'✓ Richtig':'× Falsch'}</span>}
  </label>;
 }
 const confirmationText=task.type==='message'
  ?sender?'Wiederholung korrekt – Sendeauftrag bestätigen':'Meldung wiederholt – Empfang bestätigen'
  :sender?'Sendeauftrag erledigt':'Empfangsauftrag erledigt';
 return <section className={`panel task-card ${task.confirmed?'completed':''}`}>
  <div className="spread">
   <div className="eyebrow"><span className={`task-symbol ${sender?'send-symbol':'receive-symbol'}`}>{sender?'S':'E'}</span>DEIN {sender?'SENDEAUFTRAG':'EMPFANGSAUFTRAG'}</div>
   {task.confirmed&&<Badge tone="green">✓ Erledigt</Badge>}
  </div>
  <p className="task-partner">{sender?'An':'Von'} Gruppe {partner}</p>
  <h2>{taskTitles[task.type]}</h2><p>{instructions[task.type]}</p>
  {sender?<Content task={task} token={token}/>
   :task.type==='drawing'?<div className="paper-hint">Papier und Stift bereithalten.</div>
   :requiresInput?<form onSubmit={async e=>{e.preventDefault();const result=await action(`/tasks/${task.id}/answer`,{answer});if(result)setFeedback(result);}}>
     {task.type==='word'?field('Empfangener Feuerwehrbegriff',0):Array.from({length:6},(_,i)=>field(`${i+1}. Gegenstand`,i))}
     {feedback&&<div className={feedback.correct?'answer-result correct':'answer-result incorrect'} role="status">
      {feedback.correct?'✓ Alle Eingaben sind richtig.':feedback.fields.some(value=>value===null)?'Bitte prüft die geänderten Eingaben.':task.type==='equipment'?`${feedback.fields.filter(Boolean).length} von 6 Positionen sind richtig.`:'Das Wort ist noch nicht richtig.'}
     </div>}
     <button className={`button ${task.confirmed?'success':'secondary'}`} disabled={disabled}>{task.confirmed?'✓ Empfang bestätigt':'Antwort prüfen und bestätigen'}</button>
    </form>:null}
  {!sender&&task.confirmed&&(task.content||task.drawing)&&<details className="solution"><summary>Lösung ansehen</summary><Content task={task} token={token}/></details>}
  <div className="task-footer">
   {(sender||!requiresInput)&&<button className={`button full ${task.confirmed?'success':sender?'primary':'secondary'}`} disabled={disabled} onClick={()=>action(`/tasks/${task.id}/confirm`,{role:sender?'sender':'receiver'})}>
    {task.confirmed?'✓ Auftrag abgeschlossen':confirmationText}
   </button>}
   {!task.confirmed&&(sender?<small className="confirmation-hint">Sendeauftrag noch offen: Nach der vollständigen Übermittlung bitte bestätigen.</small>
    :requiresInput?<small>Eine richtige Antwort bestätigt den Empfang automatisch.</small>
    :<p className="confirmation-hint">{task.type==='drawing'?'Bestätige den Empfang nur, wenn die Skizze nach Rücksprache mit deinem Funkpartner korrekt nachgezeichnet wurde.':'Bestätige den Empfang nur, wenn du die Meldung vollständig korrekt wiederholt hast und dein Funkpartner dies bestätigt hat.'}</p>)}
  </div>
 </section>;
}
function Dashboard({state,busy,action,now,connected}:{state:State;busy:boolean;action:(p:string,b:unknown)=>Promise<any>;now:number;connected:boolean}){
 const game=state.game,[creating,setCreating]=useState(!game);
 const [name,setName]=useState(''),[teamCount,setTeamCount]=useState(4),[roundCount,setRoundCount]=useState(10),[password,setPassword]=useState('');
 return <><div className="page-heading"><div><div className="eyebrow">ÜBUNGSLEITUNG</div><h1>Gamemaster-Dashboard</h1></div><div className="heading-actions"><Connection connected={connected}/>{game?.status!=='RUNNING'&&<button className="button danger" disabled={busy||!connected||!game} onClick={async()=>{
  if(!window.confirm('Alle Spieldaten und die Auswertung löschen und alle Gruppen abmelden?'))return;
  if(await action('/admin/reset',{})){setCreating(true);setName('');setPassword('');setTeamCount(4);setRoundCount(10);}
 }}>Alles zurücksetzen</button>}<button className="button primary" onClick={()=>setCreating(!creating)}>{creating&&game?'Formular schließen':'Neues Game erstellen'}</button></div></div>
 {creating&&<section className="panel create-panel"><h2>Neue Funkübung</h2><form onSubmit={async e=>{e.preventDefault();if(game&&!window.confirm('Das bestehende Game und alle Spielstände werden gelöscht. Neues Game erstellen?'))return;const data=await action('/admin/game',{name,teamCount,roundCount,password});if(data){setCreating(false);setPassword('');}}}><div className="create-grid"><label>Spielname <span className="muted">(optional)</span><input value={name} onChange={e=>setName(e.target.value)} maxLength={100} placeholder="Digitalfunkübung Dienstabend"/></label><label>Anzahl Gruppen<select value={teamCount} onChange={e=>setTeamCount(Number(e.target.value))}>{[2,4,6].map(n=><option key={n} value={n}>{n} Gruppen</option>)}</select></label><label>Runden<input type="number" required min={1} max={15} value={roundCount} onChange={e=>setRoundCount(Number(e.target.value))}/></label><label>Gruppen-Beitrittspasswort<input required type="password" autoComplete="new-password" maxLength={128} value={password} onChange={e=>setPassword(e.target.value)}/></label></div><button className="button primary" disabled={busy||!connected}>Game erstellen</button></form></section>}
 {!game?<section className="panel empty"><RadioIcon/><h2>Noch keine Übung angelegt</h2><p>Erstelle ein Game und teile das Beitrittspasswort mit den Gruppen.</p></section>:<><section className="panel game-overview"><div className="spread"><div><Badge tone={game.status==='RUNNING'?'green':game.status==='LOBBY'?'amber':'muted'}>{statusText[game.status]}</Badge><h2>{game.name}</h2></div><div className="game-controls">{game.status==='LOBBY'&&<button className="button primary" disabled={busy||!connected||game.joined!==game.teamCount} onClick={()=>action('/admin/start',{})}>Spiel starten</button>}{game.status==='RUNNING'&&<button className="button danger" disabled={busy||!connected} onClick={()=>{if(window.confirm('Die laufende Übung vorzeitig beenden?'))action('/admin/finish',{});}}>Game vorzeitig beenden</button>}</div></div><div className="overview-stats"><div><strong>{game.joined}<span> / {game.teamCount}</span></strong><small>Gruppen beigetreten</small></div><div><strong>{game.roundCount}</strong><small>Runden</small></div><div><strong className="mono">{game.startedAt?duration((game.finishedAt??now)-game.startedAt):'00:00'}</strong><small>Vergangene Spielzeit</small></div><div><strong>{game.startedAt?new Date(game.startedAt).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}):'—'}</strong><small>Startzeit</small></div></div></section>
 {state.round&&game.status==='RUNNING'&&<LiveRound state={state} busy={busy} connected={connected} action={action}/>}
 <div className="section-heading"><h2>Gruppenübersicht</h2><span className="muted">{game.teamCount} Gruppenplätze</span></div><div className="teams-grid">{state.teams?.map(t=><section className="panel team-tile" key={t.number}><div className="spread"><span className="tile-number">{String(t.number).padStart(2,'0')}</span><Badge tone={!t.joined?'muted':t.online?'green':'amber'}>{!t.joined?'Nicht beigetreten':t.online?'Online':'Offline'}</Badge></div><h3>Gruppe {t.number}</h3><p>{t.sendTo&&t.receiveFrom?<>Sendet an Gruppe {t.sendTo}<br/>Empfängt von Gruppe {t.receiveFrom}</>:t.joined?'Gruppenplatz vergeben':'Wartet auf Beitritt'}</p>{game.status==='LOBBY'&&t.joined&&<button className="button quiet" disabled={busy||!connected} onClick={()=>{if(window.confirm(`Gruppenplatz ${t.number} freigeben? Die bisherige Gruppen-Session wird ungültig.`))action(`/admin/teams/${t.number}/release`,{});}}>Gruppenplatz freigeben</button>}</section>)}</div>
 {game.status==='FINISHED'&&<><Summary heading="Die Funkübung ist beendet." stats={state.stats}/><GameReview rounds={state.review??[]}/></>}

 </>}
 </>;
}
function LiveRound({state,busy,connected,action}:{state:State;busy:boolean;connected:boolean;action:(path:string,body:unknown)=>Promise<any>}){
 const round=state.round!,tasks=round.tasks??[];
 const pending=(state.teams??[]).flatMap(group=>{
  const roles=[];
  if(!tasks.find(t=>t.sender===group.number)?.senderConfirmed)roles.push('Senden');
  if(!tasks.find(t=>t.receiver===group.number)?.receiverConfirmed)roles.push('Empfangen');
  return roles.length?[`Gruppe ${group.number}: ${roles.join(' und ')}`]:[];
 });
 return <section className="panel current-round">
  <div className="spread"><h2>Runde {round.number} von {state.game!.roundCount}</h2><span className="muted">{tasks.reduce((sum,t)=>sum+Number(t.senderConfirmed)+Number(t.receiverConfirmed),0)} / {state.game!.teamCount*2} Bestätigungen</span></div>
  <div className="pending-overview" role="status"><strong>Noch nicht bestätigt</strong>{pending.length?<ul>{pending.map(text=><li key={text}>{text}</li>)}</ul>:<p>Alle Gruppen haben bestätigt.</p>}</div>
  <div className="live-tasks">{tasks.map(task=><article className="live-task" key={task.id}>
   <h3>Gruppe {task.sender} sendet an Gruppe {task.receiver}</h3>
   <h4>{taskTitles[task.type]}</h4>
   <Content task={{...task,partner:task.receiver,confirmed:task.senderConfirmed}} token=""/>
   <div className="live-confirmations">
    <Badge tone={task.senderConfirmed?'green':'amber'}>Gruppe {task.sender}: {task.senderConfirmed?'Senden bestätigt':'Senden offen'}</Badge>
    <Badge tone={task.receiverConfirmed?'green':'amber'}>Gruppe {task.receiver}: {task.receiverConfirmed?'Empfang bestätigt':'Empfang offen'}</Badge>
   </div>
  </article>)}</div>
  <button className="button quiet full" disabled={busy||!connected} onClick={()=>{if(window.confirm(`Runde ${round.number} für alle Gruppen überspringen?`))action(`/admin/rounds/${round.id}/skip`,{});}}>Aktuelle Runde überspringen</button>
 </section>;
}
function GameReview({rounds}:{rounds:NonNullable<State['review']>}){
 return <section className="game-review">
  <h2>Auswertung je Runde</h2>
  {rounds.map(round=><details className="panel review-round" key={round.id}>
   <summary><strong>Runde {round.number}</strong><Badge tone={round.skipped?'amber':round.finished?'green':'muted'}>{round.skipped?'Übersprungen':round.finished?'Abgeschlossen':'Vorzeitig beendet'}</Badge></summary>
   {round.tasks.map(task=>{
    const exercise:TaskView={...task,partner:task.receiver,confirmed:true};
    const expected=Array.isArray(task.content)?task.content:[String(task.content??'')];
    const entered=Array.isArray(task.answer)?task.answer:[typeof task.answer==='string'?task.answer:''];
    return <article className="review-task" key={task.id}>
     <div className="spread"><h3>{taskTitles[task.type]}</h3><span className="muted">Gruppe {task.sender} sendet an Gruppe {task.receiver}</span></div>
     {task.type==='word'||task.type==='equipment'?<>
      <div className="review-table-wrap"><table className="review-table"><thead><tr><th>Aufgabe · Gruppe {task.sender}</th><th>Eingabe · Gruppe {task.receiver}</th><th>Ergebnis</th></tr></thead><tbody>
       {expected.map((word,i)=><tr key={i}><td>{task.type==='equipment'?`${i+1}. `:''}{word}</td><td className={task.feedback?.fields[i]===true?'field-correct':task.feedback?.fields[i]===false?'field-wrong':''}>{String(entered[i]??'')||'—'}</td><td>{task.feedback?.fields[i]===true?'✓ Richtig':task.feedback?.fields[i]===false?'× Falsch':'Nicht geprüft'}</td></tr>)}
      </tbody></table></div>
      <p className="muted">{task.failedAttempts??0} Fehlversuche</p>
     </>:task.type==='drawing'?<div className="review-sides"><div><h4>Vorlage · Gruppe {task.sender}</h4><Content task={exercise} token=""/></div><div className="blank-drawing" aria-label={`Keine digitale Zeichnung von Gruppe ${task.receiver}`}/></div>:<Content task={exercise} token=""/>}
     <div className="confirmations review-confirmations"><span className={task.senderConfirmed?'done':''}>{task.senderConfirmed?'✓':'○'} Sender bestätigt</span><span className={task.receiverConfirmed?'done':''}>{task.receiverConfirmed?'✓':'○'} Empfänger bestätigt</span></div>
    </article>;
   })}
  </details>)}
 </section>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
