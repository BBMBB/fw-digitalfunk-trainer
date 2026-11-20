import { Store } from './game.js';
import { createApp } from './server.js';
const store=new Store(process.env.DATABASE_PATH || '/data/trainer.db');
const {server,io}=createApp(store,process.env.ADMIN_PASSWORD || '',process.env.NODE_ENV==='production');
const port=Number(process.env.PORT || 3000);
server.listen(port,'0.0.0.0',()=>console.log(`Digitalfunk-Trainer läuft auf Port ${port}.`));
let stopping=false;
function shutdown() {
  if (stopping) return; stopping=true;
  io.close(()=>{store.db.close();process.exit(0);});
  setTimeout(()=>process.exit(1),5000).unref();
}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
