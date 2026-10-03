import {spawn} from 'node:child_process';
const b=spawn(process.execPath,['scripts/build.mjs'],{stdio:'inherit'});
b.on('exit',code=>{if(code)process.exit(code);const e=spawn(process.platform==='win32'?'node_modules/.bin/electron.cmd':'node_modules/.bin/electron',['.'],{stdio:'inherit',shell:process.platform==='win32'});e.on('exit',c=>process.exit(c??0));});
