# Odoo 19.4 kurulumu ve configurator 2.0

13 Eylül 2026. Kullanıcının belirttiği boş Coolify deneme ortamına kuruldu: **[Configurator](https://prefabpartner.codesnap.nl/prefab)**. Yönetim: **[Catalogus en levering](https://prefabpartner.codesnap.nl/odoo/action-572)**; Odoo oturumu gerekir. Web sitesinin üst menüsünde Configurator bağlantısı bulunur.

## Kurulan modüller

| Modül | Gerçek kurulu sürüm |
| --- | --- |
| `cs_prefab_configurator` | `saas~19.4.2.0.0` |
| `cs_studio_workspace` | `saas~19.4.1.3.9` |
| `cs_web_responsive` | `saas~19.4.1.2.2` |
| `cs_security_base` | `saas~19.4.1.0.0` |
| `cs_help_base` | `saas~19.4.1.9.10` |

Destek modülleri `E:\Source\cs-odoo-modules` içinden alındı; kaynak repo değiştirilmedi. Modül seçimi açık listeyle paketlendi. Gerçek hedef `common.version()` yanıtı `saas~19.4`; manifest adı değiştirilerek sürüm varsayılmadı. Bu hedefte yeni `ir.access` ve website çözümlemesi kullanılıyor.

Kalıcı hedef `/mnt/extra-addons`. Container başlangıcı yalnız bu dizinin kökündeki `requirements.txt` dosyasını okuyor. [addons/requirements.txt](../addons/requirements.txt) içindeki `-r cs_prefab_configurator/requirements.txt` satırı modül dosyasını kapsar. Şimdiki modüller için Odoo'nun mevcut Python paketlerine ek paket gerekmiyor. Boşuna pip bağımlılığı eklenmedi.

## Bu sürümün kapsamı

- Dört adım: dış, iç, saha/teslim kapsamı ve teklif özeti; masaüstünde büyük sahne ve seçenek paneli, mobilde sıkıştırılmış sahne ve sabit ilerleme alanı.
- Dış/iç/kesit/tavan kameraları, ölçülü 2D plan, yerel HDR ışık ve malzeme yüzeyleri. Ek cihazlar yapı ölçüsü değişince orantısız büyümez.
- Dahil cihaz için dolu malzeme; dahil olmayan örnek için dolgusuz, derinlik testli kontur; hazırlık noktası ayrıca görünür. Örnek görünürlüğü fiyatı ve seçimi değiştirmez.
- Yeşil çatı, saçak/spotları, ışıklık gölgelik, boya, doğrama malzemesi, iç konum seçimi, çift dış priz/musluk, çift iniş borusu ve isteğe bağlı rollaag. Eski seçimler desteklenir. Üreticiye ait doğrulanmamış 15 m genişlik sınırı kopyalanmadı.
- Odoo kataloğunda hazırlık, ürün, montaj ve bağlantı ayrı kapsam bileşenleridir. Başlangıç demo kataloğu 37 kural içerir. Değiştirmek için **Nieuwe versie maken**, ardından düzenleme ve **Publiceren** kullanılır.
- Yayınlanan katalog ve eski teklif anlık görüntüleri değişmez. Eski katalogla yeni fiyat/teklif isteği sürüm uyuşmazlığı döndürür; önceden kabul edilmiş aynı teklif isteği kendi sonucunu döndürür.

## Doğrulama

| Kontrol | Sonuç ve sınır |
| --- | --- |
| Python servis regresyonları | 64/64 geçti |
| JavaScript model/geometri/fixture/belge testleri | 46/46 geçti |
| Gerçek Odoo HttpCase | 6/6 geçti; aynı 19.4 image üzerinde restore edilmiş ayrı PostgreSQL ile |
| Yerel browser akışı | 19/19 geçti; sonraki rollaag ve renderer düzeltmeleri ayrıca hedefli browser kontrollerinden geçti |
| Etkileşim / erişilebilirlik | 6/6; 12 axe taraması, 0 ihlal ve 2 SVG kontrast kontrolü |
| Belge görseli yakalama | 5/5 geçti |
| Sağlanan web adresi | WebGL, fiyat/scope, dört adım, oturum açma ve katalog yönetim görünümü gerçek tarayıcıda geçti |

Gerçek Odoo testleri CRM/snapshot, idempotency, public PDF, QWeb HTML ve gerçek wkhtmltopdf PDF dosyası, paylaşım, site/şirket sınırı, ACL, katalog yayınlama ve tekrar yayınlama davranışlarını kapsar. Binary QWeb testi `force_report_rendering=True` kullanır; Odoo test modunun HTML dönüşü PDF sonucu sayılmaz. Son koşuda bu PDF kontrolü dahil 6 testin tamamı geçti. İlk çalıştırmada testin `website.default_website` varsayımı başarısız oldu; mevcut şirkete ait website fixture çözümlemesiyle düzeltildi. Başarısız ilk koşu başarılı test gibi sayılmadı.

Kanıtlar: [kurulu sürümler](verification/odoo-19.4/installed-modules.json), [hedef browser kontrolü](verification/odoo-19.4/target-smoke.json), [dış görünüm](verification/odoo-19.4/public-desktop.png), [mobil](verification/odoo-19.4/public-mobile.png), [son iç kontur görüntüsü](verification/browser-interior-final-contour.png), [renderer kontrolü](verification/browser-render-final.json).

## Yedek ve dağıtım

Kurulumdan önce ana veritabanının `pg_dump -Fc` yedeği ve filestore arşivi alındı. Veritabanı yedeği ayrı PostgreSQL container'ına başarıyla geri yüklendi. Yedekler sunucuda yalnız bu işe ait özel dizinde saklanır:

`/data/coolify/services/1g0js18r8r7j2esjrwywythj/cs-prefab-work/20260913T020949Z/backup/`

Bu yol uzak Linux sunucusundadır. Odoo'nun kendi container'ı durdurulup aynı image ile ayrı, HTTP açmayan kurulum işlemi çalıştırıldı; ardından asıl container başlatıldı. PostgreSQL ve diğer Coolify servisleri yeniden kurulmadı. Ana kurulum exit code 0; HTTP 200 ve Coolify sağlıklı durumu doğrulandı. Ek addon ve data volume'ları kalıcıdır.

Paketleme: [scripts/package_odoo.py](../scripts/package_odoo.py). Arşivler ve dosya bazında SHA-256 manifestleri `.data/releases/` altında, Git dışında bulunur. Son dağıtımın 331 dosyası arşivle birebir SHA-256 karşılaştırılarak doğrulandı; [release.json](verification/odoo-19.4/release.json) kanıtı içerir. Kimlik dosyası ve erişim anahtarları pakete/rapora alınmaz. Testler tamamlandıktan sonra ayrı Odoo/PostgreSQL test container'ları ve geçici bağlantı konfigürasyonu kopyaları kaldırıldı; yedekler saklandı. Bundan sonraki deneme adresi kullanıcının verdiği asıl Coolify hedefidir.

## Sınırlar ve sonraki çalışma

Fiyat kitabı **demonstrasyondur**; ticari fiyat/tedarik şartları doğrulanmadan satış fiyatı olarak kullanılamaz. 3D, üretim çizimi veya doğrulanmış üretici modeli değildir. Kontur/dolu gösterimi teslim kapsamını ayırır; dolu model de kesin marka/model vaadi taşımaz. İç sahne ilk geliştirilmiş sürümdür; üretici ölçülü cihaz modelleri, daha ayrıntılı doğrama/cam ve iç kaplama geometrisi sonraki görsel kalite çalışmasına açıktır.

Adminin katalog/kuralları düzenlemesi desteklenir; yeni geometri türü yalnız JSON'a satır eklemekle oluşmaz. Serbest cihaz sürükleme, onaylı üretim toleransları, gerçek fiyat kitabı ve Woonserre ürün dalı bu sürümün tamamlandı iddiasına dahil değildir. [Yol haritası](development-roadmap-2026-09-13.md) bu kararların bağlamını korur.

Tasarımın iki ana görsel kontrol turu ve bulunan sorunlar için sınırlı son düzeltme yapıldı. Impeccable algılayıcısı eksik parser bağımlılıkları nedeniyle `degraded` çalıştı; bu çıktı bağımsız tasarım onayı olarak sunulmaz.
