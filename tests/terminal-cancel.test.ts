import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Tools} from '../apps/desktop/runtime/tools';
import {spawn} from 'node:child_process';
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const quote=(value:string)=>process.platform==='win32'?`'${value.replaceAll("'","''")}'`:`'${value.replaceAll("'","'\\''")}'`;
const invoke=(path:string)=>(process.platform==='win32'?'& ':'')+quote(process.execPath)+' '+quote(path);
function fixture(){const root=mkdtempSync(join(tmpdir(),'fox-terminal-tree-')),ready=join(root,'ready'),marker=join(root,'descendant-marker'),script=join(root,'launcher.cjs');
 const descendant=`setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'should not survive cancellation'),1800)`;
 writeFileSync(script,`const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore',windowsHide:true});child.on('spawn',()=>fs.writeFileSync(${JSON.stringify(ready)},String(child.pid)));setTimeout(()=>{},30000);`);
 return{root,ready,marker,script,tools:new Tools(root,async()=>''),close:()=>rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})};
}
test('terminal cancellation kills its owned descendants and preserves a separate sibling process',async()=>{const f=fixture(),siblingMarker=join(f.root,'unrelated-sibling-marker');const sibling=spawn(process.execPath,['-e',`setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(siblingMarker)},'survived'),1000)`],{windowsHide:true,stdio:'ignore'});const siblingFinished=new Promise<void>((resolve,reject)=>{sibling.on('error',reject);sibling.on('close',code=>code===0?resolve():reject(Error('Sibling fixture failed')));});try{const controller=new AbortController();const promise=f.tools.execute('terminal_run',{command:invoke(f.script)},'bot',controller.signal);const rejected=assert.rejects(promise,error=>error instanceof Error&&error.name==='AbortError'&&error.message==='Terminal command cancelled');for(let i=0;i<150&&!existsSync(f.ready);i++)await delay(10);assert.equal(existsSync(f.ready),true);controller.abort();await rejected;await delay(2100);assert.equal(existsSync(f.marker),false);await siblingFinished;assert.equal(existsSync(siblingMarker),true);}finally{await siblingFinished;await f.tools.close();f.close();}});
test('normal terminal output and exit code remain available',async()=>{const root=mkdtempSync(join(tmpdir(),'fox-terminal-output-')),tools=new Tools(root,async()=>''),script=join(root,'output.cjs');try{writeFileSync(script,"console.log('normal fixture output');console.error('fixture stderr');process.exitCode=7;");const output=await tools.execute('terminal_run',{command:invoke(script)},'bot',new AbortController().signal);assert.match(output,/Exit 7/);assert.match(output,/normal fixture output/);assert.match(output,/fixture stderr/);}finally{await tools.close();rmSync(root,{recursive:true,force:true});}});
test('terminal timeout rejects distinctly and kills the owned descendant tree',async()=>{const f=fixture();try{f.tools.terminalTimeoutMs=1500;await assert.rejects(f.tools.execute('terminal_run',{command:invoke(f.script)},'bot',new AbortController().signal),/Terminal command timed out after 1500 ms/);assert.equal(existsSync(f.ready),true);await delay(2100);assert.equal(existsSync(f.marker),false);}finally{await f.tools.close();f.close();}});
