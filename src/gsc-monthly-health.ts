// Monthly GSC completeness audit. Derived from existing immutable daily manifests:
// Private archive Worker needs its own controlled release after main source acceptance.
// no Google calls, no D1, no writes and no fabricated zero-traffic days.
import {collectedGscProof,type DailyProof} from './independent-gsc';

export type MonthHealth={
 month:string;month_closed:boolean;eligible_days:number;verified_page_days:number;
 missing_page_days:string[];overdue_page_days:string[];state:'tam'|'kismi'|'eksik'|'bekliyor';
 last_verified_day:string|null;
};
const monthBefore=(m:string)=>{const d=new Date(m+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()-1);return d.toISOString().slice(0,7);};
const utcDay=(time:Date)=>time.toISOString().slice(0,10);

export async function monthlyGscHealth(
 storage:{get<T=unknown>(key:string):Promise<T|undefined>},time=new Date(),count=3
):Promise<{checked_at:string;latest_eligible_day:string;months:MonthHealth[];overdue_count:number;note:string}>{
 const cutoff=new Date(Date.UTC(time.getUTCFullYear(),time.getUTCMonth(),time.getUTCDate()-3));
 const latest=utcDay(cutoff),overdue=utcDay(new Date(cutoff.getTime()-86400000));
 let month=time.toISOString().slice(0,7);
 const months:MonthHealth[]=[];
 for(let m=0;m<count;m++){
  const days=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).getUTCDate();
  const eligible=Array.from({length:days},(_,i)=>month+'-'+String(i+1).padStart(2,'0')).filter(day=>day<=latest);
  const proofs=await Promise.all(eligible.map(day=>storage.get<DailyProof>('gsc:daily:'+day+':page')));
  const missing:string[]=[],pending:string[]=[];let verified=0,last:string|null=null;
  for(let i=0;i<eligible.length;i++){
   const day=eligible[i],proof=proofs[i];
   if(collectedGscProof(proof,day,'page',time)){verified++;last=day;}
   else{missing.push(day);if(day<=overdue)pending.push(day);}
  }
  const monthClosed=month+'-'+String(days).padStart(2,'0')<=latest;
  const state:MonthHealth['state']=monthClosed&&eligible.length===verified?'tam':pending.length?'eksik':verified?'kismi':'bekliyor';
  months.push({month,month_closed:monthClosed,eligible_days:eligible.length,verified_page_days:verified,
   missing_page_days:missing,overdue_page_days:pending,state,last_verified_day:last});
  month=monthBefore(month);
 }
 return {checked_at:time.toISOString(),latest_eligible_day:latest,months,overdue_count:months.reduce((n,x)=>n+x.overdue_page_days.length,0),
 note:'Yalnız kesinleşebilir GSC günleri denetlenir (en az 3 günlük gecikme). Eksik günler sıfır trafik değildir. Arşiv zamanlanmış görevle toplanır; biriken eksikler ayrıca kontrol edilir.'};
}
