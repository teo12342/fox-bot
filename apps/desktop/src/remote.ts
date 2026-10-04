declare global {interface Window {fox:any;}}
const sessions=new Map<string,{pc:RTCPeerConnection,sessionId:string,seq:number,channel?:RTCDataChannel,ice:RTCIceCandidateInit[]}>();let iceServers:RTCIceServer[]=[];
const fragments=new Map<string,{total:number,parts:Map<number,string>,size:number,at:number}>();
const queues=new WeakMap<RTCDataChannel,Promise<void>>();
function send(channel:RTCDataChannel,value:unknown){const previous=queues.get(channel)??Promise.resolve();const task=previous.catch(()=>{}).then(async()=>{const text=JSON.stringify(value);const pieces:string[]=[];if(text.length<=16000)pieces.push(text);else{const id=crypto.randomUUID(),total=Math.ceil(text.length/16000);if(total>2048)throw Error('Transfer exceeds limit');for(let index=0;index<total;index++)pieces.push(JSON.stringify({type:'fragment',id,index,total,data:text.slice(index*16000,(index+1)*16000)}));}for(const p of pieces){const end=Date.now()+30000;while(channel.bufferedAmount>256*1024){if(channel.readyState!=='open'||Date.now()>end)throw Error('Transfer interrupted');await new Promise(r=>setTimeout(r,20));}if(channel.readyState!=='open')throw Error('Device disconnected');channel.send(p);}});queues.set(channel,task);void task.catch(()=>channel.close());}
function decode(text:string):any {const m=JSON.parse(text);if(m.type!=='fragment')return m;if(!Number.isInteger(m.total)||m.total<1||m.total>2048||!Number.isInteger(m.index)||m.index<0||m.index>=m.total||typeof m.data!=='string'||m.data.length>16384)throw Error('Invalid transfer fragment');for(const[id,f]of fragments)if(Date.now()-f.at>60000)fragments.delete(id);let f=fragments.get(m.id);if(!f){if(fragments.size>=8)throw Error('Too many transfers');f={total:m.total,parts:new Map(),size:0,at:Date.now()};fragments.set(m.id,f);}if(f.total!==m.total||f.parts.has(m.index))throw Error('Duplicate fragment');f.parts.set(m.index,m.data);f.size+=m.data.length;if(f.size>32*1024*1024)throw Error('Transfer too large');if(f.parts.size!==f.total)return null;fragments.delete(m.id);return JSON.parse(Array.from({length:f.total},(_,i)=>f!.parts.get(i)).join(''));}
export function startRemote(){window.fox.onRemote(async(m:any)=>{try{
 if(m.type==='turn'){iceServers=m.iceServers;return;}
 if(m.type==='disconnect'){for(const s of sessions.values())s.pc.close();sessions.clear();return;}
 if(m.type==='revoke'){sessions.get(m.id)?.pc.close();sessions.delete(m.id);return;}
 if(m.type!=='signal')return;
 let s=sessions.get(m.from);
 if(m.kind==='offer'){
  s?.pc.close();const pc=new RTCPeerConnection({iceServers});s={pc,sessionId:m.sessionId,seq:0,ice:[]};sessions.set(m.from,s);const state=s;
  pc.onicecandidate=event=>{if(event.candidate)void window.fox.remote('signal',{to:m.from,sessionId:state.sessionId,seq:++state.seq,kind:'ice',payload:JSON.stringify(event.candidate.toJSON())});};
  pc.ondatachannel=event=>{if(event.channel.label!=='fox-rpc'){event.channel.close();return;}state.channel=event.channel;event.channel.onmessage=async({data})=>{try{if(typeof data!=='string'||data.length>200000)throw Error('Invalid RPC frame');const packet=decode(data);if(!packet)return;if(packet.type==='command'){const result=await window.fox.remote('command',{peerId:m.from,command:packet.command});send(event.channel,{type:'result',result});}}catch{send(event.channel,{type:'error',message:'Invalid RPC request'});}};};
  await pc.setRemoteDescription({type:'offer',sdp:m.payload});for(const candidate of state.ice)await pc.addIceCandidate(candidate);state.ice=[];
  if(pc.getTransceivers().some(t=>t.receiver.track.kind==='video')){try{const stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});for(const track of stream.getTracks())pc.addTrack(track,stream);}catch{}}
  const answer=await pc.createAnswer();await pc.setLocalDescription(answer);await window.fox.remote('signal',{to:m.from,sessionId:state.sessionId,seq:++state.seq,kind:'answer',payload:answer.sdp});
 }else if(m.kind==='ice' && s && s.sessionId===m.sessionId){const candidate=JSON.parse(m.payload);if(!s.pc.remoteDescription)s.ice.push(candidate);else await s.pc.addIceCandidate(candidate);}
 }catch{sessions.get(m.from)?.pc.close();sessions.delete(m.from);}});
 window.fox.onEvent((event:any)=>{for(const s of sessions.values())if(s.channel?.readyState==='open')send(s.channel,{type:'event',event});});
}
