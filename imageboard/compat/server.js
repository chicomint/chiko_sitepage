'use strict';

const {createCompatibleApp}=require('./application');
let server,app;
async function start(){
  app=await createCompatibleApp();
  server=app.listen(Number(process.env.PORT || 3000),'0.0.0.0',()=>console.log('ChikoChan compatibility application is ready.'));
  server.requestTimeout=35000;server.headersTimeout=15000;
}
async function stop(){
  if(server)await new Promise(resolve=>server.close(resolve));
  await app?.locals.compat.close();
}
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{
  const timer=setTimeout(()=>process.exit(1),10000);timer.unref();stop().then(()=>process.exit(0),()=>process.exit(1));
});
start().catch(()=>{console.error('ChikoChan startup failed. Check the configured database, schema and migration gates.');process.exitCode=1;});
