# Gerçek hesap kabulü

Bu adımlar hazırlanmıştır; hesap yetkisi olmadan çalıştırılmış veya geçmiş sayılmaz. Sonuçları `.local/acceptance/` veya erişimi sınırlandırılmış kurum kayıtlarına yazın. Gerçek Google ölçümlerini herkese açık PR/Actions artifact'ine koymayın. Gün/saat UTC olarak ölçülür; GSC kaynak takvimi Pasifik'tir. Operasyon saatini kullanıcıyla paylaşırken İstanbul saatine çevirin.

Ortak ön koşul: `docs/PRODUCTION.md` ile ayrı Workers Free uygulaması yayınlanmış; yönetici anahtarı güvenli süreç ortamında `ADMIN_TOKEN`, uygulama adresi `SEO_APP_ORIGIN` olarak verilmiş. Secret değerlerini komut argümanına veya sohbete yazmayın. Aşağıdaki araç yalnızca SEO uygulamasına GET yapar; Google consent, senkron veya canlı site taraması tetiklemez ve canlı site adresini hedef olarak kabul etmez.

```sh
python3 scripts/accept_production.py --stage disconnected --output .local/acceptance/01-disconnected.json
python3 scripts/accept_production.py --stage sync --output .local/acceptance/02-sync.json
python3 scripts/accept_production.py --stage crawl --output .local/acceptance/03-crawl.json
python3 scripts/accept_production.py --stage report --month YYYY-MM --output .local/acceptance/04-report.json
```

Aşamalar ilgili ön koşuldan sonra ayrı çalıştırılır. `passed` yalnızca o aşamanın HTTP smoke koşullarının geçtiği anlamına gelir. Eksik veri `blocked` ve sıfır olmayan çıkış kodu üretir. SQL/gerçek hesap/CPU karşılaştırmaları aşağıda ek kabul koşuludur. Hepsini otomatik test yerine geçen tek bir sağlık URL'sine indirgemeyin.

## A — İlk yayın, bağlantısız güvenlik

1. Girişsiz `/api/health`: yalnızca servis bilgisi; 200. Girişsiz rapor/status/keywords/inventory/history/export: 401. Uygulama shell'inin açık olması veri erişimi değildir.
2. Aynı origin ile güçlü yönetici anahtarıyla giriş: HttpOnly/Secure/SameSite=Strict cookie, CSP ve no-store korumaları. Başka origin'den POST reddedilmeli. Anahtar yanlışken 401, deneme sınırında 429. Anahtar/token loglanmamalı.
3. Kaynak SQL'i çalıştırın:

```sh
node scripts/run.mjs --capture .local/acceptance/01-source.log wrangler d1 execute DB --remote --config deploy/wrangler.production.jsonc --file deploy/acceptance-source.sql
```

4. Beklenen 4/29/521/9.075/6.765; foreign key hatası yok. Altı migration'ın adı doğru. OAuth ve tarama ilk kurulumda yok; panel 29 ürünü Veri bekle gösterir. Test fixture veya yerel kullanıcı sorusu üretime aktarılmaz.

## B — İlk gerçek Google senkronu

1. GSC mülk sahibi `webmasters.readonly` consent'ini verir; callback bir kez geçer, aynı state tekrar kullanıldığında reddedilir. D1'de yalnızca credential sayısını kontrol edin; encrypted_tokens veya token değerini yazdırmayın.
2. Cron kontrollü etkinleştirilir. İlk tur planlar, sonraki tur gerçek API çağrısı yapar. İki kapsam da tamamlanana kadar bekleyin; imleç veya running PID başarı değildir. Cron yayılımına 15 dakikaya kadar süre tanıyın. Yerel `/cdn-cgi/local/scheduled` üretim tetikleyicisi değildir.
3. Seçilen gün D-3 UTC. İki dataset: `provider=gsc`, `scope=page` ve `query`, `complete=1`; aktif `dataset_id`, `row_count=stored_rows`. Sorgu kapsamında `query_partial=1` beklenir; Google tüm sorguları vermez. İlk gün için sıfır satır dönerse erişim çalışmış olabilir fakat ürün performansı kabulü geçmez; bunun veri yokluğu mu yanlış mülk mü olduğu incelenir.

```sh
node scripts/run.mjs --capture .local/acceptance/02-sync-sql.log wrangler d1 execute DB --remote --config deploy/wrangler.production.jsonc --file deploy/acceptance-sync.sql
```

4. GSC arayüzü veya aynı Search Analytics API filtresiyle aynı kesinleşmiş gün, aynı `/brosur` veya `/el-ilani`, aynı ülke/cihaz, `web`, `byPage` boyutlarında tıklama ve gösterimi karşılaştırın. CTR ve gösterim ağırlıklı konumu SQL'den yeniden hesaplayın. Property toplamını farklı aggregation ile sayfa toplamına eşit varsaymayın. Görünür sorgu toplamını sayfa toplamına eşitlemeyin.
5. OAuth kaydı tek başına başarılı bağlantı değildir. Yeni GSC health `ok`, kaynak günleri ve gerçek ölçümler gerekir. 401/403/kota/yanlış mülk durumunda durum kaydı ve Veri bekle görülmeli. Gerçek hesapta kasıtlı kota tüketmeyin veya çalışan consent'i bozmayın; olumsuz senaryolar yerel taklit testlerle doğrulandı.
6. Doğal yeniden uzlaştırma sonrası aynı mantıksal gün/sayfa/cihaz/ülke için aktif kümede satır çoğalmadığını SQL sayımlarıyla kontrol edin. Eski immutable dataset kopyası ile aktif tekrar sayımı farklıdır; arşiv satırları toplanmaz.
7. Cloudflare Metrics'ten gerçek ilk senkron CPU, invocation/subrequest ve D1 rows_read/rows_written ölçümünü kaydedin. 10 ms CPU, 50 D1 sorgusu ve kalan günlük Free bütçe aşılırsa kabul geçmez. Plan yükseltme yok.

## C — İlk canlı salt okunur tarama

1. Senkron kabulünden sonra tarama açık olarak ayrı Worker tekrar yayınlanır. İlk robots isteği ve crawl-delay beklemesi ayrı kaydedilir. İzin vermeyen robots 200 sayfa gibi gösterilmez; kullanıcıdan robots'u değiştirmesi istenmez.
2. Sitemap ve iç bağlantı keşfiyle `/brosur`, `/el-ilani` kuyrukta görülmeli. Her biri için gerçek HTTP yanıtı, `observed_at`, `crawl_id` ve immutable `snapshot_id` gerekir. Yalnızca açık port veya crawl_enabled bayrağı yeterli değildir.
3. Envanterde title, description, H1–H6, canonical, robots/X-Robots-Tag, iç bağlantı ve statik içerik hash'i gerçek HTML'le karşılaştırılır. Self-canonical farklıysa bulgu incelenir; sırf testi geçirmek için site düzeltilmez veya canonical uydurulmaz. Host dışı yönlendirme izlenmez. JS render eksik kapsam olarak kalır.
4. İkinci doğal taramada değişiklik yoksa sahte event oluşmamalı. Gerçek değişiklik varsa eski/yeni değer ve iki tespit zamanı saklanmalı. `published_at` CMS kanıtı yoksa null kalır. Test için canlı başlık veya içerik değiştirmeyin.
5. `accept_production.py --stage crawl` iki belgeli ürünün gerçek snapshot'ını ister. Diğer 27 eşleme kanıtlanana kadar bunların raporları Veri bekle kalabilir; 29 ürünün Google analizi tamamlandı denmez. Kapsam sınırına takılan sitemap bir hata/kapsam eksikliği olarak görünmelidir.

## D — İlk gerçek aylık rapor

1. Seçili ay tamamen kapanmış ve üç günlük veri kesinleşme bekleme süresi geçmiş olmalı. Son tamamlanan ay ile önceki ayın **her gününde iki GSC scope** complete=1 gerekir. Aşağıdaki ilk SQL sonuç kümesi eksik günleri listeler; boş değilse aylık kabul bloke edilir.

```sh
node scripts/run.mjs --capture .local/acceptance/04-month-sql.log wrangler d1 execute DB --remote --config deploy/wrangler.production.jsonc --file deploy/acceptance-month.sql
```

2. Örnek ay `YYYY-MM` yerine gerçek kapalı ay yazılır. Script, `/brosur` ve `/el-ilani` için current/previous ölçümü, kanıt, eksiksiz kapsam ve kanıta dayalı karar ister. Veri yoksa Veri bekle doğru davranıştır; tam aylık rapor kabulü geçmiş sayılmaz. Tüm 29 ürün için aynı kabul ancak doğrulanmış URL ve her iki ayda gözlenen ölçüm varsa genişletilir.
3. `analysis_runs` raporu ile SQL tıklama/gösterim/CTR/ağırlıklı konum hesapları birebir karşılaştırılır; cihazlar ve marka/markasız sorgular karıştırılmaz. Sorgu yoksa null; başarılı sorgu korunur. Kural eşikleri istatistiksel nedensellik olarak sunulmaz.
4. Son GSC health ve 72 saat tazelik kapısı geçmeli. Gerekli tarih daha eski ve stale ise ilgili senkron işi kontrollü yeniden uzlaştırılır; zaman damgası elle değiştirilmez, tazelik eşiği gevşetilmez.
5. Her önerinin kaynak dataset referansı, ölçüm zamanı, URL, sorgu/cihaz filtresi, hesaplaması ve sonraki ölçümü okunur. Önceki 3/6/12 ay ve yıl karşılaştırması kapsam yoksa null/eksik kalır. GA4 bağlı değilken şehir sorgusu iddiası yoktur.
6. Raporda ilk üç öncelik gerçek kanıt gerektirir; mevcut başarılı kelimeleri değiştirmeye yönlendiren genel öneri olmamalı. Başlık değişimi sonrası korelasyon kesin sebep diye yazılmamalı.
7. Üretim CPU ve D1 bütçesini gerçek dolu raporda ölçün. Yerel hızlı test Free 10 ms uyum kanıtı değildir. Ölçüm kapısı geçmeden tüm geçmişi sürekli toplama ve gözetimsiz üretim kabulü verilmez.

## E — Kurtarma ve gözetimsiz çalışma

Şifreli uzak yedek indirilebilir, yanlış anahtarı reddeder ve ayrı geçici SQLite'ta bütünlük/sayım geçer. D1 Time Travel veya yedekten geri dönüş önce ayrı kurtarma kaynağında kabul edilir. Gerçek kaynak D1 silinmez. En az bir sonraki günlük Cron'da yeni health, eksik gün yeniden alma ve kayıp olmadan devam doğrulanır. Bu görülmeden bilgisayar kapalıyken günlük işliyor denmez. GitHub backup işi çalışmadıysa yalnızca workflow dosyası bulunması yedek kanıtı değildir.

## Kayıt ve geçiş kararı

Kayıt: uygulama commit/deployment ID, kabul zamanı, Free planın hesap paneli kanıtı, aşama JSON sonuçları, kısıtlı SQL çıktıları, gerçek CPU/D1 metrikleri, yedek manifest/hash. Token, OAuth code, anahtar ve şifreli token içeriği bu kayda girmez.

| Aşama | Bu oturumdaki durum |
|---|---|
| Yerel regresyon/güvenlik/üretim dry-run | Otomatik çalıştırıldı; sonuç release review'da |
| Gerçek hesap D1/Worker yayını | Yetki bekliyor, çalıştırılmadı |
| Gerçek OAuth ve ilk senkron | Yetki bekliyor, çalıştırılmadı |
| İlk canlı tarama | Hesap/ağ kabulü bekliyor, çalıştırılmadı |
| İlk gerçek aylık rapor / günlük devam / uzak yedek | Önceki aşamalar bekleniyor, geçmedi |

Eksik yetki dışında bir kabul hatası görülürse otomasyon durur ve bulgu kaydedilir; sınırlara uymak için ücretli servis açılmaz veya gerçek site değiştirilmez.
