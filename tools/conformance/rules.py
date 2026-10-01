# -*- coding: utf-8 -*-
"""Odoo saas~19.4 modülleri için statik uyum (conformance) kuralları.

Her kural, bir ModuleFacts nesnesinin saf fonksiyonudur ve üç sonuçtan birini
döndürür:

    PASS  -- modül kuralı sağlıyor
    FAIL  -- ihlal ediyor; detay dizesi DÜZELTMEYİ de içerir
    NA    -- kural bu modüle uygulanmıyor (muafiyet sınıfı)

Odoo, veritabanı ve ağ GEREKMEZ. Yalnızca standart kütüphane (`re`, `csv`)
kullanılır; tarayıcı dosyaları okur, çalıştırmaz. Bu bilinçli: kurulum
gerektiren bir kontrol, kurulumdan önce çalışamaz.


NA neden en önemli parça
------------------------
NA yumuşatılmış bir FAIL değildir. Bu tasarımın tek en kritik kararıdır.
Bu tarayıcının türetildiği 91 modüllük portföyde yapılan sayım şunu gösterdi:
muafiyet sınıfları olmadan açık (gap) yaklaşık **3 kat abartılıyor**. 27 modülde
ACL dosyası yoktu ama bunların 21'i hiç model tanımlamıyordu — onlar için ACL
dosyasının olmaması *doğru* durumdur.

Ters yönü de aynı ölçüde önemli: **yanlış bir NA, yanlış bir FAIL'den daha
kötüdür.** Yanlış FAIL bağırır, birisi bakar ve düzeltilir. Yanlış NA susar;
modül raporda "uygulanmaz" diye görünür ve eksik yıllarca fark edilmez. Bu
yüzden her NA'nın yazılı bir gerekçesi vardır ve rapora o gerekçe basılır.


Şiddet (severity): RATCHET vs WARN
----------------------------------
RATCHET kuralları kilit (lock) karşılaştırmasına girer ve bir dağıtımı
DURDURABİLİR. Buraya yalnızca yüksek kesinlikli kontroller girer: dosya var mı,
manifest anahtarı doğru mu, yanlış-pozitif oranı fiilen sıfır olan tam-dize
aramaları.

WARN kuralları raporlanır ama asla bloklamaz. Bunlar "zayıf vekil" (weak proxy)
kontrolleridir — naif bir statik kontrolün yeterince sık yanıldığı yerler.

Gerekçe tek cümle: **yanlış alarm veren bir kapı, size kapıyı kapatmayı
öğretir.** Bir kez "zaten hep saçmalıyor" dendiği an kapı ölmüştür ve o günden
sonra gerçek regresyonlar da geçer. Bir kuralın yanlış-pozitif oranından emin
değilseniz WARN olarak gönderin; kesinlik kanıtlandıkça RATCHET'e terfi eder.


Kural eklemek
-------------
Kontrolü yaz, şiddeti dürüstçe seç, sonra kilidi yeniden üret:

    python tools/conformance/scan.py --all --write-lock

Mevcut modüllerde ateşleyen yeni bir RATCHET kuralı kilide "mevcut durum"
olarak yazılır; yani geçmişe dönük bloklamaz — yalnızca REGRESYON bloklar.
Devralınan borç asla kapıyı çalıştırmaz.


ModuleFacts sözleşmesi (scan.py bunu sağlar)
--------------------------------------------
Bu dosyadaki kurallar `facts` üzerinde yalnızca şunları kullanır:

    facts.name                     -> str, modül dizin adı (ör. "vd_site_base")
    facts.manifest                 -> dict, __manifest__.py'nin literal'i ({} olabilir)
    facts.exists(rel)              -> bool, modüle göreli yol dosya mı
    facts.iter_files(globs)        -> (rel_yol, metin) üreteci
    facts.read(rel) / facts._read  -> str | None, tek dosya (ikisinden biri yeter)
    facts.declares_model           -> bool, `_name` bildiren herhangi bir model
    facts.model_count              -> int
    facts.stored_model_count       -> int, TABLOSU OLAN modeller (AbstractModel hariç)
    facts.declares_action          -> bool
    facts.action_count             -> int
    facts.has_translatable_source  -> bool
    facts.menu_parents_with_action -> set[str]
    facts.web_icon_menus           -> set[str]
    facts.test_count               -> int

`has_translatable_source` ve `is_user_facing` türü sınıflandırmalarda scan.py
tarafında da aynı ilke geçerlidir: kullanıcıya dönük yüzey her zaman `views/`
altında olmayabilir (website temaları her şeyi `data/` içinde `<template>` ve
`website.page` kaydı olarak taşır). Orada verilen yanlış bir "kullanıcıya dönük
değil" kararı, buradaki tüm i18n kurallarını sessizce NA'ya düşürür.
"""

from __future__ import annotations

import csv
import io
import re

# --------------------------------------------------------------------------
# Sonuç ve şiddet sabitleri
# --------------------------------------------------------------------------

PASS = "pass"
FAIL = "fail"
NA = "na"

RATCHET = "ratchet"
WARN = "warn"

# --------------------------------------------------------------------------
# Proje ayarları
# --------------------------------------------------------------------------

# Modüller `addons/` altında, `vd_` önekiyle durur. scan.py modül keşfinde
# bunları kullanır; tek bir yerde durmaları, ikinci bir webshop veya ikinci bir
# önek çıktığında dosya avına çıkılmasını engeller.
ADDONS_DIR = "addons"
MODULE_PREFIX = "vd_"

# Modül başına gönderilen çeviri katalogları. Site Hollandaca, ekip Türkçe
# çalışıyor; ikisi de kaynak dizeyle AYNI commit'te gider.
# Projeye özgü dil listesi. Canlı website ve res.lang ölçümünde yalnız nl_NL
# aktiftir; etkin olmayan bir dil için boş .po üretmek çeviri kanıtı değil,
# yalnız kapıyı kandırmaktır.
I18N_LANGS = ("nl",)


# --------------------------------------------------------------------------
# Muafiyet mekanizması
# --------------------------------------------------------------------------
#
# Kaynak portföyde muafiyetler kural gövdelerine gömülü sabit listelerdi
# (altyapı modülleri, onaylı istisnalar...). Tek bir webshop için o listelerin
# içeriği anlamsız, ama MEKANİZMA gereklidir: er ya da geç meşru bir istisna
# çıkar ve o an tek alternatif kuralı tamamen silmek olmamalıdır.
#
# Biçim:  RULE_EXEMPTIONS[kural_id][modül_adı] = "gerekçe"
#
# İKİ KURAL:
#   1. Gerekçe ZORUNLUDUR. Boş gerekçeli satır yok sayılır ve kural normal
#      şekilde çalışır — çünkü gerekçesiz muafiyet, sessiz bir NA üretir ve
#      sessiz NA bu tasarımdaki en kötü sonuçtur.
#   2. Gerekçe rapora basılır. Muafiyet gizli değil, görünür bir borçtur.
#
# Örnek (yorumda bırakılmıştır, gerçek bir muafiyet değildir):
#
#   RULE_EXEMPTIONS = {
#       "deprecated_view": {
#           "vd_legacy_import": "yalnız 19.0 kaynağını okuyan tek seferlik "
#                               "içe aktarım; 2026-12'de silinecek",
#       },
#   }
RULE_EXEMPTIONS: dict[str, dict[str, str]] = {}


def exemption_reason(module: str, rule_id: str) -> str:
    """Muafiyet gerekçesini döndürür; muafiyet yoksa boş dize."""
    reason = (RULE_EXEMPTIONS.get(rule_id) or {}).get(module) or ""
    return reason.strip()


# --------------------------------------------------------------------------
# Desen tabloları
# --------------------------------------------------------------------------

# Manifest sürümü BEŞ bileşenlidir: saas~19.4.X.Y.Z. Dört bileşenli bir sürüm
# modülü yüklenemez yapmaz — daha kötüsünü yapar: sürüm karşılaştırmasını bozar
# ve yükseltme sessizce "yükseltilecek bir şey yok" diyebilir.
VERSION_RX = re.compile(r"^saas~19\.4\.\d+\.\d+\.\d+$")

# 19.4'te kaldırılan/yeniden adlandırılan Python API'si. Değer, DÜZELTMEDİR ve
# hata mesajına basılır: mesaj tek başına, dokümana gitmeden kullanılabilir
# olmalıdır.
DEPRECATED_PYTHON = {
    r"\bself\._cr\b": "self.env.cr",
    r"\bself\._uid\b": "self.env.uid",
    r"(?<!_)\bread_group\s*\(": "_read_group()",
    r"\bcheck_access_rights\s*\(": "has_access() (bool) / check_access() (raise eder)",
    r"^\s*_sql_constraints\s*=": "models.Constraint attribute'u",
    r"^\s*from\s+odoo\s+import\s+[^\n]*\bSUPERUSER_ID\b": "from odoo.api import SUPERUSER_ID",
    r"\bregistry\.clear_cache\s*\(": "env.transaction.invalidate_ormcache()",
    r"^\s*from\s+odoo\.tools\s+import\s+[^\n]*\bormcache\b": "from odoo.api import ormcache",
    r"\brequest\.website\b": "env['website'].get_current_website()",
    r"\b_to_markup_data\s*\(": "_prepare_jsonld_vals() (varyant metodunu override edin)",
    r"^\s*def\s+post_init_hook\s*\(\s*cr\s*,": "def post_init_hook(env):",
}

# Aynı sınıf, daha düşük kesinlik. Bunlar WARN'da kalır çünkü desen modül
# dışı bir bağlamda da geçebilir (`type='json'` bir sözlük anahtarı olabilir,
# `toggle_active` kendi yazdığınız bir metot olabilir). Blokladıklarında
# haklı olma olasılıkları yüksek ama sıfır değil — bu fark, kapının açık
# kalmasıyla kapatılması arasındaki farktır.
DEPRECATED_PYTHON_WEAK = {
    r"type\s*=\s*[\"']json[\"']": "controller route type='jsonrpc'",
    r"\btoggle_active\s*\(": "action_archive() (davranış birebir AYNI DEĞİL, gözden geçirin)",
    r"\.(?:get|set)_param\s*\(": "ir.config_parameter get_str() / set_str() (tipli erişimciler)",
}

# Kaldırılan görünüm sözdizimi. `attrs=` için negatif lookbehind, ön yüz
# şablonlarındaki `data-attrs=` gibi masum öznitelikleri dışarıda tutar.
DEPRECATED_VIEW = {
    r"<tree\b": "<list>",
    r"(?<![\w-])attrs\s*=\s*[\"']": 'doğrudan invisible="..." / readonly="..." / required="..."',
}

# OWL3 şablon öznitelikleri. YALNIZCA static/src/**/*.xml — yani bileşen
# şablonları — taranır.
#
# views/ ve reports/ altındaki QWeb şablonları meşru olarak farklı kurallara
# tabidir (çekirdeğin `renderToFragment(name, ctx_dict)` ile render ettiği
# şablonlarda tanımlayıcılar ÇIPLAK kalmalıdır). Onları da işaretlemek, bu
# kapıyı öldürmenin en hızlı yoluydu.
#
# İkinci sözlük, codemod'ların kaçırdığı enjeksiyon biçimini yakalar:
# `<xpath position="attributes"><attribute name="t-ref">foo</attribute>`.
# Bu biçim `t-ref="..."` diye aranınca görünmez ve sonuç çalışma anında
# "Ref is undefined or null" olur — kurulum yemyeşil geçtiği hâlde.
OWL3_TEMPLATE_ATTRS = {
    r"\bt-ref\s*=": "t-custom-ref",
    r"\bt-model\s*=": "t-custom-model",
    r"\bt-esc\s*=": "t-out",
    r"<attribute\s+name=[\"']t-ref[\"']": "<attribute name=\"t-custom-ref\">",
    r"<attribute\s+name=[\"']t-model[\"']": "<attribute name=\"t-custom-model\">",
}

# 19.4'te VAR OLMAYAN varlık paketleri. Var olmayan bir pakete yazmak hata
# vermez — sessizce hiçbir şey yapmaz; dosyanız hiçbir sayfaya girmez.
#
# BURADA NE OLMADIĞINA DİKKAT: `web.assets_backend` bilerek listede yoktur.
# Yaygın bir efsane onu "kaldırıldı, yerine web.assets_web" diye anlatır ve bu
# tarayıcının türetildiği portföy tam olarak o eşlemeyi taşıyordu. 19.4
# kaynağında doğrulandı (2026-08-13, addons/web/__manifest__.py ve
# addons/crm/__manifest__.py): İKİSİ DE vardır ve farklı işler yapar —
# `web.assets_web` bir GİRİŞ paketidir, `('include', 'web.assets_backend')` +
# main.js + start.js. Modülünüz `web.assets_backend`'e yazar; çekirdek
# addon'lar da öyle yapar.
#
# Yani o kural burada olsaydı, doğru yazılmış her modüle yanlış alarm verirdi.
# Bir kuralı devralmadan önce kaynağa sormak, kuralın kendisi kadar önemlidir.
BAD_ASSET_BUNDLES = {
    # 19.2'de doğruydu, 19.4'te yok.
    "web.assets_web_lazy": "web.assets_backend_lazy",
}

# Bu depoya AİT OLMAYAN marka/müşteri adları. Modüller projeler arasında
# kopyalanır ve kaynak projenin markası şablon adında, banner metninde ya da
# seed edilmiş bir metinde birlikte gelir — sonra müşterinin sitesinde yayına
# çıkar.
#
# Liste bilerek BOŞ gönderilir: doldurmayan bir liste, dolu sanılan bir listeden
# iyidir. Boşken kural NA döner ve raporda "yapılandırılmadı" diye görünür —
# sessizce PASS demez.
FOREIGN_BRANDS: tuple[str, ...] = ()


# --------------------------------------------------------------------------
# Yardımcılar
# --------------------------------------------------------------------------


def _read(facts, rel: str):
    """Tek dosyayı oku. scan.py `read` ya da `_read` sunabilir; ikisini de kabul
    ederiz — isim uyuşmazlığı yüzünden tüm tarama patlamasın."""
    reader = getattr(facts, "read", None) or getattr(facts, "_read", None)
    if reader is None:
        return None
    try:
        return reader(rel)
    except Exception:  # okunamayan dosya bir kuralı öldürmemeli
        return None


def _blank(chunk: str) -> str:
    """Metni aynı uzunlukta boşlukla değiştir, satır sonlarını koru.

    Silmek yerine boşaltmak bilinçlidir: satır numaraları kayarsa hata mesajı
    yanlış satırı gösterir ve mesajın tamamına güven kaybolur.
    """
    return re.sub(r"[^\n]", " ", chunk)


def _blank_xml_comments(text: str) -> str:
    """XML yorumlarını boşalt.

    Bir kuralı AÇIKLAYAN yorum, o kuralın ihlali gibi okunmamalıdır. Kaynak
    portföyde tam olarak bu oldu: "sakın X paketine dönmeyin" diye yazılmış bir
    uyarı, X paketinin kullanımı sayıldı. Bu depodaki modüller gerekçelerini
    yorumda taşıdığı için risk burada daha da yüksektir.
    """
    return re.sub(r"<!--.*?-->", lambda m: _blank(m.group(0)), text, flags=re.S)


def _blank_python_noise(text: str) -> str:
    """Python yorum satırlarını ve üç tırnaklı blokları boşalt.

    Aynı gerekçenin Python tarafı: bu depoda modüller birer öğretici metindir
    ve docstring'ler yasakladığımız API'lerin ADINI anarak neden yasak
    olduklarını anlatır. Ham metinde grep yapmak, en iyi belgelenmiş modüle en
    çok yanlış alarmı verir — yani kapıyı en çok hak eden modülü cezalandırır.

    TAKAS, bilinçli ve dar tutuldu: yalnız TAMAMI yorum olan satırlar ve üç
    tırnaklı blokların İÇİ boşaltılır. Satır sonundaki `# ...` kuyrukları
    boşaltılmaz, çünkü kodun içinden tırnak takibi yapmadan kesmek gerçek bir
    çağrıyı sessizce gizleyebilir — sessiz kaçırma, gürültülü yanlış alarmdan
    kötüdür.
    """
    out = []
    in_block = False
    delim = ""
    for line in text.split("\n"):
        stripped = line.strip()
        if in_block:
            out.append(_blank(line))
            if delim in line:
                in_block = False
            continue
        if stripped.startswith("#"):
            out.append(_blank(line))
            continue
        for candidate in ('"""', "'''"):
            if line.count(candidate) % 2 == 1:  # blok bu satırda açılıyor
                in_block, delim = True, candidate
                break
        out.append(line)
    return "\n".join(out)


def _clean(path: str, text: str) -> str:
    """Dosya türüne göre yorum/docstring gürültüsünü boşalt."""
    if path.endswith(".xml"):
        return _blank_xml_comments(text)
    if path.endswith(".py"):
        return _blank_python_noise(text)
    return text


def _grep_any(facts, globs, patterns):
    """Eşleşmeleri 'yol:satır `eşleşme` -> düzeltme' biçiminde döndürür."""
    hits = []
    for path, raw in facts.iter_files(globs):
        text = _clean(path, raw)
        for pattern, replacement in patterns.items():
            for match in re.finditer(pattern, text, re.M):
                line = text.count("\n", 0, match.start()) + 1
                hits.append(f"{path}:{line} `{match.group(0).strip()}` -> {replacement}")
    return hits


def _load_order(facts) -> list[str]:
    """Manifest'in gerçek yükleme sırası: önce `data`, sonra `demo`."""
    return list(facts.manifest.get("data") or []) + list(facts.manifest.get("demo") or [])


def _csv_rows(text: str):
    """(satır_no, hücreler) üret. Tırnaklı virgül içeren `domain` sütunu
    yüzünden düz split yerine csv modülü kullanılır."""
    for index, row in enumerate(csv.reader(io.StringIO(text)), start=1):
        yield index, row


# --------------------------------------------------------------------------
# Kurallar
# --------------------------------------------------------------------------


def rule_manifest_version(facts):
    version = facts.manifest.get("version")
    if not version:
        return FAIL, "__manifest__.py'de `version` anahtarı yok -> 'version': 'saas~19.4.1.0.0'"
    if not VERSION_RX.match(str(version)):
        return FAIL, (
            f"sürüm {version!r} beş bileşenli saas~19.4.X.Y.Z biçiminde değil -> "
            "'saas~19.4.1.0.0' yazın; dört bileşende yükseltme sessizce atlanabilir"
        )
    return PASS, ""


def rule_security_file_modern(facts):
    """19.4, `ir.model.access` ve `ir.rule` MODELLERİNİ birleştirip kaldırdı.

    Not: 19.0'da tersi doğrudur (orada dosya hâlâ ir.model.access.csv olmalı,
    ir.access kurulumu iptal ettirir). Bu depo saas~19.4 hedefler; başka bir
    sürüme dağıtıyorsanız kuralı değil HEDEFİ değiştirin.
    """
    if facts.exists("security/ir.model.access.csv"):
        return FAIL, (
            "security/ir.model.access.csv -> security/ir.access.csv olarak yeniden "
            "adlandırın; başlık `id,name,model_id,group_id/id,operation,domain` ve "
            "4 adet perm_* boolean'ı tek `operation` dizesine (c,r,u,d sırasıyla) "
            "dönüşür. Manifest `data` listesindeki adı da güncelleyin"
        )
    return PASS, ""


def rule_security_acl_present(facts):
    """ACL yalnızca TABLOSU OLAN modeller için gerekir.

    `models.AbstractModel`'in tablosu ve kaydı yoktur: bir `ir.access` satırı ona
    hiçbir yetki vermez, satırın yokluğu da hiçbir şeyi kapatmaz. Sayım `_name`
    üzerinden yapıldığı sürece soyut modeller de sayılıyordu ve yalnızca soyut
    model tanımlayan bir modül, gerekmeyen bir dosya yüzünden DÜŞÜYORDU — üstelik
    bu kural cırcırlı, yani bir dağıtımı durdurabilir.

    `stored_model_count` eski bir scan.py'de bulunmayabilir; o durumda toplam
    sayıya düşülür. Yani düzeltme yokken davranış BUGÜNKÜ hâliyle aynı kalır:
    eksik bir alan kuralı gevşetmez, yalnızca eski katılığa geri döner.
    """
    stored = getattr(facts, "stored_model_count", None)
    if stored is None:
        stored = facts.model_count
    if not stored:
        if facts.declares_model:
            return NA, (
                f"{facts.model_count} model tanımlıyor ama hepsi AbstractModel — "
                "tablo ve kayıt yok, ACL satırı hiçbir yetki vermez"
            )
        return NA, "hiç model tanımlamıyor"
    if not facts.exists("security/ir.access.csv"):
        return FAIL, (
            f"{stored} tablolu model tanımlıyor ama security/ir.access.csv yok -> "
            "dosyayı ekleyin ve manifest `data` listesine koyun; ACL'siz model "
            "superuser dışında herkese kapalıdır ve arayüz sessizce boş görünür"
        )
    return PASS, ""


def rule_no_legacy_acl_records(facts):
    """`<record model="ir.rule">` / `"ir.model.access"` — iki model de yok."""
    hits = _grep_any(
        facts,
        ["security/**/*.xml", "data/**/*.xml", "demo/**/*.xml", "views/**/*.xml"],
        {
            r"""model\s*=\s*["']ir\.rule["']""": "ir.access (kural `domain` sütununa taşınır)",
            r"""model\s*=\s*["']ir\.model\.access["']""": "ir.access (`operation` sütunu)",
        },
    )
    if hits:
        return FAIL, "; ".join(hits[:5])
    return PASS, ""


def rule_manifest_data_exists(facts):
    """Manifest'in yüklediği her dosya diskte gerçekten var olmalı.

    Eksik bir girdi hiçbir testin yakalamadığı bir hatadır: müşterinin
    veritabanında başarısız kurulum olarak, çoğu zaman modül gönderildikten
    sonra ortaya çıkar. Ucuz, tam ve yanlış-pozitif biçimi yok.
    """
    missing = [rel for rel in _load_order(facts) if not facts.exists(rel)]
    if missing:
        return FAIL, (
            "manifest var olmayan dosya yüklüyor: "
            + ", ".join(missing[:5])
            + " -> dosyayı ekleyin ya da satırı manifest'ten çıkarın"
        )
    return PASS, ""


def rule_no_forward_xmlid_ref(facts):
    """Bir veri dosyası, DAHA SONRA yüklenen bir xmlid'i `ref()` ile gösteremez.

    `ref()` dosya AYRIŞTIRILIRKEN çözülür; ileri referans kurulumu o kayıtta
    öldürür — modül kurulamaz hâle gelir, üstelik hata mesajı "böyle bir xmlid
    yok" der ve sorunun SIRA olduğunu söylemez.

    Bu hata bu depoda bir kurulumu bozdu: bir veri dosyası manifest'te üstte
    duruyor ve üç dosya aşağıda tanımlanan bir güvenlik grubuna `ref()` ile
    bakıyordu.

    Kapsam:
      * yalnızca AYNI modülün nitelenmemiş id'leri; çapraz modül referansları
        Odoo'nun bağımlılık grafiğinin işidir, bu modülün sıralamasının değil;
      * iki `ref` biçimi de taranır: `ref="x"` özniteliği ve `eval` içindeki
        `ref('x')` çağrısı — ikincisi grup bağlamada en yaygın biçimdir ve
        yalnız birincisini arayan bir kontrol tam da bu depoyu bozan çağrıyı
        kaçırır;
      * karşılaştırma (dosya sırası, satır) ikilisiyle yapılır: aynı dosyanın
        ALTINDA tanımlanan bir id de ileri referanstır;
      * CSV'lerde yalnız `.../id` ile biten ilişkisel sütunlar taranır
        (`group_id/id`, `model_id/id`).
    """
    order = _load_order(facts)
    body: dict[str, str] = {}
    for rel in order:
        text = _read(facts, rel)
        if text is None:
            continue
        body[rel] = _clean(rel, text)

    def_rx = (
        re.compile(r"<record\b[^>]*\sid=[\"']([\w.]+)[\"']"),
        re.compile(r"<menuitem\b[^>]*\sid=[\"']([\w.]+)[\"']"),
        re.compile(r"<template\b[^>]*\sid=[\"']([\w.]+)[\"']"),
    )
    ref_rx = re.compile(r"""\bref\s*=\s*["']([\w.]+)["']|\bref\s*\(\s*["']([\w.]+)["']""")

    def _local(xid: str):
        """Bu modüle ait nitelenmemiş id, yoksa None."""
        if xid.startswith(facts.name + "."):
            xid = xid[len(facts.name) + 1:]
        return None if "." in xid else xid

    defined: dict[str, tuple[int, int]] = {}
    for index, rel in enumerate(order):
        text = body.get(rel)
        if text is None:
            continue
        if rel.endswith(".xml"):
            for pattern in def_rx:
                for match in pattern.finditer(text):
                    local = _local(match.group(1))
                    if local:
                        line = text.count("\n", 0, match.start()) + 1
                        defined.setdefault(local, (index, line))
        elif rel.endswith(".csv"):
            for line_no, row in _csv_rows(text):
                if line_no == 1 or not row:
                    continue
                local = _local(row[0].strip())
                if local:
                    defined.setdefault(local, (index, line_no))

    bad = []
    for index, rel in enumerate(order):
        text = body.get(rel)
        if text is None:
            continue
        used = []  # (satır, xmlid)
        if rel.endswith(".xml"):
            for match in ref_rx.finditer(text):
                xid = match.group(1) or match.group(2)
                used.append((text.count("\n", 0, match.start()) + 1, xid))
        elif rel.endswith(".csv"):
            columns: list[int] = []
            for line_no, row in _csv_rows(text):
                if line_no == 1:
                    columns = [i for i, head in enumerate(row) if head.strip().endswith("/id")]
                    continue
                for i in columns:
                    if i < len(row) and row[i].strip():
                        used.append((line_no, row[i].strip()))
        for line_no, xid in used:
            local = _local(xid)
            if not local or local not in defined:
                continue
            where = defined[local]
            if where > (index, line_no):
                bad.append(f"{rel}:{line_no} ref `{xid}` -> {order[where[0]]}:{where[1]}")
    if bad:
        return FAIL, (
            "ileri xmlid referansı (ref() ayrıştırma anında çözülür, kurulum düşer): "
            + "; ".join(bad[:3])
            + " -> tanımı manifest'te ÖNE alın (güvenlik/temel veri en üstte) ya da "
            "referans veren kaydı tanımın altına taşıyın"
        )
    return PASS, ""


def rule_menu_parent_no_action(facts):
    """`action=` taşıyan bir üst menü, çocuklarını dokunmatik cihazlarda
    ULAŞILMAZ yapar: hover yoktur, açılır menü yoktur; tıklama yalnızca gider.

    Yalnızca BU modülde tanımlanan üst/alt çiftleri değerlendirilir; başka bir
    addon'da duran bir üst menü asla yanlış-pozitif üretemez.
    """
    offenders = sorted(getattr(facts, "menu_parents_with_action", ()) or ())
    if offenders:
        return FAIL, (
            "üst menüde action= var (çocuklar dokunmatikte ulaşılmaz): "
            + ", ".join(offenders[:5])
            + " -> `action` özniteliğini üst <menuitem>'dan kaldırın ve en sık "
            "kullanılan girişi sequence=10 ile bir yaprak menü yapın. Aynı xmlid "
            "daha önce kurulduysa XML'den silmek yetmez; <record model=\"ir.ui.menu\"> "
            "ile `action`'ı eval=\"False\" yapın"
        )
    return PASS, ""


def rule_single_web_icon(facts):
    icons = sorted(getattr(facts, "web_icon_menus", ()) or ())
    if len(icons) > 1:
        return FAIL, (
            "birden fazla üst düzey <menuitem> web_icon= taşıyor (uygulama "
            "başlatıcıda kopya ikon): "
            + ", ".join(icons)
            + " -> yalnız birinde bırakın, diğerlerini bir üst menüye bağlayın"
        )
    return PASS, ""


def rule_deprecated_python(facts):
    hits = _grep_any(facts, ["**/*.py"], DEPRECATED_PYTHON)
    if hits:
        return FAIL, "; ".join(hits[:5])
    return PASS, ""


def rule_deprecated_python_weak(facts):
    """RATCHET tablosunun daha az kesin kardeşi — bkz. DEPRECATED_PYTHON_WEAK."""
    hits = _grep_any(facts, ["**/*.py"], DEPRECATED_PYTHON_WEAK)
    if hits:
        return FAIL, "; ".join(hits[:5])
    return PASS, ""


def rule_deprecated_view(facts):
    hits = _grep_any(
        facts,
        ["views/**/*.xml", "report/**/*.xml", "reports/**/*.xml", "wizard/**/*.xml"],
        DEPRECATED_VIEW,
    )
    if hits:
        return FAIL, "; ".join(hits[:5])
    return PASS, ""


def rule_asset_bundles(facts):
    """19.4'te yanlış olan paket ADLARINI işaretle, onları HECELEYEN harfleri değil.

    Bu kontrol eskiden manifest kaynağında düz alt-dize araması yapıyordu ve
    iki yanlış-pozitif üretiyordu, karşılığında tek bir gerçek yakalama yoktu:

      * bir paketi KULLANMAYIN diye yazılmış yorum, o paketin kullanımı sayıldı;
      * bir paket adı diğerinin ön ekiyse (…_lazy), doğru paketi yeni benimsemiş
        her modül, tam da geçtiği paket yüzünden işaretlendi.

    İkisi de, metin yerine BİLDİRİLEN ANAHTARLAR okunduğu an yok olur. XML
    tarafında da tam-token eşleşmesi kullanılır.
    """
    bad = []
    declared = set(facts.manifest.get("assets") or {})
    for bundle, replacement in BAD_ASSET_BUNDLES.items():
        if bundle in declared:
            bad.append(f"__manifest__.py assets: `{bundle}` -> `{replacement}`")

    # Paketler XML'den de genişletilir: <template inherit_id="...">.
    xml_patterns = {
        rf"(?<![\w.]){re.escape(bundle)}(?![\w])": replacement
        for bundle, replacement in BAD_ASSET_BUNDLES.items()
    }
    bad.extend(_grep_any(facts, ["**/*.xml"], xml_patterns))

    if bad:
        return FAIL, (
            "; ".join(bad[:5])
            + " -> 19.4'te böyle bir paket YOK; var olmayan pakete yazmak hata vermez, "
            "sessizce hiçbir şey yapmaz ve dosyanız hiçbir sayfaya girmez"
        )
    return PASS, ""


def rule_owl3_template_attrs(facts):
    hits = _grep_any(facts, ["static/src/**/*.xml"], OWL3_TEMPLATE_ATTRS)
    if hits:
        return FAIL, (
            "; ".join(hits[:5])
            + " -> OWL3 şablon derleyicisi eski adları tanımaz; kurulum yeşil geçer, "
            "bileşen ÇALIŞMA ANINDA 'Ref is undefined or null' ile patlar"
        )
    return PASS, ""


def rule_i18n_pot(facts):
    if not facts.has_translatable_source:
        return NA, "çevrilebilir kaynak dize yok"
    if not facts.exists(f"i18n/{facts.name}.pot"):
        return FAIL, (
            f"i18n/{facts.name}.pot yok -> canlı veritabanından yeniden üretin "
            "(odoo-bin i18n export). Bayat/eksik .pot, .po çevirilerini SESSİZCE "
            "düşürür: yükleyici .pot'u koşulsuz merge eder ve .pot'ta olmayan msgid "
            "obsolete sayılır"
        )
    return PASS, ""


def _po_rule(lang):
    def check(facts):
        if not facts.has_translatable_source:
            return NA, "çevrilebilir kaynak dize yok"
        if not facts.exists(f"i18n/{lang}.po"):
            return FAIL, (
                f"i18n/{lang}.po yok -> .pot'tan üretin "
                f"(msgmerge --update --backup=none i18n/{lang}.po i18n/{facts.name}.pot) "
                "ve kaynak dizeyle AYNI commit'te gönderin; sonraya bırakılan çeviri "
                "kalıcı İngilizce sızıntısıdır"
            )
        return PASS, ""

    check.__name__ = f"rule_i18n_{lang}"
    return check


def rule_tests_present(facts):
    if not facts.declares_model and not facts.declares_action:
        return NA, "test edilecek Python davranışı yok"
    if facts.test_count == 0:
        return FAIL, (
            "tests/ dizini yok ya da hiç test_* fonksiyonu yok -> tests/__init__.py + "
            "tests/test_<konu>.py ekleyin (TransactionCase). WARN: test sayısı "
            "kapsamı kanıtlamaz, yokluğu ise kesindir"
        )
    return PASS, ""


def rule_no_foreign_brand_in_data(facts):
    """Gönderilen veri, bu projeye ait olmayan bir markayı adlandırmamalı.

    Manifest'in `data` anahtarındaki dosyalar HER kuruluma iner. Başka bir
    projeden kopyalanmış bir şablonun içindeki yabancı marka; e-posta şablonu
    adında, banner metninde ya da seed edilmiş bir metinde müşterinin sitesinde
    yayına çıkar. Bu gerçekten yaşandı: bir gönderi etiketi ön ayarı, bir
    şirketi başka bir şirketin kolilerinin göndericisi olarak bastı.

    WARN, RATCHET değil: aynı dize, tarihçeyi açıklayan bir yorumda meşru olarak
    geçebilir ve ikisini yalnız insan ayırt eder.
    """
    if not FOREIGN_BRANDS:
        return NA, "FOREIGN_BRANDS listesi boş — kural yapılandırılmadı (rules.py)"
    loaded = [f for f in _load_order(facts) if f.endswith((".xml", ".csv"))]
    hits = []
    for rel in loaded:
        text = _read(facts, rel)
        if text is None:
            continue
        stripped = _clean(rel, text)
        for name in FOREIGN_BRANDS:
            for match in re.finditer(re.escape(name), stripped, re.I):
                line = stripped.count("\n", 0, match.start()) + 1
                hits.append(f"{rel}:{line} {match.group(0)}")
    if hits:
        return FAIL, (
            f"{len(hits)} yabancı marka eşleşmesi: "
            + "; ".join(hits[:3])
            + " -> dizeyi bu projenin adıyla değiştirin ya da kaydı müşteriye özel "
            "bir modüle taşıyın"
        )
    return PASS, ""


# --------------------------------------------------------------------------
# Kural kaydı
# --------------------------------------------------------------------------


def _exempt_aware(rule_id, check):
    """Muafiyet kontrolünü her kuralın önüne tak.

    Kural gövdelerine tek tek yazmak yerine burada sarmalanır: böylece yeni bir
    kural muafiyet mekanizmasını UNUTAMAZ ve gerekçe her zaman rapora basılır.
    """

    def wrapped(facts):
        reason = exemption_reason(facts.name, rule_id)
        if reason:
            return NA, f"muafiyet: {reason}"
        return check(facts)

    wrapped.__name__ = getattr(check, "__name__", rule_id)
    wrapped.__doc__ = check.__doc__
    return wrapped


# (id, şiddet, fonksiyon, tek satırlık açıklama)
_RULES_RAW = [
    # -- manifest ve kurulum bütünlüğü -------------------------------------
    ("manifest_version", RATCHET, rule_manifest_version, "sürüm saas~19.4.X.Y.Z"),
    ("manifest_data_exists", RATCHET, rule_manifest_data_exists, "manifest yalnız var olan dosyaları yükler"),
    ("no_forward_xmlid_ref", RATCHET, rule_no_forward_xmlid_ref, "sonra yüklenen xmlid'e ref() yok"),
    # -- güvenlik ----------------------------------------------------------
    ("security_file_modern", RATCHET, rule_security_file_modern, "eski ir.model.access.csv yok"),
    ("security_acl_present", RATCHET, rule_security_acl_present, "tanımlı modellerin ACL'i var"),
    ("no_legacy_acl_records", RATCHET, rule_no_legacy_acl_records, "ir.rule / ir.model.access kaydı yok"),
    # -- 19.4 API ve sözdizimi ---------------------------------------------
    ("deprecated_python", RATCHET, rule_deprecated_python, "kaldırılan/yeniden adlandırılan 19.4 Python API'si yok"),
    ("deprecated_view", RATCHET, rule_deprecated_view, "<tree> / attrs= yok"),
    ("asset_bundles", RATCHET, rule_asset_bundles, "19.4'te var olan varlık paketi adları"),
    ("owl3_template_attrs", RATCHET, rule_owl3_template_attrs, "t-custom-ref / t-out / t-custom-model"),
    # -- kullanıcı arayüzü -------------------------------------------------
    ("menu_parent_no_action", RATCHET, rule_menu_parent_no_action, "üst menüde action= yok"),
    ("single_web_icon", RATCHET, rule_single_web_icon, "tek uygulama başlatıcı ikonu"),
    # -- i18n --------------------------------------------------------------
    ("i18n_pot", RATCHET, rule_i18n_pot, "çeviri şablonu (.pot) var"),
]
_RULES_RAW += [
    (f"i18n_{lang}", RATCHET, _po_rule(lang), f"{lang}.po var") for lang in I18N_LANGS
]
_RULES_RAW += [
    # -- WARN: zayıf vekiller, asla bloklamaz ------------------------------
    ("deprecated_python_weak", WARN, rule_deprecated_python_weak, "muhtemelen eskimiş Python çağrıları"),
    ("tests_present", WARN, rule_tests_present, "modülün testi var"),
    ("no_foreign_brand_in_data", WARN, rule_no_foreign_brand_in_data, "gönderilen veride yabancı marka yok"),
]

RULES = [
    (rule_id, severity, _exempt_aware(rule_id, check), description)
    for rule_id, severity, check, description in _RULES_RAW
]

RATCHET_RULE_IDS = [r[0] for r in RULES if r[1] == RATCHET]


# --------------------------------------------------------------------------
# Bu projeye HENÜZ uymayan kurallar
# --------------------------------------------------------------------------
#
# Aşağıdakiler kaynak portföyde RATCHET/WARN olarak çalışıyordu ama hepsi
# PAYLAŞILAN bir altyapı modülünü varsayar: ortak bir AI/MCP köprüsü, ortak bir
# güvenlik temeli, ortak bir yardım/tur temeli. Tek bir webshop'ta böyle bir
# temel yok; bu kuralları bugün açmak, karşılığı olmayan bir borç raporlar ve
# kapıyı gürültüye boğar — yani kapıyı kapattırır.
#
# Bu depo ikinci bir siteyle paylaşılan bir temel modül kazandığı gün (örneğin
# <PREFIX>_security_base, <PREFIX>_help_base, <PREFIX>_mcp_bridge), her biri
# tek tek ve WARN olarak geri açılır; kesinliği ölçüldükçe RATCHET'e terfi eder.
#
#   no_bridge_hard_dep     -- köprü modülü `depends`'te SERT bağımlılık olarak
#                             geçmesin; geçtiği sürüm, köprü kaldırıldığında
#                             tüm yığını zincirleme kaldırıyordu.
#   depends_security_base  -- her modül ortak güvenlik kategorisini taşıyan
#                             temel modüle bağlı olsun (grup kategorisi tek
#                             yerde tanımlansın).
#   soft_import_guard      -- köprüden yapılan her import try/except ImportError
#                             içinde olsun; köprü kurulu değilken modül yine de
#                             yüklensin (graceful degradation).
#   ai_tool_surface        -- public `action_*` metotları @ai_tool ile
#                             dekore edilsin; dekore edilmemiş modül her AI/MCP
#                             istemcisine görünmezdir.
#   action_mcp_pairing     -- bildirim sözlüğü döndüren `action_*` metotlarının
#                             JSON döndüren `action_mcp_*` eşleri olsun (zayıf
#                             vekil: eşleşme her zaman 1:1 değildir).
#   help_tutorials         -- kullanıcıya dönük modül bir "Yardım ve Örnekler"
#                             kartı göndersin (data/tutorials.xml).
#   help_tour              -- o kartın arkasında en az bir çalışan etkileşimli
#                             tur olsun; kaynak sayımda 27 kart turu olmayan
#                             boş kabuktu ve kural tam da bunun için vardı.
#
# Aynı rafta bekleyen, altyapı gerektirmeyen ama yanlış-pozitif oranı henüz
# ölçülmemiş adaylar (WARN olarak açılabilir): SCSS içinde karışık birimli
# `min()` / `max()` (libsass derleme anında değerlendirir, TÜM frontend paketi
# düşer); `odoo.define(` / `useService("rpc")` / `useState` importu gibi 19.4
# öncesi JS desenleri; her `<list>` görünümünde `<help>` boş-durum bloğu.
