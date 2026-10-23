import { AnalysisReport } from './analysis';
import { Env, nowISO } from './types';
import { variantFamily } from './urls';

export async function answerQuestion(env:Env,report:AnalysisReport,question:string):Promise<unknown>{
  if(!question.trim()||question.length>1000)throw new Error('INVALID_QUESTION');
  const normalized=variantFamily(question);
  const product=report.products.find(p=>normalized.includes(variantFamily(p.name))||normalized.includes(p.id.replaceAll('-',' ')));
  const device=/mobil/.test(normalized)?'MOBILE':/masaustu|desktop/.test(normalized)?'DESKTOP':null;
  let answer:Record<string,unknown>;
  if(/istanbul|sehir|bolge/.test(normalized)){
    answer={text:report.region?'Bölgesel ölçüm yalnızca GA4 Organic Search oturumlarını kapsar. Şehir bazında arama sorgusu veya GSC tıklaması çıkarılamaz.':'GA4 için tamamlanmış ve doğrulanmış şehir verisi yok. İstanbul veya başka bir şehir için organik sorgu sonucu çıkarılamaz.',source:'GA4',rows:report.region,confidence:report.region?'gözlemsel':'yetersiz'};
  }else if(/dokunma|koru|basarili/.test(normalized)){
    const protectedProducts=report.products.filter(p=>p.decision==='Koru'||p.queries.some(q=>q.protect));
    answer={text:protectedProducts.length?'Aşağıdaki çalışmalar korunmalı. Kanıt olmadan başlık, içerik veya URL değişikliği önerilmez.':'Başarılı kelime listesi için doğrulanmış Google verisi henüz yeterli değil. Mevcut çalışmalara müdahale etmeyin.',products:protectedProducts.map(p=>({name:p.name,url:p.url,queries:p.queries.filter(q=>q.protect),risk:p.risk,evidence:p.evidence})),source:'GSC'};
  }else if(product){
    const slice=device?product.devices.find(d=>d.device===device):product;
    answer={text:product.reason+' Düşüşün kesin nedenini mevcut gözlemsel verilerle kanıtlayamam.',product:product.name,url:product.url,decision:product.decision,current:slice?.current??null,previous:slice?.previous??null,device:device||'tüm cihazlar',missing:product.missing,risk:product.risk,calculation:product.calculation,evidence:product.evidence,queries:product.queries,source:'GSC'};
  }else{
    answer={text:'Bu sürüm ürün adı, mobil/masaüstü, şehir ve koruma sorularını deterministik olarak yanıtlar. Genel SEO nedeni veya yeni sayfa fırsatı için kanıt yeterli değil. Ürün adını ve dönemi belirterek sorun.',source:'sistem',missing:report.missing};
  }
  answer={...answer,period:report.period,comparison_period:report.previous_period,measured_at:report.created_at,analysis_id:report.id,limitations:['Korelasyon nedensellik değildir.','Eksik sorgu sıfır değildir.','Keyword Planner varyant hacimleri toplanmaz.']};
  await env.DB.prepare('INSERT INTO user_questions VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),nowISO(),question,report.id,JSON.stringify(answer)).run();
  return answer;
}
