# PROJE_TALIMATLARI.md — Ürün ve kabul şartları

## Ürün hedefi
Mavi Basım Matbaa & Reklam için tek ekranlı, mobil/masaüstü uyumlu, Türkçe SEO karar merkezi. Kullanıcı her ay sadece rapor okur veya 'Broşür neden bu ay düştü?', 'Magnet mobilde mi geriledi?', 'İstanbul neden farklı?', 'A5 broşür fiyatları işe yarar mı?', 'Neye dokunmayalım?' diye sorar. Verileri kendi yüklemez. Ücretli servis istemez, bilgisayara bir şey kurmak istemez. Uygulama bağımsız bulut görevleri ile bilgisayar kapalıyken günlük çalışır.

## İlkeleri
- Önce keşif/SEO envanteri; sonra veri; sonra karşılaştırma; kanıt denetimi; son olarak karar.
- Düşüş ≠ hata: etki büyüklüğü, örneklem, geçmiş 3/6/12 ay, yıl bazlı talep, marka/markasız, mobil/masaüstü ve URL düzeyi ayrıştır.
- Koru / İncele / İyileştir / Veri bekle kararları. 'Dokunma listesi' başarı kriteridir.
- Analiz API'si deterministik hesaplama yapmalı; doğal dil arayüzü bu sonuçlara dayanmalı. Ücretli LLM zorunlu olmamalı. Ücretsiz doğal dil çözümleme sınırları belirtilmeli.
- SEO önerileri sitenin içeriğini kendiliğinden değiştirmeyecek.
- Veri saklama ve uygulama birbirinden ayrılacak; değiştirilebilir hizmet sağlayıcısı katmanı ve dışa aktarılabilir veri.
- Sadece gerçek kaynakla desteklenen iddialar. Nedensellik yoksa 'ilişkili olabilir' ve elenen diğer açıklamaları belirt.

## Veri kaynakları ve sınırları
1. Google Search Console Search Analytics API: page/query/date/device/country; günlük click, impression, CTR, impression-weighted average position; geçici/eksik günleri yeniden uzlaştır. Tüm sorguları döndürmeme ihtimaline karşı eksik kayıt notu tut.
2. Google Analytics 4 Data API (bağlanırsa): şehir, cihaz, organic session/engagement ve gerçekten tanımlanmış conversion; GA4 metriğini GSC click/sorgu metriğiyle eşdeğer sayma.
3. Keyword Planner CSV/Excel: depodaki ürün alt klasörlerini salt-okunur keşfet. Dosya tarihini, ay kapsamını, lokasyon/dil/arama ağını, orijinal hücre/satır verisini, her kelimeyi ve sıfır/boş farkını kaydet. Aynı kelimenin yinelenen ihracatlarını veri kaynağına göre ayrıştır, hacimleri toplama. Google Ads API erişimi gerekli ve geçerliyse opsiyonel otomatik senkron; yoksa yeni veriler çekildiğini iddia etme.
4. Site tarayıcısı: sitemap, dahili link keşfi, robots politikasına saygı, durum kodu, canonical, index directives, title/meta, H1–H6, içerik özeti ve hash, hreflang varsa, yapılandırılmış veri, iç linkler, görsel alt metni, mobil teknik kontroller mümkün olduğunca; tarama sayısı/sıklığını sınırla. JS render gerekli olduğunda eksik kapsam bildir.
5. CMS/deploy değişiklik logu: yetki varsa gerçek yayın zamanı; yoksa önceki-sonraki crawl aralığı. SEO snapshot'ları değişmez sürüm kayıtları olmalı.

## Başlangıç mimarisi (ücretsiz kota şartıyla doğrula)
- Cloudflare Workers: Türkçe web paneli, API, zamanlanmış görevler.
- Cloudflare D1: ilişkisel kalıcı veri (migrations, constraints, indexes, keyset pagination).
- Cron: günlük senkron ve sitenin kapsamlı taramasını küçük, idempotent parçalara ayırma; retry/backoff ve görev kaldığı yerden devam.
- R2/alternatif arşiv gerekirse ücretsiz kota/maliyet kontrolü; ücretsiz devamı garanti edilemeyen hizmetleri otomatik etkinleştirme.
- Google OAuth en az yetki; gizli token'lar şifrelenmiş ve sunucu tarafında; tek yetkili kullanıcı için güvenli erişim. API'leri kullanıcı hesabına bağlamak için bir kere etkileşim gerekebilir.
- Düzenli yedek + geri yükleme testi; düz JSON/CSV export desteği. Hassas veriler public GitHub'a gitmez.

## Veri modeli — asgari
products, product_groups, pages, page_aliases, keyword_catalog, keyword_sources, keyword_metric_observations, gsc_daily_by_page, gsc_daily_by_query_device, ga4_daily_by_city_device (bağlanırsa), crawls, seo_snapshots, seo_change_events, analysis_runs, evidence_refs, recommendations, recommendation_outcomes, sync_runs, sync_errors, user_questions, backups_manifest.
Anahtar: ürün, normalize edilmiş kanonik URL, sorgu, ülke, cihaz, tarih, kaynak ve boyutlar. Kaynak satırları ve zamanları izlenebilir olsun.

## Ürün grupları
1. Broşürler & El İlanları: Broşür (/brosur), El İlanı (/el-ilani), Afiş.
2. Reklam Ürünleri: Magnet, Kitap Ayracı, Yağ Kartı, Etiket, Amerikan Servis/Tepsi Altı, Oto Paspas, Kutu, Ambalaj.
3. Kurumsal: Kartvizit, Zarf, Antetli Kağıt, Dosya, Katalog, Bloknot, Küp Bloknot, Karton Çanta.
4. Makbuz & Formlar: Adisyon, Sipariş Fişi, Perakende Satış Fişi, Para Makbuzu, Sözleşme, Sigorta Poliçeleri, Tahsilat Makbuzu, Araç Kiralama, Gider Makbuzu, Giriş Bileti, Reçete, Tediye Makbuzu, Tüm Makbuz İşleri.
Yeni ürün kod kopyalamadan eklenebilmeli.

## Görünür ürün
Tek ekran: dönem seçimi, veri güncellik durumu, ürün bazlı yükseliş/düşüş, koru/incele/fırsat/veri bekle, en önemli üç işlem, sorgu kutusu, ayrıntı açılır kanıt listesi. Kasıtlı olarak sade ve Türkçe. Soru yanıtı veri kaynağı, tarih, filtre ve kanıtla birlikte gelmeli. Önizleme verileri DEMO ibaresi taşır.

## Testler — bitmiş sayılması için
- 2→1 tıklama ciddi kriz sayılmıyor; 200→100 daha ciddi olabilir, ancak talep/cihaz araştırılıyor.
- Gösterimler büyürken CTR düşüşü otomatik başarısızlık sayılmıyor.
- 'broşür baskı' / 'broşür baski' varyant hacimleri toplanmıyor.
- '/brosur' ile '/el-ilani' sorgu eşleşmesi doğru, yanlış yönlendirme önerilmez.
- GSC 2026-10-31 gününü dönem tamamlanmadan kesin rapora sokmaz.
- Eksik sorgu satırı sıfır tıklama diye raporlanmaz.
- Tarihli yayın kanıtı yoksa yalnızca taramalar arası değişim aralığı bildirilir.
- GA4 bağlantısızken şehir seviyesinde organik arama sorgusu iddiası yapılmaz.
- Backfill/idempotent sync, gecikmeli güncelleme, OAuth kesintisi, API quota, hata kurtarma testleri.
- Çıktıda kanıt gösterimi; kanıtsız SEO kararını reddetme; veri yetersizse öneri sunmama.
- Tüm testleri CI'de çalıştır; başarısızlıkları raporla.

## Teslim tanımı
Çalışan kaynak kodu, migration'lar, API / OAuth, otomatik cron, içe aktarma, testler/CI, README ve deploy yönergesi. Gerçek Google bağlama ve hosting için hesap yetkisi gerekirse bunu dürüstçe belirt. Kod yazıp ekran görüntüsüyle 'canlı' olduğunu iddia etme. Bitmeyen işlerin açık listesi ve gerçek test çıktıları bulunmalı.

## Bağlam / önceki kararlar
Site filtresi: https://mavibasim.com. SEO uygulaması Keyword Planner ile Search Console'u ayrı kaynak olarak tutar. Reklamveren rekabeti organik SEO rekabeti değildir. Yeni sayfa URL'si veya doğrulanmamış SEO iddiası uydurma. Kullanıcı site düzenlemesinden önce kanıt ve risk görmek ister; 'en ucuz', 'acil' gibi doğrulanmamış ticari iddialar üretme. Tek ekran haricinde karmaşık operasyon arayüzü istemez.
