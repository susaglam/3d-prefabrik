# Prefab 2.4 — ölçüler, mobil seçimler ve Odoo teması

**saas~19.4.2.4.0**, [prefabpartner.codesnap.nl/prefab](https://prefabpartner.codesnap.nl/prefab) adresine yükseltildi.

## Tamamlanan düzeltmeler

- Slider, elle ölçü girişi ve artı/eksi düğmeleri seçili kapı/pencere ile çatı ışıklığının ortak minimum/maksimum ölçülerini kullanır. Daha küçük ölçü için önce uygun bir açıklık seçilir. Yönetici ölçü adımı da düğmelere uygulanır; 25 cm gibi özel adımlar takılmaz.
- Ölçü değişirken uyumsuz seçim kartları hemen güncellenir. Düzeltilen alanın eski kırmızı uyarısı, geçersiz alan durumu ve hesaplama hatası temizlenir.
- Çoklu seçim paneli ilerletmez veya kamerayı başka noktaya taşımaz. Yeniden hesaplama, tıklanan kutunun ekrandaki yerini ve klavye odağını korur. Kullanıcının çevirdiği kamera mobil boyut değişiminde de korunur.
- İlgili tekli seçimlerde otomatik kamera, daha geniş bir bağlam gösterir. Açık **3D bekijken** komutu birden fazla seçili aygıtı birlikte çerçeveler; yan cephe aygıtına doğru yönden bakar. Çatı ışıklığı yukarıdan ve çatı görünürken incelenir.
- **3D bekijken** alan başlığı yanında kalır. Alan ayırıcıları, başlıklar, mobil metinler ve dokunma hedefleri belirginleştirildi.
- Sığmayan spot yerleri kilit ve farklı kutu zeminiyle gösterilir. Her kutuda uzun hata paragrafı yerine tek grup açıklaması vardır; dokunma veya klavye açıklamayı bildirir. Mobil bildirim form seçeneklerinin üstünü kapatmaz. İşlemi engelleyen hatalar ayrıca ilgili alanda, düzeltilene kadar kalır.

## Görünüm yönetimi

**Prefab → Vormgeving → Nieuw** içinde website seçilip görünüm kaydedilir. Üç seçenek: mevcut **Prefab Partner**, gerçek **Odoo website-thema**, veya **Eigen kleuren en lettertypen**. Dokuz renk, gövde/başlık yazı tipi ve 14–20 px temel yazı boyutu düzenlenebilir. Görünüm, konfigüratör yeniden açıldığında uygulanır.

Odoo modunda etkin website CSS renkleri ve gövde/başlık/düğme fontları okunur. Hedefin Inter ve Inter Tight fontları lisanslarıyla yerel olarak paketlenir. Bootstrap kuralları ana konfigüratör formuna aktarılmaz. Görünüm ayarı katalog yayını gerektirmez. [Ayrıntılı görünüm sözleşmesi](appearance-2.4.md).

## Kabul ve dağıtım

| Kontrol | Sonuç |
| --- | --- |
| Python servis, belge ve regresyon | 109/109 |
| JavaScript ölçü, durum, geometri, kamera ve tema | 86/86 |
| Son paketin aynı saas~19.4 imajındaki ayrı Odoo/PG kopyası | 26/26 |
| Canlı hedefte ölçü, mobil, kamera ve otomatik erişilebilirlik | 10/10 |
| Ayrı yerel veritabanında belge ve tekrar gönderim | 5/5 |
| Sıfırlama, geç yanıtlar ve mobil regresyon | 5/5 |
| Dokunmatik mobil seçim, kilit açıklaması ve sabit kamera | 3/3 |
| Ayrı Odoo kopyasında gerçek tema ve düzenlenebilir görünüm formu | 5/5 |
| Canlı HTTPS adreste native tema, font ve mobil kontrolü | 3/3 |

[Dağıtım kaydı](verification/2.4/deployment.json), HTTP 200, kurulu sürüm ve **364 dosyanın SHA-256 eşleşmesini** doğrular. Bütün mevcut katalog ve ilişkili müşteri, CRM, satış, proje, aktivite ve teklif görüntüsü kayıtlarının işlem öncesi/sonrası özetleri eşleşti. Katalog yeniden yayımlanmadı; varlık sürümü **2026-09-13.4**, katalog **odoo-1-1-12-be1914c3a29d129640ba** olarak korundu. Canlı tarayıcı kontrollerinde teklif/paylaşım yazma işlemleri engellendi. DB, filestore ve addon yedekleri saklandı.

Görsel inceleme masaüstü ve mobilde toplu yapıldı; mobil bildirimin formu örtmesi düzeltildikten sonra onay turu tamamlandı. Native temada ayrıca gerçek font yüklemesi ve düğme kontrastı doğrulandı. Otomatik erişilebilirlik sonuçları test edilen ekranları kapsar; tam uygunluk sertifikası değildir. [Kanıt dizini](verification/2.4/README.md).

Geçici Odoo/PostgreSQL test container'ları, bunlara ait erişim dosyaları ve yerel SSH yönlendirmesi kapatıldı. Yedekler ve kabul kanıtları korundu. [Temizlik kaydı](verification/2.4/cleanup.json).

Bağımsız addon: `dist/cs_prefab_configurator-saas~19.4.2.4.0.zip`; SHA-256 `ea9d81925a80bd656e1bb0db14a9b197f4eb6a692e80a45e76f2cede7ce3ea24`. Önceki [2.3 cihaz yerleşimi](completion-2.3-2026-09-13.md) ve [2.2 native Odoo iş akışı](native-odoo-workflow-2.2.md) kapsamı korunur. Fiyat modu demonstrasyon olarak kalır.
