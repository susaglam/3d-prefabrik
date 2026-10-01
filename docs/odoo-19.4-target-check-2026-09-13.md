# Odoo saas~19.4 — sağlanan Coolify hedefi

13 Eylül 2026. Kullanıcının `.data/api.key` dosyasına eklediği hedef bilgileriyle bağlantı ve altyapı kontrolü yapıldı. Coolify GET API, Odoo sürüm/authenticate/search_read çağrıları ve mevcut SSH anahtarı üzerinden dar kapsamlı container/dosya okumaları kullanıldı. Modül kurulmadı; servis yeniden başlatılmadı; müşteri/teklif kaydı oluşturulmadı.

| Kontrol | Doğrulanan sonuç |
| --- | --- |
| Geçici uygulama adresi | `https://prefabpartner.codesnap.nl` |
| Coolify | Sağlanan servis ve Odoo uygulaması bulundu; Odoo/PostgreSQL sağlıklı |
| Kimlik doğrulama | Coolify API, Odoo hesabı ve mevcut SSH anahtarıyla bağlantı başarılı |
| Gerçek Odoo sürümü | XML-RPC `common.version`: **saas~19.4**, `server_serie=saas~19.4` |
| Kurulu bağımlılıklar | `website`, `crm`, `web`, `base`; ayrıca `base_report_wkhtmltox` kurulu |
| Konfigüratör | Odoo modül listesinde yok; yapılandırılan addon köklerinde kaynak klasörü yok |
| Python | Container içinde **3.12.3** |
| PostgreSQL | Çalışan container görüntüsü `postgres:17-alpine`; SQL motorunun tam patch sürümü sorgulanmadı |
| Okunan konfigürasyon | `/etc/odoo/odoo.conf`; `proxy_mode=True` |
| Konfigürasyondaki addon kökleri | `/opt/odoo/odoo-server/addons,/mnt/extra-addons` |
| Kalıcı depolama | Ek addon, Odoo data/filestore, konfigürasyon ve PostgreSQL için ayrı Docker volume mount'ları var |
| Ek addon dizini | `/mnt/extra-addons` içinde manifest taşıyan modül dizini yok |
| PDF aracı | `wkhtmltopdf 0.12.6.1 (with patched qt)` |
| Font | `fc-match 'DejaVu Sans'` → `DejaVuSans.ttf`, Book |
| Website | Bir website kaydı mevcut; domain/şirket eşlemesinin ayrıntılı kabulü henüz yapılmadı |

Dosya ve container yolları uzak Linux hedefinin gerçek yollarıdır; Windows çalışma alanı yolu olarak yorumlanmamalıdır.

**Hedef kaynağında ek doğrulama:** `/opt/odoo/odoo-server` altında yeni `ir_access.py` mevcut. `website.get_current_website` imzası AST ile okundu: `self, fallback: bool | None=None`. Bu, paylaşılan matrisin eski `fallback=True` notunu bu hedef için kullanmamamız gerektiğini doğrular; önceki repo raporundaki resmî kaynak bulgusuyla tutarlıdır. Kaynak dizininde `.git` bulunmadığından tam Odoo commit'i bu kontrolde belirlenemedi. `odoo/release.py` SHA-256 değeri: `cc796ee2e9754d6605ede6e578443e72ec550f7c8b821f5d755af41d478c3f62`; bu bir commit kimliği değildir.

**Sonuç:** Hedefe erişim ve gerekli temel araçlar doğrulandı. Mevcut repo manifest'i hâlâ `saas~19.3.1.1.0`; önceki incelemedeki manifest, güvenlik ve website uyarlamaları yapılmadan bu addon 19.4'e hazır sayılmaz. PDF binary/font kontrolü de gerçek QWeb veya müşteri PDF üretim testinin yerine geçmez.

**Sonraki uygulama adımları:** [Birleştirilmiş yol haritasındaki](development-roadmap-2026-09-13.md) temel uyarlamalar; hedefin test veri sınırının ve DB/filestore geri dönüşünün belirlenmesi; ardından kurulum/güncelleme, yetki, CRM ve iki PDF yolunun testi. Çalışan hedef üzerinde bu işlemler henüz yapılmadı. Worker düzeni, proxy gövde/rate limitleri, gerçek rapor asset erişimi ve tam kaynak revizyonu kabul aşamasında ayrıca doğrulanacak.

Kimlik dosyası `/.data/` Git ignore kuralının içinde. Parolalar ve anahtarlar rapora veya komut çıktısına aktarılmadı. Sır içermeyen ayrıntılı bağlantı sonuçları, Git dışında `.data/target-probe.json` ve `.data/target-ssh-probe.json` içinde saklandı.

Coolify okuma yöntemi: [Get service by UUID](https://coolify.io/docs/api/endpoints/services/get-service-by-uuid). Yerel temel: [ilk durum raporu](status-review-2026-09-12.md), [deployment notları](deployment.md).
