import {Engine} from './engine';
import {randomUUID} from 'node:crypto';
const port=(process as any).parentPort;const pending=new Map<string,{resolve:(v:any)=>void,reject:(e:Error)=>void}>();
function host(type:string,data:any){const id=randomUUID();return new Promise<any>((resolve,reject)=>{pending.set(id,{resolve,reject});port.postMessage({type,id,data});});}
const engine=new Engine(process.argv[2],{credential:id=>host('credential',{id}),connectorCredential:id=>host('connector.credential',{id}),native:(method,args)=>host('native',{method,args}),publish:event=>port.postMessage({type:'event',event})});
port.on('message',async({data}:any)=>{if(data.type==='host.result'){const p=pending.get(data.id);pending.delete(data.id);if(data.error)p?.reject(Error(data.error));else p?.resolve(data.data);return;}if(data.type==='command'){port.postMessage({type:'result',requestId:data.requestId,result:await engine.command(data.command)});}if(data.type==='shutdown'){await engine.close();process.exit(0);}});
port.postMessage({type:'ready'});
