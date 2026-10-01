"""Bundle the current Odoo website's Inter fonts with their SIL OFL notices."""
from datetime import datetime, timezone
import hashlib,json,re,urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
TARGET=ROOT/'addons/cs_prefab_configurator/static/vendor'
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':UA}),timeout=30).read()

if __name__=='__main__':
    css=['/* Locally hosted Inter / Inter Tight, SIL OFL1.1; see adjacent OFL notices. */']
    provenance={'retrievedAt':datetime.now(timezone.utc).isoformat(),'families':[]}
    for family,slug,license_dir in [('Inter','inter','inter'),('Inter Tight','inter-tight','intertight')]:
        url='https://fonts.googleapis.com/css2?family='+family.replace(' ','+')+':ital,wght@0,100..900;1,100..900&display=swap'
        upstream=get(url).decode()
        selected=re.findall(r'/\* (latin(?:-ext)?) \*/\s*(@font-face\s*\{.*?\})',upstream,re.S)
        assert len(selected)==4,(family,'Expected Latin and Latin-ext in normal/italic')
        record={'family':family,'cssSource':url,'files':[]}
        for subset,block in selected:
            style=re.search(r'font-style:\s*([^;]+);',block).group(1)
            source=re.search(r'url\((https://fonts.gstatic.com/[^)]+)\)',block).group(1)
            assert source.endswith('.woff2')
            filename=slug+('-italic' if style=='italic' else '')+'-'+subset+'.woff2'
            data=get(source);assert data[:4]==b'wOF2'
            (TARGET/filename).write_bytes(data)
            css.append('/* '+subset+' */\n'+block.replace(source,'./'+filename))
            record['files'].append({'file':filename,'source':source,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'subset':subset,'style':style})
        license_url='https://raw.githubusercontent.com/google/fonts/main/ofl/'+license_dir+'/OFL.txt'
        license_data=get(license_url);assert b'SIL OPEN FONT LICENSE' in license_data
        filename=family.replace(' ','-')+'-OFL.txt';(TARGET/filename).write_bytes(license_data)
        record['license']={'file':filename,'source':license_url,'sha256':hashlib.sha256(license_data).hexdigest()}
        provenance['families'].append(record)
    (TARGET/'native-fonts.css').write_text('\n\n'.join(css)+'\n',encoding='utf-8')
    (TARGET/'native-fonts-provenance.json').write_text(json.dumps(provenance,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'families':[r['family'] for r in provenance['families']],'files':sum(len(r['files']) for r in provenance['families']),'fontBytes':sum(f['bytes'] for r in provenance['families'] for f in r['files'])}))
