"""Build a bounded addon archive from the project and the requested CS modules."""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile

ROOT=Path(__file__).resolve().parents[1]
SUPPORT=('cs_security_base','cs_help_base','cs_studio_workspace','cs_web_responsive',
         # cs_white_label_kit brands the backend and the portal -- the favicon, the page
         # titles and the 'Powered by' line. It records every overwrite in cs_change_audit,
         # which is why the two arrive together and why neither can be dropped alone.
         'cs_change_audit','cs_white_label_kit')
# The archive is a hardcoded list, not a glob over addons/: a new folder stays invisible until
# it is named here. The deploy and clone-test helpers carry their own allowlist of the same
# names and REPLACE (not overlay) each folder, so adding a name there while omitting it here
# deletes the module from /mnt/extra-addons without putting anything back. Both lists move
# together, in one commit.
PROJECT=('cs_prefab_configurator','cs_prefab_website')

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--source',type=Path,default=Path('E:/Source/cs-odoo-modules'))
    parser.add_argument('--output',type=Path,default=ROOT/'.data/releases/addons.tar.gz')
    parser.add_argument('--support-only',action='store_true')
    # A release may ship a SUBSET of PROJECT: the configurator and the website version independently, and one
    # can be ready while the other is not. Whatever is named here must match the allowlist in that release's
    # deploy and clone-test helpers, because those REPLACE each named folder on the server - a name present
    # there and absent here deletes the module without putting anything back.
    parser.add_argument('--modules',nargs='+',choices=PROJECT,default=list(PROJECT),
                        help='project modules to ship (default: all of PROJECT)')
    args=parser.parse_args()
    args.output.parent.mkdir(parents=True,exist_ok=True)
    modules=[(name,args.source/name) for name in SUPPORT]
    if not args.support_only:modules+=[(name,ROOT/'addons'/name) for name in args.modules]
    records=[]
    with tarfile.open(args.output,'w:gz') as archive:
        for name,directory in modules:
            manifest=ast.literal_eval((directory/'__manifest__.py').read_text(encoding='utf-8-sig'))
            assert manifest['version'].startswith('saas~19.4.'),(name,'wrong target series')
            files=[]
            for path in sorted(directory.rglob('*')):
                if path.is_symlink():raise ValueError('Symlinks are not allowed in release modules')
                if not path.is_file() or '__pycache__' in path.parts or path.suffix in ('.pyc','.pyo'):continue
                relative=path.relative_to(directory).as_posix()
                archive.add(path,arcname=name+'/'+relative,recursive=False)
                files.append({'path':relative,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
            records.append({'module':name,'version':manifest['version'],'files':files})
        if not args.support_only:archive.add(ROOT/'addons/requirements.txt',arcname='requirements.txt')
    record={'archive':args.output.name,'sha256':hashlib.sha256(args.output.read_bytes()).hexdigest(),'modules':records,
            'sourceCommit':subprocess.check_output(['git','-C',str(args.source),'rev-parse','HEAD'],text=True).strip()}
    args.output.with_suffix('.manifest.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'archive':str(args.output),'bytes':args.output.stat().st_size,'sha256':record['sha256'],'modules':[{k:m[k] for k in ['module','version']} for m in records]}))

if __name__=='__main__':main()
