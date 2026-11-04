import type {GscStorage} from './independent-gsc';
type Result={status:string;day?:string;scope?:string;rows?:number;cursor?:number;code?:string;d1_requests:number};
type Receipt={source:'Cloudflare Cron';scheduled_at:string;finished_at:string;status:string;day?:string;scope?:string;rows?:number;cursor?:number;code?:string;d1_requests:0};
type Summary={day:string;attempts:number;completed:number;partial:number;held:number;idle:number;last_scheduled_at:string};
export function cronTime(body:unknown,time=new Date()):string|null{
 if(!body||typeof body!=='object')return null;
 const input=body as {source?:unknown;scheduled_at?:unknown};
 if(input.source!=='cloudflare-cron')return null;
 if(typeof input.scheduled_at!=='string')throw Error('GSC_CRON_TIME_INVALID');
 const at=new Date(input.scheduled_at);
 if(!Number.isFinite(at.getTime())||at.toISOString()!==input.scheduled_at||at.getUTCMinutes()%15!==0||at.getUTCSeconds()!==0||at.getUTCMilliseconds()!==0||at.getTime()>time.getTime()+300000||at.getTime()<time.getTime()-86400000)throw Error('GSC_CRON_TIME_INVALID');
 return at.toISOString();
}
type CronStorage=GscStorage&Partial<Pick<DurableObjectStorage,'transaction'>>;
export async function recordGscCron(storage:CronStorage,scheduled:string,result:Result,time=new Date()){
 if(storage.transaction)return storage.transaction(tx=>writeReceipt(tx,scheduled,result,time));
 return writeReceipt(storage,scheduled,result,time);
}
async function writeReceipt(storage:GscStorage,scheduled:string,result:Result,time:Date){
 if(result.d1_requests!==0||!['complete','partial','held','idle'].includes(result.status))throw Error('GSC_CRON_RESULT_INVALID');
 const receipt:Receipt={source:'Cloudflare Cron',scheduled_at:scheduled,finished_at:time.toISOString(),status:result.status,d1_requests:0};
 if(result.day&&/^20\d\d-\d\d-\d\d$/.test(result.day))receipt.day=result.day;
 if(result.scope==='page'||result.scope==='query')receipt.scope=result.scope;
 if(Number.isSafeInteger(result.rows)&&result.rows!>=0)receipt.rows=result.rows;
 if(Number.isSafeInteger(result.cursor)&&result.cursor!>=0)receipt.cursor=result.cursor;
 if(result.code&&/^GSC_[A-Z0-9_]{1,100}$/.test(result.code))receipt.code=result.code;
 const key='gsc:cron:'+scheduled,old=await storage.get<Receipt>(key);
 // Immutable execution receipt: repeated scheduler delivery cannot overwrite it.
 if(old)return;
 await storage.put(key,receipt);
 const previousLast=await storage.get<Receipt>('gsc:cron:last');
 if(!previousLast||previousLast.scheduled_at<scheduled)await storage.put('gsc:cron:last',receipt);
 const day=scheduled.slice(0,10),summaryKey='gsc:cron-summary:'+day;
 const prior=await storage.get<Summary>(summaryKey);
 const summary:Summary=prior||{day,attempts:0,completed:0,partial:0,held:0,idle:0,last_scheduled_at:scheduled};
 summary.attempts++;if(summary.last_scheduled_at<scheduled)summary.last_scheduled_at=scheduled;
 if(result.status==='complete')summary.completed++;else if(result.status==='partial')summary.partial++;else if(result.status==='held')summary.held++;else summary.idle++;
 await storage.put(summaryKey,summary);
}
export async function gscCronProof(storage:GscStorage,time=new Date()){
 const today=time.toISOString().slice(0,10),yesterday=new Date(time.getTime()-86400000).toISOString().slice(0,10);
 return {last:await storage.get<Receipt>('gsc:cron:last')||null,
  days:(await Promise.all([today,yesterday].map(d=>storage.get<Summary>('gsc:cron-summary:'+d)))).filter(Boolean),
  scope:'Only receipts recorded after this runtime upgrade; absent earlier receipts are not failed jobs.'};
}
