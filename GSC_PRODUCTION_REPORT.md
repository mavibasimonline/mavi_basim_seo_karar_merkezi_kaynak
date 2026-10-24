# GSC üretim kuyruğu — 24 Ekim 2026

Bu kayıt gerçek Cloudflare/D1 tanılamasını test verilerinden ayırır. Tarihler UTC; İstanbul üç saat ileridedir. Henüz üç ayın tamamlandığı iddia edilmez.

## Doğrulanmış başlangıç

- Main `621d56647ed5d2bb78f05d01845860d69dd8f549`; uzak CI başarılı. Canlı public/app.js hash'i aynı main dosyasıyla eşleşti. Eski backend commit etiketi yoktu; tam backend commit'i bu kanıtla belirlenemez.
- Ayrı Worker `mavi-basim-seo-prod`, mevcut D1 `mavi-basim-seo`, GSC `sc-domain:mavibasim.com`. Site route'u yok; Ads, GA4 ve tarama kapalı korunur.
- Canlı Worker version `e2e53557-7ecd-4420-a938-179b3dbb52a3`, deployment `7ad7a8be-9b9f-43f6-a269-18bd31f64e9f`, Cron `*/15 * * * *`.
- 16:44 UTC: 10 done / 170 pending. 17:18 UTC: 18 done / 162 pending, Ekim 13–21 günleri sayfa+sorgu kapsamı. Google hata kaydı yok. Gerçek kuyruk ilerliyor; 1/179 eski görüntüdür.
- Temmuz/Ağustos/Eylül başlangıç kapsamı: iki scope için sırasıyla 0/31, 0/31, 0/30 gün; toplam 0/184. Sorgu scope'u anonimleştirilmiş bütün sorguların geri geldiği anlamına gelmez.
- Kaynak arşivi D1'de 29 ürün / 521 dosya / 9.075 gözlem. Üretimde migration 0001–0004. Kaynak CSV'lere yazılmadı.
- Hesap genelinde 17:18 UTC D1 analitiği: 209.054 okuma / 66.775 yazma. Ücretsiz günlük sınır 5 milyon okuma / 100 bin yazma; analitik gecikmeli olabilir.
- Kanıt: GitHub Actions salt okunur tanılama koşuları 40112974396 ve 40115485002. Artifact yalnız sayaçlar, kapsam, hata kodları ve binding adları içerir; token ve arama sorguları içermez.

## Kök neden ve değişiklik

Kron çalışıyor; OAuth yenileme veya Google kota hatası görülmedi. Tek çağrıdaki sayfalama ilerlemesi `pending` sayısını hemen azaltmayabilir. En yeni günlerden geriye giden sıra geçmiş ayları geciktiriyordu. İlk 90 günlük plan Temmuz 1–23 günlerini ilk gün kapsamıyordu. Her dört saatte bir boş sonuç ölçümü için ayrılan aralık da Google işi yapmadan dönüyordu. Ayrıca başarısız scheduler heartbeat'i günlük planlama tamamlandı sanılabiliyordu.

Düzeltme son üç kapanmış ayı baştan kuyruğa ekler, iki geçmiş/ bir yakın tarih sayfasıyla ilerler, en fazla 200 satır × 3 API sayfası işler. Sonuç ölçümü yalnız gerçek iş varsa aralığı kullanır. Planlama ve gerçek Cron sağlık kayıtları ayrıdır. İşin mevcut generation/cursor/lease/retry tarihi korunur. Tam günlük veri doğrulanmadan önceki aktif kapsam değiştirilmez.

`CATCHUP_ENABLED=true` ile eksik öncelikli aylarda dakikalı çağrı, kapsam tamamlanınca 15 dakikalık gerçek işleme uygulanır. Cron tanımı dakikalı kalır; diğer dakikalar yalnız kapsam kontrolü yapar. Üretimde GSC API istekleri en fazla dakikada üç sayfadır; Ads/GA4 açılmaz.

## Kota ve geri dönüş

Aktarım her API sayfasından önce D1'de atomik 1.500 yazma rezervasyonu alır. Başarılı/başarısız işlem sonrası sunucunun `rows_written` maliyeti + 50 metadata/yenileme payı düşülür; eksik maliyet veya çökmede rezervasyon korunur. Günlük bütçe yetersizse yeni iş alınmaz; ertesi UTC gününde yeni bütçe kullanılır. Kuyruk, eski başarılı veri ve OAuth kaydı silinmez. İlk gün 10 bin, sonraki günler 60 bin ek senkron yazma bütçesi vardır. Planlama, rapor, diğer uygulamalar ve analitik gecikmesi için hesapta pay bırakılır; bu sayı hesap genelinin sınırsız kullanım garantisi değildir.

Resmî güncel D1 sınırına göre `db.batch()` çağrısı SQL sayısından bağımsız **bir** invocation sorgusu sayılır. İlk incelemedeki aksi yorum düzeltilmiştir; gerçek loglarda 50 sorgu kotası hatası görülmemiştir. Kaynak: [Cloudflare D1 limitleri](https://developers.cloudflare.com/d1/platform/limits/).

Üretim workflow'u yalnız main'de, kullanıcının zaten verdiği dağıtım yetkisiyle manuel tetiklenir. Önce beklenen canlı version, aynı D1 binding'i, 29/521/9075 kaynak sayısı, mevcut auth binding adları, GA4/Ads/tarama ayarları ve günlük hesap kotası denetlenir. Başka operatör sürüm değiştirmişse yayın durur. Şema, kaynak aktarımı ve secret put işlemi içermez. `--keep-vars` ile mevcut değişkenler korunur; yeni config değişkenleri açıkça uygulanır. Yayın SHA ile etiketlenir.

HTTP health tam commit'i ve version metadata'yı doğrular; sonrasında Cloudflare 100% deployment, kaynak sayıları ve mevcut binding adları tekrar denetlenir. Kabul başarısızsa kaydedilmiş eski Cron ve Worker version geri yüklenir. D1 rollback veya token yenileme anahtarı değişikliği yapılmaz. Tam veritabanı yedeği alındığı iddia edilmez: mevcut şifreli uzak yedek koşusu ön koşul eksikliğinden atlandı (40112200650).

## Test edilmiş olanlar

262 Workers/D1 + 35 Python + 2 gerçek Chromium mobil/masaüstü = 299 test başarılı; tip kontrolü, üretim dry-run ve Worker paketleme başarılı. Yeni testler: kapanmış aylar, Google kesinleşme gecikmesi, günlük planlama/hata ayrımı, öncelik/lease/generation, boş slot, 1.000 satırın kaldığı imleçten devamı, OAuth refresh, Retry-After, yanlış commit, eşzamanlı sürüm, D1 binding değişimi, hesap kotası yokluğu, atomik bütçe yarışları, çökme rezervasyonu, UTC'de yeniden çalışma ve indeksler dahil azami sayfa yazma maliyeti. npm audit 0. Tam kaynakların hash/aktarımı test kapsamında korunur.

## Canlı yayın ve sonuç kabulü

Henüz yayınlanmış sayılmaz; bu bölüm gerçek dağıtım ve yeni D1 ölçümleriyle güncellenecektir. Temmuz–Eylül aktarımının tamamı, günlük yeni günün alınması, korumalı panelin gerçek aylık raporu ve gerçek site taraması ayrı kabul gerektirir. Eksik veri ve Google'ın gizlediği sorgular sıfıra çevrilmez. Başarılı sorgu koruması ve nedensellik sınırlamaları korunur.
