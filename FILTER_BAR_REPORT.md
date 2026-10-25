# Açık ay çubuğu ve İlk 10 Lider Ürün — 25 Ekim 2026

Başlangıç main: `83c5907`. Dal: `feat/month-strip-and-product-leaders`. Çalışan mevcut arayüz ve servisler korunur. Kaynak commit'i `cd8de35`; bu belgeyi içeren commit git log ile izlenir. Son CI/yayın kimlikleri değişikliğin PR açıklamasında ve kontrollü production workflow'undadır.

## Çalışan kullanım

12 ay açık butonlardır; seçili ay belirgindir, gelecek aylar kapalıdır. Yıl okları korunur. Dar ekranda ay şeridi kendi içinde kayar; cihaz filtresi ayların üstünü kapatmaz. İlk ziyarette İstanbul takvimindeki mevcut ay ve Tüm cihazlar seçilir. Son ay/dönem/cihaz/sekme tercihi güvenli yerel ayarlarda hatırlanır. Token veya Google ölçümleri tarayıcı depolamasına yazılmaz.

3 Ay / 6 Ay / 12 Ay ayrı bir gruptadır. Anlamı **mevcut ay dâhil son N takvim ayı**: 25 Ekim 2026'da 3 Ay, 1 Ağustos–31 Ekim; 6 Ay, 1 Mayıs–31 Ekim; 12 Ay, 1 Kasım 2025–31 Ekim 2026. Tam tarih aralığı/mod görünür. Ay butonuna basmak tekil aya döner. Ek rapor butonu gerekmez. Dönem ve cihaz KPI/grafik/ürün/sorgu/radar/export üzerinde aynı kapsamı kullanır. Veri sağlığı seçili dönemi denetler; takvimdeki gün seçili aralıkta kalır. Soru-cevap bu dönemi/cihazı varsayılan alır, sorudaki açık tarih/cihaz önceliğini korur.

**İlk 10 Lider Ürün** genel bakışta ayrı karttır. Yalnız doğrulanmış URL'si ve gözlenen gerçek sayfa metriği olan ürünler tıklama azalan, eşitlikte gösterim ve isimle sıralanır; en fazla 10 satır gösterilir. İsim, tıklama, gösterim, CTR, ortalama konum ve gözlenen gün sayısı bulunur. İsim mevcut kanıt penceresini açar. Veri yoksa liste doldurulmaz; kısmi sıralamada ürünlerin eşit günlerle ölçülmediği belirtilir. Sıralama SEO başarı nedeni veya değişiklik önerisi değildir. Mini trend eklenmedi; kanıtsız eğilim üretilmez.

## Veri doğruluğu ve sınırlar

- CTR=sum(tıklama)/sum(gösterim); konum=sum(konum×gösterim)/sum(gösterim). Aylık ortalamaların ortalaması alınmaz. Aktif ve tamamlanmış GSC veri kümeleri önce tam satır sayısı, alanlar ve metrik tutarlılığıyla doğrulanır; cihaz filtresi sonra uygulanır.
- Her eksik gün ve gözlenmeyen ürün null kalır. Gerçek ölçülmüş sıfır ayrı tutulur. Mevcut ay dâhil çok aylık pencereler, yeterli ve kapanmış veri olmadan tam dönem karşılaştırması veya kesin SEO kararı üretmez. Karşılaştırma penceresi önceki N takvim ayıdır; gün sayıları farklı olabilir.
- 12 aylık karşılaştırmada önceki 12 aylık pencere de sorgulanır. Geniş kapsamda ayrıntılı analiz 50.000 satır güvenlik sınırını korur. Denetim bu sınıra takılırsa 422 ile durur; kısmi analiz Google veri bozulması kabul edilip başarısız sağlık kaydı yazılmaz. KPI ve liderlerin doğrulanmış SQL özetleri ayrı kullanılabilir; ayrıntılı analizin erişilemediği açıkça gösterilir.
- Sorgu API'sinde 100'den fazla günlük dataset için yüzlerce parametre yerine tek JSON listesi kullanılır. Serbest dönem yalnız 1/3/6/12 kabul eder; SQL filtreleri parametrelidir. Planner hacimleri performansa eklenmez.
- Ayrı ürün testi SQL alias çakışmasını ortaya çıkardı: GROUP BY product_id gerçek pages.product_id alanına bağlanabiliyor ve iki kanonik ürünün ölçümlerini birleştirebiliyordu. Özet ve bağımsız doğrulayıcı açık ürün eşleme ifadesiyle düzeltildi; broşür/el ilanı ayrı metrik ve HTTP rapor testi geçti. Karar eşikleri değiştirilmedi.

## Kabul kanıtları

**366 otomatik test başarılı:** 299 Workers/D1 + 49 Python + 18 Chromium masaüstü/mobil. Kaynak 521 CSV / 9.075 satır/hash testleri, tip/build, üretim dry-run, release kontrolü ve npm audit 0 başarılı. Son başarısız test yok. İlk ürün karışması testi düzeltmeden önce başarısızdı; düzeltmeyle tekrar geçti.

| Kabul | Sonuç |
|---|---|
| İlk mevcut ay / Tüm cihazlar | Gerçek yerel API tarayıcı testi geçti |
| 12 açık ay, seçili durum, gelecek ay engeli | Masaüstü/mobil, tık ve dokunma geçti |
| 3/6/12 ay, doğru takvim günleri ve cihaz | Gerçek API, artık yıl, yıl sınırı ve önceki N ay testleri geçti |
| Otomatik güncelleme, sekme ve reload | Tercihler ve hatalı istekten doğru kapsama dönüş geçti |
| İlk 10 başlığı, sıralama, en fazla 10 ve modal | Tarayıcıda yalnız fixture sıralama testi geçti; veri yokken gerçek API boş durum testi geçti |
| Eksik veri / sıfır / yanlış CTR / ürün ayrımı | Bağımsız hesap ve bozuk veri testleri geçti |
| Güvenlik / erişilebilirlik | Oturumsuz 401, geçersiz parametre 400, yerel tercih whitelist'i, WCAG A/AA, klavye ve taşma kontrolleri geçti |

**Gerçek üretim D1 kabulü 40183641688** başarılı. Mevcut localhost operatörü, 3/6/12 ay için sırasıyla 92/184/365 günlük pencereyi doğruladı; her birinde 60 doğrulanmış günlük veri kümesi ve 28 ölçümlü ürün grubu vardı. Ürün tıklama/gösterim/CTR/ağırlıklı konum hesapları bağımsız SQL ile eşleşti. Kaynaklar önce/sonra 29 ürün / 521 dosya / 9.075 satır. Google senkronu veya site taraması tetiklenmedi; sorgu metni, trafik değerleri ve token'lar artifact'e yazılmadı. Tam aylık SEO rapor kabulü hâlâ false, 29 ürün Veri bekle; bu UX teslimi tam geçmiş veri kabulü değildir.

Fixture'lar yalnız Playwright HTTP yanıtlarındadır; üretime/D1'e örnek veri yüklenmedi. Ekran görüntüleri fixture ise gerçek analiz kanıtı değildir. Özel canlı yönetici oturumu atlanmadı; canlı yayın doğrulaması tam commit/Worker sürümü, paket hash'leri, giriş ve oturumsuz API korumasıyla yapılır. OAuth, D1 şeması, Cron, senkron, günlük yazma bütçesi, tarama ve Cloudflare dağıtım akışı değiştirilmedi. Canlı mavibasim.com'a yazılmadı, ücretli hizmet eklenmedi.

## Dosyalar

- Arayüz: public/index.html, public/app.css, public/period.js, public/app.js, public/modules.js.
- Ortak dönem ve veri hesapları: src/periods.ts (yeni), src/performance.ts, src/index.ts, src/analysis.ts, src/validation.ts, src/data-integrity.ts, src/questions.ts.
- Mevcut salt okunur operatör: src/crawl-pilot.ts; üç dönem ve ürün hesabı kabulü, herkese açık endpoint yok.
- Testler: tests/periods.test.ts (yeni), performance.test.ts, api.test.ts, data-integrity.test.ts, crawl-pilot.test.ts ve browser/usage.spec.ts.
- Belgeler: README.md, TODO.md ve bu rapor.
