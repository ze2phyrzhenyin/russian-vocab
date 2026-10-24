import 'dotenv/config';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
if(!existsSync('.next/standalone/public/manifest.webmanifest'))throw new Error('Run pnpm build before pnpm start.');
const child=spawn(process.execPath,['.next/standalone/server.js'],{stdio:'inherit',env:{...process.env,HOSTNAME:'127.0.0.1',PORT:process.env.SLOVO_PORT??'4186',SLOVO_ASSET_ROOT:process.env.SLOVO_ASSET_ROOT??path.resolve('data/assets')}});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>{process.exitCode=code??0});
