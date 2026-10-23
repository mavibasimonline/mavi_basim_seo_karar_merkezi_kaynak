import { mkdirSync, openSync, closeSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const local=resolve('.local');
mkdirSync(local,{recursive:true});
const cli=process.argv.slice(2);
const capture=cli[0]==='--capture'?cli.splice(0,2)[1]:null;
const [command,...args]=cli;
if(!command)throw new Error('Komut belirtilmedi');
const output=capture?openSync(resolve(capture),'w',0o600):null;
const executable=existsSync(resolve('node_modules/.bin',command))?resolve('node_modules/.bin',command):command;
const child=spawn(executable,args,{stdio:output===null?'inherit':['ignore',output,output],env:{...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:resolve(local,'wrangler.log'),XDG_CONFIG_HOME:resolve(local,'config')}});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('error',()=>{console.error(`Komut başlatılamadı: ${command}`);process.exitCode=1;});
child.on('exit',(code,signal)=>{if(output!==null){closeSync(output);console.log(`Komut çıkışı: ${code??signal}; ayrıntılar: ${capture}`);}process.exitCode=code??(signal?1:0);});
