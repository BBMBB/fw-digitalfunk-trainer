import express, { type Request, type Response, type NextFunction } from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { resolve } from 'node:path';
import { GameError, Store, token, hashPassword, verifyPassword } from './game.js';

export function createApp(store: Store, adminPassword: string, production=false) {
  if (!adminPassword || adminPassword.length>128) throw new Error('ADMIN_PASSWORD muss gesetzt sein und darf höchstens 128 Zeichen enthalten.');
  const adminPasswordHash=hashPassword(adminPassword);
  const app=express(), server=createServer(app);
  app.set('trust proxy',1);
  app.disable('x-powered-by');
  app.use((_req,res,next)=> {res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');next();});
  app.use('/api', (_req,res,next)=>{res.setHeader('Cache-Control','no-store'); next();});
  app.use(express.json({limit:'16kb'}));
  const sessions=new Map<string,number>();
  const serverId=token();
  let revision=0;
  const snapshot=<T extends object>(state:T)=>({...state,_server:serverId,_revision:revision});
  const cookieToken=(req: {headers: {cookie?:string}})=>req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('df_admin='))?.slice(9) ?? '';
  const isAdmin=(req: {headers: {cookie?:string}})=> {
    const key=cookieToken(req), expires=sessions.get(key);
    if (!expires || expires<Date.now()) {sessions.delete(key);return false;} return true;
  };
  const admin=(req:Request,_res:Response,next:NextFunction)=> {if (!isAdmin(req)) return next(new GameError('Bitte als Gamemaster anmelden.',401));next();};
  const bearer=(req:Request)=>req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):'';
  const limits=new Map<string,{count:number;expires:number}>();
  const limit=(req:Request,res:Response,next:NextFunction)=> {
    const now=Date.now();
    for (const [key,v] of limits) if(v.expires<now) limits.delete(key);
    for (const [key,expires] of sessions) if(expires<now) sessions.delete(key);
    const key=`${req.path}:${req.ip}`, entry=limits.get(key) ?? {count:0,expires:now+60_000};
    if (++entry.count>30) {res.setHeader('Retry-After','60');res.status(429).json({error:'Zu viele Versuche. Bitte in einer Minute erneut versuchen.'});return;}
    limits.set(key,entry);next();
  };
  const io=new Server(server,{maxHttpBufferSize:16_384});
  const online=()=>new Set([...io.sockets.sockets.values()].flatMap(s=>{const t=store.team(s.data.teamToken);return t?[t.id]:[];}));
  function publish() {
    revision++;
    const presence=online();
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.admin && isAdmin(socket.request)) socket.emit('state',snapshot(store.adminState(presence)));
      else if (socket.data.admin) socket.emit('state',snapshot({adminExpired:true}));
      else if (socket.data.teamToken) {
        if (store.team(socket.data.teamToken)) socket.emit('state',snapshot(store.teamState(socket.data.teamToken)));
        else socket.emit('state',snapshot({...store.publicState(),sessionInvalid:true}));
      } else socket.emit('state',snapshot(store.publicState()));
    }
  }
  io.on('connection',socket=> {
    socket.data.admin=socket.handshake.auth?.admin===true && isAdmin(socket.request);
    socket.data.teamToken=typeof socket.handshake.auth?.token==='string'?socket.handshake.auth.token:'';
    socket.on('disconnect',()=>publish());
    // Administrative Änderungen sind ausschließlich über die geschützte HTTP-API möglich.
    publish();
  });
  const id=(value:unknown)=>{const n=Number(value);if (!Number.isSafeInteger(n)||n<1)throw new GameError('Ungültige Kennung.');return n;};
  app.get('/api/health',(_req,res)=> {store.db.prepare('SELECT 1').get();res.json({ok:true});});
  app.get('/api/state',(req,res)=>res.json(snapshot(bearer(req)?store.teamState(bearer(req)):store.publicState())));
  app.post('/api/join',limit,(req,res)=> {const session=store.join(req.body?.password);publish();res.json({token:session,state:snapshot(store.teamState(session))});});
  app.post('/api/tasks/:id/confirm',(req,res)=>{store.confirm(bearer(req),id(req.params.id),req.body?.role);publish();res.json(snapshot(store.teamState(bearer(req))));});
  app.post('/api/tasks/:id/answer',(req,res)=>{const result=store.answer(bearer(req),id(req.params.id),req.body?.answer);publish();res.json(result);});
  app.get('/api/drawings/:id',(req,res)=>res.sendFile(resolve('backend/drawings',store.drawing(bearer(req),id(req.params.id),isAdmin(req)))));
  app.post('/api/admin/login',limit,(req,res)=> {
    const password=req.body?.password;
    if (typeof password!=='string' || password.length>128 || !verifyPassword(password,adminPasswordHash)) throw new GameError('Falsches Administratorpasswort.',401);
    const session=token();sessions.set(session,Date.now()+12*60*60*1000);
    res.cookie('df_admin',session,{httpOnly:true,secure:production,sameSite:'strict',maxAge:12*60*60*1000,path:'/'});
    res.json(snapshot(store.adminState(online())));
  });
  app.post('/api/admin/logout',admin,(req,res)=>{sessions.delete(cookieToken(req));res.clearCookie('df_admin',{httpOnly:true,secure:production,sameSite:'strict',path:'/'});publish();res.json({ok:true});});
  app.get('/api/admin/state',admin,(_req,res)=>res.json(snapshot(store.adminState(online()))));
  app.post('/api/admin/reset',admin,(_req,res)=>{store.reset();publish();res.json(snapshot(store.adminState(online())));});
  app.post('/api/admin/game',admin,(req,res)=>{store.create(req.body ?? {});publish();res.json(snapshot(store.adminState(online())));});
  app.post('/api/admin/start',admin,(_req,res)=>{store.start();publish();res.json(snapshot(store.adminState(online())));});
  app.post('/api/admin/finish',admin,(_req,res)=>{store.finish();publish();res.json(snapshot(store.adminState(online())));});
  app.post('/api/admin/teams/:id/release',admin,(req,res)=>{store.release(id(req.params.id));publish();res.json(snapshot(store.adminState(online())));});
  app.post('/api/admin/rounds/:id/skip',admin,(req,res)=>{store.skip(id(req.params.id));publish();res.json(snapshot(store.adminState(online())));});
  app.use('/api',(_req,res)=>res.status(404).json({error:'API-Endpunkt nicht gefunden.'}));
  if (production) {
    app.use(express.static(resolve('dist/client')));
    app.get('/{*path}',(_req,res)=>res.sendFile(resolve('dist/client/index.html')));
  }
  app.use((error: Error, _req:Request,res:Response,_next:NextFunction)=> {
    const status=error instanceof GameError?error.status:('status' in error && typeof error.status==='number'?error.status:500);
    if (status>=500) console.error(error);
    res.status(status).json({error:status>=500?'Ein interner Fehler ist aufgetreten. Bitte erneut versuchen.':error instanceof GameError?error.message:'Die Anfrage konnte nicht verarbeitet werden.'});
  });
  return {app,server,io,publish};
}
