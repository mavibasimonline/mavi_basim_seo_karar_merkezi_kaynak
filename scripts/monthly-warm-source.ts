// Temporary private, account-owned source used only before the controlled release.
import {monthlySource} from '../.local/monthly-source/src/monthly-source';
import type {Env} from '../src/types';
function meter(db:D1Database,trace:{reads:number;writes:number;known:boolean}){
 const raw=new WeakMap<object,{statement:D1PreparedStatement;sql:string}>();
 const seen=(r:any)=>{if(!Number.isSafeInteger(r.meta?.rows_read)||!Number.isSafeInteger(r.meta?.rows_written)){trace.known=false;return;}trace.reads+=r.meta.rows_read;trace.writes+=r.meta.rows_written;};
 function wrap(sql:string,s:D1PreparedStatement):any{const p={bind(...v:unknown[]){return wrap(sql,s.bind(...v));},async all(){const r=await s.all();seen(r);return r;},async run(){const r=await s.run();seen(r);return r;},async first(column?:string){const r=await s.all();seen(r);return column?r.results[0]?.[column]??null:r.results[0]??null;}};raw.set(p,{statement:s,sql});return p;}
 return {prepare(sql:string){return wrap(sql,db.prepare(sql));},async batch(statements:D1PreparedStatement[]){const items=statements.map(s=>raw.get(s));if(items.some(s=>!s))throw Error('SOURCE_UNWRAPPED_STATEMENT');const result=await db.batch(items.map(s=>s!.statement));result.forEach(seen);return result;}} as unknown as D1Database;
}
export default {async fetch(request:Request,env:Env){
 const trace={reads:0,writes:0,known:true},response=await monthlySource(request,{...env,DB:meter(env.DB,trace)}),body=await response.json<any>();
 if(response.ok&&body.cost){if(!trace.known||trace.writes>8)return Response.json({held:true,code:'SNAPSHOT_SOURCE_OVERHEAD_UNVERIFIED'},{status:503});body.cost.physical_rows_read=trace.reads;body.cost.physical_rows_written=trace.writes;}
 return Response.json(body,{status:response.status});
}};
