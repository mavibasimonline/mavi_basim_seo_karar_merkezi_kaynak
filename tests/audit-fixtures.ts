// Synthetic fixtures are confined to tests; never imported by application code.
import {env,connected} from './helpers';
import {dates,monthPeriod} from '../src/analysis';
import {insertRows} from '../src/sync';
export const AUDIT_TIME=new Date('2026-10-23T12:00:00Z');
export async function auditSeed(time=AUDIT_TIME){
  await connected();
  const stamp=time.toISOString();
  await env.DB.prepare('UPDATE products SET url_verified_at=?').bind(stamp).run();
  await env.DB.prepare("INSERT INTO health_checks VALUES('gsc',?,?,'ok',NULL)").bind(stamp.slice(0,10),stamp).run();
  for(const month of ['2026-08','2026-09']){
    const days=dates(monthPeriod(month));
    await env.DB.batch(insertRows(env.DB,'dataset_coverage',days.flatMap(day=>['page','query'].map(scope=>({provider:'gsc',day,scope,dataset_id:`audit:${day}:${scope}`,complete:1,query_partial:Number(scope==='query'),row_count:1,fetched_at:stamp,notes:'SYNTHETIC AUDIT FIXTURE; NOT LIVE GOOGLE DATA'})))));
    const rows=days.map(date=>({dataset_id:`audit:${date}:page`,date,page:'https://mavibasim.com/brosur',country:'tur',device:'MOBILE',clicks:10,impressions:100,ctr:0.1,position:3}));
    await env.DB.batch(insertRows(env.DB,'gsc_daily_by_page',rows));
    await env.DB.batch(insertRows(env.DB,'gsc_daily_by_query_device',rows.map(row=>({...row,dataset_id:`audit:${row.date}:query`,query:'broşür baskı',is_brand:0}))));
  }
}
