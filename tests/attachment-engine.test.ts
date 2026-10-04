import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Engine,type EngineDeps} from '../apps/desktop/runtime/engine';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=','base64');
function events(delta:unknown){return `data: ${JSON.stringify({choices:[{delta}]})}\n\ndata: [DONE]\n\n`;}
async function fixture(config:{vision?:boolean;tools?:boolean;delta?:(body:any,index:number)=>unknown;native?:EngineDeps['native']}={}){
 const directory=mkdtempSync(join(tmpdir(),'fox-attachment-engine-')),requests:any[]=[],published:any[]=[];
 const server=http.createServer((req,res)=>{let source='';req.on('data',chunk=>source+=chunk);req.on('end',()=>{
  if(req.url==='/models'){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'fixture',name:'Fixture',architecture:{input_modalities:config.vision?['text','image']:['text'],output_modalities:['text']},supported_parameters:config.tools?['tools']:[]}]}));return;}
  if(req.url!=='/chat/completions'){res.writeHead(404);res.end();return;}const body=JSON.parse(source);requests.push(body);res.setHeader('content-type','text/event-stream');res.end(events(config.delta?.(body,requests.length-1)??{content:'Fixture complete.'}));
 });});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const engine=new Engine(directory,{credential:async()=>'',publish:event=>published.push(event),native:config.native});
 const command=(type:string,payload:any={})=>engine.command({version:1,id:randomUUID(),type,payload});
 const provider=await command('provider.save',{kind:'compatible',name:'Fixture',baseUrl:`http://127.0.0.1:${(server.address() as any).port}`});assert.equal(provider.ok,true);
 const bot=engine.snapshot().bots[0],conversation=engine.snapshot().conversations[0];assert.equal((await command('bot.update',{id:bot.id,revision:bot.revision,providerId:(provider.data as any).id,model:'fixture'})).ok,true);
 return {engine,directory,requests,published,command,provider:provider.data as any,conversation,
  catalog:()=>command('provider.models',{id:(provider.data as any).id}),
  upload:async(name:string,mime:string,bytes:Buffer)=>{const result=await command('attachment.upload',{name,mime,base64:bytes.toString('base64')});assert.equal(result.ok,true);return result.data as any;},
  send:async(attachments:any[]=[],content='Inspect the attached content')=>{const result=await command('message.send',{conversationId:conversation.id,content,attachments});assert.equal(result.ok,true);const runId=(result.data as any).runId,end=Date.now()+10000;while(true){const run=engine.snapshot().runs.find(r=>r.id===runId)!;if(['completed','failed','cancelled'].includes(run.status))return run;if(Date.now()>end)throw Error('Attachment run did not finish');await new Promise(resolve=>setTimeout(resolve,10));}},
  close:async()=>{await engine.close();await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(directory,{recursive:true,force:true});}};
}
test('actual model request includes bounded local text, excludes attachment paths and client-spoofed metadata',async()=>{
 const f=await fixture();try{
  const attachment=await f.upload('C:\\Users\\private\\context.csv','text/csv',Buffer.from('product,value\nFox,42\n'+'A'.repeat(20020)+'ATTACHMENT_TAIL_MUST_NOT_BE_SENT'));
  const run=await f.send([{...attachment,name:'spoofed.pdf',mime:'application/pdf'}]);assert.equal(run.status,'completed');assert.equal(f.requests.length,1);
  const submitted=JSON.stringify(f.requests[0]);assert.match(submitted,/Fox,42/);assert.match(submitted,/Attachment: context.csv/);assert.ok(!submitted.includes('spoofed.pdf'));assert.ok(!submitted.includes('private'));assert.ok(!submitted.includes(f.directory));
  assert.ok(!submitted.includes('ATTACHMENT_TAIL_MUST_NOT_BE_SENT'));assert.match(submitted,/Attachment truncated/);
  assert.ok(f.published.some(event=>event.type==='attachment.content_ready'&&event.data.truncated===true));
 }finally{await f.close();}
});
test('image makes no model request without cached vision metadata; discovery enables actual image blocks',async()=>{
 const f=await fixture({vision:true,tools:true});try{
  const attachment=await f.upload('fox.png','image/png',png);
  const blocked=await f.send([attachment]);assert.equal(blocked.status,'failed');assert.match(blocked.error??'',/cannot receive images/);assert.equal(f.requests.length,0,'missing capability knowledge must fail before paid model request');
  const catalog=await f.catalog();assert.equal(catalog.ok,true);const record=f.engine.store.get('model_catalog',f.provider.id+':fixture');assert.equal(record.capabilities.vision,true);
  const complete=await f.send([attachment],'Inspect the image now that this model supports vision');assert.equal(complete.status,'completed');assert.equal(f.requests.length,1);
  const blocks=f.requests[0].messages.filter((message:any)=>Array.isArray(message.content)).flatMap((message:any)=>message.content);const images=blocks.filter((block:any)=>block.type==='image_url');assert.ok(images.length>=1);assert.equal(images[0].image_url.url,`data:image/png;base64,${png.toString('base64')}`);
 }finally{await f.close();}
});
test('provider-declared tools:false omits tools and rejects unsolicited calls before any tool executes',async()=>{
 const f=await fixture({tools:false,delta:()=>({tool_calls:[{index:0,id:'unauthorized-call',function:{name:'remember',arguments:JSON.stringify({text:'Should never persist'})}}]})});try{
  assert.equal((await f.catalog()).ok,true);const record=f.engine.store.get('model_catalog',f.provider.id+':fixture');assert.equal(record.capabilitiesSource,'provider');assert.equal(record.capabilities.tools,false);
  const run=await f.send([], 'Answer with text only');assert.equal(run.status,'failed');assert.match(run.error??'',/tool not offered/);assert.equal(f.requests.length,1);assert.equal('tools' in f.requests[0],false);assert.equal(f.engine.snapshot().memories.length,0);assert.equal(f.engine.snapshot().tools.length,0);assert.equal(f.engine.snapshot().approvals.length,0);
 }finally{await f.close();}
});
test('a steering message attachment joins the active run before its next provider request',async()=>{
 const f=await fixture({tools:true,delta:(_body,index)=>index===0?{tool_calls:[{index:0,id:'question-call',function:{name:'ask_user',arguments:JSON.stringify({question:'Provide the requested context file'})}}]}:{content:'Steering attachment read.'}});try{
  assert.equal((await f.catalog()).ok,true);const started=await f.command('message.send',{conversationId:f.conversation.id,content:'Ask me for a context file'});assert.equal(started.ok,true);const runId=(started.data as any).runId;
  const until=async(predicate:()=>boolean)=>{const end=Date.now()+5000;while(!predicate()){if(Date.now()>end)throw Error('Steering run did not reach expected state');await new Promise(resolve=>setTimeout(resolve,10));}};
  await until(()=>f.engine.snapshot().runs.find(r=>r.id===runId)?.status==='awaiting_input');
  const attachment=await f.upload('steering.txt','text/plain',Buffer.from('STEERING_ATTACHMENT_CONTEXT_8192'));
  const steered=await f.command('message.send',{conversationId:f.conversation.id,content:'Here is the requested context',attachments:[attachment]});assert.equal(steered.ok,true);assert.equal((steered.data as any).steered,true);assert.equal((steered.data as any).runId,runId);
  await until(()=>f.engine.snapshot().runs.find(r=>r.id===runId)?.status==='completed');assert.equal(f.requests.length,2);assert.ok(!JSON.stringify(f.requests[0]).includes('STEERING_ATTACHMENT_CONTEXT_8192'));assert.ok(JSON.stringify(f.requests[1]).includes('STEERING_ATTACHMENT_CONTEXT_8192'));
 }finally{await f.close();}
});
test('actual screenshot tool artifact enters the next vision request without filesystem paths',async()=>{
 let captures=0;const f=await fixture({vision:true,tools:true,native:async(method,args)=>{
  if(method==='capabilities')return{available:true,screenshot:true};
  if(method==='screenshot'){captures++;writeFileSync(args.path,png);return{mime:'image/png',x:0,y:0,width:1,height:1};}
  return{ok:true};
 },delta:(_body,index)=>index===0?{tool_calls:[{index:0,id:'screenshot-call',function:{name:'native_screenshot',arguments:'{}'}}]}:{content:'Screenshot inspected.'}});try{
  assert.equal((await f.catalog()).ok,true);const run=await f.send([], 'Inspect your current screen');assert.equal(run.status,'completed');assert.equal(captures,1);assert.equal(f.requests.length,2);
  const firstImages=f.requests[0].messages.flatMap((message:any)=>Array.isArray(message.content)?message.content:[]).filter((block:any)=>block.type==='image_url');assert.equal(firstImages.length,0);
  const nextImages=f.requests[1].messages.flatMap((message:any)=>Array.isArray(message.content)?message.content:[]).filter((block:any)=>block.type==='image_url');assert.equal(nextImages.length,1);assert.equal(nextImages[0].image_url.url,`data:image/png;base64,${png.toString('base64')}`);
  const toolMessage=f.requests[1].messages.find((message:any)=>message.role==='tool');assert.match(toolMessage.content,/Artifact [a-f0-9-]{36}/);assert.ok(!JSON.stringify(f.requests).includes(f.directory));assert.equal(f.engine.snapshot().artifacts[0].runId,run.id);assert.equal('path' in f.engine.snapshot().artifacts[0],false);
 }finally{await f.close();}
});

// A standards-conforming one-page PDF fixture suitable for real packaged
// upload/chat smoke tests. It exercises font text extraction without OCR.
export function makePdfFixture(text='Fox packaged PDF proof'):Buffer {
 const escaped=text.replace(/[()\\]/g,'\\$&'),stream=`BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];let source='%PDF-1.4\n',offsets=[0];objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(source));source+=`${i+1} 0 obj\n${object}\nendobj\n`;});const xref=Buffer.byteLength(source);source+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(source);
}
