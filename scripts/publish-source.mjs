import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const git=(args)=>execFileSync('git',args,{encoding:'utf8',stdio:['pipe','pipe','pipe'],env:{...process.env,GIT_TERMINAL_PROMPT:'0'}}).trim();
// Git's configured credential helper supplies credentials in memory. Never print or persist them.
let credentials;try{credentials=execFileSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',stdio:['pipe','pipe','pipe'],env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});}catch{throw Error('GitHub credential helper authentication unavailable');}
const record=Object.fromEntries(credentials.split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
if(!record.password)throw Error('GitHub credential helper returned no access token');
const api=async(path,method='GET',body)=>{const response=await fetch('https://api.github.com'+path,{method,headers:{Authorization:'Bearer '+record.password,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await response.json();return{status:response.status,data};};
const me=await api('/user');if(me.status!==200)throw Error('GitHub authentication failed');const owner=me.data.login;
if(!process.argv.includes('--create')){console.log(JSON.stringify({authenticated:true,owner}));process.exit(0);}
let name;for(const candidate of ['fox-bot','fox-bot-local','fox-bot-desktop']){const exists=await api('/repos/'+owner+'/'+candidate);if(exists.status===404){name=candidate;break;}}if(!name)throw Error('Candidate repository names exist; refusing to modify an existing repository');
const files=git(['ls-files','--cached']).split('\n').filter(Boolean);if(!files.length)throw Error('No reviewed source snapshot staged');
for(const file of files){if(/\.(jks|keystore|pfx)$|(^|\/)\.env($|\.)|local\.properties$/.test(file)&&!file.endsWith('.env.example'))throw Error('Private configuration is staged: '+file);const content=readFileSync(file);if(content.length>5*1024*1024)throw Error('Unexpected large staged file: '+file);if(/-----BEGIN (?:EC |RSA )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]{60,}/.test(content.toString('utf8')))throw Error('Private key material staged: '+file);}
const created=await api('/user/repos','POST',{name,description:'Open-source local AI teammates for Windows/Linux with an Android companion. Implementation in progress.',private:false,homepage:'https://fox-bot-pi.vercel.app/',auto_init:false});if(created.status!==201)throw Error('GitHub repository creation failed ('+created.status+')');
git(['remote','add','origin',created.data.clone_url]);git(['push','-u','origin','main']);console.log(JSON.stringify({repository:created.data.html_url,pushed:true}));
