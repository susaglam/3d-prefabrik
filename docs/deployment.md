# Çalıştırma ve dağıtım

## Yerel çalışma

`python3 scripts/serve.py --port 8078` → `http://localhost:8078/prefab`.

Python standart kitaplığı yeterli; statik varlıklar repoda. Sunucu `127.0.0.1` üzerinde dinler. Yerel veritabanı `.data/prefab.sqlite3`; SQLite WAL dosyalarıyla beraber özel veri sayılır ve Git'e alınmaz. Yedek için Python/SQLite backup API veya durmuş sunucudaki bütün SQLite dosyalarını kullanın; çalışan WAL veritabanının yalnızca ana dosyasını kopyalamayın.

Paylaşım 30 gün, özel teklif bağlantısı 90 gün geçerlidir. Yerel servis açılışta süresi dolmuş kayıtları temizler. Gerektiğinde `python3 scripts/serve.py --purge-expired`. Odoo adaptöründeki cron aynı özel kayıtları temizler; oluşturulmuş CRM kaydının saklama süresi kurumun ayrı politikasıdır.

## Odoo kurulumu

1. Uyumlu Odoo kodu ve boş/izole test veritabanı kullanın. Mevcut işletme veritabanına kurmadan önce DB+filestore yedeğini doğrulayın.
2. `addons/cs_prefab_configurator` klasörünü addons path'e ekleyin. `website` ve `crm` bağımlılıkları vardır.
3. `-i cs_prefab_configurator --stop-after-init --without-demo=all` ile ilk kurulumu test edin. Başarılı kurulumdan sonra normal Odoo HTTP sürecini başlatın.
4. `/prefab`, `/prefab/api/catalog`, `/prefab/api/price`, paylaşım ve sahte verili yerel teklif/PDF senaryosunu doğrulayın.
5. Yönetim arayüzünde CRM fırsatı ve Prefab talebi arasındaki bağlantıyı, şirket/site kapsamını ve teklif anlık görüntüsünü kontrol edin.

Genel HTTP arayüzü aynı olduğu için bağımsız uygulamanın frontend'i Odoo içinde de kullanılır. ORM adaptörü site ve şirket bağlamıyla kayıt arar. Paylaşım anahtarı, özel teklif erişim anahtarı ve tekrar gönderme anahtarı birbirinden ayrıdır.

## Kamuya açmadan önce gerçek işletme verileri

- Onaylı fiyat kitabı, KDV politikası, kapsam, montaj/transport/craning ve bölgesel koşullar. Mevcut kitap demonstrasyondur; rakip fiyatı değildir.
- Kullanılacak marka, işletme adı ve alan adı. `CS Prefab` proje markasıdır.
- İşletmenin iletişim metni, veri saklama süresi ve gizlilik iletişim noktası. Arayüzdeki yerel demo açıklaması uygun üretim metniyle değiştirilmelidir.
- Talebin hangi CRM ekibine atanacağı ve istenirse gerçekten yapılandırılmış e-posta teslimi. Şu an e-posta gönderimi yoktur.
- Web sitesi domain'i ve güvenilir proxy ayarları. Odoo same-origin kontrolü `website.domain` veya gerçek request origin kullanır.
- Geometri/ölçü/fundering kararlarının teknik doğrulaması; preview üretim resmi değildir.

Bağımsız `http.server` süreci yerel geliştirme içindir. Kamuya açık yayın için Odoo/üretim uygulama sunucusu ve HTTPS reverse proxy kullanın; süreç içi rate limiter yerine proxy katmanında da hız sınırlaması uygulayın. Bütün istekleri IP başlığından körlemesine güvenerek tanımlamayın.

## Geri dönüş

Yeni modülün ve ilgili veritabanının eşleşen yedeğini tutun. Bir sürüm hata verirse önceki addon sürümüyle birlikte test edilmiş DB/filestore yedeğine dönün. Teklif kayıtlarının yalnızca kodu değiştirerek silinmesi veya eski fiyatlarla yeniden hesaplanması yapılmaz; kaydedilmiş fiyat ve etiketler belgenin kaynağıdır.

Bu çalışma mevcut CS Product Configurator veya başka bir canlı siteye dağıtım yapmaz. İzole Odoo denemesinin kapsamı ve sonucu `delivery-report.md` içinde açıklanır.
