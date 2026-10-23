# Main/üretim geçiş denetimi

Bu çalışma yeni ürün özelliği içermez. Başlangıç HEAD'i `f87dd2f`; çalışan uygulamanın `src/`, `public/`, migration'ları ve içe aktarma mantığı korunur. `main` ile ilk fark 49 eklenen dosya/6 commit idi; main'e ait dal dışında kalan commit yoktu. Fetch ve `git merge-tree --write-tree origin/main HEAD` çatışmasız sonuç verdi. Bu, PR'nin oluşturulduğu veya main'e birleştirildiği anlamına gelmez.

## Doğrulanan kontroller

| Kontrol | Sonuç |
|---|---|
| Frozen kurulum, lifecycle scripts kapalı | `npm ci --ignore-scripts --no-fund` başarılı |
| Tüm npm bağımlılıkları | `npm audit --audit-level=moderate`: 0 bulgu |
| Workers/D1 regresyonu | 42 test geçti |
| Python kaynak/yedek/üretim kapıları | 16 test geçti |
| Mobil ve masaüstü Chromium | 2 test geçti |
| TypeScript, geliştirme ve ayrı üretim dry-run paketlemesi | Başarılı; dağıtım yapılmadı |
| Üretim yapılandırmasıyla ayrı yerel D1 provası | 3 migration, 4 grup, 29 ürün, 521 kaynak, 9.075 satır, 6.765 ürün+kelime |
| Kaynak/kimlik bilgisi/yapılandırma kapısı | `release_checks.py --base origin/main` geçti |
| Gerçek kaynaklı yerel uygulamada disconnected kabul CLI'si | 7 HTTP/veri koşulu geçti; bu gerçek üretim kabulü değildir |
| Google'sız veritabanında sync/month SQL'i | Eksik veri boş veya eksik gün olarak raporlandı; gerçek veri analizi iddia edilmedi |
| Orijinal CSV ve iki temel yönerge | Değişmedi |
| PR / GitHub Actions erişimi | [PR #1](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/pull/1) oluşturuldu; check sonuçları GraphQL üzerinden okunuyor. Son HEAD için verify=SUCCESS birleştirme kapısıdır. |

Toplam **60 otomatik test** geçti; bu sonuçlar yerel çalıştırmalardır. Gerçek hesap/kota/CPU/OAuth/tarama/aylık rapor kabulü geçirilmiş sayılmaz.

## Güvenlik düzeltmeleri

Tam npm taramasında ilk durumda 2 yüksek/2 orta düzey bağımlılık uyarısı vardı: Vitest/mocker dosya okuma-kod enjeksiyonu ve test eklentisinin Zod bağımlılığında bellek tüketimi. Bunlar üretim Worker paketinin iki runtime bağımlılığı değildi; yine de CI/geliştirme güvenliği için giderildi. Vitest `4.1.0 → 4.1.12`; Cloudflare test eklentisinin Zod bağımlılığı uyumlu patch `4.6.6` olarak scoped override ile sabitlendi. Doğrulama kapatılmadı, audit bulgusu bastırılmadı. Patch sonrası frozen kurulum, bütün regresyon ve audit tekrar geçti.

- [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9)
- [GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8)
- [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)

Actions checkout/setup-node/setup-python/upload-artifact sürümleri resmi Git depolarındaki v4/v5 tag commit'leriyle sabitlendi. Checkout kalıcı kimlik bilgisi yazmaz, workflow izinleri contents:read ile sınırlı, branch/PR eşzamanlı koşuları aynı grupta iptal edilebilir. Kurulum lifecycle script'leri çalıştırmaz. CSV ve doküman değişikliği CI'yi atlatmaz. Git'e giren dosyalarda bilinen token/private key/dotenv biçimleri için değer göstermeyen hedefli tarama eklendi; bu kapsamlı bir sızma testi veya gizli anahtar kasası değildir.

## Üretim kapıları

`deploy/wrangler.production.jsonc` ayrı Worker/D1 içindir. İlk Cron boş, tarama/Ads kapalı, canlı site route'u yok. `release_checks.py --ready` mevcut yer tutucular nedeniyle bilinçli olarak geçmez; gerçek D1/callback ve hesap Free kontrolü gerekir. Bu denetim bir hesap veya fatura izni vermez. İşletim aşamasında belgeli 15 dakika Cron/tarama ancak gerçek hesap kabulünden sonra açılır.

Cloudflare Free sınırları resmi doküman GitHub deposunun `a19cd5d3c8d08792cb462d83606474ff7b84fe2e` commit'inden doğrulandı. Kaynaklar ve kotalar `docs/PRODUCTION.md` içinde. Hesapta kalan kota ve 10 ms CPU uyumu gerçek ölçüm bekler; ücretli plana geçiş çözüm olarak uygulanmaz.

Kabul dosyaları:

- `docs/PRODUCTION_ACCEPTANCE.md`: gerçek güvenlik, ilk GSC günü, ilk salt okunur tarama, aylık veri kapsamı, CPU/D1 ve geri dönüş kapıları.
- `scripts/accept_production.py`: yalnızca ayrı uygulamaya GET, yönlendirmede anahtar göndermez, eksik veride blocked çıkışı. Gerçek veri senkronunu veya site değişikliğini tetiklemez.
- `deploy/acceptance-source.sql`, `acceptance-sync.sql`, `acceptance-month.sql`: yalnızca okuma; token içeriğini göstermez.

## Kullanıcı yetkisi bekleyenler

1. Cloudflare Workers Free hesabı, dar kapsamlı D1/Worker secret yetkisi ve ayrı workers.dev hesap alt adı. Bu oturumda uzak kaynak oluşturulmadı.
2. Google Cloud OAuth istemcisi, mevcut GSC mülk okuma izni ve bir defalık consent. Secret değerleri sadece güvenli ayarlara girilmeli.
3. Bağımsız yedek anahtarı ve yalnızca gerekli D1 okumasına izinli yedek erişimi.

İlk REST API istekleri ve sandbox dışı read-only deneme proxy 403 aldı. Mevcut kimlikle GraphQL kullanılarak PR oluşturma ve uzak check sorgusu başarılı oldu. Bu GitHub engeli için kullanıcıdan ağ değişikliği veya yeni token gerekmiyor. PR açıldığında aynı branch/PR eşzamanlılık politikası önceki koşuyu iptal edebilir; CANCELLED koşu başarısız kabul testi değildir, güncel verify koşusunun tamamlanması beklenir.

Main'e birleştirme, canlı site değişikliği, ücretli plan/hizmet açma, Google bağlantısı veya üretim yayını yapılmadı. Yerel sonuçlar bu işlemlerin yerine sunulmaz.
