import {safeStorage} from 'electron';
import {readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {join} from 'node:path';
export class Vault {
 private file:string;
 constructor(dir:string){this.file=join(dir,'credentials.enc.json');}
 available(){return safeStorage.isEncryptionAvailable() && (process.platform!=='linux'||safeStorage.getSelectedStorageBackend()!=='basic_text');}
 private values():Record<string,string>{return existsSync(this.file)?JSON.parse(readFileSync(this.file,'utf8')):{};}
 get(id:string){const value=this.values()[id];if(!value)return'';if(!this.available())throw Error('OS secure credential storage is unavailable');return safeStorage.decryptString(Buffer.from(value,'base64'));}
 set(id:string,value:string){if(!this.available())throw Error('Configure an OS key store before saving credentials');const data=this.values();if(value)data[id]=safeStorage.encryptString(value).toString('base64');else delete data[id];writeFileSync(this.file+'.tmp',JSON.stringify(data),{mode:0o600});renameSync(this.file+'.tmp',this.file);}
}
