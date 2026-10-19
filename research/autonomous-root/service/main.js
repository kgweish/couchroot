'use strict';
const {read,config,atomic}=require('./policy'),{Journal}=require('./policy'),{createAgent}=require('./agent'),{createApi}=require('./api');
const {prepareWorkerState}=require('./worker-state');
const DATA='/opt/usr/home/owner/apps_rw/MiniRoot01/data';
const {createBootLaunch}=require('./policy');
let server,agent,bootTimer;
function start(){
 const c=config(JSON.parse(read(DATA+'/config.json')));
 const state=prepareWorkerState(DATA);
 agent=createAgent(c,{selectionFile:state.selectionFile,stagePackagedObserver:c.device==='s90d',retirementProbeDirectory:state.directory,observerChildProcess:false,externalObserverDirectory:c.device==='s90d'?state.directory:undefined});
 const boot=createBootLaunch(agent,c.boot_launcher===true);
 const originalStatus=agent.status;
 agent.status=()=>Object.assign(originalStatus(),{boot_launcher:boot.status()});
 if(c.boot_launcher===true)bootTimer=setInterval(()=>{boot.tick().then(()=>{if(!['waiting-agent','waiting-foreground','submitting'].includes(boot.status()))clearInterval(bootTimer);});},1000);
 server=createApi({credentials:{key:read(DATA+'/server-key.pem'),cert:read(DATA+'/server.pem'),ca:read(DATA+'/client.pem')},clientPin:c.client_sha256,agent,journal:new Journal(DATA+'/requests.json'),setEnabled:enabled=>{c.enabled=enabled;atomic(DATA+'/config.json',c);}});
 server.on('error',()=>{agent.stop();process.exitCode=1;});
 server.listen(c.port,'0.0.0.0',()=>{if(c.enabled)agent.start();});
}
function stop(){if(bootTimer)clearInterval(bootTimer);if(agent)agent.stop();if(server)server.close();}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
try{start();}catch(_){console.error('Root agent configuration unavailable; service not started');process.exitCode=1;}
