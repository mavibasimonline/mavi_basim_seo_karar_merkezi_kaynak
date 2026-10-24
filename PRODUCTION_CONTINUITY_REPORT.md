# Gerçek üretim kabulü — 25 Ekim 2026, Türkiye

## Doğrulanan üretim sonuçları

- İlk salt okunur tanılama **40137124437**, 01:06 Türkiye: Google GSC 36 tamamlanmış iş, 324 bekleyen iş; API hatası yok. Temmuz 0/62, Ağustos 0/62, Eylül 12/60: toplam **12/184** günlük sayfa/sorgu veri kümesi. Eksik kapsam **172/184**; bunlar sıfır trafik değildir.
- GSC günlük rezervasyon 8.552/10.000; sonraki 1.500 rezervasyon sığmadığı için mevcut bütçe koruması bekletiyor. Hesap geneli ölçümü 76.850/100.000 yazma ve 992.836/5.000.000 okuma. Kaynaklar **29 ürün / 521 CSV / 9.075 satır**. AUTOMATION ve CRAWL true, Cron her dakika; Ads kapalı. Bu tarihli ölçüm hard kotanın tükendiği anlamına gelmez.
- Mevcut crawler'ın sınırlı gerçek kabul çalışmaları: **40137343925** en fazla 12 istekle 2→14 doğrulanmış ürün, **40137553462** 12 istekle 14→26; ikisi tüm 29 henüz doğrulanmadığı için kabulü başarısız/eksik döndürdü. **40137757129** yalnız 3 ek istekle **29/29 kabulünü geçti**. Son gerçek sayfa kaydı 01:16 Türkiye. Her üründe 200, self-canonical, gerçek title, 64 haneli body hash, static HTML snapshot ve URL doğrulama zamanı var. Orijinal arşiv sayıları önce/sonra aynı.
- Bu 27 ek tarama mevcut crawler'ın kontrollü localhost operatörüyle gerçekleştirildi. Bütün ürünler Cloudflare Cron tarafından kendiliğinden tarandı iddiası değildir. Düzenli otomatik tekrarın ayrıca sonraki gerçek Cron kayıtlarından doğrulanması gerekir. Sitemap veya self-canonical Google dizin kanıtı sayılmaz.
- Gerçek D1 kabulü **40137484150**: bağımsız KPI hesapları, sorgu metrikleri, cihaz filtresi, null günler ve kısmi dönem karşılaştırma koruması başarılı. Eylül raporu gerçek 29 ürünle hesaplandı: **3 küresel kanıt eksiği, 29 Veri bekle**, `full_month_accepted=false`. Eksik kanıtta karar üretmeme kontrolü geçti; tam aylık rapor kabulü **geçmedi**. Ham özel trafik/sorgu metinleri artifact veya Git'e yazılmadı; rapor motoru çalıştırması D1'e test raporu kaydetmedi. Özel canlı yönetici oturumu açılmadı.

## Mevcut altyapıda yapılan düzeltmeler

Tarama kuyruğunda zamanı gelmiş gerçek ürün URL'leri önce işlenir; retry tarihi ve lease koşulları korunur. GSC'de gerçekten görülen katalog ürünü URL'leri ayrı keşfedilir; URL klasör adından uydurulmaz ve taranmadan doğrulanmış sayılmaz. Seed ekleme tek SQL ifadesine indirildi. Robots, tarama aralığı, snapshot geçmişi, günlük GSC bütçesi, OAuth secret'ları ve üretim D1 şeması korunur. Yeni analiz/tarama modülü veya herkese açık operatör endpoint'i eklenmedi.

Mevcut tanılama workflow'u **03:07 ve 05:17 Türkiye saatlerinde** otomatik salt okunur kontrol yapacak şekilde düzenlendi. GitHub zamanlaması gecikebilir. Şifreli yedek yalnız önceki 05:17 ve ayrı opt-in şartında kalır; eksik yedek anahtarı uydurulmaz. Tanılama yeni gün bütçesini, 03:00 sonrasında gerçek tamamlanmış ve boş olmayan senkronu, ay kapsamını ve ürün snapshot'larını ayrı kaydeder. Gelecek zaman gelmeden `not_yet_due`, yeterli gerçek ilerleme yoksa `waiting_for_real_progress` döner. Google veya site isteği tetiklemez, bütçeyi yükseltmez.

## Testler ve kalan kapılar

- Yerel **286 Workers/D1 + 45 Python** başarılı; tip/build, npm audit 0 ve kaynak koruma denetimi başarılı. CI ayrıca mevcut 8 masaüstü/mobil kabulünü çalıştırır; tam sonuç PR #15 Checks kaydındadır.
- Yeni senaryolar: ürün önceliği retry sınırını aşmaz; gerçek GSC gözlemi olmadan ürün URL'si eklenmez; seed tekrarı kayıt çoğaltmaz; iki ürün veya boş envanter 29 ürün kabulünü geçemez; gelecek saat ve sadece yeni gün kaydı gerçek veri ilerlemesi sayılmaz; eksik tanılama tam raporu geçirmez.
- **25 Ekim 03:00 henüz gelmeden** yeni 60.000 bütçeyle gerçek devam gözlendi denemez. Mevcut Cron devam eder; yeni gün zamanı veya sağlık kaydı elle değiştirilmez.
- Temmuz–Eylül tam kapsamı ve gerçek dolu aylık rapor kabulü bekliyor. 184/184 olsa bile gün/satır bütünlüğü, tazelik, cihaz/marka, başarılı sorgu koruma, bağımsız hesap ve korumalı rapor kabulü gerekir. Ücretsiz günlük bütçe nedeniyle tamamlanma birden fazla gün sürebilir; kesin süre vaat edilmez.
- Sonraki somut adım: 03:07/05:17 tanılama artifact'inde `rollover`, `priority_coverage` ve `product_crawl` alanlarını incele; bütçe yenilenmesinden sonra gerçek iş/kapsam artışını önceki kayıtla karşılaştır. Eksik veride karar kapılarını gevşetme. Sonraki otomatik tarama kaydını kontrollü kabul çalışmasından ayrı tut.
- Şifreli uzak yedek için önceki bağımsız BACKUP_ENCRYPTION_KEY gereksinimi devam eder; bu görevde yeni yetki istenmedi. OAuth/Cloudflare mevcut izinleri çalışıyor. Oturumun kendiliğinden yeniden başlayacağı garanti edilmez.

PR **#15** kaynak commit'leri, güncel CI, gerçek operatör/tanılama koşuları ve son kontrollü yayın kaydını birlikte izler. Canlı siteye yazılmadı; ücretli plan başlatılmadı; kaynak CSV'ler değiştirilmedi.
