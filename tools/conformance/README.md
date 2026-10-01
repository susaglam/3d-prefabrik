# Uygunluk kapısı — statik tarayıcı + cırcır

`addons/` altındaki her `vd_*` modülünü, [CLAUDE.md](../../CLAUDE.md) ve
[module-patronen.md](../../docs/00-project/module-patronen.md) içindeki baseline'ın
**makineyle kontrol edilebilir** kısmına karşı puanlayan salt-okunur bir tarayıcı;
yanında yalnızca **yeni** ihlalleri bloklayan bir **cırcır (ratchet)** dağıtım kapısı.

**Veritabanı yok, Odoo kurulumu yok, ağ yok.** Bu bir eksiklik değil, tanımın
kendisi: dağıtımdan **önce** çalışacak bir kontrol, canlı veritabanı düşmüşken de,
uçakta da, temiz bir CI konteynerinde de çalışmak zorundadır. Canlı DB isteyen bir
kontrol kapı değil, **denetimdir** — ve o ayrım bu dosyanın son bölümünü oluşturur.

---

## 1. Günlük kullanım — hiçbir şey çalıştırmıyorsun

Bir `PreToolUse` hook'u ([`.claude/settings.json`](../../.claude/settings.json))
Bash komutlarını izler, dağıtım biçimli olanları tanır ve **yalnızca o komutun
hedeflediği modülü** kontrol eder. Hiçbir şey gerilemediyse kapıyı hiç görmezsin.

Gerileme olduğunda komut çalışmadan durur ve stderr'e şunun gibi bir blok basar
(tam metin `gate.py` içinde):

```text
TEMEL GERİLEMESİ: vd_site_base — dağıtım engellendi

  x i18n_files: i18n/nl.po yok

Bu kontroller conformance.lock.json'da GEÇİYORDU, şimdi DÜŞÜYOR.
Düzeltin; değişiklik bilinçliyse yeni durumu bankaya yazın:
  python tools/conformance/scan.py --all --write-lock
Yine de dağıtmak için: VD_CONFORMANCE_SKIP=1 ya da komuta #no-gate ekleyin.
```

Mesajın üç soruyu birden yanıtladığına dikkat: **ne** düştü, **neden** engellendi
(kilitte geçiyordu), **nasıl** çözülür (düzelt / bankala / bilerek atla). Bu,
CLAUDE.md'nin `UserError` kuralının bir araca uygulanmış hâlidir.

Tanınan dağıtım biçimleri, bu depoda modülün gerçekten sunucuya ulaştığı yollar:
`scripts/deploy_module.py`, `tar … | ssh`, `scp`, `rsync`, `sftp`, `docker cp`,
`button_immediate_upgrade` / `_install`, `odoo-bin … -u|-i`,
`odoo-bin … --update|--init`.

Kapı **tahmin etmez**. Komutta birden fazla modül adı geçiyorsa hangisinin yük
olduğu bilinemez; kapı çekilir ve komutu geçirir. Gerekçe: yanlış modülü bloklayan
bir kapı, bir hafta içinde kapatılan bir kapıdır.

**Hook'un kendisi de düşmez.** Kablolama `gate.py`'yi çağırmadan önce dosyanın var
olup olmadığına bakar; yoksa sessizce geçer. Bu kozmetik bir önlem değil:
`PreToolUse` içinde **çıkış kodu 2 komutu bloklamak demektir** ve Python bulamadığı
bir dosya için tam olarak 2 döner **[Ö — bu makinede doğrulandı]**. Korumasız bir
kablolama, `gate.py` henüz yazılmamışken (veya bir dal değişiminde yokken) depodaki
**her** Bash komutunu bloklardı. Python'un kendisi yoksa çıkış kodu 2 değildir, yani
o durumda da yalnızca bir uyarı görürsün.

Aynı ilke `gate.py` içinde de var: kapı **kendi** beklenmedik hatasında bilerek 0
döner ve nedenini stderr'e yazar. İki katman aynı cümleyi kurar — **kapının arızası
meşru bir dağıtımı durdurmaz** — ama farklı yerleri korurlar: dosya yokken `gate.py`
kendini savunamaz, çünkü hiç çalışmaz.

---

## 2. Elle çalıştırma

```bash
# tek modülü puanla
python tools/conformance/scan.py --module vd_site_base

# tüm depo, en kötüsü başta
python tools/conformance/scan.py --all

# makine okunur
python tools/conformance/scan.py --module vd_site_base --json

# dağıtmadan cırcıra karşı kontrol et
python tools/conformance/gate.py --all

# kapıyı kanca olmadan dene: bu komutu dağıtım sayıyor mu, hangi modülü çıkarıyor
python tools/conformance/gate.py --command "python scripts/deploy_module.py vd_site_base"
```

Sondaki `--command` kancanın kuru çalıştırmasıdır ve asıl işi §1'deki iki kararı
görünür kılmaktır: *bu komut dağıtım biçimli mi* ve *hedef modül hangisi*. Kancayı
ilk kez canlı bir dağıtımda denemek, öğrenmenin pahalı biçimidir.

---

## 3. Cırcır — neden katı bir kapı değil

`conformance.lock.json` (git'te tutulur) yazıldığı andaki uygunluk durumunu
kaydeder. Kapı yalnızca **`GEÇTİ → KALDI`** geçişini bloklar. Hâlihazırdaki borç
devralınır ve **asla bloklamaz**.

**Neden bu tasarım.** Önceki bir portföyde ölçülen sayı şuydu: 91 modülde **164
açık bulgu**; katı bir kapı ilk gün **13 modülü** bloklardı **[Ö — başka depoda
ölçüldü]**. Böyle bir kapı düzeltilmez, **kapatılır** — ve kapatılmış bir kapı
sıfır değer üretir **[Y]**. Cırcır sıfır sürtünmeyle başlar ve yalnızca sıkışır.

**Bu depo için asıl gerekçe farklı ve daha önemli.** Bugün burada tek bir modül var
ve temiz; katı kapı bugün bedava görünüyor. Borç sonra gelir: müşterinin gerçek
modülleri, devralınan bir eklenti, cuma akşamı yapılan acil bir düzeltme. Cırcırı
**bugün**, depo temizken kurmanın maliyeti sıfırdır ve karşılığında lock dosyası
temiz durumu kaydeder — yani **ilk gerileme ilk günden yakalanır** **[T]**. Katı
kapıya sonradan geçmek her zaman mümkün; cırcırı borç birikmişken kurmaya
çalışmak ise yukarıdaki 13 modül tablosudur.

Uygunluğu bilerek değiştirdikten sonra — bir modülü düzelttin ya da yeni bir bulguyu
kabul ettin — yeni durumu banka:

```bash
python tools/conformance/scan.py --all --write-lock
git add conformance.lock.json
```

Bankalamadan düzeltmek zararsızdır: iyileşme raporlanır, sadece zorlanmaz.
Bankalamak ise o kazancın bir daha **sessizce** kaybolamayacağı anlamına gelir.

---

## 4. Kaçış kapağı

```bash
VD_CONFORMANCE_SKIP=1 <dağıtım komutu>     # ortam değişkeni
<dağıtım komutu>  #no-gate                  # komut içi işaret
```

İkisi de stderr'e bir satır basar: **atlanmış bir kapı asla sessiz değildir.**

Gerekçe: kaçış kapağı olmayan bir kapı, bir kez yanlış zamanda engel olduğunda
atlanmaz — **silinir**. Görünür bir kapak, atlamayı bir olay kaydına dönüştürür.

---

## 5. Şiddet — RATCHET ve WARN

| Şiddet | Lock'ta mı? | Bloklayabilir mi? | Ne için |
|---|---|---|---|
| `RATCHET` | evet | evet | Yanlış-pozitif oranı fiilen sıfır olan kontroller: dosya var mı, manifest anahtarı, birebir dize araması |
| `WARN` | hayır | hayır | Zayıf vekiller — naif statik kontrolün yeterince sık yanıldığı, bloklamanın seni kapıyı kapatmaya eğiteceği yerler |

**Şüphedeysen `WARN` gönder.** Kurt geldi diye bağıran bir kapı, kapısızlıktan
kötüdür: birincisi seni tüm sinyale karşı kör eder, ikincisi en azından dürüsttür.

Bir kuralın hangi kovaya gireceğinin testi, kuralın *önemi* değil **kanıtın
netliğidir**: `i18n/nl.po` dosyası ya vardır ya yoktur (RATCHET); "bu `help=`
metni gerçekten yardımcı mı" sorusunun statik cevabı yoktur (kural bile değil,
bkz. §11).

Somut örnek — `tests_present` neden WARN: bir `tests/` dizininin varlığı, testin
varlığının **vekilidir**, kendisi değil. Boş bir `tests/` geçer, tek satırlık bir
`assert True` geçer; buna karşılık gerçekten test edilmiş ama testleri başka yerde
duran bir modül düşer. Önemi yüksek, kanıtı zayıf → WARN. Aynı gerekçe
`deprecated_python_weak` için de geçerlidir: ailenin bağlam isteyen, dize
aramasının yanıldığı kısmı bilerek WARN'a ayrılmıştır.

---

## 6. Muafiyet sınıfları (`NA`) — tasarımın çekirdeği

Her kural `NA` dönebilmelidir. Bu sonradan eklenmiş bir istisna mekanizması değil,
tasarımın en önemli parçasıdır: muafiyet sınıfı olmayan bir tarayıcı, açığı kabaca
**3 katı** büyük gösterir **[Ö — başka depoda, 91 modüllük örneklemde ölçüldü]**.

Bu depodaki karşılıkları:

- Hiç model bildirmeyen bir modülde `security/ir.access.csv` **yokluğu doğrudur** —
  bulgu değil.
- Kullanıcıya dönük yüzeyi olmayan saf altyapı modülü, rehberlik kurallarından
  muaftır (module-patronen §13).
- Hiç çevrilebilir dize üretmeyen bir modülde `.pot` aramak gürültüdür.

**Yanlış bir `NA`, yanlış bir `KALDI`'dan kötüdür**, çünkü sessizce muaf tutar:
`KALDI` sana bağırır, `NA` hiçbir şey söylemez. Gerçek vaka: bir modül tüm kullanıcı
yüzeyini `data/` altında `<template>` ve `website.page` kayıtları olarak tutuyordu ve
hiç `views/` dizini yoktu; erken bir sınıflandırma onu **bütün** i18n ve rehberlik
kurallarından muaf saymıştı **[Ö]**.

Bu yüzden kural: `NA` dönen her kural **neden** muaf olduğunu detay dizesine yazar.
"Muaf" bir cevap değildir; "model bildirmiyor, ACL beklenmez" cevaptır.

---

## 7. Devralınmayan kurallar — ve neden

Kaynak portföyde bloklayan bazı kurallar buraya **kasıtla alınmadı**. Hepsinin ortak
özelliği aynı: **paylaşılan bir temel modülün varlığını varsayarlar** (ortak bir
köprü / güvenlik tabanı / yardım tabanı). Orası 95 modüllük bir portföydü; burası
**tek bir webshop**.

| Alınmayan kural | Neyi varsayardı |
|---|---|
| `no_bridge_hard_dep` | ortak bir AI/MCP köprü modülü |
| `depends_security_base` | ortak bir güvenlik kategorisi modülü |
| `soft_import_guard` | yukarıdakinin yumuşak korumalı import'u |
| `ai_tool_surface` | her modülde `@ai_tool` yüzeyi |
| `action_mcp_pairing` | her `action_*` için `action_mcp_*` eşi |
| `help_tutorials`, `help_tour` | ortak bir "Yardım ve Örnekler" taban modülü |

Var olmayan bir bağımlılığı kontrol eden kural iki şeyden birini yapar: ya **her
zaman kalır** (gürültü, kapı kapatılır) ya da **her zaman `NA`** döner (ölü kod,
bakımı yapılmaz). İkisi de kötüdür **[Y]**.

Bunlar `rules.py` içinde **devre dışı** ve gerekçesiyle birlikte durur. Bu proje bir
gün öyle bir taban modül edinirse kural sıfırdan yazılmaz, açılır — tasarım gerekçesi
module-patronen §12 ve §13'te zaten yazılı.

---

## 8. Kurallar — hangi aile neye bakar

Kanonik liste `rules.py`; `scan.py --json` çıktısı id'leri ve şiddetleri verir.
Bu tablo ile `rules.py` ayrışırsa **doğru olan `rules.py`'dir**.

| id | Şiddet | Bakar |
|---|---|---|
| `manifest_version` | RATCHET | beş bileşenli `saas~19.4.x.y.z` sürüm biçimi |
| `manifest_data_exists` | RATCHET | `data`/`demo` listesindeki her yolun diskte var olması |
| `no_forward_xmlid_ref` | RATCHET | manifestte **sonra** yüklenen bir dosyanın xmlid'ine `ref()` yok |
| `security_file_modern` | RATCHET | `security/ir.access.csv` ve 19.4 başlığı (`group_id/id`, tek `operation`) |
| `security_acl_present` | RATCHET | bildirilen her model için en az bir erişim satırı |
| `no_legacy_acl_records` | RATCHET | `ir.model.access.csv` yok; `ir.rule` / `ir.model.access` **kaydı** yok |
| `deprecated_python` | RATCHET | 19.4'te kaldırılan/yeniden adlandırılan Python API'si |
| `deprecated_view` | RATCHET | `<tree>`, `attrs=`, `states=` |
| `asset_bundles` | RATCHET | 19.4 paket adları (`web.assets_backend`, `…_lazy`, …) |
| `owl3_template_attrs` | RATCHET | `t-ref`→`t-custom-ref`, `t-esc`→`t-out`, `t-model`→`t-custom-model` |
| `menu_parent_no_action` | RATCHET | çocuğu olan `<menuitem>` `action=` taşımaz |
| `single_web_icon` | RATCHET | modül başına en fazla bir `web_icon` |
| `i18n_pot`, `i18n_nl` | RATCHET | `.pot` + canlıda etkin beklenen dil `.po` dosyaları (`rules.py::I18N_LANGS`) |
| `deprecated_python_weak` | WARN | aynı ailenin yanlış-pozitif üreten, bağlam isteyen kısmı |
| `tests_present` | WARN | Python mantığı olan modülde `tests/` dizini |
| `no_foreign_brand_in_data` | WARN | modülle gelen veride sabitlenmiş marka/alan adı/anahtar yok |

Hepsi **evrenseldir**: Odoo 19.4'ün kendisinden gelirler, bu projeye özgü bir
konvansiyondan değil. Bu yüzden bir sonraki 19.4 projesine olduğu gibi taşınırlar —
tek proje bağımlılığı `i18n_*` kurallarındaki dil listesidir.

---

## 9. Yeni kural eklemek

1. Kontrolü `rules.py` içinde yaz — `ModuleFacts` alan, `(PASS | FAIL | NA, detay)`
   dönen bir fonksiyon. **Düzeltmeyi detay dizesine koy**: mesaj, doküman açmadan
   uygulanabilir olmalı.
2. `RULES` içine **dürüst** bir şiddetle kaydet (§5).
3. Lock'u yenile: `python tools/conformance/scan.py --all --write-lock`

Mevcut modüllerde şimdiden kalan yeni bir `RATCHET` kuralı, **mevcut durum** olarak
kaydedilir — geriye dönük bloklamaz. Yalnızca bundan sonraki gerilemeler bloklar.

---

## 10. Dosyalar

| Dosya | Rolü |
|---|---|
| `rules.py` | Kural tanımları, muafiyet sınıfları, şiddet |
| `scan.py` | `ModuleFacts` toplama + raporlama + lock yazma |
| `gate.py` | Cırcır karşılaştırması, dağıtım komutu tanıma, hook giriş noktası |
| `../../conformance.lock.json` | Git'te tutulan cırcır tabanı |
| `../../.claude/settings.json` | `PreToolUse` kablolaması |

---

## 11. Bu tarayıcının **yapmadıkları**

Bir aracın sınırını yazmamak, kullanıcısına yanlış güven vermektir — ve
**yanlış güven, aracın hiç olmamasından kötüdür** (CLAUDE.md §3.2).

- **RUNTIME kontrolleri.** Örnek veri gerçekten render oluyor mu? `xmlid` çözülüyor
  mu? Tur adımları tıklanabilir mi? `-u`'dan sonra JSONB etiket kayması oldu mu?
  Derlenen paket yeni dizeyi içeriyor mu? Hepsi **canlı veritabanı** ister. Bunların
  yeri `scripts/deploy_module.py --dogrula` ve dağıtım sonrası canlı denetimdir.
- **İnsan kararları.** Bu `help=` metni gerçekten öğretiyor mu? Bu renk ayırt
  ediliyor mu? Bu `UserError` üç soruyu yanıtlıyor mu? Bu Selection sırası gerçekten
  en yaygın olanı başa koyuyor mu? Otomatikleştirilemezler; yerleri `/audit-design`,
  `/audit-qa` ve kod incelemesidir.
- **Elle yapılan terminal dağıtımları.** Hook yalnızca ajanın çalıştırdığı Bash
  komutlarını görür. Kendi terminalinden `scp` çeken bir insanı durdurmaz. Bu açık
  bir gün önem kazanırsa kapatma yolu bellidir: aynı `gate.py`'yi bir git
  `pre-commit` hook'una bağlamak.
- **Ve en önemlisi: uygunluk, çalıştığın kanıtı değildir.** Bu tarayıcının yeşil
  olması "modül doğru davranıyor" demek değil, "bilinen 16 tuzaktan hiçbirine
  basmıyor" demektir. **Taban, tavan değil.**
