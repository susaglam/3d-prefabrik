# Prefab 2.3 — yerleşim ve seçim arayüzü

Kullanıcının istediği sıra uygulandı: önce [yerel Odoo 2.2 iş akışı](native-odoo-workflow-2.2.md) tamamlandı, hedefe yüklendi ve canlı tarayıcı kabulü 7/7 geçti. Ardından bu görsel ve yerleşim çalışması tamamlanarak **saas~19.4.2.3.0** yayımlandı. Güncel adres: [prefabpartner.codesnap.nl/prefab](https://prefabpartner.codesnap.nl/prefab).

## Kullanıcıya görünen değişiklikler

- **Opnieuw beginnen** masaüstü ve mobil üst çubukta görünür. Kısa onaydan sonra varsayılan tasarım, ilk adım ve ilk kamera görünümü açılır. Yerel taslak, karşılaştırmalar, girilmiş iletişim bilgileri ve paylaşım URL'si temizlenir. Geciken hesaplama, paylaşım veya teklif hazırlığı cevapları eski tasarımı geri getiremez. Daha önce oluşturulmuş sunucu teklifleri ve deellinkler korunur.
- Malzeme aile başlıkları, seçili kart çerçevesi ve **Gekozen** bilgisi güçlendirildi. Çatı seçenekleri panel sayısına göre **Lessenaar** ve **Zadeldak** ailelerinde sıralanır. Çizimler tek eğimi veya mahyalı iki eğimi ve gerçek panel sayısını gösterir.
- Sarkıt ve spot yerleri ölçülere, çatı boşluğuna ve cihaz zarflarına göre hesaplanır. Çakışan seçimler fiyatlandırılmadan temizlenir; seçilemeyen yerler arayüzde açıklanır. Radyatörün kendi tesisat hazırlığı iki boru ucu olarak gösterilir.
- Dış lamba ve priz aynı düşey ekseni kullanır. Musluk köşe yönünde en az 35 cm ayrılır ve yağmur borusuyla çakışmaz. Ön ayak yetersizse ilgili tarafın grubu yan cepheye yerleşir. Mesafeler bu görsel modelin yerleşim değerleridir.
- Yerden ısıtma seçildiğinde zemin üzerinde ince, yuvarlatılmış temsili boru rotası görünür. Aynı rota planda ve belge görsellerinde kullanılır. Örnekleri gizlemek bu temsili çizimi kaldırır; teslim kapsamındaki gerçek ürün durumu değişmez.
- Aydınlatma açıklıkları ölçülü sıcak ışık etkisi taşır. Koyu cephelerde temsili aygıt çizgileri daha açık renkle okunur. Bu efektler yeni oda ışıkları eklemez; dahil aygıtın yüzeyi ve temsili kontur ayrımı korunur.

## Teknik sınırlar ve kayıtların korunması

Sunucunun `fixtureLayout` verisi santimetre cinsinden cihaz konumlarını taşır. Önizleme ve ayrı belge çizicisi bu düzeni kullanır. Katalogdaki boşluk payları ve cihaz varyantları hesaba katılır. Yeni teklif bu düzeni fiyat ve katalogla birlikte dondurur.

Bilinen `.1`, `.2`, `.3` varlık sürümlerinin kayıtları kendi yerleşim normalizasyonunu korur. Yeni `.4` yayını yeni kuralları kullanır; eski teklifin tekrarı aynı token, fiyat ve görüntü kaydını döndürür. Yeni katalog yayını yalnız varlık sürümünü ilerletir; fiyatlar, teslim kuralları ve yönetici ölçü ayarları korunur.

Yeni başvuru tüm model tercihlerini ve seçenek istisnalarını da dondurur. Yönetici daha sonra radyatör veya lamba modelini değiştirse bile tekrar gönderim ilk başvurunun modeliyle doğrulanır. Eski kayıtlarda saklanmış kapsam ve yerleşim kanıtı kullanılır. Her iki bilgi de eksikse bazı eski tekrarlar ihtiyatlı biçimde çakışma döndürebilir; tarihî teklif değiştirilmez veya yeni fiyatla hesaplanmaz.

## Kabul kanıtları

Sonuçlar [2.3 kanıt dizininde](verification/2.3/README.md) tutulur.

| Kontrol | Sonuç |
| --- | --- |
| Python servis, HTTP, belge, geometri ve eski kayıt regresyonları | 106/106 |
| JavaScript durum, geometri ve 3D kontrolleri | 70/70 |
| Aynı saas~19.4 görüntüsündeki ayrı PostgreSQL/Odoo kopyası | 23/23 |
| Canlı hedefte 3D, yerleşim, sıfırlama, mobil ve erişilebilirlik | 11/11 |
| Ayrı yerel veritabanında belge görselleri ve tekrar gönderim | 5/5 |

[Dağıtım kaydı](verification/2.3/deployment.json), kurulu modül sürümünü, HTTP 200 ve sağlıklı container durumunu, 345 dosyanın SHA-256 eşleşmesini doğrular. Aktif katalog **12**, varlık sürümü **2026-09-13.4** oldu. Mevcut fiyatlar, 37 teslim kuralı ve yönetici ölçü kuralları korundu; müşteri/CRM/satış/proje kayıtlarının işlem öncesi ve sonrası özetleri eşleşti. E-posta gönderilmedi. DB, filestore ve addon yedekleri saklandı; çalışma için açılan iki geçici PostgreSQL kopyası ve geçici erişim dosyaları kaldırıldı.

Bağımsız addon paketi: `dist/cs_prefab_configurator-saas~19.4.2.3.0.zip`; SHA-256 `08e4a33520c2481fce629006a7b7206b15a1535f2d5a1be508500f14b8e20cee`. Coolify paketi destek modülleri ve kök requirements dosyasını da içerir.

Fiyat modu demonstrasyon olarak kaldı. Serbest cihaz sürükleme, yeni yapı tipleri veya üretici onaylı uygulama çizimleri bu teslimin kapsamına eklenmedi.