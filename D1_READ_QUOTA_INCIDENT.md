# D1 okuma kotası olayı — 25 Ekim 2026

**Durum: üretim kabulü bekliyor; sorun tamamen çözüldü sayılmaz.** Yerel düzeltmeler ve CI ayrı geliştirme dalındadır. Yeni uygulama veya migration üretime uygulanmadı. Kota 26 Ekim 2026 **03.00 Türkiye / 00.00 UTC** sonrasında yenilenir; bu tarihe gelindiği henüz gözlenmedi.

## Gerçek Cloudflare kanıtı

- Analitik ve Cron kontrolü: [40206287323](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/actions/runs/40206287323), 25 Ekim **18.18 Türkiye**. Hesap genelinde **5.065.792 satır okuma / 57.757 satır yazma**. D1 uygulama SQL'i çalıştırılmadı.
- Aynı işlemde mevcut Worker'ın `* * * * *` Cron'u **`*/15 * * * *`** yapıldı, geri okunarak doğrulandı. Worker kodu, D1 kayıtları, OAuth/secret'lar değiştirilmedi. Bu tek başına kök neden çözümü değildir.
- Sorgu şekilleri ve maliyetleri: [40206596248](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/actions/runs/40206596248). Yalnız GraphQL Analytics; ham Google satırları, bağlı parametreler veya secret'lar alınmadı. SQL sabitleri rapordan çıkarıldı.
- Workers Builds otomatik Git yayını denetleme isteği [40208570579](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/actions/runs/40208570579) HTTP **403** döndü. Bu erişimle otomatik yayının kapatıldığı iddia edilemez. Kota kapısını aşan Git otomatik yayınına yol açmamak için main'e birleştirme yapılmadı.

Toplamları aynı zamandaki farklı/sınırlı analitik sorgulardan birbiriyle tam eşitlemeyin. İlk 30 SQL şeklinin gözlenen toplamı 4.534.338 okumadır; tüm hesap kullanımının eksiksiz sorgu dökümü değildir. Adaptive analitik gecikebilir.

| Gerçek SQL ailesi | Gözlenen okuma | Açıklama |
|---|---:|---|
| Bağımsız metrik doğrulama | 2.062.536 | Sayfa, cihaz, sorgu ve marka hesaplarının tekrarları |
| Günlük veri kümesi doğrulama | 692.777 | Grafik/sorgu yüklenirken günlük satır ve metrik kontrolleri |
| Sorgu performansı / ham sorgu okuması | 652.765 | En pahalı tek şekil: 51 çalışma, 595.051 okuma |
| Sayfa performansı / ham sayfa okuması | 168.702 | Tekrarlanan rapor girdileri |
| Kaynak arşiv sayımları | 209.504 | Bunun 134.750'si 14 ayrı tam kaynak sayımı |
| İş kiralama / kuyruk seçimi | 134.164 | 142 çalışma, yaklaşık 944 okuma/çalışma |
| Öncelikli kapsam kontrolü | 131.398 | 889 çalışma; dakika başı tekrar gereksizdi |

## Kök neden ve düzeltilenler

1. **Rapor önbelleği operasyon kayıtlarıyla bozuluyordu.** Bütün `health_checks` kayıtlarının en yeni tarihi önbellek anahtarıydı. Her dakika değişen `sync-budget`, `scheduler` gibi kayıtlar kaynak verisi aynıyken analiz ve dört bağımsız SQL doğrulamasını yeniden başlatabiliyordu. Yalnız GSC/GA4 sağlık kanıtı geçersizleştirir. Gerçek başarısız sağlık/OAuth iptali hâlâ anında geçersizleştirir. Eşzamanlı aynı rapor istekleri tek hesaplamayı paylaşır.
2. **Performans ve Veri Sağlığı tekrar hesaplanıyordu.** Performans/sorgu sonuçları kaynak revizyonuyla en fazla 5 dakika önbelleğe alınır; ölçümün özgün zamanı korunur. Veri denetimi aynı doğrulanmış raporu ve aynı denetim makbuzunu kullanır. Başarısız hesap eski başarılı kaydı silmez.
3. **Kota yalnız yazmayı koruyordu.** Yeni hesap gözlemi ve atomik yerel okuma rezervasyonları Google çağrısı/SQL'den önce gerekir. İşlem maliyetleri D1 `meta.rows_read/rows_written` ile kaydedilir. SQL metni ve bağlı değerler maliyet tablosuna yazılmaz. Hata/eksik metadata rezervasyonu korur. Paralel sorgular tamamlanmadan rezervasyon iade edilmez. Beklenenden pahalı sorgu kota iznini kapatır.
4. **Yüksek hacimli toplulaştırmada çıktı LIMIT'i yeterli değildi.** Aktif veri kapsamı önceden kontrol edilir; üretimde kapsam başına 20.000 girdi satırını aşan analiz daha kısa dönem/bütçe gerektirir. Günlük aktif kapsamdan başlayan sorgular ve `(provider,scope,complete,day,...)` kapsayan indeks kullanılır. Arşiv sürümleri silinmez/toplanmaz.
5. **Dakika başı kapsam kontrolü kaldırıldı.** Eski dakika tetikleri artık D1/Google'a dokunmadan döner. Üretim her 15 dakikada en fazla bir 200 satırlık sağlayıcı sayfası işler. Üç olayın ikisi geçmişe, biri güncel verilere öncelik verir; kuyruk, generation, cursor ve retry korunur. Günlük 60.000 yazma koruması sürer; genel okuma/yazma koruması ayrıca uygulanır.
6. **Tarayıcı tüm GSC geçmişinden DISTINCT sayfa arıyordu.** Keşif son tamamlanmış sayfa veri kümesini kullanır; boş kuyrukta aynı envanter tekrar tekrar oluşturulmaz. Salt okunur robots/sitemap/ürün tarama korunur.
7. **Üretim ön kontrolü kullanım sorgusundan önce kaynakları sayıyordu.** Hesap kotası ve olayın UTC yenilenme sınırı artık her uygulama SQL'inden önce kontrol edilir. Büyük tanılama kota belirsiz/yüksekken bütün uygulama sorgularını atlar. Yayın kapısı gevşetilmedi; okuma eşiği 4 milyondan **3,5 milyona indirildi**. Migration için ayrıca 20.000 yazma güvenlik rezervi hesaplanır.

**Yanlış ilk hipotezler elendi:** CSV `source_id` sayımı zaten birincil anahtarla, ürün canonical eşlemesi zaten UNIQUE indeksle aranıyor. Bunlar için gereksiz indeks eklenmedi. Yerel EXPLAIN, önceki ana veri sorgularının da bazı planlarda aktif veri araması yapabildiğini gösterdi; bütün üretim sorgularının tam tablo taradığı iddia edilmez. Esas doğrulanmış neden tekrar hesaplamaları, gereksiz sıklık ve genel okuma bütçesinin yokluğudur.

## Kota sözleşmesi

- Ücretsiz planın 5.000.000 okuma / 100.000 yazma sınırı değiştirilmez. Uygulama hesap gözlemi + yerel rezervasyon toplamında **3.500.000 okuma / 85.000 yazma**, kendi günlük defterinde **2.000.000 okuma / 65.000 yazma** üst sınırlarını uygular. Muhasebe güvenlik payı dahil olduğundan daha erken durabilir.
- Mevcut CI Cloudflare secret'larıyla **saatlik** hesap geneli analitik kontrolü yapılır; Worker'a geniş yetkili Cloudflare token'ı veya yeni secret verilmez. Saatlik Actions işleri yaklaşık 720 çalışma/aydır; test/yedek işleriyle birlikte GitHub ücretsiz dakika bütçesi ayrıca izlenmelidir. Ücretli plan açılmaz.
- Boş/hatalı/gecikmiş analitik kullanılmamış kota değildir. İki saatten eski veriyle yeni izin verilmez. Kısmen gecikmiş/yüksek kullanımda ağır analiz durur ve aktarım tek sayfayla sınırlanır. Kota izni en fazla 75 dakika ve UTC gece yarısına kadar geçerlidir; geciken görev eski izni uzatmaz.
- Yerel tüketim hesap gözlemine eklenir; olası çifte sayım güvenlik yönündedir. Başka uygulamaların bu hesapta gözlem aralarında sınırsız tüketimini bu Worker engelleyemez. Analitik anlık/faturasız kesin kota sayacı gibi gösterilmez.
- Okuma korunması yalnız Cron'a değil, kimlik doğrulanmış API/rapor/aktarım/tarama yollarına da uygulanır. Düşük bütçede açık HTTP 429 gelir; sahte sıfır/SEO kararı üretilmez.
- `0005_d1_read_guard.sql` yalnız kontrol/önbellek/maliyet tabloları ve ölçülmüş ihtiyaç indeksleri ekler. `0006_sync_trigger_source.sql` eski runs kaydını `legacy` olarak ayırır; gerçek Cron kayıtları `cron`, pilotlar `manual` kaydedilir. Kaynaklar, Google kayıtları ve OAuth silinmez/değiştirilmez.

## Test ve mevcut kabul

- Workers/D1 sınır, eşzamanlı rezervasyon, eksik metadata, eski/güncel UTC izinleri, API 429, gerçek ölçümden iade, önbellek güvenliği, tek sayfa/fairness ve tetik kaynağı testleri eklendi.
- Python: kaynak/521 CSV, migration bütünlüğü, yedek/restore, hesap analitiği, kotadan önce SQL engeli, sorgu şekli gizliliği ve EXPLAIN testleri.
- EXPLAIN provası sentetik 9.000 GSC satırı, 30 arşiv generation ve 300 aktif satır kullanır; gerçek Google analizi değildir. Aktif veri araması, mevcut CSV/canonical indeksleri ve rapor indeksinin sıralama planı doğrulanır.
- PR #21'in `public/` ve `tests/browser/` dosyaları birebir korundu. 34 gerçek Chromium masaüstü/mobil testi geçti; yerel testler gerçek üretim GSC kabulü olarak gösterilmez.
- Son yerel sonuç: **334 Workers/D1 + 82 Python + 34 Chromium = 450 başarılı test**; audit 0, tip kontrolü, build ve üretim dry-run geçti. Tam commit/uzak CI TODO.md ve PR açıklamasındadır. Başarısız ilk denemelerde ortaya çıkan paralel rezervasyon kapasitesi, saatlik izin süresi ve test fixture eşleştirmeleri düzeltildi; yalnız son başarılı koşu kabul edilir.

## Kalan üretim kabulü — henüz yapılmadı

1. Kota yenilenmeden migration/yeniden aktarım/yoğun sorgu başlatma. Mevcut her 15 dakikalık Cron korunur.
2. Güvenlik kapısını atlayan Cloudflare Git otomatik yayını denetlenmeden main'e birleştirme yapma. API 403 için hesap sahibinin yalnız bu Build ayarını kapatması veya mevcut CI erişimine bu dar yetkiyi vermesi gerekir; secret/token sohbet veya Git'e yazılmaz. GSC OAuth yeniden kurulmaz.
3. Kota yenilenince gerçek hesap analitiğini doğrula; CI geçen tam commit ve gerçek 100% Worker UUID'si ile kontrollü yayın yap. İş akışı indeks/kontrol migration'larını uygular, güncel kota kaydı oluşturur, mevcut secret/binding'leri koruyarak yeni guard'ı açıkça etkinleştirir ve commit/flags'i geri okur. Yayın doğrulanamazsa eski Worker'a dönmeden önce/sonra Cron durdurulur; okuma koruması olmayan eski sürüm otomatik veri toplamaya bırakılmaz. Kuyruk ve veriler silinmez. `--keep-vars` nedeniyle yeni güvenlik bayrakları CLI ile ayrıca sabitlenir.
4. Sonraki doğal Cron'un **gerçek ve boş olmayan** GSC aktarımını izle. `d1_read_acceptance.py` yalnız metadata/EXPLAIN/maliyet/sync makbuzlarını okur; Google senkronu veya site taraması başlatmaz. Manuel pilotu otomatik çalışma saymaz. Saatlik kontrol bu kabulü ayrıca kaydeder; henüz gerçekleşmeyen başarı raporlanmaz.
5. En az bir sonraki hesap gözleminde gerçek okuma/yazma değişimini ve yerel maliyetleri karşılaştır. Aylık Temmuz–Eylül eksikliği ayrıca sürer; bu düzeltme aylık rapor kabulünü tamamlamaz.

Bu oturumun kota yenilendiğinde kendiliğinden devam edeceği garanti edilmez. Yeni kontrol/yayın iş akışları main'e alınmadan üretimde zamanlandığı söylenemez.
