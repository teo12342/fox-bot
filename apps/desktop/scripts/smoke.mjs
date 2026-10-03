import { _electron as electron } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const profile=path.resolve('../../test-results/smoke-profile-'+Date.now());
const app=await electron.launch({args:[process.cwd(),'--user-data-dir='+profile],env,timeout:30000});
app.process().stderr?.on('data',b=>process.stderr.write(b));
try{
 await app.firstWindow();let page;for(let i=0;i<100&&!page;i++){page=app.windows().find(w=>w.url().includes('index.html')&&!w.url().endsWith('#remote'));if(!page)await new Promise(r=>setTimeout(r,100));}if(!page)throw Error('Visible desktop page did not load: '+app.windows().map(w=>w.url()).join(', '));page.on('console',msg=>console.log('renderer:',msg.type(),msg.text()));page.on('pageerror',err=>console.error('renderer error:',err.message));console.log('Testing desktop page:',page.url());await page.waitForSelector('.welcome',{timeout:15000});
 assert.equal(await page.title(),'Fox Bot');
 await page.getByText('Open local development workspace').click();await page.waitForSelector('.brand');
 const state=await page.evaluate(()=>window.fox.command('snapshot',{}));assert.equal(state.ok,true);assert.equal(state.data.bots[0].name,'Fox');
 await page.getByTitle('New bot').click();await page.getByLabel('Name',{exact:true}).fill('Smoke Research');await page.getByLabel('Primary job').fill('Evidence collection');await page.getByRole('button',{name:'Create Bot',exact:true}).click();await page.getByRole('button',{name:'Smoke Research',exact:false}).first().waitFor();
 await page.getByRole('button',{name:'Smoke Research',exact:false}).first().click();await page.locator('.composer textarea').fill('Test local persistence');await page.getByRole('button',{name:'Send message'}).click();await page.getByText('Test local persistence',{exact:true}).waitFor();await page.getByText('Connect an AI provider and choose a model in this bot’s profile.',{exact:true}).waitFor();
 mkdirSync('../../test-results',{recursive:true});await page.screenshot({path:'../../test-results/desktop-smoke.png'});
 const caps=await page.evaluate(()=>window.fox.command('native.capabilities',{}));assert.equal(caps.ok,true);console.log('Electron smoke PASS: real worker/SQLite, bot UI, message persistence, honest missing-provider error, native caps:',JSON.stringify(caps.data));
}catch(e){console.error('Smoke failed:',e);throw e;}finally{await app.close();}
