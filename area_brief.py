"""Daily area brief: Tazewell County, Virginia (24651) at the centre, and the
region out to 200 miles around it, in one report.

Run each morning by .github/workflows/area-brief.yml. Law enforcement and
courts, fire/EMS/rescue, hazards (weather, roads, power, water), and local and
state politics for Tazewell County -- Tazewell, North Tazewell, Richlands,
Cedar Bluff, Bluefield VA -- and across the line into Bluefield WV and Mercer
County, with the neighbouring counties watched for anything that spills over.

Each section runs from Tazewell outward: the county and its towns first, then the
wider region (southern WV, eastern KY, northeast TN, southwest VA, northwest NC)
for what matters there. One Grok call.

Like the main brief it gathers free leads first (National Weather Service
alerts for the counties, and local headlines from Google News and the area's
outlets) so Grok's paid searches go to X and to detail.

It uses only the GROK_API_KEY secret. The brief is written to
data/area/tazewell.json and the page keeps it out of sight until the owner's
hidden gesture. It is hidden, not locked: the repository is public.

    python3 area_brief.py            # collect and write
    python3 area_brief.py --dry-run  # only collect the free leads and print them
"""
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from urllib.parse import quote_plus
from zoneinfo import ZoneInfo

import requests

from generate_brief_final import parse_feed

OUT = 'data/area/tazewell.json'
HOURS = 36                    # look-back for leads; the brief reports the last 24 h first
SEARCH_BUDGET = int(os.environ.get('AREA_SEARCH_BUDGET') or 12)   # 8 for the county, ~4 more for the region
# The owner wants names and specifics: people are named as the source names
# them (minors stay unnamed, as the sources leave them). Set False to describe
# private people by role and town instead ("a Richlands man, 34").
NAME_PRIVATE = True

UA = {'User-Agent': 'TridentBrief/1.0 (github.com/TridentIntelFree/Trident-Brief)'}

# NWS county codes: Tazewell, Buchanan, Russell, Smyth, Bland VA; Mercer, McDowell WV.
NWS_ZONES = 'VAC185,VAC027,VAC167,VAC173,VAC021,WVC055,WVC047'

PLACES = re.compile(
    r'tazewell|richlands|cedar bluff|bluefield|pocahontas|raven\b|doran|claypool hill|pounding mill|'
    r'springville|falls mills|boissevain|abbs valley|bandy|jewell ridge|amonate|'
    r'mercer county|princeton|bluewell|bramwell|mcdowell|welch|bland\b|buchanan county|grundy|'
    r'russell county|lebanon, va|honaker|southwest virginia|swva|clinch valley|wytheville', re.I)

GNEWS = ['"Tazewell County" Virginia', 'Richlands Virginia', '"Cedar Bluff" Virginia',
         'Bluefield police OR sheriff OR crash OR fire', '"Tazewell" sheriff OR "state police"',
         '"Mercer County" WV sheriff OR crash OR fire', '"Tazewell County" "Board of Supervisors"']

OUTLETS = [  # local outlets' own feeds; only items naming a place in the area are kept
    ('WVVA', 'https://www.wvva.com/arc/outboundfeeds/rss/?outputType=xml'),
    ('Bluefield Daily Telegraph', 'https://www.bdtonline.com/search/?f=rss&t=article&l=50&s=start_time&sd=desc'),
    ('Richlands News-Press', 'https://www.richlands-news-press.com/search/?f=rss&t=article&l=50&s=start_time&sd=desc'),
    ('WJHL', 'https://www.wjhl.com/feed/'),
    ('WVNS 59News', 'https://www.wvnstv.com/feed/'),
    ('Cardinal News', 'https://cardinalnews.org/feed/'),
    ('Lootpress', 'https://www.lootpress.com/feed/'),
    ('WOAY', 'https://woay.com/feed/'),
]
# Listings that match a town name but are not news: game streams, obituaries.
JUNK = re.compile(r'NFHS|watch live|on demand|\bvs\.? .* - (girls|boys)|obituar|legacy\.com|- legacy\b|'
                  r'funeral home|tributes?\b', re.I)


def gnews_url(q):
    return ('https://news.google.com/rss/search?q=' + quote_plus(q + ' when:2d') +
            '&hl=en-US&gl=US&ceid=US:en')


def fetch_feed(label, url, since, filt):
    r = requests.get(url, timeout=15, headers=dict(UA, Accept='application/rss+xml, application/xml, text/xml'))
    if r.status_code != 200:
        raise RuntimeError(f'HTTP {r.status_code}')
    try:
        got = parse_feed(r.content)
    except Exception:
        # Some local CMS feeds carry bare ampersands or control characters.
        clean = re.sub(rb'&(?!#?\w+;)', b'&amp;', r.content)
        got = parse_feed(re.sub(rb'[\x00-\x08\x0b\x0c\x0e-\x1f]', b'', clean))
    out = []
    for i in got:
        if i['time'] and i['time'] < since:
            continue
        if filt and not PLACES.search(i['title'] + ' ' + i['summary']):
            continue
        if JUNK.search(i['title']):
            continue
        i['src'] = label
        out.append(i)
    return out


def nws_alerts():
    r = requests.get('https://api.weather.gov/alerts/active?zone=' + NWS_ZONES, timeout=20,
                     headers=dict(UA, Accept='application/geo+json'))
    if r.status_code != 200:
        raise RuntimeError(f'HTTP {r.status_code}')
    out = []
    for f in r.json().get('features') or []:
        p = f.get('properties') or {}
        out.append(f"{p.get('event', '?')} -- {p.get('areaDesc', '')} -- until {p.get('ends') or p.get('expires') or '?'}"
                   f" -- {(p.get('headline') or '')[:160]}")
    return out


def collect():
    since = datetime.now(timezone.utc) - timedelta(hours=HOURS)
    detail, items = {}, []
    jobs = [('Google News: ' + q, gnews_url(q), False) for q in GNEWS] + [(l, u, True) for l, u in OUTLETS]

    def run(job):
        label, url, filt = job
        try:
            return label, fetch_feed(label.split(':')[0] if label.startswith('Google') else label, url, since, filt), None
        except Exception as e:
            return label, None, str(e)[:80]

    with ThreadPoolExecutor(max_workers=6) as ex:
        for label, got, err in ex.map(run, jobs):
            detail[label] = 'ERR ' + err if got is None else len(got)
            items += got or []
    # the same story turns up under several queries
    seen, uniq = set(), []
    for i in sorted(items, key=lambda i: i['time'] or since, reverse=True):
        k = re.sub(r'\W+', ' ', i['title'].lower()).strip()[:70]
        if k in seen:
            continue
        seen.add(k)
        uniq.append(i)
    try:
        alerts = nws_alerts()
        detail['NWS alerts'] = len(alerts)
    except Exception as e:
        alerts = []
        detail['NWS alerts'] = 'ERR ' + str(e)[:80]
    return uniq[:60], alerts, detail


def prompt_for(now, heads, alerts):
    et = now.astimezone(ZoneInfo('America/New_York'))
    lines = '\n'.join(f"- {i['time'].strftime('%d %b %H:%MZ') if i['time'] else 'undated'} | {i['src']} | "
                      f"{i['title']} | {i['url']}" for i in heads) or '- (no headlines came back)'
    warn = '\n'.join('- ' + a for a in alerts) or '- none active'
    names = ('Give names and specifics as the source reports them: full names, ages and hometowns of those '
             'charged, arrested, wanted, missing or killed; the exact charges, bond, jail, court and next court '
             'date; the road, intersection or address; the agencies and officers involved; times. Write '
             '"charged with" and "alleged" -- a charge is not a conviction. Do not name minors unless an official '
             'source does.' if NAME_PRIVATE else
             'Do not name private individuals -- suspects, defendants, victims, patients, minors. Describe them by '
             'role, age if given, and town ("a 34-year-old Richlands man"). Name agencies, officials, candidates '
             'and public figures.')
    return f"""AREA BRIEF -- TAZEWELL, VIRGINIA (ZIP 24651) AND 200 MILES AROUND IT
Today is {et:%A %d %B %Y} (Eastern). It is {now:%H:%M} UTC.

AREA: one report with Tazewell at the centre, working outward.
- THE CORE, covered in full: Tazewell County, Virginia (Tazewell, North Tazewell, Richlands, Cedar Bluff,
  Bluefield VA, Pocahontas, Raven, Doran, Claypool Hill, Pounding Mill, Springville, Falls Mills, Jewell
  Ridge) and across the state line Bluefield WV and Mercer County WV (Princeton, Bluewell, Bramwell); the
  neighbouring counties (Buchanan, Russell, Smyth, Bland VA; McDowell WV) when it touches the core.
- THE REGION, out to about 200 miles, for what is significant there: southwest and southside Virginia
  (Roanoke, Blacksburg, Bristol, Abingdon, Wise, Danville), southern West Virginia (Beckley, Charleston,
  Logan, Huntington), eastern Kentucky (Pikeville, Hazard, Harlan, Ashland), northeast Tennessee
  (Tri-Cities, Knoxville) and northwest North Carolina (Boone, Wilkesboro, Winston-Salem). In the region,
  report the bigger things: manhunts and major cases, crime and drug trends across counties, state
  government actions that land on the area, big employers and energy, severe weather and interstate closures.

In every section list the core first, then the region, nearest first. Give every item its place: town,
county and state.

PRIORITIES, in this order:
1. LAW ENFORCEMENT AND COURTS -- Tazewell County Sheriff's Office; Virginia State Police (Division IV);
   Richlands, Tazewell, Bluefield VA, Cedar Bluff and Bluefield WV police; Mercer County Sheriff; WV State
   Police (Princeton). Arrests and charges, investigations, pursuits, drug seizures, shootings, missing
   persons, wanted notices, court and sentencing outcomes, jail matters (Southwest Virginia Regional Jail).
   In the region: state police, large sheriff and city cases, federal cases (FBI, DEA, ATF, US Attorneys for
   the Western District of Virginia and Southern District of West Virginia), crime and drug trends.
2. FIRE, EMS AND RESCUE -- structure fires, serious crashes and road closures from crashes, rescues,
   mine or industrial incidents, hazmat, medevac calls.
3. HAZARDS -- the NWS alerts below (for the core), flooding and high water, winter weather, wildfire and burn bans, power
   outages (Appalachian Power), water or boil-water notices, VDOT and WVDOH closures on US-19, US-460,
   US-52, Route 16, Route 67, I-77. In the region: severe weather, I-77, I-81, I-64, US-460, US-19 and US-23,
   large power, water, rail or chemical incidents, health alerts.
4. GOVERNMENT AND POLITICS -- Board of Supervisors, town councils, school board, county and town budgets
   and taxes, elections and candidates, the area's state legislators, state actions that land here.
   In the region: Richmond, Charleston, Frankfort and Nashville decisions that reach this area.
5. ECONOMY AND OTHER -- employers, mines and plants opening or closing, hospitals (Carilion Tazewell, Clinch
   Valley, Bluefield), anything else a resident would want to know today. In the region: plants, mines,
   hospitals and big employers opening, closing or laying off; energy (coal, gas, power lines, data centres).

FREE LEADS, already collected -- check, use, and cite them; do not search for what they already tell you:
NWS ALERTS NOW:
{warn}
LOCAL HEADLINES, last {HOURS} hours:
{lines}

SEARCH: you have about {SEARCH_BUDGET} searches. Spend most on the core: X (local sheriff and police pages,
county and town accounts, WVVA, WJHL, WCYB, Bluefield Daily Telegraph, local scanner and community accounts)
and the web for detail the headlines lack. Spend about four on the region (state police, emergency
management, WDBJ, WSLS, WCHS, WSAZ, WYMT, WBIR). Keep queries short and specific.

RULES
- The last 24 hours first; older items only if still developing, and say how old.
- Report only what you retrieved in this session. Every item gets its own working link, inline as
  [source](url). Never reuse one link for a different item.
- {names}
- Give times as local Eastern time ("10:40 p.m. Saturday"), with the source's date where it matters.
- Mark each item [OSINT - NEWS], [OSINT - WEB] (official pages), [SIGINT - VERIFIED] (an agency's own
  statement or post) or [HUMINT - LOCAL CHATTER] (scanner and community posts, unconfirmed).
- A section with nothing verifiable is one line: "Nothing reported in the last 24 hours." Do not pad.
- Plain, factual, short. No speculation about guilt.

FORMAT (markdown)
**BLUF:** two or three sentences: what matters most today, in Tazewell first, then the region.

## LAW ENFORCEMENT AND COURTS
## FIRE, EMS AND RESCUE
## HAZARDS, WEATHER AND ROADS
## GOVERNMENT AND POLITICS
## ECONOMY AND OTHER
## WATCH -- NEXT 48 HOURS
(scheduled meetings, court dates, forecast hazards, anything developing)
"""


def ask_grok(prompt, key):
    r = requests.post('https://api.x.ai/v1/responses', timeout=300,
                      headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {key}'},
                      json={'model': 'grok-4-1-fast-reasoning',
                            'input': [{'role': 'system', 'content':
                                       'You are a local intelligence analyst for Tazewell County, Virginia, and the '
                                       'region within 200 miles of it. You write a short, factual daily area brief from '
                                       'local news, official pages and X posts, Tazewell first, citing every item.'},
                                      {'role': 'user', 'content': prompt}],
                            'tools': [{'type': 'x_search', 'from_date':
                                       (datetime.now(timezone.utc) - timedelta(days=2)).strftime('%Y-%m-%d')},
                                      {'type': 'web_search'}],
                            'temperature': 0.4,
                            'max_output_tokens': 9000})
    if r.status_code == 400 and 'from_date' in r.text:
        return ask_grok_plain(prompt, key)
    if r.status_code != 200:
        raise RuntimeError(f'xAI answered HTTP {r.status_code}: {r.text[:200]}')
    return _text(r.json())


def ask_grok_plain(prompt, key):
    r = requests.post('https://api.x.ai/v1/responses', timeout=300,
                      headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {key}'},
                      json={'model': 'grok-4-1-fast-reasoning',
                            'input': [{'role': 'user', 'content': prompt}],
                            'tools': [{'type': 'x_search'}, {'type': 'web_search'}],
                            'temperature': 0.4, 'max_output_tokens': 9000})
    if r.status_code != 200:
        raise RuntimeError(f'xAI answered HTTP {r.status_code}: {r.text[:200]}')
    return _text(r.json())


def _text(data):
    parts = [b.get('text', '') for item in data.get('output', []) if item.get('type') == 'message'
             for b in item.get('content', []) if b.get('type') in ('output_text', 'text')]
    text = '\n'.join(parts) or data.get('output_text') or ''
    if not text.strip():
        raise RuntimeError('xAI returned no text')
    ticks = (data.get('usage') or {}).get('cost_in_usd_ticks')
    return text.strip(), (round(ticks / 1e10, 4) if isinstance(ticks, int) else None)


def main():
    now = datetime.now(timezone.utc)
    heads, alerts, detail = collect()
    print('leads:', json.dumps(detail, indent=1))
    print(f'{len(heads)} headlines kept, {len(alerts)} NWS alerts')
    if '--dry-run' in sys.argv:
        for i in heads[:25]:
            print(' ', i['time'] and i['time'].strftime('%d %H:%MZ'), '|', i['src'], '|', i['title'][:110])
        for a in alerts:
            print('  ALERT', a[:140])
        return
    key = os.environ.get('GROK_API_KEY', '')
    if not key:
        sys.exit('The GROK_API_KEY secret is not set.')
    text, cost = ask_grok(prompt_for(now, heads, alerts), key)
    print(f'area brief: {len(text)} characters' + (f', cost ${cost:.3f}' if cost is not None else ''))
    payload = {'area': 'Tazewell, VA and 200 miles around', 'at': now.strftime('%Y-%m-%dT%H:%M:%SZ'), 'brief': text,
               'cost_usd': cost, 'leads': {'headlines': len(heads), 'alerts': len(alerts)}}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(dict(v=1, **payload), f, separators=(',', ':'))
    print('written:', OUT)


if __name__ == '__main__':
    main()
