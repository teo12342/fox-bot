import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHmac} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WebSocket} from 'ws';
import {createSignalingServer,registerText,signalText} from '../src/server.mjs';
function identity(){const k=generateKeyPairSync('ec',{namedCurve:'prime256v1'});return {...k,publicKeyText:k.publicKey.export({format:'der',type:'spki'}).toString('base64')};}
function connect(url){return new Promise((resolve,reject)=>{const ws=new WebSocket(url),queue=[],waiters=[];ws.on('error',reject);ws.on('message',raw=>{const m=JSON.parse(raw);if(waiters.length)waiters.shift()(m);else queue.push(m);});ws.on('open',()=>resolve({ws,send:m=>ws.send(JSON.stringify(m)),next:()=>queue.length?Promise.resolve(queue.shift()):new Promise((r,j)=>{const timeout=setTimeout(()=>j(new Error('message timeout')),2000);waiters.push(m=>{clearTimeout(timeout);r(m);});})}));});}
async function register(client,id,key,hostId,token){const c=await client.next();client.send({type:'register',id,hostId,token,publicKey:key.publicKeyText,nonce:c.nonce,signature:sign('sha256',Buffer.from(registerText(id,hostId,c.nonce)),key.privateKey).toString('base64')});return client.next();}
test('real WebSocket: approval, single use, authenticated signals, replay, TURN and revoke',async()=>{
 const app=createSignalingServer({adminToken:'x'.repeat(32),turnSecret:'turn-secret',turnUrls:['turn:localhost:3478'],log:()=>{}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const url=`ws://127.0.0.1:${app.server.address().port}/ws`;
 try {
  assert.equal((await (await fetch(url.replace('ws:','http:').replace('/ws','/health'))).json()).ok,true);
  const h=await connect(url),p=await connect(url),hk=identity(),pk=identity();
  assert.equal((await register(h,'host00001',hk,undefined,'x'.repeat(32))).type,'registered');
  assert.equal((await register(p,'peer00001',pk,'host00001')).paired,false);
  p.send({type:'turn'});assert.equal((await p.next()).code,'unpaired');
  h.send({type:'offer',secret:'s'.repeat(32),expiresAt:Date.now()+300000});assert.equal((await h.next()).type,'offer_created');
  p.send({type:'pair',hostId:'host00001',secret:'s'.repeat(32),name:'Android'});assert.equal((await h.next()).publicKey,pk.publicKeyText);assert.equal((await p.next()).type,'pair_pending');
  h.send({type:'approve',peerId:'peer00001',approved:true});assert.equal((await h.next()).type,'pair_approved');assert.equal((await p.next()).publicKey,hk.publicKeyText);
  const m={type:'signal',to:'host00001',sessionId:'session001',seq:1,kind:'offer',payload:'v=0\r\na=fingerprint:sha-256 TEST'};m.signature=sign('sha256',Buffer.from(signalText('peer00001',m)),pk.privateKey).toString('base64');p.send(m);assert.equal((await h.next()).payload,m.payload);
  p.send(m);assert.equal((await p.next()).code,'invalid_signature');
  p.send({...m,seq:2,payload:'tampered'});assert.equal((await p.next()).code,'invalid_signature');
  p.send({type:'turn'});const turn=await p.next();assert.equal(turn.type,'turn');assert.equal(turn.iceServers[0].credential,createHmac('sha1','turn-secret').update(turn.iceServers[0].username).digest('base64'));
  const q=await connect(url);await register(q,'peer00002',identity(),'host00001');q.send({type:'pair',hostId:'host00001',secret:'s'.repeat(32),name:'Second'});assert.equal((await q.next()).code,'invalid_pairing');
  h.send({type:'revoke',peerId:'peer00001'});assert.equal((await h.next()).type,'revoked');assert.equal(app.state.peers.peer00001.revoked,true);
 } finally {await app.close();}
});
test('bad registration and expired offer are rejected',async()=>{
 let time=Date.now();const app=createSignalingServer({adminToken:'x'.repeat(32),now:()=>time,log:()=>{}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const url=`ws://127.0.0.1:${app.server.address().port}/ws`;
 try {const bad=await connect(url);assert.equal((await register(bad,'badhost01',identity(),undefined,'wrong')).code,'authentication_failed');const h=await connect(url);await register(h,'host00001',identity(),undefined,'x'.repeat(32));h.send({type:'offer',secret:'s'.repeat(32),expiresAt:time-1});assert.equal((await h.next()).code,'invalid_offer');h.send({type:'offer',secret:'s'.repeat(32),expiresAt:time+300001});assert.equal((await h.next()).code,'invalid_offer');}finally{await app.close();}
});
test('pending pairing expires and persistent trust rejects substituted keys after restart',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'fox-signal-'));let time=Date.now();const config={adminToken:'x'.repeat(32),stateFile:join(directory,'state.json'),now:()=>time,log:()=>{}};const hk=identity(),pk=identity();let app=createSignalingServer(config);
 const listen=async()=>{await new Promise(r=>app.server.listen(0,'127.0.0.1',r));return `ws://127.0.0.1:${app.server.address().port}/ws`;};
 try {
  let url=await listen();const h=await connect(url),p=await connect(url);await register(h,'host00001',hk,undefined,'x'.repeat(32));await register(p,'peer00001',pk,'host00001');
  h.send({type:'offer',secret:'s'.repeat(32),expiresAt:time+1000});await h.next();p.send({type:'pair',hostId:'host00001',secret:'s'.repeat(32),name:'Android'});await h.next();await p.next();time+=1001;h.send({type:'approve',peerId:'peer00001',approved:true});assert.equal((await h.next()).code,'invalid_approval');
  h.send({type:'offer',secret:'n'.repeat(32),expiresAt:time+1000});await h.next();p.send({type:'pair',hostId:'host00001',secret:'n'.repeat(32),name:'Android'});await h.next();await p.next();h.send({type:'approve',peerId:'peer00001',approved:true});await h.next();await p.next();
  await app.close();app=createSignalingServer(config);url=await listen();const attacker=await connect(url);assert.equal((await register(attacker,'peer00001',identity(),'host00001')).code,'authentication_failed');const good=await connect(url);assert.equal((await register(good,'peer00001',pk,'host00001')).paired,true);const host=await connect(url);assert.equal((await register(host,'host00001',hk)).type,'registered');
 }finally{await app.close();rmSync(directory,{recursive:true,force:true});}
});
