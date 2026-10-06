"""Upload news.js as raw UTF-8 JSON and verify the stored titles and sources.

Run: python3 scripts/upload_snapshot.py <current Sites URL>
The temporary Sites service credential is read without echo and never saved.
"""
import getpass
import json
from pathlib import Path
import sys
import subprocess
import tempfile


def main():
    site = sys.argv[1].rstrip('/')
    if not site.startswith('https://'):
        raise ValueError('HTTPS Site URL required')
    token = getpass.getpass('Site service access: ')
    raw = (Path(__file__).resolve().parents[1] / 'news.js').read_text()
    news = json.loads(raw.removeprefix('window.NEWS = ').strip().removesuffix(';'))
    payload = json.dumps(news, ensure_ascii=False).encode('utf-8')
    def call(path, body_path=None):
        config = 'url = ' + json.dumps(site + path) + '\n'
        config += 'header = ' + json.dumps('OAI-Sites-Authorization: Bearer ' + token) + '\n'
        config += 'header = "Content-Type: application/json; charset=utf-8"\n'
        command = ['curl', '--fail-with-body', '--silent', '--show-error',
                   '--max-time', '60', '--config', '-']
        if body_path:
            command += ['--data-binary', '@' + body_path]
        response = subprocess.run(command, input=config, text=True, capture_output=True)
        if response.returncode:
            raise RuntimeError('Snapshot request failed: ' + response.stderr)
        return json.loads(response.stdout)
    # The body bypasses curl's config string parser entirely.
    with tempfile.NamedTemporaryFile(suffix='.json') as body:
        body.write(payload)
        body.flush()
        result = call('/api/snapshot', body.name)
    stored = call('/api/headlines')
    expected = {a['id']: (a['title'], a['source']) for a in news['articles']}
    actual = {a['id']: (a['title'], a['source']) for a in stored['articles']}
    if actual != expected:
        raise RuntimeError('Stored headlines did not match the uploaded Unicode text')
    print(json.dumps({'verified': True, 'articles': len(actual),
                      'koreanArticles': sum(a['country'] == 'KR' for a in stored['articles']),
                      'collectedAt': result['collectedAt']}))


if __name__ == '__main__':
    main()
