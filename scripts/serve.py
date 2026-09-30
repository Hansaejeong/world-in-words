"""Serve the text newspaper and refresh its headlines at Korean midnight.
Run: python3 scripts/serve.py [port]
"""
import datetime as dt
import functools
import http.server
import json
import pathlib
import subprocess
import sys
import threading
from zoneinfo import ZoneInfo

ROOT = pathlib.Path(__file__).resolve().parents[1]
KST = ZoneInfo('Asia/Seoul')

def snapshot():
    raw = (ROOT / 'news.js').read_text()
    return json.loads(raw.removeprefix('window.NEWS = ').strip().removesuffix(';'))

def refresh_loop():
    while True:
        now = dt.datetime.now(KST)
        try:
            data = snapshot()
            collected = dt.datetime.fromisoformat(data['collectedAt']).astimezone(KST)
            if collected.date() < now.date() or data.get('articleLimitPerCountry') != 50 or data.get('window') != 'month':
                subprocess.run([sys.executable, str(ROOT / 'scripts/collect.py'), now.date().isoformat()], check=True, timeout=600)
                (ROOT / 'dist/news.js').write_text((ROOT / 'news.js').read_text())
        except Exception as error:
            print('Headline refresh failed; previous snapshot retained:', error, flush=True)
        # Wake exactly at midnight; recheck within five minutes after a failure.
        midnight = dt.datetime.combine(now.date() + dt.timedelta(days=1), dt.time(), KST)
        delay = max(0.1, min(300, (midnight - dt.datetime.now(KST)).total_seconds()))
        threading.Event().wait(delay)

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split('?')[0] == '/api/headlines':
            try:
                body = json.dumps(snapshot(), ensure_ascii=False).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except Exception:
                self.send_error(503, 'Headlines temporarily unavailable')
        else:
            super().do_GET()

if __name__ == '__main__':
    threading.Thread(target=refresh_loop, daemon=True).start()
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    server = http.server.ThreadingHTTPServer(('0.0.0.0', port), functools.partial(Handler, directory=str(ROOT / 'dist')))
    print(f'World In Words: http://localhost:{port} — midnight Asia/Seoul refresh', flush=True)
    server.serve_forever()
