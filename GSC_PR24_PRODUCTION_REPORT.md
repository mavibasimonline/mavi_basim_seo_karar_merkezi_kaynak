# PR #24 — onaylı üretim yayını ve iki GSC işinin kabulü

26 Ekim 2026, saatler Türkiye (UTC+3). **Yayın ve iki gerçek GSC işinin kabulü başarılı.** Son gözlem **21.01.20**: iki 18 Ağustos işi done/error=null, Temmuz–Eylül kapsamı **105/184 (%57,07)**; **79 birim eksik**. Tam aylık rapor kabulü verilmedi.

## Birleştirme ve gerçek yayın

Kullanıcı PR #24 main birleştirmesi, kontrollü yayın ve yalnız iki 18 Ağustos blocked işinin birer kez yeniden kuyruğa alınmasını açıkça onayladı. Yeni migration, toplu aktarım, ücretli hizmet, Cron sıklığı değişikliği ve mavibasim.com içeriğine müdahale yasaktı.

- Son PR kaynak HEAD **6353da58c8b315770bb04685e1235a447acc55e4**, [CI 40366499513](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/actions/runs/40366499513) başarılı. Önceki CI yeni commit için kullanılmadı.
- [PR #24](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/pull/24), **20.16.44** main'e birleşti: **cb8062da45927d79c351aed96dcb46718fc67e68**. [Tam main CI 40367117621](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/actions/runs/40367117621) başarılı.
- Her iki ham CI logunda **434 Workers/D1 + 121 Python + 34 Chromium = 589 başarılı test**, audit 0; kaynak koruma ve üretim dry-run başarılı. Bunlar gerçek Google kabulü yerine geçmez.
- [Kontrollü yayın 40367672260](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/actions/runs/40367672260), **20.21.20** HTTP/Cloudflare postflight ile başarılı. Worker **da882c4b-9702-46d6-a89c-785f3c3cc4b9**, tam main SHA ve `owned-url-variants-v2` kimliği eşleşti; okuma koruması `d1-account-reads-v1`.
- Eski Worker **7a51b63e-51e7-4334-9afb-1e56d1ce0aa0**, sürüm sabitlemesi ve rollback kaydı korundu; rollback gerekmedi. Main birleştirmesi tek başına yayını tetiklemedi.

## Migration ve korunan kaynaklar

Eski production workflow'u otomatik `migrations apply` içeriyordu. Kullanıcının yeni migration yasağını karşılamak için bu adım aynı PR'da salt okunur doğrulamaya çevrildi ve 9 yeni testle sınandı. Gerçek yayında yalnız **SELECT name FROM d1_migrations ORDER BY id** çalıştı: **6 satır okuma**, `schema_changes=false`, `migration_application_started=false`. Yerel ve gerçek altı mevcut şema adı eşleşti; eksik/fazla/bozuk kayıt yayını durdurur. **Migration uygulaması başlatılmadı.**

Preflight/postflight gerçek D1 kimliği, mevcut secret/binding adları, kaynak sayıları **29 ürün / 521 CSV / 9.075 satır**, domain GSC mülkü ve readonly bağlantı ayarları korunarak geçti. OAuth yeniden bağlanmadı, anahtar/token sohbete veya Git'e yazılmadı. Normal sağlayıcı token yenilemesi manuel bağlantı değişikliği değildir.

Üretim logunda Cron **`*/15 * * * *`**, olay başına sağlayıcı sayfası 1, günlük senkron yazma limiti **60.000** ve D1 okuma koruması etkin. Kota defteri sıfırlanmadı. Worker mevcut `workers.dev` adresinde; mavibasim.com'a route eklenmedi veya içerik yazılmadı.

Yayın öncesi ve sonrası **12 statik dosya** byte/SHA-256 düzeyinde aynı; Wrangler da güncellenen asset olmadığını kaydetti. Kimliksiz özel API, tanımlı yayın istemcisiyle **401** verdi. İlk varsayılan Python istemcisi Cloudflare tarafından 403 ile reddedildi; kullanıcı ajanı başlığıyla uygulama yanıtı ayrıca doğrulandı. Bu kontrol için giriş yapılmadı veya Google/D1 veri okuması tetiklenmedi.

## Güncel kota ve kontrollü kurtarma

İlk taze [kota kabulü 40365938792](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/actions/runs/40365938792), **20.09**: hesap 601.207 okuma / 22.463 yazma, mode=open; 20.00'a kadar analitik. Mevcut gözlemci bir kota kaydı güncelledi, kabul 229 satır okudu. Yayın öncesi bütçe kontrolü ve yayın içindeki taze gözlem de başarılı oldu.

[Tek yeniden kuyruğa alma 40367971675](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/actions/runs/40367971675), **20.22.25**: tam canlı SHA/v2, taze kota ve iki eski URL hatası koşuluyla yalnız aşağıdaki iki iş pending yapıldı. **593 okuma / 4 yazma**; cursor, generation, attempts ve hata geçmişi korundu. İşlem Google isteği veya site taraması başlatmadı. İkinci requeue yapılmadı.

| İş | Kurtarma sonrası durum | Cursor | Attempts | Doğal Cron kabulü |
|---|---|---:|---:|---|
| `gsc:2026-08-18:page` | pending | 0 | 2 | **20.30.43 done, 107 gerçek satır, hata yok** |
| `gsc:2026-08-18:query` | pending | 200 | 2 | **21.00.42 done, 155 ek gerçek satır, hata yok** |

Kurtarma sırasında hesap analitiği **603.362 / 5.000.000 okuma**, **22.719 / 100.000 yazma**; mode=open. Yerel defter **438.573 okuma / 12.398 yazma**. Kayıtlı quota lease **21.36'ya kadar**; adaptif hesap sayacı gecikmelidir, bu yüzden yerel atomik rezervasyonlar da korunur. Gelecek tüketimin güvenli olduğu eski kayıttan varsayılmaz.

Kalıcı yeni veri hatası nonretryable olduğundan blocked kalır; günlük planlayıcı veya OAuth callback'i bu hatayı açamaz. Yeni hata oluşursa tekrar kurtarma yapılmadan güvenli alan kategorisi raporlanacak. Canlı siteye otomatik SEO değişikliği veya geri alma yoktur.

## Gerçek kapsam — tamamlanmış ay iddiası yok

[20.14 başlangıç ölçümü 40366747758](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/actions/runs/40366747758): **102/184**, 82 eksik; 579 okuma / 0 yazma. **20.15 doğal Cron**, 9 Ağustos page için 70 satır alarak kapsamı 103'e çıkardı; bu olay URL düzeltmesi yayımlanmadan önceydi.

Kurtarma öncesi gerçek durum **20.22'de 103/184 (%55,98), 81 eksik**:

| Dönem | Sayfa | Sorgu | Toplam |
|---|---:|---:|---:|
| Temmuz | 0/31 | 0/31 | 0/62 |
| Ağustos | 22/31 | 21/31 | 43/62 |
| Eylül | 30/30 | 30/30 | 60/60 |
| **Toplam** | **52/92** | **51/92** | **103/184** |

**20.31 gerçek gözlem:** [40369385140](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/actions/runs/40369385140), **581 okuma / 0 yazma**. Sayfa işi 20.30.42–43'te `trigger_source=cron`, status=done, **107 satır**; job error_code=null ve başarı sonrası normal attempts sıfırlaması gerçekleşti. Sorgu işi henüz pending/cursor=200/attempts=2, operatör tekrar denemedi. Kapsam **104/184 (%56,52), 80 eksik**: Temmuz 0/62, Ağustos 44/62 (23 page, 21 query), Eylül 60/60. Hesap analitiği **623.220 okuma / 22.724 yazma**, mode=open; kayıtlı D1 quota lease hâlâ 21.36'ya kadar. Salt okunur gözlem bu izni yenilemez.

**Son gerçek kabul — 21.01.20:** [40373995538](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/actions/runs/40373995538), **582 okuma / 0 yazma**. Sorgu işi **21.00.41–42** doğal Cron'unda cursor=200'den devam ederek **155 ek gerçek satır** aldı; status=done, error_code=null. 155, tüm sorgu veri kümesinin toplamı değildir. Sayfa işi de done/error=null; başarı sonrası normal attempts sıfırlaması her ikisinde de gerçekleşti. İkinci requeue veya manuel aktarım yapılmadı; yeni hata gözlenmedi. Başarısızlık sürseydi nonretryable blocked durumunu yeniden açmadan duracaktık.

| Dönem | Sayfa | Sorgu | Son toplam |
|---|---:|---:|---:|
| Temmuz | 0/31 | 0/31 | 0/62 |
| Ağustos | 23/31 | 22/31 | 45/62 |
| Eylül | 30/30 | 30/30 | 60/60 |
| **Toplam** | **53/92** | **52/92** | **105/184 (%57,07)** |

**79 birim eksik:** Temmuz 62, Ağustos 17. Tek kurtarma öncesi 103'e göre +2 doğrudan bu iki işin tamamlanmasıyla doğrulandı; önceki 102→103 artışı olağan 9 Ağustos aktarımıydı. Birim gün × scope (page/query); anonimleştirilmiş tüm Google sorgularının bulunduğu anlamına gelmez. Eksik veri sıfır trafik sayılmaz, tam aylık rapor kabulü verilmez.

Son hesap gözlemi **630.672 / 5.000.000 okuma (%12,61)**, **23.134 / 100.000 yazma (%23,13)**; mode=open. Adaptif analitik **20.00'a kadar** (yaklaşık 61 dakika gecikmeli). Aynı anda gerçek yerel defter **448.966 okuma / 13.856 yazma**; atomik rezervasyonlar korunuyor. Worker'ın **kayıtlı izin sonu 21.36**; salt okunur gözlemin hesapladığı olası 22.16 süresi D1'e yazılmadı ve etkin izin diye kullanılmaz. Gelecek tüketimin veya iznin otomatik yenilenmesinin garantisi verilmez.

Bu görevde sınırlı başlangıç incelemesi + tek kurtarma + iki Cron sonrası gözlem toplamı **2.335 okuma / 4 yazma**; kota gözlemcisi ve yayın preflight/postflight maliyetleri bu toplama dahil değildir. Yeni migration, kaynak silme, toplu yeniden aktarım, ücretli hizmet veya mavibasim.com içerik değişikliği yapılmadı.

Son açık HTTP kontrolünde Worker hâlâ **da882c4b-9702-46d6-a89c-785f3c3cc4b9**, tam main **cb8062da45927d79c351aed96dcb46718fc67e68** ve v2 ile eşleşiyor. Bağımsız kanıt incelemesi yayın/ilk Cron/son kabul için geçti. Kalan 79 kapsam birimi mevcut normal Cron ve taze kota izinleriyle ilerlemeli; başka iş bu görevde yeniden açılmadı.

Yerel ham kanıtlar `/workspace/reports/gsc-pr24-release-2026-10-26/` altında. Bu rapor/TODO yalnız `docs/pr24-production-results` belge dalında tutulur; main ve yayımlanmış kaynak SHA'sını değiştirmez. Oturumun kendiliğinden yeniden başlaması garanti edilmez.
