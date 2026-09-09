"""Refresh locally hosted Google Fonts and their open font licenses."""
from pathlib import Path
import re
import urllib.request

TARGET = Path(__file__).resolve().parents[1] / 'addons/cs_prefab_configurator/static/vendor'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=30).read()

if __name__ == '__main__':
    for family, slug in [('DM Sans:wght@100..1000', 'dm-sans'), ('DM Serif Display', 'dm-serif')]:
        css = get('https://fonts.googleapis.com/css2?family=' + family.replace(' ', '+') + '&display=swap').decode()
        blocks = css.split('/* latin */')
        urls = re.findall(r'url\((https://[^)]+)\)', blocks[-1])
        url = urls[-1]
        if not url.endswith('.woff2'):
            raise RuntimeError('Expected WOFF2 font; refusing mismatched extension')
        (TARGET / f'{slug}-latin.woff2').write_bytes(get(url))
    for source, name in [('dmsans', 'DM-Sans-OFL.txt'), ('dmserifdisplay', 'DM-Serif-OFL.txt')]:
        (TARGET / name).write_bytes(get(f'https://raw.githubusercontent.com/google/fonts/main/ofl/{source}/OFL.txt'))
    print('Two WOFF2 font files and their OFL licenses installed locally.')
