import {build} from 'esbuild';
import {build as viteBuild} from 'vite';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await build({absWorkingDir:root,entryPoints:{main:'electron/main.ts',preload:'electron/preload.ts',worker:'runtime/worker.ts'},bundle:true,platform:'node',format:'cjs',target:'node22',outdir:path.join(root,'dist'),outExtension:{'.js':'.cjs'},external:['electron','better-sqlite3','playwright'],sourcemap:true});
await viteBuild({root,base:'./',build:{outDir:'dist/renderer',emptyOutDir:false},configFile:false});
