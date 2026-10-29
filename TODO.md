# 29 Ekim 2026 — bağımsız Cloudflare kota gözlemcisi

PR #29 yalnız bağımsız gözlemci ve kontrollü yayın kapsamına indirildi; ilgisiz kuyruk incelemesi çıkarıldı. Ana uygulama, veriler, OAuth, Cron ve bütçe limitleri korunur. Kurulumdan önce ayrı `CF_QUOTA_ANALYTICS_TOKEN` Actions secret’ı ve CI dağıtım kimliğinde yalnız Billing:Read erişimi gerekiyor. Bunlar gerçek ön kontrolde eksik; yayın başlatılmadı. Son tam SHA CI’si, ücretsiz plan ve gerçek scheduled kabulü yayın kapısıdır. Ayrıntılar: [kontrollü kurulum](docs/INDEPENDENT_QUOTA_OBSERVER.md).

---

# 26 Ekim 2026 — sahip olunan GSC URL'leri ve kalıcı iş karantinası

- **Yeni açık yetki:** kullanıcı PR #24 birleştirme/kontrollü yayın ve iki 18 Ağustos işinin birer kez doğal Cron'a bırakılmasını onayladı. Yeni migration/toplu aktarım yasak. Bu nedenle production workflow'un otomatik migration uygulaması, mevcut altı şema adını tek SELECT ile doğrulayan fail-closed kontrole çevrildi; 9 yeni test dahil Python **121/121**, toplam yerel **589 test** başarılı. Son tam HEAD CI'si beklenir; eski 580 testli CI yeni commit için izin değildir.
- **20.09 Türkiye:** güncel kota workflow **40365938792 SUCCESS**, 601.207 hesap okuması / 22.463 yazma; analitik 20.00'a kadar, mode=open, lease 21.24'e kadar. Yerel defter 436.750/11.962. Kabul 229 okuma + tek kota kaydı; Google/tarama başlamadı. Main/canlı Worker henüz değişmedi. Sıradaki somut adım yeni tam HEAD CI → aynı PR merge/main CI → migration çalıştırmayan kontrollü yayın → canlı v2/tam SHA → sadece iki eski URL hatasının bir defalık kurtarması ve Cron kanıtı.

- **Mevcut görev:** `fix/gsc-owned-url-variants`, taban main `5f045259`; kaynak düzeltmesi `9f4283f`, [PR #24](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/pull/24) açık ve birleştirilmemiş. Son belge commit'i `git log -1 --oneline`; tam HEAD CI sonucu PR'da izlenir. Ayrıntılar [GSC_URL_VARIANTS_REPORT.md](GSC_URL_VARIANTS_REPORT.md). Aşağıdaki PR #23 onay bekliyor kayıtları tarihçedir: PR #23 birleştirildi ve 10.19 Türkiye'de yayımlandı.
- [x] Gerçek iki 18 Ağustos işinin tek tanılama denemesi, `INVALID_GSC_ROW_PAGE_WWW` nedenini kanıtladı. Yeni kod yalnız sahip olunan apex/www HTTP/HTTPS GSC gözlemlerini gerçek mülk kapsamıyla kabul ediyor; başka alan adları reddediliyor. Tarama allowlist'i, eski staging kimliği ve ayrı URL kanıtı korunuyor.
- [x] Günlük planlayıcının tüm blocked işleri sıfırlaması kaldırıldı. OAuth onayı yalnız açık yetkilendirme hatalarını kurtarıyor; kalıcı veri hataları ve tükenen tekrarlar korunuyor. Gelecekte ayrıca onaylı iki-iş kurtarma aracı v2/tam SHA/taze kota kapılarıyla hazır; **çalıştırılmadı**.
- [x] **434 Workers/D1 + 112 Python + 34 Chromium = 580 başarılı** yerel test. Eski main üzerinde 11 karantina regresyonu yeniden üretildi; düzeltmeyle geçti. İlk entegrasyon fixture FK sorunu giderildi; yanıt vermeyen eski yerel sunucu kapatılıp tarayıcı testleri temiz Worker'da geçti. Son başarısız/atlanmış test yok. Type/build/üretim dry-run, audit 0, kaynak/secret denetimi başarılı.
- [x] Bu görevde yeni uzaktan D1 sorgusu, Google isteği, requeue, tarama, migration veya yayın yok. Mevcut UI/public, D1 kota kodu, 15 dakikalık Cron, deploy yapılandırması, 29 ürün ve 521 CSV/9.075 kaynak satırı main'e göre korunuyor. Gerçek OAuth bağlantısı değiştirilmedi.
- **Son doğrulanmış tam kapsam:** 11.01 Türkiye, Actions **40289393422**, **98/184 (%53,26), 86 eksik**. Temmuz 0/62, Ağustos 38/62, Eylül 60/60. İki iş blocked/attempts=2, cursor 0/200. Bu sayılar şu anın yeni ölçümü değildir.
- **En yeni mevcut kota artifact'ı:** 15.48 Türkiye, Actions **40325390216**: 590.790 hesap okuması / 21.654 yazma; o an güvenli, kabul 227 okuma. İzindeki sonraki Cron satır sayıları yeni kapsam hesabı için yeterli değil. Kota izni 17.03'te bitti; güncel izin diye kullanma. Açık HTTP kontrolünde canlı sürüm hâlâ `7a51b63e-51e7-4334-9afb-1e56d1ce0aa0` / main `5f045259`, yeni v2 henüz canlı değil.
- [ ] **Bir sonraki somut adım:** PR tam HEAD CI → kullanıcıdan istenen ayrı yeni yayın onayı → main CI ve taze kota/binding/sürüm kapıları → kontrollü yayın/smoke. Bu PR birleştirilmedi, yayımlanmadı. Şema değişikliği yok, yeni migration gerekmiyor. İki gerçek işi açmak ayrıca açık onay gerektirir; yayımdan sonra bile kendiliğinden açılmaz. Toplu aktarım veya sınırsız tekrar yok.
- [ ] Yeni gerçek kapsam ve aylık rapor kabulü, kalan kaynak/tarama kabulü ve bağımsız uzak yedek kabulü henüz tamamlanmış sayılmaz. Bu düzeltme için yeni token, OAuth onayı veya ücretli plan gerekmiyor; yalnız kullanıcı talimatındaki yeni yayın yetkisi bekleniyor.

---

# Önceki kontrol noktaları

# 26 Ekim 2026 — GSC iki hata: yayın onayı engeli ve devam kaydı

- Son kaynak commit'i `a72e7fa`; [PR #23](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/pull/23) açık/birleştirilmemiş. Tam kaynak HEAD CI **40282140567 SUCCESS**: **348 Workers/D1 + 104 Python + 34 Chromium = 486 test**, audit/type/build/üretim dry-run/kaynak koruma başarılı. Bu belgeyi içeren son commit ve CI PR'da ayrıca izlenir.
- Son sınırlı gerçek inceleme **40282015379**, 09.48 Türkiye: **97/184 (%52,72) tamamlandı, 87 eksik**; 09.15'teki 96'ya göre +1. Temmuz 0/62, Ağustos 37/62 (19 sayfa, 18 sorgu günü), Eylül 60/60. İşlem **574 D1 satırı okudu, 0 yazdı, Google aktarımı başlatmadı**.
- 18 Ağustos iki iş hâlâ legacy `INVALID_GSC_ROW` ile blocked; sayfa cursor 0, sorgu cursor 200. Hangi alanın reddedildiği eski kayıtta yok. Gerçek kök neden veya çözüm iddia edilmez; doğrulama koşullarını değiştirmeyen alan tanılaması hazır.
- Otomatik onay denetimi PR #23 main birleştirmesini reddetti: bu PR özelinde açık merge/yayın onayı olmadığını, ana dal ve olası üretim otomasyonunun değişeceğini belirtti. Reddedilen işlem başka API/araç/dolaylı dağıtımla denenmedi. **Main ve canlı Worker f96f184 / d2b8f1dc-0c49-40d0-886c-da18948868d6 olarak korundu.**
- Gerekli tek sonraki kullanıcı yetkisi: **PR #23'ü main'e birleştirme ve mevcut güvenli workflow'la sınırlı tanılama kodunu yayımlama onayı**. Yeni token, Google OAuth veya ücretli plan gerekmez.
- Yetki sonrası: PR'ın tam güncel CI'sini ve main CI'yı doğrula → gerçek Worker UUID/kota/binding korumalarıyla kontrollü yayın → main tam SHA ile `gsc-row-requeue` işlemini bir kez çalıştır → doğal Cron sonucunu `gsc-row-inspect` ile oku → yalnız gerçek alan kanıtına göre düzeltme/test/yayın. Yeni sınıflandırılmış hatalar aynı kurtarma işlemiyle tekrar açılamaz; cursor/generation/attempts korunur. Toplu aktarım/migration yok.
- Mevcut Cron 15 dakikada bir; sıradaki planlı slot 26 Ekim 10.00 Türkiye, gerçek çalışma güncel kota izni ve sağlayıcı zamanlamasına bağlı. Bu slot blocked iki işi kendiliğinden çözer diye gösterilmez. Saatlik kota izni geçerliliği eski gözlemde 10.19 Türkiye'ye kadardı; sonraki izni güncel gerçek gözlemle doğrula, korumayı kaldırma.
- Üretim kaynakları 29 ürün / 521 CSV / 9.075 satır; UI, OAuth, D1 bütçeleri ve Cron değişmedi. Uygulama tam geçmiş/aylık kabulü henüz tamamlanmadı.

---

# 26 Ekim 2026 — 18 Ağustos GSC doğrulama incelemesi

- Gerçek 09.15 Türkiye üretim kontrolü: main `f96f184`, Worker `d2b8f1dc-0c49-40d0-886c-da18948868d6`, PR #21/#22 arayüz/kota koruması canlı; kaynaklar 29/521/9.075.
- Temmuz–Eylül 96/184 (%52,17), kalan 88 gün/scope. 18 Ağustos sayfa/sorgu işleri `INVALID_GSC_ROW` hatasında; eski kod hangi alanın reddedildiğini kaydetmemiş. Gerçek neden henüz bilinmiyor.
- Alan kategorisi tanılaması hazır; doğrulama koşulları gevşetilmedi. Ham URL/sorgu/metrik/secret kaydı yok. Yerel **348 Workers + 104 Python = 452** test ve paketleme başarılı. İlk sandbox denemesi yerel socket izni nedeniyle test başlatamadı; izinli tekrar başarılı. Arayüz ve diğer kaynaklar değişmedi.
- `gsc-row-inspect` salt okunur, en çok 5.000 satır maliyet sınırıyla kapsam/iki iş/kota/son Cron kaydını kontrol eder. `gsc-row-requeue` yalnız yayımlanmış tam commit ve güncel güvenli hesap/yerel bütçeyle iki eski hatayı bir kez pending yapar. Cursor, generation, attempts ve hata geçmişini korur; Google isteği başlatmaz. Yeni alan koduyla tekrar başarısız olan işi tekrar açmaz.
- Sonraki adım: tam PR/main CI → mevcut kontrollü yayın → iki işin sınırlı yeniden kuyruğa alınması → doğal 15 dakikalık Cron'da gerçek alan nedenini gör → kanıt varsa düzeltme/test/yayın. Geçmiş veri kapsamı henüz tamamlandı veya hata çözüldü sayılmaz.
- OAuth, 15 dakikalık Cron, okuma/yazma korumaları, UI, D1 ve 521 CSV korunur. Yeni migration/toplu aktarım yok. Bu kontrol noktasının son commit'i `git log -1` ile izlenir.

---

# Üretim bekleme kontrolü — 25 Ekim 2026, main hazır

- [x] **PR #22 main'e birleşti:** `dcd4b493a7a2b4b361ee623384a7e10a6f887fff`. PR CI **40211912177**, main CI **40212255314 SUCCESS**; gerçek loglarda **334 Workers/D1 + 99 Python + 34 Chromium = 467 test**, audit 0 doğrulandı. PR #21/#20 de içerilen commit'leriyle birleşmiş durumdadır; arayüz/CSV kaynakları korundu. Son uygulama commit'i `a111835`; bu belge kontrol noktasının son commit'i `git log -1 --oneline` ile izlenir.
- [x] Hesap sahibi otomatik Cloudflare Git dağıtımını kapattığını bildirdi; tekrar kullanıcı işlemi/token gerekmiyor. API 403 nedeniyle ayarın kendisi bağımsız okunamadı. **Main birleşmesi sonrasında gerçek Worker hâlâ `2f502c68-76ae-48a7-b87a-5b7e45bf62e4`, commit null:** yeni sürüm yayımlanmadı, erken migration veya aktarım yapılmadı.
- [x] GitHub üzerinde production workflow **395288949**, saatlik quota workflow **396168026**, ikisi de **active** olarak doğrulandı. Main'de kayıtlı ilk kontrollü yayın denemesi **26 Ekim 2026 03.17 Türkiye**; en fazla altı deneme 05.47'ye kadar yarım saat arayla. Zamanlama gecikebilir. Her deneme tam main push CI, gerçek Worker UUID, UTC yenilenmesi, hesap kotası ve korunan D1/OAuth/binding kapılarına bağlıdır. Aynı commit tekrar yayımlanmaz; yayın varlığı gerçek kabul sayılmaz.
- [x] Main'deki gerçek bekleme provası **[40212297189](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/actions/runs/40212297189)** başarılı: artifact `updated=false`, `reason=WAIT_FOR_2026_10_26_UTC_RESET`, **`database_queries=0`**. Gerçek veri kabul adımı çalıştırılmadı; bu koşu kota yenilendi/Google verisi geldi anlamına gelmez.
- [ ] **Kalan tek üretim aşaması:** Kota yenilendikten sonraki production workflow'un tam commit/sürüm/binding/migration kabulünü ve ardından saatlik quota workflow'un gerçek `cron` kaynaklı, boş olmayan GSC aktarımı/okuma maliyeti kabulünü kontrol et. Gecikmiş/boş analitik veya başarısız CI durumunda yayımlama başlamaz. Bir sonraki gerçek hesap gözleminde tüketim tekrar doğrulanmalı; eksik Temmuz–Eylül verileri ayrıca bekler.

Kullanıcıdan şu anda ek işlem gerekmiyor. Yeni kod main'dedir; Worker'ın yeni sürümü ve gerçek üretim kabulü **henüz gerçekleşmedi**. Codex'in kendiliğinden yeniden başlama garantisi yoktur; kurulan GitHub Actions görevleri bağımsızdır. Ücretli hizmet, kaynak silme, OAuth değişimi veya mavibasim.com içerik değişikliği yapılmadı. Aşağıdaki kayıtlar tarihçedir.

---

# Hesap sahibi ayarı ve kota sonrası yayın — 25 Ekim 2026

- [x] Hesap sahibi bu konuşmada Worker'ın otomatik Git dağıtımını **kapattığını bildirdi**. Bu kullanıcı beyanıdır; Build tetikleyici API erişimi hâlâ 403 olduğundan ayarın API ile doğrulandığı söylenmez. Yeniden token/OAuth/onay istenmez.
- [x] Son uygulama/operasyon commit'i **`a1118355a2efe163ac54861574b95e022a7f79e5`**; yerel **334 Workers/D1 + 99 Python + 34 Chromium = 467 test** başarılı. Son belge commit'i `git log -1 --oneline` ile bulunur; uzak son CI PR #22'de izlenir. İlk yeni tarih sınırı testindeki sıralama hatası düzeltildi ve bütün kontroller tekrar geçti.
- [x] Mevcut kontrollü production workflow'una **yalnız 26 Ekim 2026** için denemeler eklendi: Türkiye **03.17, 03.47, 04.17, 04.47, 05.17, 05.47**. GitHub zamanlaması gecikebilir. Daha sonraki yıllarda bu olay yayını yapılmaz. Her deneme önce tam main commit'inin başarılı push CI'sini ve gerçek %100 Worker UUID'sini D1'e dokunmadan doğrular. Kota/rollback/migration/commit/guard kapıları aynen zorunludur. Aynı commit zaten yayımlandıysa tekrar yayınlamaz; bu durum üretim kabulü tamamlandı anlamına gelmez.
- [x] Saatlik kota gözlemcisi, UTC yenilenmesi ve gerçek Worker'daki **`read_guard_revision=d1-account-reads-v1`** doğrulanmadan D1'e erişmez. Henüz uygulanmamış migration tablolarını okumaz; açıkça bekleme kaydı üretir. Yayımdan sonra gerçek doğal Cron ve okuma maliyeti kabulü ayrıca çalışır.
- [ ] PR #22'nin son tam HEAD CI'sini doğrula, PR'ı main'e al ve main CI'yi doğrula. Kullanıcı beyanıyla Git otomatik yayın engeli giderildiğinden kod birleştirme şimdi yapılabilir; **Worker yayını/migration/yoğun D1 işlemi hâlâ kota yenilenmesine kadar yasaktır**. Main'de iş akışlarının etkin kaydını ve eski Worker sürümünün değişmediğini kontrol et.
- [ ] Kota sonrası kontrollü yayın ve gerçek GSC/Cron/okuma tüketimi kabulü **henüz gerçekleşmedi**. Kod, takvim veya test sonucu gerçek üretim başarısı sayılmaz. Ücretli plan, CSV değişikliği, veri silme veya yeniden Google yetkilendirmesi yoktur.

Kullanıcıdan şu anda başka işlem gerekmiyor. Bu bir GitHub Actions zamanlamasıdır; Codex oturumunun kendiliğinden yeniden başlayacağı garanti edilmez. Sonraki somut adım aşağıdaki genel talimatların üstünde yer alan bu kayda göre main CI ve zamanlanan yayın sonucunu kontrol etmektir.

---

# Acil D1 okuma kotası — 25 Ekim 2026 19.00 Türkiye kontrol noktası

**Sorun tamamen çözüldü sayılmaz; gerçek üretim kabulü bekliyor.** Dal `fix/d1-account-read-budget`, [PR #22](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/pull/22). Son uygulama commit'i **`7ec4f8ee3fcf8b291519248a4a6bb4f02f2abd4a`**, tam HEAD CI **[40209576264 — SUCCESS](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/actions/runs/40209576264)** (334 + 82 + 34 = 452 test); önceki temel uygulama `40967a7`; bu kaydı içeren son commit `git log -1 --oneline` ile bulunur. PR #21 / `d97c34b` bu dalın atasıdır; bütün arayüz ve tarayıcı test dosyaları birebir korunur.

## Tamamlananlar ve gerçek kanıt

- [x] Gerçek Cloudflare GraphQL sorgu analitiği alındı; D1 uygulama SQL'i çalıştırılmadı. 18.18 Türkiye: **5.065.792 okuma / 57.757 yazma**. Sorgu maliyetleri, tekrarlanan hesaplamalar ve indeks planları [D1_READ_QUOTA_INCIDENT.md](D1_READ_QUOTA_INCIDENT.md) içinde.
- [x] Üretim Cron'u API ile `* * * * *` → **`*/15 * * * *`** değiştirildi ve geri okunarak doğrulandı: Actions **40206287323**. D1, OAuth ve Worker kodu değişmedi.
- [x] Kök neden: bütçe/scheduler heartbeat'leri rapor önbelleğini geçersiz kılıyor; performans ve bağımsız doğrulamalar aynı kanıtı tekrar okuyordu. Kaynak revizyonuyla önbellek, eşzamanlı rapor paylaşımı, aktif kapsamdan sorgu, gerekli indeksler ve sınırlandırılmış toplulaştırma kodlandı.
- [x] Hesap geneli saatlik kota gözlemi, 75 dakikalık/UTC gece yarısıyla sınırlı izin, atomik yerel okuma/yazma rezervasyonu, gerçek D1 maliyet kaydı, eksik metadata/hata durumunda rezervasyonu koruma hazır. Üretimde bayrak eksik/false olsa da version binding korumayı zorunlu tutar. Worker'a Cloudflare API token'ı eklenmez.
- [x] Olay başına bir sağlayıcı sayfası; güncel/geçmiş dengesi, cursor/generation/retry ve 60.000 yazma koruması sürer. Eski dakika olayları DB/Google'a dokunmaz. Tarama yalnız son tamamlanmış GSC kümesini keşifte kullanır.
- [x] `0005` kontrol/indeks/önbellek, `0006` gerçek `cron` / `manual` / `legacy` ayrımı migration'ları; yerel veri bütünlüğü ve restore testleri. Üretimde uygulanmadı.
- [x] Yerel son kabul: **334 Workers/D1 + 82 Python + 34 Chromium = 452 başarılı test**; npm audit 0, tip/build/üretim dry-run/kaynak ve secret taraması başarılı. Son başarısız/atlanmış test yok. İlk geliştirme denemelerindeki kapasite/freshness/fixture hataları düzeltildi. Uzak kod CI **40209576264 SUCCESS**; ham CI logunda aynı 450 test doğrulandı. Bu belge kontrol noktası commit'i ve son CI PR'da izlenir.
- [x] 521 CSV / 9.075 satır / 29 ürün kaynak doğrulaması geçti; CSV'ler ve kaynak talimatları değiştirilmedi. Üretim /api/health 18.56 Türkiye: hâlâ **2f502c68-76ae-48a7-b87a-5b7e45bf62e4**, commit etiketi null. Bu yeni düzeltmenin canlı olduğu anlamına gelmez.

## Kalanlar — bağımlılık sırasıyla

1. **Hesap sahibi ayarı:** Cloudflare Worker `mavi-basim-seo-prod` → Settings → Builds içindeki otomatik Git yayını güvenlik kapısını atlayabiliyor. API denetimi **403** döndü (40208570579); bu ayarı erişimle kapattığımız iddia edilemez. Hesap sahibi otomatik Git dağıtımını kapatmalı veya bu ayar için mevcut otomasyonun dar yetkisini sağlamalı. Token/şifre sohbete istenmez; GSC OAuth'u yeniden kurmayın. Bu çözülmeden main birleştirilmez, PR #21 tek başına yayımlanmaz.
2. **26 Ekim 2026 03.00 Türkiye / 00.00 UTC sonrasında** gerçek günlük kotayı doğrula. Zaman gelmeden yoğun D1 sorgusu, migration veya yeniden aktarım yok. Boş/gecikmiş analitiği sıfır kullanım sayma.
3. PR #22'nin tam son HEAD CI'sini doğrula; PR #21'i içeren bu dalı main'e al, main CI'yi doğrula. Mevcut gerçek 100% Worker UUID'sini oku. Kontrollü production workflow, eski binding/secret'ları koruyarak migration + quota checkpoint + guard bayrakları + commit smoke yapar. Doğrulanamayan yayında Cron tutulur, eski Worker'a dönülür; kuyruk/veriler silinmez.
4. Doğal Cron'dan gerçek, boş olmayan GSC aktarımını ve `d1_query_costs`/defteri doğrula. Yeni salt okunur `scripts/d1_read_acceptance.py` gerçek indeks planı, hesap kotası, yerel maliyet ve **cron kaynağıyla** çalışmış aktarım olmadan geçmez. Pilot/test verisi kabul sayılmaz. Saatlik quota workflow main'e/yayına alınmadan etkin olduğu söylenmez.
5. Bir sonraki gerçek hesap gözleminde okuma/yazma değişimini kontrol et. Temmuz–Eylül tam kapsam/aylık rapor kabulü hâlâ bekler; bu kota düzeltmesi eksik Google günlerini tamamlamaz. 20.000 girdi satırını aşan geniş analizler kota için daha kısa kapsam gerektirir; bu sınır eksik GSC verisi veya SEO başarısızlığı diye gösterilmez.

Kota sıfırlama, defter silme, ücretli plan, yeni Google OAuth, kaynak aktarımı veya canlı mavibasim.com değişikliği yapılmadı. Sonraki oturumun kendiliğinden başlaması garanti edilmez. Aşağıdaki kayıtlar önceki aşamaların tarihçesidir.

---

# Ay çubuğu / ürün tablosu kontrol noktası — 25 Ekim 2026

- [x] Yıl/ay/dönem dengeli aralıklı; aylar 4–6 px boşluk, açık gri kenarlık, okunabilir 46/52 px eşit düğmeler. Seçili yazı #FFFFFF, opacity=1; hover/focus/active testleri geçti. Sadece ay alanı kayar; sabit cihaz/durum/MB kesilmez. Masaüstü 60 px, 640 px ve altı telefonda kontrollerin tamamını görünür tutan 104 px iki kompakt satır.
- [x] Ürün satırları 60 px, başlık 40 px; hücreler ortalı, küçük avatar/URL aralığı; masaüstünde arama/sıralama/gelişmiş filtre aynı alanda. Filtre-tablosu arası en fazla 10 px. Arama/sıralama/karar ve metrik sütun testleri başarılı.
- [x] **382 test:** 299 Workers/D1 + 49 Python + 34 Chromium; tip/build/production dry-run/release denetimi ve audit 0. İlk yeni tarayıcı koşusunda bir masaüstü senaryosu, yükleme sırasında ay düğmelerinin yeniden oluşturulması nedeniyle koptu; aynı yılda düğüm korunup seçim yerinde güncellenerek düzeltildi. Tam 34 test ve ek 8 sınır testi yeniden geçti.
- [ ] **Yeni düzeltme yayımlanmadı / main'e birleştirilmedi.** Mevcut güvenlik kapısı aşılmadı. Gerçek salt okunur tanılama **40199411351**, **25 Ekim 16:50 Türkiye**: hesap günlük D1 okuma **5.039.419**, yazma **57.754**; yayın güvenlik eşiği 4.000.000. Analytics gecikmeli olabilir. 29 ürün/521 CSV/9.075 satır ve dakikalı Cron yerinde; OAuth, senkron bütçesi ve mevcut üretim ayarları değişmedi.
- **Son commit/dal:** bu kaydı içeren `fix/month-states-and-table-density` git kaydı. Uygulama temeli main **9dbcafa**, önceki yayın kontrol noktası **52eb12f** bu dala dahildir. Uzak CI bu dalın PR'ında izlenir. Kaynak/code ve ekran kanıtı [MONTH_TABLE_DENSITY_REPORT.md](MONTH_TABLE_DENSITY_REPORT.md).
- **Bir sonraki somut adım:** **26 Ekim 2026 03:00 Türkiye / 00:00 UTC sonrasında** güncel kota ve gerçek Worker UUID'sini oku. Kapı uygunken başarılı PR CI ile main'e birleştir; main CI ve mevcut kontrollü production workflow'u ile yayınla, tam commit/Worker/binding/kaynak/hash ve canlı UI kabulünü tamamla. Main'e bağlı Git otomatik yayını bugünkü kapıyı aşmak için kullanılmadı. Kendiliğinden yeniden çalışma garantisi yok.
- **Yetki:** yeni kullanıcı anahtarı/token/onay veya ücretli plan gerekmiyor; günlük bütçenin yenilenmesi ve gerçek doğrulama gerekiyor. Mevcut kaynaklar, GSC/OAuth/D1/Cron/bütçe ve canlı mavibasim.com korunur. Önceki tarihli kontrol noktaları aşağıdadır.

---

# Yayın kontrol noktası — 25 Ekim 2026, 15:51 Türkiye

- [x] Uygulama kodu PR **#19** ile main'e birleşti: **9dbcafa5d634b1b80d2a78f1fa08b2fc6df687a4** (kaynak **cc1e87c**). PR CI **40194303362**, main CI **40194492122** başarılı; **374 test** geçti. Başarısız uygulama testi yok.
- [x] Cloudflare'ın mevcut Git otomatik yayını yeni arayüzü aldı. Canlı 12 dosyanın SHA-256 değeri main ile aynı. Masaüstü/mobil canlı giriş, WCAG/JS/taşma, kompakt çubuk ve özel API 401 kontrolleri başarılı. Özel üretim yönetici oturumu kullanılmadı.
- [ ] **Kontrollü tam yayın kabulü bekliyor:** production koşusu **40194725690** yayımlama öncesi durdu; Worker/D1/Cron/secret değiştirmedi. Gerçek tanılama **40194908709** günlük D1 okumayı **4.075.790** ölçtü; yayın güvenlik sınırı **4.000.000**, Free sert sınır **5.000.000**. Sınır gevşetilmedi. Canlı otomatik Git sürümü **2f502c68-76ae-48a7-b87a-5b7e45bf62e4** ve commit etiketi null; tam commit kabulü false. Başarısız olan uygulama testleri değil, yayın ön koşuludur.
- [x] Gerçek kaynaklar/binding'ler korunuyor: **29 ürün / 521 CSV / 9.075 satır**, mevcut D1/OAuth, dakikalı Cron, otomasyon/tarama etkin, Ads kapalı, senkron bütçesi 60.000. Canlı siteye yazma ve ücretli hizmet yok.
- **Son commit:** bu kontrol noktasını içeren `docs/compact-release-checkpoint` git kaydı; uygulamanın son main commit'i yukarıdadır. Bu belge dalı kota kapısı engelinden sonra main'in Git otomatik yayını yeniden tetiklenmemesi için birleştirilmez.
- **Bir sonraki somut adım:** **26 Ekim 2026 03:00 Türkiye / 00:00 UTC sonrasında** gerçek güncel kota ve Worker UUID'sini oku; güvenli kapı geçerse mevcut production workflow'u gerçek UUID ile çalıştır. Tam HTTP commit/sürüm, korunan D1/secret/Cron/kaynaklar ve canlı dosya hash kabulünü tamamla. Kendiliğinden yeniden başlama garantisi yok.
- **Gerekli yetki:** bu kalan yayın için yeni kullanıcı yetkisi/token/ücretli plan gerekmez; günlük okuma bütçesinin yenilenmesi ve gerçek doğrulama gerekir. Eski eksik geçmiş GSC/aylık rapor/şifreli yedek görevleri ayrı olarak devam eder.

Ayrıntılar: [COMPACT_DASHBOARD_REPORT.md](COMPACT_DASHBOARD_REPORT.md). Aşağıdaki kayıtlar önceki adımların tarihçesidir.

---

# Veri odaklı kompakt panel — 25 Ekim 2026

- [x] Büyük tekrar başlıkları ve intro blokları kaldırıldı. İşlevsel başlıklar ve erişilebilir H1 korunur. Yedi sekmede asıl çalışma alanı 220 px üstünde, KPI 100 px üstünde başlar.
- [x] 60 px tek araç çubuğu: menü/yıl/12 eşit ve yakın ay/dönem/cihaz/durum/bilgi/MB. 1280/1440/1920 px'de bütün ay ve kontroller görünür; dar pencerede/mobilde tek satır yatay kayar. Tüm kontrollerin erişilebilirliği doğrulanır.
- [x] Yenile/indirme etkin bölümün sağ üstünde; kapsam/kaynak açıklamaları durum/bilgi ayrıntısında. Gerçek hatalar görünür alert/bildirim olarak kalır. Çıkışta özel ayrıntılar temizlenir. Sahte metrik/liderlik yoktur.
- [x] **374 test: 299 Workers/D1 + 49 Python + 26 Chromium.** Tip/build, production dry-run, release kontrolü, npm audit 0. İlk iki mobil menü testi otomatik kaydırma/kapanma hatasını yakaladı; düzeltme sonrası tekrar ve tam koşu başarılıdır.
- Son commit bu kaydı içeren git kaydıdır; dal `fix/compact-data-first-dashboard`. Uzak CI, kontrollü yayın ve canlı SHA/Worker sürümü bu düzeltmenin PR açıklaması ve production workflow'unda izlenir. Ayrıntı ve masaüstü/mobil görüntüler: [COMPACT_DASHBOARD_REPORT.md](COMPACT_DASHBOARD_REPORT.md).

Bu arayüz işi için yeni hesap yetkisi gerekmedi. GSC OAuth/D1/Cron/bütçe/tarama/deploy ayarı, 29 ürün ve 521 CSV korunur. Kalan üretim veri görevi değişmedi: eksik tarihleri bütçeli otomasyondan izlemek, tam/taze veriyle gerçek aylık raporu kabul etmek; özel yönetici oturumu ve uzak şifreli yedek kabul sınırları sürer. Kendiliğinden oturum başlama garantisi yoktur. Önceki kayıtlar aşağıda tarihçe olarak korunur.

---

# Üst tarih çubuğu düzen düzeltmesi — 25 Ekim 2026

- [x] En üstte tek satır: kompakt yıl, 12 sürekli açık ay, hemen sağında tıklanınca 3/6/12 Ay açılan Dönem menüsü. Seçili ay dolu mavi; eski tarih kutusu ve sağ-sol okları yok. Mobilde ayların kendi yatay kaydırması var.
- [x] Mevcut ay/Tüm cihazlar ilk açılışı, otomatik yükleme, dönem/cihaz/sekme tercihleri ve İlk 10 Lider Ürün korunur. Eksik veri/liderlik üretilmez. Yıl/dönem menüsü klavye, odak, dışarı tıklama ve Escape kontrolleri tamamlandı.
- [x] **370 test:** 299 Workers/D1 + 49 Python + 22 masaüstü/mobil Chromium; tip/build, üretim dry-run, audit 0. İlk erişilebilirlik koşusundaki geçici kontrast hatası, yüklemede soluklaştırma kaldırılarak giderildi; yeniden koşu başarılı.
- [x] 1024/1280/1440/1920 px'de 12 ay kırpılmadan aynı satırda; 360/393/768 px'de belge taşması yok. Masaüstü açık/kapalı menü ekran görüntüleri `docs/screenshots/` ve [kabul raporunda](FILTER_BAR_REPORT.md).
- Son commit bu belgeyi içeren git kaydıdır; dal `fix/open-month-bar-with-period-menu`. Uzak CI ve kontrollü yayın kanıtı bu düzeltmenin PR açıklaması/production workflow kaydında izlenir. OAuth, D1, Cron, günlük bütçe, tarama, deploy yapılandırması ve 521 CSV değişmez.

Kalan gerçek veri görevi değişmedi: eksik geçmiş ayları mevcut bütçeli otomasyondan izlemek; tam ve taze veriyle aylık rapor kabulünü yapmak. Önceki özel yönetici oturumu/şifreli yedek kabul sınırları sürer; bu düzen düzeltmesi için yeni yetki gerekmedi. Aşağıdaki kayıtlar önceki aşamaların tarihçesidir.

---

# Açık ay çubuğu ve liderler — 25 Ekim 2026

- [x] 12 açık ay, seçili ay/yıl, gelecek ay engeli; ayrı 3/6/12 ay modu ve cihaz filtresi. Mevcut ay dâhil N takvim ayı kullanılır; aralık açık gösterilir. Tercihler ay/dönem/cihaz/sekme olarak hatırlanır; başka kullanıcı verisi saklanmaz.
- [x] İlk 10 Lider Ürün: doğrulanmış ürün URL'si ve gerçek sayfa ölçümlerinden tıklama/gösterim sıralaması, en fazla 10 satır, ağırlıklı CTR/konum, gün sayısı ve mevcut kanıt penceresi. Eksik ürünler sıfırla doldurulmaz; kısmi sıralama belirtilir.
- [x] Ortak dönem parser'ı performans/sorgu/rapor/radar/export/veri sağlığına uygulandı. Soru-cevap açık soruyu koruyarak varsayılan kapsamı kullanır. 12 ay önceki pencere, 100'den fazla dataset ve iki ürünün ayrılması test edildi. SQL gruplama alias çakışması giderildi. Büyük ayrıntılı denetim sınırında yanlış Google sağlık hatası yazılması engellendi.
- [x] 299 Workers/D1 + 49 Python + 18 masaüstü/mobil Chromium = **366 başarılı test**; WCAG, tip/build, üretim dry-run, kaynak koruma, npm audit 0. Son kaynak commit'i cd8de35; belge commit'i git log ile izlenir. Dal feat/month-strip-and-product-leaders.
- [x] Gerçek D1 kabulü **40183641688** başarılı: 3/6/12 ayın tarihleri ve 28 ölçümlü ürünün bağımsız hesapları eşleşti; 60 doğrulanmış gün var, pencereler tam değil. Arşiv **29/521/9.075** korundu; Google veya site isteği tetiklenmedi. Tam aylık SEO raporu kabulü geçmedi. Yayın/CI kanıtı bu değişikliğin PR ve production workflow kaydında tutulur.

Kalan veri görevi: eksik Temmuz–Eylül günlerini mevcut bütçeli otomasyondan izlemek; tam/taze veri oluştuğunda gerçek aylık rapor ve başarılı sorgu koruma kabulünü tamamlamak. Özel yönetici oturumu ve uzak şifreli yedek kabul sınırları sürer. Yeni mini trend üretilmedi; kanıtsız eğilim gösterilmez. Ayrıntılı dosyalar ve kabul: [FILTER_BAR_REPORT.md](FILTER_BAR_REPORT.md). OAuth/D1/Cron/bütçe/tarama/dağıtım yapılandırması ve 521 CSV korunur.

---

# Kullanım kolaylığı — 25 Ekim 2026

- [x] Sabit üst çubukta tek tık/dokunuş ay seçici; ilk ziyaret mevcut ay, gelecek ay engeli, önceki/sonraki okları. Ay/cihaz değişimi otomatik yükler; yalnız ay/cihaz/sekme tercihi saklanır.
- [x] Sade genel bakış, kısa veri durumu, “Neden eksik?” ayrıntıları; hızlı ürün sıralama/arama, satırdan kanıt, otomatik marka filtresi, açılır gelişmiş filtreler. Eksik metrikler tire; kısmi rapor etiketli; ölçüm yoksa indirme gizli. Mevcut ay tam aylık karşılaştırma yapmaz.
- [x] Kaynak/GSC otomasyonu değiştirilmedi. Radar mevcut API'ye isteğe bağlı ay/cihaz parametreleriyle bağlı. Başarısız kapsam yüklemesinde eski verinin doğru dönemine dönülür.
- [x] 287 Workers/D1 + 49 Python + 16 masaüstü/mobil Chromium = **352 başarılı test**; WCAG, tip/build, audit 0, kaynak koruma ve üretim dry-run başarılı. Son commit bu kaydı içeren git log kaydıdır; dal feat/dashboard-usage-improvements.
- [x] Gerçek tanılama **40170613608**, 09:51 Türkiye: 03:00 sonrası gerçek GSC devamı artık **doğrulandı**; kapsam **76/184**, ürün tarama kanıtı **29/29**. Önceki geceye ait “03:00 henüz gelmedi” kayıtları aşağıda tarihçedir. Tam aylık kabul hâlâ bloke.
- [x] Yayın ön kontrolünün harcanmış GSC yazmalarını ikinci kez rezerve eden hesabı düzeltildi; günlük bütçe/sayaç, 90.000/4.000.000 yayın güvenlik kapıları ve production ayarları korunur. Eksik/geçersiz sayaçta güvenli kapanma test edildi.

Sonraki somut veri adımı: kalan Temmuz–Eylül kapsamını gerçek tanılamadan izlemek, tam ve taze veri oluştuğunda dolu aylık raporu bağımsız hesapla doğrulamak. Şifreli uzak yedek ve özel yönetici oturumu için önceki kabul sınırları sürer. UX CI/yayın kanıtları bu değişikliğin PR ve production workflow kaydındadır. Ayrıntılar [UX_ACCEPTANCE_REPORT.md](UX_ACCEPTANCE_REPORT.md). Canlı site, OAuth, Cron ve 521 kaynak CSV korunur.

---

# Gerçek üretim devamı — 25 Ekim 2026, 01:16 Türkiye

- [x] Gerçek D1 tanılaması **40137124437**: GSC 36 done / 324 pending, Temmuz–Eylül **12/184**. Günlük 8.552/10.000 güvenlik bütçesi bekletiyor; Google hata kaydı yok. 03:00 henüz gerçekleşmedi.
- [x] Kalan 27 ürün mevcut crawler ile gerçek GET/robots/canonical kontrollerinden geçti. **40137757129: 29/29** URL ve snapshot kabulü başarılı; arşiv **29/521/9.075** korundu. Önceki iki sınırlı koşu 14/29 ve 26/29'da eksik kabul döndürdü. Bunlar kontrollü taramalardır; 29 ürünün otomatik Cron tekrarının tamamlandığı anlamına gelmez.
- [x] Gerçek rapor motoru **40137484150**: Eylül, 29 ürün, 3 kapsam eksiği; **29 Veri bekle**, tam aylık kabul false. Bağımsız metrik/cihaz/null/kanıt korumaları başarılı. Ham Google ölçümleri yayımlanmadı ve özel yönetici oturumu kullanılmadı.
- [x] Mevcut tarayıcıda gerçek GSC ürün keşfi ve kuyruk önceliği düzeltildi; seed tek SQL'e indirildi. Yerel 286 Workers + 45 Python; 8 tarayıcı senaryosu uzak CI'da. Son kod 662a5c8; bu belgeyi içeren commit git log -1 ile izlenir. PR #15.
- [x] Mevcut tanılama için günlük **03:07 / 05:17 Türkiye** salt okunur kanıt toplama hazırlandı. Yeni gün bütçesi ve gerçek boş olmayan senkron tamamlanması ayrı denetlenir. GitHub zamanlaması gecikebilir; sonuç henüz gerçekleşmiş sayılmaz. GSC Cron, OAuth, bütçe ve veri kayıtları korunur.

- [x] Bağımsız gerçek tanılama **40137836659**: 29/29 snapshot kabulü, 12/184 GSC, henüz gelmeyen bütçe zamanı. Sonraki gerçek rapor kontrolü **40137932194** de 29 Veri bekle / tam aylık kabul false. Ücretsiz kullanım: 2.413.674 okuma, 77.358 yazma (01:16 ölçümü).

**Sonraki somut adım:** 03:00 sonrası gerçek koşu ve tamamlanmış veri kümelerinin arttığını 03:07/05:17 tanılama artifact'iyle doğrula; 172/184 eksik kapsamı bütçe içinde izlemeye devam et. Tam Temmuz–Eylül, gerçek dolu aylık rapor ve 29 ürünün otomatik tekrar kabulü henüz tamamlanmadı. Ücretli hizmet veya kota korumasını aşan işlem yok. Ayrıntı: [PRODUCTION_CONTINUITY_REPORT.md](PRODUCTION_CONTINUITY_REPORT.md). Aşağıdaki eski sayılar tarihli kayıttır.

---

# Profesyonel panel devam kaydı — 25 Ekim 2026 (Türkiye)

- [x] Mevcut uygulamada tutarlı Türkçe tasarım: daraltılabilir menü, mobil gezinme, dönem/cihaz seçimi, dört KPI, gerçek GSC günlük grafiği, filtreli/sıralı ürün ve sorgu tabloları; mevcut radar/takvim/veri sağlığı/soru-cevap korunup yeni tasarıma taşındı.
- [x] Salt okunur performans API'si: bağımsız ağırlıklı metrik doğrulama, eksik günleri boş bırakma, tam dönem olmayan karşılaştırmayı engelleme, parametreli sorgu ve güvenli sayfalama. OAuth, Cron, günlük yazma bütçesi, tarama ve üretim yapılandırması değiştirilmedi.
- [x] **334 test başarılı:** 284 Workers/D1 + 42 Python + 8 masaüstü/mobil Chromium. Tüm bölümlerde axe WCAG kontrolleri başarılı; npm audit 0. Son başarısız/atlanmış test yok. Gerçek yerel API ve yalnız tarayıcıya ait fixture'lar ayrı test edildi; örnek veri üretime aktarılmadı.
- [x] Gerçek üretim D1'iyle salt okunur API kabulü **40125531435** başarılı; bağımsız SQL eşleşti, 29/521/9.075 korundu. Google senkronu veya site taraması tetiklenmedi. Özel üretim yönetici oturumu atlanmadı.
- [x] Panel kaynak commit'i **c7cd0d3**, PR **#13** main'e birleşti (**23c27520ab0d7b293232ec0678572d7af404dc34**). PR CI **40135274391**, main CI **40135421456** başarılı. Son belge commit'i `git log -1 --oneline`; ayrı teslim belge dalı kaynak kodu değiştirmez.
- [x] Kontrollü gerçek yayın **40135545161** başarılı: HTTP commit **23c27520ab0d7b293232ec0678572d7af404dc34**, Worker **bfbd0c8a-715e-4e08-9688-2a6fe3386ba4**; aynı D1, kaynaklar ve mevcut binding'ler korundu. Canlı 11 statik dosyanın hash'i eşleşti. Masaüstü/mobil giriş ekranında JS hatası, taşma veya axe ihlali yok; iki yeni veri endpoint'i oturumsuz 401. Üretim yönetici oturumu kullanılmadı. Sonraki yalnız belge yayınının güncel kimliği `/api/health` ve production workflow'unda izlenir.
- **Sonraki somut veri adımı:** aşağıdaki tarihli üretim kabul listesindeki eksik aylar ve gerçek otomatik tarama kapsamını salt okunur tanılamayla izlemek. Arayüzün yayın kabulü tamamlandı; tam geçmiş veri kabulü tamamlandı sayılmıyor.

Önceki tarihli üretim kapsamı aşağıdadır; bu arayüz çalışması tam geçmiş aylık veri veya 29 ürün tarama kabulü değildir. GA4/Ads etkinleştirilmedi. **BACKUP_ENCRYPTION_KEY** için önceki hesap sahibi gereksinimi sürüyor; mevcut OAuth/Cloudflare izinleri çalışıyor, yeni token veya yeniden yetkilendirme istenmiyor. Detay: [FRONTEND_REDESIGN_REPORT.md](FRONTEND_REDESIGN_REPORT.md).

---

# Üretim devam kaydı — 24 Ekim 2026, 18:02 UTC

- [x] PR **#8, #9, #10, #11** main'e birleşti. Son işlevsel kod/ayar commit'i **4bfec9aae0ab1b55e14358d3bfb52af0137055a9**; uzak main CI **40118789556 başarılı**. Bu belgeyi içeren commit `git log -1 --oneline`; en son tam yayın SHA/version kimliği canlı `/api/health` ve kontrollü üretim workflow'unda.
- [x] **306 test başarılı:** 265 Workers/D1 + 39 Python + 2 mobil/masaüstü Chromium. Npm audit 0; tip/build/üretim dry-run, migration ve 521 CSV/hash aktarım kontrolleri geçti. Son başarısız test yok. Önceki iki yayın engeli ve gerçek rollback raporda kayıtlı.
- [x] Gerçek GSC ilerlemesi 18 → **36 done**; aynı 360 işte pending 342 → **324**. Üç aylık kapsam **12/184**: Eylül 25–30 sayfa+sorgu. Temmuz/Ağustos henüz alınmadı; eksik veri sıfır değildir.
- [x] Gerçek readonly Google bağlantısı/17:34 OAuth refresh çalıştı; yeni hesap izni veya token gerekmiyor. Arşiv **29 ürün / 521 CSV / 9.075 kaynak satırı** korundu.
- [x] Günlük güvenlik bütçesi **8.552/10.000**, yeni 1.500 rezervasyon sığmadığı için bekliyor. Gerçek Cron 18:00'de **partial / DAILY_WRITE_BUDGET** kaydetti. Hesap geneli 18:02 ölçümü **75.352/100.000 yazma**, **377.637/5.000.000 okuma**; hard kotanın tamamen bittiği söylenmiyor.
- [x] Mevcut tarayıcının gerçek pilotu **40118110004**, snapshot kanıtı **40118410575** başarılı: broşür/el ilanı 200/self canonical/title/body hash/static HTML. İlk robots beklemesine uyuldu. **2/29 URL doğrulandı**; 293 sitemap URL'si içinde 29 kaynak kimliği birebir bulundu. Siteye yalnız GET yapıldı.
- [x] 18:02 Cloudflare runtime tanılaması **40118866686**: AUTOMATION=true, CRAWL=true, Ads=false, aynı D1 ve auth binding'leri. Mevcut saatlik :45 tarama slotu artık etkin yapılandırılmıştır. Sonraki otomatik tarama olayı henüz gözlenmedi; gerçek pilotla karıştırma.
- [x] Public panel dosyası hash'i kodla eşleşti; oturumsuz veri endpoint'i 401. Yönetici oturumu/anahtarı atlanmadı veya dışa aktarılmadı. İlk kontrollü yayında exact commit/version postflight ve otomatik gerçek rollback doğrulandı; yeni main belge yayını da aynı workflow ile etiketlenir.

## Kalan işler ve bir sonraki somut adım

1. **25 Ekim 00:00 UTC / Türkiye 03:00** yeni günlük 60.000 senkron bütçesiyle gerçek devamı, en yeni kesinleşmiş gün ve kalan **172/184** Temmuz–Eylül kapsamını D1 ile doğrula. Kodun UTC'de devam etme testi geçti; gelecek gerçek gün henüz doğrulanmadı. Oturumun kendiliğinden yeniden başlayacağı garanti edilmez; Cloudflare Cron bağımsızdır.
2. Sonraki saatlik :45 gerçek otomatik tarama kaydını izle; mevcut kuyrukla kalan **27 ürün URL'sini** HTTP/canonical kanıtıyla doğrula. Sitemap'te bulunmayı Google dizin kanıtı sayma; URL uydurma veya yeni crawler yazma.
3. Tam aylar ve URL kanıtı oluşunca mevcut yönetici oturumunda **gerçek aylık rapor / soru-cevap / başarılı sorgu koruma** kabulünü tamamla. Bu özel oturum kabulü henüz yapılmadı; Google key veya admin token'ı sohbet/Git'e isteme. Kısmi veriyi tamamlandı gösterme.
4. **Hesap sahibi işlemi:** bağımsız 32 bayt base64 **BACKUP_ENCRYPTION_KEY** GitHub Actions secret'ı eksik. Mevcut CF token/account ve GSC çalışıyor. Ayrı anahtar güvenli secret alanına kaydedilince mevcut backup workflow'u ile ilk gerçek şifreli uzak yedek ve ayrı DB geri dönüş kabulünü yap; OAuth şifreleme anahtarını değiştirme. Gerçek uzak yedek henüz alınmış sayılmaz.
5. Rakip **PR #7 taslak** korunuyor (a0629f2), üretime alınmadı. Teknik SEO, iç bağlantı ve sorgu–URL görevleri bekleyen geliştirmelerdir; önce mevcut kodu incele, kopya modül üretme.

Ayrıntılı gerçek kanıtlar ve tarihli ölçümler: [GSC_PRODUCTION_REPORT.md](GSC_PRODUCTION_REPORT.md). Ücretli plan/API başlatılmadı; mavibasim.com içeriği, OAuth anahtarları ve özgün CSV'ler korunuyor. Uygulamanın tamamı bitmiş sayılmaz; yukarıdaki kabul eksikleri açıktır.

---

# Önceki tarihli kayıtlar

# Güncel durum — gerçek üretim GSC kuyruğu (24 Ekim 2026, 17:42 UTC)

Aşağıdaki eski bağlantı/yetki engelleri tarihçedir. Güncel ayrıntı ve kanıtlar [GSC_PRODUCTION_REPORT.md](GSC_PRODUCTION_REPORT.md).

- [x] PR #8 ve #9 main'e birleşti; son fonksiyonel main commit'i **70d6476a0859fb8652f2b40d132bb04e3f918879**. Bu durum belgesini içeren son commit için `git log -1 --oneline`.
- [x] Main CI **40116927721** başarılı: **262 Workers/D1 + 36 Python + 2 Chromium mobil/masaüstü = 300 test**. Tip/build/üretim dry-run, npm audit 0 ve tüm kaynak/hash koruma kontrolleri geçti.
- [x] Gerçek Cloudflare yayını **40116985614** başarılı; HTTP tam commit ve Worker **d482659d-56a2-44e4-8645-fbdd66f0f724** eşleşti. Sonraki belge yayını aynı kontrollü workflow/health kimliğiyle izlenir.
- [x] Gerçek Cron/kuyruk: 18 → 29 → 35 → **36 done**, aynı 360 işte pending 342 → 331 → 325 → **324**. Hedef üç ay 0 → **12/184** günlük/scope kapsamı; Google hata kaydı yok. Yeni 90 gün planlandığı için toplam kuyruk büyüdü; veri kaybı değil.
- [x] 17:34 UTC'de gerçek OAuth refresh ve readonly kapsam korunarak sonraki Google istekleri başarılı. D1/secret'lar/kaynaklar korunuyor: **29 / 521 / 9.075**.
- [x] Atomik günlük senkron bütçesi: **8.552/10.000**; yeni sayfanın 1.500 rezervasyonu sığmadığı için bekliyor. Hesap geneli **75.186/100.000 yazma**, **326.436/5.000.000 okuma**; hard kota tamamen tükendi denmiyor. Sonraki UTC gününde 60.000 bütçeyle devam kodu test edildi; gerçek ertesi gün devamı henüz gözlenmedi.
- [x] Public app.js hash'i aynı; oturumsuz veri endpoint'i 401. Canlı sağlık kontrolü açık servis kimliğiyle 200; 1010 istemci hatası düzeltildi. 40116195577 sürüm değişikliği ön kontrolünde durdu; 40116326806'da **otomatik gerçek rollback** çalıştı. Son yayın/test başarılı.
- [x] Salt okunur gerçek robots/sitemap/broşür GET kontrolleri 200. Üretim tarama kabulü yerine geçmez.

## Tamamlanmamış işler — sıradaki somut adımlar

1. Ücretsiz güvenlik bütçesi yenilendikten sonra kalan **172/184** Temmuz–Eylül kapsamını ve en yeni günlük veriyi D1 snapshot'larıyla doğrula. Eksik gün/sorgu sıfır değildir. 25 Ekim 00:00 UTC / Türkiye 03:00 bütçe yenilenmesi beklenir; gelecekteki gerçek olay doğrulanmış sayılmaz.
2. Mevcut tarayıcıyı kontrollü gerçek pilotla doğrula, sonra otomatik salt okunur taramayı aç. Şimdiki üretim `CRAWL_ENABLED=false`: **2 eşlenmiş / 0 taramayla doğrulanmış ürün URL'si (17:42 ölçümü)**. 29 ürünü sitemap ve gerçek sayfa/canonical kanıtıyla eşle; Manifest ile gerçek sitemap karşılaştırmasında 29 kimliğin tamamı mevcut; önceki slug farkı örnekleri düzeltildi. URL uydurma veya mevcut modülü yeniden yazma.
3. Tam geçmiş ve URL kanıtıyla yönetici oturumunda gerçek aylık rapor/soru/koruma kabulünü yap. Veri yetersizken kesin öneri veya tamamlandı iddiası üretme. Gerçek oturum kabulü için kullanıcı anahtarını sohbete isteme.
4. **Hesap sahibi yetkisi gereken tek yeni secret:** bağımsız BACKUP_ENCRYPTION_KEY GitHub secret'ı. Mevcut Cloudflare/GSC yetkileri çalışıyor; yeniden OAuth veya yeni CF token gerekmedi. Mevcut yedek workflow'u anahtar yokken export yapmadı. Secret tanımlanınca şifreli uzak yedek ve ayrı DB geri dönüş kabulünü tamamla; OAuth anahtarını değiştirme.
5. Rakip modülü PR #7 taslak (**a0629f2**), üretime alınmadı. Teknik SEO, iç bağlantı, sorgu–URL modülleri bu olayı takiben bekliyor; önce yazılan kodu incele.

Tüm uygulama tamamlandı sayılmaz: üç ay, gerçek otomatik tarama/ürün eşlemesi, korumalı gerçek aylık rapor ve uzak yedek kabulü eksik. Oturumun yeniden başlayacağı garanti edilmez; dağıtılan Cloudflare Cron bağımsız çalışır. Ücretli plan açılmadı; canlı site ve özgün CSV'ler değiştirilmedi.

---

# Durum, teslim denetimi ve devam kaydı

## Türkçe soru-cevap — tamamlandı

- Dal feat/turkce-soru-cevap; PR tabanı audit/seo-reliability (PR #2). 36 soru/follow-up testi ve mobil/masaüstü gerçek arayüz kontrolü başarılı.
- Son regresyon: 122 Workers/D1 + 20 Python + 2 tarayıcı = 144 başarılı; audit 0, tip/build/kaynak kontrolleri başarılı. Son başarısız test yok; ilk 30 gün tarih hatası düzeltildi.
- Ayrıntılar QUESTION_ANSWER_TEST_REPORT.md. Motor 1.2.1. Son commit bu belgeyi içeren git log -1 kaydıdır; önceki aşama e56a0e3.

## Aktif geliştirme kuyruğu — henüz tamamlanmadı

1. [x] SEO fırsat radarı: 34 senaryo ve panel tamamlandı; SEO_OPPORTUNITY_RADAR_REPORT.md. Dal feat/seo-firsat-radari; PR tabanı feat/turkce-soru-cevap. Regresyon 178 başarılı; dört migration, kaynak koruma ve üretim dry-run geçti.
2. [x] SEO değişiklik etki analizi: mevcut geçmişe bağlı 28 gün/sorgu/cihaz/takvim ve 38 senaryo tamamlandı. SEO_CHANGE_IMPACT_REPORT.md; dal feat/seo-degisiklik-etkisi, taban radar PR #4. 195 Workers + 20 Python + 2 tarayıcı = 217 test; audit 0.
3. Rakip SEO: güvenli alan adı/robots taraması, açık ürün eşleştirmesi, içerik kanıtları ve 30 test; COMPETITOR_SEO_REPORT.md; ayrı PR. Gerçek rakip adresi/taraması henüz yok.
4. Teknik SEO ve URL Inspection: mevcut envanteri genişlet; dizin kanıtını GSC gösteriminden ayır; 30 test ve TECHNICAL_SEO_AUDIT.md; ayrı PR.
5. İç bağlantı: anchor/bölüm/nofollow ve eksik kapsamı tanıyan grafik; 30 test ve INTERNAL_LINK_AUDIT.md; ayrı PR.
6. Sorgu–URL çakışması: mevcut olası çakışmayı dönem/cihaz/niyet kanıtlarıyla genişlet; 30 test ve KEYWORD_URL_CONFLICT_REPORT.md; ayrı PR.
7. [x] Veri doğruluk denetçisi: 48 senaryo, bağımsız ürün/cihaz/sorgu/marka/oran kontrolü, kaynak/ürün paneli ve otomatik sync makbuzu tamamlandı. DATA_INTEGRITY_AUDIT.md; dal feat/veri-dogruluk-denetcisi, taban PR #5. 243 Workers + 21 Python + 2 tarayıcı = 266 test; kaynak koruma/audit/üretim dry-run başarılı.

Bu kuyruk maddeleri talep kaydıdır; kodu/testi bitmiş sayılmaz. Hesap yetkisi olmadan gerçek Google veya canlı sistem kabulü verilmeyecek. Sonraki somut adım rakip yönetimi/güvenli tarama modülüdür; ardından teknik SEO, iç bağlantı ve sorgu–URL modülleri ayrı PR ile işlenecek. Son tamamlanan commit için git log -1; önceki aşama 05921f1. Gerçek bağlantılar için yalnız hesap sahibinin Cloudflare Workers Free ve Google okuma/OAuth izinleri beklenir.

## Bağımsız denetim — tamamlandı

- Dal `audit/seo-reliability`; sonuçlar [AUDIT_REPORT.md](AUDIT_REPORT.md).
- 41 bağımsız senaryo: ilk 40 koşusunda 13 hata yeniden üretildi ve düzeltildi; son 41/41 başarılı.
- Tam regresyon: 86 Workers/D1 + 20 Python + 2 Chromium = 108 başarılı; npm audit 0; tip kontrolü, kaynak koruma, üretim dry-run başarılı. Başarısız/atlanmış otomatik test yok.
- 29 ürün / 521 dosya / 9.075 satır tekrar incelendi; kaynaklar ve talimatlar değişmedi.
- Son uygulama motoru 1.2.0; bu belgeyi içeren commit `git log -1 --oneline`. İlk güvenlik aşaması f4a5d1b.
- Main b31d3b1 uzak verify=SUCCESS. Denetim düzeltmeleri ayrı PR'a gönderilecek; main'e otomatik birleştirme yapılmaz.
- Bir sonraki somut adım: Türkçe soru-cevap ve takip bağlamı (30 soru), ardından fırsat radarı (30 senaryo) ve değişiklik etki analizi (30 senaryo); ayrı PR'lar.
- Gerçek Cloudflare ve Google bağlantısı yok; gerçek senkron/tarama/rapor/CPU/kota/uzak yedek kabulü yapılmadı. Gerekli hesap izinleri üretim yönergesinde.

## Önceki üretime geçiş hazırlığı kaydı

Yeni özellik eklenmedi; mevcut `src/`, `public/`, migration'lar ve 521 CSV korundu. Main farkı/çatışma kontrolü, bağımlılık güvenlik düzeltmeleri, SHA sabitli CI, ayrı üretim yapılandırması, OAuth/Free plan/rollback yönergesi ve gerçek veri kabul araçları hazır. Güncel sonuç: **42 Workers + 16 Python + 2 tarayıcı = 60 test geçti**, tüm bağımlılıklarda npm audit 0. Önceki 52 testlik kayıt aşağıda geliştirme aşamasının tarihçesidir.

Üretim dosyaları `docs/PRODUCTION.md`, `docs/PRODUCTION_ACCEPTANCE.md`, `docs/RELEASE_REVIEW.md` ve `deploy/` altında. Gerçek kimlikler yokken --ready kapısı geçmez. Yerel ayrı üretim D1 provasında 3 migration ve 521/9.075 kaynak doğrulandı.

PR açıklaması `docs/PULL_REQUEST.md` içinde. [PR #1](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/pull/1) mevcut kimlikle GraphQL kullanılarak oluşturuldu; uzak check sonuçları aynı yolla sorgulanıyor. İlk REST proxy engeli için artık kullanıcıdan ağ ayarı veya yeni token istenmiyor. Birleştirme kapısı son HEAD için verify=SUCCESS; önceki concurrency iptali güncel koşuyla karıştırılmamalı.

Yalnızca dış yetki bekleyenler: Cloudflare Workers Free hesap/D1/Worker secret erişimi; Google OAuth projesi ve mevcut GSC mülküne okuma+consent; dar kapsamlı yedek erişimi ve bağımsız anahtar. Uzak kaynak/Google bağlantısı/üretim yayını yapılmadı, ücretli hizmet açılmadı. Son hazırlık commit'i için `git log -1 --oneline` kullanın. Aşağıdaki geliştirme dönemi GitHub API engeli kaydı tarihçedir; GraphQL ile çözüldü.

## Önceki uygulama geliştirme kaydı

Uygulama yerel Workers/D1 ortamında çalışıyor. Gerçek kaynaklar içe aktarıldı. Google hesabı bağlı değil; canlı tarama, üretim dağıtımı ve uzak yedekleme doğrulanmadı. Canlı siteye yazılmadı, ücretli hizmet açılmadı.

Dal: `feat/seo-karar-merkezi`. Son doğrulanmış uygulama commit'i: `f112b46`; motor: `1.1.1`. Bu durum belgesini içeren commit için `git log -1 --oneline` kullanın. Kod aynı dalda GitHub'a gönderildi; main'e birleştirme yapılmadı.

## Tamamlanan ve test edilenler

- [x] Üç D1/SQLite migration'ı; ilişkiler, benzersizlik ve veri sınırları; değişmez SEO snapshot'ları.
- [x] 4 grup, 29 ürün, 521 CSV ve 9.075 satırın tamamının idempotent aktarımı. Dosya SHA-256, özgün hücre, satır, tarih ve kapsam saklanır; kaynaklar değiştirilmez.
- [x] 6.765 ürün+kelime; 1.300 tekrar eden kelime ve 54 varyant ailesi. Tekrar/varyant hacimleri toplanmaz; boş veri sıfır olmaz.
- [x] Google OAuth, güvenli oturum, salt okunur kapsam seçimi, AES-GCM token saklama/yenileme kodu. Gerçek Google bağlantısı henüz yok.
- [x] GSC sayfa/sorgu/cihaz/ülke, GA4 şehir/cihaz/organik oturum ve opsiyonel Ads geçmiş metrik adaptörleri. Sağlayıcı testleri taklit yanıtlarla yapılır.
- [x] Günlük tekilleştirme, 400 güne kadar kademeli backfill, son günleri yeniden uzlaştırma, sayfalama, iş kiralama/fencing, hata geçmişi, Retry-After ve güvenli tekrar deneme.
- [x] Yarım, bozuk, tekrarlı sayfalama içeren veya örneklenmiş veri kümesi aktifleşmez. Eski/eksik Google verisinde karar durur; başarısız sağlık kontrolü rapor önbelleğini iptal eder.
- [x] Robots/crawl-delay, aynı origin ve kaynak sınırlarıyla sitemap/iç bağlantı tarama kodu; başlık/meta/H1–H6/canonical/robots/JSON-LD/hreflang/görsel/içerik envanteri.
- [x] Eski/yeni SEO sürümü ve tespit aralığı; CMS kanıtı yoksa kesin yayın zamanı bilinmiyor kalır.
- [x] Küçük dalgalanma, CTR/gösterim, mobil/masaüstü, marka/markasız, başarılı sorgu koruma ve bağımsız SQL hesap doğrulaması.
- [x] Önceki ay, 3/6/12 ay ve geçen yıl aynı dönem kapsamı; veri eksikse hesap sonucu null. Eksik sorgu sıfır trafik değildir.
- [x] Raporun kaynak veri kümeleri, tarih, URL, cihaz, filtre, formül ve motor sürümü saklanır.
- [x] Uygulama beyanı, eski/yeni değer ve 7/28/60/90 günlük ölçüm; Google gecikmesi ve diğer sayfalarla karşılaştırma. Nedensellik iddiası yok.
- [x] Korumalı API, tek ekran Türkçe panel, okunabilir kanıt/geçmiş, deterministik soru-cevap ve rapor indirme.
- [x] Şifreli yedek, bozulma/yanlış anahtar reddi ve ayrı SQLite'a tam geri yükleme testi.
- [x] GitHub Actions test ve erişim koşullu günlük şifreli D1 yedek iş akışları depoda.

## Son test sonuçları

| Kontrol | Sonuç |
|---|---|
| TypeScript, Workers ve tarayıcı testleri | Başarılı |
| Workers/D1 testleri | 6 dosyada 42 geçti |
| Python kaynak/aktarım/yedek testleri | 8 geçti; bütün 521 dosya ve 9.075 satır dahil |
| Chromium masaüstü ve mobil | 2 geçti; giriş, 29 ürün, kaynak, kanıt, geçmiş, soru, export ve çıkış; JS hatası/taşma yok |
| Worker dry-run build | Başarılı; üretime dağıtılmadı |
| Gerçek yerel D1 migration/aktarım | 3 migration; 29 ürün / 521 kaynak / 9.075 gözlem |
| Çalışan uygulamaya işlevsel HTTP isteği | Sayılar ve bağlantısızken Veri bekle doğrulandı |
| Yerel Cron giriş noktası | Çalıştırıldı; bağlantı yok durumu dürüstçe kaydedildi |
| Gerçek D1 export, şifrele/çöz ve ayrı DB'ye yükle | integrity=ok, foreign key hatası=0; kaynak sayıları korundu |
| Üretim bağımlılıkları npm audit | Denetim anında bildirilen açık 0 |
| CSV, AGENTS ve proje yönergeleri | Başlangıç commit'ine göre değişiklik yok |
| GitHub Actions uzak koşusu | Doğrulanamadı: GitHub API erişimi Forbidden |

**52 otomatik test geçti; başarısız veya atlanmış test yok.** Önceki araç/cache ve tarayıcı tip kontrolü sorunları giderildi. Gerçek hesap/üretim testleri yapılmamış olarak kalıyor. Ayrıntı: `docs/VALIDATION.md`.

## Kaynak kalitesi

Ortalama arama değeri 4.169 gözlemde, aylık arama değeri 212.148 hücrede boş. Bunlardan sıfır talep veya düşüş çıkarılmaz. Kaynaklarda bulunmayan lokasyon/dil/ağ/saat dilimi tahmin edilmedi. Bozuk satır ve aynı dosyada özdeş tekrar 0; dosyalar arası özdeş gözlem tekrarı 1.678. Tam rapor: `docs/source-audit.json`.

Yalnızca yönergelerdeki iki ürün URL'si başlangıçta eşlendi; canlı doğrulanmış sayılmıyor. Diğer 27 ürünün URL'si gerçek keşif/kanıt gerektiriyor. URL uydurulmadı.

## Yetki/erişim bekleyenler — tamamlandı sayılmayacak

1. Google OAuth client/secret, tam callback URI ve GSC mülk okuma izni; opsiyonel GA4 Data API/property ID. Değerleri yalnızca güvenli sunucu secret ayarlarına girin; sohbet/Git'e yazmayın. Gerçek aktarım ve hata kurtarma kabulü henüz yapılmadı.
2. Canlı salt okunur tarama için ağ erişimi: bu ortamdan `mavibasim.com` isteği proxy 403 döndü. Robots/sitemap/sayfa ve 29 URL eşlemesi gerçek siteyle doğrulanmadı. Siteye yazma yetkisi gerekmiyor.
3. Cloudflare hesap/D1 erişimi, gerçek database_id, ayrı uygulama adresi, sunucu secret'ları ve ücretsiz kota kontrolü. Bu oturumda üretim değiştirilmedi. D1 kimliği yer tutucu, workers_dev ve tarama kapalı.
4. Opsiyonel Ads: onaylı developer token, müşteri erişimi, desteklenen API sürümü ve uygun OAuth kapsamı. Otomatik yeni Planner verisi çekilmedi.
5. Uzak yedek: Cloudflare erişimi ve bağımsız BACKUP_ENCRYPTION_KEY GitHub secret'ları; gerçek D1 kimliği. Yoksa iş akışı gerçek yedek alınmadığını bildirerek atlar. Artifact/dakika bütçesi ve bağımsız ikinci hedef doğrulanmalı.
6. Uzak CI sonucu: GitHub API/Actions okuma erişimi engelli. Workflow dosyaları ve yerel koşu mevcut; uzak yeşil sonuç iddia edilmiyor.

## Kalan ürün/üretim kapsamı

- Gerçek CMS/deploy log adaptörü yok; kullanıcı beyanı bağımsız doğrulanmış yayın zamanı değildir.
- JS render, Lighthouse ve gerçek mobil hız ölçümü yok; tarama statik HTML ile sınırlı.
- README'deki sitemap/URL/analiz sınırları geçerli. Büyük siteler için kalıcı keşif imleci ve toplulaştırmaların tamamının SQL'e taşınması gerekir. Şehir çıktısı ilk 200 şehir/cihaz/açılış grubu ile sınırlıdır; listede görünmeme, veri yokluğu kanıtı değildir.
- Gerçek hesapta CPU, D1 okuma/yazma/depolama, 400 günlük backfill ve GitHub bütçesi ölçülmeli. Eski veri kümelerini kanıtları bozmadan arşivleyen saklama politikası yok.
- GA4 dönüşüm/key events tanımı doğrulanmadı; null kalır. Şehir verisi GSC sorgusu değildir.
- Mevsimsellik/kontrol sayfaları gözlemseldir; nedensellik ve garanti edilmiş iyileşme yoktur.
- İyileştir şemada desteklenir; yeterli teknik/niyet kanıtı yokken otomatik başlık/URL/içerik değişikliği önerisi üretilmez.
- Sonuç pencereleri ve değişiklik kaydı API'de mevcut; otomatik CMS olayı ve panelden değişiklik beyan formu henüz yok.
- Soru-cevap ürün/cihaz/şehir/koruma sorularıyla sınırlı; her serbest soruyu anlayan LLM yok.
- Yedek manifesti dosyadır; üretimde backups_manifest tablosuna uzaktan koşu kaydı ve bağımsız ikinci hedef doğrulaması gerekir.

## Bir sonraki somut adım

GSC salt okunur OAuth ve site ağ erişimi sağlanınca mevcut adaptörlerle bir kesinleşmiş günün sayfa+sorgu aktarımını ve robots/sitemap/iki ürün sayfası taramasını çalıştır. Bağımsız veri/SQL kabulünden sonra 400 günlük kuyruğu tamamla, diğer URL'leri kanıtla eşle. Ücretsiz Cloudflare hesap/kota ve ayrı hedef doğrulandıktan sonra yetkili dağıtım, gerçek Cron ve uzak yedek geri dönüşünü denetle.

## Oturumlar arasında devam

- Sheets aktarımının gerçek kayıt sayısı yalnız başarılı D1 yazımından sonra bildirilir; 52 günlük işi toplam/aylık yedekle kapatma. Güncel bütçe kullanıcının payını koruyarak bekletiyorsa bunu açıkça belirt.
- Bu oturumda 11 JSON dosyası için erişilebilir dosya kimliği bulunmadı; mevcut Sheets kaynağıyla devam edildi. Kaynakta olmayan `workRecords` geçmişini kurtarılmış sayma. R2 metadata erişimi HTTP 403; Drive kapsamı mevcut GSC OAuth'unda yok. Bu yolları etkinleştirilmiş/doğrulanmış gibi bildirme; Sheets aktarımına bağlama.

README komutları tekrarlanabilir. `.dev.vars`, `.local/` ve `.wrangler/` özel/yerel çıktılardır; Git'e girmez. Mevcut kullanıcı dosyalarını ve kimlik bilgilerini koruyun. Son commit: `git log -1 --oneline`. Oturumun kendiliğinden yeniden başlayacağı garanti edilmez.

Güvenlik güncellemesi: 2026-10-23 CI'de yeni undici uyarıları görüldü; miniflare için 7.30.1 sabitlendi. npm ci ve audit tekrar geçti (0 açık). Ayrıntı SECURITY_CHANGELOG.md; sonraki dal CI sonuçları ayrıca doğrulanacak.
- Drive arşiv bağlantısı: `/drive.html` üzerinden hesap sahibinin bir defalık
  `drive.file` çevrimdışı onayı gerekiyor. Sonrasında gerçek yükleme/geri okuma
  sonucu `/api/drive/status` ekranında doğrulanmalı; onay öncesi arşiv yok.
