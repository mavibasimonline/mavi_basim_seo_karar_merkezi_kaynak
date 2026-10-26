# 18 Ağustos GSC satır doğrulama incelemesi

26 Ekim 2026, aşama 1. Eski üretim verisi 96/184 hedef kapsam ve iki `INVALID_GSC_ROW` hatası gösteriyor. Eski hata tek kod olduğundan hangi koşulun reddettiği henüz bilinmiyor; ülke/CTR/URL nedenlerinden biri kanıtsız seçilmedi.

`gscRowIssue` mevcut kuralların aynısını alan kategorileriyle ayırır. `INVALID_GSC_ROW_DATE`, `PAGE_ORIGIN`, `COUNTRY`, `DEVICE`, `METRIC_NUMBER`, `COUNTS`, `METRIC_RANGE`, `CTR_RATIO`, `QUERY` yalnız sabit kodlardır. Ham Google satırı veya kişisel/gizli veri saklanmaz. Bozuk satır aynı şekilde fail-closed kalır, eski doğrulanmış küme korunur.

Mevcut Actions işletim iş akışında iki dar işlem: salt okunur inceleme ve yalnız 18 Ağustos legacy hata koduna sahip iki işin güvenli, bir kerelik tekrar kuyruğa alınması. Gerçek aktarım yine doğal Cron, tek sağlayıcı sayfası ve mevcut D1/GSC bütçeleriyle yapılır. Cursor/generation/attempts sıfırlanmaz. Yeni sınıflandırılmış hatalar tekrar açılmaz. Üretim commit/validation/read-guard kimliği, hesap analitiği ve geçerli kota izni olmadan kuyruk değişmez. İşlem ham metrik tablolarına veya OAuth kaydına erişmez.

Yerel 346 Workers + 104 Python başarılı; 12 yeni Workers ve 5 yeni Python kabul senaryosu dahil. SQL idempotansı gerçek geçici SQLite ile doğrulandı. Tip kontrolü/build ve kaynak güvenlik denetimi başarılı. Uzak CI ve gerçek tanı sonuçları sonraki aşamada bu rapora eklenecek. Canlı UI dosyaları, Cron yapılandırması, migration'lar ve CSV'ler değişmedi.
