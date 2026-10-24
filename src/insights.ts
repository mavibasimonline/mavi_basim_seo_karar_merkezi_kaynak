import {Env,nowISO} from './types';
// A concurrent retry returns the persisted ID, never an ID whose insert was ignored.
export async function saveInsight<T extends {id:string}>(env:Env,kind:string,key:string,result:T,analysisId:string|null=null):Promise<T>{
 const inserted=await env.DB.prepare('INSERT INTO insight_runs VALUES(?,?,?,?,?,?) ON CONFLICT(kind,source_key) DO NOTHING RETURNING result_json')
   .bind(result.id,kind,analysisId,key,nowISO(),JSON.stringify(result)).first<{result_json:string}>();
 const saved=inserted||await env.DB.prepare('SELECT result_json FROM insight_runs WHERE kind=? AND source_key=?').bind(kind,key).first<{result_json:string}>();
 if(!saved)throw new Error('INSIGHT_NOT_PERSISTED');return JSON.parse(saved.result_json) as T;
}
