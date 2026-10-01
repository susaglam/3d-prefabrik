# CS Prefab Configurator

Hollandaca prefab aanbouw konfigüratörü: dört adımlı seçim akışı, ölçüye bağlı 3D ve 2D, sunucuda fiyat/kapsam çözümleme, paylaşım, değişmez başvuru/PDF ve Odoo müşteri–CRM–satış teklifi–proje akışı.

**Güncel hedef Odoo `saas~19.4`, yayındaki sürüm `saas~19.4.2.4.0`.** Uygulama: [prefabpartner.codesnap.nl/prefab](https://prefabpartner.codesnap.nl/prefab). [2.4 raporu](docs/completion-2.4-2026-09-13.md) ölçü sınırları, kararlı mobil seçimler, kamera ve [düzenlenebilir Odoo görünümünü](docs/appearance-2.4.md) açıklar. [Dağıtım kanıtı](docs/verification/2.4/deployment.json) 364 dosya eşleşmesini ve korunan kayıtları; [canlı kabul](docs/verification/2.4/live/usability.json) 10/10 kontrolü kaydeder. Önceki [2.3 yerleşim çalışması](docs/completion-2.3-2026-09-13.md), [2.2 native Odoo iş akışı](docs/native-odoo-workflow-2.2.md) ve [araştırma/yol haritası](docs/development-roadmap-2026-09-13.md) kendi tarihlerinin kanıtıdır.

## Yerel çalıştırma

Python 3.10+ yeterlidir. Tarayıcı kütüphaneleri, fontlar ve görsel varlıklar repodadır; çalışma sırasında CDN veya referans konfigüratöre bağlantı gerekmez.

```bash
python3 scripts/serve.py --port 8078
```

Tarayıcı: **http://localhost:8078/prefab**. Windows'ta `start-configurator.bat` veya `py -3 scripts/serve.py --port 8078` kullanılabilir. Yerel teklifler `.data/prefab.sqlite3` içinde kalır. E-posta gönderilmez. `localhost` paylaşım bağlantısı internet yayını değildir.

## Uygulanan kapsam

- Dört adım: yapı ve dış görünüm; iç mekân; saha ve teslim kapsamı; özet ve teklif.
- 150–750 cm genişlik, 100–340 cm derinlik; 13 cephe, 11 mevcut doğrama tipi/renk birleşimi ve 11 çatı ışıklığı seçeneği. Dar doğramalar için geçici geometrik alt sınırlar uygulanır.
- Ayrı doğrama malzemesi, yeşil çatı, saçak ve saçak spotları, uygun ışıklık için gölgelik, sıva sonrası boya. Rollaag açılıp kapatılabilir; kapatılması önceki bitiş seçimini silmez.
- İç/dış aydınlatma, priz ve musluk konumları; tavan lambaları, 15 yuvalı spot ızgarası, duvar lambaları ve priz konumları, aydınlatma kontrol tercihleri. Çatı açıklığı ve radyatör hazırlığıyla çakışan konumlar sunucuda temizlenir.
- Yerden ısıtma için zemin hazırlığı ve radyatör için boş tesisat hazırlığı; ürün, montaj ve bağlantı kapsamı ayrı tutulur.
- Cephe açılması, arka erişim, kazık sayısı ve yağmur suyu tahliyesi tercihleri.
- Dış, iç, tavan ve kesit görünümleri; yerel malzeme dokuları ve ışık ortamı; örnek aygıtları gizleme. WebGL yoksa ortak geometriden 2D çizimler.
- Sahneden seçenek seçimi, malzeme yakın görünümü, kapatılabilir bahçe dekoru ve güncel fiyat/kapsamla iki tasarım karşılaştırması.
- Yönetici için yayınlamadan 3D taslak önizlemesi; geometrik montaj kuralları, cihaz modeli seçimi ve kaynağı belirtilmiş ticari fiyat onayı.
- Masaüstü ve mobilde **Opnieuw beginnen**; geç gelen yanıtları da engelleyen tam sıfırlama, belirgin malzeme başlıkları ve seçili durum, ayrı eğim/mahya ve panel sayılı çatı ikonları.
- Cihazda taslak, kişisel bilgi içermeyen süreli paylaşım; onay ve iletişim doğrulaması, tekrarlı istekte tek kayıt.
- Katalog sürümü, kapsam, etiket, fiyat ve mevcut tasarım görselleri dondurulmuş başvuru ve A4 PDF; Odoo'da okunur seçim, fiyat ve görsel satırları.
- Başvuruda müşteri, CRM fırsatı ve kalemleri dolu taslak satış teklifi; Odoo teklif onayında proje ve CRM sorumlusuna takip aktivitesi. CRM aşaması korunur.
- Yönetici için EUR fiyatlar, seçenek adları/açıklamaları, varsayılanlar ve ölçü kurallarını düzenleyen Odoo katalog editörü.

Araştırmadaki katman/koşul sayıları müşteri soru sayısı değildir. Kaynak kanıtları [araştırma klasörlerinde](research/); ticari fiyatlar bu kaynaklardan aktarılmamıştır.

## Fiyat, teslim ve görselin anlamı

**Varsayılan fiyatlar demonstrasyondur.** Repodaki tutarlar uygulama/test örnekleridir; PrefabPartner fiyatı, tedarikçi maliyeti veya onaylı satış bedeli değildir. Yönetici kendi tarifelerini, kaynağını ve koşullarını girip ticari onay akışını tamamladığında onaylı tarife modu yayımlanabilir. Başvuru ve belgeler kaydedilmiş fiyat durumunu korur. İlk demonstrasyon başvurusu CRM beklenen cirosunu doldurmaz; Odoo kullanıcısının sonraki satış onayında standart Odoo gelir güncellemesi çalışabilir.

Müşteri yalnız seçim gönderir. Tek bir katalog yayını doğrulama, fiyat ve teslim kapsamını belirler. Yönetici tutarları KDV hariç EUR olarak düzenler; servisler tutarları integer eurocent olarak saklar. Hazırlık, ürün, montaj ve bağlantı ayrı ayrı `hariç`, `casco bedeline dahil` veya `ayrıca fiyatlı` olabilir. Dahil kalemler satış teklifinde sıfır ek ücretli satır, hariç bileşenler açıklama olarak görünür.

Musluk, radyatör, aydınlatma aygıtı, priz ve anahtar ürünleri varsayılan olarak hariçtir; hazırlık ayrıca ücretlendirilebilir. Örnek aygıt göstermek ürünü teslimata eklemez. Yönetici dahil ürün seçse de mevcut model kütüphanesi temsilîdir; marka/model taahhüdü değildir. Görseller üretim çizimi değildir; ölçü ve açıklık alt sınırları üretici onayı yerine geçmez.

## Odoo ve yönetim

`addons` kökünü Odoo addons path'e ekleyip `cs_prefab_configurator` modülünü kurun. Doğrudan bağımlılıklar `website`, `crm`, `sale_management`, `sale_crm` ve `sale_project`'tir. Odoo **Prefab → Aanvragen** gönderilen başvuruyu ve bağlı müşteri, CRM, satış teklifi ve projeyi; satış yöneticilerine açık **Prefab → Catalogus en levering** sürümlü katalog yönetimini sunar. Yerel SQLite uygulaması bu Odoo belgelerini oluşturmaz.

Taslakta **Prijzen, keuzes en maten bewerken** editörünü açın; temel fiyatları, **Leveringsprijzen**, seçenekleri ve ölçüleri düzenleyip **Wijzigingen toepassen** ile taslağa uygulayın. Yayındaki katalogda **Bewerken via nieuw concept** kullanılır. Ardından taslak kontrolü, 3D önizleme ve gerekiyorsa ticari onay tamamlanarak **Publiceren** seçilir. Eşzamanlı değişmiş kaynak üzerine yazılmaz; yayımlanmış kayıt ve eski başvurular korunur.

Müşteri kartı ve taslak satış teklifi standart Odoo ekranlarında düzenlenir; gönderilen başvuru geriye dönük değişmez. Mevcut dolu satış teklifi yeniden yazılmaz; aynı CRM fırsatındaki boş taslak kullanılabilir. Gönderim ve satış onayı Odoo kullanıcısının işlemidir. Onay, standart `sale_project` üzerinden müşteri ve siparişe bağlı proje oluşturur; CRM aşamasına dokunmadan sorumluya takip aktivitesi açar. Tekrar onay proje veya aktiviteyi çoğaltmaz.

Satış kalemleri m², adet ve sabit iş için **Post** birimlerini kullanır. 501 × 299 cm'nin 14,9799 m² olarak korunması için ortak Odoo **Product Unit** hassasiyeti en az dört basamağa çıkarılır; daha yüksek mevcut ayar korunur. Bu, diğer Odoo miktar alanlarının gösterimini de etkiler. Şirketin uygun satış vergisi kullanılır; eksik vergi/kurulum ayarında başvuru korunur ve satış teklifini tamamlama uyarısı gösterilir.

Sağlanan Coolify görüntüsü yalnız `/mnt/extra-addons/requirements.txt` dosyasını okur. Repodaki `addons/requirements.txt`, modülün `requirements.txt` dosyasını `-r` ile dahil eder; otomatik modül taraması yoktur. Bu addon şu anda ek pip paketi istemez.

Kurulum ve geri dönüş: [dağıtım notları](docs/deployment.md). API, kapsam ve kayıt ayrıntıları: [backend dokümanı](docs/BACKEND.md).

## Doğrulama ve paketleme

```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
npm ci
npm test
npm run test:browser
npm run test:interactions
npm run test:accessibility
npm run test:documents
npm run test:embed
python3 scripts/preview_website.py   # ikinci sitenin sayfalarini statik HTML'e cikarir
npm run test:website                 # 1440 ve 390 px'te Chromium + axe + agirlik + ekran goruntusu
```

2.4 için **109 Python**, **86 JavaScript**, ayrı saas~19.4 kopyasında **26 Odoo**, canlı hedefte **10 tarayıcı**, ayrı yerel veritabanında **5 belge** ve **5 sıfırlama** kontrolü geçti. Native Odoo görünüm formu ve gerçek website teması da özel kopyada doğrulandı. [Kanıt dizini](docs/verification/2.4/README.md). Mevcut katalog ve iş kayıtları korundu; canlı tarayıcı kontrolleri gerçek teklif/paylaşım yazmaz. Arayüz kabulü: `node scripts/verify-usability.mjs`. Chromium gerekiyorsa `npx playwright install chromium`; mevcut tarayıcı için `CHROMIUM_PATH` kullanılabilir. Python belge doğrulayıcılarının bağımlılıkları `requirements-dev.txt` içindedir.

`python3 scripts/package-addon.py` addon arşivi ve SHA-256 dosyasını `dist/` altında oluşturur. Yerel müşteri kayıtları ve araştırma kanıtları pakete girmez. Modül arşivi tek başına addons kökündeki requirements başlangıç dosyasını taşımaz; Coolify yayınına bu dosya ayrıca dahil edilmelidir.

## Dosyalar

| Yol | İçerik |
| --- | --- |
| `addons/cs_prefab_configurator/static/src/` | Dört adımlı arayüz, durum, 2D/3D geometri ve aygıtlar |
| `addons/cs_prefab_configurator/services/` | Python doğrulama, yayın bağlamı, kapsam/fiyat, kayıt ve belge servisleri |
| `addons/cs_prefab_configurator/data/` | Güncel ve legacy katalog, demo fiyat kitabı |
| `addons/cs_prefab_configurator/models/`, `controllers/` | Odoo katalog editörü, müşteri/CRM/satış/proje bağlantıları ve HTTP adaptörü |
| `addons/cs_prefab_website/` | prefabpartner.nl'in ikinci website kaydı: sayfalar, proje galerisi, blog, formlar, marka ve URL haritası ([modül README](addons/cs_prefab_website/README.md)) |
| `scripts/preview_website.py`, `scripts/verify-website.mjs` | O sayfaların Odoo'suz önizlemesi ve tarayıcı kapısı; kanıt `docs/verification/website/` |
| `docs/website/` | Canlı siteden çıkarılan içerik envanteri, tasarım ölçümü, hedef araştırması ve kusur raporu |
| `addons/requirements.txt` | Coolify için kök requirements giriş noktası |
| `scripts/serve.py` | Yerel HTTP/SQLite uygulaması |
| `tests/` | Yerel servis, HTTP, belge, geometri ve durum testleri |
| `addons/cs_prefab_configurator/tests/` | Gerçek Odoo/PostgreSQL HTTP ve TransactionCase testleri |
| `research/`, `docs/` | Kaynak araştırması, plan ve tarihli doğrulama kanıtları |

Kütüphane yenilemesi `npm run vendor`, font yenilemesi `python3 scripts/fetch-fonts.py` ile yapılır. Kaynaklar ve lisanslar [THIRD_PARTY.md](THIRD_PARTY.md) içindedir.
