// Temporary authenticated acceptance probe, remote-dev only; no production URL or D1 binding.
interface ProbeEnv{ARCHIVE:Fetcher;PROBE_KEY:string}
export default {async fetch(request:Request,env:ProbeEnv){
 if(request.headers.get('Authorization')!=='Bearer '+env.PROBE_KEY)return Response.json({ok:false},{status:401});
 try{
  const response=await env.ARCHIVE.fetch('https://archive.private/api/independent/report');
  const report=await response.json<any>();
  if(!response.ok)return Response.json({ok:false,code:report.code||'SOURCE_UNAVAILABLE'}, {status:503});
  const product=report.products?.[0];
  const age=Date.now()-Date.parse(report.captured_at);
  if(!report.available||!product||report.d1_requests!==0||report.stale!==false||!Number.isFinite(age)||age<0||age>=86400000||!report.source_hash||!/^[a-f0-9]{64}$/.test(report.source_hash))return Response.json({ok:false,code:'VERIFIED_MONTHLY_PROOF_MISSING'},{status:503});
  const question=await env.ARCHIVE.fetch('https://archive.private/api/independent/questions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:product.title+' neden düştü?',month:report.month})});
  const answer=await question.json<any>();
  if(!question.ok||answer.stale!==false||answer.source_hash!==report.source_hash||answer.d1_requests!==0||!Array.isArray(answer.evidence)||answer.evidence.length===0||typeof answer.answer!=='string'||!answer.answer.trim())return Response.json({ok:false,code:'INDEPENDENT_QUESTION_PROOF_MISSING'},{status:503});
  const readback=await env.ARCHIVE.fetch('https://archive.private/api/independent/report?month='+report.month),saved=await readback.json<any>();
  if(!readback.ok||saved.source_hash!==report.source_hash||saved.captured_at!==report.captured_at||saved.products?.length!==report.products.length||saved.d1_requests!==0||saved.stale!==false)return Response.json({ok:false,code:'INDEPENDENT_READBACK_PROOF_MISSING'},{status:503});
  return Response.json({ok:true,source_hash:report.source_hash,month:report.month,products:report.products.length,query_count:report.query_count,d1_requests:report.d1_requests,question_d1_requests:answer.d1_requests,stale:!!report.stale,question_decision:answer.decision});
 }catch{return Response.json({ok:false,code:'INDEPENDENT_PROBE_UNAVAILABLE'},{status:503});}
}};
