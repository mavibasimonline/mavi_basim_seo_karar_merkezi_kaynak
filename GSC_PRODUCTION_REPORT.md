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

262 Workers/D1 + 36 Python + 2 gerçek Chromium mobil/masaüstü = 300 test başarılı; tip kontrolü, üretim dry-run ve Worker paketleme başarılı. Yeni testler: kapanmış aylar, Google kesinleşme gecikmesi, günlük planlama/hata ayrımı, öncelik/lease/generation, boş slot, 1.000 satırın kaldığı imleçten devamı, OAuth refresh, Retry-After, yanlış commit, eşzamanlı sürüm, D1 binding değişimi, hesap kotası yokluğu, atomik bütçe yarışları, çökme rezervasyonu, UTC'de yeniden çalışma ve indeksler dahil azami sayfa yazma maliyeti. npm audit 0. Tam kaynakların hash/aktarımı test kapsamında korunur.

## Canlı yayın ve sonuç kabulü — 17:42 UTC ölçümü

- [PR #8](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/pull/8) ve [PR #9](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/pull/9) main'e birleşti. Son fonksiyonel main commit'i `70d6476a0859fb8652f2b40d132bb04e3f918879`; main CI 40116927721 başarılı, 300 test/audit/build/kaynak/üretim dry-run geçti.
- [Kontrollü yayın 40116985614](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/actions/runs/40116985614) başarılı. Gerçek health yanıtı ve Cloudflare 100% deployment aynı commit'e ve `d482659d-56a2-44e4-8645-fbdd66f0f724` Worker version'ına işaret etti. Mevcut D1, auth binding adları ve 29/521/9075 sayıları postflight ile tekrar doğrulandı.
- Main'e birleşince mevcut Cloudflare Git bağlantısının ayrıca otomatik yayın yaptığı görüldü. İlk kontrollü deneme 40116195577, beklenen eski sürüm değiştiği için **yayın yapmadan** güvenle durdu. Güncel version yeniden okundu; koruma gevşetilmedi.
- Sonraki deneme 40116326806 yükleme sonrasında Python varsayılan User-Agent'ı için Cloudflare 1010/403 yanıtı aldı; **otomatik Worker + Cron geri dönüşü gerçekten çalıştı**. Aynı public endpoint curl ile 200 döndü. `MaviBasimReleaseCheck/1.0` açık servis kimliği ve JSON kabulüyle Python isteği de 200 aldı. PR #9 yalnız doğrulama istemcilerini düzeltti; site/kimlik doğrulama/Cloudflare güvenliği kapatılmadı.
- Canlı `/app.js` SHA-256 kodla birebir aynı; oturumsuz `/api/status` **401**. Gerçek kullanıcı raporu için yönetici oturumunu atlama yapılmadı; gizli anahtar okunmadı.
- Gerçek OAuth kaydı 17:34:36 UTC'de yenilendi; salt okunur `webmasters.readonly` kapsamı korundu. Ardından yeni Worker altında gerçek Google kayıtları alındı; hata geçmişi boş.

| Gerçek kontrol | Sonuç |
|---|---|
| 17:18 başlangıç | 18 done / 162 pending; hedef 0/184 |
| 17:30 günlük plan | scheduler PLANNED; 90 eski gün daha eklendi, toplam 360 iş |
| 17:37 gerçek Cron | scheduler PAGES_3; 29 done / 331 pending; hedef 7/184 |
| 17:39 yeni etiketli Worker | PAGES_3; 35 done / 325 pending; hedef 11/184 |
| 17:40 son Google sayfası | PAGES_1; 36 done / 324 pending; hedef 12/184 |
| 17:42 sonraki kontrol | Yeni Google hata kaydı yok; aynı kapsam korunuyor; günlük bütçe beklemesi |

Pending sayısının planlama sırasında 162'den 342'ye çıkması veri kaybı değildir: önceki cursor'dan 90 ek tarih/scope kuyruğa alınmıştır. Aynı 360 iş içinde 342 → 331 → 325 → 324 azalışı doğrulandı. Yalnız pending sayısıyla ilerleme değerlendirilmez; tamamlanmış günlük kapsam ve satır imleci de gösterilir.

17:42 UTC'de aktif gerçek GSC veri kümeleri:

| Ay | Sayfa kapsamı | Sorgu kapsamı | Kaynak satırı (sayfa / sorgu) |
|---|---:|---:|---:|
| Temmuz 2026 | 0/31 gün | 0/31 gün | Henüz alınmadı |
| Ağustos 2026 | 0/31 gün | 0/31 gün | Henüz alınmadı |
| Eylül 2026 | 6/30 gün (25–30) | 6/30 gün (25–30) | 598 / 1.160 |
| Ekim 2026 | 12 gün (10–21) | 12 gün (10–21) | 1.137 / 2.168 |

Bu satır sayıları pazar talebi, tıklama veya tam sorgu evreni değildir. Sorgu ve sayfa tabloları ayrı boyutlara sahiptir; toplanarak trafik üretilmez.

Günlük senkron muhasebesi **8.552/10.000** yazma rezervasyonu/maliyeti gösteriyor. Yeni azami API sayfası için 1.500 rezervasyon gerekir; 10.052 sınırı aşacağından yeni iş alınmıyor. Hesap genelinde analitik **75.186/100.000 yazma**, **326.436/5.000.000 okuma** gösterdi; analitik gecikmeli olabilir. Gerçek D1 hard kotasının tamamen bittiği iddia edilmez; raporlar/diğer işler için güvenlik payı bırakılır. Sonraki UTC gününün bütçesi 60.000; kod 25 Ekim 00:00 UTC / Türkiye 03:00'te yeni günlük bütçeyle devam edecek şekilde test edildi. Gelecek UTC günündeki gerçek devam henüz gözlenmedi; bitiş tarihi garanti edilmez.

## Gerçek site ve eksik kabul

Bu ortamdan standart, dürüst bot kimliğiyle salt okunur GET yapıldı: `robots.txt`, `sitemap.xml` ve `/brosur` **HTTP 200**. Robots genel erişime izin veriyor ve sitemap bildiriyor; broşür canonical değeri `https://mavibasim.com/brosur`. Sitemap lastmod değeri kesin SEO yayın zamanı sayılmaz. Bu üç kontrol üretim tarayıcısının kabulü veya 29 sayfanın doğrulanması değildir.

Gerçek D1'de **29 ürün, 2 başlangıç URL eşlemesi, 0 taramayla doğrulanmış ürün URL'si** var. Otomatik tarama mevcut operatör ayarıyla kapalı korundu. Bazı gerçek sitemap slug'ları klasör adından farklı (`/antetli`, `/dosyalar`); kanıt olmadan ürün URL'si tahmin edilmemelidir. Tarama/sayfa kanıtı eksikken motor ürünleri Veri bekle durumunda tutmalıdır; korumalı aylık raporun uçtan uca kabulü henüz yapılmadı. Bunun için yanlış gerçek veri veya demo sonuç yazılmadı.

## Devam ve yetki gereksinimi

1. Kalan **172/184** hedef günlük/scope aktarımının sonraki bütçelerde tamamlanmasını gerçek D1 ile kontrol et; Google boş/anonim sorgularını tam veri veya sıfır trafik sayma. Günlük en yeni kesinleşmiş gün ve gecikmeli uzlaştırma aynı kuyrukta korunur.
2. Mevcut salt okunur tarayıcının gerçek pilotunu çalıştır; site/robots kanıtından sonra otomatik taramayı kontrollü aç ve 29 ürün eşlemesini kanıtla tamamla. Bu kod mevcut; yeni tarayıcı yazılmayacak. Canlı siteye yazma yapılmayacak.
3. Tam dönemler ve ürün kanıtı oluşunca yönetici oturumuyla gerçek aylık rapor, soru-cevap ve başarılı sorgu koruma kabulünü tamamla. Giriş anahtarını sohbet/Git'e koyma veya güvenliği atlama.
4. Gerçek şifreli uzak yedek için bağımsız **BACKUP_ENCRYPTION_KEY** GitHub secret'ı eksik. Cloudflare token/account zaten çalışıyor; yeni Google OAuth veya Cloudflare token istenmiyor. Hesap sahibi bağımsız 32 bayt base64 anahtarı güvenli secret alanına kaydetmeli; sonra mevcut backup workflow'u ile ilk gerçek geri yükleme kabulü yapılmalı. OAuth şifreleme anahtarını değiştirmeyin.
5. Rakip PR #7 taslak, teknik SEO/iç bağlantı/sorgu-URL istekleri bekleyen iş kaydıdır; bu üretim olayında yayımlanmadılar.

Bu belge tarihli ölçümdür. En son dağıtım commit/version kimliği canlı `/api/health` ve kontrollü üretim workflow'undan doğrulanmalıdır; yalnız GitHub CI başarısı canlı kabul sayılmaz. Oturumun kendiliğinden yeniden başlayacağı garanti edilmez. Ücretli plan/API açılmadı, canlı mavibasim.com içeriği ve 521 CSV değiştirilmedi.
