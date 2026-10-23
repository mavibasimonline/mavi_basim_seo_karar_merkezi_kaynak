# Güvenli üretim geçişi

Bu yönerge dağıtım hazırlığıdır. Bu oturumda gerçek Cloudflare kaynağı oluşturulmadı, Google hesabı bağlanmadı ve canlı site değiştirilmedi. Yeni uygulama özelliği eklenmedi; `src/` ve `public/` mevcut çalışan sürümde korunur. Uygulama sürümü incelemesi: `docs/RELEASE_REVIEW.md`; kabul: `docs/PRODUCTION_ACCEPTANCE.md`.

## 1. Birleştirme kapısı

- Hedef `main`, kaynak `feat/seo-karar-merkezi`; [PR #1](https://github.com/mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak/pull/1) oluşturuldu, açıklaması `docs/PULL_REQUEST.md` içindedir. Merge veya auto-merge açılmadı.
- PR'nin son HEAD'i için CI, kaynak koruması, güvenlik ve mobil/masaüstü testleri yeşil olmalı. Yerel geçiş uzak CI sonucu yerine kullanılamaz.
- `main` sonradan değişirse fetch ve merge denetimini tekrarlayın; kullanıcı değişikliklerini reset/rebase ile silmeyin.

## 2. Free plan ve gerekli hesap yetkileri

Cloudflare hesabının **Workers Free** planında olduğunu hesap panelinden doğrulayın. Alan adının Free planı ile Workers planı farklıdır. Hesap zaten Paid ise burada hazırlanan yapılandırma faturalandırmayı kapatmaz; bu hesapla ilerlemeyin. Ücretsiz sınır aşılırsa görevi durdurun; plan yükseltmeyin.

Resmi Cloudflare doküman deposunun `a19cd5d3c8d08792cb462d83606474ff7b84fe2e` sürümünden okunan sınırlar:

| Kaynak | Free sınırı |
|---|---|
| Workers istekleri | 100.000/gün; diğer Worker'larla hesap toplamı |
| CPU | HTTP ve Cron çağrısı başına **10 ms**; ağ/DB bekleme süresi CPU değildir |
| Bellek / subrequest | 128 MB / çağrı başına 50 |
| D1 sorguları | Çağrı başına 50; batch içindeki her SQL ayrı sayılır |
| D1 SQL / bind | Sorgu başına 100 KB / 100 parametre |
| D1 satır okuma / yazma | 5 milyon/gün / 100.000/gün; indeks yazıları da sayılır |
| D1 saklama | Veritabanı başına 500 MB; hesap toplamı 5 GB; en fazla 10 veritabanı |
| D1 Time Travel | 7 gün |

Kaynaklar: [Workers ücret](https://developers.cloudflare.com/workers/platform/pricing/), [Workers sınır](https://developers.cloudflare.com/workers/platform/limits/), [D1 ücret](https://developers.cloudflare.com/d1/platform/pricing/), [D1 sınır](https://developers.cloudflare.com/d1/platform/limits/). Doküman sitesine bu ortamdan erişim engelliydi; içerik resmi GitHub deposunun sabit commit'inden doğrulandı. Bunlar sizin hesabınızda kalan kota veya uygulamanın 10 ms CPU'ya sığdığına dair ölçüm değildir. İlk gerçek aktarım/raporda CPU ve D1 Metrics ölçümü kabul koşuludur.

İlk kaynak aktarımında tablo, indeks ve migration yazıları da günlük kotaya girer. Aynı anda 400 günlük backfill başlatıp kotaya sığdığını varsaymayın; iş kuyruğu parçalara ayırır, gerçek günlük bütçe panelde izlenir. CPU limit hatası `1102`, günlük istek limit hatası `1027` görülürse otomasyonu kapatın. Ücretli CPU ayarı veya ek hizmet eklemeyin.

Gerekli tek seferlik yetkiler: seçilen hesapta D1 oluşturma/düzenleme ve Workers script/secret düzenleme. `mavibasim.com` zone/DNS/CMS düzenleme izni gerekmez. Dağıtıcı için hesapla sınırlı token veya yetkili Wrangler OAuth; yedekleyici için ayrı, mümkün olan en dar D1 okuma token'ı kullanın. Geniş yetkili dağıtım token'ını GitHub yedek işine koymayın. Değerleri loga veya sohbete yazmayın.

## 3. Ayrı D1 ve Worker'ı hazırlama

Geliştirici bir defa aşağıdakileri uygular; kullanıcı günlük komut çalıştırmaz. Node 24 / Python 3.12 ve checkout mevcut olmalıdır.

```sh
npm ci --ignore-scripts --no-fund
npm audit --audit-level=moderate
npm run check
python3 scripts/release_checks.py --base origin/main
node scripts/run.mjs wrangler whoami
node scripts/run.mjs wrangler d1 create mavi-basim-seo-prod
```

Son iki komut gerçek hesap yetkisi geldikten sonra uygulanır; burada çalıştırılmadı. `whoami` hesabın Free olduğunun kanıtı değildir; plan ayrıca panelden doğrulanır. `deploy/wrangler.production.jsonc` içindeki D1 kimliğini oluşturulan gerçek UUID ile değiştirin. Ayrı uygulama adresi `https://mavi-basim-seo-prod.<hesap-alt-adı>.workers.dev` olacaktır; callback yer tutucusunu bununla doldurun. `workers_dev=true`, `preview_urls=false`; hiçbir `routes`, zone veya canlı site alan adı eklenmez. Mevcut geliştirme `wrangler.jsonc` dosyası korunur.

İlk yapılandırmada Cron listesi boş, tarama ve Ads kapalıdır. Gerçek kimlikler geldikten sonra:

```sh
python3 scripts/release_checks.py --base origin/main --ready
node scripts/run.mjs wrangler deploy --dry-run --config deploy/wrangler.production.jsonc --outdir .local/production-build
node scripts/run.mjs wrangler d1 migrations apply DB --remote --config deploy/wrangler.production.jsonc
npm run data:prepare
node scripts/run.mjs --capture .local/production-import.log wrangler d1 execute DB --remote --config deploy/wrangler.production.jsonc --file .local/keywords.sql
node scripts/run.mjs wrangler d1 execute DB --remote --config deploy/wrangler.production.jsonc --file deploy/acceptance-source.sql
```

Beklenen: 3 uygulama migration'ı, 4 grup, 29 ürün, 521 kaynak, 9.075 gözlem. Aktarım sadece yeni SEO D1'e gider; kaynak CSV'lere veya canlı siteye yazmaz. Kaynak SQL'i yalnızca yerel `.local/` içinde oluşturulur. Çıktıdaki sıfır Google/tarama kaydı ilk kurulum için doğrudur. Tekrar aktarım sayıları çoğaltmamalı; günlük yazma kotası nedeniyle gereksiz tekrar yapmayın.

## 4. Güvenli secret ve ilk yayın

`ADMIN_TOKEN`: en az 32 rastgele bayttan türetilmiş güçlü, benzersiz değer. `TOKEN_ENCRYPTION_KEY`: 32 rastgele baytın base64 karşılığı. Yerel test anahtarlarını üretime kopyalamayın. İkisini ayrı güvenli anahtar kasasında saklayın. Google secret daha sonra aynı yöntemle girilir:

```sh
node scripts/run.mjs wrangler secret put ADMIN_TOKEN --config deploy/wrangler.production.jsonc
node scripts/run.mjs wrangler secret put TOKEN_ENCRYPTION_KEY --config deploy/wrangler.production.jsonc
node scripts/run.mjs wrangler deploy --config deploy/wrangler.production.jsonc
```

Değerler terminalin güvenli istemine girilir; komut satırı argümanına, dosyaya veya Git'e eklenmez. Dağıtım öncesi aktif eski üretim varsa sürüm ID'sini ve şifreli D1 yedeğini alın. Önceki örnek hiç yayınlanmadıysa rollback hedefi yoktur.

İlk yayın sonrası `disconnected` kabulünü uygulayın. Panel giriş ister; 521/9.075 arşivi görünür, gerçek GSC tıklamaları yerine Veri bekle yazmalıdır. `/api/health` 200 dönmesi tek başına kabul değildir. Yayınlanmış Worker yalnızca ayrı workers.dev adresindedir.

## 5. Gerçek GSC OAuth yetkilendirmesi

Hesap sahibinin bir defalık onayı gerekir:

1. Kendi Google Cloud projesinde ücretsiz **Google Search Console API** etkinleştirilir. Bu işlem için faturalı bir servis veya Google Ads kampanyası açılmaz.
2. Google Auth Platform/izin ekranında uygulama adı, destek e-postası ve kullanıcı türü belirlenir. Tek hesaplı ilk testte hesabı Test users listesine ekleyin. External **Testing** durumunda çevrimdışı refresh token'ların genellikle 7 günle sınırlı olduğunu dikkate alın; gözetimsiz üretim için Google'ın uygun Internal/Production durumuna ve gerekli olursa doğrulama sürecine geçilmelidir. Verification gerektiğinde uyarı atlatılmaz.
3. OAuth istemci türü **Web application** olur. Authorized redirect URI tam olarak `https://mavi-basim-seo-prod.<hesap-alt-adı>.workers.dev/api/oauth/google/callback`; şema, host, path ve son slash birebir eşleşmelidir.
4. GSC'de var olan `https://mavibasim.com/` URL-prefix mülkünü okuyabilen hesap kullanılır. Yalnızca domain mülkü varsa `GSC_PROPERTY=sc-domain:mavibasim.com` olarak yapılandırılır. Mevcut mülk izni kullanılır; sırf bu uygulama için siteye doğrulama etiketi veya DNS kaydı eklenmez. İzin mevcut mülk sahibi tarafından verilir.
5. `GOOGLE_CLIENT_ID` ve `GOOGLE_CLIENT_SECRET` aşağıdaki secret komutlarıyla güvenli girilir. `GOOGLE_REDIRECT_URI` üretim yapılandırmasındaki gerçek adresle aynı olmalıdır.

```sh
node scripts/run.mjs wrangler secret put GOOGLE_CLIENT_ID --config deploy/wrangler.production.jsonc
node scripts/run.mjs wrangler secret put GOOGLE_CLIENT_SECRET --config deploy/wrangler.production.jsonc
node scripts/run.mjs wrangler deploy --config deploy/wrangler.production.jsonc
```

Panelde yönetici girişinden sonra **Google'ı bağla** seçilir. İstenen GSC kapsamı yalnızca `https://www.googleapis.com/auth/webmasters.readonly`. İlk üretim kabulünde GA4 ayarı ve Ads kapalı kalsın. GA4 daha sonra istenirse `analytics.readonly`, Ads ayrıca istenirse daha geniş `adwords` kapsamı gerektirir; bu geçiş bunları etkinleştirmez.

Callback'in başarılı olması yalnızca şifreli bir OAuth kaydı oluşturulduğunu gösterir. Gerçek API erişimi ilk kesinleşmiş günlük dataset ve sağlık kontrolüyle doğrulanır. Token içeriğini D1 sorgusunda göstermeyin. Test modunun token süresi, grant iptali ve uygulama sahibinin hesabı düzenli kontrol edilmelidir. Kaynaklar: [Google web OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [OAuth production](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance), [Search Analytics](https://developers.google.com/webmaster-tools/v1/searchanalytics/query).

## 6. İlk gerçek senkron ve taramayı kontrollü açma

GSC izninden sonra `triggers.crons` değerini `["*/15 * * * *"]` yapıp aynı ayrı Worker'a deploy edin. **Tarama hâlâ false** olsun. Cron değişikliği 15 dakikaya kadar yayılabilir; art arda deploy/tetikleme yapmayın. İlk tur işleri planlar; sonraki turlar sayfa/sorgu parçalarını alır. Sıfır veya kısmi yanıt gerçek performans kabulü değildir. Ayrıntılı senkron SQL'i ve ilk gün karşılaştırması kabul belgesindedir.

Bir kesinleşmiş günün sayfa ve sorgu veri kümeleri geçince, siteye yalnızca okuma yapılacağı ve robots politikasının uygun olduğu doğrulanarak `CRAWL_ENABLED=true` yapılır. Aynı Worker'a deploy edin. Saatin `:45` dilimi taramaya ayrılır; ilk robots alımında crawl-delay beklenmesi normaldir. Kabul, `/brosur` ve `/el-ilani` için gerçek 200 HTML/snapshot ile yapılır. Otomatik geçmiş tarama sırasında site içerikleri değiştirilmez. Ads false kalır.

İlk tam aylık rapor için seçilen ay ve önceki ayın **her günü** page/query dataset kapsamı, mevcut ürün sayfası ölçümleri ve tazelik kapısı gerekir. Backfill tamamlanmadan aylık analiz çalıştı denmez. Daha eski ay istenirse API'nin 72 saat tazelik şartını sağlamak üzere ilgili tarih aralığının tekrar alınması gerekebilir; eşiği gevşetmeyin.

## 7. Yedek, durdurma ve geri dönüş

Gerçek D1 kimliği aynı üretim dosyasına kaydedilince mevcut `backup.yml` artık doğru D1'i hedefler. GitHub'da yalnızca D1 okumasına yeterli ayrı `CLOUDFLARE_API_TOKEN`, hesap ID'si ve bağımsız `BACKUP_ENCRYPTION_KEY` güvenli Secret olarak girilir. Otomatik iş ilk kez main'de etkinleştirilmeden önce workflow_dispatch ile şifreli export/geri çözme/ayrı SQLite doğrulaması yapılır. Hesap ve GitHub dakika/artifact kullanımı kontrol edilir. GitHub işi üçüncü tarafı çağıran Cloudflare geniş token'ı almaz; dependency lifecycle script'leri kapalıdır.

Bir sonraki sürüm öncesi mevcut Worker deployment ID'sini ve doğrulanmış şifreli yedeği saklayın. Rollback önce Cron `[]`, tarama false ve aynı Worker'a deploy ile toplama işini durdurur. `wrangler deployments list --config deploy/wrangler.production.jsonc` ile bilinen sağlam ID belirlenir; `wrangler rollback <VERSION_ID> --config deploy/wrangler.production.jsonc` yalnızca yetkili kişi tarafından uygulanır. Kod rollback D1 migration'larını veya veri yazılarını geri almaz. Şifreleme anahtarını değiştirmeyin; Google token'ları çözülemez.

D1 Time Travel veya şifreli yedek önce **ayrı kurtarma D1** üzerinde değerlendirilir; kaynak D1'i silmeyin veya doğrudan üzerine yazmayın. Free hesapta ayrı D1'in de mevcut hesap/500 MB bütçesine sığması gerekir. Yeni veritabanında bütünlük/sayım/uygulama kabulü yapılmadan binding değiştirilmez. `mavibasim.com` için DNS, route veya yayın geri dönüş işlemi bu yönergenin parçası değildir.

## Yalnızca hesap sahibinin sağlayacağı noktalar

- Cloudflare Workers Free hesap/D1/Worker secret yetkisi ve ayrı workers.dev hesap alt adı; ücretli plana geçiş yok.
- Google Cloud OAuth projesi/istemcisi, mevcut GSC mülk izni ve tek seferlik kullanıcı consent'i. Üretim OAuth uygunluğu Google politikasına göre tamamlanmalı.
- Şifreli yedek anahtarının güvenli saklanması ve dar kapsamlı yedek erişimi.

Diğer hazırlıklar dosyalarda ve otomatik kontrollerdedir. Gizli değerler sohbette istenmez; yetki olmadan hesap bağlandı, dağıtıldı veya üretim çalışıyor denmez.

GitHub işlemleri mevcut kimlikle GraphQL üzerinden çalıştı; kullanıcıdan yeni GitHub token'ı veya ağ değişikliği gerekmiyor. Son PR HEAD'inin verify kontrolü burada hazırlanan CI komutlarını uzakta çalıştırır; main'e birleştirme otomatik yapılmaz.
