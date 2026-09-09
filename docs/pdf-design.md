# PDF teklif tasarımı — 1.1.0

9 Eylül 2026. Önceki iki sayfalık metin ağırlıklı çıktı, altı sayfalık bir tasarım önerisine dönüştürüldü. [Anonim PDF](verification/pdf-redesign/proposal.pdf) ve [altı sayfalık genel görünüm](verification/pdf-redesign/contact-sheet.png) son çıktıyı gösterir.

## Belge düzeni

1. **Kapak:** marka, teklif referansı/tarihi, büyük 3D görünüm, genişlik/derinlik/alan, başvuru sahibi ve KDV dahil fiyat.
2. **Mekânsal görseller:** diğer taraftan perspektif ve çatısı gizlenmiş iç görünüm. Ekrandaki modelin kendi geometrisi kullanılır.
3. **Teknik levha:** ölçülü plan, ön cephe, sağ yan cephe; santimetre cinsinden dış ölçüler ve sabit model yüksekliği.
4. **Malzeme ve tesisat:** dış kaplama, dış tesisat, iç bitişler, elektrik, mevcut durum/uygulama için ayrı tablo grupları.
5. **Fiyat:** miktar, birim, birim fiyat, net satır tutarı; ara toplam, KDV ve toplam.
6. **Kapsam ve devam:** fiyat varsayımları, seçime bağlı açıklamalar, müşteri notu, proje/iletişim bilgileri ve sonraki adımlar.

Koyu yeşil, krem ve sıcak vurgu rengi; tutarlı A4 kenar boşlukları, başlık hiyerarşisi, satır aralıkları ve sayfa altlıkları kullanılır. Görseller kırpılmadan yerleştirilir. Uzun notlar ve tablolar gerektiğinde ek sayfalara akar; altı sayfa zorunlu bir sınır değildir.

## Görsellerin üretimi ve saklanması

Gönderimden önce yapılandırma kopyalanır ve sunucuda doğrulanır. Ayrı bir Three.js sahnesi `1440×960` boyutunda sağ/sol perspektifi ve çatısız iç görünümü üretir. Aynı metre tabanlı modelden plan ve cephe SVG'leri hazırlanıp JPEG'e çevrilir. Altı dosya teklifin değişmez kaydına eklenir. Kullanıcının canlı kamera açısı, aktif 2D sekmesi, çatı ve ölçü görünürlüğü etkilenmez; geçici sahne ve GPU kaynakları temizlenir.

Kozijn türü ve panel sayısı modelden gelir. Açılma yönü yapılandırmada belirlenmediği için sürme/harmonika panellerine doğrulanmamış hareket okları çizilmez. Çizimler şematiktir; model açıklıkları ve 2,80 m yükseklik üretici/statik onayı değildir.

WebGL yoksa üç teknik çizim yine hazırlanır ve bu durum kullanıcıya açıklanır. Plan/ön/yan çizimlerden biri üretilemezse eksik belgeyi sessizce kaydetmek yerine tekrar deneme gösterilir. İletişim bilgileri korunur. Ağ yanıtı kaybolduğunda aynı görseller ve başvuru anahtarı yeniden kullanılır; ikinci bir teklif açılmaz.

API görsel kimliğini normalize edilmiş yapılandırmaya bağlar, JPEG türünü/boyutunu doğrular, metadata'yı temizler ve etiketleri sabitler. Bu doğrulama piksel içeriğinin sunucuda yeniden üretilerek doğrulandığı anlamına gelmez. Parasal hesaplama bütünüyle sunucudadır. Fiyat, müşteri ve seçimler kayıttan okunur; PDF indirilirken güncel katalogla yeniden fiyatlandırma yapılmaz.

Önceki kayıtlarda görsel bulunmaması desteklenir: mevcut ölçülerden yerel vektör şemaları çizilir ve eksik 3D bilgisi açıklanır. Kullanıcının paylaştığı eski PDF örneği, aynı kayıt ve fiyatlar korunup o yapılandırmanın yeni görselleri eklenerek ayrıca yenilendi. Eski PDF ve değişmez veritabanı kaydı değiştirilmedi; kişisel örnek yalnız kullanıcının masaüstüne ve git dışında kalan `.data/` klasörüne yazıldı.

## Doğrulama

- **49 Python testi:** mevcut 30 servis/HTTP testi, 8 görsel sözleşmesi testi, 11 PDF düzen/içerik testi. `pypdf` ve `PyMuPDF` ile bağımsız okuma ve gerçek raster oluşturma dahil.
- **35 JavaScript testi:** geometri, seçenekler, durum ve altı yeni teknik çizim kontrolü.
- Gerçek Chromium'da altı JPEG'in kaydı; yanıt kaybında tek kayıt; gönderim sürerken canlı tasarım düzenlemesinin kayıtla karışmaması; kamera değişmemesi; WebGL dönüşü.
- Plan, ön ve yan görünümün her biri ayrı ayrı başarısızlığa zorlandı; üçünde de kayıt engellendi, yeniden denemede tam belge üretildi.
- Uzun isim/adres/e-posta, 2.999 karakter not, dört uç genişlik/derinlik kombinasyonu, eski kayıt ve kısmi görseller; metinlerin kesilmediği, çakışmadığı ve sayfa altına taşmadığı doğrulandı.
- Altı gerçek JPEG'in PDF nesneleriyle birebir eşleşmesi, Unicode/Türkçe metinler, miktar/birim fiyat ve saklanan toplam kontrol edildi.
- İki örneğin altı sayfası raster olarak açıldı. Kişisel örnek **6 sayfa / 6 görsel / yaklaşık 724 KiB**; anonim örnek yaklaşık 692 KiB. [Sınır/içerik sonuçları](verification/pdf-redesign/render-results.json).
- Odoo tarafı ayrıca gerçek `saas-19.3` üzerinde **4/4 HttpCase** ve native QWeb PDF ile doğrulandı: [Odoo raporu](pdf-odoo-verification.md).

Komutlar:

```bash
uv run --no-project --with pypdf --with pymupdf python -m unittest discover -s tests -p 'test_*.py' -v
npm test
npm run test:documents
```

Kanıtlar: [Python](verification/pdf-redesign/backend-tests.txt), [JavaScript](verification/pdf-redesign/frontend-tests.tap), [tarayıcı akışı](verification/pdf-redesign/browser-document-checks.json), [çizim hatası senaryoları](verification/pdf-redesign/browser-document-failure-checks.json).

Çalışma zamanı yalnız Python standart kitaplığı ve projeye dahil Three.js/fontları gerektirir. `pypdf`/`PyMuPDF` yalnız test araçlarıdır; public PDF için harici tarayıcı veya wkhtmltopdf servisi gerekmez. Yerel sunucu güncellemeden önce SQLite backup API ile yedeklendi; yeniden başlatma sonrasında mevcut teklif ve paylaşım sayılarının korunduğu doğrulandı.
