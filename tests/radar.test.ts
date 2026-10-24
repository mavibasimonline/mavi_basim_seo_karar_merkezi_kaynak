import {beforeEach,it,expect} from 'vitest';
import {prioritize,buildRadar,wilson,commercialIntent,radar} from '../src/radar';
import {ProductReport,AnalysisReport,Metrics,analyze,saveAnalysis} from '../src/analysis';
import {init,env} from './helpers';
import {auditSeed,AUDIT_TIME} from './audit-fixtures';
const m=(clicks=20,impressions=1000,position=12):Metrics=>({clicks,impressions,ctr:impressions?clicks/impressions:null,position:impressions?position:null});
const p=(patch:Partial<ProductReport>={}):ProductReport=>({id:'brosur',name:'Broşür',url:'https://mavibasim.com/brosur',url_verified:true,group_name:'test',current:m(),previous:m(100),decision:'İncele',reason:'test',confidence:'orta',risk:'Başarılı sorgular korunmalı; zarar riski.',calculation:{},devices:[],queries:[{query:'broşür baskı fiyatları',clicks:20,impressions:1000,previous_clicks:100,is_brand:false,protect:true,missing_current:false,current:m(),previous:m(100,1000,16)}],brand:{brand:null,non_brand:null,note:'test'},evidence:[{id:'fixture',source:'GSC',ref:'test-only',fetched_at:'2026-10-23T12:00:00Z',scope:{}}],missing:[],comparisons:{},keyword_sources:0,keyword_rows:0,...patch});
beforeEach(init);
const cases:[string,Partial<ProductReport>,string][]=[
 ['R01 doğrulanmış ticari yakın konum',{},'İnceleme fırsatı'],
 ['R02 bağlantı/kapsam yetersiz',{decision:'Veri bekle'},'Veri yetersiz'],
 ['R03 eksik günlük kayıt',{missing:['eksik gün']},'Veri yetersiz'],
 ['R04 kanıtsız ölçüm',{evidence:[]},'Veri yetersiz'],
 ['R05 canlı canonical doğrulanmadı',{url_verified:false},'Veri yetersiz'],
 ['R06 önceki ölçüm yok',{previous:null},'Veri yetersiz'],
 ['R07 güncel ölçüm yok',{current:null},'Veri yetersiz'],
 ['R08 az örneklem',{current:m(2,50),previous:m(1,50)},'İzle'],
 ['R09 sorgu kanıtı yok',{queries:[]},'İzle'],
 ['R10 salt marka sorgusu',{queries:[{...p().queries[0],is_brand:true}]},'İzle'],
 ['R11 marka bayrağı yanlış olsa da marka adı korunur',{queries:[{...p().queries[0],query:'Mavi Basım baskı fiyatları'}]},'İzle'],
 ['R12 ücretsiz bilgi niyeti',{queries:[{...p().queries[0],query:'ücretsiz broşür baskı örnekleri'}]},'İzle'],
 ['R13 niyet bilinmiyor',{queries:[{...p().queries[0],query:'broşür'}]},'İzle'],
 ['R14 örnek dosya niyeti',{queries:[{...p().queries[0],query:'broşür pdf şablon baskı'}]},'İzle'],
 ['R15 konum sınırı alt 8',{queries:[{...p().queries[0],current:m(20,1000,8)}]},'İnceleme fırsatı'],
 ['R16 konum sınırı üst 20',{queries:[{...p().queries[0],current:m(20,1000,20)}]},'İnceleme fırsatı'],
 ['R17 sorgu kaydı eksik',{current:m(100),previous:m(100),queries:[{...p().queries[0],current:null,clicks:null,missing_current:true}]},'İzle'],
 ['R18 baştan beri sıfır tıklama ve bilgi niyeti',{current:m(0),previous:m(0),queries:[]},'İzle'],
 ['R19 düşük hacimde %100 büyüme',{current:m(2,100),previous:m(1,100),queries:[]},'İzle'],
 ['R20 sıfır bazdan artış kesin eğilim değildir',{current:m(40),previous:m(0),queries:[]},'İzle'],
];
it.each(cases)('%s',(name,patch,status)=>{const result=prioritize(p(patch),28,28);expect(result.status).toBe(status);expect(result.risk).toContain('korunmalı');if(status==='Veri yetersiz')expect(result.score).toBeNull();});
it.each(['fiyat','sipariş','adet','toptan','baskı'])('R21–25 ticari ifade bağımsız sınıflanır: %s',word=>{expect(commercialIntent('broşür '+word)).toBe('commercial');});
it('R26 Wilson CTR aralığı bağımsız bilinen sınırlar içindedir',()=>{expect(wilson(0,1000)![1]).toBeCloseTo(0.00382676,6);expect(wilson(500,1000)![0]).toBeCloseTo(0.469069,5);expect(wilson(2,1)).toBeNull();expect(wilson(0,0)).toBeNull();});
it('R27 gösterim büyümesi ve CTR düşüşü otomatik başarısızlık değildir',()=>{const r=prioritize(p({current:m(120,2000),previous:m(100,1000),decision:'Koru'}),28,28);expect(r.flags.join()).toContain('tek başına başarısızlık değildir');expect(r.declining).toBe(false);});
it('R28 son 28 günlük eğilim eşit pencere ve maddi kayıp kullanır',()=>{expect(prioritize(p({current:m(150),previous:m(100),decision:'Koru'}),28,28).rising).toBe(true);expect(prioritize(p({current:m(120),previous:m(100),decision:'Koru'}),28,28).rising).toBe(false);expect(prioritize(p(),28,28).declining).toBe(true);});
it('R29 yakın SEO değişikliği nedensellik değil belirsizlik indirimi verir',()=>{const a=prioritize(p(),28,28),b=prioritize(p(),28,28,true);expect(a.score!-b.score!).toBe(10);expect(b.components.at(-1)!.calculation).toContain('etki nedeni değildir');});
it('R30 mobil/masaüstü konum farkı veriyle ayrı işaretlenir',()=>{const devices:any=[{device:'MOBILE',current:m(50,1000,12)},{device:'DESKTOP',current:m(50,1000,4)}];expect(prioritize(p({devices}),28,28).flags.join()).toContain('Mobil');devices[0].current=m(1,10,12);expect(prioritize(p({devices}),28,28).flags.join()).not.toContain('Mobil');});
it('R31 Planner hacmi ve reklam rekabeti puanı değiştirmez; tekrarlar toplanmaz',()=>{const report={id:'test',products:[p()],period:{days:28},previous_period:{days:28},created_at:'2026-10-23',collisions:[]} as unknown as AnalysisReport;const record={product_id:'brosur',keyword:'ücretsiz şablon',avg_monthly_searches:1000000,path:'TEST.csv',exported_at:'2026-10-01',period_label:'test',sha256:'test',row_number:4,advertiser_competition:'High'};const a=buildRadar(report),b=buildRadar(report,[record]);expect(a.products[0].score).toBe(b.products[0].score);expect(b.products[0].market_demand).toEqual([record]);});
it('R32 açıklanabilir puan bileşenleri ve en fazla 5 öncelik',()=>{const report={id:'test',products:Array.from({length:8},(_,i)=>p({id:`p${i}`})),period:{days:28},previous_period:{days:28},created_at:'2026-10-23',collisions:[]} as unknown as AnalysisReport;const r=buildRadar(report);expect(r.opportunities).toHaveLength(5);const one=r.products[0];expect(one.score).toBe(Math.max(0,one.components.reduce((s,c)=>s+c.points,0)));});
it('R33 kaynak değişince yeni snapshot üretir; eski sonuç immutable kalır',async()=>{await auditSeed();const report=await analyze(env,'2026-09',AUDIT_TIME);await saveAnalysis(env,report);const a=await radar(env,report),b=await radar(env,report);expect(a.id).toBe(b.id);await expect(env.DB.prepare("UPDATE insight_runs SET result_json='{}'").run()).rejects.toThrow('immutable_insight');const next=await analyze(env,'2026-09',AUDIT_TIME);await saveAnalysis(env,next);expect((await radar(env,next)).id).not.toBe(a.id);});
it('R34 eski/eksik Google verisinde fırsat uydurmaz',async()=>{const report=await analyze(env,'2026-09',AUDIT_TIME);const r=buildRadar(report);expect(r.opportunities).toEqual([]);expect(r.insufficient).toHaveLength(2);});
