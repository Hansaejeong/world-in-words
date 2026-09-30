"""Add direct publisher links to the existing static Google News archive."""

from concurrent.futures import ThreadPoolExecutor, as_completed
import json
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.parse import urlencode, urlparse


ROOT = Path(__file__).resolve().parents[1]
NEWS_FILE = ROOT / "news.js"
PAGE_HEADERS = ["-A", "Mozilla/5.0 Chrome/131.0 Safari/537.36"]


def curl(args):
    result = subprocess.run(
        ["curl", "-sS", "-L", "--max-time", "25", *args],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or f"curl exited {result.returncode}")
    return result.stdout


def resolve(article):
    if article.get("publisherUrl"):
        return article["id"], article["publisherUrl"], None
    article_id = urlparse(article["url"]).path.rsplit("/", 1)[-1]
    for attempt in range(3):
        try:
            page = curl([*PAGE_HEADERS, article["url"]])
            signature = re.search(r'data-n-a-sg="([^"]+)"', page)
            timestamp = re.search(r'data-n-a-ts="([^"]+)"', page)
            if not signature or not timestamp:
                raise ValueError("decoding parameters missing")
            request = [
                "garturlreq",
                [["X", "X", ["X", "X"], None, None, 1, 1, "US:en", None, 1, None, None, None, None, None, 0, 1],
                 "X", "X", 1, [1, 1, 1], 1, 1, None, 0, 0, None, 0],
                article_id,
                int(timestamp.group(1)),
                signature.group(1),
            ]
            form = urlencode({"f.req": json.dumps([[["Fbv4je", json.dumps(request)]]])})
            response = curl([
                "-X", "POST", "-H", "Content-Type: application/x-www-form-urlencoded;charset=UTF-8",
                "-H", "Origin: https://news.google.com", "-H", "Referer: https://news.google.com/",
                "-H", "Cookie: CONSENT=PENDING+987", "--data", form,
                "https://news.google.com/_/DotsSplashUi/data/batchexecute",
            ])
            body = response.split("\n\n", 1)[1].strip()
            outer = json.loads(body)
            decoded = json.loads(outer[0][2])
            url = decoded[1]
            parsed = urlparse(url)
            if parsed.scheme != "https" or not parsed.hostname or parsed.hostname == "news.google.com":
                raise ValueError("invalid publisher URL")
            return article["id"], url, None
        except Exception as exc:
            error = str(exc)
            if attempt < 2:
                time.sleep(attempt + 1)
    return article["id"], None, error


def main():
    original = NEWS_FILE.read_text()
    start = original.index("{")
    end = original.rindex("}") + 1
    news = json.loads(original[start:end])
    articles = news["articles"]
    resolved = {}
    failures = []
    by_id = {article["id"]: article for article in articles}

    def save():
        content = original[:start] + json.dumps(news, ensure_ascii=False, separators=(",", ":")) + original[end:]
        temp = NEWS_FILE.with_suffix(".js.tmp")
        temp.write_text(content)
        temp.replace(NEWS_FILE)

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(resolve, article) for article in articles]
        for i, future in enumerate(as_completed(futures), 1):
            article_id, url, error = future.result()
            if url:
                resolved[article_id] = url
                by_id[article_id]["publisherUrl"] = url
            else:
                failures.append((article_id, error))
            if i % 20 == 0 or i == len(articles):
                save()
                print(f"{i}/{len(articles)} checked, {len(resolved)} direct links", flush=True)
    print(f"Saved {len(resolved)} direct links; {len(failures)} unresolved.")
    for article_id, reason in failures[:10]:
        print(f"Unresolved {article_id}: {reason}")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
