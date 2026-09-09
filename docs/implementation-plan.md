# CS Prefab uygulama planı — 9 Eylül 2026

## Hedef ve sınırlar

PrefabPartner teklif modülünün halka açık akışını araştırıp kendi markamızla çalışan bir prefab aanbouw konfigüratörü geliştirmek. Erişilemeyen davranışları doğrulanmış gibi sunmamak. Gerçek firma fiyat kitabı henüz sağlanmadığından fiyatları açıkça örnek/indicatief olarak göstermek. Üçüncü taraf siteye teklif, mesaj veya müşteri kaydı göndermemek.

## Sıra

1. Referansın tarayıcı, HTML, dinamik gömme ve halka açık veri uçlarını incele; kanıtları kaydet.
2. CS Product Configurator güncel servis, fiyat doğrulama, paylaşım/teklif ayrımı, immutable snapshot ve 2D/3D mimarisini incele; uygun kalıpları aktar.
3. Alternatiflerin ölçü, malzeme, erişim ve fiyat açıklaması akışlarını karşılaştır.
4. Sürüm kontrollü katalog ve sunucu doğrulaması oluştur; tüm para hesaplarında tamsayı cent kullan.
5. Gerçek ölçüleri kullanan etkileşimli 3D, SVG plan ve adımlı Hollandaca arayüz oluştur. Masaüstü/mobil, kaydet/devam et, paylaş, teklif, PDF tamamla.
6. Yerel SQLite teklif servisi ve aynı iş kurallarını kullanan Odoo CRM adaptörü oluştur.
7. Fiyat/validasyon, token/idempotency, HTTP ve tarayıcı uçtan uca testleri; gerçek ekran görüntüleriyle mobil taşma ve preview değişiklikleri kontrol et.
8. Çalıştırma, dağıtım, fiyat kitabı onayı ve doğrulanamayan sınırları dokümante et.

## Kabul ölçütleri

- Seçim değişiklikleri fiyat, özet, 2D ve 3D'ye aynı konfigürasyondan yansır.
- Eksik/geçersiz seçenek sunucuda reddedilir; istemci fiyatı kabul edilmez.
- Paylaşım bağlantısı kişisel bilgiyi yayınlamaz; teklif başka bir müşterinin talebiyle birleşmez.
- Yerel teklif veritabanına kalıcı kaydolur ve indirilebilir belge oluşur; gönderilmeyen e-posta gönderilmiş gibi gösterilmez.
- 360/390/768/1440 px ekranlarda kullanılabilir; hata/çevrimdışı/yüklenme davranışları bulunur.
- Örnek fiyat kitabı, uygulama doğrulaması ve Odoo çalışma zamanı doğrulaması ayrı ve açık raporlanır.

## Araştırma sırasında eklenen kararlar

- Dış sayfa WordPress/Divi, konfigüratör ayrı ReuzenPanda servisi; boş embed kabuğu işlev kanıtı sayılmayacak.
- Kardeş projede 9 Eylül düzeltmesi: geometri çevrilmiş etiketlerden çıkarılmıyor, açık metadata ile yönetiliyor. Yeni preview yalnızca canonical option ID ve ölçüleri kullanacak.
- Yerel çalışan API ve Odoo adaptörü aynı Python servislerini kullanacak; Odoo erişiminin varlığı varsayılmayacak.

## Uygulama sırasında keşfedilip tamamlanan işler

- Kaynak gömme host'u ilk istekte yanıt vermedi; halka açık standalone host ve backend tanımı üzerinden 21 sayfalık şema bulundu. Gerçek tarayıcıda 20 giriş sayfası / 14 sayfalık kısa dal ve 94 seçeneğin tamamı doğrulandı.
- Kaynak 33 sorunun 22 seçenekli alanındaki 94 cevap kimliği, ölçüler ve iletişim alanları canonical kataloğa eşlendi. Sorular yedi ana bölümde toplandı; seçenek kapsamı korundu.
- 150×100 cm minimum ölçünün geometride büyütülmesi yakalandı ve düzeltildi. Tüm çatı ışıklıkları minimum/maksimum ölçüde test edildi.
- Gizli iç mekân seçenekleri, geçersiz eski kayıt, 5 kazık gibi katalog dışı sayı, tür karışıklığı ve contact validasyonu düzeltildi.
- Klavye odağı ve panel kaydırması seçimden sonra korunuyor; özetin düzenle bağlantıları doğru adıma dönüyor.
- Paylaşılmış tasarım düzenlenince bağlantıdan bağımsız yerel kopya oluşuyor; yenileme eski paylaşımı geri getirmiyor.
- Geciken fiyat yanıtı, ağ kesintisi, diyalog kapatılırken gelen talep hatası, engellenmiş localStorage ve WebGL yokluğu için davranışlar tamamlandı.
- Statik import map yerine yerel ES module yolları kullanılarak strict CSP ile çalışma sağlandı; fontlar yerelden sunuldu.
- Kontrast ölçümüyle tespit edilen açıklama renkleri ve SVG etiketi düzeltildi; 15 axe durumu ve 4 SVG kontrast kontrolü geçti.
- Odoo saas-19.3, ayrı PostgreSQL portu/veritabanıyla gerçekten kuruldu; CRM/PDF/ACL/site ayrımı test edildi ve tarayıcı akışı Odoo üzerinden de geçirildi.
- PDF'de Türkçe karakter kaybı görüldü; lisanslı gömülü TrueType font ve Unicode eşleme eklendi. Ölçülü plan PDF içine eklendi.

## Teslim

Güncel doğrulama sayıları, çalıştırma adresi, paket, kaynaklar ve ticari sınırlar `delivery-report.md` dosyasında. Gerçek fiyat kitabı, işletme/alan adı ve üretim talep dağıtımı dış veri gerektiriyor; demonstrasyonun üzerinde ticari onay varmış gibi gösterilmiyor.
