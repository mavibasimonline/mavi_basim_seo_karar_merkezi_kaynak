# Rakip SEO modülü test raporu

Dal feat/rakip-seo-analizi; bağımlılık feat/veri-dogruluk-denetcisi (PR #6). Gerçek rakip alan adı/taraması bu oturumda yapılmadı; pozitif yanıtlar yalnız izole test fixtures'ıdır. Mevcut Google üretim bağlantısı bu modülün testlerinden ayrı değerlendirilir.

## Çalışanlar

En fazla beş rakip ve rakip başına 29 ürünün açık URL eşleştirmesi desteklenir. Toplam üst sınır 145; ürün karşılaştırmaları 20'şer keyset sayfalanır. Rakip adı/origin, ürünler, son başarılı tarama, durum ve değişiklik geçmişi kaydedilir. Yanlış ürün başlığı/H1 kanıtıyla eşleşen hedeften içerik fırsatı üretilmez; broşür–el ilanı ve bloknot–küp bloknot ayrımı testlidir.

HTTPS ve aynı origin zorunludur. Kullanıcı bilgili URL, özel port, yerel alan adı ve IP literal reddedilir. Tarama öncesi public DNS A kaydı kontrol edilir; özel/rezerve adres ve IPv6-only hedefte işlem durur. Bu DNS kontrolü tek başına DNS rebinding'in matematiksel olarak imkânsız olduğu iddiası değildir; Worker'da özel ağ/VPC binding'i yoktur. CAPTCHA/login ve HTTP erişim engelleri aşılmaz; yönlendirme izlenmez. Robots aynı MaviBasimSeoBot kimliğiyle okunur, crawl-delay ve en az 60 saniye host bütçesi atomik uygulanır. Retry-After host ve hedefte korunur; hata ve erişim engellerinde güvenli bekleme uygulanır.

İş kiralama ve kayıt koşulları eski worker'ın yeni lease sahibinin yerine snapshot yazmasını veya durumunu bozmasını engeller. Başarısız tarama önceki başarılı snapshot'ı silmez. Eşit içerik yeni değişiklik olayı üretmez. Gerçek yayın tarihi bilinmez; eski/yeni sürüm ve tespit aralığı saklanır.

Tam rakip HTML'i saklanmaz. Title/meta, sınırlı H1–H3, canonical/robots, en fazla 50 iç bağlantı, JSON-LD türleri ve konu başına en fazla 120 karakter kanıt tutulur. Ebat, malzeme, baskı tekniği, adet, fiyat açıklaması ve FAQ konuları mevcut Mavi Basım statik özetiyle karşılaştırılır. Gözlenen özette bulunmama kesin yokluk değildir. Kendi sayfasında taze/başarılı/self-canonical kanıtı, rakipte doğru ürün ve başarılı taze tarama yoksa fırsat çıkarılmaz.

Keyword Planner ürün talebi ayrı son gözlemlerle gösterilir; ilk beş kayıt tam pazar özeti veya konu eşleşmesi değildir. Hacimler toplanmaz; reklam rekabeti SEO zorluğu değildir. Rakibin hizmeti Mavi Basım için kapasite, fiyat veya teslimat iddiasına çevrilmez. Otomatik site değişikliği yoktur.

Panelde Rakiplerim, Ürün Karşılaştırması, İçerik Fırsatları, Rakip Değişiklik Geçmişi ve Kanıtları Gör bulunur. Otomasyon varsayılan kapalıdır; AUTOMATION_ENABLED ve COMPETITOR_CRAWL_ENABLED ayrı ayrı true olmadıkça çalışmaz. Etkinleşirse saatin :15 UTC diliminde en fazla bir hedef işlenir. Bu tüm 145 hedefin her gün taranması garantisi değildir; son başarılı zaman ve eski/eksik kapsam gösterilir. Gerçek Free CPU/D1/depolama bütçesi üretimde ölçülmelidir.

## Test sonucu

41 modül senaryosu: 12 güvensiz origin, 12 özel/rezerve IP, public adres kabulü, dört ürün niyeti, kısa kanıt, eksik/eski/yanlış ürün, noindex/canonical, kapalı otomasyon, başarılı/aynı içerik, robots, DNS engeli, CAPTCHA, 403 ve eski veriyi koruma, yanlış ürün/origin, kaybedilmiş lease, JSON-LD graph/FAQ, eski worker hatası, 29 ürünün 20+9 sayfalanması ve Retry-After.

İlk lease yarışı testinde 36 geçti/1 başarısız oldu; koşullu snapshot/site durumu kayıtlarıyla düzeltildi. Son **41/41** başarılı. Tüm modüllerde **284 Workers/D1 + 21 Python + 4 tarayıcı = 309 başarılı test**. Altı migration ve yerel yükseltme, tip kontrolü, kaynak/geri yükleme, üretim dry-run ve npm audit 0 başarılı. Mobil/masaüstü ayrıca dış kanıtın XSS çalıştırmadığını ve uzun URL'nin taşmadığını doğrular. Son başarısız/atlanmış test yok.

## Gerçek analiz sınırı

Gerçek rakip taraması ve gerçek içerik boşluğu bulgusu yoktur. Başarı rakamları test verileridir. Üretimde bu modül yayımlanmadı; kaynak CSV, canlı mavibasim.com ve ücretli plan değiştirilmedi. Operatörün gerçek üretim GSC kuyruğu sorunu ayrıca incelenmektedir; bu özellik PR'ı o sorun çözülmeden üretime uygulanmamalıdır.
