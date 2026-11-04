# Günlük GSC kanıt hattı — 4 Kasım 2026

Başlangıç kanıtı: üretim `f305dfe7bdebfd78a017a920b6d9e545aff12164`, yayın #95. Salt okunur çalışma denetimi `41789797230`, 07:05 UTC: Google bağlı, yeniden yetki gerekmiyor, günlük kapsam 0/14, son deneme `idle`, manuel tick 0. Bu kayıt sıfır trafik veya OAuth hatası kanıtı değildir. İlk durum API'si bekletilmiş işlerin nedenlerini göstermiyordu.

## Yeniden üretilen kök neden

Toplayıcı `this.fetcher(...)` ile Workers yerel `fetch` fonksiyonuna yanlış nesneyi `this` olarak veriyordu. Gerçek Workers çalışma zamanı `Illegal invocation` hatası üretiyor; eski kod bunu `GSC_SYNC_UNAVAILABLE` olarak gizleyip aday gün/kapsamı 24 saat bekletiyordu. Geçmiş dalındaki `idle` çıktısı da asıl hatayı örtebiliyordu. Yerel fonksiyonun receiver kontrolünü ağa çıkmadan kullanan regresyon testi bu davranışı yeniden üretir; taşımayı bağımsız fonksiyon çağrısı yapmak hatayı düzeltir. Gerçek canlı düzelme ayrıca GSC içerik readback kabulüyle doğrulanmalıdır.

## Veri akışı

Mevcut Cloudflare Cron → özel hesap hizmeti → aynı SQLite Durable Object → GSC Search Analytics API. Günlük toplayıcı ve kullanıcı raporları D1 kullanmaz. Google günleri Pasifik saat dilimindedir; güvenlik gecikmesi en az üç takvim günüdür. Son yedi uygun gün için iki kapsam bulunur: sayfa/ülke/cihaz ve görünür sorgu/sayfa/ülke/cihaz. 14 kapsam kaydı, bütün sorguların görünür olduğu anlamına gelmez.

Her API sayfası doğrulanır, şifreli parçalara yazılır ve geri okunup SHA-256 kontrolünden geçer. Tam generation ancak bundan sonra yayımlanır. Eski generation'lar ve Sheets arşivleri korunur. Eksik günlük kapsam aylık toplamı `null` yapar; eksik sorgu satırı sıfır sayılmaz. Sorgu varyantları birleştirilmez; anonim sorgu tahmin edilmez. Ürünler yalnızca taramayla doğrulanmış açık URL eşlemeleriyle gruplanır.

GSC ülke boyutu şehir veya bölge değildir. Şehir analizi için doğrulanmış GA4 verisi gerekir. Değişiklik geçmişi, gerçek önceki/sonraki taramalar ve hash'leriyle açıklanır. Doğrulanmış CMS/deploy kaydı yoksa kesin yayın tarihi veya nedensellik iddiası yoktur.

## Otomasyon ve kurtarma

Bir tick en fazla bir GSC API sayfası alır; 401 için tek token yenilemesi yapılabilir. 429 ve geçici sunucu hataları bekleme süresiyle yeniden denenir. Sayfalar arası yinelenen kimlikler, birikimli eksiklik işaretleri ve cursor/readback durumu korunur. Öncelik eksik uygun günlerdedir. Hata geçmişi `idle` çıktısıyla kaybolmaz; bekletme nedenleri ayrıca gösterilir.

Doğal Cron çağrıları zaman damgalı ayrı makbuz üretir. Manuel tanılama çağrıları Cron kanıtı olarak gösterilmez. Gün değişimi otomatik testte doğrulanır; yeni sürümün gerçek ertesi gün çalışması ancak o güne ait çalışma makbuzuyla doğrulanmış sayılır.

Salt okunur çalışma denetimi kontrollü yayından sonra ve günlük 00:35 UTC'de (Türkiye saatiyle 03:35) çalışır. İki gerçek UTC gününde başarılı toplama/parça kaydı yoksa ertesi gün kabulünü başarısız sayar; eski kayıtları veya bekletmeleri değiştirmez. Yalnız CI onaylı tam main commit'i, mevcut Free kaynaklar ve özel hizmet bağı kullanılır.

Ürün/tarama bağlamı D1'dan sınırlı, bütçe korumalı arka plan okumasıyla özel depoya kopyalanır. Bu isteğe bağlı kopya başarısız olsa da günlük GSC toplamayı engellemez. Kullanıcı sorguları D1 okumaz. Yeni içerik veya canonical eşlemesi tahmin edilmez.

## Ücretsiz kota korumaları

Yeni saklama için 8 MiB/gün ve yükseltmeden sonra toplam 128 MiB muhafazakâr rezervasyon sınırı; aynı SQLite nesnesinde 256 MiB fiziksel boyut sınırı uygulanır. Günlük sınır ertesi UTC gününde açılır. Toplam sınır veri silmeden inceleme bekler. Önceden var olan diğer nesnelerin ve hesabın tamamının kullanımı ölçülmüş sayılmaz; sınırsız veya sonsuza kadar ücretsiz çalışma sözü verilmez. Workers Free plan kontrolü yayın kapısında zorunludur; ücretli plan veya yeni ücretli kaynak etkinleştirilmez.

Aylık okuyucu istek başına en fazla 256 parça/20.000 satır okur; bütçe nedeniyle okunmayan günler açıkça eksik gösterilir. En fazla üç sonuç beş dakika önbellekte tutulur; yeni günlük generation yayımlanınca önbellek temizlenir.

## Kontrollü yayın

Tam başarılı main CI, tam commit eşleşmesi, belirli değişiklik listesi, mevcut Worker/bağlama/Cron kilitleri, Free plan ve önceki sürümler doğrulanır. Önce özel arşiv Worker'ı, sonra gerçek GSC içerik readback kabulü, sonra uygulama yayımlanır. Yayın commit'i ve canlı sürüm kimliği kontrol edilir. Kabul başarısızsa önceki Worker sürümlerine dönülür; doğrulanmış veri ve yedekler silinmez.

Özel çalışma denetimi yalnız metadata döndürür. Token, ham sorgu satırı ve Google hata gövdesi loglara yazılmaz. Eski doğrulanmış hatalı istek bekletmeleri, yalnız tam gün/kapsam/kod/zaman önkoşulu eşleşmesiyle bir kez yeniden denenebilir; 429, sunucu beklemesi, OAuth veya kota bekletmeleri bu yolla aşılmaz.

Bu belge mimari ve kabul ölçütlerini açıklar. Canlı kapsam ve yayın başarısı, çalışma sonu raporundaki gerçek çalışma kayıtlarıyla değerlendirilir.
