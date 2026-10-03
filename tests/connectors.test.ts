import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ConnectorManager,connectorManifestSchema,type ConnectorDeps,type McpClient} from '../apps/desktop/runtime/connectors';
const signal=()=>new AbortController().signal;
function setup(handler:(url:string,init?:RequestInit)=>unknown=()=>({ok:true}),approval=true){
 const calls:{url:string;init?:RequestInit}[]=[],approved:any[]=[],cursors=new Map<string,string>();
 const deps:ConnectorDeps={credential:async id=>'secret-for-'+id,approve:async request=>{approved.push(request);return approval;},loadCursor:async k=>cursors.get(k),saveCursor:async(k,v)=>{cursors.set(k,v);},fetch:async(url:any,init)=>{calls.push({url:String(url),init});return Response.json(handler(String(url),init));},now:()=>new Date('2026-10-04T12:00:00Z')};
 return{manager:new ConnectorManager(deps),deps,calls,approved,cursors};
}
test('manifest rejects credentials in URLs, external plaintext and ambiguous paths',()=>{
 const base={id:'custom',name:'Custom',kind:'http',baseUrl:'https://example.com',tools:[{name:'read',description:'Read',method:'GET',path:'/v1/items',parameters:{type:'object'}}]};
 assert.doesNotThrow(()=>connectorManifestSchema.parse(base));
 for(const baseUrl of ['http://example.com','https://key:secret@example.com','file:///tmp/file'])assert.throws(()=>connectorManifestSchema.parse({...base,baseUrl}));
 assert.throws(()=>connectorManifestSchema.parse({...base,tools:[{...base.tools[0],path:'//evil.example/items'}]}));
});
test('lists only tools with granted scopes and refuses direct unauthorized calls',async()=>{
 const {manager,calls}=setup();manager.register({id:'mail',name:'Gmail',kind:'gmail',grantedScopes:['https://www.googleapis.com/auth/gmail.readonly']});
 const names=(await manager.listTools()).map(t=>t.function.name);assert.ok(names.includes('connector_mail__messages'));assert.ok(!names.includes('connector_mail__send'));
 await assert.rejects(manager.call('connector_mail__send',{to:'me@example.com',subject:'Hello',body:'Hi'},signal()),/missing required scopes/);assert.equal(calls.length,0);
});
test('external writes cannot happen before approval and rejection makes no request',async()=>{
 const denied=setup(undefined,false);denied.manager.register({id:'slack',name:'Slack',kind:'slack',grantedScopes:['chat:write']});
 await assert.rejects(denied.manager.call('connector_slack__send',{channel:'C123',text:'Hello'},signal()),/owner rejected/);assert.equal(denied.calls.length,0);assert.equal(denied.approved.length,1);
 const allowed=setup();allowed.manager.register({id:'gh',name:'GitHub',kind:'github',grantedScopes:['repo']});await allowed.manager.call('connector_gh__create_issue',{owner:'fox',repo:'bot',title:'Bug'},signal());
 assert.equal(allowed.approved.length,1);assert.equal(allowed.calls.length,1);assert.equal(allowed.calls[0].init?.method,'POST');assert.equal((allowed.calls[0].init?.headers as any).Authorization,'Bearer secret-for-gh');assert.equal(allowed.calls[0].init?.redirect,'error');
});
test('email header injection fails before approval and transport',async()=>{
 const {manager,calls,approved}=setup();manager.register({id:'mail',name:'Gmail',kind:'gmail',grantedScopes:['https://www.googleapis.com/auth/gmail.send']});
 await assert.rejects(manager.call('connector_mail__send',{to:'victim@example.com\r\nBcc: other@example.com',subject:'Hello',body:'Body'},signal()),/invalid format/);assert.equal(calls.length,0);assert.equal(approved.length,0);
});
test('HTTP tool encodes path values, sends only remaining args and cannot suppress POST approval',async()=>{
 const {manager,calls,approved}=setup();manager.register({id:'custom',name:'Custom',kind:'http',baseUrl:'https://service.example',grantedScopes:[],tools:[{name:'update',description:'Update',method:'POST',path:'/items/{id}',approval:false,parameters:{type:'object',properties:{id:{type:'string'},text:{type:'string'}},required:['id','text'],additionalProperties:false}}]});
 await manager.call('connector_custom__update',{id:'a/b',text:'new'},signal());assert.equal(approved.length,1);assert.equal(calls[0].url,'https://service.example/items/a%2Fb');assert.deepEqual(JSON.parse(calls[0].init!.body as string),{text:'new'});
});
test('response cannot echo the credential into model-visible content',async()=>{
 const {manager}=setup(()=>({note:'secret-for-gh'}));manager.register({id:'gh',name:'GitHub',kind:'github',grantedScopes:['repo']});const out=await manager.call('connector_gh__repos',{},signal());assert.ok(!out.includes('secret-for-gh'));assert.ok(out.includes('[redacted]'));
});
test('MCP SDK bridge discovers paginated tools and approves writes independent of annotations',async()=>{
 const {manager,deps,approved}=setup();const invoked:any[]=[],catalogCalls:any[]=[];const mock:McpClient={listTools:async params=>{catalogCalls.push(params);return params?.cursor?{tools:[{name:'write',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']}}]}:{tools:[{name:'read',inputSchema:{type:'object',properties:{}}}],nextCursor:'page2'};},callTool:async params=>{invoked.push(params);return {content:[{type:'text',text:'done'}]};},close:async()=>{}};
 deps.mcpFactory=async(url,key)=>{assert.equal(url,'https://mcp.example');assert.equal(key,'secret-for-mcp');return mock;};
 manager.register({id:'mcp',name:'MCP',kind:'mcp',url:'https://mcp.example',readOnlyTools:['read']});assert.equal((await manager.listTools()).length,2);assert.equal(catalogCalls.length,2);
 await manager.call('connector_mcp__read',{},signal());assert.equal(approved.length,0);await manager.call('connector_mcp__write',{text:'new'},signal());assert.equal(approved.length,1);assert.equal(invoked.length,2);await manager.close();
});
test('Gmail polling seeds without historical execution, follows pages and commits after delivery',async()=>{
 let stage=0;const {manager,cursors,calls}=setup(url=>{const u=new URL(url);if(u.pathname.endsWith('/profile'))return{historyId:'10'};if(u.searchParams.get('pageToken')==='next')return{historyId:'12',history:[{id:'12',messagesAdded:[{message:{id:'m2'}}]}]};return{historyId:'12',nextPageToken:'next',history:[{id:'11',messagesAdded:[{message:{id:'m1'}}]}]};});
 manager.register({id:'mail',name:'Gmail',kind:'gmail',grantedScopes:['https://www.googleapis.com/auth/gmail.readonly']});assert.equal(await manager.poll('mail',async()=>{stage++;},signal()),0);assert.equal(cursors.get('connector:mail'),'10');assert.equal(stage,0);
 const delivered:string[]=[];assert.equal(await manager.poll('mail',async event=>{assert.equal(cursors.get('connector:mail'),'10');delivered.push(event.id);},signal()),2);assert.deepEqual(delivered,['11:m1','12:m2']);assert.equal(cursors.get('connector:mail'),'12');assert.equal(calls.length,3);
});
test('poll delivery failure preserves cursor so caller can deduplicate on retry',async()=>{
 const {manager,cursors}=setup(()=>({historyId:'12',history:[{id:'11',messagesAdded:[{message:{id:'m1'}}]}]}));cursors.set('connector:mail','10');manager.register({id:'mail',name:'Gmail',kind:'gmail',grantedScopes:['https://www.googleapis.com/auth/gmail.readonly']});
 await assert.rejects(manager.poll('mail',async()=>{throw Error('Local transaction failed');},signal()),/Local transaction failed/);assert.equal(cursors.get('connector:mail'),'10');
});
test('removed connectors and cancellation cannot execute tools',async()=>{
 const {manager,calls}=setup();manager.register({id:'gh',name:'GitHub',kind:'github',grantedScopes:['repo']});const controller=new AbortController();controller.abort();await assert.rejects(manager.call('connector_gh__repos',{},controller.signal));assert.equal(calls.length,0);await manager.remove('gh');await assert.rejects(manager.call('connector_gh__repos',{},signal()),/not connected/);
});
test('disconnect during owner approval prevents the external write',async()=>{
 const {manager,deps,calls}=setup();manager.register({id:'gh',name:'GitHub',kind:'github',grantedScopes:['repo']});deps.approve=async()=>{await manager.remove('gh');return true;};await assert.rejects(manager.call('connector_gh__create_issue',{owner:'fox',repo:'bot',title:'Bug'},signal()),/not connected/);assert.equal(calls.length,0);
});
test('HTTP redirects and credential-bearing transport errors are sanitized',async()=>{
 const {manager,deps}=setup();manager.register({id:'gh',name:'GitHub',kind:'github',grantedScopes:['repo']});deps.fetch=async()=>{throw Error('Bearer secret-for-gh redirect failed');};await assert.rejects(manager.call('connector_gh__repos',{},signal()),error=>{assert.ok(!String(error).includes('secret-for-gh'));return /network request failed/.test(String(error));});
});
test('Drive folder writes and Calendar event writes use approved API requests',async()=>{
 const {manager,calls,approved}=setup();manager.register({id:'drive',name:'Drive',kind:'drive',grantedScopes:['https://www.googleapis.com/auth/drive.file']});manager.register({id:'cal',name:'Calendar',kind:'calendar',grantedScopes:['https://www.googleapis.com/auth/calendar.events']});
 await manager.call('connector_drive__create_folder',{name:'Projects',parent:'parent-id'},signal());assert.deepEqual(JSON.parse(calls[0].init!.body as string),{name:'Projects',mimeType:'application/vnd.google-apps.folder',parents:['parent-id']});
 await manager.call('connector_cal__create_event',{summary:'Review',start:'2026-10-04T12:00:00Z',end:'2026-10-04T13:00:00Z',timezone:'Europe/Athens'},signal());assert.equal(calls[1].url,'https://www.googleapis.com/calendar/v3/calendars/primary/events');assert.equal(approved.length,2);
});
test('Drive polling advances only to newStartPageToken after all change pages',async()=>{
 const {manager,cursors}=setup(url=>{const token=new URL(url).searchParams.get('pageToken');return token==='start'?{changes:[{fileId:'one',time:'2026-10-04T12:00:00Z'}],nextPageToken:'next'}:{changes:[{fileId:'two',time:'2026-10-04T12:01:00Z'}],newStartPageToken:'future'};});cursors.set('connector:drive','start');manager.register({id:'drive',name:'Drive',kind:'drive',grantedScopes:['https://www.googleapis.com/auth/drive.readonly']});const seen:any[]=[];await manager.poll('drive',async event=>{seen.push(event);},signal());assert.equal(seen.length,2);assert.equal(cursors.get('connector:drive'),'future');
});
test('Calendar initial sync does not fire historical events and retains server sync token',async()=>{
 const {manager,cursors}=setup(()=>({items:[{id:'old',updated:'2025-01-01'}],nextSyncToken:'sync123'}));manager.register({id:'cal',name:'Calendar',kind:'calendar',grantedScopes:['https://www.googleapis.com/auth/calendar.readonly']});let count=0;await manager.poll('cal',async()=>{count++;},signal());assert.equal(count,0);assert.equal(cursors.get('connector:cal'),'sync123');await manager.poll('cal',async()=>{count++;},signal());assert.equal(count,1);
});
test('GitHub polling uses bounded since window and Slack polling deduplicates timestamps',async()=>{
 const {manager,cursors}=setup(url=>url.includes('api.github.com')?[{id:1,updated_at:'2026-10-04T11:30:00Z'},{id:2,updated_at:'2026-10-04T12:30:00Z'}]:{ok:true,messages:[{ts:'110.001',text:'hello'},{ts:'110.001',text:'hello'}]});manager.register({id:'gh',name:'GitHub',kind:'github',grantedScopes:['repo'],poll:{repository:'fox/bot'}});manager.register({id:'slack',name:'Slack',kind:'slack',grantedScopes:['channels:history'],poll:{channel:'C123'}});cursors.set('connector:gh','2026-10-04T11:00:00Z');cursors.set('connector:slack','100.0');const events:any[]=[];assert.equal(await manager.poll('gh',async e=>{events.push(e);},signal()),1);assert.equal(cursors.get('connector:gh'),'2026-10-04T12:00:00.000Z');assert.equal(await manager.poll('slack',async e=>{events.push(e);},signal()),1);assert.equal(cursors.get('connector:slack'),'110.001');assert.equal(events.length,2);
});
