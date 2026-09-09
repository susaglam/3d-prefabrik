# CS Prefab Configurator

PrefabPartner'ın teklif akışı araştırılarak oluşturulan, kendi markamız ve kaynak kodumuzla çalışan prefab aanbouw modülü. Hollandaca arayüz, ölçüye bağlı 3D, ölçekli 2D plan, sunucuda hesaplama, kaydet/paylaş ve kalıcı teklif/PDF içerir. Hem bağımsız yerel uygulama hem Odoo eklentisi olarak hazırlanmıştır.

## Çalıştırma

Python 3.10+ yeterlidir. Tarayıcı kütüphaneleri ve fontlar projeye dahil; çalışma sırasında CDN, npm kurulumu veya üçüncü taraf konfigüratöre bağlantı gerekmez.

```bash
python3 scripts/serve.py --port 8078
```

Tarayıcı: **http://localhost:8078/prefab**. Windows'ta `start-configurator.bat` dosyasını çalıştırabilir veya `py -3 scripts/serve.py --port 8078` kullanabilirsiniz.

Yerel teklifler `.data/prefab.sqlite3` içinde kalır. E-posta gönderilmez. Paylaşım bağlantıları aynı çalışan uygulama adresine erişebilen cihazlarda açılır; `localhost` bağlantısı internet üzerinden paylaşılabilir bir yayın adresi değildir.

## Uygulanan kapsam

- Kaynağın **33 sorusu ve 94 seçeneği**, kaynak soru/cevap kimliklerine kadar eşlenmiş katalog.
- 150–750 cm genişlik, 100–340 cm derinlik; 13 cephe, 11 kozijn, 8 daklicht, rollaag ve daktrim.
- Dış aydınlatma/priz/musluk, yağmur borusu malzemesi ve konumu.
- İç mekân dalı: sıva, şap, yerden ısıtma hazırlığı, ısıtma/elektrik noktaları, lamba/anahtar/spot sayıları. İç mekân kapatıldığında gizli seçimler ve ücretler temizlenir.
- Cephe açılması, arka erişim ve 2/3/4/6 kazık tercihi.
- Yedi ana bölümde gruplanmış akış; geri dönme/düzeltme, klavye kullanımı, mobil tasarım.
- Gerçek ölçülere bağlı 3D, malzeme dokuları, kozijn panelleri, çatı ışıklığı açıklıkları, çatı gizleme, kamera açıları ve ölçekli 2D plan. WebGL yoksa 2D'ye dönüş.
- Cihazda otomatik tasarım kaydı; kişisel bilgi taşımayan süreli paylaşım.
- Sekiz zorunlu iletişim alanı, açık onay, sunucuda doğrulama, tekrarlı isteği birleştiren başvuru anahtarı.
- Sürüm ve etiketleri dondurulmuş teklif, kalıcı SQLite kayıtları ve gerçek PDF indirme.
- Aynı Python servislerini kullanan Odoo modülü: website rotası, şirket/site kapsamlı kayıtlar, CRM fırsatı, yönetim görünümü, PDF ve süre dolumu temizliği.

## Fiyatların anlamı

**Fiyat kitabı demonstrasyondur.** Referans konfigüratör fiyat göstermiyor ve ticari fiyat verisi yayınlamıyor. `pricebook.demo-v1.json` içindeki tutarlar uygulama/test için oluşturulmuş örneklerdir; PrefabPartner fiyatı, tedarikçi maliyeti veya onaylı satış bedeli değildir. Arayüz, PDF ve CRM açıklaması bunu belirtir. Örnek tutar CRM beklenen cirosuna yazılmaz.

Tüm hesaplar sunucuda yapılır. İstemciden gelen fiyat kullanılmaz; tutarlar integer cent olarak taşınır, vergi ve ara toplamlar sunucuda hesaplanır. Fiyat bileşeni eksik olduğunda hesaplama reddedilir. Gerçek şirket fiyat kitabı ve montaj/transport/kapsam anlaşmaları olmadan canlı satışa hazır olduğu iddia edilmez.

3D de üretim çizimi değildir: 2,80 m sabit yükseklik, açıklık boyutları ve mekanizma ayrıntıları şematiktir. Kazık sayısı kullanıcının ön tercihidir; mühendislik kararı değildir. Kaynaktaki **loze leiding** seçenekleri cihaz veya bağlı tesisat olarak sunulmaz.

## Doğrulama

```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
npm ci
npm test
npm run test:browser
```

Tarayıcı testi geçici veritabanı ve ayrı port açar; gerçek müşteri veya dış siteye talep göndermez. Chromium kurulumu gerekirse `npx playwright install chromium`; Linux sistem kitaplıkları eksikse Playwright'ın kurulum talimatlarını izleyin. Var olan Chromium için `CHROMIUM_PATH` kullanılabilir.

Ek etkileşim ve erişilebilirlik testleri `scripts/verify-interactions.mjs` ve `scripts/verify-accessibility.mjs` dosyalarındadır. Canlı sonuçlar ve ekran görüntüleri [doğrulama klasöründe](docs/verification/), güncel kabul durumu [teslim raporunda](docs/delivery-report.md) bulunur.

## Odoo

`addons/cs_prefab_configurator` klasörünü Odoo addons path'e ekleyin, uygulama listesini güncelleyin ve **CS Prefab Configurator** modülünü kurun. `/prefab` arayüzü ve CRM altındaki Prefab talepleri menüsü oluşur. Hedef mevcut CS projesindeki Odoo `saas-19.3` ailesidir; kullanılan sürüm ve gerçek kurulum testinin sonucu teslim raporunda ayrı belirtilir.

Kurulum, API, veri saklama ve üretim ayarları için [backend dokümanı](docs/BACKEND.md) ve [dağıtım notları](docs/deployment.md).

`python3 scripts/package-addon.py` yalnızca Odoo eklentisini, lisansları ve çalışması için gereken varlıkları `dist/cs_prefab_configurator-1.0.0.zip` içine paketler; yerel müşteri kayıtları ve araştırma ekran görüntüleri pakete girmez.

## Dosyalar

| Yol | İçerik |
| --- | --- |
| `addons/cs_prefab_configurator/static/src/` | Arayüz, durum yardımcıları, tek 2D/3D geometrisi |
| `addons/cs_prefab_configurator/services/` | Saf Python doğrulama, fiyat, kayıt ve belgeler |
| `addons/cs_prefab_configurator/data/` | Kaynak kimlikleriyle katalog ve örnek fiyat kitabı |
| `addons/cs_prefab_configurator/models/`, `controllers/` | Odoo ORM/CRM adaptörü |
| `scripts/serve.py` | Bağımsız yerel HTTP/SQLite uygulaması |
| `tests/` | Servis, HTTP, güvenlik, geometri ve durum testleri |
| `research/reference/` | Referansın halka açık tanımı, tarayıcı gezinmesi, ekran kanıtları |
| `docs/` | İnceleme, alternatifler, plan, eşleme ve teslim belgeleri |

Kütüphane güncellemesinden sonra `npm run vendor` yerel Three.js dosyalarını yeniler. Font yenilemesi isteğe bağlı `python3 scripts/fetch-fonts.py` ile yapılır. Kaynaklar ve lisanslar [THIRD_PARTY.md](THIRD_PARTY.md) içindedir.
