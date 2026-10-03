import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash, sign } from 'node:crypto';
import path from 'node:path';
const dir=process.argv[2]||'release', version=process.env.FOX_VERSION;
const repository=process.env.GITHUB_REPOSITORY,tag=process.env.FOX_TAG;
if(!version||!repository||!tag)throw new Error('FOX_VERSION, FOX_TAG and GITHUB_REPOSITORY are required');
const entries=[];
async function walk(d){for(const name of await readdir(d)){const full=path.join(d,name);if((await stat(full)).isDirectory())await walk(full);else entries.push(full)}}
await walk(dir);
const artifacts=[];const checksums=[];
for(const file of entries.sort()){
 const name=path.basename(file),m=name.match(/^fox-bot-(.+?)-(win|windows|linux|android)-(x64|arm64|universal)\.(exe|AppImage|deb|rpm|flatpak|tar\.gz|apk)$/);
 if(!m)continue;
 if(m[1]!==version)throw new Error(`Wrong artifact version: ${name}`);
 const bytes=await readFile(file),sha256=createHash('sha256').update(bytes).digest('hex');
 artifacts.push({platform:m[2]==='win'?'windows':m[2],arch:m[3],format:m[4],url:`https://github.com/${repository}/releases/download/${tag}/${name}`,sha256,size:bytes.length});checksums.push(`${sha256}  ${name}`);
}
if(!artifacts.length)throw new Error('No release artifacts found');
const evidence=JSON.parse(await readFile('docs/release-evidence.json','utf8'));
const stable=process.env.FOX_STABLE==='true';
if(stable && evidence.gates.some(g=>!g.passed||!g.evidence))throw new Error('Production release blocked: missing acceptance evidence');
if(stable){for(const arch of ['x64','arm64']){if(!artifacts.some(a=>a.platform==='windows'&&a.arch===arch&&a.format==='exe'))throw new Error(`Missing Windows ${arch}`);for(const format of ['AppImage','deb','rpm','flatpak','tar.gz'])if(!artifacts.some(a=>a.platform==='linux'&&a.arch===arch&&a.format===format))throw new Error(`Missing Linux ${arch} ${format}`)}if(!artifacts.some(a=>a.platform==='android'&&a.arch==='universal'&&a.format==='apk'))throw new Error('Missing Android APK')}
const manifest={schemaVersion:1,version,channel:stable?'stable':'preview',publishedAt:new Date().toISOString(),sourceUrl:`https://github.com/${repository}`,artifacts,gates:evidence.gates};
const serialized=JSON.stringify(manifest,null,2)+'\n';
await writeFile(path.join(dir,'releases.json'),serialized);await writeFile(path.join(dir,'SHA256SUMS'),checksums.join('\n')+'\n');
if(process.env.FOX_RELEASE_PRIVATE_KEY){const signature=sign(null,Buffer.from(serialized),process.env.FOX_RELEASE_PRIVATE_KEY).toString('base64');await writeFile(path.join(dir,'releases.json.sig'),signature+'\n')}else if(stable)throw new Error('Stable release requires an Ed25519 metadata signing key');
console.log(`Manifest generated for ${artifacts.length} artifacts (${manifest.channel})`);
