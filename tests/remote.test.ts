import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, randomUUID, createHash, sign, verify, createPublicKey} from 'node:crypto';
import {mkdtempSync, rmSync, readFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import WebSocket from 'ws';
import {HostRelay} from '../apps/desktop/electron/relay';
import type {Vault} from '../apps/desktop/electron/vault';
// The production service is intentionally JavaScript and is exercised directly.
// @ts-expect-error JavaScript service has no separate declaration file.
import {createSignalingServer} from '../services/signaling/src/server.mjs';

class MemoryVault {
  private values = new Map<string,string>();
  get(id:string) { return this.values.get(id) ?? ''; }
  set(id:string,value:string) { this.values.set(id,value); }
}
function identity() {
  const pair = generateKeyPairSync('ec', {namedCurve:'prime256v1'});
  return {...pair, publicKeyText:pair.publicKey.export({type:'spki',format:'der'}).toString('base64')};
}
async function until(predicate:()=>boolean, description:string, timeout=5000) {
  const end=Date.now()+timeout;
  while(!predicate()) { if(Date.now()>end) throw Error(`Timed out: ${description}`); await new Promise(r=>setTimeout(r,10)); }
}
async function phone(url:string) {
  const ws = new WebSocket(url);
  const messages:any[]=[];
  ws.on('message',raw=>messages.push(JSON.parse(raw.toString())));
  await new Promise<void>((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  return {ws,send:(m:any)=>ws.send(JSON.stringify(m)),next:async(type:string)=>{
    await until(()=>messages.some(m=>m.type===type),`phone ${type}`);
    return messages.splice(messages.findIndex(m=>m.type===type),1)[0];
  }};
}
async function register(client:Awaited<ReturnType<typeof phone>>, id:string, hostId:string, key:ReturnType<typeof identity>) {
  const {nonce}=await client.next('challenge');
  client.send({type:'register',id,hostId,nonce,publicKey:key.publicKeyText,
    signature:sign('sha256',Buffer.from(JSON.stringify([1,'register',id,hostId,nonce])),key.privateKey).toString('base64')});
  return client.next('registered');
}

test('production HostRelay pairs and authenticates a phone through real WebSocket service', {timeout:20000}, async()=>{
  const directory=mkdtempSync(join(tmpdir(),'fox-remote-'));
  const adminToken=randomUUID()+randomUUID();
  const service=createSignalingServer({adminToken,turnSecret:randomUUID(),turnUrls:['turn:127.0.0.1:3478'],stateFile:join(directory,'relay-state.json'),log:()=>{}});
  await new Promise<void>(resolve=>service.server.listen(0,'127.0.0.1',resolve));
  const url=`ws://127.0.0.1:${service.server.address().port}/ws`;
  const notifications:any[]=[],background:any[]=[],vault=new MemoryVault();
  const host=new HostRelay(directory,vault as unknown as Vault,m=>notifications.push(m),m=>background.push(m));
  let client:Awaited<ReturnType<typeof phone>>|undefined;
  try {
    host.configure(url,adminToken); host.start();
    await until(()=>notifications.some(m=>m.type==='status'&&m.connected),'host registered');
    await until(()=>background.some(m=>m.type==='turn'),'host TURN credentials');
    assert.equal(service.state.hosts[host.hostId].publicKey,host.publicKey);
    const offer=host.pairing();
    assert.equal(offer.version,1);assert.equal(offer.hostId,host.hostId);assert.equal(offer.publicKey,host.publicKey);
    assert.ok(offer.secret.length>=32);assert.ok(offer.expiresAt>Date.now()&&offer.expiresAt<=Date.now()+300000);
    assert.ok(!JSON.stringify(offer).includes(adminToken));
    const peerId=randomUUID(),key=identity();
    client=await phone(url);
    assert.equal((await register(client,peerId,host.hostId,key)).paired,false);
    client.send({type:'turn'});assert.equal((await client.next('error')).code,'unpaired');
    client.send({type:'pair',hostId:host.hostId,secret:offer.secret,name:'Test Android'});
    await client.next('pair_pending');await until(()=>host.pending.has(peerId),'local pairing request');
    const expectedCode=createHash('sha256').update(JSON.stringify([1,'pair-code',host.hostId,host.publicKey,peerId,key.publicKeyText])).digest('hex').slice(0,8);
    assert.equal(host.pending.get(peerId).code,expectedCode);
    assert.equal(host.devices.length,0,'human approval is mandatory');
    host.approve(peerId,true);
    const approved=await client.next('pair_approved');
    assert.equal(approved.publicKey,offer.publicKey);
    await until(()=>host.devices.some(d=>d.id===peerId),'host trust persisted');
    const disk=JSON.parse(readFileSync(join(directory,'remote.json'),'utf8'));
    assert.equal(disk.devices[0].publicKey,key.publicKeyText);
    assert.ok(!JSON.stringify(disk).includes(offer.secret));
    assert.ok(!JSON.stringify(disk).includes(host.privateKey));
    const restored=new HostRelay(directory,vault as unknown as Vault,()=>{},()=>{});
    assert.equal(restored.hostId,host.hostId);assert.equal(restored.publicKey,host.publicKey);assert.equal(restored.devices[0].id,peerId);
    const sessionId=randomUUID();
    const signal=(seq:number,kind:string,payload:string,currentSession=sessionId)=>{
      const envelope={type:'signal',to:host.hostId,sessionId:currentSession,seq,kind,payload};
      return {...envelope,signature:sign('sha256',Buffer.from(JSON.stringify([1,'signal',peerId,host.hostId,currentSession,seq,kind,payload])),key.privateKey).toString('base64')};
    };
    const earlyIce=signal(1,'ice',JSON.stringify({candidate:'candidate:EARLY 1 UDP 1 127.0.0.1 12345 typ host',sdpMid:'0',sdpMLineIndex:0}));
    client.send(earlyIce);
    await until(()=>(host as any).early.size===1,'authenticated early ICE buffered');
    assert.equal(background.filter(m=>m.type==='signal').length,0,'ICE cannot reach WebRTC before an offer establishes the session');
    client.send(earlyIce);assert.equal((await client.next('error')).code,'invalid_signature');
    const offerSignal=signal(2,'offer','v=0\r\na=fingerprint:sha-256 SIGNED-TEST\r\n');client.send(offerSignal);
    await until(()=>background.some(m=>m.type==='signal'&&m.kind==='offer'),'authenticated SDP forwarded');
    assert.equal(background.find(m=>m.type==='signal'&&m.kind==='offer').payload,offerSignal.payload);
    assert.deepEqual(background.filter(m=>m.type==='signal').map(m=>[m.kind,m.seq]),[['offer',2],['ice',1]],'offer is delivered before exactly one buffered candidate');
    assert.equal((host as any).early.size,0,'buffer drained after authenticated offer');
    client.send(offerSignal);assert.equal((await client.next('error')).code,'invalid_signature');
    client.send({...signal(3,'ice','{"candidate":"valid"}'),payload:'{"candidate":"tampered"}'});
    assert.equal((await client.next('error')).code,'invalid_signature');
    const ice=signal(3,'ice',JSON.stringify({candidate:'candidate:1 1 UDP 1 127.0.0.1 12345 typ host',sdpMid:'0',sdpMLineIndex:0}));client.send(ice);
    await until(()=>background.some(m=>m.type==='signal'&&m.kind==='ice'&&m.seq===3),'authenticated ICE forwarded');
    const count=background.filter(m=>m.type==='signal').length;
    // Exercise endpoint verification independently of the relay's own verifier:
    // a compromised relay cannot substitute its key or rewrite signed content.
    const attacker=identity();const forged={...signal(4,'ice','{}'),from:peerId,to:host.hostId,publicKey:attacker.publicKeyText};
    forged.signature=sign('sha256',Buffer.from(JSON.stringify([1,'signal',peerId,host.hostId,sessionId,4,'ice','{}'])),attacker.privateKey).toString('base64');
    (host as any).receive(forged);
    (host as any).receive({...ice,from:peerId,to:host.hostId,publicKey:key.publicKeyText});
    (host as any).receive({...signal(4,'ice','{}'),from:peerId,to:'wrong-host',publicKey:key.publicKeyText});
    assert.equal(background.filter(m=>m.type==='signal').length,count,'host rejects forged, replayed, wrong-destination signals');
    host.signal({to:peerId,sessionId,seq:1,kind:'answer',payload:'v=0\r\na=fingerprint:sha-256 HOST\r\n'});
    const answer=await client.next('signal');
    assert.equal(answer.kind,'answer');
    assert.ok(verify('sha256',Buffer.from(JSON.stringify([1,'signal',host.hostId,peerId,sessionId,1,'answer',answer.payload])),createPublicKey({key:Buffer.from(offer.publicKey,'base64'),format:'der',type:'spki'}),Buffer.from(answer.signature,'base64')));
    const abandoned=randomUUID();client.send(signal(1,'ice','{"candidate":"abandoned-before-stop"}',abandoned));
    await until(()=>(host as any).early.size===1,'second session ICE buffered before stop');
    const oldSocket=host.socket!;
    host.stop();
    await until(()=>oldSocket.readyState===WebSocket.CLOSED,'manual stop closes host socket');
    assert.equal((host as any).early.size,0);assert.equal((host as any).sessions.size,0);assert.equal((host as any).seen.size,0);
    assert.ok(JSON.parse(readFileSync(join(directory,'remote.json'),'utf8')).retired.includes(sessionId),'manual stop persists retired session');
    assert.throws(()=>host.signal({to:peerId,sessionId,seq:2,kind:'ice',payload:'{}'}),/Untrusted/);
    const afterStop=background.filter(m=>m.type==='signal').length;
    const turnBeforeRestart=background.filter(m=>m.type==='turn').length;
    host.start();
    await until(()=>background.filter(m=>m.type==='turn').length>turnBeforeRestart,'manual restart registered and fetched TURN');
    client.send(signal(4,'offer','v=0\r\nSTALE-SESSION-OFFER'));
    client.send(signal(5,'ice','{"candidate":"STALE-SESSION-ICE"}'));
    const freshSession=randomUUID();client.send(signal(1,'offer','v=0\r\nFRESH-SESSION-OFFER',freshSession));
    await until(()=>background.some(m=>m.type==='signal'&&m.sessionId===freshSession),'fresh session works after restart');
    assert.deepEqual(background.filter(m=>m.type==='signal').slice(afterStop).map(m=>m.sessionId),[freshSession],'retired session offer and ICE never reach WebRTC after restart');
    const rebuiltBackground:any[]=[];
    const rebuilt=new HostRelay(directory,vault as unknown as Vault,()=>{},m=>rebuiltBackground.push(m));
    (rebuilt as any).receive({...signal(6,'offer','v=0\r\nSTALE-AFTER-PROCESS-RESTART'),from:peerId,to:host.hostId,publicKey:key.publicKeyText});
    assert.equal(rebuiltBackground.length,0,'persisted retirement rejects stale sessions after object reconstruction');
    const closed=new Promise<number>(resolve=>client!.ws.once('close',resolve));
    host.revoke(peerId);assert.equal(await closed,1008);
    assert.equal(host.devices[0].revoked,true);assert.equal(service.state.peers[peerId].revoked,true);
    assert.ok(background.some(m=>m.type==='revoke'&&m.id===peerId));
    assert.throws(()=>host.signal({to:peerId,sessionId,seq:2,kind:'ice',payload:'{}'}),/Untrusted/);
  } finally {client?.ws.terminate();host.stop();await service.close();rmSync(directory,{recursive:true,force:true});}
});

test('production HostRelay rejects credential-bearing and insecure non-loopback endpoints',()=>{
  const directory=mkdtempSync(join(tmpdir(),'fox-remote-config-'));
  try {
    const host=new HostRelay(directory,new MemoryVault() as unknown as Vault,()=>{},()=>{});
    for(const url of ['ws://example.com/ws','wss://user:password@example.com/ws','wss://example.com/ws?token=secret','wss://example.com/not-ws']) assert.throws(()=>host.configure(url,''));
    host.configure('wss://relay.example.com/ws','');assert.equal(host.endpoint,'wss://relay.example.com/ws');
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('Chromium establishes a real DTLS WebRTC channel and transfers large ordered RPC fragments', {timeout:30000}, async t=>{
  const {chromium}=await import('playwright');
  if(!existsSync(chromium.executablePath())) {t.skip('Bundled Chromium is unavailable; no device or DTLS claim is made');return;}
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage();
    const result=await page.evaluate(async(commandId)=>{
      const left=new RTCPeerConnection({iceServers:[]}),right=new RTCPeerConnection({iceServers:[]});
      const earlyLeft:RTCIceCandidateInit[]=[],earlyRight:RTCIceCandidateInit[]=[];
      left.onicecandidate=e=>{if(e.candidate){if(right.remoteDescription)void right.addIceCandidate(e.candidate);else earlyRight.push(e.candidate.toJSON());}};
      right.onicecandidate=e=>{if(e.candidate){if(left.remoteDescription)void left.addIceCandidate(e.candidate);else earlyLeft.push(e.candidate.toJSON());}};
      const sender=left.createDataChannel('fox-rpc',{ordered:true});
      const payload=JSON.stringify({type:'command',command:{version:1,id:commandId,type:'attachment.upload',payload:{name:'test.txt',mime:'text/plain',base64:'A'.repeat(200000)}}});
      const received=new Promise<{text:string,dtls:string,ordered:boolean}>(resolve=>{right.ondatachannel=e=>{const parts:string[]=[];e.channel.onmessage=event=>{const fragment=JSON.parse(event.data);parts[fragment.index]=fragment.data;if(parts.filter(Boolean).length===fragment.total)resolve({text:parts.join(''),dtls:right.sctp?.transport.state??'unavailable',ordered:e.channel.ordered});};};});
      const offer=await left.createOffer();await left.setLocalDescription(offer);await right.setRemoteDescription(offer);for(const c of earlyRight)await right.addIceCandidate(c);
      const answer=await right.createAnswer();await right.setLocalDescription(answer);await left.setRemoteDescription(answer);for(const c of earlyLeft)await left.addIceCandidate(c);
      if(sender.readyState!=='open')await new Promise<void>((resolve,reject)=>{sender.onopen=()=>resolve();setTimeout(()=>reject(Error('Data channel did not open')),10000);});
      const chunks=payload.match(/.{1,16384}/gs)!;
      chunks.forEach((data,index)=>sender.send(JSON.stringify({type:'fragment',id:'test-fragment',index,total:chunks.length,data})));
      const receipt=await received;
      const stats=await left.getStats();let nominated=false;stats.forEach(report=>{if(report.type==='candidate-pair'&&report.state==='succeeded'&&report.nominated)nominated=true;});
      left.close();right.close();
      return {same:receipt.text===payload,dtls:receipt.dtls,ordered:receipt.ordered,nominated,bytes:receipt.text.length};
    },randomUUID());
    assert.equal(result.same,true);assert.equal(result.ordered,true);assert.equal(result.dtls,'connected');assert.equal(result.nominated,true);assert.ok(result.bytes>200000);
  } finally {await browser.close();}
});

