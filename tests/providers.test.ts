import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import type {ProviderProfile} from '@foxbot/protocol';
import {generate,discover,sse,validateEndpoint,type ToolDefinition} from '../apps/desktop/runtime/providers.ts';

type Handler=(req:IncomingMessage,res:ServerResponse,body:any)=>void;
async function fixture(kind:ProviderProfile['kind'],handler:Handler){
 const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;handler(req,res,body?JSON.parse(body):null);});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const profile:ProviderProfile={id:'fixture',name:'Fixture',kind,baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,hasCredential:true};
 return {profile,close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
const tool:ToolDefinition={type:'function',function:{name:'file_read',description:'Read a file',parameters:{type:'object',properties:{path:{type:'string'}},required:['path']}}};
const events=(values:unknown[])=>values.map(value=>`data: ${JSON.stringify(value)}\n\n`).join('')+'data: [DONE]\n\n';
const syntheticSecret='fixture-only-api-key-never-real';

test('OpenAI-compatible streaming reconstructs parallel fragmented tool calls and usage',async()=>{
 let submitted:any,authorization:string|undefined;const f=await fixture('openai',(req,res,body)=>{submitted=body;authorization=req.headers.authorization;assert.equal(req.url,'/v1/chat/completions');res.writeHead(200,{'content-type':'text/event-stream'});res.end(events([
  {choices:[{delta:{content:'Read ',tool_calls:[{index:0,id:'call-a',function:{name:'file_read',arguments:'{"pa'}},{index:1,id:'call-b',function:{name:'file_read',arguments:'{"path":"b'}}]}}]},
  {choices:[{delta:{content:'files.',tool_calls:[{index:0,function:{arguments:'th":"a.txt"}'}},{index:1,function:{arguments:'.txt"}'}}]}}]},
  {choices:[],usage:{prompt_tokens:12,completion_tokens:8}}
 ]));});
 try {const chunks:string[]=[];const result=await generate(f.profile,syntheticSecret,'fixture-model',[{role:'user',content:'Read two files'}],[tool],new AbortController().signal,c=>chunks.push(c));assert.equal(result.text,'Read files.');assert.deepEqual(chunks,['Read ','files.']);assert.deepEqual(result.calls,[{id:'call-a',name:'file_read',arguments:'{"path":"a.txt"}'},{id:'call-b',name:'file_read',arguments:'{"path":"b.txt"}'}]);assert.deepEqual(result.usage,{prompt_tokens:12,completion_tokens:8});assert.equal(authorization,`Bearer ${syntheticSecret}`);assert.equal(submitted.stream,true);assert.deepEqual(submitted.tools,[tool]);assert.deepEqual(submitted.stream_options,{include_usage:true});assert.equal(JSON.stringify(submitted).includes(syntheticSecret),false);}finally{await f.close();}
});

test('Anthropic streaming maps system messages and tool results and reconstructs input JSON',async()=>{
 let submitted:any,headers:any;const f=await fixture('anthropic',(req,res,body)=>{submitted=body;headers=req.headers;assert.equal(req.url,'/v1/messages');res.writeHead(200,{'content-type':'text/event-stream'});res.end(events([
  {type:'content_block_start',index:0,content_block:{type:'tool_use',id:'tool-1',name:'file_read',input:{}}},
  {type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:'{"path":'}},
  {type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:'"note.md"}'}},
  {type:'content_block_delta',index:1,delta:{type:'text_delta',text:'Working'}},
  {type:'message_delta',usage:{output_tokens:17}}
 ]));});
 try {const result=await generate(f.profile,syntheticSecret,'claude-fixture',[{role:'system',content:'Local helper'},{role:'assistant',content:'',tool_calls:[{id:'previous',function:{name:'file_read',arguments:'{"path":"old.md"}'}}]},{role:'tool',tool_call_id:'previous',content:'Saved note'},{role:'user',content:'Read next'}],[tool],new AbortController().signal,()=>{});assert.equal(result.text,'Working');assert.deepEqual(result.calls,[{id:'tool-1',name:'file_read',arguments:'{"path":"note.md"}'}]);assert.equal(headers['x-api-key'],syntheticSecret);assert.equal(headers['anthropic-version'],'2023-06-01');assert.equal(headers.authorization,undefined);assert.equal(submitted.system,'Local helper');assert.equal(submitted.messages[0].content[0].type,'tool_use');assert.equal(submitted.messages[1].role,'user');assert.equal(submitted.messages[1].content[0].type,'tool_result');assert.equal(submitted.messages[1].content[1].text,'Read next');assert.deepEqual(submitted.tools[0].input_schema,tool.function.parameters);assert.deepEqual(result.usage,{output_tokens:17});assert.equal(JSON.stringify(submitted).includes(syntheticSecret),false);}finally{await f.close();}
});

test('SSE decoder handles fragmented UTF-8, CRLF, comments and multiline data',async()=>{
 const source=': keepalive\r\nevent: message\r\ndata: {"text":\r\ndata: "🦊 café"}\r\n\r\ndata: [DONE]\r\n\r\n';const bytes=new TextEncoder().encode(source);let index=0;
 const response=new Response(new ReadableStream({pull(controller){if(index>=bytes.length){controller.close();return;}controller.enqueue(bytes.slice(index,index+1));index++;}}));
 const actual=[];for await(const value of sse(response))actual.push(value);assert.deepEqual(actual,[{text:'🦊 café'}]);
});

test('malformed SSE errors omit the event body',async()=>{
 const response=new Response(`data: not-json-${syntheticSecret}\n\n`);await assert.rejects(async()=>{for await(const _ of sse(response)){}},error=>error instanceof Error&&error.message==='Invalid provider event'&&!error.message.includes(syntheticSecret));
});

test('provider cancellation interrupts a live response stream',async()=>{
 let disconnected=false;const f=await fixture('openai',(_req,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.write(events([{choices:[{delta:{content:'First'}}]}]).replace('data: [DONE]\n\n',''));res.on('close',()=>disconnected=true);});
 try {const abort=new AbortController();await assert.rejects(generate(f.profile,syntheticSecret,'fixture',[{role:'user',content:'Long task'}],[],abort.signal,()=>abort.abort()),error=>error instanceof Error&&error.name==='AbortError');await new Promise(resolve=>setTimeout(resolve,20));assert.equal(disconnected,true);}finally{await f.close();}
});

test('invalid keys, rate limits and provider error events never expose response secrets',async()=>{
 for(const [status,message] of [[401,'Invalid provider credential'],[429,'Provider rate limit exceeded'],[500,'Provider request failed (500)']] as const){const f=await fixture('openai',(_req,res)=>{res.writeHead(status);res.end(JSON.stringify({error:{message:`Rejected ${syntheticSecret}`}}));});try{await assert.rejects(generate(f.profile,syntheticSecret,'fixture',[],[],new AbortController().signal,()=>{}),error=>error instanceof Error&&error.message===message&&!error.message.includes(syntheticSecret));}finally{await f.close();}}
 for(const kind of ['openai','anthropic'] as const){const f=await fixture(kind,(_req,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.end(events([{type:'error',error:{message:syntheticSecret}}]));});try{await assert.rejects(generate(f.profile,syntheticSecret,'fixture',[],[],new AbortController().signal,()=>{}),error=>error instanceof Error&&error.message==='Provider returned an error');}finally{await f.close();}}
});

test('model discovery reads capabilities and does not assume unavailable modalities',async()=>{
 const f=await fixture('openrouter',(_req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'vision-audio',name:'Rich model',context_length:120000,architecture:{input_modalities:['text','image','audio'],output_modalities:['text','audio','image']},supported_parameters:['tools']},{id:'text-only'}]}));});
 try{const models=await discover(f.profile,syntheticSecret);assert.equal(models[0].contextLength,120000);assert.deepEqual(models[0].capabilities,{text:true,tools:true,vision:true,audioInput:true,audioOutput:true,imageGeneration:true});assert.equal(models[1].name,'text-only');assert.deepEqual(models[1].capabilities,{text:true,tools:false,vision:false,audioInput:false,audioOutput:false,imageGeneration:false});}finally{await f.close();}
});

test('endpoint policy rejects embedded credentials and remote cleartext; blank model makes no call',async()=>{
 assert.throws(()=>validateEndpoint('https://user:password@example.com/v1'),/credentials/);assert.throws(()=>validateEndpoint('http://example.com/v1'),/HTTPS/);assert.equal(validateEndpoint('http://[::1]:1234/v1/'),'http://[::1]:1234/v1');let called=false;const f=await fixture('openai',(_req,res)=>{called=true;res.end('{}');});try{await assert.rejects(generate(f.profile,syntheticSecret,'  ',[],[],new AbortController().signal,()=>{}),/Select a model/);assert.equal(called,false);}finally{await f.close();}
});

test('provider redirect is rejected instead of forwarding credential to another destination',async()=>{
 let reached=false;const target=await fixture('openai',(_req,res)=>{reached=true;res.end('{}');});const source=await fixture('openai',(_req,res)=>{res.writeHead(307,{location:target.profile.baseUrl+'/chat/completions'});res.end();});try{await assert.rejects(generate(source.profile,syntheticSecret,'fixture',[],[],new AbortController().signal,()=>{}));assert.equal(reached,false);}finally{await source.close();await target.close();}
});

test('Ollama omits OpenAI stream usage option unsupported by some local servers',async()=>{let submitted:any;const f=await fixture('ollama',(_req,res,body)=>{submitted=body;res.end(events([{choices:[{delta:{content:'Local'}}]}]));});try{assert.equal((await generate(f.profile,'','local',[],[],new AbortController().signal,()=>{})).text,'Local');assert.equal('stream_options' in submitted,false);}finally{await f.close();}});
