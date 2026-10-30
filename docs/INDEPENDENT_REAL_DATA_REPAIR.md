# D1 bağımsız gerçek veri kabulü — 31 Ekim 2026

Önce mevcut AGENTS.md, PROJE_TALIMATLARI.md ve TODO.md okundu. Taban main:
`6f2f5c779b930ba02c98504b9759c5f04240e85a`. Mevcut mimari korunur.

## Kanıt ve düzeltme

Başarısız Actions yayını **41119395027**, job **124281975114**,
`INDEPENDENT_REAL_DATA_ACCEPTANCE_FAILED` sonrasında özel arşiv Worker'ını
`9fc18288-9cc1-438e-91a4-8c87d63edfb2` sürümüne geri aldı. Log, alt kaynak
hatasını sakladığı için o koşunun iç hatası bağımsız olarak bilinmiyor.

Sabit gerçek Google Sheets kaynağı salt okunur tekrar alındı: 217 günlük,
5 dönem, 154 ürün ve 11.867 sorgu satırı. Mevcut doğrulayıcı **1.542 kayıt**
kabul etti; çelişen **3.534 kayıt** karantinada kaldı. JSON kaydı **1.354.853
UTF-8 bayt**: önceki tek DO `put` çağrısının 128 KiB değer sınırından büyük.
Bu somut hata yolu giderildi; gerçek veriyle gerçek SQLite DO testi geçti.
Sayılar bu oturumdaki kaynak gözlemidir; sonraki kaynak değişiklikleriyle farklılaşabilir.

Yeni saklama aynı Durable Object ve sağlayıcı katmanında, 48.000 baytlık
base64 parçalar kullanır. Parçalar kaynak SHA-256 ile adreslenir. Tam geri okuma,
hash ve kayıt sayısı doğrulanmadan etkin manifest değişmez. Önceki manifestler,
parçalar ve eski v1 kaydı silinmez. Yarım yazım önceki geçerli sürümü korur;
bozuk/eksik parça okunabilir gerçek veri sayılmaz. UTF-8 bayt sınırı uygulanır.

## Kabul ve yayın kapıları

- `python3 scripts/independent_real_data_acceptance.py`: gerçek sabit Sheets
  kaynağını `.local/` altında indirir; gerçek SQLite DO üzerinden rapor,
  kalıcı geri okuma ve kanıtlı Soru-Cevap çalıştırır. D1 binding, OAuth ve
  Drive yazımı yoktur. **Herhangi bir dağıtımdan önce zorunludur.**
- Sonra mevcut özel arşiv Worker'ının aday sürümü doğrulanır. Hesap içi
  probe; taze kaynak hash'i, rapor, aynı hash'e bağlı yanıt ve ikinci geri
  okumayı zorunlu tutar. Eski önbellek kabul edilmez. Bu aşama geçmeden SEO
  uygulaması yayımlanmaz. Hata halinde eski Worker sürümleri geri alınır ve
  sürüm/binding/Cron geri okunarak doğrulanır.
- Ücretsiz plan, mevcut kaynak kimlikleri, tam main SHA/başarılı push CI,
  tam değişen dosya listesi, kapalı özel arşiv URL'si, değişmeyen binding ve
  Cron kontrolleri korunur. Var olan isteğe bağlı MONTHLY_ANALYSES servisi
  korunur; yeni servis oluşturulmaz. Bilinmeyen servis bağları yayını durdurur.
- HTTP probe hatalarında yalnız izinli tanılama kodları bildirilir; ham
  sağlayıcı yanıtı veya anahtar loglanmaz.

## Doğrulanan kapsam ve sınırlar

Gerçek kaynak testi **2026-09 / 30 ürün / 1.294 sorgu** raporu ve Soru-Cevap
üretir. Önceki karşılaştırılabilir ay yoksa `Veri bekle` yanıtı verir;
eksik sorgu, karantinadaki kayıt veya eksik ay sıfır sayılmaz. Sheets dönem
özetleri canlı GSC veya günlük sayfa/sorgu kapsamı olarak sunulmaz.

Yeni rapor, saklama ve Soru-Cevap yolu D1 kullanmaz. Eski günlük GSC toplayıcısı,
geçmiş D1 kayıtları, 15 dakikalık Cron, Drive OAuth/şifreleme/alarmlar ve
arşiv yükleme/geri okuma kodu korunur. Eski D1 binding'i bu mevcut toplayıcı
için korunur; veritabanı silinmez veya yeni katmanın veri kaynağı yapılmaz.
521 özgün CSV / 9.075 kaynak satırı değişmedi. mavibasim.com'a yazılmadı;
ücretli servis veya yeni kaynak açılmadı.

Yerel kontroller: 559 mevcut Workers testi + 11 yeni probe testi, 7 bağımsız
Drive/DO testi, 4 aylık DO testi ve 1 gerçek kaynak kabulü başarılı. Python
paketi 189 testle geçti; servis koruma regresyonu eklenince ilgili 5 test
ayrıca geçti. Tip kontrolü, paketleme, Sheets runtime kabulü ve npm audit
(0 açık) başarılı. Tarayıcı ve son tam SHA CI/yayın sonuçları Actions'ta
ayrıca izlenir; bu hazırlık belgesi canlı kabul yerine geçmez.
