# Bağımsız SEO ve güvenilirlik denetimi

Denetim tabanı: main `b31d3b1` (GitHub verify=SUCCESS). Yöntem: kaynak kod incelemesi, bağımsız beklenen sonuçlarla 41 SEO/veri senaryosu, gerçek 521 dosyanın salt okunur aktarımı, D1 migration ve tarayıcı regresyonu. Senaryolardaki Google yanıtları sentetiktir; gerçek hesaba bağlanıldığı anlamına gelmez. Denetim aynı çalışma oturumunda yapılmıştır; ayrı bir dış kuruluş sertifikasyonu değildir.

## Bulgular ve düzeltmeler

Bu kapsamda kimlik ele geçirme düzeyinde doğrulanmış kritik açık bulunmadı. Aşağıdaki yüksek önem taşıyan veri/karar hataları düzeltildi:

| Önem | Bulgu | Düzeltme / kanıt |
|---|---|---|
| Yüksek | Eksik, eski veya gelecek tarihli GSC sağlık kontrolü kararları durdurmuyordu | 72 saat ve geçerli zaman kapısı; S30–33 |
| Yüksek | Kısmi yeniden aktarım önceki sağlam aktif dataset kaydını bozuyordu | Sağlam dataset korunur; başarısız kalite sağlık kaydı durdurur; S39 ve lease/sayfalama regresyonları |
| Yüksek | Marka artışı markasız kaybı gizleyebiliyordu | İki dönemde ayrı marka segmenti ve inceleme uyarısı; S26 |
| Yüksek | İlk 100 sorgu sınırı eski başarılı kelimeyi kaybettiriyordu | Korunan sorgular önce; kapsam kesilmişse Veri bekle ve değişiklik yasağı; S28–29 |
| Yüksek | Başlangıç URL'si canlı canonical doğrulaması olmadan karar alabiliyordu | Tarama doğrulaması yoksa Veri bekle; S34 |
| Orta | Büyük ortalama konum kaybı sabit tıklamada görünmüyordu | Her iki dönemde 500 gösterim, 3 konum ve %30 kayıpta yalnız İncele; S15–18 |
| Orta | Sayısal girişte NaN/negatif/tutarsız CTR engeli eksikti | Metrik doğrulaması; bağımsız doğrulayıcı sonlu olmayan sayıları ve kanıtsız İyileştir kararını reddeder; S21–23,38 |
| Orta | Eski GA4 kapsamı başarısız güncel bağlantıyla gösterilebiliyordu | GA4 sağlık/tazelik kapısı; S41 |
| Yüksek | Cron veya yedek secret'larının erken etkinleşme riski | Worker varsayılan kapalı AUTOMATION_ENABLED; yedekte ayrı PRODUCTION_BACKUPS_ENABLED; otomasyon/OAuth/release testleri |

Eşikler istatistiksel anlamlılık veya nedensellik değildir. Konum kaybı sorgu bileşiminden etkilenebilir; otomatik başlık/URL/içerik değişikliği üretilmez. Mevsimsellik yalnızca yıllık kapsamın varlığıyla elenmez.

## Test sonuçları

İlk 40 senaryoda **13 başarısız, 27 başarılı** sonuç alındı; başarısızlıklar düzeltmelerden önce yeniden üretildi. Son durumda **41/41 denetim senaryosu geçti**. `tests/audit.test.ts`: S01–24 küçük/büyük kayıp, CTR, örneklem, dönem, mevsimsellik, konum ve sayısal sınırlar; S25–29 cihaz, marka, çakışma ve kelime koruma; S30–35 bağlantı/zaman/URL; S36–41 neden iddiası, düşük ticari niyet, bağımsız doğrulama, aktarım, SQL enjeksiyonu ve GA4.

Son yerel koşu: **86 Workers/D1 + 20 Python + 2 mobil/masaüstü Chromium = 108 test başarılı**. Başarısız veya atlanmış otomatik test kalmadı. TypeScript, üç migration, idempotent içe aktarım, şifreli yedek/yanlış anahtar/geri dönüş, OAuth state ve ayrı GA4 consent testleri başarılı. `npm audit --audit-level=moderate`: 0 açık. Geliştirme ve üretim dry-run başarılı; kaynak koruma denetimi başarılı. Önceki ilk test başarısızlıkları yukarıda belgelenmiştir; gerçek hesap kabulü çalıştırılmadı.

## 29 ürünün kaynak denetimi

4 grup / 29 klasör / 521 dosya / 9.075 satır. Her kaynak dosyanın ürün-klasör eşleşmesi ve dosya adındaki dışa aktarım tarihi doğrulandı. 9.075 gözlemin her arama hacmi özgün hücreyle karşılaştırıldı; hacimler toplanmadı. 6.765 ürün+kelime, 1.300 yinelenen kelime, 1.678 ihracatlar arası özdeş gözlem. Bozuk satır 0; eksik değerler sıfır değildir. SHA-256 değerleri özgün kaynak denetimiyle birebir eşleşti. CSV, AGENTS ve proje talimatları değişmedi.

| Ürün klasörü | CSV | Satır | Dosya dışa aktarım tarihleri |
|---|---:|---:|---|
| adisyon | 15 | 153 | 2026-10-11 – 2026-10-11 |
| afis | 20 | 420 | 2026-10-08 – 2026-10-12 |
| ambalaj | 26 | 404 | 2026-10-11 – 2026-10-11 |
| amerikan-servis | 22 | 251 | 2026-10-09 – 2026-10-11 |
| antetli | 8 | 86 | 2026-10-08 – 2026-10-11 |
| arac-kiralama | 12 | 209 | 2026-10-04 – 2026-10-11 |
| bloknotlar | 22 | 247 | 2026-10-07 – 2026-10-11 |
| brosur | 44 | 741 | 2026-10-08 – 2026-10-12 |
| dosyalar | 22 | 251 | 2026-10-08 – 2026-10-11 |
| el-ilani | 16 | 266 | 2026-10-08 – 2026-10-12 |
| etiket | 36 | 885 | 2026-10-09 – 2026-10-11 |
| gider-makbuzu | 4 | 40 | 2026-10-12 – 2026-10-12 |
| karton-canta | 39 | 590 | 2026-10-07 – 2026-10-11 |
| kartvizit | 20 | 678 | 2026-10-08 – 2026-10-11 |
| kataloglar | 30 | 674 | 2026-10-03 – 2026-10-11 |
| kitap-ayraci | 6 | 115 | 2026-10-09 – 2026-10-09 |
| kup-bloknot | 20 | 246 | 2026-10-07 – 2026-10-11 |
| kutu | 25 | 892 | 2026-10-03 – 2026-10-11 |
| magnet | 27 | 380 | 2026-10-09 – 2026-10-11 |
| oto-paspas | 19 | 351 | 2026-10-09 – 2026-10-11 |
| para-makbuzu | 10 | 112 | 2026-10-06 – 2026-10-11 |
| recete | 6 | 61 | 2026-10-12 – 2026-10-12 |
| sigorta-policeleri | 3 | 30 | 2026-10-12 – 2026-10-12 |
| siparis-fisi | 15 | 187 | 2026-10-11 – 2026-10-11 |
| sozlesme-baski | 4 | 40 | 2026-10-12 – 2026-10-12 |
| tahsilat-makbuzu | 21 | 404 | 2026-10-03 – 2026-10-11 |
| tediye-makbuzu | 3 | 30 | 2026-10-12 – 2026-10-12 |
| yag-karti | 6 | 64 | 2026-10-09 – 2026-10-09 |
| zarf | 20 | 268 | 2026-10-08 – 2026-10-11 |

## Güvenlik ve üretim engelleri

OAuth salt okunur, state tek kullanımlık, refresh token AES-GCM şifreli; oturum ve tüm veri API'leri yetkili erişime kapalıdır. SQL değerleri bind edilir. 429/5xx için bekleme/yeniden deneme, günlük iş tekilleştirme, lease fencing ve ayrı şifreli geri dönüş test edilmiştir. Gizli değerler Git'e/loglara yazılmadı. Canlı siteye istek/değişiklik veya ücretli hizmet başlatılmadı.

Gerçek Cloudflare oturumu, D1 ID'si ve Google OAuth istemcisi/consent yok. Gerçek API, ilk senkron, robots/sitemap taraması, aylık rapor ve uzak yedek kabulü yapılmadı. 27 ürün URL'sinin gerçek eşlemesi, Workers Free 10 ms CPU ve günlük D1 bütçesi gerçek hesapta ölçülmelidir. Büyük sorgu kümelerinde bu sürüm güvenli biçimde bekler; tam sorgu toplulaştırmasını desteklediği iddia edilmez. İkinci bağımsız yedek hedefi/saklama politikası ve gerçek CMS yayın tarihi adaptörü henüz yok.

Devam eden ayrı istekler: Türkçe soru-cevap, fırsat radarı ve ayrıntılı değişiklik etki analizi ayrı dallar/PR'larla sunulacaktır. Bunlar bu denetim sürümünde tamamlandı sayılmaz. Hesap sahibinden yalnızca Cloudflare Workers Free yetkisi ile Google GSC (isteğe bağlı GA4) okuma/consent adımları gerekir; anahtarlar sohbette paylaşılmaz.
