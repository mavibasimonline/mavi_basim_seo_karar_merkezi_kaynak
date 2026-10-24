# Veri doğruluk ve tutarlılık denetçisi

Dal feat/veri-dogruluk-denetcisi, taban feat/seo-degisiklik-etkisi (PR #5). Mevcut provider doğrulayıcıları, aktif dataset/lease kuralları, kaynak aktarımı ve bağımsız hesap modülü genişletildi. Motor 1.2.2.

## Kaynakların ayrı denetimi

GSC page, GSC query, GA4 organic ve Keyword Planner ayrı kaynaklardır. Kaynak durumunda son başarılı veri zamanı, tarih aralığı, aktif kayıt sayısı, eksik günler, günlük sağlık ve senkron işi durumu gösterilir. GSC/GA4 için aktif dataset satır sayısı metadata ile karşılaştırılır; yinelenen aktif boyut ve hatalı kaynak metrikleri aranır. Sonuçlar kaynak/tarih/kayıt/beklenen/gerçek alanlarıyla kaydedilir; ilk 21 satır hata ayrıntısı sınırı vardır.

Kaynak başına incelenen dönem 50.000 satırı aşarsa sınırsız tarama yapılmaz: BOUNDED_AUDIT_PENDING ve kısmi durum gösterilir; gerçek kayıt sayısı bilinmiyorken sıfır yazılmaz. Büyük geçmiş için dataset bazlı sync-audit kayıtları kullanılır. Sınırsız geçmişin tek çağrıda denetlendiği iddia edilmez. Gerçek CPU/D1 günlük okuma bütçesi hesapta ölçülmelidir.

Her başarılı son senkron sayfası provider alan doğrulaması, lease kontrolü ve final dataset sayımı için immutable sync-audit kaydı üretir. Kısmi/başarısız yeni dataset eski başarılı aktif dataset'i veya eski denetim kaydını silmez. Yeni rapor talebinde SQL hesap denetimi ayrıca çalışır; günlük toplu rapor Cron'u eklenmedi.

## Bağımsız hesaplar

SQL ham aktif satırlardan toplam tıklama/gösterim, sum(clicks)/sum(impressions), sum(position*impressions)/sum(impressions) hesaplar. Ürün, cihaz, sorgu, marka/markasız, önceki dönem ve görünür UI sorgu alanları tek tek karşılaştırılır. Gün sayısı, tıklama/gösterim değişimleri ve koruma bayrakları ayrıca denetlenir. Aritmetik ortalamaların ortalaması alınmaz; NaN, sonsuz, negatif ve tutarsız CTR reddedilir. GSC/GA4 metrikleri eşitlemeye çalışılmaz.

GSC görünür sorgu toplamı sayfa toplamından farklıysa otomatik bozulma denmez: anonimleştirme, API sınırı, gecikme ve boyut filtreleri olası açıklamalar olarak belirtilir. Eksik sorgu sıfır trafik değildir. GA4 oturum ve etkileşimleri GSC tıklaması olarak sunulmaz.

## 521 CSV arşivi

Kompakt manifest dosya yolu, hash, ürün, satır sayısı ve dışa aktarım tarihini içerir. Worker DB metadata ve gözlem sayısını manifestle karşılaştırır. Worker orijinal dosya baytlarına erişmez; gerçek 521 CSV'nin SHA-256 ve 9.075 özgün satırı ayrıca Python/CI'da doğrulanır. Yeni test manifestin bütün orijinal dosyalarla eşitliğini kontrol eder. 29 ürün eşlemesi ve tekrar içe aktarım değişmezliği korunur. Aynı kelimenin farklı dosyalardaki hacimleri toplanmaz. Reklam rekabeti SEO zorluğu değildir. Dışa aktarım saat dilimi kaynakta yoksa uydurulmaz.

## Güvenilirlik ve panel

Doğrulandı, Kısmen doğrulandı, Veri yetersiz, Senkronizasyon hatası ve Kaynaklar arasında açıklanması gereken fark durumları desteklenir. Doğrulandı hesap/veri kapsamıdır; nedensellik veya tam Google sorgu listesi garantisi değildir. GSC kaynak/hesap hatasında sağlık kaydı başarısız işaretlenir ve SEO kararı durur. GA4/Planner hataları ayrı tutulur.

Tek ekrandaki Veri Sağlığı bölümünde kaynak kontrolleri, hatalı/eksik kayıtlar, metrik doğrulama, ürün güvenilirliği ve immutable denetim geçmişi gösterilir. Eski başarılı denetimler silinmez. Veritabanı ve OAuth anahtarları herkese açık endpoint'te bulunmaz.

Ek düzeltmeler: aynı milisaniyedeki başarısız sağlık kontrolü Koru önbelleğini kapatır; bitmiş son iki ayın son günleri günlük yeniden doğrulama kuyruğuna alınır. Böylece eski aylık veri 72 saat kapısına takıldığında ilgili doğrulama yenilenir. Ads işleri günlük yeniden alınmaz.

## Test sonuçları

48 yeni senaryo: 12 metrik sınırı, 10 kaynak/manifest ve tekrar durumu, 7 güvenilirlik durumu, 12 bağımsız SQL/UI/cihaz/sorgu/marka/oran/koruma bozulması ve 7 bütünleşik denetim. Normal sorgu gizliliği farkı, yanlış CTR sonrası güvenli duruş, aynı senkronun tekrarında tek makbuz, constraint/foreign key, aynı zaman damgasında cache güvenliği, kapanmış ay yeniden doğrulaması ve 29 üründe 50 D1 sorgu üst sınırı doğrulandı.

Son kontroller: **243 Workers/D1 + 21 Python + 2 mobil/masaüstü = 266 test başarılı**; tip kontrolü, dört migration, bağımsız geri yükleme, üretim dry-run, kaynak koruma ve npm audit (0 açık) başarılı. Son başarısız/atlanmış otomatik test yok. İki ekran boyutunda gerçek yerel 521/9.075 arşivi Doğrulandı, Google verileri Veri yetersiz olarak gösterildi.

## Gerçek bağlantılar

Gerçek GSC/GA4 OAuth, canlı site taraması, Cloudflare üretim ve gerçek 10 ms CPU/günlük D1 bütçesi doğrulanmadı. Pozitif Google sayıları yalnız izole test fixtures'ıdır. Gerçek hesap bağlantısı veya canlı sistem kabulü verilmedi. Kaynak CSV'leri ve canlı site değiştirilmedi; ücretli hizmet açılmadı.
