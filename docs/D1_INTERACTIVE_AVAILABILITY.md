# Giriş ve raporlar için D1 bütçe koruması

İncelenen temel: main `910070fbf6af6af77ebe5bf9ae7015ab77894c99`. Canlıda bildirilen `/api/session` ve `/api/status` 429 yanıtlarının tek kodu, hangi koşulun reddettiğini kanıtlamıyordu. Bu çalışma üretim sayaçlarını okumadı veya değiştirmedi; canlı kök neden kesinleşmiş değildir.

## Doğrulanan davranışlar ve düzeltme

- Aynı günlük yerel defteri arka plan ve tüm kullanıcı istekleri tüketiyordu. Başarılı gözlemci yalnız kota kaydını yeniler; yerel defteri sıfırlamaz. Arka plan artık mevcut toplam sınırların içinde 1.000.000 okuma ve 5.000 yazmayı kullanıcı işlemlerine bırakır. Okuma payı mevcut ağır işlem tavanına eşittir. Bu pay tek bir isteğin garantisi değildir; eşzamanlı kullanıcı işleri paylaşır. Arka plan aktarımı daha erken bekleyebilir.
- Hesap 3.500.000 okuma / 85.000 yazma, yerel 2.000.000 okuma / 65.000 yazma sınırları değişmez. Gecikmeli hesap toplamına yerel harcama yine eklenir. Bilinmeyen maliyetlerde rezervasyon tutulur. Login'in deneme sınırlaması ve güvenli çerezi korunur.
- 75 dakikalık gözlem ve `valid_until`, iki saatlik analitik tazeliği ve UTC gün sonu birlikte geçerlidir. Sorgu öncesi etkin bitiş bu dört sınırın en erkenidir. Önceden uzun işlem içinde yalnız `valid_until` ve gün kontrol ediliyordu. Hiçbir izin uzatılmaz.
- Hatalı mod/sayaç/zaman damgası reddedilir. Mevcut 429 `code` korunur; yalnız sabit `reason` eklenir. SQL, IP, token, çerez, gerçek hesap sayacı veya kaynak satırı yanıta eklenmez. Rezervasyon reddinde en fazla bir ek günlük birincil anahtar sorgusu yapılır. Sorgular metering altyapısının küçük kota tablolarıyla sınırlıdır.

## Güvenli tanılama

Mevcut başarısız isteğin JSON yanıtındaki `reason` alanını kaydedin; otomatik sık tekrar deneme başlatmayın. Gözlemci başarısını isteğin gerçekleştiği anla karşılaştırın. Üretim öncesi eski Worker bu alanı döndürmez.

| Neden | Anlam |
| --- | --- |
| CHECKPOINT_MISSING / WRONG_DAY | İstek gününde kota kaydı yok veya gün uyuşmuyor |
| CHECKPOINT_INVALID / FUTURE / STALE | Kota gözlemi doğrulanamıyor veya 75 dakika sınırı geçilmiş |
| LEASE_EXPIRED | Verilen izin bitmiş |
| ANALYTICS_FUTURE / STALE | Kaynak analitiği geçersiz veya iki saatten eski |
| CHECKPOINT_BLOCKED | Kaydedilmiş mod kapalı |
| ACCOUNT_READ_LIMIT / ACCOUNT_WRITE_LIMIT | Hesap gözlemi güvenlik tavanına ulaşmış |
| ACCOUNT_READ_RESERVATION_LIMIT / ACCOUNT_WRITE_RESERVATION_LIMIT | Hesap gözlemi + yerel rezervasyon + yeni istek tavana sığmıyor |
| LOCAL_READ_LIMIT / LOCAL_WRITE_LIMIT | Günlük yerel defter yeni rezervasyona yetmiyor |
| BACKGROUND_READ_HEADROOM / BACKGROUND_WRITE_HEADROOM | Toplam tavanda yer var, arka plan kullanıcı payına giremez |
| RESERVATION_CONTENDED | Başarısız atomik rezervasyon sonrası tanılama anında defter değişmiş; kesin tavan nedeni çıkarılamaz |
| SLOW_MODE_HEAVY_OPERATION | Gecikmiş/yüksek kullanımlı analitik ağır işlemi erteliyor |
| LEASE_ENDED_DURING_OPERATION | İşlem sürerken etkin izin bitmiş; sonraki sorgu çalıştırılmadı |

`readBudgetStatus` yetkili durum yanıtında bildirilen `valid_until` ve `effective_valid_until` alanlarını ayırır. Kota reddi durumunda `/api/status` veri sorguları açılmaz; aynı 429 tanısı kullanılır. Hatalı girişin kendi 15 dakikalık deneme sınırı D1 bütçe reddinden ayrı kalır.

## Kabul ve sınırlar

Yeni testler arka planın okuma/yazma payında durmasını, aynı defter üzerinde gerçek giriş çerezini ve rapor üretimini; toplam tavanda girişin hâlâ durmasını; farklı ret nedenlerini; analitik tazeliğinin işlem sırasında bitmesini ve anonim hata yanıtının hassas veri içermemesini doğrular. Önceki eşzamanlı rezervasyon testi, kullanıcı işlemlerinin değişmeyen ortak hesap tavanını test etmeye devam eder.

Üretim kabulü: CI başarılı olduktan ve kullanıcı yayın izni verdikten sonra sınırlı bir giriş, durum ve rapor isteği doğrulanmalı. Ret varsa `reason` ile ayrıştırılmalı. Sayaç sıfırlama, OAuth, Worker Cron, GitHub gözlemci takvimi, migration ve PR #29 bu değişikliğin kapsamında değildir. Geçersiz/süresi dolmuş izin veya gerçek kota tükenmesi hâlâ güvenli bekleme gerektirir; kesintisiz erişim garantisi verilmez.
