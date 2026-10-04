import {build,Platform,Arch} from 'electron-builder';
await build({targets:Platform.WINDOWS.createTarget([process.argv.includes('--dir')?'dir':'nsis'],Arch.x64),config:{win:{signAndEditExecutable:false}}});
