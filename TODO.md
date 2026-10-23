# Geliştirme devam kaydı

Bu dosya her doğrulanmış aşamada güncellenir. Gerçek Google/Cloudflare bağlantısı kurulmuş değildir. Kaynak CSV'ler değiştirilmez.

## Tamamlanan ilk aşama
- D1/SQLite ilişkisel şema ve değiştirilemez SEO snapshot tabloları.
- 521 UTF-16/TSV kaynağının 9.075 satırını özgün hücre, satır, dosya SHA-256 ve tarihle koruyan idempotent içe aktarım.
- Eksik kapsam bilgilerini bilinmiyor olarak saklama; varyant hacimlerini toplamama.
- Başarılı: `python3 -m unittest discover -s tests -p 'test_*.py' -v` — 5 test.

## Sıradaki somut işler
- Google sağlayıcıları, zamanlanmış iş kuyruğu ve güvenli tekrar deneme testleri.
- Robots kurallı tarama, sürüm farkları, bağımsız karar doğrulama ve sonuç ölçümü.
- Kanıtları saklayan API, tek ekran Türkçe panel, uçtan uca doğrulama ve CI.
- Son aşamada README ve bu durum kaydını gerçek sonuçlarla güncelle.

## Yetki ve erişim gerektirenler
- Google OAuth client/secret, GSC mülk izni ve opsiyonel GA4 property erişimi yok.
- Google Ads onaylı developer token ve müşteri erişimi yok; ücretli hizmet açılmayacak.
- Cloudflare hesap/D1 kimliği yok; üretime dağıtım yapılmadı.
- Bu ortamın ağ politikası `mavibasim.com` ve `developers.cloudflare.com` isteklerini 403 ile engelliyor. Gerçek tarama ve güncel ücretsiz kota doğrulaması henüz yapılamadı.

## Devamlılık
Son commit: `git log -1 --oneline` ile bakın (bu dosya ilgili commit'in içindedir). Kaynak dosyaları yerinde kalır. Yerel veritabanı ve gizli ayarlar Git'e dahil edilmez. Oturumun kendiliğinden yeniden başlayacağı garanti edilmez.
