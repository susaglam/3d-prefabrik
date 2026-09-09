# CS Prefab — teslim raporu

**9 Eylül 2026.** Çalışan bağımsız uygulama ve gerçekten kurulup test edilmiş Odoo modülü tamamlandı. Uygulama adresi: **http://localhost:8078/prefab**. Çalışma klasörü: `E:\Projeler\cs_prefab_configurator`.

## Ortaya çıkan ürün

[PrefabPartner teklif akışındaki](https://prefabpartner.nl/offerte/) **33 soru ve 94 seçenek**, kaynak soru/cevap kimlikleriyle eşlendi. Konfigüratörün [standalone sürümü](https://directsamenstellen.nl/28befe23-1200-4d1c-8092-e48a83477820) tarayıcıda gezildi: uzun dalda 20 giriş sayfası, iç mekân atlanınca 14 sayfa; 94 seçeneğin her biri tıklandı. İletişim formu gönderilmedi.

Bizim arayüz aynı soru kapsamını yedi bölümde sunuyor: **Afmetingen → Gevel → Kozijn & dak → Buiten → Binnen → Situatie → Jouw voorstel**. Kaynağın katmanlı sabit fotoğrafları yerine kendi 3D geometrimiz ve ölçekli 2D planımız var. Rakibin marka, fotoğraf veya yazılımı uygulamanın çalışması için kullanılmıyor.

- 150–750 cm genişlik / 100–340 cm derinlik; 13 cephe, 11 kozijn, 8 çatı ışıklığı; rollaag ve daktrim.
- Dış elektrik/ışık/musluk konumu, yağmur borusu malzemesi ve yönü.
- İç mekân dalında sıva, şap, ısıtma hazırlıkları, tavan noktası, anahtar, spot ve priz tercihleri. Dal kapatılınca eski iç seçenekler ve ücretleri temizleniyor.
- Cephe açılması, arka erişim ve kazık tercihi; sekiz zorunlu iletişim alanı ve isteğe bağlı not.
- 3D döndürme, kamera açıları, çatı gizleme, ölçü çizgileri, 2D plan ve WebGL yoksa anlaşılır 2D dönüşü.
- Otomatik cihaz kaydı, kişisel bilgi içermeyen paylaşım, tasarımı geri yükleme, özetten düzenleme.
- Sunucuda fiyat doğrulama, kalıcı teklif, aynı isteğin güvenli tekrarı, sürümlü ve dondurulmuş belge verisi.
- Türkçe karakterleri koruyan gerçek PDF, ölçülü plan ve ayrıntılı hesap dökümü.
- Odoo içinde CRM fırsatı, şirket/site kapsamlı özel kayıt, yönetim görünümü ve PDF.

## Doğrulama sonuçları

| Kontrol | Sonuç | Kanıt |
| --- | --- | --- |
| Referansın seçenekleri | 94/94; uzun ve kısa dal gezildi | [Kaynak incelemesi](reference-audit.md), [makine sonucu](../research/reference/verification-summary.json) |
| Python servis/HTTP/veri/PDF testleri | **30/30 geçti**; bağımsız PDF okuyucu dahil | [Backend sonucu](verification/backend/backend-results.json), [test çıktısı](verification/backend-tests.txt) |
| JavaScript durum ve geometri | **29/29 geçti** | [Test çıktısı](verification/frontend-tests.tap) |
| Yerel uçtan uca tarayıcı | **18/18 geçti** | [Sonuç](verification/browser-results.json) |
| Gerçek Odoo ORM/HTTP testleri | **3/3 geçti** | [Odoo kanıtı](verification/backend/backend-results.json) |
| Gerçek Odoo üzerinde aynı tarayıcı akışı | **18/18 geçti** | [Sonuç](verification/odoo-browser/browser-results.json) |
| Bağımsız etkileşim regresyonu | **6/6 geçti** | [Sonuç](verification/interactions-review.json) |
| Erişilebilirlik | **15/15 axe durumu: 0 ihlal**; **4/4 SVG kontrast kontrolü** | [Sonuç](verification/accessibility-results.json), [kapsam](accessibility.md) |
| Ekran genişlikleri | **360 / 390 / 768 / 1440 px: yatay taşma yok** | Tarayıcı sonuçlarındaki viewport ölçümleri |

Python standart kitaplığıyla çalıştırılan testlerde yalnızca bağımsız PDF ayrıştırıcısını gerektiren iki kontrol açıkça atlanır; yukarıdaki 30/30 sonucu `pypdf 6.18.0` bulunan izole ortamdan alınmıştır. PDF ayrıca PyMuPDF ile okunup ilk sayfası görsel olarak incelendi. Erişilebilirlik sonucu otomatik tarama ve ek kontrast ölçümünün sonucudur; tam ekran okuyucu uygunluk sertifikası değildir.

Odoo `saas~19.3` kaynak revizyonu `b01000720dc5bbbdc250eb92997f1815501dcfda`, ayrı PostgreSQL 16 kümesi ve ayrı veritabanıyla test edildi. Kurulum 56 bağımlı modülle başarıyla tamamlandı. CRM oluşturma, idempotency, PDF, public ACL, farklı şirket/site token ayrımı, yabancı Origin reddi, istemci fiyatını reddetme ve gizli seçenek temizliği gerçek runtime üzerinde doğrulandı. Geçici Odoo/PostgreSQL süreçleri testten sonra kapatılır; yeniden çalıştırma komutları [backend dokümanında](BACKEND.md). Mevcut CS Product Configurator ve canlı işletme veritabanları değiştirilmedi.

## Özellikle düzeltilen kullanım sorunları

En küçük ölçünün 3D'de yanlış büyümesi, katalog dışı eski kayıtların kabulü, klavyeyle seçim sonrası odağın kaybolması, paylaşılan tasarımı düzenledikten sonra yenilemede eski tasarıma dönülmesi, kapanmış diyaloga gelen ağ hatası ve eski fiyat yanıtının yeni hesaplamayı ezmesi ele alındı. Ağ kesilince eski fiyat gösterilmiyor; tarayıcı depolamayı engelleyince kayıt başarılı denmiyor. Bağımsız [eşleme ve inceleme raporu](parity-and-review.md) bulguları ve düzeltmeleri açıklıyor.

## Alternatiflerden alınan yararlı fikirler

[Hollands Prefab](https://www.hollandsprefab.nl/configurator) maliyet ve saha sorularını; [Prefabmaat](https://configureren.prefabmaat.com/?hsLang=nl) yönlendirilmiş tasarım yaklaşımını; [AddOn](https://www.addon.nl/configurator) başlangıç seçeneklerini; [Bouw Baron](https://bouwbaron.nl/pages/aanbouw-configurator.html) fiyat varsayımlarının açıklığını değerlendirmek için incelendi. Bizde açık fiyat dökümü, saha erişimi, kaydet/devam et ve belirgin örnek fiyat açıklaması uygulandı. Ayrıntılı karşılaştırma ve mevcut CS projesinden aktarılan mimari kararlar [bu raporda](architecture-and-alternatives.md).

## Paket ve kullanım

- [Odoo eklenti ZIP'i](../dist/cs_prefab_configurator-1.0.0.zip): **42 dosya**, yalnızca eklenti ve gerekli varlıklar. Arşiv bütünlüğü kontrol edildi; veritabanı, araştırma fotoğrafları veya node_modules içermez.
- [SHA256 dosyası](../dist/cs_prefab_configurator-1.0.0.zip.sha256) arşivin doğrulama değerini içerir.
- Windows için [start-configurator.bat](../start-configurator.bat); terminal için `python3 scripts/serve.py --port 8078`.
- [Masaüstü ekranı](verification/browser-desktop.png), [390 px mobil ekran](verification/browser-390px.png), [ölçekli plan](verification/browser-plan.png), [örnek PDF](verification/backend/sample-quote.pdf).
- [Kurulum kılavuzu](../README.md), [dağıtım notları](deployment.md), [uygulanan plan](implementation-plan.md).

Yerel uygulama dış servise bağımlı değildir; Python 3.10+ ile çalışır. Paylaşımın başka cihazlarda açılması için o cihazın uygulama sunucusuna ulaşabilmesi gerekir. `localhost` bir internet yayın adresi değildir.

## Canlı kullanım için kalan işletme kararları

**Fiyatlar açıkça demonstrasyondur.** Referans fiyat motoru veya satış tutarı yayınlamadığı için uydurulmuş rakip fiyatı kullanılmadı. Örnek fiyat kitabı uygulamanın hesaplama ve teklif akışını çalıştırır; gerçek satış fiyatı iddiası yoktur. Sonraki adım gerçek fiyat kitabı, montaj/transport/kapsam ve vergi politikasının işletme tarafından belirlenmesidir.

Marka/alan adı, CRM ekibi, e-posta teslimi ve gizlilik metninin işletme bilgileri de canlı hedefle netleştirilmelidir. Şu an dışarıya e-posta gönderimi veya kamuya açık dağıtım yoktur. Üretim yayını için kurulum ve doğrulama tamamlandıktan sonra hedef sunucuda kontrollü dağıtım gerekir.

3D ve PDF planı şematiktir. Sabit 2,80 m yükseklik ve açıklık geometrisi üretici onaylı çizim sayılmaz; kazık seçimi statik hesap yerine geçmez. PDF fontunun kapsamadığı alfabeler ve karmaşık yazı biçimlendirmesi ayrıca ele alınmalıdır.
