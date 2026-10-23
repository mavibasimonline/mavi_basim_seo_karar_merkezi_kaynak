# Türkçe soru-cevap kabul raporu

Dal: `feat/turkce-soru-cevap`; bağımlılık: PR #2 (`audit/seo-reliability`). Açık PR #2 GitHub'da MERGEABLE ve CI SUCCESS olarak kontrol edildi. Bu PR onun üzerine kurulur; tabanı PR #2 dalıdır. Önce #2, sonra bu PR birleştirilir. Main otomatik değiştirilmedi.

## Çalışan davranış

Ürün performansı, yükselen ürünler, gösterimi artan fakat tıklaması olmayan görünür sorgular, koruma listesi, inceleme fırsatı, mobil kayıp, değişiklik ölçümleri, ilk sayfa sınırına yaklaşan sorgular, eksik veri ve en fazla üç kanıtlı öncelik desteklenir. Şehir soruları yalnızca doğrulanmış GA4 Organic Search oturumudur.

Takip soruları son cevabın kimliği üzerinden sunucudaki kayıtla çözülür. Ürün/cihaz/dönem korunur; yeni ürün ve tüm ürün soruları bağlamı değiştirir, rapor seçimi değişince eski bağlam taşınmaz. Kimliği olmayan veya bozuk bağlam reddedilir. Oturum kapatılınca tarayıcı bağlamı temizlenir.

Son 28/30 gün, önceki eşit uzunlukta kesinleşmiş pencereyle karşılaştırılır. Google gecikmesi nedeniyle son üç gün ve henüz kesinleşmeyen gün hariçtir; gerçek başlangıç/bitiş tarihleri yanıtta gösterilir. Aylık toplamlar 30 gün diye sunulmaz. Cihaz filtresi ham GSC satırlarına uygulanır ve bağımsız SQL doğrulamasına dahil edilir. Başarılı kelime sonradan gerilese bile koruma uyarısı sürer.

Yanıtlar Ne oldu, Olası açıklamalar, Ne yapmalıyım ve Güven düzeyi alanlarını içerir. Açılır kanıtta URL, dönem, karşılaştırma, ölçüm, kaynak kümesi, tıklama/gösterim/CTR/konum ve risk bulunur. Nedensellik iddiası yoktur. GSC, GA4 ve Keyword Planner ayrı tutulur. Ticari niyet doğrulanmadığında fırsat kesin öneriye dönüşmez. Ücretli model yoktur; SQL değerleri bind edilir, HTML metin olarak oluşturulur.

## 36 otomatik kabul testi

`tests/questions.test.ts`: 30 ayrı Türkçe soru için HTTP API'de intent, doğru ürün, cihaz, ay, kaynak, tarih, güven alanları ve soru kimliği doğrulandı. Ek 6 test: çok adımlı takip ve dönem değişimi; 30 günlük tarih penceresi; 60 günlük sentetik ham satırdan 600/300 tıklamanın doğrulanması; bozuk/eksik bağlam ve gelecek ay; kaybeden başarılı kelimenin korunması/ölçülmeyen değişiklik; SQL enjeksiyonu ve bağlantısız dürüst yanıt.

| Soru | Yorum |
|---|---|
| Broşür sayfam neden düştü? | performance |
| Son 30 günde hangi ürünler yükseldi? | rising |
| Hangi kelimelerde gösterim artıyor ama tıklama gelmiyor? | query_ctr |
| Kartvizit sayfamda hangi kelimeleri korumalıyım? | protect |
| Zarf sayfam için en önemli fırsat nedir? | opportunity |
| Mobilde düşüş yaşayan sayfalar hangileri? | mobile_loss |
| Son yaptığımız SEO değişiklikleri işe yaradı mı? | outcomes |
| Hangi sayfalar ikinci sayfadan birinci sayfaya yaklaşmış? | ranking |
| Hangi ürünlerde veri yetersiz? | insufficient |
| Bu ay hangi üç ürüne öncelik vermeliyim? | priorities |
| Broşür mobilde neden geriledi? | performance |
| Broşür masaüstünde neden düştü? | performance |
| El İlanı neden düştü? | performance |
| Broşür Eylül 2026 performansı nedir? | performance |
| Broşür 2026-08 performansı nedir? | performance |
| Hangi ürünler yükseliyor? | rising |
| Hangi başarılı kelimelere dokunmayalım? | protect |
| Broşür için hangi kelimeleri koru? | protect |
| Kartvizit mobilde hangi kelimeleri korumalıyım? | protect |
| Zarf için fırsat var mı? | opportunity |
| Broşür İstanbul verisi var mı? | region |
| İstanbul mobilde nasıl? | region |
| Bu ay hangi ürünlerin verisi eksik? | insufficient |
| Hangi ürünlere öncelik vereyim? | priorities |
| Broşür gösterim artarken tıklama neden yok? | query_ctr |
| Broşür hangi sorgularda ilk sayfaya yaklaşıyor? | ranking |
| Son 28 günde hangi ürünler yükseliyor? | rising |
| Broşür SEO değişiklikleri nasıl sonuçlandı? | outcomes |
| Broşür dün değişti, kesin sebep bu mu? | performance |
| Hangi sayfalarda veri yetersiz? | insufficient |

İlk tam 30 gün testi, takvim günlerini ay etiketiyle üreten eski yardımcı nedeniyle eksik kapsam buldu. Tarih üretimi başlangıç tarihinden yapılacak şekilde düzeltildi; test yeniden geçti. Son durumda **36/36 soru testi**, **122 Workers/D1 + 20 Python + 2 masaüstü/mobil = 144 test** geçti. TypeScript, build, kaynak koruma ve npm audit (0 açık) başarılı. Tarayıcıda Broşür mobil sorusundan “Peki masaüstünde?” takip sorusuna doğru ürün ve cihazla geçiş test edildi. Başarısız/atlanmış son test yok.

## Gerçek hesap ve kapsam sınırları

Google/Cloudflare hesabı hâlâ bağlı değildir. Pozitif hesaplamalar yalnızca test veritabanındaki açıkça sentetik fixtures ile sınandı; panelin gerçek yerel kaynakları 521 CSV'dir. Gerçek senkron, canlı tarama, üretim CPU/D1 bütçesi ve gerçek sorularla hesap kabulü yapılmadı. Serbest Türkçe için desteklenen ifadeler deterministik kurallarla sınırlıdır; her soru veya çok ürünlü dilsel karşılaştırma anlaşılıyor denmez. GSC anonim sorguları tam liste değildir. 100 sorgu sınırında karar durur. GA4 şehir yanıtı GSC sorgu sonucu değildir. Eksik veya henüz ölçülmemiş değişiklik başarı sayılmaz.
