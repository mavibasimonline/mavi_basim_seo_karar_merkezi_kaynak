Depodaki Keyword Planner arşivi için çalıştırılabilir bir SEO karar uygulaması bulunmuyordu. Bu değişiklik 521 özgün CSV ve 9.075 kaynak satırını izlenebilir olarak saklayan D1 şemasını, salt okunur Google/tarama adaptörlerini, kanıtla sınırlı karar motorunu ve kimlik doğrulamalı Türkçe paneli ekler.

`main` hedeflenir; otomatik birleştirme veya üretime dağıtım içermez. Üretime geçiş hazırlığı sırasında çalışan uygulamanın `src/` ve `public/` dosyaları korunmuştur.

- Kaynaklar değişmez: dosya SHA-256/satır/tarih korunur; tekrarlar ve varyant hacimleri toplanmaz.
- Eksik, eski veya hatalı Google verisinde karar durur. Mobil/masaüstü ayrılır; başarılı sorgular korunur. Sayısal sonuçlar bağımsız SQL hesabıyla denetlenir.
- İşler sayfalama, lease/fencing ve güvenli retry ile devam eder. SEO sürümleri ve öneri sonuçları izlenir. Canlı siteye yazma işlemi yoktur.
- Üretim hazırlığı: ayrı Workers/D1 yapılandırması; başlangıçta kapalı Cron/tarama; ücretsiz plan sınırları; OAuth yetkilendirme, ilk gerçek veri/tarama/aylık rapor kabulü ve geri dönüş yönergesi.
- Güvenlik: Vitest düzeltmesi ve Zod patch override; sıfır npm audit bulgusu; GitHub Actions SHA sabitleme, sınırlı izin, kapalı checkout kimlik bilgileri, lifecycle scripts olmadan kurulum ve kaynak/gizli değer kapıları.

Doğrulama komutları: `npm ci --ignore-scripts --no-fund`, `npm audit --audit-level=moderate`, `npm run check`, `npm run test:e2e`, üretim yapılandırmasıyla `wrangler deploy --dry-run`, `python3 scripts/release_checks.py --base origin/main`. Ayrıntılı sonuçlar `docs/RELEASE_REVIEW.md` içinde tutulur. GitHub Actions uzak sonucu ancak API erişimiyle doğrulanır; yerel geçiş uzak yeşil sonuç yerine gösterilmez.

Birleştirmeden önce gerçek PR CI sonucu kontrol edilmeli. Üretime geçiş ayrıca Cloudflare Free hesap/D1 yetkisi ve Google OAuth/GSC okuma izni gerektirir. Henüz gerçek Google bağlantısı veya üretimde çalışır sistem iddiası yoktur. Ücretli hizmet açılmaz; `mavibasim.com` route/DNS/içeriği değiştirilmez.
