# PR #25 — 26 URL SEO incelemesi / yayın öncesi kabul kaydı
Tarih: 27 Ekim 2026. Bu kayıt, canlıya yayın izni veya dağıtım kanıtı değildir.

## Kapsam
- Kullanıcı tarafından paylaşılan 26 Ekim GSC Bağlantılar raporundan 8 ürün, 18 şehir URL'si; bağlantı değerleri **örneklem** olarak kaydedildi.
- Oturum korumalı GET /api/gsc-review?month=YYYY-MM: mevcut D1 snapshot kayıtları, kaynak URL gözlemleri ve ancak tamamlanmış/uygun saklı GSC analizi varsa dönem kıyası.
- Veri Sağlığı ekranından talep üzerine salt-okunur inceleme. Otomatik CMS yazma, cron genişletme, D1 migration veya toplu GSC aktarma yok.

## Veri ve yorum güvenliği
- Hedef sayfanın 200/canonical/noindex gözlemi kesin indeks bilgisi değildir; son tarama zamanı ayrıca görünür.
- Dahili bağlantı kaynakları en fazla 100 kaynak URL'nin son saklı taramasından gelir. Tam site bağlantı sayısı iddiası yapılmaz.
- 8 ürünün mevcut kayıtlı dönem kıyası ancak eksiksiz, taze, kesinleşmiş ve geçerli motor sürümündeki rapordan gelir.
- 18 şehir sayfasının ürün analiziyle otomatik eşlenmesi yoktur; şehirler için ayrıca doğrudan sayfa bazlı GSC raporu gereklidir.
- Tüm adaylar kanıt tamamlanana kadar `Veri bekle`; sistem bu iş akışıyla otomatik SEO düzeltmesi önermez.

## CI / engeller
- Commit 50b3ef5 workflow 40410934859 başarısız: 442/443 Vitest geçti, **tek başarısız test** kök sayfa URL normalizasyonunda son '/' beklentisiydi. Bu beklenti 24d6c49 commit'inde düzeltildi.
- **24d6c49 için tam CI geçmeden kabul verilemez.** E2E, Python ve üretim paket denetimi sonraki adımlardır.
- PR #24 (GSC URL doğrulama ve kota kontrollü üretim yolu) ile entegrasyon/çatışma ve tam üretim geçiş kontrolü ayrıca doğrulanmalıdır.
- Henüz gerçek D1 rapor kabulü, bütün 26 URL'nin canlı taranması, bütün dahili bağlantıların eksiksiz kapsanması ve doğrulanmış şehir karşılaştırması yok.
- Mevcut ekran düğmeyle veri okur; yeni 26 URL için otomatik toplama kapsamı tamamlanmış değildir.

## Yayına almadan önce zorunlu kapılar
1. PR güncel HEAD CI (typecheck, Vitest, Python, import, E2E, paketleme) **success**.
2. Güncel main/PR #24 birleşim durumunun ve çatışmasızlığın kanıtı.
3. Ücretsiz Cloudflare D1 okuma/yazma kotası, OAuth ve gerçek Worker sürümünün güncel doğrulanması.
4. Salt okunur gerçek ortam kabulü: oturum, GSC kapsamı, 26 satır, kaynak URL örneklemi, yanlış sıfır üretmeme, responsive panel.
5. Kullanıcıya kısa sonuç raporu sunulup **ayrı yayın onayı** alınması. Onay olmadan merge/deploy yok.

## Karar
**HENÜZ YAYINA HAZIR / YAYINLANMIŞ DEĞİL.** Canlı mavibasim.com ve üretim Worker/D1 değiştirilmedi.
