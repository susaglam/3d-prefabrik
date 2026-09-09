# Odoo PDF doğrulaması

9 Eylül 2026. PDF iyileştirmesi, bağımsız uygulamanın PDF servisine ek olarak Odoo yönetimindeki `Prefab aanvraagoverzicht` QWeb raporuna da uygulandı.

## Uygulanan rapor

- CS Prefab marka işareti, koyu yeşil/krem palet, A4 kâğıt formatı ve sayfa altlığı.
- Kapak, iki ek 3D açı, ölçülü plan/ön/yan görünüş, gruplanmış seçenekler, miktar/birim fiyat/tutar tablosu ve kapsam/notlar.
- Görseller yalnızca doğrulanmış, değişmez `snapshot_json.visuals` verisinden okunur. Etiketler ve parasal tutarlar saklanan başvurudan gelir; güncel katalog tekrar sorgulanmaz.
- Görselsiz eski kayıtlar boş galeri sayfaları üretmez ve görsellerin saklanmadığını açıklar.
- Fiyatlar demonstrasyon olarak işaretlidir. Teknik görsellerin sabit baskı ölçeği ve uygulama projesi niteliği olmadığı belirtilir.
- Gruplar ve tablo satırları birlikte tutulur; uzun fiyat tablolarında sütun başlıkları tekrar eder. Uzun müşteri açıklamaları sonraki sayfaya akabilir.

## Gerçek Odoo ortamı

Bu oturumda sıfırdan kurulan izole ortam:

- Odoo Community `saas-19.3`, commit `1ffbee37bf50a01f2f5a7409ba687cbe26681f92`.
- Python 3.12 ve Odoo requirements dosyasındaki 65 paket.
- PostgreSQL 16, `127.0.0.1:55478`, yalnız bu testin `cs_prefab_pdf_test` veritabanı.
- Odoo HTTP `127.0.0.1:18079`; cron kapalı, demo kayıtları kapalı, dış e-posta yok.
- Rapor motoru: sistem paketini değiştirmeden `/tmp` içine açılmış `wkhtmltopdf 0.12.6.1 (with patched qt)`.

Kullanıcının `8078` uygulaması ve mevcut PostgreSQL `5432` servisi bu test için değiştirilmedi.

## Test sonuçları

Modül 56 bağımlı modülle gerçekten kuruldu. Son modül güncellemesinde **4 HttpCase testi geçti; 0 hata ve 0 başarısızlık**.

1. HTTP başvuru, CRM kaydı, saklanan fiyat, aynı başvurunun tekrarı, PDF indirme ve model erişim kuralları.
2. Paylaşım ve diğer şirket/site üzerinden erişimin reddi.
3. Origin kontrolü ve istemciden fiyat gönderilmesinin reddi.
4. Altı JPEG görüntüsünün HTTP üzerinden kaydı; QWeb HTML'de altı görselin veri URI'lerinin ve etiketlerinin saklanan kayıtla birebir eşleşmesi; notların HTML olarak çalışmaması; tutar ve A4 formatı.

İlk gerçek render, `saas-19.3` sürümündeki tembel `t-call` gövdesi değerlendirmesi nedeniyle para şablonuna parametre aktarımındaki hatayı ortaya çıkardı. Parametreler çağrıdan önce atanarak düzeltildi ve testlerin tamamı tekrar başarıyla çalıştırıldı.

Test günlükleri geçici doğrulama ortamında `/tmp/cs-prefab-pdf-odoo-tests-final.log` dosyasındadır. Testlerin kaynak kodu `addons/cs_prefab_configurator/tests/test_odoo_adapter.py` içindedir.

## Native PDF ve görsel kontrol

Odoo `_render_qweb_pdf` ile gerçek, anonim konfigüratör görsellerinden üç PDF üretildi. Son dosyalar tekrar açılıp incelendi:

| Senaryo | Sayfa | Gömülü JPEG | Sonuç |
| --- | ---: | ---: | --- |
| Altı görünüşlü anonim başvuru | 6 | 6 | Kapak 1, galeri 2, teknik sayfa 3 görsel; ayrı seçenek/fiyat/kapsam sayfaları |
| Önceden kaydedilmiş görselsiz başvuru | 4 | 0 | Boş 3D/teknik sayfa yok; eksik görseller dürüstçe belirtiliyor |
| 2.980 karakter müşteri notu | 6 | 6 | Açıklama korunuyor; taşma yok |

Altı sayfa A4 boyutundadır. `Yılmaz`, `Şükrü`, `çatı`, `ölçü`, `ışık` karakterleri PDF metninde korunur. Tüm metin kutuları güvenli sayfa sınırları içinde, tüm resimler sayfa içinde; otomatik sınır kontrolü hata vermedi. Kapak, galeri, teknik levha, seçim tablosu ve fiyat sayfası raster olarak açılarak kontrol edildi. İlk görsel kontrolde saptanan bölüm başlıklarının önceki sayfada kalması, açık bölüm sayfa sonlarıyla düzeltildi ve PDF yeniden üretildi.

- [Anonim örnek QWeb PDF](verification/pdf-redesign/odoo/visual.pdf)
- [Görselsiz kayıt örneği](verification/pdf-redesign/odoo/legacy.pdf)
- [Uzun not örneği](verification/pdf-redesign/odoo/long-note.pdf)
- [Otomatik PDF sınır ve içerik kontrolü](verification/pdf-redesign/odoo/render-results.json)

Bu doğrulama, yerel ve yeni kurulmuş Odoo Community `saas-19.3` içindir; herhangi bir üretim Odoo veritabanına modül yüklenmedi. Bağımsız uygulamanın müşteri PDF'si farklı bir render servisini kullanır; onun doğrulaması ayrıca yapılır.

Son geometri düzeltmesinden sonra (konfigürasyonda seçilmeyen sürme yönü oklarının plandan kaldırılması) üç anonim native PDF, yeni geçici başvuru kayıtlarından yeniden üretildi. Altı görsel/altı sayfa ve sınır kontrolleri tekrar geçti; teknik sayfa yeniden açılarak okların kaldırıldığı doğrulandı. Önceki değişmez kayıtlar düzenlenmedi.

Doğrulama tamamlandığında yalnız bu test için açılan Odoo `18079` ve PostgreSQL `55478` süreçleri düzgün kapatıldı; iki portun kapalı olduğu kontrol edildi. Kullanıcının `8078` uygulaması açık bırakıldı.
