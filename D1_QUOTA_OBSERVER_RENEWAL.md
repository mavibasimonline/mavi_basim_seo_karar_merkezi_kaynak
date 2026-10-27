# D1 kota gözlemcisi yenileme fırsatları

Saatlik GitHub zamanlanmış görev gecikir veya teslim edilmezse, kısa ömürlü kota izni bitebilir. Worker bu durumda veri toplamayı güvenli biçimde durdurur. Bu değişiklik aynı korumalarla daha fazla yenileme fırsatı sağlar; izin süresini uzatmaz veya süresi dolmuş izni geçerli saymaz.

## Davranış

- Mevcut `7 * * * *` gözlemci tetiklemesi korunur; `22,37,52 * * * *` hafif yedek tetiklemeleri eklenir.
- Her deneme önce gerçek Worker okuma korumasını ve hesap genelindeki taze analitiği doğrular. Mevcut hesap sınırları, 75 dakikalık/UTC gece yarısıyla sınırlı izin, hata halinde durma ve atomik yerel bütçeler değişmez.
- Yedek tetikleme yalnız mevcut küçük kota kaydını günceller; Google aktarımı, tarama, job reset veya geçmiş veri sorgusu başlatmaz. Daha ağır mevcut kabul sorguları yalnız ana saatlik tetiklemede veya açık manuel istekte kalır.
- Beklenmeyen event/schedule, ağ veya D1 isteğinden önce reddedilir. Eksik analitik, dolu kota veya doğrulanamayan canlı guard, yedek denemede de izin yenileyemez.
- Bu GitHub gözlemcisi değişikliğidir. Veri toplayan Worker'ın `*/15 * * * *` Cron'u, D1 şeması, OAuth, kullanıcı arayüzü ve kaynak arşivi değişmez. Worker yayını veya migration gerektirmez.

Günde en fazla 72 ek küçük kota güncelleme fırsatı oluşur; ağır kabul sorgularının normal takvimi artmaz. Aynı GitHub platformunun zamanlama teslimi yine garanti edilemez. Uzun platform kesintisinde güvenli bekleme sürer; bu düzenleme bağımsız bir zamanlayıcının garantisi olarak sunulmaz.

## Doğrulama ve uygulama sınırı

Beş yeni politika testi: ana/manuel/yedek kabul ayrımı, tek küçük güncelleme, geçersiz event'te sıfır istek, dolu/eksik kota ve canlı guard yokluğunda sıfır yazma; Worker Cron ve koruma yapılandırması korunur. Yerel tüm Python paketi **126/126 başarılı**. Tam dal CI'si PR'da izlenir.

Üretimde yedek tetikleme henüz denenmedi; PR hazırlamak uygulanmış sayılmaz. Bu dalda üretim yayımlama, migration, veri yeniden aktarımı veya kota-state yazması yapılmadı. Gerçek şirket performansı, kota sayaçları ve üretim denetim ayrıntıları bu belgeye dahil edilmedi.
