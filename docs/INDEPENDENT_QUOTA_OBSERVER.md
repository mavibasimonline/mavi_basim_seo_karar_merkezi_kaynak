# Bağımsız Cloudflare kota gözlemcisi

Ana uygulamadan ayrı `mavi-basim-quota-observer`, Cloudflare Cron ile her saatin 02, 17, 32 ve 47. dakikalarında gerçek hesap D1 analitiğini kontrol eder. GitHub zamanlayıcısı çalışmasa da yenileyebilir. Mevcut GitHub gözlemcisi aynı kaydı kullanan yedek olarak korunur; uygulamanın `*/15` Cron’u değişmez.

Yalnız `d1_quota_state` kaydına indeksli bir upsert yapar. Yerel defter, kaynak veriler, OAuth, raporlar, migration ve site değişmez. 75 dakikalık izin, UTC gün sınırı, analitiğin iki saatlik üst yaşı ve mevcut hesap/yerel/işlem limitleri korunur. Düşen hesap ölçümleri sayacı azaltmaz; mevcut blocked durumu açılmaz. Eksik/bozuk/eski/gelecek kaynakta izin yenilenmez. HTTP işleyicisi 404; public route, workers.dev, preview ve ücretli kaynak açılmaz.

## Yetkiler

Gözlemci runtime’ında yalnız ilgili hesaba **Account Analytics:Read** yetkili ayrı `CF_QUOTA_ANALYTICS_TOKEN` bulunur. Geniş `CLOUDFLARE_API_TOKEN` runtime’a kopyalanmaz. Bu ayrı secret, GitHub deposunun Actions secrets bölümünde aynı adla saklanır; kontrollü kurulum yalnız yeni Worker’a aktarır. Hiçbir token sohbet, dosya, artifact veya log çıktısına yazılmaz.

Mevcut CI dağıtım kimliğinin **Billing:Read** yetkisi yalnız ücretsiz Workers planını API’den doğrulamak için gerekir. Billing:Write ve token yönetimi yetkisi istenmez. Runtime token’ına Billing yetkisi eklenmez. Eksik yetkide yayın durur; gerçek ücretsiz plan doğrulaması varsayılmaz.

## Kontrollü yayın

`Bağımsız Cloudflare kota gözlemcisi` workflow’unda `inspect` salt okunurdur. `deploy` yalnız main’in tam başarılı CI SHA’sında çalışır. Canlı uygulama kaynağı `8b56115f52ef2e7690927614365165ade4bfbdaa` olarak kilitlidir; tüm ana uygulama binding’leri, Worker sürümü ve Cron başlangıç/sonuçta karşılaştırılır. Ana uygulama tekrar yayımlanmaz.

Yayın kapıları: ayrı secret; gerçek güncel kota analitiği; ücretsiz plan; hesap genelinde en çok 5 Cron ve 100 Worker sınırına uyum; değişmeyen D1 binding ve canlı limit kaynakları. Önce yeni Worker kapalı ve Cron’suz yüklenir, sonra yalnız ayrı Analytics:Read secret’ı atanır ve etkin sürüm yayımlanır. Gerçek Cloudflare scheduled logu, doğru commit/sürüm, başarılı checkpoint ve D1 maliyeti kabul edilmeden tamamlandı denmez. İlk Cron dağılımı için en fazla 32 dakika beklenir; public/manual yenileme endpoint’i yoktur.

Başarılı gerçek scheduled yürütme ve kalıcı güncel izin sonrasında mevcut korumalar altında gerçek D1 Ürün Performansı, Arama Sorguları ve Broşür GSC kabulü çalışır. Hata halinde yalnız gözlemcinin zamanlaması durdurulur; uygulama Cron’u ve sayaçlar korunur. Geri alınan etkin gözlemci için otomatik tekrar yoktur; yeniden kurulum ayrıca doğrulanır.

Günde 96 gözlem: en çok 96 sağlık GET, 96 GraphQL ve 96 küçük PK upsert. Upsert başına 10 okuma/10 yazma doğrulama tavanıyla ek muhafazakâr maliyet 960/960’dır; ölçülmüş üretim tüketimi değildir. Ücretsiz planın 100.000 istek/gün ve 10ms CPU sınırı yükseltilmez; gerçek scheduled sonucunda CPU hatası kabul edilmez. Hesap veya Cloudflare arızasında güvenli bekleme korunur; sınırsız erişim garantisi verilmez.

Resmî sınırlar: https://developers.cloudflare.com/workers/platform/limits/
Plan: https://developers.cloudflare.com/workers/platform/pricing/

## Mevcut hazırlık engeli

Gerçek salt okunur ön kontrolde ayrı Analytics:Read secret’ı yoktur; CI kimliğinin Billing:Read erişimi de yoktur. Bu iki kullanıcı kurulumu tamamlanana kadar bir canlı gözlemci etkinleştirildiği veya kesintisiz erişim sağlandığı iddia edilmez. Uygulama sürümü korunur.
