import {contextBridge,ipcRenderer} from 'electron';
contextBridge.exposeInMainWorld('fox',{
 command:(type:string,payload:Record<string,unknown>)=>ipcRenderer.invoke('fox:command',{type,payload}),
 desktop:(type:string,payload:Record<string,unknown>={})=>ipcRenderer.invoke('fox:desktop',{type,payload}),
 onEvent:(callback:(event:any)=>void)=>{const fn=(_:unknown,e:unknown)=>callback(e);ipcRenderer.on('fox:event',fn);return()=>ipcRenderer.removeListener('fox:event',fn);},
 onRemote:(callback:(event:any)=>void)=>{const fn=(_:unknown,e:unknown)=>callback(e);ipcRenderer.on('fox:remote',fn);return()=>ipcRenderer.removeListener('fox:remote',fn);},
 remote:(type:string,payload:Record<string,unknown>)=>ipcRenderer.invoke('fox:remote',{type,payload})
});
