import {execFileSync} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {mkdir,readFile,stat,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const repository='teo12342/fox-bot',tag='v0.1.0-dev.1',version='0.1.0';
const mode=process.argv[2]??'prepare';if(!['prepare','publish'].includes(mode))throw Error('Use prepare or publish');
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['pipe','pipe','pipe'],env:{...process.env,GIT_TERMINAL_PROMPT:'0'}}).trim();
const sourceCommit=git(['rev-parse','HEAD']);
if(git(['remote','get-url','origin'])!==`https://github.com/${repository}.git`)throw Error('Unexpected publication repository');
const destination=path.join(root,'release/development');await mkdir(destination,{recursive:true});
const files=[
 {file:path.join(root,'release/desktop/fox-bot-0.1.0-win-x64.exe'),name:'fox-bot-0.1.0-win-x64.exe',platform:'windows',arch:'x64',format:'exe',warning:'Unsigned development installer. Production acceptance is incomplete.'},
 {file:path.join(root,'apps/android/release/FoxBot-0.1.0-android-debug.apk'),name:'fox-bot-0.1.0-android-universal-debug.apk',platform:'android',arch:'universal',format:'apk',warning:'Debug-signed development APK. Physical Android acceptance is unverified.'}
];
async function hash(stream){const digest=createHash('sha256');for await(const chunk of stream)digest.update(chunk);return digest.digest('hex');}
for(const file of files){file.size=(await stat(file.file)).size;if(file.size<1024*1024)throw Error('Unexpectedly small installer');file.sha256=await hash(createReadStream(file.file));}
const evidence=JSON.parse(await readFile(path.join(root,'docs/release-evidence.json'),'utf8'));
const manifest={schemaVersion:1,version,channel:'development',publishedAt:mode==='publish'?new Date().toISOString():null,sourceUrl:`https://github.com/${repository}`,repositoryUrl:`https://github.com/${repository}`,sourceCommit,artifacts:files.map(({file,name,...metadata})=>({...metadata,url:`https://github.com/${repository}/releases/download/${tag}/${name}`})),gates:evidence.gates};
const manifestFile=path.join(destination,'releases.json'),checksumsFile=path.join(destination,'SHA256SUMS');
await writeFile(manifestFile,JSON.stringify(manifest,null,2)+'\n');await writeFile(checksumsFile,files.map(file=>`${file.sha256}  ${file.name}`).join('\n')+'\n');
if(mode==='prepare'){console.log(JSON.stringify({prepared:true,sourceCommit,manifest:manifestFile,artifacts:files.map(({name,size,sha256})=>({name,size,sha256}))},null,2));process.exit(0);}
if(git(['status','--porcelain']))throw Error('Commit the reviewed source snapshot before publishing');
// Retrieve existing authentication into memory only. No token appears in output or files.
const raw=execFileSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',stdio:['pipe','pipe','pipe'],env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});
const credentials=Object.fromEntries(raw.split('\n').filter(line=>line.includes('=')).map(line=>[line.slice(0,line.indexOf('=')),line.slice(line.indexOf('=')+1)]));
if(!credentials.password)throw Error('GitHub credential unavailable');
const headers={Authorization:'Bearer '+credentials.password,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
async function api(route,method='GET',body){const response=await fetch(`https://api.github.com/repos/${repository}${route}`,{method,headers:{...headers,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(response.status===404&&method==='GET')return null;if(!response.ok)throw Error(`Release API failed (${response.status})`);return response.json();}
if(await api('/releases/tags/'+tag))throw Error('Development tag already published; refusing to overwrite immutable assets');
const release=await api('/releases','POST',{tag_name:tag,target_commitish:sourceCommit,name:'Fox Bot 0.1.0 development preview',draft:true,prerelease:true,body:'Development build with local desktop agents, provider connections, approved browser/native tools, connectors, attachments, speech controls and an Android companion.\n\nWindows x64 installer is unsigned. Android APK is debug-signed. Official ChatGPT sign-in requires provisioned OAuth registration and is unavailable. Reference fidelity, production signing, clean-install platform certification and physical Android/cross-network acceptance remain incomplete. Linux and ARM64 builds are not included in this preview.\n\nLocal verification: 91 core tests, 3 signaling tests, 2 website tests; packaged Windows browser/PDF smoke and native read-only tests. Fixture tests do not certify paid-provider behavior. See implementation status in the source repository.\n\nVerify SHA256SUMS before installing. Use the local development workspace and separately connect a model provider. The PC must remain running and awake.'});
const uploadBase=new URL(release.upload_url.split('{')[0]);if(uploadBase.protocol!=='https:'||uploadBase.hostname!=='uploads.github.com')throw Error('Unexpected asset upload endpoint');
for(const entry of [...files,{file:manifestFile,name:'releases.json'},{file:checksumsFile,name:'SHA256SUMS'}]){
 const size=(await stat(entry.file)).size,url=new URL(uploadBase);url.searchParams.set('name',entry.name);
 const response=await fetch(url,{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream','Content-Length':String(size)},body:createReadStream(entry.file),duplex:'half'});
 if(!response.ok)throw Error(`Asset upload failed (${response.status}); draft release retained for inspection`);
 const uploaded=await response.json();if(uploaded.name!==entry.name||uploaded.size!==size||uploaded.state!=='uploaded')throw Error('Uploaded artifact metadata mismatch');
 console.log(JSON.stringify({uploaded:entry.name,size}));
}
const published=await api('/releases/'+release.id,'PATCH',{draft:false});
for(const artifact of manifest.artifacts){const response=await fetch(artifact.url);if(!response.ok||!response.body)throw Error('Public artifact is not downloadable');if(await hash(response.body)!==artifact.sha256)throw Error('Published artifact checksum mismatch');}
console.log(JSON.stringify({published:true,verified:true,url:published.html_url,manifest:manifestFile}));
