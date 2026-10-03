import http from 'node:http';
import { randomBytes, createPublicKey, verify, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

export const registerText = (id, hostId, nonce) => JSON.stringify([1,'register',id,hostId || id,nonce]);
export const signalText = (from,m) => JSON.stringify([1,'signal',from,m.to,m.sessionId,m.seq,m.kind,m.payload]);
const idOk = v => typeof v === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(v);
const equal = (a,b) => typeof a==='string' && typeof b==='string' && Buffer.byteLength(a)===Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
function checkSignature(publicKey,text,signature) {
  try {
    const key=createPublicKey({key:Buffer.from(publicKey,'base64'),format:'der',type:'spki'});
    return key.asymmetricKeyType==='ec' && key.asymmetricKeyDetails?.namedCurve==='prime256v1' && verify('sha256',Buffer.from(text),key,Buffer.from(signature,'base64'));
  } catch { return false; }
}
export function createSignalingServer(config={}) {
  const token=config.adminToken ?? process.env.RELAY_ADMIN_TOKEN;
  if (!token || token.length<32) throw new Error('RELAY_ADMIN_TOKEN must contain at least 32 characters');
  const stateFile=config.stateFile ?? process.env.STATE_FILE;
  const turnSecret=config.turnSecret ?? process.env.TURN_SECRET;
  const turnUrls=config.turnUrls ?? (process.env.TURN_URLS || '').split(',').filter(Boolean);
  const now=config.now ?? Date.now;
  const log=config.log ?? (event=>console.log(JSON.stringify({event,time:new Date().toISOString()})));
  let state={hosts:{},peers:{}};
  if (stateFile) { try { state=JSON.parse(readFileSync(stateFile,'utf8')); } catch(e) { if(e.code!=='ENOENT') throw e; } }
  const persist=()=> { if(!stateFile)return; mkdirSync(dirname(stateFile),{recursive:true}); writeFileSync(stateFile+'.tmp',JSON.stringify(state),{mode:0o600}); renameSync(stateFile+'.tmp',stateFile); };
  const clients=new Map(), offers=new Map(), pending=new Map(), rates=new Map();
  const server=http.createServer((req,res)=> {
    if(req.method==='GET'&&req.url==='/health') { res.writeHead(200,{'content-type':'application/json'});res.end('{"ok":true,"protocol":1}'); }
    else {res.writeHead(404);res.end();}
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:128*1024,perMessageDeflate:false});
  server.on('upgrade',(req,socket,head)=> {
    if(req.url!=='/ws'){socket.destroy();return;}
    const address=req.socket.remoteAddress || 'unknown', time=now();
    const rate=rates.get(address) || {start:time,count:0};
    if(time-rate.start>60000){rate.start=time;rate.count=0;}
    rate.count++;rates.set(address,rate);
    if(rate.count>120 || wss.clients.size>=1000){socket.destroy();return;}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
  });
  const send=(ws,m)=> {if(ws?.readyState===WebSocket.OPEN){if(ws.bufferedAmount>1024*1024){ws.close(1013,'Backpressure');return;}ws.send(JSON.stringify(m));}};
  const fail=(ws,code)=>send(ws,{type:'error',code});
  const authorized=(a,b)=>state.peers[a]?.hostId===b&&!state.peers[a].revoked || state.peers[b]?.hostId===a&&!state.peers[b].revoked;
  wss.on('connection',ws=> {
    ws.nonce=randomBytes(32).toString('base64url');ws.challengeAt=now();ws.alive=true;ws.rate={start:now(),count:0};ws.sequences=new Map();
    send(ws,{type:'challenge',nonce:ws.nonce});
    const authTimeout=setTimeout(()=>{if(!ws.id)ws.close(1008,'Authentication timeout');},15000);authTimeout.unref();
    ws.on('pong',()=>ws.alive=true);
    ws.on('message',raw=> {
      try {
        if(now()-ws.rate.start>10000)ws.rate={start:now(),count:0};
        if(++ws.rate.count>100){ws.close(1008,'Rate limit');return;}
        const m=JSON.parse(raw.toString());
        if(!m || typeof m.type!=='string')return fail(ws,'invalid_message');
        if(m.type==='register'){
          if(ws.id || !idOk(m.id) || !equal(m.nonce,ws.nonce) || now()-ws.challengeAt>15000 || typeof m.publicKey!=='string' || m.publicKey.length>512 || !checkSignature(m.publicKey,registerText(m.id,m.hostId,m.nonce),m.signature))return fail(ws,'authentication_failed');
          const hostId=m.hostId || m.id, isHost=hostId===m.id;
          if(!idOk(hostId))return fail(ws,'invalid_host');
          if(isHost){
            const known=state.hosts[m.id];
            if(known ? known.publicKey!==m.publicKey : !equal(m.token,token))return fail(ws,'authentication_failed');
            if(!known){state.hosts[m.id]={publicKey:m.publicKey};persist();}
          } else {
            if(!state.hosts[hostId] || state.hosts[m.id])return fail(ws,'invalid_host');
            const known=state.peers[m.id];
            if(known&&(known.revoked||known.publicKey!==m.publicKey||known.hostId!==hostId))return fail(ws,'authentication_failed');
          }
          clients.get(m.id)?.close(1000,'Reconnected');ws.id=m.id;ws.hostId=hostId;ws.publicKey=m.publicKey;ws.isHost=isHost;clients.set(m.id,ws);clearTimeout(authTimeout);
          send(ws,{type:'registered',id:m.id,paired:isHost||!!state.peers[m.id]});return;
        }
        if(!ws.id)return fail(ws,'unauthenticated');
        if(m.type==='offer'){
          if(!ws.isHost || typeof m.secret!=='string'||m.secret.length<32||m.secret.length>256||!Number.isSafeInteger(m.expiresAt)||m.expiresAt<=now()||m.expiresAt>now()+300000)return fail(ws,'invalid_offer');
          offers.set(ws.id,{secret:m.secret,expiresAt:m.expiresAt});
          for(const [id,p] of pending)if(p.hostId===ws.id)pending.delete(id);
          send(ws,{type:'offer_created',expiresAt:m.expiresAt});return;
        }
        if(m.type==='pair'){
          const offer=offers.get(ws.hostId);
          if(ws.isHost||state.peers[ws.id]||m.hostId!==ws.hostId||!offer||offer.expiresAt<=now()||!equal(m.secret,offer.secret)||typeof m.name!=='string'||!m.name.trim()||m.name.length>64)return fail(ws,'invalid_pairing');
          if([...pending.values()].some(p=>p.hostId===ws.hostId))return fail(ws,'pairing_pending');
          const host=clients.get(ws.hostId);if(!host)return fail(ws,'host_offline');
          pending.set(ws.id,{hostId:ws.hostId,expiresAt:offer.expiresAt});send(host,{type:'pair_request',peerId:ws.id,publicKey:ws.publicKey,name:m.name});send(ws,{type:'pair_pending'});return;
        }
        if(m.type==='approve'){
          const p=pending.get(m.peerId),peer=clients.get(m.peerId),offer=offers.get(ws.id);
          if(!ws.isHost||!p||p.hostId!==ws.id||p.expiresAt<=now()||!offer||offer.expiresAt<=now()||!peer||typeof m.approved!=='boolean')return fail(ws,'invalid_approval');
          pending.delete(m.peerId);
          if(!m.approved){send(peer,{type:'pair_rejected'});return;}
          offers.delete(ws.id);state.peers[m.peerId]={hostId:ws.id,publicKey:peer.publicKey,revoked:false};persist();
          send(ws,{type:'pair_approved',hostId:ws.id,peerId:peer.id,publicKey:peer.publicKey});send(peer,{type:'pair_approved',hostId:ws.id,peerId:peer.id,publicKey:ws.publicKey});return;
        }
        if(m.type==='revoke'){
          if(!ws.isHost||state.peers[m.peerId]?.hostId!==ws.id)return fail(ws,'forbidden');
          state.peers[m.peerId].revoked=true;persist();clients.get(m.peerId)?.close(1008,'Revoked');send(ws,{type:'revoked',peerId:m.peerId});return;
        }
        if(m.type==='turn'){
          if(!ws.isHost&&!state.peers[ws.id] || state.peers[ws.id]?.revoked)return fail(ws,'unpaired');
          if(!turnSecret||turnUrls.length===0)return fail(ws,'turn_unconfigured');
          const expiresAt=now()+600000,username=`${Math.floor(expiresAt/1000)}:${ws.id}`;
          send(ws,{type:'turn',expiresAt,iceServers:[{urls:turnUrls,username,credential:createHmac('sha1',turnSecret).update(username).digest('base64')}]});return;
        }
        if(m.type==='signal'){
          if(!authorized(ws.id,m.to))return fail(ws,'unpaired');
          if(!idOk(m.sessionId)||!Number.isSafeInteger(m.seq)||m.seq<1||!['offer','answer','ice'].includes(m.kind)||typeof m.payload!=='string'||m.payload.length>100000)return fail(ws,'invalid_signal');
          const key=m.to+':'+m.sessionId,seq=ws.sequences.get(key)||0;
          if(m.seq<=seq||!checkSignature(ws.publicKey,signalText(ws.id,m),m.signature))return fail(ws,'invalid_signature');
          if(ws.sequences.size>=128&&!ws.sequences.has(key))return fail(ws,'too_many_sessions');
          ws.sequences.set(key,m.seq);const target=clients.get(m.to);if(!target)return fail(ws,'peer_offline');
          send(target,{type:'signal',from:ws.id,to:m.to,publicKey:ws.publicKey,sessionId:m.sessionId,seq:m.seq,kind:m.kind,payload:m.payload,signature:m.signature});return;
        }
        fail(ws,'unknown_type');
      } catch {fail(ws,'invalid_message');}
    });
    ws.on('close',()=>{clearTimeout(authTimeout);if(clients.get(ws.id)===ws)clients.delete(ws.id);pending.delete(ws.id);});
    ws.on('error',()=>log('connection_error'));
  });
  const cleanup=setInterval(()=> {
    for(const ws of wss.clients){if(!ws.alive){ws.terminate();continue;}ws.alive=false;ws.ping();}
    for(const [id,offer] of offers)if(offer.expiresAt<=now())offers.delete(id);
    for(const [id,p] of pending)if(p.expiresAt<=now()){send(clients.get(id),{type:'pair_expired'});pending.delete(id);}
    for(const [ip,r] of rates)if(now()-r.start>60000)rates.delete(ip);
  },30000);cleanup.unref();
  return {server,close:async()=>{clearInterval(cleanup);for(const ws of wss.clients)ws.terminate();await new Promise(r=>wss.close(r));await new Promise(r=>server.close(r));},state};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const app=createSignalingServer();app.server.listen(Number(process.env.PORT||8787),'0.0.0.0',()=>console.log('{"event":"listening"}'));
  for(const s of ['SIGTERM','SIGINT'])process.on(s,()=>app.close().then(()=>process.exit(0)));
}
