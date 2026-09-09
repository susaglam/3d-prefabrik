"""Build a clean Odoo addon archive; never include local records or research."""
import hashlib
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
ADDON = ROOT / 'addons' / 'cs_prefab_configurator'
OUTPUT = ROOT / 'dist' / 'cs_prefab_configurator-1.1.0.zip'

if __name__ == '__main__':
    OUTPUT.parent.mkdir(exist_ok=True)
    files = sorted(path for path in ADDON.rglob('*') if path.is_file()
                   and '__pycache__' not in path.parts and path.suffix not in {'.pyc', '.pyo'})
    with ZipFile(OUTPUT, 'w', ZIP_DEFLATED, compresslevel=9) as archive:
        for path in files:
            archive.write(path, Path(ADDON.name) / path.relative_to(ADDON))
    digest = hashlib.sha256(OUTPUT.read_bytes()).hexdigest()
    OUTPUT.with_suffix('.zip.sha256').write_text(f'{digest}  {OUTPUT.name}\n')
    print(f'{OUTPUT.relative_to(ROOT)}: {len(files)} files, {OUTPUT.stat().st_size} bytes, SHA256 {digest}')
