import {z} from 'zod';
import type {ToolDefinition} from './providers';

const safeUrl=z.string().url().refine(value=>{const u=new URL(value);return !u.username&&!u.password&&!u.hash&&(u.protocol==='https:'||(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)));},'Use HTTPS or an explicit loopback HTTP endpoint');
const identifier=z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/).refine(v=>!v.includes('__'),'Double underscores are reserved for tool routing');
const common={id:identifier,name:z.string().trim().min(1).max(100),enabled:z.boolean().default(true),grantedScopes:z.array(z.string().min(1).max(200)).max(100).default([])};
const httpTool=z.object({name:identifier,description:z.string().max(1000),method:z.enum(['GET','POST','PUT','PATCH','DELETE']),path:z.string().startsWith('/').refine(p=>!p.startsWith('//')&&!p.includes('#')&&!p.includes('?'),'Relative path only'),parameters:z.record(z.string(),z.unknown()),scopes:z.array(z.string()).default([]),approval:z.boolean().default(false)}).strict();
export const connectorManifestSchema=z.discriminatedUnion('kind',[
 z.object({...common,kind:z.enum(['github','gmail','drive','calendar','slack']),poll:z.object({repository:z.string().regex(/^[\w.-]+\/[\w.-]+$/).optional(),calendarId:z.string().min(1).max(300).optional(),channel:z.string().regex(/^[A-Z0-9]{1,100}$/).optional()}).optional()}).strict(),
 z.object({...common,kind:z.literal('http'),baseUrl:safeUrl,tools:z.array(httpTool).min(1).max(100),auth:z.enum(['bearer','none']).default('bearer')}).strict(),
 z.object({...common,kind:z.literal('mcp'),url:safeUrl,readOnlyTools:z.array(identifier).max(100).default([]),auth:z.enum(['bearer','none']).default('bearer')}).strict()
]);
export type ConnectorManifest=z.infer<typeof connectorManifestSchema>;
export interface ConnectorEvent {connectionId:string;id:string;type:string;data:unknown;}
export interface Approval {connectionId:string;tool:string;args:Record<string,unknown>;signal:AbortSignal;}
export interface McpClient {listTools:(params?:{cursor?:string})=>Promise<{tools:{name:string;description?:string;inputSchema:Record<string,unknown>}[];nextCursor?:string}>;callTool:(params:{name:string;arguments:Record<string,unknown>},schema?:unknown,options?:{signal:AbortSignal})=>Promise<unknown>;close:()=>Promise<void>;}
export interface ConnectorDeps {
 credential:(connectionId:string)=>Promise<string>;
 approve:(request:Approval)=>Promise<boolean>;
 loadCursor:(key:string)=>Promise<string|undefined>;
 saveCursor:(key:string,value:string)=>Promise<void>;
 fetch?:typeof fetch;
 mcpFactory?:(url:string,credential:string)=>Promise<McpClient>;
 now?:()=>Date;
}
type Schema=Record<string,any>;
type Request={url:string;method?:string;body?:unknown};
type Builtin={name:string;description:string;schema:Schema;scopes:string[];write?:boolean;request:(a:any)=>Request};
const object=(properties:Schema,required=Object.keys(properties)):Schema=>({type:'object',properties,required,additionalProperties:false});
const string={type:'string',minLength:1,maxLength:10000};
const optionalString={type:'string',maxLength:10000};
const segment=(v:string)=>{if(v==='.'||v==='..')throw Error('Path traversal is not allowed');return encodeURIComponent(v);};
const query=(base:string,args:Record<string,any>)=>{const u=new URL(base);for(const [k,v]of Object.entries(args))if(v!==undefined&&v!=='')u.searchParams.set(k,String(v));return u.href;};
const googleScope=(suffix:string)=>'https://www.googleapis.com/auth/'+suffix;
const github='https://api.github.com',gmail='https://gmail.googleapis.com/gmail/v1/users/me',drive='https://www.googleapis.com/drive/v3',calendar='https://www.googleapis.com/calendar/v3',slack='https://slack.com/api';
const builtins:Record<string,Builtin[]>={
 github:[
  {name:'repos',description:'List repositories accessible to the connected GitHub account',schema:object({}),scopes:['repo'],request:()=>({url:query(github+'/user/repos',{per_page:100,sort:'updated'})})},
  {name:'issues',description:'List repository issues',schema:object({owner:string,repo:string}),scopes:['repo'],request:a=>({url:query(`${github}/repos/${segment(a.owner)}/${segment(a.repo)}/issues`,{state:'all',per_page:100})})},
  {name:'create_issue',description:'Create a GitHub issue after owner approval',schema:object({owner:string,repo:string,title:{...string,maxLength:256},body:optionalString},['owner','repo','title']),scopes:['repo'],write:true,request:a=>({url:`${github}/repos/${segment(a.owner)}/${segment(a.repo)}/issues`,method:'POST',body:{title:a.title,body:a.body??''}})}
 ],
 gmail:[
  {name:'messages',description:'Search Gmail messages',schema:object({query:optionalString},[]),scopes:[googleScope('gmail.readonly')],request:a=>({url:query(gmail+'/messages',{q:a.query,maxResults:100})})},
  {name:'message',description:'Read a Gmail message',schema:object({id:string}),scopes:[googleScope('gmail.readonly')],request:a=>({url:query(`${gmail}/messages/${segment(a.id)}`,{format:'full'})})},
  {name:'send',description:'Send a plain-text email after owner approval',schema:object({to:{type:'string',minLength:3,maxLength:320,pattern:'^[^\\r\\n]+@[^\\r\\n]+$'},subject:{type:'string',maxLength:500,pattern:'^[^\\r\\n]*$'},body:string}),scopes:[googleScope('gmail.send')],write:true,request:a=>({url:gmail+'/messages/send',method:'POST',body:{raw:Buffer.from(`To: ${a.to}\r\nSubject: =?UTF-8?B?${Buffer.from(a.subject).toString('base64')}?=\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(a.body).toString('base64')}\r\n`).toString('base64url')}})}
 ],
 drive:[
  {name:'files',description:'Search files available in Google Drive',schema:object({query:optionalString},[]),scopes:[googleScope('drive.readonly')],request:a=>({url:query(drive+'/files',{q:a.query,pageSize:100,fields:'files(id,name,mimeType,modifiedTime),nextPageToken'})})},
  {name:'file',description:'Read metadata for a Google Drive file',schema:object({id:string}),scopes:[googleScope('drive.readonly')],request:a=>({url:query(`${drive}/files/${segment(a.id)}`,{fields:'id,name,mimeType,size,modifiedTime,webViewLink'})})},
  {name:'create_folder',description:'Create a Google Drive folder after owner approval',schema:object({name:{...string,maxLength:255},parent:optionalString},['name']),scopes:[googleScope('drive.file')],write:true,request:a=>({url:drive+'/files',method:'POST',body:{name:a.name,mimeType:'application/vnd.google-apps.folder',...(a.parent?{parents:[a.parent]}:{})}})}
 ],
 calendar:[
  {name:'events',description:'List calendar events',schema:object({calendarId:optionalString,timeMin:optionalString,timeMax:optionalString},[]),scopes:[googleScope('calendar.readonly')],request:a=>({url:query(`${calendar}/calendars/${segment(a.calendarId||'primary')}/events`,{timeMin:a.timeMin,timeMax:a.timeMax,maxResults:100,singleEvents:true,orderBy:'startTime'})})},
  {name:'create_event',description:'Create a calendar event after owner approval',schema:object({calendarId:optionalString,summary:{...string,maxLength:500},start:{type:'string',format:'date-time'},end:{type:'string',format:'date-time'},timezone:optionalString},['summary','start','end']),scopes:[googleScope('calendar.events')],write:true,request:a=>{if(Date.parse(a.end)<=Date.parse(a.start))throw Error('Event end must be after start');return{url:`${calendar}/calendars/${segment(a.calendarId||'primary')}/events`,method:'POST',body:{summary:a.summary,start:{dateTime:a.start,...(a.timezone?{timeZone:a.timezone}:{})},end:{dateTime:a.end,...(a.timezone?{timeZone:a.timezone}:{})}}};}}
 ],
 slack:[
  {name:'channels',description:'List public Slack channels',schema:object({}),scopes:['channels:read'],request:()=>({url:query(slack+'/conversations.list',{types:'public_channel',limit:100})})},
  {name:'history',description:'Read a public Slack channel history',schema:object({channel:string}),scopes:['channels:history'],request:a=>({url:query(slack+'/conversations.history',{channel:a.channel,limit:100})})},
  {name:'send',description:'Send a Slack message after owner approval',schema:object({channel:string,text:string}),scopes:['chat:write'],write:true,request:a=>({url:slack+'/chat.postMessage',method:'POST',body:{channel:a.channel,text:a.text}})}
 ]
};
export const BUILTIN_CONNECTORS=Object.entries(builtins).map(([kind,tools])=>({kind,name:{github:'GitHub',gmail:'Gmail',drive:'Google Drive',calendar:'Google Calendar',slack:'Slack'}[kind],scopes:[...new Set(tools.flatMap(t=>t.scopes))],tools:tools.map(t=>({name:t.name,description:t.description,scopes:t.scopes,approval:!!t.write}))}));

function validateArgs(schema:Schema,value:unknown,path='arguments',depth=0):void{
 if(depth>12)throw Error('Tool arguments are too deeply nested');
 if(schema.enum&&!schema.enum.includes(value))throw Error(`${path} is not an allowed value`);
 if(schema.type==='object'){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error(`${path} must be an object`);
  const record=value as Record<string,unknown>,properties=schema.properties??{};
  for(const key of schema.required??[])if(record[key]===undefined)throw Error(`${path}.${key} is required`);
  for(const [key,v]of Object.entries(record)){if(!(key in properties)){if(schema.additionalProperties===false)throw Error(`${path}.${key} is not allowed`);}else validateArgs(properties[key],v,`${path}.${key}`,depth+1);}
 }else if(schema.type==='array'){if(!Array.isArray(value))throw Error(`${path} must be an array`);if(schema.maxItems!==undefined&&value.length>schema.maxItems)throw Error(`${path} has too many items`);for(const v of value)validateArgs(schema.items??{},v,path,depth+1);}
 else if(schema.type==='string'){if(typeof value!=='string'||value.length<(schema.minLength??0)||value.length>(schema.maxLength??200000))throw Error(`${path} must be a valid string`);if(schema.pattern&&!new RegExp(schema.pattern).test(value))throw Error(`${path} has an invalid format`);if(schema.format==='date-time'&&!Number.isFinite(Date.parse(value)))throw Error(`${path} must be a date-time`);}
 else if(schema.type==='number'||schema.type==='integer'){if(typeof value!=='number'||!Number.isFinite(value)||(schema.type==='integer'&&!Number.isInteger(value)))throw Error(`${path} must be a number`);}
 else if(schema.type==='boolean'&&typeof value!=='boolean')throw Error(`${path} must be a boolean`);
}
const redact=(value:unknown,secret:string):string=>{const out=JSON.stringify(value);return secret?out.split(secret).join('[redacted]'):out;};

export class ConnectorManager {
 readonly connections=new Map<string,ConnectorManifest>();
 private clients=new Map<string,McpClient>();private mcpTools=new Map<string,Map<string,Schema>>();private polling=new Set<string>();
 constructor(readonly deps:ConnectorDeps){}
 register(input:unknown){const manifest=connectorManifestSchema.parse(input);if(this.connections.has(manifest.id))throw Error('Connector already registered; remove before replacing');if(manifest.kind==='http'&&new Set(manifest.tools.map(t=>t.name)).size!==manifest.tools.length)throw Error('Duplicate HTTP tool names');this.connections.set(manifest.id,manifest);return manifest;}
 async remove(id:string){this.connections.delete(id);this.mcpTools.delete(id);const c=this.clients.get(id);this.clients.delete(id);if(c)await c.close();}
 private connection(id:string){const c=this.connections.get(id);if(!c||!c.enabled)throw Error('Connector is not connected');return c;}
 private scopes(c:ConnectorManifest,required:string[]){if(required.some(scope=>!c.grantedScopes.includes(scope)))throw Error('Connector authorization is missing required scopes');}
 private async request(c:ConnectorManifest,request:Request,signal:AbortSignal):Promise<any>{
  signal.throwIfAborted();if(this.connection(c.id)!==c)throw Error('Connector changed before execution');const credential=await this.deps.credential(c.id);const noAuth=c.kind==='http'&&c.auth==='none';if(!credential&&!noAuth)throw Error('Connector credential is missing');
  let response:Response;try{response=await(this.deps.fetch??fetch)(request.url,{method:request.method??'GET',headers:{...(credential&&!noAuth?{Authorization:`Bearer ${credential}`}:{ }),'Content-Type':'application/json',...(c.kind==='github'?{'X-GitHub-Api-Version':'2022-11-28',Accept:'application/vnd.github+json'}:{})},body:request.body===undefined?undefined:JSON.stringify(request.body),redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});}catch{signal.throwIfAborted();throw Error('Connector network request failed');}
  if(!response.ok)throw Error(`Connector request failed (HTTP ${response.status})`);
  const declared=Number(response.headers.get('content-length')??0);if(declared>2*1024*1024)throw Error('Connector response exceeds 2 MB');
  if(!response.body)return null;const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader.cancel();throw Error('Connector response exceeds 2 MB');}chunks.push(value);}}finally{reader.releaseLock();}
  let data:any;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('Connector returned invalid JSON');}
  if(c.kind==='slack'&&data.ok!==true)throw Error('Slack rejected the connector request');return JSON.parse(redact(data,credential));
 }
 private async client(c:Extract<ConnectorManifest,{kind:'mcp'}>){let existing=this.clients.get(c.id);if(existing)return existing;const credential=c.auth==='none'?'':await this.deps.credential(c.id);if(c.auth!=='none'&&!credential)throw Error('Connector credential is missing');try{if(this.deps.mcpFactory)existing=await this.deps.mcpFactory(c.url,credential);else{const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');const {StreamableHTTPClientTransport}=await import('@modelcontextprotocol/sdk/client/streamableHttp.js');const client=new Client({name:'fox-bot',version:'0.1.0'});await client.connect(new StreamableHTTPClientTransport(new URL(c.url),{requestInit:{headers:credential?{Authorization:`Bearer ${credential}`}:{},redirect:'error'}}));existing=client as McpClient;}this.clients.set(c.id,existing);return existing;}catch{throw Error('MCP connection failed');}}
 async listTools():Promise<ToolDefinition[]>{const result:ToolDefinition[]=[];for(const c of this.connections.values()){if(!c.enabled)continue;let tools:{name:string;description:string;schema:Schema;scopes:string[]}[];
  if(c.kind==='mcp'){const client=await this.client(c),seen=new Set<string>(),all=[];let cursor:string|undefined;for(let page=0;page<100;page++){const response=await client.listTools(cursor?{cursor}:undefined);all.push(...response.tools);if(!response.nextCursor)break;if(seen.has(response.nextCursor))throw Error('MCP tool pagination repeated');seen.add(response.nextCursor);cursor=response.nextCursor;if(page===99)throw Error('MCP tool catalog exceeds pagination budget');}this.mcpTools.set(c.id,new Map(all.map(t=>[t.name,t.inputSchema])));tools=all.filter(t=>identifier.safeParse(t.name).success).map(t=>({name:t.name,description:t.description??'MCP tool',schema:t.inputSchema,scopes:[]}));}
  else tools=c.kind==='http'?c.tools.map(t=>({...t,schema:t.parameters})):builtins[c.kind];
  for(const t of tools){if(t.scopes.some(s=>!c.grantedScopes.includes(s)))continue;const name=`connector_${c.id}__${t.name}`;if(name.length>64)continue;result.push({type:'function',function:{name,description:`${c.name}: ${t.description}`.slice(0,1000),parameters:t.schema}});}
 }return result;}
 async call(name:string,args:Record<string,unknown>,signal:AbortSignal):Promise<string>{const match=name.match(/^connector_([\w-]+)__([\w-]+)$/);if(!match)throw Error('Invalid connector tool name');const c=this.connection(match[1]);let schema:Schema,scopes:string[]=[],write:boolean,request:Request|undefined;
  if(c.kind==='mcp'){schema=this.mcpTools.get(c.id)?.get(match[2])??{};if(!this.mcpTools.get(c.id)?.has(match[2]))throw Error('Discover MCP tools before calling');write=!c.readOnlyTools.includes(match[2]);}
  else if(c.kind==='http'){const tool=c.tools.find(t=>t.name===match[2]);if(!tool)throw Error('Unknown connector tool');schema=tool.parameters;scopes=tool.scopes;write=tool.method!=='GET'||tool.approval;}
  else{const tool=builtins[c.kind].find(t=>t.name===match[2]);if(!tool)throw Error('Unknown connector tool');schema=tool.schema;scopes=tool.scopes;write=!!tool.write;}
  this.scopes(c,scopes);validateArgs(schema,args);signal.throwIfAborted();if(write&&!await this.deps.approve({connectionId:c.id,tool:match[2],args,signal}))throw Error('The owner rejected this external action');signal.throwIfAborted();if(this.connection(c.id)!==c)throw Error('Connector changed during approval');
  if(c.kind==='mcp'){try{const value=await(await this.client(c)).callTool({name:match[2],arguments:args},undefined,{signal});const out=redact(value,await this.deps.credential(c.id));if(out.length>2*1024*1024)throw Error('Response too large');return out;}catch{signal.throwIfAborted();throw Error('MCP tool call failed');}}
  if(c.kind==='http'){const tool=c.tools.find(t=>t.name===match[2])!;let relative=tool.path.replace(/\{([\w-]+)\}/g,(_,key)=>{if(typeof args[key]!=='string')throw Error('Missing URL path argument');return segment(String(args[key]));});const base=new URL(c.baseUrl),url=new URL(relative,base);if(url.origin!==base.origin)throw Error('HTTP tool leaves configured origin');const used=new Set([...tool.path.matchAll(/\{([\w-]+)\}/g)].map(m=>m[1]));const remaining=Object.fromEntries(Object.entries(args).filter(([k])=>!used.has(k)));request={url:tool.method==='GET'?query(url.href,remaining):url.href,method:tool.method,...(tool.method==='GET'?{}:{body:remaining})};}
  else request=builtins[c.kind].find(t=>t.name===match[2])!.request(args);
  return JSON.stringify(await this.request(c,request,signal));
 }
 async poll(id:string,onEvent:(event:ConnectorEvent)=>Promise<void>,signal:AbortSignal):Promise<number>{
  const c=this.connection(id);if(c.kind==='http'||c.kind==='mcp')throw Error('Polling requires a built-in connector');if(this.polling.has(id))throw Error('Connector poll already running');this.polling.add(id);try{
   const scope={github:'repo',gmail:googleScope('gmail.readonly'),drive:googleScope('drive.readonly'),calendar:googleScope('calendar.readonly'),slack:'channels:history'}[c.kind];this.scopes(c,[scope]);const key='connector:'+id;let cursor=await this.deps.loadCursor(key);const events:ConnectorEvent[]=[];let next=cursor;
   if(c.kind==='gmail'){
    if(!cursor){const profile=await this.request(c,{url:gmail+'/profile'},signal);next=String(profile.historyId);}
    else{let pageToken:string|undefined;for(let page=0;page<100;page++){const response=await this.request(c,{url:query(gmail+'/history',{startHistoryId:cursor,pageToken,historyTypes:'messageAdded',maxResults:100})},signal);for(const h of response.history??[])for(const entry of h.messagesAdded??[])events.push({connectionId:id,id:`${h.id}:${entry.message.id}`,type:'gmail.message_added',data:entry.message});next=String(response.historyId);if(!response.nextPageToken)break;pageToken=response.nextPageToken;if(page===99)throw Error('Polling pagination budget exceeded');}}
   }else if(c.kind==='drive'){
    if(!cursor){const start=await this.request(c,{url:drive+'/changes/startPageToken'},signal);next=String(start.startPageToken);}
    else{let pageToken=cursor;for(let page=0;page<100;page++){const response=await this.request(c,{url:query(drive+'/changes',{pageToken,pageSize:100,fields:'changes(fileId,removed,time,file(id,name,mimeType)),nextPageToken,newStartPageToken'})},signal);for(const change of response.changes??[])events.push({connectionId:id,id:`${change.fileId}:${change.time}:${change.removed??false}`,type:'drive.changed',data:change});if(response.newStartPageToken)next=response.newStartPageToken;if(!response.nextPageToken)break;pageToken=response.nextPageToken;if(page===99)throw Error('Polling pagination budget exceeded');}}
   }else if(c.kind==='calendar'){
    let pageToken:string|undefined;for(let page=0;page<100;page++){const response=await this.request(c,{url:query(`${calendar}/calendars/${segment(c.poll?.calendarId??'primary')}/events`,{syncToken:cursor,pageToken,maxResults:100,showDeleted:true})},signal);if(cursor)for(const e of response.items??[])events.push({connectionId:id,id:`${e.id}:${e.updated}`,type:'calendar.changed',data:e});if(response.nextSyncToken)next=response.nextSyncToken;if(!response.nextPageToken)break;pageToken=response.nextPageToken;if(page===99)throw Error('Polling pagination budget exceeded');}
   }else if(c.kind==='github'){
    if(!c.poll?.repository)throw Error('GitHub polling requires a repository');const upper=(this.deps.now?.()??new Date()).toISOString();if(cursor){for(let page=1;page<=100;page++){const response=await this.request(c,{url:query(`${github}/repos/${c.poll.repository}/issues`,{state:'all',since:cursor,sort:'updated',direction:'asc',per_page:100,page})},signal);if(!Array.isArray(response))throw Error('Invalid GitHub polling response');for(const e of response)if(Date.parse(e.updated_at)>Date.parse(cursor)&&Date.parse(e.updated_at)<=Date.parse(upper))events.push({connectionId:id,id:`${e.id}:${e.updated_at}`,type:'github.issue_changed',data:e});if(response.length<100)break;if(page===100)throw Error('Polling pagination budget exceeded');}}next=upper;
   }else{
    if(!c.poll?.channel)throw Error('Slack polling requires a channel');if(!cursor){const response=await this.request(c,{url:query(slack+'/conversations.history',{channel:c.poll.channel,limit:1})},signal);next=response.messages?.[0]?.ts??'0';}else{let pageCursor:string|undefined;for(let page=0;page<100;page++){const response=await this.request(c,{url:query(slack+'/conversations.history',{channel:c.poll.channel,oldest:cursor,inclusive:false,limit:100,cursor:pageCursor})},signal);for(const e of response.messages??[]){events.push({connectionId:id,id:e.ts,type:'slack.message',data:e});if(Number(e.ts)>Number(next))next=e.ts;}pageCursor=response.response_metadata?.next_cursor;if(!pageCursor)break;if(page===99)throw Error('Polling pagination budget exceeded');}}
   }
   signal.throwIfAborted();const seen=new Set<string>();for(const event of events){if(seen.has(event.id))continue;seen.add(event.id);await onEvent(event);signal.throwIfAborted();}if(!next||next==='undefined')throw Error('Provider returned no polling cursor');await this.deps.saveCursor(key,next);return seen.size;
  }finally{this.polling.delete(id);}
 }
 async close(){await Promise.allSettled([...this.clients.values()].map(c=>c.close()));this.clients.clear();this.mcpTools.clear();}
}

