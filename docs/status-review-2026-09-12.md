# CS Prefab Configurator — durum incelemesi

12 Eylül 2026. İncelenen uygulama revizyonu: `f3da26e`, `main`; ürün sürümü `1.1.0`. Kullanıcının belirttiği hedef **Odoo saas~19.4**. Bu çalışma durum tespiti ve öneridir; uygulama kodu, müşteri kayıtları veya canlı sistem değiştirilmedi. Yalnız bu rapor eklendi.

**Genel değerlendirme:** İşlevsel kapsamı geniş, geliştirilebilir bir konfigüratör temeli mevcut. Sunucuda hesaplama, kayıt, paylaşım, CRM ve PDF zinciri düşünülmüş. Mevcut eklenti 19.4 için hazır değil; kaynakla doğrulanan uyumsuzluklar var. Premium hedef açısından en büyük eksikler 3D malzeme/ışık/detay kalitesi, uygulanabilir ürün kombinasyonları ve mobilde seçim–önizleme ilişkisidir. Mevcut iş kurallarını ve ortak geometri altyapısını koruyarak ilerlemek uygun görünüyor.

**İncelemenin kapsamı:** Python servisleri, Odoo adaptörü ve güvenliği, arayüz, Three.js geometri/render kodu, PDF üretimi, testler, CI ve teslim belgeleri okundu. Odoo incelemesi, görsel değerlendirme ve tarayıcı kontrolleri bağımsız görevler olarak yürütüldü. Tasarım değerlendirmesi otomatik detektör bulguları görülmeden tamamlandı; ardından güncel masaüstü/mobil ekranları incelendi. 19.4 uyumluluğu resmî kaynakla karşılaştırıldı; bu oturumda Odoo 19.4 kurulup çalıştırılmadı.

| Alan | Mevcut durum |
| --- | --- |
| Ürün akışı | Hollandaca, 7 bölüm; referansın 33 soru / 94 seçeneğinin eşlemesi |
| Boyut ve seçenekler | 150–750 cm genişlik, 100–340 cm derinlik; 13 cephe, 11 doğrama, 8 ışıklık seçeneği |
| Önizleme | Ölçüye bağlı Three.js 3D, ortak geometriden SVG plan/cepheler, kamera/çatı/ölçü kontrolleri; WebGL yoksa 2D |
| Fiyat | Sunucuda doğrulama ve hesaplama, integer cent; fiyat kitabı demonstrasyon |
| Kayıt | Cihazda taslak, kişisel veri içermeyen süreli paylaşım, değişmez teklif kaydı ve tekrar gönderimin birleştirilmesi |
| Odoo | Website rotaları, CRM fırsatı, özel teklif/paylaşım modelleri, yönetim görünümü, QWeb raporu, temizlik cron'u |
| Belgeler | Teklife dondurulan 3 perspektif/iç görünüm + 3 teknik görüntü; yerel PDF ve ayrı Odoo QWeb render yolu |
| Mimari | Aynı saf Python servislerini kullanan yerel HTTP/SQLite uygulaması ile Odoo ORM adaptörü; frontend yerel ES modülleri ve Three.js 0.180.0 |
| Ticari hazırlık | Onaylı fiyat kitabı, işletme bilgileri, CRM ataması ve e-posta teslimi henüz tamamlanmış değil |

Kaynaklar: [README](../README.md), [teslim raporu](delivery-report.md), [backend](BACKEND.md), [dağıtım notları](deployment.md). Teslim belgelerindeki test başarıları 9 Eylül tarihli kanıtlardır; aşağıdaki yeni sonuçlardan ayrıdır.

**Odoo 19.4 için üç somut uyumsuzluk bulundu.** Karşılaştırılan resmî kaynak `saas-19.4` dalının `3630379f63633612e5a9e8d435deecbe26eaa15a` revizyonudur. Aşağıdaki etkiler kaynak incelemesine dayanır; hedef sunucuda üretilmiş hata kayıtları değildir.

| Öncelik | Yerel kanıt | Etki ve öneri |
| --- | --- | --- |
| Yüksek | [Manifest](../addons/cs_prefab_configurator/__manifest__.py), satır 4: `saas~19.3.1.1.0` | 19.4 sürüm doğrulaması eski seri önekini kabul etmiyor. Hedef seriyle uyumlu manifest hazırlanmalı. |
| Yüksek | [Güvenlik XML'i](../addons/cs_prefab_configurator/security/security.xml), satır 3/8; [ACL CSV](../addons/cs_prefab_configurator/security/ir.model.access.csv) | Eski `ir.rule` ve `ir.model.access` tanımları 19.4'teki `ir.access` yapısına taşınmalı. Sadece model adı değiştirilmemeli; izinler, grup ilişkileri ve şirket kısıtları birlikte doğrulanmalı. |
| Yüksek | [Controller](../addons/cs_prefab_configurator/controllers/main.py), satır 21/113/117: `request.website` | Güncel website bağlamıyla uyumsuz. Kurulum engelleri giderilse bile API'de hata beklenir. Hedef sürümün site çözümleyicisi kullanılmalı ve şirket/site ayrımı korunmalı. |

Resmî kaynaklar: [manifest doğrulaması](https://github.com/odoo/odoo/blob/3630379f63633612e5a9e8d435deecbe26eaa15a/odoo/modules/module.py#L531), [yeni erişim modeli](https://github.com/odoo/odoo/blob/3630379f63633612e5a9e8d435deecbe26eaa15a/odoo/addons/base/models/ir_access.py#L64), [Website güvenlik CSV'si](https://github.com/odoo/odoo/blob/3630379f63633612e5a9e8d435deecbe26eaa15a/addons/website/security/ir.access.csv), [website HTTP bağlamı](https://github.com/odoo/odoo/blob/3630379f63633612e5a9e8d435deecbe26eaa15a/addons/website/models/ir_http.py#L239), [site çözümleyicisi](https://github.com/odoo/odoo/blob/3630379f63633612e5a9e8d435deecbe26eaa15a/addons/website/models/website.py#L1486).

Repo önceki kurulumun izole **Odoo Community saas-19.3** üzerinde yapıldığını açıkça belgeliyor. Son PDF çalışmasında dört HttpCase, gerçek QWeb PDF ve üç belge senaryosunun sonuçları var. Bunlar 19.4 doğrulaması sayılmaz. Ham Odoo test logunun belirtilen geçici Linux yolu repo içinde bulunmuyor; PDF örnekleri ve render sonuçları mevcut. Canlı hedefin hosting modeli repo kanıtlarından kesinleşmiyor. Eklenti, özel Python addon kurulabilen bir ortam varsayıyor. Bkz. [Odoo PDF doğrulaması](pdf-odoo-verification.md).

**Bu incelemede yeniden yapılan kontroller:**

| Kontrol | Yeni sonuç | Kapsam / sınır |
| --- | --- | --- |
| JavaScript birim testleri | **35/35 geçti** | Durum, geometri, doküman yakalama yardımcıları |
| Python servis/HTTP/PDF testleri | **49 test çalıştı; 12 hata kaydı; 0 assertion başarısızlığı; 0 atlanan** | Windows, Python 3.13.5; suite başarısız. Hatalar SQLite dosyalarının temizliğinde `WinError 32`. Bir hata sınıf temizliği olduğundan 49−12 biçiminde başarı sayısı hesaplanmamalı. |
| Yerel tarayıcı akışı | **18/18 kontrol geçti** | Gerçek WebGL, fiyat, seçenekler, paylaşım, sahte başvuru/PDF, hata dönüşleri, depolama ve 2D fallback |
| Otomatik erişilebilirlik | **15 tarama, 0 axe ihlali; 4/4 SVG kontrast kontrolü** | Taranan WCAG 2 A/AA ve 2.1 AA kuralları; tüm erişilebilirlik veya kullanım kolaylığı için garanti değil |
| Ekran genişlikleri | **360 / 390 / 768 / 1440 px: yatay taşma yok** | Mobilde dikey yerleşim ve kontrol boyutu sorunları devam ediyor |
| Odoo 19.4 runtime | **Çalıştırılmadı** | Kaynak uyumluluğu incelendi; kurulum, yetki, CRM ve iki PDF yolu ayrıca test edilmeli |

Tarayıcı kontrolleri dışarıya talep göndermeyen, sahte verili ayrı yerel sunucu ve geçici veritabanıyla çalıştırıldı. Projenin beklediği Chromium derlemesi kurulu olmadığından mevcut kurulu Chromium açıkça seçildi; paket kurulmadı. Geçici sunucu kapatıldı ve test veritabanı temizlendi. Mevcut uygulama ve müşteri verileri kullanılmadı.

**Windows'ta yeniden üretilen bağlantı sorunu:** [storage.py](../addons/cs_prefab_configurator/services/storage.py), satır 50–57 ve diğer `with self.connect()` çağrıları transaction'ı sonlandırıyor, bağlantıyı açıkça kapatmıyor. Küçük izole kontrolde `with` bloğu bittikten sonra bağlantının hâlâ sorgu çalıştırdığı doğrulandı. Testlerde açık dosyalar temizliği engelliyor. Bağlantının kesin kapatılacağı bir yaşam döngüsü gerekli; mevcut kod değiştirilmedi. Python da bu davranışı [sqlite3 context manager belgesinde](https://docs.python.org/3.13/library/sqlite3.html#how-to-use-the-connection-context-manager) açıklar. Bu bulgu yerel SQLite adaptörüne ait; Odoo'nun PostgreSQL adaptörüne genellenmemeli.

**Ürün kuralları ile geometri arasında ek kontrol gerekiyor.** Sunucu `width=150`, `depth=100`, `frontOpening=sliding-4-black` birleşimini kabul edip fiyatlandırıyor. [geometry.js](../addons/cs_prefab_configurator/static/src/geometry.js), satır 15, açıklığı 60 cm'ye indiriyor; dört eşit panelin her biri 15 cm oluyor. Bu, ölçü/opsiyon aralıklarının doğrulandığını fakat üreticiye bağlı birleşim sınırlarının modellenmediğini gösteriyor. Yükseklik de satır 9'da sabit 2,80 m. Fotogerçekçi bir sunum hazırlanırken üretilebilir açıklık, profil, ışıklık ve duvar sınırları gerçek ürün verisiyle tanımlanmalı.

**Görsel değerlendirme:** Arayüz düzenli, sakin ve işlevsel. Ancak yapının gerçekliği ile premium hedef arasında belirgin mesafe var. Bu değerlendirme tasarım yargısıdır; görselden kodun insan mı yapay zekâ mı tarafından üretildiği saptanamaz.

| Gözlem | Somut neden | Öneri |
| --- | --- | --- |
| Yapı maket gibi görünüyor | [preview.js](../addons/cs_prefab_configurator/static/src/preview.js), satır 13/110: 512×512 prosedürel renk dokuları ve sabit roughness; yüzey normal/roughness ayrıntısı yok | Gerçek ölçekte tuğla, ahşap, sıva ve metal materyal setleri; derz ve yüzey ayrıntıları |
| Cam ve ışık yeterince inandırıcı değil | Aynı dosya, satır 83/153: güçlü basit ışıklar, çevre yansıması olmayan saydam renkli cam | Kontrollü gün ışığı, çevre yansımaları, cam geçirgenliği ve temas gölgeleri |
| Mimari detay zayıf | Satır 48/105/214/252/268: temel kutu geometrileri, basit doğrama/arka ev/bitkiler | Ölçüsü doğrulanmış doğrama profili, eşik, conta, birleşim, çatı kenarı ve yağmur borusu ayrıntısı; az ve tutarlı çevre detayı |
| Kamera ürünü minyatürleştiriyor | Yüksekten, çatı ağırlıklı başlangıç açısı | Mimari fotoğrafa yakın daha düşük ana açı; ölçülü teknik görünümü ayrı erişilebilir tutmak |
| Kimlik yeterince ayırt edici değil | Kırık beyaz–yeşil palet, serif vurgu, küçük üst başlıklar, sloganlar ve kartlar | Yapının ön planda olduğu, kısa metinli ve daha okunabilir bir mimari ürün arayüzü; mevcut marka kararını netleştirmek |
| Malzeme seçiminde karşılaştırma zor | 13 cephe, 11 doğrama ve 8 ışıklık aynı ağırlıkta seçenekler; CSS/SVG küçük örnekleri | Önce malzeme ailesi/doğrama türü, sonra renk/düzen; gerçek malzeme yakın görselleri |

Three.js'in mevcut motoru bu çalışmaya temel olabilir. Daha gerçekçi materyaller için [MeshStandardMaterial çevre ve yüzey haritaları](https://threejs.org/docs/pages/MeshStandardMaterial.html), cam için [MeshPhysicalMaterial geçirgenliği](https://threejs.org/docs/pages/MeshPhysicalMaterial.html) değerlendirilebilir. Bunlar uygulanmış değişiklikler değildir. Artan render maliyeti masaüstü ve mobilde ayrı ölçülmeli.

**Mobilde temel sorun taşma değil, kararın ekrandan uzak olması.** Güncel 390×844 görünümünde ilk genişlik girdisi sayfanın 994. pikselinde, fiyat 1395 ve devam düğmesi 1445. pikselinde. Kullanıcı ilk ekranda bir ölçü giremiyor. 360×800 görünümünde de girdi 962. pikselde. Kamera düğmeleri 390 px'de 28×27, 360 px'de 26×27 px; adım etiketleri 7 px. Kompakt başlangıç, seçim sırasında ulaşılabilir önizleme, daha okunabilir metinler ve rahat dokunma alanları gerekli. Kaynak: [styles.css](../addons/cs_prefab_configurator/static/src/styles.css), [adım geçişi](../addons/cs_prefab_configurator/static/src/app.js), satır 144.

**Müşteri dilinde düzeltilecek somut hata:** [catalog.json](../addons/cs_prefab_configurator/data/catalog.json), satır 68'de cephe alanının adı `Baksteen steenstrips`; aynı alan ahşap, plastik ve sıva da içeriyor. Bu durum özette ahşap seçiminin tuğla başlığı altında görünmesine yol açıyor. Kaynak kimlikleri korunup müşteri etiketi `Gevelbekleding` gibi kapsayıcı bir terimle değiştirilebilir. Ayrıca “teklifi kaydet” işleminin sekiz zorunlu iletişim alanına açılması, kişisel tasarım kaydı ile iletişim talebinin ayrımını daha açık anlatmayı gerektiriyor.

**Korunacak kararlar:** Sunucunun fiyat otoritesi olması; katalog dışı veri reddi; gizlenen iç mekân seçimlerinin ve ücretlerinin temizlenmesi; ayrı paylaşım/özel teklif/tekrar gönderim anahtarları; şirket/site kapsamı; değişmez fiyat ve belge kayıtları; 3D, teknik çizim ve PDF'nin ortak geometriye dayanması. CRM'de demonstrasyon tutarının beklenen ciroya yazılmaması da doğru bir sınır. PDF'nin sayfa düzeni, kapsam ve kalem dökümü mevcut sunumun güçlü taraflarından biri; 3D iyileştirmesinden doğrudan faydalanacak.

**Bakım ve test açığı:** [CI iş akışı](../.github/workflows/check.yml) Ubuntu/Python 3.12 üzerinde ana Python, JS ve tarayıcı akışını çalıştırıyor. Windows yok; Odoo runtime yok; ek erişilebilirlik, etkileşim ve doküman yakalama komutları ayrıca çağrılmıyor. İsteğe bağlı bağımsız PDF okuyucuları da CI'da kurulmadığı için ilgili kontroller atlanabilir. 19.4'e geçişte tam Odoo kurulumu, satışçı/yönetici yetkileri, site/şirket ayrımı, CRM ve iki PDF üretim yolu otomatik doğrulamaya bağlanmalı.

**Önerilen uygulama sırası:**

1. Sabitlenmiş, izole saas~19.4 ortamında manifest/güvenlik/website uyarlaması; yerel SQLite bağlantı sorununun giderilmesi; geçerli ürün kombinasyonlarının tanımlanması.
2. Bir referans konfigürasyonu üzerinde hedef görsel kaliteyi belirlemek: bir cephe, bir doğrama, bir ışıklık, gerçek malzeme, ışık, detay ve kamera. Önerilen yön, mimarlık stüdyosunun dijital malzeme masası: yapı net, seçimler anlaşılır, metinler kısa.
3. Kabul edilen görsel standardı katalog seçeneklerine yaymak; aynı konfigürasyonu doğru gösteren 3D/PDF sürekliliğini ve mobil performansı korumak. Teknik görünüm ile sunum görünümünü kullanım amacına göre düzenlemek.
4. Masaüstü ve mobil seçim akışını yeni görseller etrafında geliştirmek; gerçek fiyat kitabı, CRM sorumluluğu, işletme metinleri ve varsa e-posta teslimini tamamlamak.

Bu sıra bir öneridir. Kullanıcının bir sonraki yönlendirmesi gelmeden uygulamaya veya dağıtıma geçilmedi.

İnceleme araç notu: Görsel detektör bir kez çalıştırıldı; bazı ayrıştırıcı bağımlılıkları bulunmadığından regex fallback ile sınırlı kaldı. Tek `codex-grid-background` uyarısı işlevsel malzeme örneklerindeki desenlerden kaynaklanan yanlış pozitif olarak değerlendirildi; ana sayfada dekoratif ızgara arka planı yok. Tasarım hükümleri bu uyarıya dayandırılmadı. Ayrı overlay sunucusu açılmadı. Tarayıcı/ölçüm kanıtları geçici denetim klasöründe tutuldu; repo içindeki mevcut doğrulama görselleri değiştirilmedi.
