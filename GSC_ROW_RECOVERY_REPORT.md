# PR #23 — Gerçek üretim tanılaması sonucu

26 Ekim 2026. Kullanıcı yalnız PR #23 birleştirme/yayın ve iki legacy işin birer kez doğal Cron üzerinden denenmesini açıkça onayladı. **Yayın başarılı, iki işin ret nedeni belirlendi; veri engeli giderilmedi.** Daha yeni bir D1 ölçümü engellendiğinden kapsam ve kota aşağıda **11.01 Türkiye** kaydına tarihlenmiştir.

## Yayın doğrulaması

- PR HEAD `743f54e`, CI [40282714530](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/actions/runs/40282714530) başarılı. Main merge **5f04525975e2c255151c4a4158cf9cf031d07679**, main CI **40284669722 SUCCESS**: **348 Workers/D1 + 104 Python + 34 Chromium = 486 test**.
- [Kontrollü yayın 40284988876](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/actions/runs/40284988876) **10.19 Türkiye** başarılı. Worker **7a51b63e-51e7-4334-9afb-1e56d1ce0aa0**; HTTP/main/Cloudflare commit-version eşleşti. `gsc_validation_revision=field-reasons-v1`, `read_guard_revision=d1-account-reads-v1`.
- Devam mesajı sonrasında aynı canlı HTTP sürümü yeniden doğrulandı; main değişmedi. 12 canlı statik dosya main ile byte düzeyinde aynı. Mevcut binding/secret isimleri, OAuth bağlantısı, DB, **29 ürün / 521 CSV / 9.075 kaynak satırı** korundu.
- Yayın logu **No migrations to apply**: yeni migration uygulanmadı. Cron `*/15 * * * *`, sağlayıcı sayfa limiti 1, günlük senkron yazma bütçesi 60.000 ve D1 güvenlik eşikleri değişmedi. Toplu aktarım veya başka PR yayını yapılmadı.

## Tek yeniden kuyruğa alma ve gerçek Cron sonuçları

[40285153943](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/actions/runs/40285153943), **10.20.12 Türkiye**: yalnız iki 18 Ağustos işi pending yapıldı. Cursor 0/200, generation ve attempts=1 korundu; **588 okuma / 4 yazma**. Google isteği/site taraması tetiklenmedi. Hesap analitiği o anda 230.721 okuma / 19.728 yazma; kota ve yerel defter güvenliydi.

| İş | Doğal Cron zamanı (Türkiye) | Gerçek sonuç | Ek deneme | Cursor |
|---|---|---|---:|---:|
| 18 Ağustos page | 10.30.42 | blocked / INVALID_GSC_ROW_PAGE_WWW | 1 (attempts 1→2) | 0 |
| 18 Ağustos query | 11.00.43 | blocked / INVALID_GSC_ROW_PAGE_WWW | 1 (attempts 1→2) | 200 |

Kanıt: [10.31 gözlemi 40286263327](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/actions/runs/40286263327), [11.01 gözlemi 40289393422](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/actions/runs/40289393422). İki sync_runs kaydı da gerçek `trigger_source=cron`, status=failed. `rows_received=0` hata sonucu olup sıfır trafik anlamına gelmez. İki işe başka requeue yapılmadı. Eski veriler ve sorgu işinin 200 satırlık staging cursor'u korunur.

Ret kategorisi, Google yanıtındaki HTTP/HTTPS **www.mavibasim.com** hostunun mevcut strict origin doğrulamasına uymadığını gösterir. Ham URL/path, sorgu, metrik veya secret kaydedilmedi. Diğer alanların geçerli olduğu, www URL'nin canonical doğruluğu veya apex ile aynı sayfa olduğu iddia edilmez. Crawler/siteURL güvenlik kuralı gevşetilmedi, otomatik www→apex eşlemesi yapılmadı. Bu kapsam uyuşmazlığının veri/kanıt karıştırılmadan giderilmesi ayrı değişiklik gerektirir.

## Son doğrulanmış kapsam ve kota — 11.01 Türkiye

Birim gün × scope (page/query); tüm anonimleştirilmiş sorguların bulunduğu anlamına gelmez.

| Dönem | page | query | Toplam |
|---|---:|---:|---:|
| Temmuz | 0/31 | 0/31 | 0/62 |
| Ağustos | 19/31 | 19/31 | 38/62 |
| Eylül | 30/30 | 30/30 | 60/60 |
| **Toplam** | **49/92** | **49/92** | **98/184 (%53,26)** |

**86 birim eksik:** Temmuz'un tamamı, Ağustos 1–11 ve 18 (iki scope). Tam geçmiş/aylık rapor kabulü tamamlanmadı.

Aynı kayıtta gecikmeli hesap analitiği **586.390 / 5.000.000 okuma**, **20.677 / 100.000 yazma**, mode=open. Gerçek yerel defter **421.099 okuma / 9.121 yazma**. Sonuç gözlemi **575 okuma / 0 yazma**; iki gözlem toplamı 1.150 okuma, 0 yazma. Kota tablosunun o an görülen geçerlilik sonu **11.34 Türkiye**; sonraki iznin varlığı veya ilerleme bu eski kayıttan çıkarılamaz.

Devam mesajından sonra daha yeni kapsam/kota almak için `gsc-row-inspect` başlatma isteği otomatik onay denetimince reddedildi. Kaynak ve gerçek önceki **575-okuma/0-yazma**, statik 5 SELECT, 5.000 okuma ve 3 dakika sınırı kanıtı sonraki değerlendirmeye sunuldu; yeni Actions işi ve D1/kaynak tüketimi gerekçesiyle yine reddedildi. Reddedilen işlemler çalışmadı, D1/Google'a ulaşmadı; başka araç/endpoint ile aşılmadı. Daha yeni ölçüm için yalnız bu tek sınırlı, aktarım/requeue tetiklemeyen gözleme açık onay gerekir. Token/OAuth/ücretli plan gerekmez.

## Kalıcı durma için ayrıca saptanan risk — yayımlanmamış taslak

Mevcut `enqueueDaily` yeni UTC gününde eski blocked işleri yeniden açabiliyor. `processJob` bugün nonretryable hatayı blocked bırakır, fakat **gelecek günler için kalıcı durma garantisi yoktur**. PR #23 bu davranışı değiştirmez; yalnız PR #23 izni nedeniyle üretime başka kod alınmadı.

Ayrı `/tmp/seo-gsc-quarantine-review` checkout'unda GSC satır doğrulama hatalarını ertesi gün yeniden açmayan dar taslak hazırlandı. Yeni 5 test mevcut kodda **3 başarısız / 2 başarılı** sonuçla riski yeniden üretti; taslak + mevcut sync/scheduler regresyonları **30/30 başarılı**. Diğer bağlantı/geçici hataların günlük planlaması korunur. Cursor/generation/attempts ve hata kayıtları değişmez.

**UNPUBLISHED-daily-quarantine.patch** yerel rapor dizininde yalnız inceleme taslağıdır. Main/source PR/CI/üretim kabulüne alınmadı; yeni PR veya deployment oluşturulmadı. Gelecekte kalıcı karantina ve www veri kapsamı düzeltmeleri ayrı açık yayın yetkisiyle ilerletilmeli; satırlar sessizce atılıp gün complete sayılmamalıdır.


---

## Önceki hazırlık kaydı (tarihçe)

# 18 Ağustos GSC satır doğrulama incelemesi

26 Ekim 2026, aşama 1. Eski üretim verisi 96/184 hedef kapsam ve iki `INVALID_GSC_ROW` hatası gösteriyor. Eski hata tek kod olduğundan hangi koşulun reddettiği henüz bilinmiyor; ülke/CTR/URL nedenlerinden biri kanıtsız seçilmedi.

`gscRowIssue` mevcut kuralların aynısını alan kategorileriyle ayırır. `INVALID_GSC_ROW_DATE`, `PAGE_ORIGIN`, `COUNTRY`, `DEVICE`, `METRIC_NUMBER`, `COUNTS`, `METRIC_RANGE`, `CTR_RATIO`, `QUERY` yalnız sabit kodlardır. Ham Google satırı veya kişisel/gizli veri saklanmaz. Bozuk satır aynı şekilde fail-closed kalır, eski doğrulanmış küme korunur.

Mevcut Actions işletim iş akışında iki dar işlem: salt okunur inceleme ve yalnız 18 Ağustos legacy hata koduna sahip iki işin güvenli, bir kerelik tekrar kuyruğa alınması. Gerçek aktarım yine doğal Cron, tek sağlayıcı sayfası ve mevcut D1/GSC bütçeleriyle yapılır. Cursor/generation/attempts sıfırlanmaz. Yeni sınıflandırılmış hatalar tekrar açılmaz. Üretim commit/validation/read-guard kimliği, hesap analitiği ve geçerli kota izni olmadan kuyruk değişmez. İşlem ham metrik tablolarına veya OAuth kaydına erişmez.

Yerel 348 Workers + 104 Python başarılı; 14 yeni Workers ve 5 yeni Python kabul senaryosu dahil. SQL idempotansı gerçek geçici SQLite ile doğrulandı. Tip kontrolü/build ve kaynak güvenlik denetimi başarılı. Uzak CI ve gerçek tanı sonuçları sonraki aşamada bu rapora eklenecek. Canlı UI dosyaları, Cron yapılandırması, migration'lar ve CSV'ler değişmedi.


## Gerçek sonuç ve yayın engeli

Kaynak commit `a72e7fa`, PR #23 tam CI **40282140567 SUCCESS**: 348 Workers/D1 + 104 Python + 34 tarayıcı = **486 test**. npm audit ve kaynak koruma geçti. Gerçek salt okunur inceleme **40282015379**: 574 satır okuma / 0 yazma; 97/184 kapsam, 87 eksik. 18 Ağustos iki hata hâlâ blocked; gerçek alan nedeni bilinmiyor.

Otomatik onay denetimi, PR #23 için açık merge/yayın onayı olmadığını söyleyerek main birleştirmesini engelledi. İşlem dolaylı yoldan tekrarlanmadı; üretim main `f96f184` ve eski canlı sürüm korundu. Tanılama henüz yayımlanmadı ve iki iş yeniden kuyruğa alınmadı. Sonraki gerekli yetki yalnız bu PR'ın birleştirilmesi/kontrollü tanılama yayınıdır; token veya OAuth yenilemesi istenmez.

Kota gözlemi 09.48 Türkiye: hesap 226.273 okuma / 18.979 yazma; gecikmeli analitik. Yerel defter 89.777 okuma / 5.272 yazma. Korumalar korunur. Temmuz 0/62, Ağustos 37/62, Eylül 60/60; 09.30 Türkiye'de gerçek doğal Cron 12 Ağustos sayfa kapsamını tamamladı. 10.00 Türkiye sonraki planlı Cron slotudur, tamamlanma garantisi değildir. Yeni yetki olmadan gerçek hata düzeltildi denmez.
