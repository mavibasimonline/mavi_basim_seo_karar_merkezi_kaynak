# Doğrulama kaydı

Son uygulama commit'i `f112b46`, karar motoru `1.1.1`.

- 42 gerçek yerel Workers/D1 testi geçti: kimlik doğrulama/OAuth/şifreleme; sağlayıcı doğrulaması, sayfalama, kota/retry, duplicate/fencing, backfill; tarama/robots/sürüm; bağımsız hesap; sağlık kontrolünde önbellek iptali; API ve öneri sonucu ölçümü.
- 8 Python/SQLite/Node testi geçti: bütün 521 CSV ve 9.075 satır; özgün SHA-256; idempotent aktarım; boş/sıfır/varyant; bozuk satır raporu; tam şifreli yedek geri dönüşü, yanlış anahtar ve bozulma reddi.
- 2 Chromium uçtan uca testi geçti: masaüstü ve mobilde gerçek kaynak veritabanı, giriş, 29 ürün, 521/9.075 sayıları, okunabilir kanıt/kaynak/geçmiş, soru, export, bağlantısız Google uyarısı ve çıkış. Yatay taşma/JS hatası yok.
- TypeScript ve Worker dry-run paketlemesi başarılı. Üretime yükleme yapılmadı.
- Üç migration gerçek yerel D1'e uygulandı. Ayrı HTTP denetimi 29 ürün / 9.075 satırı doğruladı; bağlantısız bütün ürünler Veri bekle döndü. Yerel Cron giriş noktası çalıştırıldı.
- Gerçek D1 export'u şifrelenip geri çözüldü ve ayrı geçici SQLite'a yüklendi: integrity=ok, foreign key hatası 0, ürün 29, kaynak 521, satır 9075.
- CSV'ler ve iki temel yönerge başlangıç commit'inden değişmedi. Üretim npm bağımlılıklarında denetim anında bildirilen açık 0.

Toplam 52 geçti, 0 başarısız, 0 atlanmış otomatik test. Gerçek Google/GA4/Ads erişimi, canlı tarama, üretim dağıtımı/Cron/uzak yedek, güncel ücretsiz kotalar ve GitHub Actions uzak koşu sonucu doğrulanmadı. Kod push'u çalıştı; Actions API sorgusu Forbidden döndü. Gerekli yetkiler ve somut devam adımı TODO.md'de.
