import {execFileSync} from 'node:child_process';
const repository='teo12342/fox-bot';
const raw=execFileSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',stdio:['pipe','pipe','pipe'],env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});
const credential=Object.fromEntries(raw.split('\n').filter(line=>line.includes('=')).map(line=>[line.slice(0,line.indexOf('=')),line.slice(line.indexOf('=')+1)]));
if(!credential.password)throw Error('GitHub credential unavailable');
async function api(path,method='GET',body){const response=await fetch('https://api.github.com/repos/'+repository+path,{method,headers:{Authorization:'Bearer '+credential.password,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(!response.ok)throw Error(`GitHub request failed (${response.status})`);return response.status===204?null:response.json();}
if(process.argv[2]==='dispatch'){
 const workflow=process.argv[3];if(!['verify.yml','desktop-release.yml'].includes(workflow))throw Error('Unsupported verification/build workflow');
 await api('/actions/workflows/'+workflow+'/dispatches','POST',{ref:'main'});console.log(JSON.stringify({repository,workflow,dispatched:true}));
}else{
 const response=await api('/actions/runs?per_page=8');console.log(JSON.stringify({repository,runs:response.workflow_runs.map(run=>({id:run.id,name:run.name,status:run.status,conclusion:run.conclusion,url:run.html_url,commit:run.head_sha}))},null,2));
}
