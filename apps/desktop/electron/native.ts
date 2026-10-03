import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
export class NativeHelper {
 private child?:ChildProcessWithoutNullStreams;private pending=new Map<string,{resolve:(v:any)=>void,reject:(e:Error)=>void,timer:ReturnType<typeof setTimeout>}>();
 constructor(readonly root:string){}
 async call(method:string,args:any){const file=join(this.root,process.platform==='win32'?'foxbot-native.exe':'foxbot-native');if(!existsSync(file)){if(method==='capabilities')return{available:false,reason:'Native helper has not been built'};throw Error('Native helper unavailable');}
  if(!this.child){this.child=spawn(file,[],{windowsHide:true});let buffer='';this.child.stdout.on('data',chunk=>{buffer+=chunk;let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);try{const r=JSON.parse(line);const p=this.pending.get(r.id);if(p){clearTimeout(p.timer);this.pending.delete(r.id);r.ok?p.resolve(r.data):p.reject(Error(r.error??'Native operation failed'));}}catch{}}});this.child.on('exit',()=>{this.child=undefined;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Native helper stopped'));}this.pending.clear();});this.child.on('error',()=>this.close());}
  const id=randomUUID();return new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Native operation timed out'));},30000);this.pending.set(id,{resolve,reject,timer});this.child!.stdin.write(JSON.stringify({id,method,args})+'\n');});
 }
 close(){this.child?.kill();this.child=undefined;}
}
