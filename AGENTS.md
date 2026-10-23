# AGENTS.md — Mavi Basım SEO Karar Merkezi

## Görev
Bu depoda Mavi Basım (https://mavibasim.com) için gerçek çalışan, güvenli, Türkçe, tek ekranlı ve kanıta dayalı SEO karar uygulaması geliştir. Ana gereksinimler ve kabul testleri için PROJE_TALIMATLARI.md dosyasını oku; bu iki dosya her görevin başlangıç bağlamıdır.

## Değiştirilemez kurallar
1. Varsayım üretme: SEO sonuçları ve teknik kontroller için kaynak, tarih, URL, metrik, filtre ve veri kapsamı göster. Örnek veriyi gerçekmiş gibi raporlama.
2. Önce kanıt → yorum → SEO kararı. Küçük/az verili dalgalanmalarda 'değişiklik yapma' diyebil.
3. Kullanıcı günlük veri yüklemeyecek veya komut çalıştırmayacak. GSC ve varsa GA4 arka planda senkronize edilecek. Manuel CSV yalnızca ilk geçmiş arşivi için opsiyoneldir.
4. Kullanıcının izni olmadan canlı siteye yazma/değişiklik yapma, ücretli servisi etkinleştirme, kaynak dosyalarını silme, Git geçmişini yeniden yazma ya da depodaki mevcut Keyword Planner CSV'lerini değiştirme.
5. API anahtarları, OAuth token'ları ve kimlik bilgileri asla repoya/loglara yazılmaz. .env.example kullan; gizli anahtarları sunucu tarafında tut.
6. Keyword Planner reklam rekabeti SEO zorluğu değildir. Planner yaklaşık pazar talebi; Search Console gerçek arama performansı; GA4 ziyaret/dönüşüm verisidir. Metrikleri yanlış birleştirme ve varyant kelime hacimlerini toplama.
7. Search Console sorgu satırları gizlenebilir/eksik olabilir. Eksik sorguyu sıfır sayma. GSC şehir bazında veri vermez; şehir analizi GA4 verisi varsa yapılır ve organik oturum/sorgu ayrımı açıkça belirtilir.
8. Tamamlanmamış gün/ay, az gösterim, marka sorguları, cihaz karışımı, mevsimsellik, kanonik URL kümeleri ve olası sorgu çakışması kontrollerini yap.
9. Geçmiş değişikliklerin kesin yayın zamanını yalnızca site/CMS kaydı kanıtlıyorsa belirt. Aksi halde önceki/sonraki tarama arasındaki zaman aralığını göster. Korelasyon nedensellik değildir.
10. Her öneri izlenebilir: hangi ürün/sayfa/sorgu, tarih aralığı, metrikler, değişiklik, bulgu, risk, kanıt güven seviyesi, sonraki ölçüm.
11. Mimari temiz ve modüler: ürünler veriyle tanımlanır, her ürün için kopya kod yazılmaz. Testleri olmayan SEO karar kuralını bitmiş sayma.
12. Cloud'da çalışırken bağlantı/yetki/ücretsiz kota yoksa çalışan parçaları tamamla, test et, belgeli ve açık durum bildir; bağlantıyı uydurma, güvenliği aşma.
13. Kullanıcı Türkçe konuşuyor. Panel ve raporlar Türkçe, teknik değişken/adlandırma tutarlı ve okunabilir olsun.
14. Sadece konuşma/plan üretme: gerçek kod, otomatik testler, migration, örnek .env, kurulum ve deploy dokümantasyonu, kısa durum raporu üret. Değişiklikleri sürüm kontrolüne kaydet.
15. Sabaha kadar tamamlanacağı veya kota yenilenince kendiliğinden yeniden çalışacağı garanti edilmez. Tek çalışma oturumunda mümkün olan en fazla doğrulanmış ilerlemeyi sağla; kalan işleri TODO.md ile açıkça sırala.

## Çalışma prosedürü
- Önce depo ağacını ve CSV/ZIP kaynaklarını salt-okunur tara, mevcut mimari ve veri kapsamını anla.
- Ardından test edilebilir çekirdeği sırayla geliştir: şema → veri içe aktarma → GSC senkronu → site tarama/sürüm farkı → analiz motoru → API → tek ekran panel → dağıtım.
- Her aşamada test/format/lint çalıştır; mümkünse sürüm kontrolüne commit yap.
- Giriş yetkisi gerektiren veya eksik kalan noktaları README ve TODO.md dosyalarına yaz; gerçek entegrasyon bağlantısını sağlanmış gibi gösterme.
- Ürün klasörleri (afis, brosur, el-ilani vb.) mevcut anahtar kelime kaynağıdır; bunları silme. Kaynak veriyi özgün ad, tarih, satır ve hash ile izle.
- Kullanıcı panelde yalnızca aylık sonucu görüp sorular sormak istiyor. Gündelik uygulama yönetimi veya manuel import ekranları dayatma.
