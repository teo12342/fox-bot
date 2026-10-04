import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const b=spawn(process.execPath,['scripts/build.mjs'],{stdio:'inherit'});
b.on('exit',code=>{if(code)process.exit(code);const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const e=spawn(process.execPath,[require.resolve('electron/cli.js'),'.'],{stdio:'inherit',env});e.on('exit',c=>process.exit(c??0));});
