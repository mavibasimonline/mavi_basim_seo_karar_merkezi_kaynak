# Profesyonel Türkçe panel — kabul kaydı

25 Ekim 2026 (Türkiye). Dal: `feat/professional-seo-dashboard`. Başlangıç main: `731c2ae`. Bu dosyayı içeren commit ve sonraki yayın kaydı `git log` ile izlenir.

## Uygulanan değişiklik

Mevcut Workers/D1 uygulamasının arayüzü yenilendi; yeni uygulama veya ikinci analiz motoru oluşturulmadı. Daraltılabilir masaüstü menüsü, mobil menü, Türkçe dönem/cihaz seçimi, veri güncelliği, dört KPI, günlük SVG grafik, ürün/sorgu filtreleri ve sıralama, fırsat radarı, değişiklik takvimi, veri sağlığı ve bağlamı koruyan soru-cevap aynı panelde bulunur. Eski/yeni SEO değerleri güvenli metin olarak gösterilir. Kanıt ayrıntıları mevcut API'lerden açılır.

Grafik ve sorgu tablosu için kimlik doğrulaması gerektiren salt okunur `/api/performance` ve `/api/performance/queries` eklendi. Yalnızca tamamlanmış, kesinleşme süresi dolmuş ve satır/metrik denetiminden geçen aktif GSC veri kümeleri kullanılır. CTR toplam tıklama / toplam gösterim; konum gösterim ağırlıklıdır. Eksik gün ve gözlenmeyen cihaz `null` kalır; gerçek ölçülmüş sıfır ayrı gösterilir. Eksik veya eski ay için tam aylık değişim yüzdesi üretilmez. Sorgu toplamları sayfa KPI'larının yerine geçmez; anonimleştirme ve kapsam sınırları açıklanır. Keyword Planner arşivi ayrı kalır.

## Başarılı kontroller

| Kontrol | Sonuç |
|---|---|
| Workers/D1 otomatik testleri | 284 başarılı; yeni performans API'sinde 18 senaryo |
| Python kaynak, aktarım, yedek ve statik varlık testleri | 42 başarılı; 521 CSV / 9.075 kaynak satırı dahil |
| Chromium masaüstü ve mobil | 8 başarılı; gerçek yerel API, grafik boşlukları/sıfırlar, filtre/sıralama/sayfalama, kanıt, soru, export, çıkış ve hata durumları |
| Erişilebilirlik | Giriş ve tüm panel bölümlerinde axe WCAG 2 A/AA, 2.1 AA ve 2.2 AA kontrolleri; ihlal yok. Klavye odağı, mobil menü ve daraltma test edildi. |
| Güvenlik | Oturumsuz veri istekleri 401; parametreli SQL, sıralama beyaz listesi, XSS metni, sırların URL'ye yazılmaması ve çıkışta özel DOM temizliği test edildi. Npm audit: 0 açık. |
| Paket ve kaynak koruma | Tip kontrolü, Worker build, üretim dry-run ve release denetimi başarılı. Migration, üretim ayarları, OAuth/senkron bütçesi ve kaynak CSV'ler değişmedi. |
| İstemci aktarım bütçesi | JS gzip 20.636 B + CSS gzip 8.709 B + yerel WOFF2 39.956 B = 69.301 B. Harici font/grafik servisi yok; Manrope OFL lisansı `public/fonts/OFL.txt`. |

Toplam **334 başarılı otomatik test**. Son koşuda başarısız/atlanmış test yok. Geliştirme sırasında yakalanan kontrast, mobil odak, fixture kapsamı ve geçmiş görünümü import hataları düzeltildi ve yeniden test edildi. Test sonuçları gerçek Google verisinin tam ay kabulü anlamına gelmez.

## Gerçek veri ve test verisinin ayrımı

- GitHub Actions **40125531435**, `frontend-check`: mevcut üretim D1 binding'ine yerel operatör üzerinden salt okunur erişimle yeni API hesaplarını bağımsız SQL ile karşılaştırdı. Gerçek gözlem bulundu, ağırlıklı metrikler ve cihaz filtresi eşleşti; eksik günler boş ve kısmi dönem karşılaştırması kapalı kaldı. Kaynaklar 29 ürün / 521 dosya / 9.075 satır olarak korundu. Sonuç yalnız güvenli boolean/kayıt sayıları içerir; sorgu metni, özel trafik sayıları veya anahtarlar artifact'e yazılmaz.
- Bu kontrol Google senkronu veya site taraması tetiklemedi; uygulamada herkese açık bir kontrol endpoint'i oluşturmadı. Mevcut localhost operatörü tek kullanımlık anahtarla çalışır.
- Grafik doluluğu, sayfalama ve risk etiketleri için tarayıcı testindeki HTTP fixture'ları yalnız test sürecindedir. Üretime/D1'e örnek veri yüklenmedi. Fixture ekran görüntüleri gerçek GSC analizi değildir.
- Özel üretim yönetici anahtarı alınmadı veya atlanmadı. Hesap sahibinin özel tarayıcı oturumunda uçtan uca gerçek aylık SEO kararı kabulü bu çalışma kapsamında doğrulanmadı. Eksik geçmiş aylar, GA4/Ads ve bağımsız uzak yedek gibi önceki sınırlamalar arayüz yenilenmesiyle tamamlanmış sayılmaz.

## Yayın kapısı

PR ve main CI başarılı olduktan sonra mevcut `production.yml` kullanılır: gerçek önceki Worker sürümü, aynı D1, kaynak sayıları, secret binding'leri, Cron/otomasyon ayarları ve ücretsiz kota payı ön kontrolde doğrulanır. Yayın `--keep-vars` ile yapılır; HTTP tam commit/sürüm kontrolü başarısızsa mevcut otomatik geri dönüş çalışır. Yayın sonrası gerçek kimlikler TODO kaydına eklenir. Canlı `mavibasim.com` içeriğine yazılmaz ve veri aktarımı durdurulmaz.
