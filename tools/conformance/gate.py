#!/usr/bin/env python3
"""Cırcır (ratchet) dağıtım kapısı — modül temel uyumu için.

Cırcır nedir
============
`conformance.lock.json` yazıldığı andaki uyum durumunu kaydeder. Bu kapı bir
dağıtımı YALNIZCA kilitte GEÇEN bir kontrol şimdi DÜŞÜYORSA engeller; yani
yalnızca **gerilemeyi**. Mevcut borç devralınır ve asla engellemez.

Bunun ölçülmüş bir gerekçesi var. Bu mekanizmanın geldiği depoda katı bir kapı
— "açık bulgu varsa dağıtma" — ilk gün 13 modüle takılıyordu. Böyle bir kapı
düzeltilmez, kapatılır; ve kapatılan bir kapı hiç olmayan bir kapıdan kötüdür,
çünkü hâlâ orada duruyormuş gibi görünür. Devralınan borç modeli, kapının
kurulduğu gün açılabilmesini ve açık kalabilmesini sağlayan tek şeydir.

DÜŞTÜ → GEÇTİ yönündeki değişim bir kazançtır ve raporlanır; kalıcı olması için
bankaya yazın:

    python tools/conformance/scan.py --all --write-lock

Bankaya yazmadığınız kazanç, bir sonraki gerilemede sessizce geri alınır: kilit
hâlâ "bu kontrol düşüyordu" der ve kapı ses çıkarmaz.

Kullanım
========
    python tools/conformance/gate.py --module vd_site_base
        Tek modülü kilide karşı kontrol eder. Temizse 0, gerilemede 2.

    python tools/conformance/gate.py --all
        Tüm modüller.

    python tools/conformance/gate.py --command "python scripts/deploy_module.py vd_site_base"
        Kapıyı kanca olmadan denemek için: komutu dağıtım gibi görüyor mu,
        hangi modülü çıkarıyor, ne karar veriyor. Kancayı canlı bir dağıtımda
        ilk kez denemek pahalı bir öğrenme biçimidir.

    python tools/conformance/gate.py --hook
        Claude Code PreToolUse kancası. Araç çağrısını stdin'den JSON olarak
        okur, dağıtım biçimli komutları tanır, hedef modülü çıkarır ve yalnızca
        onu denetler. **Çıkış 2 araç çağrısını engeller** ve stderr'i modele
        gösterir. Tanımadığı hiçbir şeye dokunmaz — tahmin eden bir kapı,
        kapatılan bir kapıdır.

Kaçış kapağı
============
`VD_CONFORMANCE_SKIP=1` ortam değişkeni ya da komutun herhangi bir yerinde
`#no-gate`. İkisi de stderr'e yazar: **atlanmış bir kapı asla sessiz olmamalı**,
yoksa aylar sonra kimse kapının o dağıtımda çalışıp çalışmadığını bilemez.

Neden çıkış kodu 2
==================
Claude Code kancasında 0 "geç", 2 "engelle" demektir; diğer kodlar araç
çağrısını engellemez, yalnızca gürültü üretir. Bu yüzden bu script beklenmedik
bir hatada bilerek 0 döndürür (ve nedenini stderr'e yazar): kapının kendi
arızası, meşru bir dağıtımı durdurmamalı.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

# SIRA ÖNEMLİ: önce `scan`. Kural dosyası eksikse `scan` bunu anlaşılır bir
# mesajla bildirip çıkar; `rules`'u önce yazsaydık aynı durumda kullanıcı çıplak
# bir ModuleNotFoundError yığını görürdü. Hiçbir hata çıplak yığın olarak
# görünmemeli: ne olduğunu, neden önemli olduğunu ve nasıl düzeltileceğini
# söylemeyen mesaj, mesaj değildir.
from scan import (  # noqa: E402
    LOCK_PATH,
    find_modules,
    resolve_module,
    scan_module,
)
from rules import FAIL, PASS, RATCHET  # noqa: E402

# "Bu modül birazdan bir sunucuya ulaşacak" anlamına gelen komut biçimleri.
#
# Kapı tek bir scripti sarmalamak yerine komut METNİNE bakar, çünkü dağıtım tek
# yoldan yapılmıyor: bu depoda `scripts/deploy_module.py` var, ama acil bir
# düzeltmede elle yazılmış bir `tar | ssh` ya da `docker cp` de aynı sonucu
# doğurur. Yalnızca scripti saran bir kapı, tam da en riskli anda — acele
# edildiğinde — devre dışı kalır.
DEPLOY_PATTERNS = [
    # Bu projenin dağıtım scripti.
    re.compile(r"deploy_module\.py", re.I),
    # CLAUDE.md'deki hızlı tek-satırlık yükleme: tar ... | ssh ...
    re.compile(r"\btar\s+(?:-\S+\s+)*c\S*f\s+-.*\bssh\b", re.S),
    re.compile(r"\bscp\b"),
    re.compile(r"\brsync\b"),
    re.compile(r"\bsftp\b"),
    re.compile(r"\bdocker\s+cp\b"),
    # Kod zaten konteynerdeyse tehlike bir sonraki adımdadır.
    re.compile(r"\bbutton_immediate_(?:upgrade|install)\b"),
    re.compile(r"odoo-bin\b[^\n]*\s-[ui]\s"),
    re.compile(r"odoo-bin\b[^\n]*\s--(?:update|init)\b"),
]

# Komut içindeki modül adayı olabilecek kelimeler. Eşleşme burada değil,
# DİSKTEKİ modül adlarına karşı yapılır (aşağıya bakın) — bu yüzden kalıbın
# gevşek olması sorun değil ve önek değişse bile kapı çalışmaya devam eder.
TOKEN_RX = re.compile(r"\b[A-Za-z][A-Za-z0-9_]{2,}\b")

# Kanca hangi araç çağrılarına bakar. Bu depo Windows üzerinde çalışıyor ve
# dağıtım komutu PowerShell aracından da gelebilir; yalnızca Bash'e bakan bir
# kanca burada sessizce hiçbir şey denetlemez.
GATED_TOOLS = {"Bash", "PowerShell"}


def load_lock() -> dict:
    """Kilidi okur. Yoksa ya da bozuksa boş sözlük.

    Boş kilit = hiçbir kontrolün geçtiği bilinmiyor = hiçbir şey gerileme
    sayılmaz. Kapı bu durumda sessizce açık kalır; alternatifi, kilidi henüz
    üretmemiş bir depoda her dağıtımı engellemek olurdu.
    """
    if not LOCK_PATH.is_file():
        return {}
    try:
        return json.loads(LOCK_PATH.read_text(encoding="utf-8")).get("modules", {})
    except (json.JSONDecodeError, OSError):
        return {}


def check_module(module: str) -> tuple[str | None, list[str], list[str], list[str]]:
    """Bir modül için (çözülen_ad, gerilemeler, iyileşmeler, devralınanlar).

    İlk eleman, argümanın çözüldüğü modülün DİZİN ADIDIR — çağıranın yazdığı
    dize değil. İki ayrı sessiz geçiş bu ayrımdan doğuyordu:

      * Çözülemeyen bir ad (yazım hatası) eskiden boş üçlü döndürüyordu ve kapı
        "gerileme yok" diyip 0 ile çıkıyordu. `gate.py --module vd_site_bas`
        yeşil bir kapı raporluyordu. Artık None döner; kararı çağıran verir.
      * Kilit araması çağıranın dizesiyle yapılıyordu. `--module vd_site_base`
        engellerken `--module addons/vd_site_base` — scan.py'nin BELGELENMİŞ
        biçimi, aynı modül — kilitte "addons/vd_site_base" anahtarını bulamıyor,
        her bulguyu devralınmış sayıyor ve aynı gerilemeyi geçiriyordu. Kilit
        `scan_module`'ün döndürdüğü adla aranır; tek doğruluk kaynağı odur.
    """
    path = resolve_module(module)
    if path is None:
        return None, [], [], []

    report = scan_module(path)
    name = report["module"]
    locked = load_lock().get(name, {})

    regressions, improvements, inherited = [], [], []
    for rule_id, result in report["rules"].items():
        if result["severity"] != RATCHET:
            continue
        was = locked.get(rule_id)
        now = result["status"]
        if now == FAIL and was == PASS:
            regressions.append(f"{rule_id}: {result['detail']}")
        elif now == PASS and was == FAIL:
            improvements.append(rule_id)
        elif now == FAIL:
            # Kilitte de düşüyordu (ya da kilitte hiç yoktu): devralınan borç.
            inherited.append(rule_id)
    return name, regressions, improvements, inherited


def report_lines(
    module: str,
    regressions: list[str],
    improvements: list[str],
    inherited: list[str],
    show_inherited: bool = True,
) -> list[str]:
    """Engelleme mesajı. Üç soruya da cevap verir: ne, neden, nasıl."""
    lines = []
    if regressions:
        lines.append(f"TEMEL GERİLEMESİ: {module} — dağıtım engellendi")
        lines.append("")
        for item in regressions:
            lines.append(f"  x {item}")
        lines.append("")
        lines.append("Bu kontroller conformance.lock.json'da GEÇİYORDU, şimdi DÜŞÜYOR.")
        lines.append("Düzeltin; değişiklik bilinçliyse yeni durumu bankaya yazın:")
        lines.append("  python tools/conformance/scan.py --all --write-lock")
        lines.append(
            "Yine de dağıtmak için: VD_CONFORMANCE_SKIP=1 ya da komuta #no-gate ekleyin."
        )
    if improvements:
        lines.append(
            f"  + {module} iyileşti: {', '.join(improvements)} "
            "(kalıcı olması için --write-lock)"
        )
    if inherited and not regressions and show_inherited:
        lines.append(f"  . {module}: {len(inherited)} devralınan bulgu, engellemiyor")
    return lines


def find_deploy_target(command: str) -> str | None:
    """Dağıtım komutunun hedeflediği modülü döndürür, yoksa None.

    Bilerek temkinli. Birden fazla modül adı geçiyorsa hangisinin yük olduğunu
    bilemeyiz; tahmin etmek yerine komutu geçiririz. Yanlış modülü engelleyen
    bir kapı, bir kez yanıldıktan sonra kimse tarafından ciddiye alınmaz.

    Aday kelimeler diskteki gerçek modül adlarına karşı doğrulanır; ad öneki
    kalıba GÖMÜLMEZ, böylece şablon başka bir önekle kullanıldığında kapı
    kendiliğinden doğru çalışır.
    """
    if not any(pattern.search(command) for pattern in DEPLOY_PATTERNS):
        return None
    known = {p.name for p in find_modules()}
    candidates = [name for name in dict.fromkeys(TOKEN_RX.findall(command)) if name in known]
    if len(candidates) == 1:
        return candidates[0]
    return None


def gate_command(command: str, verbose: bool = False) -> int:
    """Bir komut metnini denetler. 0 geç, 2 engelle.

    `--command` ve `--hook` aynı yolu kullanır: kancanın davranışını kanca
    olmadan sınayabilmek, kapıyı ilk kez canlı bir dağıtımda denemekten çok
    daha ucuzdur.
    """
    if os.environ.get("VD_CONFORMANCE_SKIP") == "1":
        print("uyum kapısı atlandı (VD_CONFORMANCE_SKIP=1)", file=sys.stderr)
        return 0
    if "#no-gate" in command:
        print("uyum kapısı atlandı (komutta #no-gate)", file=sys.stderr)
        return 0

    module = find_deploy_target(command)
    if not module:
        if verbose:
            print("dağıtım biçimli bir komut/tek modül tanınmadı — geçildi", file=sys.stderr)
        return 0

    if verbose:
        print(f"hedef modül: {module}", file=sys.stderr)

    name, regressions, improvements, inherited = check_module(module)
    if name is None:
        # Buraya normalde gelinmez: `find_deploy_target` adayları zaten diskteki
        # modüllere karşı doğrular. Yine de gelinirse kapının KENDİ arızasıdır ve
        # meşru bir dağıtımı durdurmamalı — ama sessiz de kalmamalı.
        print(
            f"uyum kapısı: {module!r} çözülemedi, dağıtım geçirildi", file=sys.stderr
        )
        return 0

    lines = report_lines(name, regressions, improvements, inherited)
    if lines:
        print("\n".join(lines), file=sys.stderr)
    return 2 if regressions else 0


def run_hook() -> int:
    """PreToolUse kancası: araç çağrısını stdin'den okur.

    Beklenmedik her durumda 0 döner. Kancanın kendi arızası meşru bir araç
    çağrısını durdurmamalı — ama sessiz de kalmamalı, bu yüzden nedeni stderr'e
    yazılır.
    """
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError, OSError):
        return 0  # bizim işimiz değil

    try:
        if payload.get("tool_name") not in GATED_TOOLS:
            return 0
        command = (payload.get("tool_input") or {}).get("command", "")
        if not command:
            return 0
        return gate_command(command)
    except Exception as exc:  # pragma: no cover - savunma amaçlı
        print(
            f"uyum kapısı hata verdi, araç çağrısı geçirildi: {type(exc).__name__}: {exc}",
            file=sys.stderr,
        )
        return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--module", help="tek modülü kilide karşı kontrol et")
    group.add_argument("--all", action="store_true", help="her modülü kilide karşı kontrol et")
    group.add_argument("--command", help="bir komut metnini kanca gibi denetle (deneme modu)")
    group.add_argument(
        "--hook", action="store_true", help="Claude Code PreToolUse kanca modu (stdin okur)"
    )
    args = parser.parse_args()

    if args.hook:
        return run_hook()

    if args.command:
        return gate_command(args.command, verbose=True)

    if not LOCK_PATH.is_file():
        print(
            "conformance.lock.json yok — önce cırcır taban çizgisini üretin:\n"
            "  python tools/conformance/scan.py --all --write-lock\n"
            "NEDEN: kilit olmadan hiçbir kontrolün daha önce geçtiği bilinmez,\n"
            "yani hiçbir şey gerileme sayılamaz ve kapı hiçbir şeyi koruyamaz.",
            file=sys.stderr,
        )
        return 1

    modules = [args.module] if args.module else [p.name for p in find_modules()]

    exit_code = 0
    total_inherited = 0
    checked = 0
    for module in modules:
        name, regressions, improvements, inherited = check_module(module)
        if name is None:
            # Çözülemeyen ad SESSİZCE geçilemez. Eskiden boş sonuç "gerileme
            # yok" ile aynı yola düşüyordu: bir yazım hatası yeşil kapı
            # üretiyordu ve kapı hiçbir şeyi denetlememiş oluyordu.
            mevcut = ", ".join(p.name for p in find_modules()) or "(hiç modül yok)"
            print(
                f"hata: {module!r} bir modül dizini değil — DENETLENMEDİ.\n"
                f"Bulunan modüller: {mevcut}",
                file=sys.stderr,
            )
            exit_code = max(exit_code, 1)
            continue
        checked += 1
        total_inherited += len(inherited)
        lines = report_lines(
            name, regressions, improvements, inherited, show_inherited=bool(args.module)
        )
        if lines:
            print("\n".join(lines))
        if regressions:
            exit_code = 2
    if exit_code == 0:
        suffix = (
            f", {total_inherited} devralınan bulgu engellemiyor" if total_inherited else ""
        )
        # `checked`, `modules` DEĞİL: çözülemeyen bir ad sayıya girmemeli, yoksa
        # "3 modül kontrol edildi" hiçbiri denetlenmemişken de yazılabilir.
        print(f"kilide karşı gerileme yok ({checked} modül kontrol edildi{suffix})")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
