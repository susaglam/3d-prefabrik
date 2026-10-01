# Configurator vormgeving — 2.4

Odoo'da **Prefab → Vormgeving → Nieuw** ile website seçilir. Her website için tek ayar kaydı vardır; kaydetme sonrasında konfigüratör yeniden açıldığında uygulanır.

- **Prefab Partner:** mevcut marka renklerini ve yerel yazı tiplerini korur.
- **Odoo website-thema:** etkin Odoo website temasının gerçek form yüzeyi, metin, başlık, birincil düğme renkleri ve yazı tiplerini kullanır. Tema Odoo website editöründen değiştirilir.
- **Eigen kleuren en lettertypen:** dokuz renk, metin/başlık yazı tipi ve 14–20 px temel yazı boyutu modülün normal Odoo formundan düzenlenir. Renkler `#294e40` biçimindedir. Metin/form ve düğme metni/düğme zemini en az 4,5:1 kontrast gerektirir; okunaksız özel kombinasyonlar kaydedilmez.

Yazı tipi seçenekleri paketli DM Sans/DM Serif Display ve sistem fontlarıdır. Mevcut Odoo temasının **Inter** ve **Inter Tight** yazı tipleri de değişken kalınlık, normal/italik ve Türkçe karakterleri kapsayan Latin/Latin-ext alt kümeleriyle yerel paketlenmiştir. Odoo tema modunda bu dosyalar ve sitenin aynı kaynaktan sunduğu diğer webfont tanımları aktarılır. Harici font servislerine tarayıcı bağlantısı kurulmaz. Gelecekte başka bir uzak font seçilirse onun da yerel olarak sunulması gerekir; bulunamayan fontta temanın kendi CSS fallback ailesi kullanılır.

**Ontwerpen vergelijken** (`compare_enabled`) aynı kayıttaki bir yönetici özellik bayrağıdır ve varsayılan olarak kapalıdır. Açıldığında konfigüratörün 4. adımında iki tasarımı (A/B) yan yana fiyatlayan "Twee ontwerpen vergelijken" paneli gösterilir; kapalıyken panel hiç render edilmez. Bayrak `GET /prefab/api/appearance` yanıtında `compareEnabled` olarak döner; `theme.js` bunu `applyAppearance()` sonucunun `features.compare` alanında ve `getFeatures()` ile sunar. Uç nokta yoksa, zaman aşımına uğrarsa veya eski bir API `true` dışında bir değer döndürürse bayrak kapalı kalır. Ziyaretçinin kaydettiği A/B tasarımları cihazında (`localStorage`) kalır; bayrağı kapatmak bu verileri silmez, sadece paneli gizler.

Görünüm kaydı fiyat kataloğundan ayrıdır. Görünüm değişikliği yeni katalog yayını gerektirmez, mevcut fiyatları, seçimleri veya dondurulmuş teklifleri değiştirmez. Düzenleme satış yöneticileriyle ve izin verilen şirketlerle sınırlıdır; public API yalnız geçerli website'ın görünüm değerlerini döndürür.

## Teknik sözleşme

`GET /prefab/api/appearance` UI ayarını `no-store` döndürür. `theme.js` içindeki `applyAppearance()` form render edilmeden önce bir kez çağrılır. Bağımsız geliştirme sunucusunda ayar uç noktası yoksa marka biçimi korunur.

Odoo modunda `/prefab/theme`, `web.assets_frontend` paketinin yalnız CSS kısmıyla bir QWeb ölçüm belgesi üretir. Ana sayfadaki gizli, aynı kaynaklı ve script çalıştıramayan iframe'den hesaplanan renkler/fontlar alınır; sadece CSS değişkenleri ve kullanılan yerel `@font-face` tanımları ana belgeye aktarılır. Bootstrap kuralları konfigüratör sayfasına yüklenmez. Toplam bekleme 2,5 saniyeyle sınırlıdır; tema alınamazsa marka biçimi korunur.

Aktarım token'ları `--ink`, `--text`, `--muted`, `--paper`, `--page`, `--stone`, `--soft`, `--line`, `--green`, `--accent`, `--green-soft`, `--danger`, `--error`, `--focus`, `--on-action`, `--action-ink`, `--font`, `--font-heading`, `--font-button` ve `--font-size` değerleridir. Açık renkli tema eylem renginde metin için `--action-ink`, düğme zemini için `--green` ve düğme metni için `--on-action` kullanılır.

Native CSS-only asset çağrısı saas~19.4 hedef kaynak kodundaki `website.iframefallback` örneğiyle doğrulandı. Ortak Odoo matrisi bu görevde değiştirilmedi. Dağıtım ve tarayıcı kabul sonucu ana 2.4 tamamlama raporuna yazılır.

## Voorbeelden in het beeld — örnek içerik anahtarları (2.9.6)

Aynı kayıt, renk ve yazı tipinden **ayrı** ikinci bir konuyu daha taşır: 3D sahnede "müşteri sonucu hayal edebilsin
diye" duran, satılmayan her şey. Beş aile, beş `Selection` alanı:

| Alan | Etiket | Sahnede ne | Bezoeker kontrolü |
|---|---|---|---|
| `scene_fixtures` | Voorbeeldapparaten | koelkast/wasmachine/radiator konturları | "Voorbeeldapparaten tonen" |
| `scene_garden` | Tuinaankleding | çim, schutting, plantenbak, tuinset | "Tuinaankleding tonen" |
| `scene_neighbours` | Buurhuizen | soldaki/sağdaki komşu evler | "Buren tonen" (Woning en tuin) |
| `scene_interior` | Inrichting | woonkamer/slaapkamer/jeugdkamer mobilyası | "Inrichting" çipleri |
| `scene_house_openings` | Voorbeeldramen op de straatgevel | evin sokak cephesindeki örnek ramen + voordeur | "Voorbeeldramen op de straatgevel tonen" (Woning en tuin) |

Üç durum, boolean değil, çünkü tek anahtarın iki soruya cevap vermesi gerekiyor:

- **Tonen** — sahnede; bezoeker kendi kontrolüyle kapatabilir.
- **Standaard uit** — kontrol duruyor ama beeld o ekstra olmadan başlıyor.
- **Uitgeschakeld** — hiç çizilmiyor **ve kontrol kayboluyor**; hiçbir şey yapmayan bir düğme bırakılmıyor.

Değer `GET /prefab/api/appearance` yanıtında `sceneContent` anahtarı altında döner
(`{"fixtures":"on","garden":"on","neighbours":"on","interior":"on","houseOpenings":"on"}`); `theme.js`
`applyAppearance()` sonucunun `sceneContent` alanında ve `getSceneContent()` ile sunar. **Varsayılan yön
`compareEnabled`'ın tersidir:** uç nokta yoksa, zaman aşımına uğrarsa veya eski bir API anlaşılmayan bir değer
döndürürse hepsi `on` kalır — erişilemeyen bir uç nokta yayındaki bir sahneyi boşaltamaz. Odoo'suz tek sunucu
(`scripts/serve.py`) aynı politikayı `PREFAB_SCENE='{"scene_garden":"hidden"}'` ile taklit eder.

Bezoeker'in kaydettiği seçim **silinmez**: `environment` (localStorage) ziyaretçinin kendi hâli olarak kalır,
politika yalnız sahneye giderken uygulanır. `Uitgeschakeld` ziyaretçiyi geçersiz kılar; yönetici `Tonen`'e
döndüğünde eski seçim olduğu gibi geri gelir. `Standaard uit` yalnız ziyaretçinin hiç dokunmadığı anahtarı
doldurur. Hiçbir anahtar fiyatı, leveringsomvang'ı veya kaydedilmiş `config`'i değiştirmez; hiçbiri
`buildGeometry`'de yoktur. Kayıttaki `scene_note` alanı ne gösterilip ne gösterilmeyeceğini geri okur.

Kanıt: [2.9 kabul raporu](verification/2.9/README.md#296--bunlar-adminden-gostergosterme-diye-kapatilabilse-aslinda-tum-ek-olarak-ekledigimiz-seyler-icin-gecerli)
ve [illustrative-switches.json](verification/2.9/illustrative-switches.json) (10 koşu, gerçek GPU).

## Omgeving in de voorstelbeelden — teklif gorselleri icin tek anahtar (2.9.7)

Aynı kayıttaki üçüncü konu, ve öncekilerden farkı şu: bunun bir **bezoeker kontrolü yok**. Sadece teklifin üç
ruimtelijke beeldini ilgilendiriyor — admindeki aanvraag kartında görünen ve PDF'e basılan aynı JPEG'ler
(`document_capture.js` bunları bir kez yakalar, `report/quote_report.xml` ile `services/documents.py` ikisi de o
tek demeti okur). Konfigüratörde ziyaretçinin baktığı canlı beeld bundan hiç etkilenmez.

| Alan | Etiket | Varsayılan | Yükte |
|---|---|---|---|
| `document_surroundings` | Omgeving in de voorstelbeelden | `False` (kapalı) | `documentSurroundings` |

**Kapalıyken** voorstelbeelden sadece aanbouw'u ve üzerinde durduğu terrası gösterir; arkasında
`document_capture.js`'in plattegrond ile gevelaanzichten'e zaten bastığı kağıt rengi (`#fbfaf6`) durur, altında
bir ton koyu bir studio zemini (gölge ve ufuk için, fog ile kağıda karışır). **Product'a monte edilen her şey
kalır:** wandlampen, stopcontacten, buitenkraan, spots, radiator. Çıkanlar: bestaande woning, buurhuizen, gras,
schutting, plantenbakken, tuinset, voorbeeldinrichting — ve doorbraak'ın arkasındaki odanın *kabuğu* (plafond ile
iki yan duvar; zemini ve arka duvarı kalır, yoksa dolu genişlikteki doorbraak bir delik gibi okunuyor).

**Açıkken** eski beeld geri gelir: aanbouw örnek bahçesinde durur.

Varsayılan yön `sceneContent`'in **tersi**, `compareEnabled` ile aynı: 404, timeout, alanı bilmeyen eski bir Odoo
ve Odoo'suz tek sunucu — hepsi ürünü tek başına basar. Müşterinin isteği buydu ("varsayilan gozukmesin").
`theme.js` değeri `getFeatures().documentSurroundings` ile sunar; `scripts/serve.py` aynı anahtarı
`PREFAB_DOCUMENT_SURROUNDINGS=1` ile taklit eder. Kayıttaki `document_note` alanı bir sonraki teklifin hangi
beeldi alacağını geri okur.

**Zaten kaydedilmiş aanvraag'lar değişmez.** Beelden gönderim anında dondurulur ve `snapshot_json` içinde saklanır;
hiçbir zaman yeniden çizilmez. Anahtar yalnız bundan sonraki yakalamaları etkiler, yani eski bir teklif müşterinin
aldığı hâliyle kalır.

Kanıt: [proposal-image-shares.json](verification/proposal-images/proposal-image-shares.json) (7 ölçü, gerçek
kamera başına 48 × 32 ışın) ve yanındaki gerçek yakalanmış JPEG'ler. Ölçüm: omgeving kapalıyken her beelde
omgeving payı **%0,00**; 620 × 320 tuinperspectief'te aanbouw **%49,1 → %54,3**, woning + gras **%27,3 → %0**.
