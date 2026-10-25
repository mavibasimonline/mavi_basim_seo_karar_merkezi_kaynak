# Kullanım kolaylığı kabulü — 25 Ekim 2026

Mevcut açık renk/lacivert tasarım ve uygulama korundu. Dal `feat/dashboard-usage-improvements`; başlangıç main `06628a0`. Gerçek yayın ve tam commit/version kanıtı bu değişikliğin PR açıklaması ve kontrollü üretim workflow'unda izlenir.

## Çalışan davranışlar

- Sabit üst çubukta tek tıklama/dokunuşla açılan Türkçe ay seçici, önceki/sonraki ay ve yıl okları, klavye okları/Enter/Escape. Gelecek ay/yıl seçenekleri kapalıdır. HTML date input davranışına bağımlı değildir.
- İlk ziyaret İstanbul takvimindeki mevcut ayı açar. Mevcut ay “Bu ay — kısmi veriler” olarak görünür; aylık delta ve ürün değişim sıralaması kapalıdır. Ay ve cihaz değişince rapor otomatik yüklenir.
- Tarayıcıda yalnız izinli `month`, `device`, `view` tercihleri ve önceki menü daraltma tercihi tutulur. Token, Google ölçümü, soru veya sorgu metni saklanmaz. Geçersiz/gelecek tercihler reddedilir; storage kapalıysa panel çalışır.
- Genel bakışta kısa veri durumu, tek satır kapsam, dört KPI, önemli değişimler ve grafik vardır. Kanıt/bağlantı/bütçe ayrıntıları “Neden eksik?” altında açılır. Teknik hata varsa görünür hata durumu korunur. Veri yoksa tire gösterilir; normal eksik veri büyük sarı uyarıyla tekrarlanmaz.
- Ürün araması anlıktır; tıklama/gösterim ve tam dönemlerde mutlak tıklama farkına göre hızlı sıralama vardır. İsim veya satır tıklaması aynı kanıt penceresini açar. Ek ürün/sorgu filtreleri açılır bölümlerdedir; marka filtresi doğrudan görünür ve otomatik uygulanır.
- Dönem/cihaz genel bakış, ürünler, sorgular ve fırsat radarına uygulanır. Radar API'sinin parametresiz mevcut 28 günlük davranışı korunur; yeni panel açık month/device parametreleri kullanır. Değişiklik takvimi seçili aya geçer; veri sağlığı seçili ayı denetler. Soru-cevap seçili ayı varsayılan alır; sorudaki açık tarih/cihaz ve takip bağlamı önceliğini korur.
- “Ekranı yenile” yalnız mevcut kayıtları GET ile yükler; Google aktarımı başlatmaz. Otomatik bağlantı çalışırken kullanıcıya Google bağlama/pilot düğmesi gösterilmez. Ölçüm yoksa indirme gizlidir; kısmi rapor indirmesi açıkça etiketlenir.
- İstekler yarıştığında eski yanıtlar dönemi ezmez. Yeni kapsam yüklenemezse önceki başarılı verinin ay/cihaz kontrolü geri yüklenir; eski metrikler yeni dönem adı altında sunulmaz. Oturum sonunda özel DOM temizliği korunur.

## Kabul sonuçları

**352 otomatik test:** 287 Workers/D1 + 49 Python + 16 gerçek Chromium masaüstü/mobil tarayıcı testi. Tip, Worker build, üretim dry-run ve kaynak koruma başarılı; npm audit 0.

Tarayıcıda doğrulananlar: ilk mevcut ay; tek ikon tıklaması ve mobil dokunuş; gelecek ay engeli; otomatik rapor isteği; ay/cihaz/sekme korunması ve reload; mevcut ay delta engeli; eksik veri için tire/boş grafik; uygun indirme etiketi; marka filtresi ve hızlı ürün sıralama; detay penceresi; klavye/odak; açık ay seçici dahil WCAG A/AA kontrolleri; depolama hatası; geçersiz tercih; başarısız kapsam değişimi; mobil taşma olmaması. GSC aktarımı başlatan POST yapılmadığı kontrol edildi. Bütün bunlar gerçek yerel API ile test edildi; dolu grafik/sıralama sınırları için yalnız tarayıcı HTTP fixture'ları ayrıca kullanıldı, üretime örnek veri yüklenmedi.

## Üretim ve veri sınırları

Yayın öncesi salt okunur gerçek tanılama **40170613608**, 25 Ekim **09:51 Türkiye**: bütçe yenilenmesi ve yeni gün gerçek GSC ilerlemesi doğrulandı; Temmuz–Eylül **76/184**, ürün snapshot'ları **29/29**. Tam aylık kabul hâlâ eksik kapsam nedeniyle bloke; UX bunu tamamlandı göstermez. Günlük hesap metriği 54.317 yazma / 595.353 okuma. Yeni UX bu ölçümleri üretmedi veya aktarımı tetiklemedi.

Bu ölçüm yayına hazırlık kontrolündeki çift rezervasyonu ortaya çıkardı: harcanan senkron yazmaları hesap metriğinde zaten varken günlük 60.000 bütçe yeniden ekleniyordu. Ön kontrol şimdi yalnız mevcut gün sayacından doğrulanan kalan payı ekler; sayaç okunamaz/geçersizse kapanır, gün kaydı yoksa tam payı ayırır. 90.000 yazma / 4.000.000 okuma yayın güvenlik sınırları, gerçek senkron limiti ve sayaçlar değiştirilmedi. Dört yeni bağımsız test bu hesabı ve hata durumlarını doğrular.

OAuth, Cron, D1 şeması, GSC senkronu, günlük bütçe ve tarayıcı korunur. Kaynak 521 CSV ve 9.075 satıra yazılmaz. Canlı mavibasim.com içeriği değiştirilmez; ücretli hizmet eklenmez. Tam dolu aylık SEO raporunun ve özel canlı yönetici oturumunun kabulü bu UX testiyle tamamlanmış sayılmaz.
