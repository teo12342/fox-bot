import {mkdir,readFile,writeFile,readdir,realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute,dirname,join} from 'node:path';
import {spawn} from 'node:child_process';
import type {BrowserContext} from 'playwright';
import type {ToolDefinition} from './providers';
export const definitions:ToolDefinition[]=[
 ['workspace_list','List files in the local shared workspace',{path:{type:'string'}}],
 ['workspace_read','Read a UTF-8 workspace file',{path:{type:'string'}}],
 ['workspace_write','Write a workspace file. Requires approval.',{path:{type:'string'},content:{type:'string'}}],
 ['terminal_run','Run a shell command in the workspace. Requires approval.',{command:{type:'string'}}],
 ['browser_open','Open a website in the dedicated browser',{url:{type:'string'}}],
 ['browser_read','Read visible text and interactive elements in the dedicated browser',{}],
 ['browser_click','Click a browser element with a Playwright locator. Requires approval.',{selector:{type:'string'}}],
 ['browser_type','Fill a browser input. Requires approval. Never enter passwords.',{selector:{type:'string'},text:{type:'string'}}],
 ['browser_screenshot','Save a screenshot of the dedicated browser',{}],
 ['remember','Save useful role context in this bot’s inspectable memory',{text:{type:'string'}}],
 ['delegate','Delegate a bounded task to another bot',{botId:{type:'string'},task:{type:'string'}}],
 ['ask_user','Ask the owner a question and wait for a response',{question:{type:'string'}}]
].map(([name,description,properties])=>({type:'function',function:{name:name as string,description:description as string,parameters:{type:'object',properties,required:Object.keys(properties as object),additionalProperties:false}}}));
export const approvalTools=new Set(['workspace_write','terminal_run','browser_click','browser_type']);
export class Tools {
 contexts=new Map<string,BrowserContext>(); takenOver=false;
 constructor(readonly root:string,readonly artifact:(path:string,mime:string)=>Promise<string>){ }
 async safePath(input:string,write=false){await mkdir(this.root,{recursive:true});const base=await realpath(this.root);const p=resolve(base,input);const rel=relative(base,p);if(rel.startsWith('..')||isAbsolute(rel))throw Error('Path leaves the workspace');let target=p;while(true){try{const actual=await realpath(target);const r=relative(base,actual);if(r.startsWith('..')||isAbsolute(r))throw Error('Symlink leaves the workspace');break;}catch(e:any){if(e.code!=='ENOENT')throw e;const next=dirname(target);if(next===target)throw e;target=next;}}if(!write)await realpath(p);return p;}
 async context(botId:string){let c=this.contexts.get(botId);if(!c){const {chromium}=await import('playwright');c=await chromium.launchPersistentContext(join(this.root,'.browser',botId),{headless:false,acceptDownloads:true});this.contexts.set(botId,c);c.on('close',()=>this.contexts.delete(botId));}return c;}
 async execute(name:string,args:any,botId:string,signal:AbortSignal):Promise<string>{
  signal.throwIfAborted();if(this.takenOver && name.startsWith('browser_'))throw Error('Computer is under human control');
  if(name==='workspace_list')return JSON.stringify(await readdir(await this.safePath(args.path||'.'),{withFileTypes:true}).then(x=>x.filter(e=>e.name!=='.browser').map(e=>({name:e.name,directory:e.isDirectory()}))));
  if(name==='workspace_read'){const p=await this.safePath(args.path);const b=await readFile(p);if(b.length>1024*1024)throw Error('File exceeds 1 MB text tool limit');return b.toString('utf8');}
  if(name==='workspace_write'){const p=await this.safePath(args.path,true);await mkdir(dirname(p),{recursive:true});await writeFile(p,args.content,'utf8');return 'Saved '+args.path;}
  if(name==='terminal_run')return new Promise((ok,no)=>{const shell=process.platform==='win32'?'powershell.exe':'/bin/sh';const child=spawn(shell,process.platform==='win32'?['-NoProfile','-NonInteractive','-Command',args.command]:['-c',args.command],{cwd:this.root,windowsHide:true,signal,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,LANG:process.env.LANG}});let output='';const timer=setTimeout(()=>child.kill(),60000);child.stdout.on('data',b=>output=(output+b).slice(-100000));child.stderr.on('data',b=>output=(output+b).slice(-100000));child.on('error',e=>{clearTimeout(timer);no(e);});child.on('exit',code=>{clearTimeout(timer);ok(`Exit ${code}\n${output}`);});});
  const context=await this.context(botId);const page=context.pages()[0]??await context.newPage();
  if(name==='browser_open'){const u=new URL(args.url);if(!['http:','https:'].includes(u.protocol))throw Error('Only HTTP(S) navigation allowed');await page.goto(u.href,{waitUntil:'domcontentloaded',timeout:30000});return page.url();}
  if(name==='browser_read')return await page.locator('body').innerText({timeout:15000}).then(t=>t.slice(0,50000))+'\n\nInteractive elements:\n'+JSON.stringify(await page.locator('a,button,input,textarea,select').evaluateAll(es=>es.slice(0,100).map(e=>({tag:e.tagName,text:e.textContent?.slice(0,100),id:e.id,placeholder:e.getAttribute('placeholder'),type:e.getAttribute('type')}))));
  if(name==='browser_click'){await page.locator(args.selector).first().click({timeout:10000});return 'Clicked; inspect current page before continuing';}
  if(name==='browser_type'){const el=page.locator(args.selector).first();if(await el.getAttribute('type')==='password')throw Error('Passwords require human takeover');await el.fill(args.text,{timeout:10000});return 'Filled input';}
  if(name==='browser_screenshot'){const p=join(this.root,`screenshot-${Date.now()}.png`);await page.screenshot({path:p});return await this.artifact(p,'image/png');}
  throw Error('Unknown tool');
 }
 async close(){await Promise.allSettled([...this.contexts.values()].map(c=>c.close()));}
}
