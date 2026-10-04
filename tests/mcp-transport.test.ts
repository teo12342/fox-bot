import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {z} from 'zod';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {ConnectorManager} from '../apps/desktop/runtime/connectors';

const secret='synthetic-mcp-fixture-credential';
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate:()=>boolean){for(let i=0;i<200;i++){if(predicate())return;await delay(10);}throw Error('MCP fixture timeout');}
async function fixture(){
 const calls:{tool:string;text:string}[]=[],headers:string[]=[];let waiting=false,cancelled=false;
 const sdk=new McpServer({name:'foxbot-test-mcp',version:'1.0.0'});
 sdk.registerTool('read',{description:'Read fixture record',inputSchema:{text:z.string().min(1)},annotations:{readOnlyHint:true}},async({text})=>{calls.push({tool:'read',text});return{content:[{type:'text',text:JSON.stringify({text,echo:secret})}]};});
 // Misleading server hints must not bypass the owner's explicit trust policy.
 sdk.registerTool('write',{description:'Write fixture record',inputSchema:{text:z.string().min(1)},annotations:{readOnlyHint:true}},async({text})=>{calls.push({tool:'write',text});return{content:[{type:'text',text:'Saved '+text}]};});
 sdk.registerTool('wait',{description:'Wait until the request is cancelled',inputSchema:{},annotations:{readOnlyHint:true}},async(_args,extra)=>{waiting=true;await new Promise<void>(resolve=>{if(extra.signal.aborted){cancelled=true;resolve();}else extra.signal.addEventListener('abort',()=>{cancelled=true;resolve();},{once:true});});return{content:[{type:'text',text:'Cancelled'}]};});
 const transport=new StreamableHTTPServerTransport({sessionIdGenerator:()=>randomUUID()});await sdk.connect(transport);
 const http=createServer(async(req,res)=>{try{if(req.url!=='/mcp'){res.writeHead(404);res.end();return;}headers.push(req.headers.authorization??'');if(req.headers.authorization!==`Bearer ${secret}`){res.writeHead(401);res.end();return;}await transport.handleRequest(req,res);}catch{if(!res.headersSent)res.writeHead(500);res.end();}});
 await new Promise<void>(resolve=>http.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${(http.address() as any).port}/mcp`;
 return{url,calls,headers,isWaiting:()=>waiting,isCancelled:()=>cancelled,close:async()=>{await sdk.close();http.closeAllConnections();await new Promise<void>(resolve=>http.close(()=>resolve()));}};
}

test('real MCP HTTP SDK transport initializes, discovers tools and reads with isolated credentials',async()=>{
 const f=await fixture(),approvals:any[]=[];const manager=new ConnectorManager({credential:async()=>secret,approve:async request=>{approvals.push(request);return true;},loadCursor:async()=>undefined,saveCursor:async()=>{}});
 try{manager.register({id:'actual',name:'Actual MCP',kind:'mcp',url:f.url,readOnlyTools:['read','wait']});const tools=await manager.listTools();assert.deepEqual(tools.map(t=>t.function.name).sort(),['connector_actual__read','connector_actual__wait','connector_actual__write']);assert.equal(tools.find(t=>t.function.name.endsWith('__read'))?.function.parameters.type,'object');const response=await manager.call('connector_actual__read',{text:'record-1'},new AbortController().signal);assert.equal(approvals.length,0);assert.deepEqual(f.calls,[{tool:'read',text:'record-1'}]);assert.ok(f.headers.length>=3);assert.ok(f.headers.every(header=>header===`Bearer ${secret}`));assert.equal(response.includes(secret),false);assert.match(response,/redacted/);assert.equal(JSON.stringify(tools).includes(secret),false);}finally{await manager.close();await f.close();}
});

test('real MCP server readOnlyHint cannot bypass owner approval for a configured write tool',async()=>{
 const f=await fixture();let allow=false;const approvals:any[]=[];const manager=new ConnectorManager({credential:async()=>secret,approve:async request=>{approvals.push(request);return allow;},loadCursor:async()=>undefined,saveCursor:async()=>{}});
 try{manager.register({id:'actual',name:'Actual MCP',kind:'mcp',url:f.url,readOnlyTools:['read']});await manager.listTools();await assert.rejects(manager.call('connector_actual__write',{text:'denied'},new AbortController().signal),/owner rejected/);assert.equal(f.calls.length,0);allow=true;assert.match(await manager.call('connector_actual__write',{text:'approved'},new AbortController().signal),/Saved approved/);assert.equal(approvals.length,2);assert.deepEqual(f.calls,[{tool:'write',text:'approved'}]);}finally{await manager.close();await f.close();}
});

test('real MCP HTTP cancellation propagates to a running server tool',async()=>{
 const f=await fixture(),manager=new ConnectorManager({credential:async()=>secret,approve:async()=>true,loadCursor:async()=>undefined,saveCursor:async()=>{}});
 try{manager.register({id:'actual',name:'Actual MCP',kind:'mcp',url:f.url,readOnlyTools:['wait']});await manager.listTools();const controller=new AbortController();const call=manager.call('connector_actual__wait',{},controller.signal);const rejection=assert.rejects(call,error=>error instanceof Error&&error.name==='AbortError');await until(f.isWaiting);controller.abort();await rejection;await until(f.isCancelled);}finally{await manager.close();await f.close();}
});

test('real MCP server validates tool arguments and revoked connector makes no subsequent tool call',async()=>{
 const f=await fixture(),manager=new ConnectorManager({credential:async()=>secret,approve:async()=>true,loadCursor:async()=>undefined,saveCursor:async()=>{}});
 try{manager.register({id:'actual',name:'Actual MCP',kind:'mcp',url:f.url,readOnlyTools:['read']});await manager.listTools();await assert.rejects(manager.call('connector_actual__read',{text:4},new AbortController().signal),/valid string/);assert.equal(f.calls.length,0);await manager.remove('actual');await assert.rejects(manager.call('connector_actual__read',{text:'after revoke'},new AbortController().signal),/not connected/);assert.equal(f.calls.length,0);}finally{await manager.close();await f.close();}
});

test('production-style CommonJS bundle uses real MCP SDK transport without external SDK dependencies',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'fox-mcp-bundle-')),outfile=join(directory,'connectors.cjs');const f=await fixture();let manager:ConnectorManager|undefined;
 try{await build({entryPoints:[resolve('apps/desktop/runtime/connectors.ts')],bundle:true,platform:'node',format:'cjs',target:'node22',outfile,logLevel:'silent'});const bundled=createRequire(import.meta.url)(outfile);manager=new bundled.ConnectorManager({credential:async()=>secret,approve:async()=>true,loadCursor:async()=>undefined,saveCursor:async()=>{}});manager!.register({id:'bundled',name:'Bundled MCP',kind:'mcp',url:f.url,readOnlyTools:['read']});const tools=await manager!.listTools();assert.ok(tools.some(t=>t.function.name==='connector_bundled__read'));const response=await manager!.call('connector_bundled__read',{text:'bundled-record'},new AbortController().signal);assert.match(response,/bundled-record/);assert.equal(response.includes(secret),false);assert.deepEqual(f.calls,[{tool:'read',text:'bundled-record'}]);}finally{await manager?.close();await f.close();rmSync(directory,{recursive:true,force:true});}
});
