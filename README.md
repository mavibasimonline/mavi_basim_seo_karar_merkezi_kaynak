**26 Ekim GSC düzeltmesi — henüz yayımlanmadı:** sahip olunan apex/www URL gözlemleri, gerçek mülk kapsamı ve blocked iş karantinası için [kod/test/kapsam raporu](GSC_URL_VARIANTS_REPORT.md). Güncel devam kaydı [TODO.md](TODO.md); aşağıdaki tarihli üretim kayıtları tarihçedir.

Veri kaynakları ve bağımsız metrik denetimi: [DATA_INTEGRITY_AUDIT.md](DATA_INTEGRITY_AUDIT.md).

SEO değişiklik takvimi ve 28 günlük etki karşılaştırması: [test ve sınırlar](SEO_CHANGE_IMPACT_REPORT.md).

Fırsat radarı: [kabul ve sınırlar](SEO_OPPORTUNITY_RADAR_REPORT.md).

# Mavi Basım SEO Karar Merkezi

**25 Ekim D1 kota olayı:** PR #22 main'e birleşti; **467 test ve main CI 40212255314 başarılı**. PR #21 arayüzü korunur. Hesap sahibi Cloudflare otomatik Git dağıtımını kapattığını bildirdi. Yeni Worker sürümü henüz yayımlanmadı. **26 Ekim 03.17 Türkiye** için ilk kontrollü yayın denemesi ve 05.47'ye kadar sınırlı tekrarlar main'de kayıtlıdır; başarılı CI/kota/sürüm kapıları zorunludur. Saatlik gözlemci gerçek koruma yayımlanmadan D1'e dokunmaz. Gerçek bekleme provası 40212297189 `database_queries=0` doğruladı. Kullanıcıdan ek işlem gerekmez; gerçek kota sonrası yayın/GSC/okuma kabulü bekliyor. [Kanıt ve sınırlar](D1_READ_QUOTA_INCIDENT.md), [güncel devam kaydı](TODO.md). Aşağıdaki önceki tarihli yayın kayıtları tarihçedir.

Üretime geçiş: [hesap/dağıtım/OAuth yönergesi](docs/PRODUCTION.md), [ilk gerçek veri kabulü](docs/PRODUCTION_ACCEPTANCE.md), [main ve güvenlik denetimi](docs/RELEASE_REVIEW.md). Çalışan uygulama korunur; üretim kaynakları bu oturumda oluşturulmadı.

Türkçe soru-cevap ve takip bağlamı: [kabul raporu](QUESTION_ANSWER_TEST_REPORT.md). Son 28/30 kesinleşmiş gün, cihaz, koruma, öncelik ve mevcut değişiklik sonuçları desteklenir; ücretli model kullanılmaz.

Bağımsız denetim: [AUDIT_REPORT.md](AUDIT_REPORT.md). Motor 1.2.0; marka/cihaz ayrımı, sağlık ve URL kanıtı olmadan karar durur.

Türkçe tek ekran paneli, Cloudflare Worker API'si, D1/SQLite veri modeli, günlük Google senkron kuyruğu, salt okunur site tarayıcısı ve kanıtla sınırlanan karar motoru. Ücretli LLM veya ücretli API zorunluluğu yoktur. Uygulama canlı siteye yazmaz.

**Güncel üretim durumu (24 Ekim 2026):** Ayrı [Workers uygulaması](https://mavi-basim-seo-prod.mavibasimonline.workers.dev) ve gerçek D1 mevcuttur. Mevcut Google OAuth bağlantısından gerçek GSC kayıtları alınmıştır; 17:42 UTC tanılamasında 36 günlük sayfa/sorgu veri kümesi tamamlanmıştır; Temmuz–Eylül hedefi 12/184 düzeyindedir. Bu, Temmuz–Eylül aylarının tamamlandığı veya ürün raporlarının kabulden geçtiği anlamına gelmez. 300 test ve gerçek commit/version doğrulamasıyla kontrollü yayın başarılıdır; aktarım günlük güvenlik bütçesiyle devam eder. Üretim kuyruğu düzeltmesi, kota ve canlı kabul kaydı: [GSC_PRODUCTION_REPORT.md](GSC_PRODUCTION_REPORT.md). Bu belgenin aşağıdaki eski kurulum engelleri tarihçedir; güncel durum için raporu kullanın. GA4 ve Ads kapalıdır. Mevcut tarayıcının broşür/el ilanı gerçek pilotu ve D1 snapshot kanıtı başarılı; otomatik üretim taraması 18:02 UTC gerçek Cloudflare ayarında etkin doğrulanmıştır; ilk sonraki saatlik olay ayrıca izlenmelidir. 29 ürünün tamamı taranmış sayılmaz. Test fixture'ları gerçek veri olarak içe aktarılmaz.

**Panel yayını (25 Ekim 2026, Türkiye):** [Canlı uygulama](https://mavi-basim-seo-prod.mavibasimonline.workers.dev) yenilendi; PR #13 ve main CI başarılı, kontrollü yayın **40135545161** ve canlı masaüstü/mobil giriş kabulü geçti. Mevcut otomatik aktarım ve kaynaklar korunur; aşağıdaki tarihli geçmiş veri sınırları sürer.

Gerçek üretim devamı (25 Ekim 01:16 Türkiye): [29 ürünün gerçek tarama kabulü, eksik aylık GSC kapsamı ve sonraki otomatik kontrol](PRODUCTION_CONTINUITY_REPORT.md). Tam aylık rapor kabulü henüz geçmedi.

**25 Ekim 2026 kompakt arayüz yayını:** PR #19/main CI başarılı, 374 test geçti. Mevcut Git otomatik yayınının canlı 12 arayüz dosyası main ile eşleşir. Kontrollü tam yayın kabulü günlük D1 okuma güvenlik eşiği nedeniyle bekler; tamamlandı sayılmaz. Gerçek kota/sürüm kanıtı ve sonraki adım [kontrol noktası raporunda](COMPACT_DASHBOARD_REPORT.md) ve TODO.md içindedir.

**Hazır düzeltme — ay durumları ve tablo yoğunluğu:** `fix/month-states-and-table-density` dalında aylar 4–6 px aralıklı, seçili yazı hover/focus/active durumlarında açıkça beyaz; ürün satırları 60 px, filtreler kompakt. 382 test ve tarayıcı görüntüleri [kabul raporunda](MONTH_TABLE_DENSITY_REPORT.md). Yeni düzeltme henüz yayımlanmadı: 25 Ekim 16:50 Türkiye tanılamasında D1 okuma 5.039.419; yayın kapısı 4.000.000 nedeniyle kapalı. Mevcut üretim korunur.

## Dönem seçimi ve kullanım

60 px tek satır üst araç çubuğunda menü, kompakt yıl seçimi, eşit genişlikte 12 açık ay, Dönem menüsü, cihaz, veri durumu ve MB bulunur. Seçili ay mavidir; gelecek ay seçilmez. Masaüstünde ayların tamamı görünür, dar pencere/mobilde çubuk yatay kayar. Ay adına tek tıklamak raporu yükler. **3 Ay / 6 Ay / 12 Ay** mevcut ay dâhil son takvim aylarını özetler. İlk ziyarette mevcut ay/Tüm cihazlar, sonrasında son ay/dönem/cihaz/sekme tercihi korunur.

Büyük tekrarlanan başlıklar kaldırıldı; sekmeler doğrudan veri, filtre veya soru alanıyla açılır. Yenile/indirme düğmeleri etkin çalışma alanının sağ üstündedir. “Ekranı yenile” yalnız kayıtlı veriyi okur. Dönemin ayrıntısı, veri kapsamı ve güncelleme tarihi üstteki durum/bilgi düğmesinden açılır; gerçek hatalar içerikte görünür kalır. **İlk 10 Lider Ürün**, doğrulanmış gerçek ürün ölçümlerini tıklamaya göre sıralar. Kısmi kapsam belirtilir; ölçüm yoksa sahte sıralama/sıfır gösterilmez.

[374 test ve masaüstü/mobil ekran kabulü](COMPACT_DASHBOARD_REPORT.md). [Önceki gerçek çok aylık D1 hesap kabulü](FILTER_BAR_REPORT.md).

## Yenilenen Türkçe panel

Daraltılabilir menüden Genel Bakış, Ürün Performansı, Arama Sorguları, Fırsat Radarı, Değişiklik Takvimi, Veri Sağlığı ve SEO Soru-Cevap açılır. Üstteki dönem/cihaz seçimi KPI, günlük grafik, ürün raporu ve sorgu tablosuna uygulanır. Soru-cevap kendi doğal dil tarih/cihaz bağlamını korur. Ürün satırları kanıt ayrıntısını açar; sorgular sunucuda filtrelenir, sıralanır ve sayfalanır.

Grafikler yalnız doğrulanmış gerçek GSC ölçümlerini içerir; eksik günler çizgiyle birleştirilmez ve sıfırla doldurulmaz. Kısmi ayın gözlenen kapsamı görünürdür, tam dönem karşılaştırması yapılmaz. Google bağlantısı olmadan arşiv ölçümleri güncel bağlantı gibi gösterilmez. Planner hacimleri GSC KPI'larına eklenmez. Mobil ve klavye erişimi, yerel fontlar ve güvenli oturum mevcut uygulama içinde korunur. [334 testlik kabul ve gerçek D1 doğrulaması](FRONTEND_REDESIGN_REPORT.md).

## Kaynakların sonucu

| Ölçüm | Doğrulanan değer |
|---|---:|
| Ana ürün grubu / ürün klasörü | 4 / 29 |
| Orijinal UTF-16, sekme ayrımlı CSV | 521 |
| Kaynak satırı | 9.075 |
| Ürün + özgün kelime sayısı | 6.765 |
| Birden fazla gözlemi bulunan ürün + kelime | 1.300 |
| Tekrarlanan aynı kaynak gözlemi | 1.678 |
| Farklı yazımları bulunan kelime aileleri | 54 |
| Bozuk satır / aynı dosyada özdeş satır | 0 / 0 |
| Ortalama araması boş gözlem | 4.169 |
| Boş aylık arama hücresi | 212.148 |

[Kaynak denetimi](docs/source-audit.json) her dosyanın özgün yolu, SHA-256, dışa aktarım tarihi/kapsamı ve tekrar eden kelimelerin listesini içerir. Boş hücreler sıfıra çevrilmez. Kaynakta bulunmayan lokasyon, dil, arama ağı ve dışa aktarım saat dilimi **bilinmiyor** olarak kalır. Reklamveren rekabeti organik SEO zorluğu değildir. Aynı kelimenin tekrarları ve `baskı`/`baski` varyantları toplanmaz.

Yalnızca proje yönergelerinde belirtilen `/brosur` ve `/el-ilani` başlangıçta ürünlere eşlenir; canlı doğrulama yapılmış sayılmaz. Diğer URL'ler uydurulmaz. Tarayıcı bir ürünün birebir klasör kimliğine sahip URL'sini 200 ve kendisine işaret eden canonical ile gördüğünde eşlemeyi kanıtla kaydeder. Farklı ürünler arasında canonical/URL birleştirme otomatik yapılmaz. Henüz eşlenmemiş ürünlerin kaynakları arşivlenir, arama performansı için karar verilmez.

## Yerelde çalıştırma

Gereksinimler: Node.js 24, Python 3.12 ve npm. Mevcut checkout kullanılabilir; worktree gerekmez.

```sh
npm ci --no-fund
python3 scripts/local_secrets.py
npm run db:migrate
npm run data:import
npm run dev
```

Giriş anahtarı yalnızca yerel, Git tarafından yok sayılan `.dev.vars` dosyasındadır. Geliştirici dosyayı kendi güvenli editöründe açabilir; anahtarları sohbet veya loglara yapıştırmayın. Oluşturucu var olan dosyayı değiştirmez. Google ayarlarının adları `.env.example` içindedir; Workers geliştirmesinde gerçek değerler `.dev.vars` içinde tutulur. `npm run data:import` tekrarlanabilir; özgün kaynaklara yazmaz. Ayrıntılı yerel aktarım çıktısı `.local/import.log` dosyasına gider.

```sh
npm run check
npm run test:e2e
```

`check`: Workers ve tarayıcı testlerinin tip kontrolü, Workers/D1 otomatik testleri, bütün kaynakların içe aktarımı ve şifreli yedek/geri dönüş Python testleri, gerçek Worker paketleme denetimi. `test:e2e`: gerçek yerel veritabanıyla Chromium'da masaüstü ve mobil giriş/panel/kaynak/soru/indirme/çıkış. Sistem Chromium'u varsayılan `/usr/bin/chromium`; farklı kurulumda `CHROMIUM_PATH` belirtin. CI Ubuntu Chrome yolunu kullanır. Tarayıcı testi için ilk veri aktarımı gereklidir.

## Mimari ve veri güvenilirliği

- `migrations/`: foreign key, benzersizlik, negatif/sınır değer ve değişmez snapshot kuralları. Şema kaynakları, sayfaları, Google ölçümlerini, görev/hata kayıtlarını, SEO hafızasını, analiz kanıtlarını ve öneri sonuçlarını ayırır.
- `scripts/import_keywords.py`: standart Python ile salt okunur kaynak denetimi ve D1 SQL üretimi. Her gözlem dosya hash'i, özgün hücreler ve satır numarasıyla izlenebilir.
- `src/google.ts`, `security.ts`: salt okunur OAuth kapsamları, tek kullanımlık state, HttpOnly/Secure oturum, kaynak denetimi, giriş deneme sınırı ve AES-256-GCM token şifreleme. GA4 kapsamı yalnızca GA4 yapılandırılmışsa istenir. Ads kapsamı ayrıca açıkça etkinleştirilmelidir. Token ve API hata gövdeleri loglanmaz.
- `src/providers.ts`, `sync.ts`: GSC tarih/sayfa/sorgu/ülke/cihaz ve GA4 Organic Search şehir/cihaz/açılış sayfası adaptörleri. Sorgu ve sayfa toplamları ayrı tutulur; GA4 dönüşüm tanımları doğrulanmadığından key events **null** kalır. Sayfalama, veri tipi, tarih, metrik tutarlılığı ve kapsam denetlenir.
- `src/crawler.ts`: robots önceliği, siteye özel istek aralığı, sitemap ve dahili bağlantı keşfi. Başlık, meta açıklama, H1–H6, canonical, robots, X-Robots-Tag, hreflang, JSON-LD, görsel alt metni, iç bağlantılar ve statik içerik hash'i saklanır. Ağ/yönlendirme güvenliği için yalnızca `https://mavibasim.com` hedeflenir; başka alan adına veya özel IP'ye gidilmez. Yönlendirme hedefi ayrı kuyruğa alınır.
- `src/analysis.ts`, `validation.ts`: belirlenimci motor ve bağımsız SQL hesap kontrolü. Kanıtsız, yarım, eski veya sayfa/sorgu kapsamı eksik veride karar durur. Her rapor motor sürümü, kaynak veri kümesi, tarih, URL, cihaz, filtre ve formülle saklanır. Yeni veri veya başarısız sağlık kontrolü rapor önbelleğini geçersiz kılar.
- `src/outcomes.ts`: uygulama beyanını eski/yeni değerlerle kaydeder; 7/28/60/90 gün sonra tam günlük kapsam varsa hedefi diğer sayfalarla karşılaştırır. Uygulama günü ve Google gecikmesi dışarıda tutulur. Kullanıcı beyanı doğrulanmış CMS yayın kaydı sayılmaz. Sonuç nedensellik iddiası içermez.
- `src/questions.ts`, `public/`: veritabanı sonuçlarına dayalı Türkçe ürün, cihaz, şehir ve koruma soruları. Sayısal değer üreten LLM yoktur. Serbest biçimli bütün Türkçe soruları anlama iddiası yoktur.

## Karar kuralları

Önceki ay, önceki 3/6/12 ay ve geçen yılın aynı ayı veri kapsamı ayrı denetlenir. Eksik geçmiş dönemler **complete=false** ve **null** olarak raporlanır. Gün sayıları ve günlük ortalamalar görünürdür. GSC günleri Pasifik, GA4 günleri mülk saat dilimindedir; eşdeğer metrik gibi birleştirilmez.

Tam dönem, en az üç günlük kesinleşme bekleme süresi, taze GSC doğrulaması (72 saat), sorgu kapsamı ve her iki dönemde gözlenen ürün sayfası gereklidir. Google bağlantı/sağlık sorunu varsa karar verilmez. GSC anonimleştirme ve üst satır sınırı nedeniyle görünür sorgular tüm sorgular değildir; kayıp sorgu **null** kalır.

Başlangıç eşikleri denetlenebilir muhafazakâr kurallardır; istatistiksel anlamlılık veya neden kanıtı değildir: 30 ve en az %20 tıklama kaybı veya 300 ve en az %30 gösterim kaybı **İncele**; 100 gösterimin altı **Veri bekle**. 2→1 tıklama krize dönüşmez. CTR düşüşü artan gösterimle birlikte tek başına başarısızlık değildir. Mobil kayıp toplam masaüstü artışıyla gizlenmez. İyi performans veren veya geçmişte güçlü olup güncel sorgu kaydı eksik kelimeler korunur.

**İyileştir** durumu şemada desteklenir; bu sürüm yeterli teknik/niyet kanıtı olmayan başlık, URL veya içerik değişikliği önermek yerine **İncele** üretir. Noindex veya farklı canonical tek başına otomatik düzeltme gerekçesi sayılmaz.

## Otomatik çalışma ve günlük denetim

`wrangler.jsonc` 15 dakikalık Cron içerir; `AUTOMATION_ENABLED=false` varsayılanıyla hiçbir toplama görevi çalışmaz. Gerçek üretim dosyasında otomasyon açıktır. `CATCHUP_ENABLED=true` iken eksik son üç kapanmış ay için Cron dakikalı çalışır; kapsam tamamlanınca veri işleme otomatik 15 dakikaya düşer. Günlük yazma bütçesi bittiğinde yeni Google işi alınmaz ve sonraki UTC gününde devam edilir; Cron tanımı dakikalı kalır. **Cloudflare'a dağıtılınca** bilgisayar kapalıyken çalışır; yerel geliştirmede zamanlayıcı kendiliğinden tetiklenmez. Günlük tekilleştirilmiş planlama:

1. Son kesinleşmiş günler yeniden uzlaştırılır. İlk geçmiş aktarımı her gün en fazla 90 günlük yeni görev ekleyerek 400 güne kadar ilerler; ücretsiz bütçe için istekler parçalara ayrılır.
2. Her işte en fazla 200 Google satırı alınır. Veriler yeni veri kümesine yazılır; son sayfa ve satır sayısı doğrulanmadan aktif küme değiştirilmez. Hatalı veya eksik yeni aktarım eskisini bozmaz.
3. İş kiralama ve token kontrolü eşzamanlı tekrarları sınırlar. 429/5xx/ağ hataları jitter, Retry-After ve üstel beklemeyle yeniden denenir. Altı başarısız denemeden sonra blocked kalır; günlük planlayıcı kalıcı veri hatalarını veya tükenen tekrar bütçesini yeniden açmaz. Başarılı yeni OAuth onayı yalnız açık yetkilendirme hatalarını kurtarır. Diğer blocked işler kök neden giderildikten sonra açıkça onaylanmış, sınırlı operatör kurtarması gerektirir. Hata kodu, deneme, zaman ve imleç saklanır.
4. Her saatin `:45` dilimi taramaya ayrılır; her dört saatte bir sonuç ölçümü için ayrı dilim vardır. Uzun Google geçmiş aktarımı bu işleri süresiz bekletmez.
5. Panel tamamlanmış günlük kapsamı, gecikmeleri, kuyruğu ve bağlantı hatalarını gösterir. İlk geçmiş aktarımı tamamlanana kadar raporların beklemesi beklenen davranıştır.

Kaynak/istek sınırları: tek site, en az 5 saniye tarama aralığı (robots daha uzunsa o süre), 1.500.000 bayt sayfa, 2.000 URL/sitemap, 1.000 URL kuyruk, tur başına en fazla 20 yeni URL ve bağlantı derinliği 4. Sınırı aşan sitemap hata kaydına girer; kapsam tamamlandı denmez. JS render, gerçek cihaz hız ölçümü ve tüm sitemap boyutları bu sürümde desteklenmez. Veri saklama maliyeti için üretim büyüklüğünde ölçüm hâlâ gereklidir.

## Google bağlantısı — mevcut OAuth korunur

Sunucuda `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY`, `ADMIN_TOKEN` ayarlanır. Google Cloud'da Search Console API etkin ve OAuth yönlendirme URI'si tam eşleşmelidir; hesap GSC mülkünü okuyabilmelidir. Panelde bir kez Google bağlantısı verilir. GA4 için Data API ve sayısal `GA4_PROPERTY_ID` gerekir; sonradan eklendiyse kapsam için tekrar izin verilir. Kullanıcıdan günlük dosya veya komut istenmez.

Keyword Planner otomasyonu yalnızca `ENABLE_GOOGLE_ADS=true`, geçerli ve o tarihte desteklenen `GOOGLE_ADS_API_VERSION`, Ads müşteri kimliği, onaylı developer token ve uygun OAuth/hesap erişimiyle açılır. Adaptör yalnızca geçmiş metrik okuma çağrısı yapar; kampanya oluşturmaz. TR/Türkçe/Google Search kapsamını CSV'nin bilinmeyen kapsamına eşdeğer saymaz. Google'ın `closeVariants` birleştirmesi özgün yanıtla saklanır, tekrar toplanmaz. Bu erişim mevcut olmadığından otomatik yeni Planner verisi çekildiği iddia edilmez.

## Dağıtım, ücretsiz kullanım ve yetkiler

Mevcut üretim D1 kimliği ve ayrı `workers.dev` hedefi yapılandırılmıştır; yeniden D1 oluşturmayın veya kaynakları tekrar içe aktarmayın. Canlı `mavibasim.com` için route tanımlanmaz. Kontrollü kod yayını `.github/workflows/production.yml` ile mevcut Worker, D1 ve secret binding isimlerini doğrular; şema veya secret değiştirmez. Doğrulanmayan yayın önceki Worker sürümüne ve Cron ayarına döner. Migration/ilk kaynak aktarımı adımları yalnız yeni bağımsız kurulum içindir. Mevcut gerçek D1 ve Google secret'larını yeniden oluşturmayın; mevcut kullanıcıdan günlük komut veya dosya istenmez. Gerçek aylık rapor ve uzak geri dönüş kabulünün eksikleri TODO'da kayıtlıdır.

Ücretsiz plan seçimi, mevcut D1 depolaması/satır okuma-yazma, Workers CPU/istek ve GitHub Actions dakika/artifact kullanımı hesap panelinden doğrulanmalıdır. Cloudflare doküman sitesine 403 alınsa da resmi doküman GitHub deposundan Free sınırları doğrulandı; kesin kaynak commit'i ve limitler üretim yönergesindedir. Gerçek hesap D1 okuma/yazma ölçümleri GSC_PRODUCTION_REPORT.md içindedir. Tam üretim geçmişiyle CPU/depolama ve aylık rapor kabulü henüz tamamlanmadı. Kod ücretli planı açmaz veya kota artışı satın almaz. CI tek Linux işi, iptal edilebilir eşzamanlılık, 12 dakika üst sınır ve matris kullanmadan çalışır. Yedek işi 8 dakika sınırı ve 7 gün saklama kullanır; bunlar sınırsız ücretsiz kullanım garantisi değildir.

Gerekli ağ hedefleri: `mavibasim.com`, `accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com`, isteğe bağlı `analyticsdata.googleapis.com`, `googleads.googleapis.com`; dağıtım/yedek için Cloudflare API. Önceki 403 engelinin ardından bu oturumda dürüst bot kimliğiyle robots/sitemap ve iki gerçek ürün sayfası 200 doğrulandı; güvenlik veya TLS denetimleri kapatılmadı. Güvenlik kontrolleri veya TLS doğrulaması kapatılmadı.

## Yedek ve geri dönüş

Yerel doğrulama bütün 29 ürün / 521 dosya / 9.075 satırı ayrı geçici SQLite'a geri yükler. Arşiv gzip + AES-256-GCM ile kimliği doğrulanarak şifrelenir; yanlış anahtar ve bozulma reddedilir. Yedek anahtarı OAuth şifreleme anahtarından ayrı, 32 bayt base64 olmalıdır; yedeklerle aynı yerde tutulmamalıdır.

```sh
node scripts/run.mjs wrangler d1 export seo --local --output .local/backup.sql
# BACKUP_ENCRYPTION_KEY güvenli süreç ortamında sağlanmış olmalı; değerini komuta yazmayın.
node scripts/backup.mjs encrypt .local/backup.sql .local/backup.mavi
node scripts/backup.mjs decrypt .local/backup.mavi .local/restore.sql
python3 scripts/verify_restore.py --sql .local/restore.sql
```

Şifreleme aracı mevcut çıktı dosyasının üzerine yazmaz. Gerçek felaket kurtarmada önce ayrı D1'e geri yükleyip ilişki, satır sayıları, OAuth anahtarı ve uygulama kabulünü doğrulayın; mevcut üretim veritabanını doğrudan ezmeyin. Anahtar kaybolursa şifreli token/yedek çözülemez; Google yeniden bağlama ve saklanan bağımsız anahtar gerekir.

`.github/workflows/backup.yml` günlük uzak D1 export, şifreleme, ayrı SQLite'a geri yükleme denetimi ve yalnızca şifreli artifact saklama işini içerir. `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, ayrı `BACKUP_ENCRYPTION_KEY` ve gerçek D1 kimliği olmadan **yedek alınmadı** bildirip atlar. Zamanlanmış yedek ayrıca `PRODUCTION_BACKUPS_ENABLED=true` depo değişkeni gerektirir; ilk manuel geri yükleme kabulünden sonra açılır. Otomatik üretim yedeklemesi henüz etkin değildir. Açık SQL, kullanıcı analizleri ve token'lar Git'e yüklenmez. Bağımsız ikinci yedek hedefi ve saklama politikası üretim öncesi belirlenmelidir.

## API ve devam kaydı

`/api/health` yalnızca servis durumunu açığa çıkarır. Diğer bütün veri endpoint'leri oturum veya Bearer yönetici anahtarı ister: `/api/report`, `/api/status`, `/api/questions`, `/api/keywords`, `/api/history`, `/api/inventory`, `/api/applied-changes`, `/api/outcomes`, `/api/export`. Değiştiren tarayıcı istekleri aynı origin kontrolüne tabidir. OAuth callback tek kullanımlık state ve ayrı HttpOnly cookie gerektirir. Kullanıcı soru ve performans verileri herkese açık endpoint'lerde bulunmaz.

`/api/applied-changes` yalnızca geçmişte uygulanmış değişikliğin beyanını ve kanıtını kaydeder; site/CMS değiştirmez. Snapshot farkları için kesin yayın zamanı bilinmiyorsa `published_at=null`, `observed_from` ve `observed_to` kullanılır.

Testler, gerçek entegrasyon engelleri ve sonraki somut işler [TODO.md](TODO.md) dosyasındadır. İlk uygulama PR #1 ile main dalına birleştirildi; sonraki denetim düzeltmeleri ayrı PR ile sunulur. Oturumun kendiliğinden yeniden başlatılacağına dair garanti yoktur.

Bağımsız kota yenileme ve kontrollü kurulum: [Cloudflare gözlemcisi](docs/INDEPENDENT_QUOTA_OBSERVER.md). Runtime yalnız ayrı Analytics:Read secret’ı kullanır; ana Worker yeniden yayımlanmaz.
