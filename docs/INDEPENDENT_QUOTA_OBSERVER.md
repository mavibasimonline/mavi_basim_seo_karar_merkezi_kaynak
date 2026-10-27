# GitHub gecikmelerinden bağımsız kota gözlemcisi

Bu değişiklik ayrı bir Worker hazırlar. **Henüz dağıtılmış veya etkin değildir.** Ana uygulama, Google OAuth, `*/15` Cron, okuma/yazma eşikleri ve veri modeli değişmez. Yeni migration veya toplu aktarım yoktur.

## Neden ayrı gözlemci?

GitHub scheduled workflow'ları gecikebilir; yüksek yükte olaylar düşebilir. Aktif ve doğru bir workflow'un elle çalışması, gelecekteki scheduled teslimi garanti etmez. Worker'ın 75 dakikalık geçerli hesap gözlemi istemesi korunmalıdır. Süreyi uzatmak, eski analitiği güncel saymak veya yerel rezervleri sıfırlamak çözüm değildir.

Resmî sınır: [GitHub schedule olayı](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule). Runs API, oluşmamış bir olayın platform içi nedenini açıklamaz. Yeni scheduled kayıt bulunursa önceki "hiç otomatik çalışmıyor" yorumu güncellenmelidir; bir başarılı teslim de süreklilik kanıtı değildir.

## Seçenek karşılaştırması

| Seçenek | Ek D1 / yürütme maliyeti | Güvenlik ve uygulanabilirlik |
|---|---|---|
| Mevcut GitHub saatlik + yedekler | En çok96 küçük checkpoint/gün; saatlik ayrı kabul okumaları | Var olan güvenli yol; aynı GitHub teslimine bağımlı olduğundan tek başına kalıcı süreklilik sağlamaz. Korunur. |
| **Ayrı Cloudflare Worker, saatte2 gözlem** | **48 GraphQL +48 sağlık GET + en çok48 PK upsert/gün**; büyük tablo okunmaz | GitHub zamanlayıcısından bağımsız. Ayrı read-only analytics token ve tek mevcut D1 binding; önerilen çözüm. |
| Ana uygulamanın Cron'una yenilemeyi eklemek | Benzer küçük checkpoint yükü | Ana uygulamaya Cloudflare kimliği taşır ve mevcut giriş noktasını değiştirir; bu görevde uygulanmadı. |
| Haricî ücretsiz cron → GitHub dispatch | Sağlayıcıya göre değişir; her tetikleme yeni Actions işi | Ek sağlayıcı, GitHub yazma/dispatch kimliği ve ikinci hata alanı getirir. Seçilmedi. |

48 küçük PK güncellemesinde normal beklenti yaklaşık48 okuma/gün ve günlük ilk insert indeks maliyetiyle yaklaşık49 yazma/gündür. Testler gerçek yerel D1 metadata'sını doğrular. İşlem başına10 okuma/10 yazma doğrulama sınırı için muhafazakâr plan480/480'dir; ölçülmüş üretim tüketimi değildir. Mevcut GitHub kabul okumaları ayrıca devam eder. Ücretsiz günlük5M okuma/100k yazma ve100k Worker isteği sınırına göre ek yük küçüktür. Hesaptaki diğer Worker/Cron sayısı, toplam tüketim ve ücretsiz10ms CPU sınırı **etkinleştirmeden önce gerçek hesapta doğrulanmalıdır**. Ücretli plana otomatik geçiş yoktur.

## Güvenlik ve hata davranışı

- Sabit, bağımsız Worker adı; `workers_dev=false`, preview ve site route yok. HTTP işleyicisi404; dışarıdan izin yenileme endpoint'i açılmaz.
- Yalnız Cloudflare **Account Analytics:Read** yetkili, ilgili hesapla sınırlı `CF_QUOTA_ANALYTICS_TOKEN` secret'ı. Ana Worker'a veya Google OAuth'a eklenmez. Mevcut geniş dağıtım token'ı runtime secret olarak kopyalanmaz.
- D1 binding yalnız mevcut DB'ye gider. D1'in tablo bazında binding yetkisi yoktur: bu ayrı kod teknik olarak DB yazma yetkisi taşır; inceleme/testler SQL'i `d1_quota_state` PK upsert'iyle sınırlar. Ledger/fact/OAuth/rapor/ürün tablolarına dokunmaz.
- Önce gerçek canlı uygulamanın read guard kimliği, sonra hesap genelindeki tüm D1 veritabanlarının analitiği doğrulanır. HTTP redirect, response boyutu ve8sn timeout sınırları vardır; istekler retry edilmez.
- Eksik/boş/gecikmiş/bozuk/gelecek tarihli analitik veya kota sınırı halinde D1 checkpoint yazılmaz. Analitik75–120dk gecikmişse yalnız `slow`;120dk üstünde yenileme yok. UTC gece yarısında eski izin taşınmaz.
- 75dk izin, mevcut hesap stop eşikleri ve yerel atomik rezervasyon mekanizması korunur. Sayaç düşürülmez, rezerv sıfırlanmaz; daha yeni checkpoint eski gözlemle ezilmez. Bu yeni gözlemci mevcut `blocked` durumunu açmaz.
- Ana Cron'un herhangi bir işini çalıştırmaz, yeniden kuyruğa almaz veya tarama/rapor üretimi yapmaz. Loglarda yalnız güvenli sonuç kategorisi ve checkpoint satır maliyeti bulunur; token, Google verisi ve hesap sayaçları basılmaz.
- Cloudflare'ın da arıza/gecikme olasılığı vardır. Bağımsız tetikleme dayanıklılığı artırır; kesintisiz çalışma garantisi vermez. İki gözlemci de aksarsa uygulama güvenli biçimde bekler.

## Onaydan sonraki kontrollü kurulum

1. PR'ın tam son SHA CI'si başarılı olmalı; **ayrı kullanıcı onayı olmadan birleştirme/dağıtım yok**. Ana uygulamayı tekrar dağıtma.
2. Ücretsiz plan, hesap toplam Cron sınırı, mevcut D1 binding, canlı uygulama guard kimliği ve Worker CPU/kota koşullarını doğrula. Mevcut DB migration'larını çalıştırma.
3. Yeni gözlemciyi bu config ile önce `QUOTA_OBSERVER_ENABLED=false` olarak dağıt. Varsayılan budur; geçerli token olmasa bile D1'e gitmez. Otomatik Git Build bağlantısı ekleme.
4. Hesap sahibi dar yetkili Analytics:Read token'ını oluşturup yalnız yeni Worker'ın `CF_QUOTA_ANALYTICS_TOKEN` secret'ına kaydeder. Sohbet veya GitHub koduna yazmaz. `CLOUDFLARE_ACCOUNT_ID` yeni Worker'ın ilgili hesap ID binding'idir.
5. Aynı yeni Worker'da `QUOTA_OBSERVER_ENABLED=true` ile kontrollü etkinleştir. **Ana Worker'ın adı/config'i/secret'ları kullanılmaz.** Cron yalnız yeni gözlemcide `2,32 * * * *`; ana `*/15` aynıdır.
6. İlk gerçek scheduled logda checkpoint sonucu, D1 gerçek maliyeti ve kalıcı izin zamanını doğrula. Ardından mevcut ana Cron'un kendi kendine devam ettiğini salt okunur kabul et. Yeni token yetkisizse/analitik bozuksa izin yenilenmediğini doğrula; sınırsız tekrar yok.
7. Geri alma: yalnız yeni gözlemciyi `QUOTA_OBSERVER_ENABLED=false` yap. Eski Worker, D1 kayıtları, OAuth ve GitHub gözlemcisi korunur.

Dry-run (dağıtmaz):

```sh
node scripts/run.mjs wrangler deploy --dry-run --config deploy/wrangler.quota-observer.jsonc --outdir .local/quota-observer-build
```

## Salt okunur Temmuz kuyruk kabulü

Mevcut `d1-read-quota.yml` workflow'una ayrı `queue-metadata` manuel operasyonu eklendi. Varsayılan checkpoint ve iki schedule kuralı değişmedi. Bu operasyon checkpoint işini atlar; önce gerçek sürüm, hesap analitiği, kayıtlı güncel izin ve yerel boşluğu doğrular. En çok5000 okuma; yalnız5 SELECT; 184 gün/scope üzerinde indeksli JOIN ile bütün Temmuz işlerinin varlığını/uygunluğunu sayar, sıradaki geçmiş adayı ve son5 doğal Cron kaydını gösterir. Fact/rapor/tarama/OAuth sorgusu veya iş claim'i yoktur.

Sonuç yalnız public key ile şifreli artifact'tır; private key çalışma alanından çıkmaz. Public receipt anahtarı token değildir. `operator-receipt.mjs`, açık PR #27'deki aynı mevcut şifreleme yardımcısının byte olarak aynısıdır; ikinci şifreleme sistemi yazılmadı. PR #27 ile tek ortak yeni dosyanın içeriği aynıdır; backup.yml ve PR27 rapor kodu değiştirilmedi.

`claimJob(...,'history')` üç kapalı ayı öne alıp tarihleri büyükten küçüğe işler. Bu yüzden Eylül, sonra Ağustos, sonra Temmuz gelir. Araya güncel veri ve :45 tarama dilimleri girer; her Cron bir tam gün/scope tamamlamak zorunda değildir. Temmuz0/62 tek başına kuyruk hatası değildir. Regresyon, 62 Temmuz işi mevcutken Ağustos bitince31Temmuz'a geçildiğini gerçek yerel D1 üzerinde doğrular; üretim kuyruk sayıları yalnız özel denetim receipt'inden raporlanır.
