# Doğrudan GSC geçmişi ve otomatik devam

Önce günlük 7 gün × sayfa/sorgu kapsamı gerçek API'den alınır ve şifreli parçaların SHA-256 geri okumasıyla doğrulanır. İlk geçmiş planı, Google'ın üç günlük kesinleşme gecikmesi sonrasındaki son iki kapalı ayı seçer. 4 Kasım 2026 için bunlar Ekim ve Eylül, toplam 122 günlük kapsamdır.

İlk plan her çağrıda en fazla bir GSC sayfası alır. İlerlemesi kalıcıdır; doğal Cron, günlük 14 kapsam hazır olduktan sonra kaldığı yerden devam eder. Yayın kabulü en fazla 200 sayfa çağrısı yapar. Kaynak kota/OAuth beklemesinde durur; kullanıcıdan CSV istemez. Mevcut tarihsel günlük kanıtlar atlanır, eski nesiller ve Sheets arşivleri korunur. Tam aylık sonuç yalnız bütün sayfa günleri doğrulanınca, sorgu kapsamı da ayrıca içerik geri okumasından sonra gösterilir. Anonim sorgular yine eksiktir; tahmin edilmez.

Günlük toplama 8 MiB/gün, ilk iki ayın toplaması toplam bir kez 16 MiB muhafazakâr yazım rezervi kullanır. Her ikisi aynı 128 MiB yeni yazım ve 256 MiB mevcut SQLite fiziksel boyut sınırına tabidir. Bu sınırlar hesap genelinin ölçümü değildir. Sınırda arşiv silinmez veya ücretli plana geçilmez; iş bekler. Sonsuz veri saklamanın sabit ücretsiz depolama içinde garantisi verilmez.

Ürün URL eşlemesi ve önce/sonra tarama kayıtları mevcut D1'den yalnız sınırlı, okuma bütçeli bir metadata kopyasıyla alınır. Eksik kopya doğal çeyrek saatlerde yeniden denenir; mevcut kopya günde bir kez 00:15 UTC'de yenilenir. Günlük GSC toplama ve kullanıcı analiz okumaları D1'e bağlı değildir. Otomatik soru seçimi, doğrulanmış ürün adı ile tam GSC ayı varsa GSC kanıtını kullanır; açık arşiv seçimi korunur.

Şehir/ilçe ziyaretçi verisi GSC'de yoktur. GA4 bağlantısı olmadan şehir performansı tamamlandı denmez. Sorgudaki yer adı ziyaretçinin bulunduğu yer değildir. Yayın zamanı ancak doğrulanmış CMS/deploy kaydıyla söylenir; diğer değişiklikler iki gerçek tarama arasındaki zaman aralığıyla açıklanır.

Canlı kabul için günlük 14 şifreli içerik geri okuması, iki ayın ayrı kapsamları, ürün/tarama bağlamının gerçek durumu, Worker kontrol düzlemi ve HTTP sürüm eşleşmesi birlikte kaydedilir. Ertesi gün Cron kanıtı ancak ertesi UTC günündeki doğal kayıttan sonra doğrulanabilir. Günlük salt okunur audit 00:35 UTC'de çalışır; önceki ve yeni UTC gününün ayrı doğal Cron makbuzlarını kontrol eder. Testte saat ilerletmek canlı ertesi gün kanıtı değildir.

Bu belge tasarım ve kabul koşullarını açıklar. Gerçek yayın ve kapsam durumu ilgili GitHub Actions kabul kaydı ve oturum raporuyla belirlenir; belge tek başına tamamlanma kanıtı değildir.
