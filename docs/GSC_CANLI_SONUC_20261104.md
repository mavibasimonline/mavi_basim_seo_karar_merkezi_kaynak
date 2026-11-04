# 4 Kasım 2026 — doğrulanmış SEO sistemi durumu

Üretim kodu: `3abea4a2075ebf7f68f4f94fb3046e4a0d72a098`.

- Uygulama Worker: `e13cf0fa-e824-4710-9507-2c92c2b99a64`.
- Özel arşiv Worker: `806423a8-936a-4c0f-8030-15f23473a902`.
- [Başarılı kontrollü yayın](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/actions/runs/41893586396).
- [Tam CI: 983 test](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/actions/runs/41892983769): 689 Workers, 222 Python, 24 ayrı SQLite, 4 aylık depo, 44 tarayıcı testi. Güvenlik taraması 0 açık; kaynak CSV'ler değişmedi.
- [Canlı salt okunur kabul](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/actions/runs/41893777948): GSC günlük 14/14, Eylül 30/30 ve Ekim 31/31 sayfa/sorgu günü, iki ayda 19.954 kaynak satırı. Sorgular anonimleştirme nedeniyle yine kısmi olabilir; eksik satır sıfır değildir.

Gerçek Workers `fetch` alıcısı hatası, eski ham hata/bekleme kodu uyumsuzluğu, ertelenen Durable Object kod geçişi ve gerçek Cron zamanındaki saniye/milisaniyenin reddi giderildi. 19:00:40.027 UTC doğal Cron, 31 Ağustos için 135 sayfa satırını kaydetti. Bunu okuyan denetimde manuel tick 0 ve GSC koleksiyonunda D1 isteği 0 idi. Çalışma `41892050195` içindeki yeni deneme bu kanıtı taşır; eski denemeler doğal Cron kanıtı sayılmaz.

İlk metadata aktarımı, kalan kullanıcı okuma payı içinde ve aynı toplam D1 limitleriyle üç sabit SELECT kullanır; ledger sıfırlanmaz. Kaynak veriler değişmez. Kopya hazırken ilk aktarım yolu tekrar D1 okumaz. Canlı kopya: 29 doğrulanmış ürün eşlemesi, 58 tarama gözlemi, 98 değişiklik. Bağlam hash'i: `a6d263fb8152eb8bebaa59663087ecbb1016e3ccecd1226ae64a33019b1106af`.

| Ay | GSC sayfa | Görünür sorgu | Eşleşen ürün | Cihaz | Ülke |
|---|---:|---:|---:|---:|---:|
| Eylül | 215 | 1.292 | 27 | 3 | 76 |
| Ekim | 172 | 1.109 | 29 | 3 | 61 |

Bunlar kırılım/satır adetleridir, trafik toplamı değildir. Ekim performans ve ürün yanıtları Eylül/Ekim'den 61 günlük **sayfa** referansı; sorgu yanıtı 61 **sorgu** referansı kullanıyor. Ürün adıyla aynı sorgunun kapsamları ayrıldı. Ekim değişiklik sorusu beş gerçek olay referansı gösteriyor; Eylül için kayıt yokluğu değişiklik yapılmadığı sayılmıyor. Kesin yayın zamanı yalnız doğrulanmış CMS/deploy kanıtıyla verilir.

Canlı `mavibasim.com` değiştirilmedi; D1 iş kayıtları, yedekler, eski arşivler ve CSV'ler silinmedi. Ücretli servis açılmadı. Girişsiz analiz/soru-cevap/iç kanıt uçları 401 verdi. [Karar merkezi](https://mavi-basim-seo-prod.mavibasimonline.workers.dev/independent-seo.html).

## Henüz tamamlandı sayılmayanlar

- Sonraki gerçek UTC gününde doğal Cron ve metadata yenilemesi. Salt okunur otomatik denetim 5 Kasım 03:35 TSİ / 00:35 UTC için tanımlı; testte saat ilerletmek canlı kanıt değildir.
- GA4 mülkü/kapsamı yok; GSC ülke verisi şehir/ilçe ziyaretçisi gibi sunulmaz.
- Metadata kopyası son eklenen en fazla 100 değişikliği kapsar; tüm yayın geçmişi iddiası yoktur. 3 Kasım taramasındaki `/sigorta-policeleri` HTTP 404 kaydı ayrıca incelenmelidir; trafik farkının nedeni olduğu varsayılmaz.
- Sonsuz ücretsiz saklama garantisi yoktur. Günlük 8 MiB, ilk iki ay toplam 16 MiB, yeni yazım toplam 128 MiB ve aynı SQLite nesnesi 256 MiB sınırında veri silmeden beklenir. Hesap genelindeki Durable Object kullanımı ölçülmüş sayılmaz.
- Canlı yönetici tarayıcı oturumuna erişim olmadığı için canlı girişli ekran kabulü yerine hesaba özel gerçek servis kabulü ve CI kullanıcı akışları doğrulandı.
