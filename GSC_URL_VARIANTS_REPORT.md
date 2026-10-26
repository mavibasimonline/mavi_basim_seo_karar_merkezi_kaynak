# GSC URL varyantları ve blocked iş karantinası

**Gerçek üretim kabulü tamamlandı — 26 Ekim 21.01 Türkiye:** PR #24 main `cb8062d` ve Worker `da882c4b-9702-46d6-a89c-785f3c3cc4b9`/v2 ile yayımlandı. İki 18 Ağustos işi birer kez kurtarıldı, doğal Cron'da done/error=null oldu. Kapsam 105/184, 79 eksik; güncel kota ve gerçek kanıtlar [GSC_PR24_PRODUCTION_REPORT.md](GSC_PR24_PRODUCTION_REPORT.md). Aşağıdaki hazırlık/yayın bekleme kayıtları tarihçedir.

26 Ekim 2026, Türkiye saati. Dal: `fix/gsc-owned-url-variants`, taban main `5f04525975e2c255151c4a4158cf9cf031d07679`, kaynak düzeltmesi `9f4283f`. [PR #24](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/pull/24) açık ve main ile çakışmasız; tam HEAD CI sonucu PR kontrol kaydında izlenir. Bu değişiklik üretime yayımlanmadı; gerçek iki iş yeniden kuyruğa alınmadı.

**Yeni kullanıcı onayı alındı:** PR #24 main birleştirmesi, kontrollü yayın ve yalnız iki eski işin birer kez doğal Cron'a bırakılması açıkça onaylandı. Yeni migration yasağına uymak için mevcut production workflow'undaki `migrations apply`, altı mevcut şema kaydını yerel manifest ile karşılaştıran tek salt okunur SELECT'e dönüştürüldü. Eksik/fazla/tekrarlı/bozuk şema varsa yayın durur; otomatik şema uygulaması artık yoktur. Diğer sürüm/CI/kota/binding/smoke/rollback kapıları korunur. Bu ek güvenlik düzeltmesi de aynı PR'da CI'dan geçmeden birleştirilmeyecek.

**20.09 Türkiye taze kota kontrolü:** [40365938792](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/actions/runs/40365938792) başarılı: hesap 601.207 okuma / 22.463 yazma, analitik 20.00'a kadar, mode=open ve izin 21.24'e kadar. Yerel defter 436.750 okuma / 11.962 yazma. Mevcut kabul 229 satır okudu; tek kota kaydı güncellendi. GSC aktarımı/tarama tetiklenmedi. Yayın sırasında taze kontrol yeniden zorunludur.

## Gerçek hata ve kök neden

PR #23'ün onaylı tanılama yayını 10.19'da tamamlandı. İki 18 Ağustos işi yalnız birer kez yeniden açıldı; doğal Cron sayfa işini 10.30, sorgu işini 11.00'de `INVALID_GSC_ROW_PAGE_WWW` ile durdurdu. Kanıt: Actions [40286263327](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/actions/runs/40286263327), [40289393422](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/actions/runs/40289393422).

GSC aktarımı, ağ tarayıcısının yalnız HTTPS/apex kabul eden `siteURL` doğrulamasını kullanıyordu. Gerçek üretim mülkü `sc-domain:mavibasim.com`; bu mülkün sahip olunan www/protokol gözlemleri tarama hedefleriyle aynı şey değildir. Eski kod ayrıca her yeni UTC gününde blocked işleri sıfırlıyor, OAuth callback'i de tüm blocked Google işlerini açabiliyordu. Böylece kalıcı veri hatası veya tükenmiş tekrar bütçesi ertesi gün yeniden denenebiliyordu.

Tanılama yalnız host kategorisini kanıtlar; gerçek satırın HTTP/HTTPS protokolü, canonical eşitliği veya diğer metriklerinin doğruluğu bilinmiyor. Bu düzeltmenin gerçek iki işi başarıyla tamamladığı henüz iddia edilemez.

## Kod düzeltmesi

- `src/urls.ts`: GSC gözlemleri için ayrı doğrulama. Domain mülkünde yalnız `mavibasim.com` / `www.mavibasim.com`, HTTP/HTTPS kabul edilir. Dış alan adı, başka alt alan adı, benzer son ek, kullanıcı bilgisi, açık port, sondaki nokta, göreli adres, backslash ve kontrol/boşluk karakterleri reddedilir. URL-prefix mülkünde protokol, origin ve gerçek prefix sınırı ayrıca korunur. Crawler'ın `siteURL` kuralı değişmedi.
- `src/providers.ts`: Ham URL önce gerçek mülk kapsamıyla doğrulanır. Eski HTTPS/apex normalleştirmesi staging/cursor uyumluluğu için korunur; yeni www/http gözlemleri ayrı kimlikle saklanır. Otomatik host/canonical birleştirmesi, ürün eşlemesi veya satır atlama yoktur. Sayı/CTR/ülke/cihaz/sorgu denetimleri sürer. Veri kümesi notu mülk ve varyant sınırını gösterir.
- `src/performance.ts`, `src/data-integrity.ts`: Mevcut sorgular aynı sabit sahiplik kuralıyla www/http gözlemlerini denetler. Yeni D1 sorgusu eklenmedi; geçerli satırlar yanlışlıkla bozuk sayılmaz, yabancı URL geçerli sayılmaz. Ürün ölçümü için mevcut doğrulanmış alias kanıtı gerekir; sırf host benziyor diye başarılı ürüne veri taşınmaz.
- `src/sync.ts`: Otomatik blocked reset kaldırıldı. Cursor, generation, attempts ve hata geçmişi korunur. Retry/backoff ve başarılı yakın günlerin uzlaştırılması sürer; altı denemede duran geçici hata da yeni günde kontrolsüz açılmaz.
- `src/google.ts`: Başarılı yeni OAuth onayı yalnız açık yetkilendirme hata kategorilerini kurtarır. Veri hataları ve tükenmiş geçici hatalar açılmaz. Token, kapsam, state/cookie/şifreleme akışı değiştirilmedi; mevcut gerçek bağlantıya dokunulmadı.
- `src/index.ts`: Sağlık kimliği `owned-url-variants-v2`; okuma koruması sürümü değişmedi.
- `scripts/gsc_row_recovery.py`: Yalnız gelecekte ayrıca onaylanmış kurtarma için hazırlandı, çalıştırılmadı. Tam canlı SHA ve v2 kimliği, taze hesap/yerel kota, iki sabit 18 Ağustos kimliği, lease yokluğu ve yalnız eski URL hata kategorileri zorunlu. Genel/metrik/mülk kapsamı hataları uygun değildir. Yeni v2 bu eski URL kodlarını üretmediğinden ikinci başarısızlık tekrar açılamaz; cursor/generation/attempts korunur. Betik Google aktarımı başlatmaz; uygun iş doğal 15 dakikalık Cron'u bekler.

## Test ve inceleme

- Workers/D1: **434/434 başarılı**. Sahiplik/prefix saldırı matrisi; bağımsız gerçek SQLite/D1 SQL doğrulaması; 200 satırlık eski staging'den devam; yabancı satırda eski aktif kapsamı koruma; ağırlıklı konum/CTR; doğrulanmamış alias; tarama sınırı; çok günlü karantina ve OAuth regresyonları.
- Python: **121/121 başarılı**. İlgili kurtarma testleri 13/13; gerçek SQLite ile kimlik/kategori/lease/kota/idempotence sınırları; 521 CSV ve 9.075 satırın tamamı; yedek/geri dönüş, migration ve yayın korumaları. Ek 9 test otomatik migration yerine salt okunur şema doğrulamasını sınar.
- Chromium masaüstü/mobil: **34/34 başarılı**; giriş, gerçek yerel API'ler, veri yokluğu, korunan ay çubuğu/tablo/filtreler ve erişilebilirlik dahil. Toplam **589/589** otomatik test başarılı. Uzak CI tam HEAD sonucu PR'da ayrıca izlenir.
- TypeScript, Worker build, ayrı üretim dry-run, gizli değer/kaynak kontrolü ve `npm audit` başarılı (0 açık).
- Karantina regresyonu eski main üzerinde 13 testin 11'inde hatayı yeniden üretti; düzeltme sonrası tamamı geçti. İlk yeni entegrasyon fixture'ının kaydedilmemiş analiz kimliği FK hatası düzeltildi. Yanıt vermeyen eski yerel geliştirme sunucusu nedeniyle ilk tarayıcı koşusu durduruldu; temiz yerel Worker ile yeniden başlatıldı. Bunlar üretim GSC sonucu değildir.
- Bağımsız kod incelemesinde somut güvenlik veya regresyon açığı bulunmadı. UI/public dosyaları, migration'lar, Cron/üretim yapılandırması, D1 bütçeleri ve CSV'lerde main farkı yok.

## Yeni D1 sorgusu olmadan gerçek durum

İlk PR hazırlığında yalnız mevcut Actions kayıtları/artifact'ları ve D1 kullanmayan açık `/api/health` okundu. Sonraki açık kullanıcı yayın onayıyla yukarıdaki taze kota gözlemcisi çalıştırıldı. Henüz Google isteği, requeue, tarama, migration veya dağıtım başlatılmadı.

Son tam kapsam kanıtı **26 Ekim 11.01 Türkiye**, Actions 40289393422:

| Dönem | Sayfa | Sorgu | Toplam |
|---|---:|---:|---:|
| Temmuz | 0/31 | 0/31 | 0/62 |
| Ağustos | 19/31 | 19/31 | 38/62 |
| Eylül | 30/30 | 30/30 | 60/60 |
| **Toplam** | **49/92** | **49/92** | **98/184 (%53,26)** |

**86 birim eksik:** Temmuz'un tamamı, Ağustos 1–11 ve 18, iki scope. Birim gün × scope; anonimleştirilmiş tüm sorguların bulunduğu anlamına gelmez. İki işin son doğrulanmış durumu blocked, attempts=2; cursor 0/200. Sonraki gerçek kapsam bu eski kayıttan çıkarılamaz.

Son mevcut zamanlanmış kota kaydı [40325390216](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/actions/runs/40325390216), **15.48 Türkiye**: gecikmeli hesap analitiği 590.790 okuma / 21.654 yazma; o anda mode=open, yerel defter 424.669 okuma / 10.431 yazma. Mevcut kabul 227 satır okumuş, indeks planı ve gerçek Cron ilerlemesi başarılı; 11.15'te 89, 11.30'da 200 satırlık doğal Cron kaydı var. Bunlar gün/scope belirtmediği için 98/184'e eklenmez. Kota izni **17.03'te sona ermiştir**; bu kayıt güncel yayın veya aktarım izni değildir.

Bu turdaki açık HTTP kontrolünde canlı Worker hâlâ **7a51b63e-51e7-4334-9afb-1e56d1ce0aa0**, commit **5f045259**, `field-reasons-v1`. Yeni düzeltme henüz canlı değildir.

## Yayın öncesi kalan kapılar

1. Ayrı PR'ın tam HEAD CI'si ve korunan kaynak/dry-run kontrolleri başarılı olmalı.
2. Kullanıcının istediği **yeni, ayrı yayın onayı alındı**. Yeni şema güvenlik düzenlemesinin son HEAD CI'si ve güncel kota/sürüm kapıları da başarılı olmadan main birleştirmesi veya production workflow başlatılmayacak.
3. Onay sonrası main tam SHA CI, gerçek eski Worker UUID/binding/secret koruması ve **taze** hesap/yerel kota yeniden doğrulanmalı; eski kota kaydı kullanılamaz. Şema değişikliği yok; yeni migration gerekmiyor. Mevcut rollback ve smoke kapıları korunur.
4. Yeni Worker'ın tam SHA/v2 kimliği canlı doğrulanmadan iki iş açılmayacak. İş kurtarma ayrıca açıkça onaylanmalı; yalnız iki eski URL hatası bir kez ve doğal Cron üzerinden. Yeni hata varsa durdurulup sabit güvenli kategori incelenmeli.
5. Gerçek yeni kapsam ve aylık rapor kabulü henüz tamamlanmadı. Ek D1 gözlemi gerekirse önce mevcut sınırlı sorguların planı/maliyeti ve taze kota değerlendirilir; toplu yeniden aktarım yapılmaz.

Ücretli hizmet açılmadı; mavibasim.com içeriği, gerçek D1 verileri, OAuth bağlantısı, arayüz ve 521 özgün CSV korundu.
