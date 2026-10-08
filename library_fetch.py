"""Survival library: real public-domain manuals, kept with the site so the
trail map can open them with no signal.

Every document here is a work of the US federal government, which is in the
public domain in the United States (17 U.S.C. 105). The page lists them under
the survival guide; a visitor saves them to their phone with one button.

Run by .github/workflows/library.yml (on change, and monthly to pick up new
editions). Each file must be a PDF under 30 MB, or it is skipped and the old
copy kept. Writes library/<id>.pdf and library/index.json."""
import hashlib, json, os, re, sys, time
from datetime import datetime, timezone

import requests

DOCS = [
    {'id': 'army-atp-3-50-21-survival',
     'title': 'Survival (ATP 3-50.21)',
     'publisher': 'US Army', 'year': 2018,
     'about': 'The Army’s survival manual: priorities, shelter, water, fire, food, navigation, signalling, first aid and travel.',
     'url': 'https://irp.fas.org/doddir/army/atp3-50-21.pdf',
     'also': ['https://www.globalsecurity.org/military/library/policy/army/atp/atp3-50-21.pdf'],
     'note': 'Approved for public release; distribution is unlimited. Copy hosted by the Federation of American Scientists.'},
    {'id': 'nws-lightning-outdoors',
     'title': 'Lightning: Don’t Get Caught Outside',
     'publisher': 'NOAA National Weather Service', 'year': 2018,
     'about': 'What to do when a storm catches you outdoors, from the people who forecast them.',
     'url': 'https://www.weather.gov/media/safety/Lightning-Brochure18.pdf', 'note': ''},
    {'id': 'cdc-tick-removal',
     'title': 'Tick Removal',
     'publisher': 'CDC', 'year': 2025,
     'about': 'How to take a tick off, and what to watch for afterwards.',
     'url': 'https://www.cdc.gov/ticks/media/pdfs/2025/07/CDC_Tick_Removal_Fact_Sheet.pdf', 'note': ''},
    {'id': 'msha-abandoned-mines',
     'title': 'Stay Out of Abandoned Mines',
     'publisher': 'Mine Safety and Health Administration', 'year': None,
     'about': 'Why old mine openings kill: bad air, collapse, hidden shafts. Coal country is full of them.',
     'url': 'https://www.msha.gov/sites/default/files/Alerts%20and%20Hazards/Safety%20Alert%20-%20Abandoned%20Mines.pdf', 'note': ''},
]
OUT = 'library'
MAX = 30 * 1024 * 1024
UA = 'TridentBrief-library/1.0 (+https://github.com/TridentIntelFree/Trident-Brief)'
# Some government and archive sites answer scripts with a bot check page. As
# the feed collector does, ask honestly first, then as an ordinary browser.
BROWSER = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
           'Chrome/124.0 Safari/537.36')


def get_pdf(urls):
    why = []
    for u in urls:
        for ua in (UA, BROWSER):
            try:
                r = requests.get(u, headers={'User-Agent': ua, 'Accept': 'application/pdf,*/*'}, timeout=120)
                if r.ok and r.content.startswith(b'%PDF'):
                    return r.content, u
                why.append('%s %s %s %r' % (u.split('/')[2], r.status_code, r.headers.get('content-type', '?'), r.content[:60]))
            except Exception as e:
                why.append('%s %s' % (u.split('/')[2], e))
            time.sleep(1)
    raise ValueError('no PDF: ' + ' | '.join(why)[:600])


def pages(blob):
    return len(re.findall(rb'/Type\s*/Page(?![s\w])', blob)) or None


def main():
    os.makedirs(OUT, exist_ok=True)
    try:
        old = {d['id']: d for d in json.load(open(os.path.join(OUT, 'index.json')))['docs']}
    except Exception:
        old = {}
    docs = []
    for d in DOCS:
        path = os.path.join(OUT, d['id'] + '.pdf')
        entry = dict(d, file=path)
        entry.pop('also', None)
        try:
            blob, used = get_pdf([d['url']] + d.get('also', []))
            entry['url'] = used
            if len(blob) > MAX:
                raise ValueError('larger than 30 MB')
            with open(path, 'wb') as f:
                f.write(blob)
            entry.update(bytes=len(blob), pages=pages(blob), sha256=hashlib.sha256(blob).hexdigest(),
                         fetched_at=datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))
            print('ok  ', d['id'], len(blob), 'bytes', entry['pages'], 'pages')
        except Exception as e:
            print('FAIL', d['id'], e, file=sys.stderr)
            if d['id'] in old and os.path.exists(path):
                entry = dict(old[d['id']], **{k: d[k] for k in ('title', 'publisher', 'year', 'about', 'url', 'note')})
                entry['last_error'] = str(e)[:200]
            else:
                continue
        docs.append(entry)
        time.sleep(1)
    json.dump({'built_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
               'license': 'Works of the US federal government: public domain in the United States (17 U.S.C. 105).',
               'docs': docs}, open(os.path.join(OUT, 'index.json'), 'w'), indent=1)
    print(len(docs), 'of', len(DOCS), 'documents in the library')


if __name__ == '__main__':
    main()
