"""Collect a dated, personal news-reader snapshot from Google News RSS.
Run: python3 scripts/collect.py [YYYY-MM-DD]. No API key required.
"""
import concurrent.futures, datetime as dt, email.utils, hashlib, html, json, pathlib, sys, urllib.parse, subprocess, xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[1]
COUNTRIES = [
 ('KR','대한민국','한국','Asia','ko','한국','한국어'),
 ('JP','日本','일본','Asia','ja','日本','日本語'),
 ('TW','臺灣','대만','Asia','zh-TW','台灣','繁體中文'),
 ('IN','भारत','인도','Asia','hi','भारत','हिन्दी'),
 ('ID','Indonesia','인도네시아','Asia','id','Indonesia','Bahasa Indonesia'),
 ('TH','ประเทศไทย','태국','Asia','th','ประเทศไทย','ไทย'),
 ('VN','Việt Nam','베트남','Asia','vi','Việt Nam','Tiếng Việt'),
 ('FR','France','프랑스','Europe','fr','France','Français'),
 ('DE','Deutschland','독일','Europe','de','Deutschland','Deutsch'),
 ('ES','España','스페인','Europe','es','España','Español'),
 ('IT','Italia','이탈리아','Europe','it','Italia','Italiano'),
 ('GB','United Kingdom','영국','Europe','en-GB','Britain','English'),
 ('US','United States','미국','Americas','en-US','United States','English'),
 ('CA','Canada','캐나다','Americas','en-CA','Canada','English'),
 ('MX','México','멕시코','Americas','es-419','México','Español'),
 ('BR','Brasil','브라질','Americas','pt-419','Brasil','Português'),
 ('AR','Argentina','아르헨티나','Americas','es-419','Argentina','Español'),
 ('ZA','South Africa','남아프리카공화국','Africa','en-ZA','South Africa','English'),
 ('NG','Nigeria','나이지리아','Africa','en-NG','Nigeria','English'),
 ('KE','Kenya','케냐','Africa','en-KE','Kenya','English'),
 ('EG','مصر','이집트','Middle East','ar','مصر','العربية'),
 ('SA','السعودية','사우디아라비아','Middle East','ar','السعودية','العربية'),
 ('AU','Australia','호주','Oceania','en-AU','Australia','English'),
 ('NZ','New Zealand','뉴질랜드','Oceania','en-NZ','New Zealand','English'),
]
SOURCES = {
 'KR':['yna.co.kr','hani.co.kr','khan.co.kr','news.kbs.co.kr','news.sbs.co.kr','newsis.com'],
 'JP':['nhk.or.jp','asahi.com','mainichi.jp','yomiuri.co.jp','jiji.com'],
 'TW':['cna.com.tw','udn.com','ltn.com.tw','pts.org.tw'],
 'IN':['aajtak.in','ndtv.in','bbc.com/hindi','amarujala.com','jansatta.com'],
 'ID':['antaranews.com','kompas.com','tempo.co','detik.com'],
 'TH':['thaipbs.or.th','thairath.co.th','prachatai.com','matichon.co.th'],
 'VN':['vnexpress.net','tuoitre.vn','thanhnien.vn','vietnamplus.vn'],
 'FR':['franceinfo.fr','lemonde.fr','rfi.fr/fr','france24.com/fr','liberation.fr'],
 'DE':['tagesschau.de','zdfheute.de','zeit.de','dw.com/de','sueddeutsche.de'],
 'ES':['elpais.com','rtve.es','eldiario.es','lavanguardia.com'],
 'IT':['ansa.it','rainews.it','ilpost.it','repubblica.it'],
 'GB':['bbc.co.uk/news','bbc.com/news','theguardian.com/uk-news','independent.co.uk','news.sky.com'],
 'US':['apnews.com','npr.org','pbs.org','cnn.com','cbsnews.com'],
 'CA':['cbc.ca','ctvnews.ca','globalnews.ca','theglobeandmail.com'],
 'MX':['jornada.com.mx','eluniversal.com.mx','milenio.com','animalpolitico.com'],
 'BR':['agenciabrasil.ebc.com.br','g1.globo.com','folha.uol.com.br','estadao.com.br'],
 'AR':['lanacion.com.ar','clarin.com','pagina12.com.ar','infobae.com'],
 'ZA':['sabcnews.com','news24.com','dailymaverick.co.za','iol.co.za'],
 'NG':['punchng.com','premiumtimesng.com','channelstv.com','thecable.ng'],
 'KE':['nation.africa/kenya','standardmedia.co.ke','capitalfm.co.ke','citizen.digital'],
 'EG':['almasryalyoum.com','youm7.com','masrawy.com','shorouknews.com'],
 'SA':['spa.gov.sa','arabic.cnn.com','sabq.org','aawsat.com'],
 'AU':['abc.net.au/news','sbs.com.au/news','smh.com.au','theage.com.au'],
 'NZ':['rnz.co.nz','nzherald.co.nz','stuff.co.nz','1news.co.nz'],
}
END = dt.date.fromisoformat(sys.argv[1]) if len(sys.argv)>1 else dt.datetime.now(dt.timezone.utc).date()
import calendar
pm = END.month-1 or 12
py = END.year-(END.month == 1)
START = dt.date(py,pm,min(END.day,calendar.monthrange(py,pm)[1]))

def collect(c):
    code,name,ko,region,lang,term,language = c
    ceid_lang = {'en-GB':'en','en-US':'en','en-CA':'en','en-ZA':'en','en-NG':'en','en-KE':'en','en-AU':'en','en-NZ':'en','es-419':'es-419','pt-419':'pt-419'}.get(lang,lang)
    try:
        entries=[]
        for site in SOURCES[code]:
            query=f'site:{site} after:{START.isoformat()} before:{(END+dt.timedelta(days=1)).isoformat()}'
            url='https://news.google.com/rss/search?'+urllib.parse.urlencode({'q':query,'hl':lang,'gl':code,'ceid':f'{code}:{ceid_lang}'})
            raw=subprocess.run(['curl','--fail','--location','--silent','--show-error','--retry','2','--max-time','25',url],capture_output=True,check=True).stdout
            entries.extend(ET.fromstring(raw).findall('./channel/item'))
        items=[]
        seen=set()
        for item in entries:
            date=email.utils.parsedate_to_datetime(item.findtext('pubDate')).astimezone(dt.timezone.utc)
            if not START <= date.date() <= END: continue
            source=item.find('source')
            publisher=source.text if source is not None else 'News'
            title=html.unescape(item.findtext('title',''))
            if title.endswith(' - '+publisher): title=title[:-len(publisher)-3]
            if any(x in (title+' '+publisher).casefold() for x in ['rashifal','राशिफल','cbc gem','horoscope','crossword','sudoku','lottery','zeit shop','forum.hani','जनसत्ता न्यूज डेस्क','exclusive news stories','news videos in hindi','tin tức, sự kiện liên quan','live2 digital','stuff quiz','pdf::','edicionpapel','hausa.premiumtimes','運気','運勢','画像・写真','hatsarin','yaw on','yawon','priya mehra']): continue
            if not title or title.casefold() in seen: continue
            seen.add(title.casefold())
            link=item.findtext('link','')
            if not link.startswith('https://'): continue
            items.append({'id':hashlib.sha256((code+link).encode()).hexdigest()[:12],'country':code,'title':title,'date':date.isoformat(),'source':publisher,'sourceUrl':source.get('url','') if source is not None else '', 'url':link,'lang':lang,'direction':'rtl' if lang=='ar' else 'ltr'})
        # Balanced weekly sample and publisher diversity. Dates are never synthesized.
        selected=[]; publishers={}
        for week in range(5):
            pool=[x for x in items if min(4,(dt.date.fromisoformat(x['date'][:10])-START).days//7)==week]
            for x in pool:
                if publishers.get(x['source'],0)>=2: continue
                selected.append(x); publishers[x['source']]=publishers.get(x['source'],0)+1
                if len([a for a in selected if a in pool])>=4: break
        return {'code':code,'name':name,'ko':ko,'region':region,'lang':lang,'language':language},selected,None
    except Exception as e:
        return {'code':code,'name':name,'ko':ko,'region':region,'lang':lang,'language':language},[],str(e)

if __name__=='__main__':
    countries=[]; articles=[]; failures=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for country,items,error in pool.map(collect,COUNTRIES):
            countries.append(country); articles.extend(items)
            print(country['code'],len(items),error or '',flush=True)
            if error: failures.append({'country':country['code'],'error':error})
    if not articles: raise SystemExit('No verified articles; existing snapshot preserved.')
    articles.sort(key=lambda x:x['date'],reverse=True)
    data={'start':START.isoformat(),'end':END.isoformat(),'collectedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'countries':countries,'articles':articles,'failures':failures}
    target=ROOT/'news.js'
    temp=target.with_suffix('.tmp')
    temp.write_text('window.NEWS = '+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n')
    temp.replace(target)
    print('TOTAL',len(articles),'COUNTRIES',len({x['country'] for x in articles}))
