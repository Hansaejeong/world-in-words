"""Build the portable Sites Worker from the existing text-only website."""
import ast
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
tree = ast.parse((ROOT / 'scripts/collect.py').read_text())
settings = {}
for node in tree.body:
    if isinstance(node, ast.Assign):
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id in ('COUNTRIES', 'SOURCES'):
                settings[target.id] = ast.literal_eval(node.value)
countries = [dict(zip(('code','name','ko','region','lang','term','language'),c)) for c in settings['COUNTRIES']]
assets = {}
for name, mime in [('index.html','text/html'),('style.css','text/css'),('app.js','text/javascript'),('ranking.js','text/javascript'),('translation.js','text/javascript')]:
    assets['/' + name] = {'body':(ROOT / name).read_text(),'type':mime + '; charset=utf-8'}
    shutil.copyfile(ROOT / name, ROOT / 'dist' / name)
news = json.loads((ROOT / 'news.js').read_text().removeprefix('window.NEWS = ').strip().removesuffix(';'))
assets['/news.js'] = {'body':'window.NEWS = '+json.dumps(news,ensure_ascii=False)+';','type':'text/javascript; charset=utf-8'}
shutil.copyfile(ROOT / 'news.js', ROOT / 'dist/news.js')
output = ROOT / 'dist/server'
output.mkdir(parents=True, exist_ok=True)
generated = '\n'.join(f'export const {key} = {json.dumps(value, ensure_ascii=False)};' for key,value in {
    'COUNTRIES':countries,'SOURCES':settings['SOURCES'],'ASSETS':assets,'INITIAL_NEWS':news}.items())
(output / 'generated.mjs').write_text(generated)
shutil.copyfile(ROOT / 'server/worker.mjs', output / 'index.js')
shutil.copyfile(ROOT / 'server/accounts.mjs', output / 'accounts.mjs')
print('Built Sites Worker and synchronized local page assets.')
