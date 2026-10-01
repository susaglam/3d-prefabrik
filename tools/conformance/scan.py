#!/usr/bin/env python3
"""Statik temel-uyum tarayıcısı — bu deponun Odoo saas~19.4 modülleri için.

Salt okunur. Veritabanına dokunmaz, **Odoo'nun kurulu olmasını gerektirmez**,
ağa çıkmaz ve hiçbir modüle yazmaz. Tek girdisi diskteki dosyalardır.

Bu üç kısıt tesadüf değil, tasarımın kendisidir:

* **Odoo gerekmez.** Uyum kontrolü, Odoo'yu ayağa kaldırmanın mümkün olmadığı
  yerlerde de çalışmak zorunda: bir dağıtım kancasının içinde, CI'da, yeni
  klonlanmış bir çalışma kopyasında. `import odoo` yazan bir denetleyici, tam
  da en çok ihtiyaç duyulduğu anda çalışmayan bir denetleyicidir.
* **Veritabanı gerekmez.** Kaynak dosya diskte yanlışsa canlıya gitmeden önce
  yanlıştır; sorunun canlıda görünmesini beklemek kontrolü işe yaramaz kılar.
* **Ağ gerekmez.** Ağ gerektiren kontrol, ağ kesildiğinde sessizce "geçti"
  demeye başlar. Yanlış "geçti", "hiç kontrol yok"tan daha zararlıdır.

Kullanım
========
    python tools/conformance/scan.py --module vd_site_base
    python tools/conformance/scan.py --all
    python tools/conformance/scan.py --all --write-lock
    python tools/conformance/scan.py --module vd_site_base --json

Çıkış kodları
=============
0  tarama tamamlandı (bulgular veridir, hata değil — engellemek gate.py'nin işi)
1  kullanım hatası / modül bulunamadı

Bulgu neden hata değil
======================
Bu script bir şey **ölçer**; ölçtüğü şeye göre karar vermek `gate.py`'nin işi.
Ayrımı yıkarsanız — yani tarayıcı bulgu görünce 1 ile çıkarsa — tarayıcıyı
CI'da veya bir kancada çağıran her yerde "bulgu var" ile "script çöktü" aynı
sinyale düşer ve ikisi birbirinden ayırt edilemez. Kurulduğu gün açık bulgusu
olan bir depoda böyle bir tarayıcı ilk hafta içinde kapatılır.

Kural dosyası
=============
Kuralların kendisi `rules.py` içindedir; bu dosya sadece **olguları toplar**
(`ModuleFacts`), kuralları çalıştırır ve raporlar. Yeni bir kural yazmak için
bu dosyaya dokunmanız gerekmez — olgu eksikse buraya bir alan eklenir.
"""

from __future__ import annotations

import argparse
import ast
import fnmatch
import json
import os
import re
import sys
from pathlib import Path


def _konsolu_utf8_yap() -> None:
    """Windows konsolunu UTF-8'e çevirir.

    Windows'ta Python'un stdout kodlaması varsayılan olarak cp1252'dir; Türkçe
    karakter içeren ilk `print` çağrısı `UnicodeEncodeError` ile düşer. Hata
    işin sonunda değil, ÇIKTI YAZILIRKEN oluşur: tarama bitmiş, bulgular
    hesaplanmış, ama script hata koduyla çıkar. Bir dağıtım kancasının içinde
    bu, sağlıklı bir kontrolü çökmüş gibi gösterir.

    `scripts/proje_config.py` aynı düzeltmeyi taşır. Burada kasıtlı olarak
    kopyalanmıştır: `tools/` ağacı `scripts/` ağacına bağımlı olmamalı, çünkü
    bu tarayıcının tek ön koşulu "Python var" olmalı.
    """
    for akis in (sys.stdout, sys.stderr):
        yeniden_yapilandir = getattr(akis, "reconfigure", None)
        if yeniden_yapilandir is not None:
            try:
                yeniden_yapilandir(encoding="utf-8", errors="replace")
            except (ValueError, OSError):
                # Akış yönlendirilmiş veya kapalıysa sessizce geç: konsol
                # kodlaması yüzünden hiçbir kontrol ölmemeli.
                pass


_konsolu_utf8_yap()

sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    import rules  # noqa: E402
    from rules import (  # noqa: E402
        FAIL,
        NA,
        PASS,
        RATCHET,
        RULES,
    )
except ImportError as _hata:  # pragma: no cover - kurulum hatası
    sys.stderr.write(
        f"tools/conformance/rules.py yüklenemedi: {_hata}\n"
        "NEDEN önemli: kurallar orada tanımlıdır; bu dosya yalnızca olguları\n"
        "toplayıp onları çalıştırır, tek başına hiçbir şey denetlemez.\n"
        "NASIL düzeltilir: rules.py'nin bu dizinde durduğundan emin olun\n"
        "(tools/conformance/rules.py) ve içinde PASS/FAIL/NA/RATCHET/RULES\n"
        "adlarının tanımlı olduğunu doğrulayın.\n"
    )
    raise SystemExit(1) from _hata

# tools/conformance/scan.py -> tools/conformance -> tools -> depo kökü
REPO_ROOT = Path(__file__).resolve().parents[2]

# Depo düzeni TEK yerde tanımlıdır: `rules.py`. Buraya "addons" yazmak ikinci
# bir doğruluk kaynağı yaratırdı ve iki kaynak er geç çelişir — üstelik çelişki
# sessizdir: tarayıcı bir yere, kurallar başka yere bakar ve sonuç "hiç modül
# yok" olur. `getattr` ile okunur ki sabiti taşımayan eski bir `rules.py` de
# çalışsın (eksik bir parça sistemi düşürmez).
ADDONS_ROOT = REPO_ROOT / getattr(rules, "ADDONS_DIR", "addons")

# Kendi modüllerimizin ön eki. Boş bırakılırsa süzme yapılmaz.
MODULE_PREFIX = getattr(rules, "MODULE_PREFIX", "")

LOCK_PATH = REPO_ROOT / "conformance.lock.json"

MENUITEM_RX = re.compile(r"<menuitem\b([^>]*?)/?>", re.S)
ATTR_RX = re.compile(r"""(\w[\w:.-]*)\s*=\s*["']([^"']*)["']""")


class ModuleFacts:
    """Kuralların ihtiyaç duyduğu her şey, modül başına bir kez toplanır.

    Dosyalar tembel okunur ve önbelleğe alınır: 200 dosyalı bir modülde kaç
    kural soru sorarsa sorsun her dosya diskten **bir kez** okunur.

    Kuralların kullanabileceği olgu yüzeyi
    ======================================
    Bir kural yalnızca burada tanımlı alanlara dokunmalıdır. Var olmayan bir
    alana dokunan kural `AttributeError` alır; tarama bundan ölmez ama o kural
    raporda **HATA** olarak görünür (aşağıdaki `scan_module`'a bakın) — sessiz
    bir muafiyet değil, görünür bir arıza.

        name, path, manifest, manifest_source, depends
        model_count, declares_model
        stored_model_count, declares_stored_model  (AbstractModel HARİÇ)
        action_count, declares_action
        test_count
        has_user_facing_xml, is_user_facing, has_translatable_source
        menu_parents_with_action, web_icon_menus
        read(rel) / _read(rel), exists(rel), iter_files(globs)

    Kaynak portföyde bulunan `is_infra` alanı BİLEREK yoktur. O alan, paylaşılan
    bir yardım/köprü temel modülünü varsayan kuralların (rehber turları, AI
    aracı yüzeyi) altyapı modüllerini muaf tutması içindi. Bu şablonda öyle bir
    paylaşılan temel yok; olmayan bir kuralı besleyen olgu, ilk okuyanı yanlış
    yönlendiren ölü koddur.
    """

    def __init__(self, path: Path):
        self.path = path
        self.name = path.name
        self._file_cache: dict[str, str] = {}
        self._all_files: list[str] | None = None

        self.manifest_source = self._read("__manifest__.py") or ""
        self.manifest = self._parse_manifest(self.manifest_source)
        self.depends = list(self.manifest.get("depends") or [])

        py_text = self._concat(["**/*.py"], skip_tests=True)
        self.model_count, self.stored_model_count = self._analyse_models()
        self.declares_model = self.model_count > 0
        self.declares_stored_model = self.stored_model_count > 0

        self.action_count = len(re.findall(r"^\s*def\s+(action_\w+)", py_text, re.M))
        self.declares_action = self.action_count > 0

        self.test_count = len(
            re.findall(r"^\s*def\s+test_\w+", self._concat(["tests/**/*.py"]), re.M)
        )

        # Bir modülün kullanıcıya bakan yüzeyi her zaman `views/` altında
        # değildir. Website modülleri her şeyi `data/` içinde `<template>` ve
        # `website.page` kaydı olarak taşıyabilir. Yüzeyi yalnızca `views/`
        # varlığından çıkaran bir tarayıcı böyle bir modülü tüm i18n
        # kurallarından muaf tutar — ve bunu sessizce yapar.
        #
        # **Yanlış NA, yanlış FAIL'den kötüdür:** yanlış FAIL görülür ve
        # tartışılır, yanlış NA hiç görünmez.
        surface_xml = self._concat(
            ["views/**/*.xml", "data/**/*.xml", "templates/**/*.xml"]
        )
        self.has_user_facing_xml = bool(
            re.search(
                r"""<template\b|<menuitem\b|<field\s+name=["']arch"""
                r"""|model=["'](?:website\.page|portal\.entry|mail\.template)["']""",
                surface_xml,
            )
        )
        has_views = bool(self._glob(["views/**/*.xml"]))

        self.has_translatable_source = (
            bool(re.search(r"\b_\(|string\s*=\s*['\"]|help\s*=\s*['\"]", py_text))
            or has_views
            or self.has_user_facing_xml
        )

        self.is_user_facing = has_views or self.has_user_facing_xml

        self.menu_parents_with_action, self.web_icon_menus = self._analyse_menus()

    # -- dosya erişimi -----------------------------------------------------

    def _read(self, rel: str) -> str | None:
        if rel in self._file_cache:
            return self._file_cache[rel]
        full = self.path / rel
        if not full.is_file():
            return None
        # errors="replace": bozuk kodlamalı tek bir dosya tüm taramayı
        # düşürmemeli. Kural yine de metni görür, sadece o bayt kaybolur.
        text = full.read_text(encoding="utf-8", errors="replace")
        self._file_cache[rel] = text
        return text

    def read(self, rel: str) -> str | None:
        """`_read`'in genel adı. Yeni kurallar bunu kullansın."""
        return self._read(rel)

    def _list_all(self) -> list[str]:
        if self._all_files is None:
            found = []
            for root, dirs, files in os.walk(self.path):
                dirs[:] = [
                    d for d in dirs if d not in {"__pycache__", ".git", "node_modules"}
                ]
                for name in files:
                    rel = os.path.relpath(os.path.join(root, name), self.path)
                    # Windows'ta ayraç `\`; kural globları POSIX yazılır.
                    found.append(rel.replace("\\", "/"))
            self._all_files = found
        return self._all_files

    def _glob(self, globs: list[str]) -> list[str]:
        out = []
        for rel in self._list_all():
            for pattern in globs:
                # fnmatch `**` işaretini sıradan bir joker gibi ele alır; burada
                # istenen tam olarak budur: '**/*.py' hem 'a.py' hem 'x/y/a.py'
                # eşleşsin. İkinci deneme (`**/` atılmış hâli) kök seviyesindeki
                # dosyalar içindir.
                if fnmatch.fnmatch(rel, pattern) or fnmatch.fnmatch(
                    rel, pattern.replace("**/", "")
                ):
                    out.append(rel)
                    break
        return out

    def iter_files(self, globs: list[str]):
        for rel in self._glob(globs):
            text = self._read(rel)
            if text is not None:
                yield rel, text

    def _concat(self, globs: list[str], skip_tests: bool = False) -> str:
        parts = []
        for rel, text in self.iter_files(globs):
            if skip_tests and (rel.startswith("tests/") or "/tests/" in rel):
                continue
            parts.append(text)
        return "\n".join(parts)

    def exists(self, rel: str) -> bool:
        return (self.path / rel).is_file()

    # -- ayrıştırma --------------------------------------------------------

    def _analyse_models(self) -> tuple[int, int]:
        """(bildirilen model sayısı, TABLOSU OLAN model sayısı).

        Ayrım tek bir kural için var ama o kural cırcırlıdır, yani ENGELLEYEBİLİR:
        ACL kontrolü. `models.AbstractModel`'in tablosu ve kaydı yoktur; bir
        `ir.access` satırı ona hiçbir şey vermez, satırın yokluğu da hiçbir şeyi
        kapatmaz. Sayımı `_name` üzerinden regex'le yapmak üçünü tek torbaya
        atıyordu ve yalnızca soyut model tanımlayan bir modül, gerekmeyen bir ACL
        dosyası istendiği için DÜŞÜYORDU.

        Bu, tam olarak kapıyı öldüren yanlış alarm sınıfı: bu depodaki
        `vd_site_base/models/asset_routes.py` bir AbstractModel'dir ve kendi
        docstring'inde "tablosu yoktur, kaydı yoktur, dolayısıyla erişim kuralı
        da gerektirmez" yazar. Tarayıcı, yanında durduğu modülle çelişiyordu;
        modül bugün geçiyorsa bunun sebebi ALAKASIZ bir satır (`website.menu`)
        taşıyan bir ACL dosyasının bulunmasıdır — yani doğru sonuç, yanlış
        gerekçeyle.

        Sınıflandırma AST ile yapılır çünkü soru sınıfın TABANIDIR ve taban,
        birleştirilmiş metinde regex'le güvenilir biçimde `_name`'e bağlanamaz.
        Ayrıştırılamayan bir dosyada regex'e düşülür ve bulunan her model
        TABLOLU sayılır: belirsizlikte sıkı taraf seçilir, çünkü yanlış FAIL
        görülüp tartışılır, yanlış NA hiç görünmez.
        """
        soyut_tabanlar = {"AbstractModel"}
        toplam = stored = 0

        for rel, text in self.iter_files(["**/*.py"]):
            if rel.startswith("tests/") or "/tests/" in rel:
                continue
            try:
                tree = ast.parse(text)
            except (SyntaxError, ValueError):
                bulunan = len(re.findall(r"^\s*_name\s*=\s*['\"]", text, re.M))
                toplam += bulunan
                stored += bulunan
                continue

            for node in ast.walk(tree):
                if not isinstance(node, ast.ClassDef):
                    continue
                if not any(self._assigns_name(stmt) for stmt in node.body):
                    # `_name` yoksa mevcut bir modelin uzantısıdır (`_inherit`);
                    # ACL'i tanımlandığı yerden gelir, burada aranmaz.
                    continue
                toplam += 1
                tabanlar = {
                    base.attr if isinstance(base, ast.Attribute) else getattr(base, "id", "")
                    for base in node.bases
                }
                if not tabanlar & soyut_tabanlar:
                    stored += 1

        return toplam, stored

    @staticmethod
    def _assigns_name(stmt) -> bool:
        """Sınıf gövdesindeki bir ifade `_name = "..."` mi?"""
        if isinstance(stmt, ast.Assign):
            return any(
                isinstance(target, ast.Name) and target.id == "_name"
                for target in stmt.targets
            )
        if isinstance(stmt, ast.AnnAssign):
            return isinstance(stmt.target, ast.Name) and stmt.target.id == "_name"
        return False

    @staticmethod
    def _parse_manifest(source: str) -> dict:
        """Manifest saf bir sözlük değişmezidir.

        Ayrıştırılamayan bir manifest hata FIRLATMAZ, boş sözlüğe düşer:
        tek bozuk manifest yüzünden tüm portföy taraması durmamalı. Boş
        sözlük zaten kuralların çoğunu FAIL yapar, yani sorun kaybolmaz —
        sadece diğer modüllerin raporunu yemez.
        """
        if not source.strip():
            return {}
        try:
            tree = ast.parse(source)
            for node in ast.walk(tree):
                if isinstance(node, ast.Dict):
                    return ast.literal_eval(node)
        except (SyntaxError, ValueError):
            pass
        return {}

    def _analyse_menus(self) -> tuple[set[str], set[str]]:
        """`action=` taşıyan ebeveyn menüleri bulur ve başlatıcı ikonlarını sayar.

        Yalnızca BU modülde tanımlı ebeveyn/çocuk çiftleri sayılır; ebeveyni
        başka bir eklentide duran bir menü asla işaretlenemez. Aksi hâlde
        `website.menu` gibi çekirdek bir ebeveyne asılan her modül, kendi
        yazmadığı bir kaydın hatasıyla suçlanırdı.

        Bilinen sınır: `parent="modul.menu_id"` ifadesinde yalnızca son parça
        karşılaştırılır, yani iki farklı modülde aynı adı taşıyan menüler
        karışabilir. Depo başına birkaç modül ölçeğinde bu pratikte olmaz;
        olursa sonuç yanlış FAIL'dir (görünür), yanlış NA değil (sessiz).
        """
        menus: dict[str, dict[str, str]] = {}
        referenced_as_parent: set[str] = set()

        for _rel, text in self.iter_files(["views/**/*.xml", "data/**/*.xml"]):
            for match in MENUITEM_RX.finditer(text):
                attrs = dict(ATTR_RX.findall(match.group(1)))
                menu_id = attrs.get("id")
                if menu_id:
                    menus[menu_id] = attrs
                parent = attrs.get("parent")
                if parent:
                    referenced_as_parent.add(parent.split(".")[-1])

        parents_with_action = {
            menu_id
            for menu_id, attrs in menus.items()
            if menu_id in referenced_as_parent and attrs.get("action")
        }
        launcher_icons = {
            menu_id
            for menu_id, attrs in menus.items()
            if attrs.get("web_icon") and not attrs.get("parent")
        }
        return parents_with_action, launcher_icons


def scan_module(path: Path) -> dict:
    """Bir modülü tarar ve rapor sözlüğü döndürür."""
    facts = ModuleFacts(path)
    results = {}
    for rule_id, severity, check, description in RULES:
        rule_error = False
        try:
            status, detail = check(facts)
        except Exception as exc:
            # Bozuk bir kural taramayı düşürmemeli. Ama sonucu sessizce NA'ya
            # gömmek de olmaz: NA "bu modüle uygulanmaz" demektir ve bir kural
            # hatası bunu söylemez. Bu yüzden ayrı bir bayrakla işaretlenir ve
            # raporda HATA olarak basılır.
            status, detail, rule_error = NA, f"kural hatası: {type(exc).__name__}: {exc}", True
        results[rule_id] = {
            "status": status,
            "severity": severity,
            "detail": detail,
            "description": description,
            "rule_error": rule_error,
        }

    ratchet = [r for r in results.values() if r["severity"] == RATCHET]
    applicable = [r for r in ratchet if r["status"] != NA]
    passed = [r for r in applicable if r["status"] == PASS]

    return {
        "module": facts.name,
        "version": facts.manifest.get("version", ""),
        "classification": {
            "is_user_facing": facts.is_user_facing,
            "declares_model": facts.declares_model,
            "declares_action": facts.declares_action,
            "model_count": facts.model_count,
            "stored_model_count": facts.stored_model_count,
            "action_count": facts.action_count,
            "test_count": facts.test_count,
        },
        "score": [len(passed), len(applicable)],
        "rules": results,
    }


def module_roots() -> list[Path]:
    """Modüllerin aranacağı dizinler.

    `addons/` varsa odur; yoksa depo kökü. İkisi birden taranmaz — aynı modül
    iki kez raporlanırsa kilit dosyası da iki kez yazılır ve kapı hangi kaydı
    okuyacağını bilemez.
    """
    if ADDONS_ROOT.is_dir():
        return [ADDONS_ROOT]
    return [REPO_ROOT]


_ONEK_UYARISI_VERILDI = False


def find_modules(include_foreign: bool = False) -> list[Path]:
    """Taranacak modül dizinleri.

    Bir dizin, `__manifest__.py` taşıyorsa modüldür. Bunlardan yalnızca
    `MODULE_PREFIX` ile başlayanlar taranır: `addons/` altına kopyalanmış
    üçüncü taraf bir eklenti bizim kurallarımızla ölçülemez — sürüm biçimi,
    i18n düzeni ve varlık paketleri bizim değil, onu yazanın kararıdır. Süzme
    olmasaydı her yabancı eklenti tabloya kalıcı borç eklerdi ve tablo, tam da
    okunmaz hâle geldiği için okunmaz olurdu.

    Ama önek süzmesinin kendi tuzağı var: önek değişirse tarayıcı SIFIR modül
    bulur ve "her şey temiz" der. Bu yüzden süzme sonucu boşsa ama diskte modül
    varsa, sessizce sıfır dönmek yerine stderr'e yazılır ve hepsi taranır.
    Gürültü, sahte temizlikten iyidir.
    """
    global _ONEK_UYARISI_VERILDI

    found: dict[str, Path] = {}
    for root in module_roots():
        if not root.is_dir():
            continue
        for p in sorted(root.iterdir()):
            if p.is_dir() and (p / "__manifest__.py").is_file() and p.name not in found:
                found[p.name] = p
    hepsi = [found[name] for name in sorted(found)]

    if include_foreign or not MODULE_PREFIX:
        return hepsi

    kendi = [p for p in hepsi if p.name.startswith(MODULE_PREFIX)]
    if kendi or not hepsi:
        return kendi
    if not _ONEK_UYARISI_VERILDI:
        _ONEK_UYARISI_VERILDI = True
        print(
            f"uyarı: {MODULE_PREFIX!r} ön ekli modül yok, ama {len(hepsi)} modül "
            "bulundu — hepsi taranıyor.\n"
            "Ön ek değiştiyse rules.py içindeki MODULE_PREFIX'i güncelleyin.",
            file=sys.stderr,
        )
    return hepsi


def resolve_module(name_or_path: str) -> Path | None:
    """Modül adını ya da yolunu bir dizine çevirir; bulamazsa None."""
    candidate = Path(name_or_path)
    if candidate.is_dir() and (candidate / "__manifest__.py").is_file():
        return candidate.resolve()
    # `addons/vd_site_base` gibi depo-göreli bir yol da kabul edilir.
    for base in [*module_roots(), REPO_ROOT]:
        p = base / name_or_path
        if (p / "__manifest__.py").is_file():
            return p
    return None


def format_report(report: dict) -> str:
    """Tek modül için okunur metin raporu.

    GEÇEN kontroller basılmaz — bir raporun değeri yapılacak işi göstermesinde,
    yapılmış işi tekrar saymasında değil. Kural HATASI basılır: o bir muafiyet
    değil, arızadır.

    NA DA BASILIR, gerekçesiyle birlikte. Bu, eskiden iki dosyanın birbiriyle
    çeliştiği yerdi: `rules.py` "her NA'nın yazılı bir gerekçesi vardır ve rapora
    o gerekçe basılır" diye söz veriyor, muafiyet mekanizması da gerekçenin
    "gizli değil, görünür bir borç" olduğunu yazıyordu — ama burası NA'yı PASS
    ile aynı torbaya atıp eliyordu. Sonuç, tam da tasarımın en çok korktuğu şey:
    yapılandırılmamış bir kural (`FOREIGN_BRANDS` boş) ile gerçekten geçen bir
    kural metin raporunda AYNI görünüyordu. 18 kuralda bu birkaç satır tutar;
    sessiz muafiyetin bedeli ise sınırsızdır.
    """
    passed, total = report["score"]
    lines = [f"{report['module']}  temel {passed}/{total}  ({report['version']})"]
    na_lines = []
    for rule_id, result in report["rules"].items():
        if result.get("rule_error"):
            lines.append(f"  [HATA] {rule_id}: {result['detail']}")
            continue
        if result["status"] == PASS:
            continue
        if result["status"] == NA:
            na_lines.append(f"  [NA]    {rule_id}: {result['detail']}")
            continue
        mark = "DÜŞTÜ" if result["severity"] == RATCHET else "uyarı"
        lines.append(f"  [{mark}] {rule_id}: {result['detail']}")
    if len(lines) == 1:
        lines.append("  uygulanan tüm kontroller geçti")
    return "\n".join(lines + na_lines)


def build_lock(reports: list[dict]) -> dict:
    """Cırcır (ratchet) taban çizgisi.

    Yalnızca RATCHET kuralların durumu yazılır: kilit dosyasının tek işi,
    "bu kontrol daha önce geçiyor muydu?" sorusuna cevap vermektir. Uyarı
    kuralları hiçbir zaman engellemediği için kilitte yerleri yok — orada
    dursalardı her uyarı düzeltmesi gereksiz bir kilit diff'i üretirdi.

    Zaman damgası BİLEREK yok: dosya deterministiktir, aynı ağaçtan iki kez
    üretilince baytı baytına aynı çıkar. Ne zaman bankaya yazıldığı git
    geçmişinde zaten durur; dosyanın içine koymak her yeniden üretimde
    sahte bir değişiklik yaratırdı.
    """
    return {
        "_comment": (
            "Cırcır (ratchet) taban çizgisi. Yazıldığı andaki uyum durumunu "
            "kaydeder; dağıtım kapısı böylece yalnızca YENİ ihlalleri engeller "
            "— mevcut borç devralınır ve geriye dönük olarak asla engellemez. "
            "Yeniden üretmek için: python tools/conformance/scan.py --all --write-lock"
        ),
        "modules": {
            r["module"]: {
                rule_id: result["status"]
                for rule_id, result in r["rules"].items()
                if result["severity"] == RATCHET
            }
            for r in reports
        },
    }


def print_portfolio(reports: list[dict]) -> None:
    """Çok modüllü tablo görünümü, en kötüsü üstte."""
    reports = sorted(
        reports,
        key=lambda r: (r["score"][0] / r["score"][1] if r["score"][1] else 1.0, r["module"]),
    )
    total_pass = sum(r["score"][0] for r in reports)
    total_app = sum(r["score"][1] for r in reports)

    print(f"{'modül':<34} {'skor':>7}  düşen kontroller")
    print("-" * 78)
    for r in reports:
        passed, total = r["score"]
        failing = [
            rule_id
            for rule_id, result in r["rules"].items()
            if result["status"] == FAIL and result["severity"] == RATCHET
        ]
        print(f"{r['module']:<34} {passed:>3}/{total:<3}  {', '.join(failing) if failing else '-'}")
    print("-" * 78)
    print(f"{len(reports)} modül, uygulanan cırcır kontrollerinin {total_pass}/{total_app} kadarı geçiyor")

    errors = [
        f"{r['module']}:{rule_id}"
        for r in reports
        for rule_id, result in r["rules"].items()
        if result.get("rule_error")
    ]
    if errors:
        # Kural hatası bir muafiyet gibi görünür ama değildir; tabloda
        # görünmediği için ayrıca yazılır.
        print(f"{len(errors)} kural hatası (kontrol edilmedi): {', '.join(errors[:6])}")

    # HİÇBİR modülde uygulanmayan kural, portföy ölçeğinde sessiz muafiyetin ta
    # kendisidir: tabloda yalnızca DÜŞEN kurallar göründüğü için, yanlış
    # yapılandırılmış (ya da olgu yüzeyi değiştiği için artık hiç ateşlenmeyen)
    # bir kural, çalışan bir kuraldan ayırt edilemez. Sayı tabloya girmez ama
    # adı buraya yazılır.
    hicbir_yerde = [
        rule_id
        for rule_id in (reports[0]["rules"] if reports else {})
        if all(r["rules"][rule_id]["status"] == NA for r in reports)
    ]
    if hicbir_yerde:
        print(
            f"hiçbir modülde uygulanmadı ({len(hicbir_yerde)}): {', '.join(hicbir_yerde)}"
            "  — gerekçe için --json ya da --module"
        )


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--module", help="tek bir modülü tara (ad ya da yol)")
    group.add_argument(
        "--all",
        action="store_true",
        help=f"{MODULE_PREFIX or ''}* ön ekli her modülü tara (yabancı eklentiler hariç)",
    )
    parser.add_argument("--json", action="store_true", help="metin yerine JSON bas")
    parser.add_argument(
        "--write-lock",
        action="store_true",
        help="conformance.lock.json yaz (her zaman TÜM modülleri tarar)",
    )
    args = parser.parse_args()

    if args.write_lock and args.module:
        # Tek modülle yazılan bir kilit, diğer modüllerin kaydını siler ve
        # onları kapı için "hiç bilinmiyor" hâline getirir: sessizce muaf
        # olurlar. Yarım kilit, kilitsizlikten kötüdür.
        print(
            "--write-lock tüm modülleri gerektirir (yarım kilit diğer modülleri\n"
            "sessizce muaf yapar). Şunu çalıştırın:\n"
            "  python tools/conformance/scan.py --all --write-lock",
            file=sys.stderr,
        )
        return 1

    if args.module:
        path = resolve_module(args.module)
        if path is None:
            mevcut = ", ".join(p.name for p in find_modules()) or "(hiç modül yok)"
            print(
                f"hata: {args.module!r} bir modül dizini değil.\n"
                f"Aranan yer: {', '.join(str(r) for r in module_roots())}\n"
                f"Bulunan modüller: {mevcut}",
                file=sys.stderr,
            )
            return 1
        reports = [scan_module(path)]
    else:
        modules = find_modules()
        if not modules:
            print(
                f"hata: {', '.join(str(r) for r in module_roots())} altında "
                "`__manifest__.py` taşıyan bir dizin yok.\n"
                "NEDEN önemli: sıfır modül bulan bir tarayıcı 'her şey temiz' der.\n"
                "NASIL düzeltilir: modüllerinizin addons/ altında olduğundan emin olun.",
                file=sys.stderr,
            )
            return 1
        reports = [scan_module(p) for p in modules]

    if args.write_lock:
        LOCK_PATH.write_text(
            json.dumps(build_lock(reports), indent=2, sort_keys=True, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(f"yazıldı: {LOCK_PATH.name} ({len(reports)} modül)")

    if args.json:
        print(json.dumps(reports, indent=2, ensure_ascii=False))
        return 0

    if len(reports) == 1:
        print(format_report(reports[0]))
        return 0

    print_portfolio(reports)
    return 0


if __name__ == "__main__":
    sys.exit(main())
