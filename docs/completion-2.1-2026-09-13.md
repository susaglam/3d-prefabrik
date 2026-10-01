# Configurator 2.1 — tamamlanan geliştirme kapsamı

Bu belge 13 Eylül 2026 araştırma yol haritasının **Aanbouw** uygulamasındaki son durumunu kaydeder. **`saas~19.4.2.1.0` sağlanan Odoo `saas~19.4` ortamına kurulmuştur.** Kurulum adresi [prefabpartner.codesnap.nl/prefab](https://prefabpartner.codesnap.nl/prefab); şirket/site kapsamlı yönetim ekranı Odoo içindeki **Prefab → Catalogus en levering** menüsüdür ([doğrudan aç](https://prefabpartner.codesnap.nl/odoo/action-572)).

## Ürün ve görsel deneyim

- Dört adım, masaüstü çalışma alanı, telefon düzeni, klavye erişimi ve 2D yedek görünüm korunur.
- İç cephe üst kirişi ve pencere yan dönüşleri artık seçilen iç kaplamayı taşır. İç/dış çerçevelere profiller, cam contaları, eşik, sürgü rayları ve çift taraflı kulplar eklenmiştir. Camın fiziksel iletim ve opaklığı birlikte düzeltilmiştir; iç mekân görünürlüğü korunur.
- Cephe dokuları ayrı duvar parçalarında aynı fiziksel koordinatlardan başlar. Rollaag tuğlaları ve kaplama derzleri örneklenmiş geometri kullanır. Zemin ve sıva yüzeylerine ölçülü pürüz ayrıntısı eklenmiştir.
- Dahil olan örnek cihaz dolu, hariç olan cihaz kontur, hazırlık ise ayrı bağlantı noktasıdır. Yönetici tüplü/panel radyatör ve konik/kubbe sarkıt arasında seçim yapabilir. Varlıklar yapıyla birlikte esnetilmez. Bunlar jenerik ölçülü modellerdir; üretici CAD'i veya kesin marka vaadi değildir.
- Sahneye tıklamak ilgili seçenek alanını açar. Plandaki cihazlar klavyeyle de seçilebilir. **Bekijk in 3D** ve malzeme yakın görünümü seçim alanından modele ulaşır.
- Bahçe dekoru görünüm tercihi olarak gizlenebilir; gövde, kapsam ve fiyat aynı kalır. Kamera küçük seçenek değişikliklerinde korunur.
- İki tasarım karşılaştırması yalnız konfigürasyon saklar; A/B fiyatlarını geçerli sunucu kataloğundan yeniden alır. Eski fiyatlar yeni yayınla karıştırılmaz; seçilen tasarımla devam edilebilir.

Cam uygulaması [Three.js fiziksel malzeme belgesi](https://threejs.org/docs/pages/MeshPhysicalMaterial.html) ve kullanılan yerel r180 kaynaklarıyla kontrol edildi. Görsel varlık kaynakları [THIRD_PARTY](../THIRD_PARTY.md) ve [köken dosyasında](../addons/cs_prefab_configurator/static/src/assets/materials/provenance.json) bulunur.

## Yerleşim ve yönetim

- Işıklıkların asgari ölçü zarfı ve doğrama türleri sunucuda doğrulanır. Katalog yöneticisi mevcut desteklenen zarfı daraltabilir; yazılımın desteklemediği üretim boyutu veya model türünü JSON ile açamaz.
- Tavan lambası/spot ile ışıklık; spot ile sarkıt; radyatör ile duvar lambası/priz ve duvar kenar boşluğu denetlenir. Çakışan konumlar açıklamayla temizlenir; arayüz uygun olmayan konumları sebebiyle birlikte gösterir.
- Bu zarf **gösterilen modellerin geometrik geçerliliğini** denetler. Yük, temel, yangın, tesisat veya ruhsat hesabı olduğu iddia edilmez.
- Yönetici taslak yayını, yayınlamadan 3D + fiyat + kapsam ile inceler. Önizleme mevcut Odoo oturumu, satış yöneticisi grubu ve şirket/site ACL'leri gerektirir. Taslaktan paylaşım veya teklif gönderilemez; herkese açık katalog değişmez.
- Ticari fiyat modu için kaynak/belge referansı, koşullar ve fiyat/kapsam/KDV onayları gerekir. Yetkili kullanıcının açık onayı fiyat, model, kapsam, şirket ve site içeriğine bağlanır. Ana kayıt veya kapsam bileşeni değiştiğinde onay düşer; eski değeri geri yazmak onayı geri getirmez.
- Yayınlar ve geçmiş teklifler değişmez. Görsel, fiyat modu, kapsam ve katalog revizyonu teklif anlık görüntüsünde saklanır; yeni kontrol kuralları eski belgeleri sessizce yeniden yorumlamaz.

## Teknik tamamlama

- Model değişimi yapı/malzeme/cihaz olarak ayrılır. Malzeme veya cihaz değişimi yapıyı yeniden kurmaz; yalnız ticari metadata değişimi geometri oluşturmaz.
- Tekrarlı geometri ve doku yaşam döngüleri kontrol edildi. Instancing kaynakları da serbest bırakılır. Normal sahne boşta sürekli render döngüsü çalıştırmaz; kamera olayları kare başına birleştirilir.
- Küçük sahneler için piksel oranı ve gölge çözünürlüğü azaltılır. WebGL kaybında 2D çalışır; geri geldiğinde HDR aydınlık kaynağı yeniden hazırlanır ve kullanıcının görünüm tercihi korunur. Önceki bağlantıdan geç dönen dokular iptal edilir ve kaynakları temizlenir; geç gelen sonuçlar güncel sahneyi değiştiremez.
- HTML, CSS ve bütün ES module grafiği sürümlüdür. Yerel CSP, yalnız mevcut importmap içeriğinin hash'ine izin verir; genel inline script izni açılmaz.
- Teklif için ayrı renderer kullanımı ve iki PDF yolu korunmuştur. Teknik plan cihaz konumlarını ve dahil/kontur ayrımını da aynı model/kapsamdan çizer.

## Doğrulama kayıtları

| Kontrol | Sonuç |
| --- | --- |
| Python alan modeli / HTTP / belgeler | 78/78; son importmap revizyonundan etkilenen HTTP takımı ayrıca 32/32 |
| JavaScript model / geometri / karşılaştırma / kaynak yaşam döngüsü | 59/59 |
| Ana tarayıcı akışı, paylaşım, teklif ve yerel PDF | 20/20 |
| Yeni çalışma alanı, karşılaştırma, katalog yarışları, 3D kurtarma | 11/11 |
| Etkileşim regresyonları | 6/6 |
| Otomatik erişilebilirlik | 14 tarama, 0 ihlal; SVG metin kontrastı 2/2 |
| Gerçek Odoo 19.4 HTTP / CRM / QWeb PDF / katalog / yetki testleri | 8/8, 0 hata; sağlanan veritabanında çalıştırıldı |
| Yayındaki gerçek tarayıcı kabulü | 7/7: WebGL kurtarma, yönetici girişi, katalog, Studio, taslak önizleme ve dahil panel radyatör |
| Dağıtım | 334 dosya byte/hash karşılaştırması geçti; Odoo servisi healthy |

Odoo testleri ana servis durdurulup aynı görüntü, dosyalar ve veritabanını kullanan geçici kurulum container'ında çalıştırıldı. Ana servis tekrar açıldı; geçici container ve bağlantı bilgili kurulum dosyası kaldırıldı. Veritabanı, filestore ve önceki addon yedekleri sunucuda korunur. Odoo Python/XML testlerinden sonra yalnız renderer ve HTML importmap için kaynak yaşam döngüsü düzeltmesi yapıldı; bu fark ve iki paket hash'i dağıtım kaydında açıkça belirtilir.

- [Renderer, seçici güncelleme ve bellek kontrolü](verification/2.1/renderer.json)
- [Ana tarayıcı akışı](verification/browser-results.json) ve [erişilebilirlik](verification/accessibility-results.json)
- [Çalışma alanı browser kontrolleri](verification/workspace/results.json)
- [Hedef kurulum ve gerçek Odoo testleri](verification/2.1/deployment.json)
- [Gerçek Odoo sürümü ve beş kurulu CS modülü](verification/2.1/runtime.json)
- [Hedef browser kontrolü](verification/2.1/target-smoke.json)
- [Paket bütünlük kontrolü](verification/2.1/package-check.json)

Canlı yönetici kontrolünde yalnız bu amaçla oluşturulan etiketli taslağın radyatör modeli `heating-panel`, ürün durumu dahil olarak değiştirildi. Gerçek taslak API'si ve sahne bu modeli dolu gösterdi; herkese açık yayının kapsamı ve revizyonu aynı kaldı. Canlı kontrolde müşteri teklifi/paylaşımı gönderilmedi. Test taslağı 10 silinip yokluğu tekrar okuma ile doğrulandı; başka kayıt silinmedi. Yardımcı betikteki XML-RPC `[id]` dönüşünü normalleştirme düzeltmesi ve ayrı temizlik sonucu kanıt dosyasında kayıtlıdır.

Yayımlı demo katalog: **9**, revizyon **`odoo-1-1-9-dafff15403727f4e92f9`**, 37 kapsam kuralı; görsel varlık revizyonu **`2026-09-13.3`**. Önceki yayın ve kullanıcı taslakları korunmuştur. Coolify için son beş modüllü paketin SHA-256 değeri `171959fecdac9bc76acf0501693438edcec70de9b5d6dfa22a6e179422a4fd18`.

Taşınabilir addon paketi `dist/cs_prefab_configurator-saas~19.4.2.1.0.zip` olarak üretilmiştir; SHA-256 `47e6f76b1d72e3861bb9ec8833288bfe64bd87de7116c769e3c172924a23dbdd`. Coolify başlangıcı için gerekli `addons/requirements.txt`, modül içindeki requirements dosyasını dahil eder; bu sürüm ek Python paketi gerektirmez.

Renderer ölçümleri Windows geliştirme ortamında headless Chromium/SwiftShader üzerinden alınmıştır. CPU komut gönderim süresi fiziksel telefon FPS değeri olarak sunulmaz. Responsive emülasyon, elde gerçek telefonla yapılan kabulün yerine geçmez.

## İşletmeden gelecek veriler

Onaylı ticari fiyat listesi, tedarikçi ürün modelleri ve mühendislik ölçü profilleri henüz sağlanmadı. Bunların giriş/önizleme/onay mekanizması hazırdır; sağlanan hedef katalog **demo** olarak tutulur. Uygulama bu değerleri referans siteden veya varsayımdan üretmez.

Woonserre gibi ayrı ürün aileleri ve serbest sürükleme, ilk araştırmada sonraki ürün kararı olarak belirtilmişti; mevcut Aanbouw seçilebilir konum sistemi bunlar tamamlanmış gibi sunulmaz. Bu belge, ilk araştırmanın değişmez tarihî kaydını değil, uygulanmış yazılımın sınırlarını açıklar.
