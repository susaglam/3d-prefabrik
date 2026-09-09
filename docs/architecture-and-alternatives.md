# Prefab teklif modülü: mevcut tecrübe ve alternatifler

İnceleme tarihi: 9 Eylül 2026. Bu belge mevcut `CS_Product_Configurator` kaynaklarını ve dört Hollandalı alternatifin herkese açık sayfalarını karşılaştırır. Prefabpartner'ın ayrıntılı alan/akış envanteri ayrı araştırmanın konusudur. Buradaki mimari maddeler uygulama kararlarını besler; tek başına tamamlanmış özellik veya test sonucu beyanı değildir.

## Karar

Mevcut pencere projesindeki **katalog → doğrulama → sunucuda fiyat → sabit teklif kaydı → CRM** zincirini koruyalım. Prefab için ayrı bir ürün alanı ve geometri modeli oluşturalım. Bir eklentinin pencere kataloglarına, açılım kodlarına veya tedarikçi fiyatlarına bağlanması bu yeni ürünü gereksiz yere kırılgan yapar.

Bu çalışma için uygun yapı, Odoo'ya kurulabilir `cs_prefab_configurator` eklentisi ile aynı seçim ve hesaplama sözleşmesini kullanan yerel çalıştırıcıdır. Odoo bulunmayan geliştirme ortamında akış ve hesaplama böylece bağımsız doğrulanabilir. Bağımsız saf servisler kuralları taşır; Odoo adaptörü veritabanı, şirket, vergi, CRM ve raporlama sorumluluklarını üstlenir. Görsel arayüzü tamamlamak için canlı Odoo kurulumu beklemek gerekmez.

## Mevcut projede gerçekten bulunanlar

İncelenen kök: `/mnt/e/Projeler/CS_Product_Configurator`. Kontrol anındaki Git HEAD: `37f9892`; manifest: `saas~19.3.1.18.2`. `.claude`, `.agents` ve `.codex` klasörleri boştu; `.remember/now.md` içeriksiz, `.remember/recent.md` ise kullanıcıya yardım/tur düzeni hakkında kısa bir eski not içeriyordu. Güncel kararlar kaynak ve `docs/` üzerinden çapraz kontrol edildi.

| Konu | Mevcut kaynak ve davranış | Prefab uyarlaması |
|---|---|---|
| Uygulama sınırı | `addons/cs_window_configurator/__manifest__.py`: Website, Website Sale, Sales, CRM, Sale CRM ve Account bağımlılıkları; OWL frontend asset paketi. | Prefab eklentisinin bağımlılıklarını gerçek teklif ihtiyacıyla sınırlamak; doğrudan ödeme gerekmeden CRM teklif talebi çalışabilmeli. |
| Mount | `static/src/configurator/register.js`: Odoo `public_components` kaydına `Configurator` ekleniyor. | Tek web sayfasına takılabilen bağımsız configurator; sayfa kabuğundan ayrılmış durum, seçenekler ve önizleme. |
| Katalog | `models/config_models.py`: ürün tipleri, seçenek grupları, değerler, boyut sınırları, fiyat kitapları ve fiyat bileşenleri. | Kanonik `product`, `width_mm`, `depth_mm`, `height_mm` ve sabit seçenek kodları. İç/dış ölçü ve duvar yüksekliğinin anlamı açık olmalı. |
| Doğrulama | `models/configuration_validator.py`: merkezi `check_configuration()`/`validate_configuration()`. Bilinmeyen veya başka tipe ait seçenek, tekrar eden değer, eksik zorunlu grup, hatalı sayı, sınır/adım uyumsuzluğu reddediliyor. | Aynı normalleştirilmiş yapı fiyat, kayıt, yükleme ve teklif yollarının tamamından geçmeli. Sadece input `min/max` yeterli değildir. |
| Kurallar | `_check_configuration_dependencies()` ürün alanında bir genişletme noktası; sonucu `errors`, `disabled`, `hidden`, `disabled_reasons`, `warnings` taşıyor. | Çatı ürünü ile temel işini, cephe türü ile renkleri, yan duvar ile açıklıkları, pui genişliği ile yapı genişliğini burada ilişkilendirmek. UI gerekçeyi müşteriye göstermeli. |
| Fiyat matematiği | `services/pricing.py`: Odoo bağımsız `Decimal` hesabı; taban, sabit, m, m², çevre ve yüzdelik yöntemler; kuruşa `ROUND_HALF_UP`. | Prefab kalemleri taban, döşeme alanı, yeni dış duvar alanı, çatı alanı, çevre, açıklık adedi ve sabit iş olarak ayrı ayrı hesaplanmalı. Tek genel m² çarpanı bütün kalemleri temsil etmez. |
| Tek fiyat kitabı | `models/pricing_service.py:resolve_current()`: şirket/tarih kapsamında geçerli en yüksek sürüm seçiliyor; farklı kitaplar birlikte toplanmıyor. | Hesap sonucunda fiyat kitabının sürümünü ve geçerlilik tarihini taşımak; kendi onaylı maliyet ve satış fiyatlarını yönetmek. |
| Eksik fiyat | `_collect_components()` taban veya ücretli seçenek fiyatı yoksa hata veriyor. `included` seçeneğe ücret bağlanması da hata. | Bilinmeyen seçenek sessizce €0 olamaz. `inbegrepen`, `meerprijs`, `op aanvraag` ayrı ticari durumlar olmalı. |
| Satış onayı | `compute_price()` fiyat kitabı satış politikası, güncel kalibrasyon ve kaynak onayını kontrol ediyor. `price_available` ile `checkout_allowed` ayrı açık alanlar. | Ölçülmüş rakip rakamları kendi bağlayıcı satış fiyatı diye sunmamak. Açıkça belirlenmiş gösterim/örnek fiyat kitabı ile gerçek satış onayını ayırmak. |
| Vergi | `pricing_service.py:_sale_taxes()` ve `taxes.compute_all()` Odoo şirketinin satış vergilerini son aşamada uyguluyor. | Yerel çalıştırıcının açık vergi ayarı olabilir; Odoo entegrasyonunda native tax engine kullanılmalı. Dışarıda gösterilen fiyat ile CRM toplamı eşleşmeli. |
| İstek yarışı | `static/src/configurator/configurator.js`: 250 ms debounce yanında `_reqId` ve `_configRevision` kontrolü; seçim değişince eski yanıt hemen geçersizleşiyor. | Hızlı ölçü/renk değişiminde geç gelen eski fiyat güncel seçimin fiyatı gibi görünmemeli. Teklif isteği tıklama anındaki yapılandırmayı dondurmalı. |
| Kaydetme | `controllers/main.py:_save_config()` seçim, etiket, teknik özellik, çizim metadata, fiyat, vergi, kaynak ve kitap sürümünü birlikte kaydediyor. Değişen yapı yeni token/revizyon yaratıyor. | Paylaşım/teklif belgesi o günkü ürün adı, renk etiketi ve toplamı göstermeli; sonradan katalog değiştiğinde eski belge değişmemeli. |
| Talep kimliği | `controllers/main.py:quote()` ayrı `submission_key` + içeriğin SHA-256 parmak izini kullanıyor; aynı anahtar ve farklı içerik çakışma. | Çift tıklama veya ağ tekrarı tek talep yaratmalı. Başkasının paylaştığı tasarımı kullanan yeni müşteri ayrı talep olmalı. |
| Paylaşma ve düzenleme | `models/quote_project.py`: public token, hashlenmiş edit token, revision, satır kilidi ve immutable submitted proje. | İlk sürüm yalnız paylaşılabilir seçim taşıyabilir. Sunucuda ortak taslak varsa paylaşım linki düzenleme yetkisi vermemeli; düzenleme anahtarı ayrı tutulmalı. |
| CRM ve belge | `crm_lead.py`, `main.py:quote()`, `reports/quote_report.xml`, `reports/project_quote_report.xml`: frozen configuration ile lead; onaylı fiyat varsa draft sale order. | Müşteri, proje adresi, yapılandırma, kalemler, kapsam dışı işler, inceleme gerektiren cevaplar ve izin kaydı birlikte temsil edilmeli. |

Eski hafıza kaydındaki eksik fiyat kitapları, paylaşım token'ından talep birleştirme ve değişen eski PDF etiketleri gibi risklerin önemli bölümü güncel kaynakta giderilmiş durumda. Yeni uygulama eski davranışı yeniden üretmemeli. Bu kod incelemesi mevcut Odoo sunucusunun canlı sağlık kontrolü değildir.

## Önizlemede taşınacak tecrübe

Mevcut `static/src/configurator/preview_model.js:buildPreviewModel()` seçimleri tek görsel modele çeviriyor. `static/three/three_preview.js` bu modelden 3D üretiyor; SVG/teknik çizim yardımcıları ayrıca bulunuyor. Prefab için aynı sınır uygulanmalı:

```text
Katalog + normalleştirilmiş seçim
              │
       buildPrefabModel()
       ┌──────┴───────┐
       3D görünüm    2D plan/cephe
              │
      Teklif görseli ve ölçüler
```

`buildPrefabModel()` ürünün eni/derinliği/yüksekliği, duvar kalınlığı, açıklık tipi ve adedi, cephe kaplaması, doğrama rengi, çatı ışıklığı ve görünüm yönünü açık alanlarla taşımalı. Dünya eksenleri ve cephe adları başta tanımlanmalı. Duvar, kapı ve ışıklık yerleşimi kullanıcıya gösterilen boyutlardan türemeli. Miktar veya alan fiyatı ile çizimdeki modelin boyutu aynı kanonik seçime dayanmalı.

9 Eylül devamında önemli bir düzeltme yapılmış: `previewOpenDirectionAxis()` artık çevrilmiş `boven/onder` metinlerinden fiziksel menteşe yeri tahmin etmiyor; yalnız açık `tilt_axis/tiltAxis` metadatasını kabul ediyor. Prefab karşılığı: `Links`, `Rechts`, `Voorzijde` gibi etiketleri ayrıştırarak geometri üretmemek; sabit alan kodları ve metadata kullanmak. Üretici CAD, taşıyıcı sistem veya gerçek yapı detayı yoksa gösterim ölçüye dayalı şematik önizlemedir.

Mevcut 3D motorunda `ResizeObserver`, görünmeyen sekmede duraklatma, azaltılmış hareket, RAF animasyonu ve `dispose()` ile GPU kaynak temizliği bulunuyor. Bunlar tekrar kullanılabilir yaşam döngüsü fikirleri; pencerenin ray/kanat/çıta geometrisi prefab yapıya taşınmamalı.

`docs/3d-gorunurluk-2026-09-06.md` ve `docs/kompakt-yerlesim-2026-09-06.md` kullanıcı geri bildirimiyle belirlenen yerleşimi açıklıyor: model görünür kalmalı; 3D/2D, kamera, sıfırlama ve tam ekran doğrudan erişilebilir olmalı. Telefonda seçenekler ve görünür model dengelenmeli; sabit fiyat çubuğu form alanlarını örtmemeli. Mevcut proje belgeleri geçmiş tarayıcı ölçümleri içeriyor, yeni prefab arayüzü için ölçüm yerine geçmez.

## Dört alternatiften somut bulgular

Aşağıdakiler 9 Eylül 2026'da erişilen resmi sayfalardan derlenmiştir. Fiyatlar karşılaştırma gözlemidir; bizim maliyet tablomuz değildir. Her sitede bütün etkileşimler veya talep gönderimi doğrulanmış değildir.

### 1. Hollands Prefab — açıklık ve seçenek karşılaştırması

Konfigüratör ölçü, dış, iç ve pratik işler olarak grupluyor. Cephede taş/Keralit/ahşap; doğramada ahşap/PVC/alüminyum; çatı ışıklığı, aydınlatma, priz, musluk ve ısıtma seçenekleri var. Görünen seçeneklerde ek fiyat veya dahil durumu yazıyor. Örneğin 100×150 cm dakraam €3.000, overstek €1.000 ve erişimin yetersiz olması €2.250 ek bedelle gösterilmiş. Kalıcı toplam ve teklif düğmesi bulunuyor. [Resmi configurator](https://www.hollandsprefab.nl/configurator)

Alınacak fikir: seçim anında etkiyi göstermek, dış/iç aksesuarları konumuyla seçtirmek ve erişim/doorbraak cevaplarını tasarımın parçası yapmak. Sadece estetik seçenekleri toplamak teklifin işçilik ve lojistik tarafını eksik bırakır. Kaynakta birbirine yakın aksesuarlar için farklı fiyatlar ve asimetrik değerler de var; bunlar aynen kopyalanacak kurallar değildir.

### 2. Prefabmaat — şekil, bağlam ve ilerleme

İlk adım resmi arama indeksinde beş aşamalı akış, U/L/H şekilleri, evin arkasında/yanında konum, çizime tıklayarak ölçü, alan ve yükseklik bilgisi içeriyor. Sağ bölüm toplamın vergi dahil/haricini ve planı saklamayı sunuyor. Ana sayfa aanbouw ve dakopbouw girişlerini ayırıyor. [İlk adım](https://configureren.prefabmaat.com/configurator/stap/1), [resmi başlangıç](https://configureren.prefabmaat.com/?hsLang=nl)

Alınacak fikir: ürün ailesini önce belirlemek, müşterinin yapıyı evine göre anlamasını sağlamak, ilerlemeyi ve taslağı görünür tutmak. Görünen planlama, garanti ve izin iddiaları bu şirketin metinleridir; bizim ürünümüzde doğrulanmış şirket bilgisi olmadan kullanılmaz. Doğrudan HTML okuması uygulamanın içeriğini tam açmadı; 2–5 adımlar bu incelemede doğrulanamadı. Bu nedenle yalnız ilk adım ve resmi ana sayfa gözlemi üzerinden karşılaştırıldı.

### 3. AddOn — karar yükünü azaltan ürün başlangıcı

Başlangıç Gozar, Nyde ve Profiter modellerine ayrılıyor. Profiter sayfasında beş aşamalı bir form ve ilk soruda 4×2 m, 4×3 m veya serbest ölçü seçimi görülüyor. Gozar ve Nyde sayfaları benzer giriş düzenini taşıyor. Erişilen ilk aşama metninde canlı toplam görünmedi. [Model listesi](https://www.addon.nl/configurator), [Profiter formu](https://www.addon.nl/configurator/profiter), [Gozar](https://www.addon.nl/configurator/gozar), [Nyde](https://www.addon.nl/configurator/nyde)

Alınacak fikir: birkaç anlaşılır kullanım senaryosu veya ölçü ön ayarıyla başlatmak, ardından ölçüleri düzenletmek. İlk ekranı onlarca teknik alanla doldurmamak. Bu inceleme görünmeyen sonraki adımlarda fiyat bulunmadığını iddia etmez.

### 4. De Bouw Baron — tahmin ile kesin teklifin sınırı

Dört bölüm ölçü, dış görünüm, gün ışığı/konfor ve bitirme seviyesi. Ölçüler 10 cm adımlı; kapı tipi, çatı ışığı ve paketlerin ek bedelleri görünür. Casco+, behangklaar ve gebruiksklaar paketleri var. Toplam tek kesin rakam yerine BTW dahil aralık. Kapsam ve varsayımlar toplamın yanında açıklanmış; maliyet dökümü düğmesi, iç/dış görseli ve PDF talebi sunuluyor. İletişim aşamasında e-posta veya telefon yeterli; isim ve adres isteğe bağlı olarak etiketli. [Resmi configurator](https://bouwbaron.nl/pages/aanbouw-configurator.html)

Alınacak fikir: bilinmeyen temel, konstrüksiyon veya erişimi sahte kesinlikle fiyatlamamak; tahmini bedeli ve inceleme ihtiyacını açık yazmak. İlk iletişim talebini kısa tutmak. PDF indirme ve iletişim sonrasındaki gerçek teslim davranışı bu incelemede denenmedi.

## Bizim akış için önerilen iyileştirmeler

1. **Model ve ölçü:** Aanbouw/dakopbouw gibi kaynakta bulunan ürünler; birkaç ölçü ön ayarı; bağımsız sayı alanı ve slider; toplam alanın anında değişmesi. Birim dönüşümü tek yerde yapılmalı.
2. **Dış görünüm:** Kaplama ailesi → o aileye uygun renk; doğrama modeli → malzeme/renk; yalnız seçilebilir seçenekler. Seçilmiş fakat yeni tercihle çelişen değer sessizce kalmamalı.
3. **Çatı ve iç donanım:** Işıklık ile ısıtma/elektrik ve iç bitirmeyi küçük gruplar halinde sunmak; teknik ayrıntıları açıklamayla açmak. Dahil seçeneğin fiyatını “+ €0” yerine “Inbegrepen” göstermek.
4. **Proje koşulları:** Temel, mevcut cephe açıklığı, erişim, vinç/taşıma ve montaj kapsamı. Bilinmeyen cevap gerçek bir seçenek olmalı, model müşteriyi tahmine zorlamamalı.
5. **Özet ve talep:** Ölçü, malzeme ve tüm ek işler düzenleme bağlantısıyla listelenmeli. Fiyat kitabı sürümü, fiyat niteliği, dahil ve hariç kalemler belgede kalmalı. Talep başarılıysa takip referansı gösterilmeli.
6. **Devam etme:** Taslağı yerelde saklamak; bozuk/eski şemaya tolerans; sıfırlama; kişisel bilgi içermeyen paylaşım; taşınabilir JSON/teklif çıktısı. Yerel saklama veya yazdırma başarısı e-posta gönderildi diye sunulmamalı.
7. **Küçük ekranda çalışma:** 360 ve 390 px genişliklerde adım ve alan erişimi, klavye odağı, model/panel dengesi, sabit alt çubuk ve yatay taşma ölçülmeli. Sadece ekran görüntüsü yeterli değildir; değer değişikliği ve özet aktarımı da doğrulanmalı.

## Uygulama ve entegrasyon sınırları

Önerilen kalıcı sözleşme:

```json
{
  "schemaVersion": 1,
  "product": "aanbouw",
  "dimensions": {"width_mm": 5000, "depth_mm": 3000, "height_mm": 3000},
  "options": {"facade": "brick", "frame": "sliding", "rooflight": "none"},
  "site": {"foundation": "review", "access": "unknown"}
}
```

Bu şema yön göstericidir; Prefabpartner'ın doğrulanmış alanları nihai isimleri belirlemeli. İstemci fiyat göndermemeli. Sunucu normalize edilmiş seçim, kalemler, vergi/toplam, `priceStatus`, değerlendirme gerektiren cevaplar, `priceBookVersion` ve geçerlilik bilgisi döndürmeli. Mutasyon rotası boyutları ve seçenekleri yeniden doğrulayıp yeniden fiyatlamalı.

Odoo teklif talebi adaptörü `crm.lead` içine müşteri ve proje bilgilerini yazabilir; yapılandırmanın frozen JSON ve hesaplama dökümü ayrı `cs.prefab.configuration` kaydında kalmalıdır. Rapor bu kaydı okumalı. Yalnız satış fiyatı doğrulanmışsa bir `sale.order` taslağına bağlamak anlamlıdır. Veri tabanı olmadan çalışan yerel mod gerçek CRM teslimi iddiası taşımamalı.

Başlangıçta kapsamı büyütmeye değmeyen işler: üretici doğrulaması olmayan CAD/staal berekening, otomatik vergunningsvrij kararı, bina fotoğrafına AI yerleştirme, AR ve ödeme alma. Kullanıcının tasarımını ölçülü göstermek, eksiksiz kalemlendirmek, saklamak ve kullanılabilir teklif talebine çevirmek ilk modülün esas işidir.

## Bu raporun kanıt sınırı

- Mevcut pencere projesi yalnız okundu; kaynakları veya canlı sistemi değiştirilmedi. Referans sürüm kaynak okumasıyla doğrulandı.
- Alternatiflerin resmi sayfaları/ilk adımları incelendi; diğer firmalara test talebi veya müşteri bilgisi gönderilmedi.
- Pencere projesindeki geçmiş test sayıları yeni uygulamanın kabul sonucu olarak kullanılmadı. Yeni modülün hesaplama, API, tarayıcı ve Odoo sonuçları ayrı raporlanmalıdır.
- Eski genel hafıza yalnız ilgili kaynakları ve tercihleri bulmak için kullanıldı; değişmiş davranışlar güncel kaynakla düzeltildi. İlgili kayıt: `MEMORY.md:27–44`, konuşma `01a06eea-4e3c-7f81-a80e-5cf91062ba43`.
