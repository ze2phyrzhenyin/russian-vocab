import {cp,mkdir,readdir,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
// Next copies dotenv files separately from file tracing; runtime secrets are injected externally.
for(const name of await readdir('.next/standalone'))if(/^\.env(?:\.|$)/.test(name))await rm(`.next/standalone/${name}`,{force:true});
for(const name of ['data','.local','artifacts'])if(existsSync(`.next/standalone/${name}`))throw new Error(`Private path unexpectedly included in build: ${name}`);
await mkdir('.next/standalone/.next',{recursive:true});
await cp('.next/static','.next/standalone/.next/static',{recursive:true,force:true});
await cp('public','.next/standalone/public',{recursive:true,force:true});
console.log('Standalone runtime assets prepared.');
