import { _electron as electron } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
if(process.argv.includes('--help')){console.log('Usage: node scripts/smoke.mjs [--packaged]');process.exit(0);}
if(process.argv.slice(2).some(flag=>flag!=='--packaged'))throw Error('Unknown smoke option');
const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),workspace=path.resolve(desktop,'../..');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const packaged=process.argv.includes('--packaged');
const profile=path.join(workspace,'test-results','smoke-profile-'+Date.now());
const app=await electron.launch({...(packaged?{executablePath:path.join(workspace,'release/desktop/win-unpacked/Fox Bot.exe')} : {}),args:[...(packaged?[]:[desktop]),'--user-data-dir='+profile],env,timeout:30000});
app.process().stderr?.on('data',b=>process.stderr.write(b));
try{
 await app.firstWindow();let page;for(let i=0;i<100&&!page;i++){page=app.windows().find(w=>w.url().includes('index.html')&&!w.url().endsWith('#remote'));if(!page)await new Promise(r=>setTimeout(r,100));}if(!page)throw Error('Visible desktop page did not load: '+app.windows().map(w=>w.url()).join(', '));page.on('console',msg=>console.log('renderer:',msg.type(),msg.text()));page.on('pageerror',err=>console.error('renderer error:',err.message));console.log('Testing desktop page:',page.url());await page.waitForSelector('.welcome',{timeout:15000});
 assert.equal(await page.title(),'Fox Bot');
 await page.getByText('Open local development workspace').click();await page.waitForSelector('.brand');
 const state=await page.evaluate(()=>window.fox.command('snapshot',{}));assert.equal(state.ok,true);assert.equal(state.data.bots[0].name,'Fox');
 await page.getByTitle('New bot').click();await page.getByLabel('Name',{exact:true}).fill('Smoke Research');await page.getByLabel('Primary job').fill('Evidence collection');await page.getByRole('button',{name:'Create Bot',exact:true}).click();await page.getByRole('button',{name:'Smoke Research',exact:false}).first().waitFor();
 await page.getByRole('button',{name:'Smoke Research',exact:false}).first().click();await page.locator('.composer textarea').fill('Test local persistence');await page.getByRole('button',{name:'Send message'}).click();await page.getByText('Test local persistence',{exact:true}).waitFor();await page.getByText('Connect an AI provider and choose a model in this bot’s profile.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByLabel('Add memory',{exact:true}).fill('Smoke memory preference');await page.getByRole('button',{name:'Save memory',exact:true}).click();await page.getByText('Smoke memory preference',{exact:true}).waitFor();await page.getByRole('button',{name:'Disable',exact:true}).click();const memories=await page.evaluate(async()=>(await window.fox.command('snapshot',{})).data.memories);assert.ok(memories.some(m=>m.text==='Smoke memory preference'&&!m.enabled));await page.locator('.modal-heading .icon').click();
 mkdirSync(path.join(workspace,'test-results'),{recursive:true});await page.screenshot({path:path.join(workspace,'test-results/desktop-smoke.png')});
 const caps=await page.evaluate(()=>window.fox.command('native.capabilities',{}));assert.equal(caps.ok,true);console.log('Electron smoke PASS: real worker/SQLite, bot UI, message persistence, honest missing-provider error, native caps:',JSON.stringify(caps.data));
 if(packaged){
  let sawPdf=false;
  const fixture=http.createServer((req,res)=>{if(req.method==='GET'){res.setHeader('Content-Type','text/html');res.end('<h1>Fox packaged browser fixture</h1>');return;}let body='';req.on('data',b=>body+=b);req.on('end',()=>{const input=JSON.parse(body);sawPdf=sawPdf||JSON.stringify(input.messages).includes('Fox packaged PDF proof');res.setHeader('Content-Type','text/event-stream');const calls=[{id:'browser-open',name:'browser_open',arguments:JSON.stringify({url:`http://127.0.0.1:${fixture.address().port}/fixture`})},{id:'browser-read',name:'browser_read',arguments:'{}'},{id:'browser-capture',name:'browser_screenshot',arguments:'{}'}];const delta=input.messages.some(m=>m.role==='tool')?{content:'Packaged browser completed.'}:{tool_calls:calls.map((c,index)=>({index,id:c.id,function:{name:c.name,arguments:c.arguments}}))};res.end('data: '+JSON.stringify({choices:[{delta}]})+'\n\ndata: [DONE]\n\n');});});
  await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
  try{
   const result=await page.evaluate(async ({baseUrl,pdf})=>{const saved=await window.fox.desktop('provider.save',{kind:'compatible',name:'Browser fixture',baseUrl});if(!saved.ok)throw Error(saved.error.message);const s=(await window.fox.command('snapshot',{})).data;const b=s.bots.find(b=>b.name==='Smoke Research');await window.fox.command('bot.update',{id:b.id,revision:b.revision,providerId:saved.data.id,model:'fixture'});const attachment=await window.fox.command('attachment.upload',{name:'proof.pdf',mime:'application/pdf',base64:pdf});if(!attachment.ok)throw Error(attachment.error.message);return window.fox.command('message.send',{conversationId:s.conversations.find(c=>c.botIds.includes(b.id)).id,content:'Verify the packaged browser runtime and PDF',attachments:[attachment.data]});},{baseUrl:`http://127.0.0.1:${fixture.address().port}`,pdf:makePdfFixture().toString('base64')});
   assert.equal(result.ok,true);
   const end=Date.now()+60000;let finished=false;while(Date.now()<end&&!finished){finished=await page.evaluate(async id=>{const s=(await window.fox.command('snapshot',{})).data;return s.runs.some(r=>r.id===id&&['completed','failed','cancelled'].includes(r.status));},result.data.runId);if(!finished)await new Promise(r=>setTimeout(r,200));}assert.ok(finished,'Packaged browser run timed out');
   const s=await page.evaluate(async()=>(await window.fox.command('snapshot',{})).data);const run=s.runs.find(r=>r.id===result.data.runId);assert.equal(run.status,'completed',run.error);assert.ok(s.tools.some(t=>t.name==='browser_read'&&t.output.includes('Fox packaged browser fixture')));assert.ok(s.artifacts.some(a=>a.mime==='image/png'));assert.ok(sawPdf,'Packaged PDF text did not reach the model fixture');console.log('Packaged Chromium navigation, PDF extraction, content inspection, and artifact screenshot PASS');
  }finally{await new Promise(r=>{fixture.close(r);fixture.closeAllConnections();});}
 }
}catch(e){console.error('Smoke failed:',e);throw e;}finally{await app.evaluate(({app})=>{app.quit();}).catch(()=>{});await app.close();}

function makePdfFixture(text='Fox packaged PDF proof') {
 const escaped=text.replace(/[()\\]/g,'\\$&'),stream=`BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];let source='%PDF-1.4\n',offsets=[0];objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(source));source+=`${i+1} 0 obj\n${object}\nendobj\n`;});const xref=Buffer.byteLength(source);source+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(source);
}
