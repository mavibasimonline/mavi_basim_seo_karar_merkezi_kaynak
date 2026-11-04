import type {GscStorage} from './independent-gsc';
const RETESTABLE=new Set(['GSC_HTTP_400','GSC_AGGREGATION_INVALID','GSC_ROW_REJECTED','GSC_DUPLICATE_ROW','GSC_SYNC_UNAVAILABLE']);
/** One bounded retry after a tested collector upgrade. Keep the original hold
 * and an immutable recovery receipt; never override rate limits or OAuth holds. */
type RecoveryStorage=GscStorage&Partial<Pick<DurableObjectStorage,'transaction'>>;
export async function retryGscHold(storage:RecoveryStorage,input:unknown,time=new Date()){
 if(storage.transaction)return storage.transaction(tx=>releaseHold(tx,input,time));
 return releaseHold(storage,input,time);
}
async function releaseHold(storage:GscStorage,input:unknown,time:Date){
 const value=input as {day?:unknown;scope?:unknown;code?:unknown;until?:unknown};
 if(!value||typeof value.day!=='string'||!/^20\d\d-\d\d-\d\d$/.test(value.day)||(value.scope!=='page'&&value.scope!=='query')||typeof value.code!=='string'||!RETESTABLE.has(value.code)||typeof value.until!=='string')throw Error('GSC_RECOVERY_INPUT_INVALID');
 const lag=Math.floor((Date.parse(time.toISOString().slice(0,10))-Date.parse(value.day))/86400000);
 if(!Number.isInteger(lag)||lag<3||lag>10)throw Error('GSC_RECOVERY_DAY_INVALID');
 const key='gsc:held:'+value.day+':'+value.scope;
 const held=await storage.get<{until:number;code:string}>(key);
 if(!held||held.code!==value.code||!Number.isFinite(held.until)||new Date(held.until).toISOString()!==value.until)throw Error('GSC_RECOVERY_HOLD_CHANGED');
 const diagnostic=await storage.get<{ok?:boolean;at?:string;revision?:string;rows?:number;cursor?:number;d1_requests?:number}>('gsc:diagnostic:last');
 if(!diagnostic||diagnostic.ok!==true||diagnostic.revision!=='daily-proof-v2'||diagnostic.d1_requests!==0||typeof diagnostic.at!=='string'||!Number.isFinite(Date.parse(diagnostic.at))||time.getTime()-Date.parse(diagnostic.at)<0||time.getTime()-Date.parse(diagnostic.at)>30*60000||!((diagnostic.rows||diagnostic.cursor||0)>0))throw Error('GSC_RECOVERY_DIAGNOSTIC_REQUIRED');
 const receiptKey='gsc:recovery:daily-proof-v2:'+value.day+':'+value.scope;
 if(await storage.get(receiptKey))return {released:false,reason:'already_retried',d1_requests:0};
 const receipt={day:value.day,scope:value.scope,code:held.code,previous_until:value.until,released_at:time.toISOString(),reason:'tested_collector_upgrade',d1_requests:0};
 const retry=await storage.get<{until:number}>('gsc:retry');
 // Old nonretryable native-fetch failures created a 24h scope hold plus a
 // 15min global cooldown from the exact same timestamp. Only that matched
 // control pair is obsolete; a 429/server 1h cooldown cannot match it.
 const obsoleteRetry=retry&&retry.until===held.until-24*3600000+15*60000;
 if(obsoleteRetry)await storage.put('gsc:retry',{...retry,until:time.getTime(),previous_until:retry.until,released_at:time.toISOString()});
 await storage.put(receiptKey,receipt);
 await storage.put(key,{...held,until:time.getTime(),previous_until:held.until,released_at:time.toISOString()});
 return {released:true,...receipt};
}
