# 18 Ağustos GSC satır doğrulama incelemesi

26 Ekim 2026, aşama 1. Eski üretim verisi 96/184 hedef kapsam ve iki `INVALID_GSC_ROW` hatası gösteriyor. Eski hata tek kod olduğundan hangi koşulun reddettiği henüz bilinmiyor; ülke/CTR/URL nedenlerinden biri kanıtsız seçilmedi.

`gscRowIssue` mevcut kuralların aynısını alan kategorileriyle ayırır. `INVALID_GSC_ROW_DATE`, `PAGE_ORIGIN`, `COUNTRY`, `DEVICE`, `METRIC_NUMBER`, `COUNTS`, `METRIC_RANGE`, `CTR_RATIO`, `QUERY` yalnız sabit kodlardır. Ham Google satırı veya kişisel/gizli veri saklanmaz. Bozuk satır aynı şekilde fail-closed kalır, eski doğrulanmış küme korunur.

Mevcut Actions işletim iş akışında iki dar işlem: salt okunur inceleme ve yalnız 18 Ağustos legacy hata koduna sahip iki işin güvenli, bir kerelik tekrar kuyruğa alınması. Gerçek aktarım yine doğal Cron, tek sağlayıcı sayfası ve mevcut D1/GSC bütçeleriyle yapılır. Cursor/generation/attempts sıfırlanmaz. Yeni sınıflandırılmış hatalar tekrar açılmaz. Üretim commit/validation/read-guard kimliği, hesap analitiği ve geçerli kota izni olmadan kuyruk değişmez. İşlem ham metrik tablolarına veya OAuth kaydına erişmez.

Yerel 348 Workers + 104 Python başarılı; 14 yeni Workers ve 5 yeni Python kabul senaryosu dahil. SQL idempotansı gerçek geçici SQLite ile doğrulandı. Tip kontrolü/build ve kaynak güvenlik denetimi başarılı. Uzak CI ve gerçek tanı sonuçları sonraki aşamada bu rapora eklenecek. Canlı UI dosyaları, Cron yapılandırması, migration'lar ve CSV'ler değişmedi.


## Gerçek sonuç ve yayın engeli

Kaynak commit `a72e7fa`, PR #23 tam CI **40282140567 SUCCESS**: 348 Workers/D1 + 104 Python + 34 tarayıcı = **486 test**. npm audit ve kaynak koruma geçti. Gerçek salt okunur inceleme **40282015379**: 574 satır okuma / 0 yazma; 97/184 kapsam, 87 eksik. 18 Ağustos iki hata hâlâ blocked; gerçek alan nedeni bilinmiyor.

Otomatik onay denetimi, PR #23 için açık merge/yayın onayı olmadığını söyleyerek main birleştirmesini engelledi. İşlem dolaylı yoldan tekrarlanmadı; üretim main `f96f184` ve eski canlı sürüm korundu. Tanılama henüz yayımlanmadı ve iki iş yeniden kuyruğa alınmadı. Sonraki gerekli yetki yalnız bu PR'ın birleştirilmesi/kontrollü tanılama yayınıdır; token veya OAuth yenilemesi istenmez.

Kota gözlemi 09.48 Türkiye: hesap 226.273 okuma / 18.979 yazma; gecikmeli analitik. Yerel defter 89.777 okuma / 5.272 yazma. Korumalar korunur. Temmuz 0/62, Ağustos 37/62, Eylül 60/60; 09.30 Türkiye'de gerçek doğal Cron 12 Ağustos sayfa kapsamını tamamladı. 10.00 Türkiye sonraki planlı Cron slotudur, tamamlanma garantisi değildir. Yeni yetki olmadan gerçek hata düzeltildi denmez.
