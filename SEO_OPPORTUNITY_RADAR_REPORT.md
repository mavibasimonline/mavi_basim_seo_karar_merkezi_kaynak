# SEO Fırsat Radarı kabul raporu

Dal feat/seo-firsat-radari, taban feat/turkce-soru-cevap (PR #3); bağımlı PR sırası #2 → #3 → bu radar PR'ıdır. Önceki modüller korunur; aynı ortak analiz, kaynak ve doğrulama motoru kullanılır.

## Çalışanlar

Son 28 kesinleşmiş gün/önceki eşit 28 gün, görünür markasız ticari sorgular, 8–20 ortalama konum, CTR aralıkları, yükselen/gerileyen ürünler, mobil/masaüstü konum farkı ve olası sorgu çakışması gösterilir. Ticari sorgudaki görünürlük kaybı ayrıca uyarılır. Ortalama konum tekil sıra değildir; iki URL görünmesi kanibalizasyon kanıtı değildir.

Öncelik bileşenleri: veri yeterliliği 0/10, ticari ifade 0/15, sıralama potansiyeli 0/20, düşük CTR 0/20, son dönem artışı 0/15, son 28 günde tespit edilen SEO değişikliği 0/-10. Sayıların girdileri, formülleri ve kanıtı sonuçta saklanır; puan gelir veya başarı olasılığı değildir. Sadece ticari kelime bulunması fırsat oluşturmaz. Düşük hacimde konum/CTR puanı verilmez; eksik/eski/kanıtsız veride puan null kalır. Başarılı kelime uyarıları korunur.

CTR karşılaştırması betimleyici %95 Wilson aralıklarıyla yapılır. SEO gösterimleri bağımsız deney örnekleri değildir; aralık ayrışması kesin neden/anlamlılık garantisi sayılmaz. Ürün/cihaz/sorgu bileşimi ve mevsimsellik ayrıca araştırılmalıdır. Artan gösterim ve düşen CTR tek başına başarısızlık değildir.

Her kelimenin en son Keyword Planner gözlemi ayrı gösterilir; ürün başına en fazla beş örnek talep kaydıdır, tam arşivin özeti veya toplam pazar büyüklüğü değildir. Kaynak dosya/satır/hash/dışa aktarım/kapsam korunur. Hacimler ve varyantlar toplanmaz; reklam rekabeti SEO zorluğu değildir. Bilgi/ücretsiz niyeti ticari puan alamaz.

Panelde ilk 5 fırsat, dikkat gerektiren 5 ürün, yükselenler, gerileyenler ve veri yetersizliği listeleri ile Kanıtları Gör açılırları vardır. Aktif görünür panelde açık radar beş dakikada bir güncellenir. Backend yeni başarılı dataset/sağlık/URL/kaynak değişiminde önbelleği geçersiz kılar; talep anında yeni analizi üretir. Bilgisayar kapalıyken ayrıca radar hesaplayan bir Cron eklenmedi; veri toplayıcı mevcut kontrollü Cron'dur. Eski sonuç yeni tarih verilerek gösterilmez.

Dördüncü migration insight_runs değişmez sonuç arşivini ekler. Kural sürümü, analiz ID'si, girdi özeti/hash ve tam açıklanabilir sonuç saklanır. Eski başarılı sonuç silinmez. Yeni snapshot olmadan eski sonuç güncelmiş gibi kullanılmaz.

## Test

34 otomatik senaryo: kanıt/kapsam/URL/örneklem kapıları, marka, bilgi niyeti, bilinmeyen niyet, 8/20 konum sınırları, kayıp sorgu, sıfır baz, beş ticari ifade, Wilson'ın bağımsız bilinen sınırları, CTR yanılgısı, 28 gün eğilimi, SEO geçmişi indirimi, cihaz ayrımı, Planner puan bağımsızlığı, bileşen toplamı/ilk 5 sınırı, immutable/yenilenen snapshot, bağlantısız dürüst sonuç. Sorgu kaydı eksik ama ticari kelime bulunan üründe fırsat üretmeme şartı ayrıca doğrulandı.

Son regresyon: **156 Workers/D1 + 20 Python + 2 mobil/masaüstü = 178 başarılı test**. Tip kontrolü, dört migration, kaynak/geri yükleme, geliştirme ve üretim dry-run başarılı. Radar gerçek yerel panelde iki ekran boyutunda açılıp eksik veri listesi doğrulandı. Son başarısız/atlanmış otomatik test yok. CSV'ler ve temel talimatlar değişmedi.

## Gerçek veri sınırı

Gerçek GSC/GA4/Cloudflare bağlantısı yok; pozitif fırsat senaryoları test fixtures'ıdır. Gerçek sitede fırsat, ticari niyet veya kazanç doğrulandığı iddia edilmez. Gerçek 28+28 günlük kapsam, API sağlığı, URL/canonical taraması ve Free CPU/D1 bütçesi hesap sahibi yetkileri geldikten sonra kabul edilebilir. Puan otomatik site değişikliği başlatmaz. Hiçbir ücretli API/plan eklenmedi.
