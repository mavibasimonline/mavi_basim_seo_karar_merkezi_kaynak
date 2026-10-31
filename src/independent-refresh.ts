// Independent, bounded Sheets refresh: service binding only, no DB/D1 and no public route.
// Four opportunities per UTC day; the DO reads upstream only when its source is old.
export interface IndependentRefreshEnv {DRIVE_ARCHIVE_SERVICE?:Fetcher}
export function independentRefreshDue(time:Date):boolean {
 return Number.isFinite(time.getTime())&&time.getUTCMinutes()===0&&time.getUTCHours()%6===0;
}
export async function refreshIndependentSheets(env:IndependentRefreshEnv,time=new Date()):Promise<{ok:true;source_hash:string;captured_at:string;d1_requests:0}> {
 if(typeof env.DRIVE_ARCHIVE_SERVICE?.fetch!=='function')throw Error('INDEPENDENT_REFRESH_BINDING_MISSING');
 const response=await env.DRIVE_ARCHIVE_SERVICE.fetch('https://archive.private/api/internal/independent-refresh',{method:'POST'});
 if(!response.ok)throw Error('INDEPENDENT_REFRESH_SERVICE_UNAVAILABLE');
 const proof=await response.json<unknown>() as Record<string,unknown>;
 const age=time.getTime()-Date.parse(String(proof.captured_at));
 if(proof.ok!==true||proof.stale!==false||proof.d1_requests!==0
   ||typeof proof.source_hash!=='string'||!/^[a-f0-9]{64}$/.test(proof.source_hash)
   ||!Number.isSafeInteger(proof.records)||Number(proof.records)<1
   ||!Number.isFinite(age)||age< -300000||age>24*3600000)
   throw Error('INDEPENDENT_REFRESH_PROOF_REJECTED');
 return {ok:true,source_hash:proof.source_hash,captured_at:String(proof.captured_at),d1_requests:0};
}
