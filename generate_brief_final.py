import json
import math
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from html import escape

import requests

CACHE_FILE = 'latest-brief.json'
TEMPLATE_FILE = 'template.html'
ARCHIVE_DIR = 'archive'
WINDOW_HOURS = int(os.environ.get('COLLECTION_WINDOW_HOURS', '12'))
MAX_OUTPUT_TOKENS = int(os.environ.get('MAX_OUTPUT_TOKENS', '6000'))
WATCHLIST_FILE = 'watchlist.json'
SYSTEM_PROMPT = ('You are a SIGINT/HUMINT fusion analyst with real-time X/Twitter access and web search capabilities. Monitor verified official sources (SIGINT) and unverified local accounts (HUMINT/CHATTER). Also search the broader web for news, government sites, and intelligence sources. Distinguish between confirmed intelligence and uncorroborated chatter. Use professional intelligence terminology. Search X and the web RIGHT NOW.')
SLOW_SECTIONS = '## 3. UAP/UFO\nSearch: @DeptofDefense @AARO_DOD_Info @SenGillibrand @RepTimBurchett;\n@ChrisKMellon @LueElizondo @rosscoulthart; web: The Black Vault, The Debrief,\nLiberation Times, AARO releases, congressional records.\nFocus: official statements, hearings, document releases, sensor data. Distinguish\nofficial positions from advocacy claims. This section is frequently empty - that is fine.\n\n## 4. PARAPSYCHOLOGY AND CONSCIOUSNESS RESEARCH\nSearch: web only - Nature, Science, arXiv, PubMed, university press releases.\nFocus: peer-reviewed publications and funded programs. Note methodological criticism and\nreplication status. Ignore popular-press speculation. Frequently empty - that is fine.'


def generate_with_grok(prompt):
    api_key = os.environ.get('GROK_API_KEY')
    if not api_key:
        return None, "No Grok API key"
    
    try:
        response = requests.post(
            'https://api.x.ai/v1/responses',
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {api_key}'
            },
            json={
                'model': 'grok-4-1-fast-reasoning',
                'input': [
                    {
                        'role': 'system',
                        'content': SYSTEM_PROMPT
                    },
                    {
                        'role': 'user',
                        'content': prompt
                    }
                ],
                'tools': [
                    {'type': 'x_search'},
                    {'type': 'web_search'}
                ],
                'temperature': 0.6,
                'max_output_tokens': MAX_OUTPUT_TOKENS
            },
            timeout=180
        )

        # A reasoning model with no ceiling is an open-ended bill. If this
        # deployment rejects the cap, retry once uncapped rather than lose the run.
        if response.status_code == 400 and 'max_output_tokens' in response.text:
            print('  max_output_tokens rejected; retrying uncapped')
            response = requests.post(
                'https://api.x.ai/v1/responses',
                headers={'Content-Type': 'application/json',
                         'Authorization': f'Bearer {api_key}'},
                json={'model': 'grok-4-1-fast-reasoning',
                      'input': [{'role': 'system', 'content': SYSTEM_PROMPT},
                                {'role': 'user', 'content': prompt}],
                      'tools': [{'type': 'x_search'}, {'type': 'web_search'}],
                      'temperature': 0.6},
                timeout=180)
        
        if response.status_code == 200:
            data = response.json()
            text_parts = []
            for item in data.get('output', []):
                if item.get('type') == 'message':
                    for block in item.get('content', []):
                        if block.get('type') in ('output_text', 'text'):
                            text_parts.append(block.get('text', ''))
            if not text_parts and data.get('output_text'):
                text_parts.append(data['output_text'])
            if text_parts:
                return '\n'.join(text_parts), None
            else:
                return None, f"Grok returned no text. Keys: {list(data.keys())}"
        else:
            return None, f"Grok error: {response.status_code} - {response.text[:200]}"
    except Exception as e:
        return None, str(e)

def generate_with_groq(prompt):
    api_key = os.environ.get('GROQ_API_KEY')
    if not api_key:
        return None, "No Groq API key"
    
    try:
        response = requests.post(
            'https://api.groq.com/openai/v1/chat/completions',
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json'
            },
            json={
                'model': 'llama-3.3-70b-versatile',
                'messages': [{'role': 'user', 'content': prompt}],
                'temperature': 0.6,
                'max_tokens': 4000
            },
            timeout=60
        )
        
        if response.status_code == 200:
            return response.json()['choices'][0]['message']['content'], None
        return None, "Groq error"
    except Exception as e:
        return None, str(e)



# ---------------------------------------------------------------- prompt ----

def load_watchlist():
    """Standing intelligence requirements, injected into every prompt.

    Roughly 200 tokens, and it does more for signal than any other change:
    without it the tasking is generic and returns whatever the model happens
    to find.
    """
    try:
        with open(WATCHLIST_FILE, 'r', encoding='utf-8') as f:
            w = json.load(f)
    except Exception as e:
        print(f"  no watchlist ({e}); collection will be untargeted")
        return ''
    parts = []
    for key, label in (('actors', 'ACTORS'), ('regions', 'REGIONS'), ('topics', 'TOPICS')):
        vals = [str(v).strip() for v in (w.get(key) or []) if str(v).strip()]
        if vals:
            parts.append(f'{label}: ' + '; '.join(vals[:12]))
    if not parts:
        return ''
    return ('\n=== STANDING REQUIREMENTS (highest priority) ===\n'
            'Anything matching these outranks general coverage. Search for them by name\n'
            'even if nothing surfaced organically, and tag matching items [PRIORITY].\n'
            + '\n'.join(parts) + '\n')


def deep_run(now):
    """Whether to collect the slow-moving sections this run.

    UAP and consciousness research returned "No verifiable developments in
    window" in every brief on file, yet each run still paid for x_search and
    web_search against both. They are collected once a day instead of twice.
    """
    mode = os.environ.get('COLLECTION_DEPTH', 'auto').lower()
    if mode in ('deep', 'full'):
        return True
    if mode in ('core', 'shallow'):
        return False
    return now.hour < 12


def previous_digest(previous):
    """Condense the last brief into a short list of what was already reported.

    Fed back to the model so a run twice a day reports the delta instead of
    restating the morning's items.
    """
    if not previous:
        return "None available. This is the first brief; report the full window."
    lines = []
    for raw in previous.splitlines():
        line = raw.strip()
        if not line or line.startswith('```'):
            continue
        if line.startswith(('#', '-', '*', '**[', '[')) or '**' in line:
            clean = re.sub(r'\[\[\d+\]\]\([^)]*\)', '', line)
            clean = re.sub(r'[#*`]', '', clean).strip()
            if len(clean) > 24:
                lines.append('- ' + clean[:200])
        if len(lines) >= 30:
            break
    return '\n'.join(lines) if lines else "Previous brief contained no parseable items."


def build_prompt(window_start, window_end, prev_digest, watchlist='', deep=True):
    slow_sections = SLOW_SECTIONS if deep else (
        '(Sections 3 and 4 - UAP and consciousness research - are collected on the\n'
        'daily deep run only. Do not search for or report them now.)')
    return f"""MULTI-INT COLLECTION TASKING

COLLECTION WINDOW: {window_start:%Y-%m-%d %H:%M} UTC to {window_end:%Y-%m-%d %H:%M} UTC
Today's date is {window_end:%d %B %Y}. This brief runs multiple times per day.

You have x_search and web_search. Use them for every section before writing anything.

=== RULE 1: VERIFICATION (this rule outranks every other instruction) ===
Every factual claim must trace to a source you actually retrieved during THIS task.
- If you did not retrieve it, do not write it.
- Never reconstruct a quote, timestamp, handle, headline, figure or URL from memory,
  training data, or inference. A plausible-sounding detail you did not read is a fabrication.
- No illustrative, representative, hypothetical or "example" items. None.
- If searches return little, the correct output is a short brief. A short accurate brief
  is a success. A padded one is a failure.
- Do not adjust real-world facts to fit the requested date. If your searches surface
  nothing inside the window, say so plainly rather than inventing events to fill it.

=== RULE 2: OMIT WHAT IS EMPTY ===
The account lists below are search starting points, NOT a checklist to report against.
- Never write that an account "had no significant posts" or "no announcements in window".
  If a source had nothing, it simply does not appear.
- If an entire section has no verifiable developments, output the heading followed by the
  single line: No verifiable developments in window.
- Prefer five substantiated items over twenty thin ones.

=== RULE 3: REPORT THE DELTA ===
Already reported in the previous brief — do NOT restate these. Report only what is new,
advanced, contradicted or resolved since. If a prior item materially changed, say what
changed and how.

{prev_digest}

=== RULE 4: ATTRIBUTION ===
Every item carries: classification tag, source (handle or outlet), UTC timestamp, and a
working URL as a markdown link. Where two independent sources agree, say so and upgrade
confidence. Where they conflict, present both and say they conflict.

CLASSIFICATION TAGS:
[SIGINT - VERIFIED]      Official government, military or institutional account
[HUMINT - ASSESSED]      Named journalist or analyst with a track record
[HUMINT - CHATTER]       Unverified local or citizen report - REQUIRES CORROBORATION
[OSINT - CONFIRMED]      Independently corroborated by two or more sources
[OSINT - WEB]            Named publication, government portal or research institution

{watchlist}
=== SECTIONS ===

## 1. GEOPOLITICAL AND MILITARY
Search: @POTUS @StateDept @SecDef @DeptofDefense @NATO @CENTCOM @INDOPACOM @ZelenskyyUa
@DefenceU @IDF @IsraeliPM; analysts @christogrozev @RALee85 @Osinttechnical @Conflicts;
web: Reuters, AP, BBC, Defense One, ISW (understandingwar.org), Al Jazeera.
Focus: troop movements, strikes, diplomatic shifts, sanctions, arms transfers, alliances.
Ukraine-Russia and the Middle East must each be addressed or explicitly marked quiet.

## 2. TECHNOLOGY AND CYBERSECURITY
Search: @elonmusk @sama @satyanadella @OpenAI @xAI @USCYBERCOM @CISAgov @FBI;
researchers @briankrebs @SwiftOnSecurity @thegrugq; web: Ars Technica, Wired,
Krebs on Security, BleepingComputer, CISA.gov.
Focus: active exploitation, breaches, model releases with substantive capability claims,
regulatory action. Skip routine product marketing.

{slow_sections}

=== OUTPUT FORMAT ===
Markdown. Start with a 3-5 line BLUF covering the window overall, then the sections above.
Under each: items as bullets, then a short "Assessment" on what it means, then
"Collection gaps" naming what you could not verify.

=== REQUIRED FINAL BLOCK: GEOLOCATED EVENTS ===
After all prose, output a single fenced json code block, and nothing after it. One entry
for each reported item that has a real physical location. Omit items with no location
(policy, research, online-only) rather than inventing coordinates.

```json
{{"events":[
  {{"lat":44.72,"lon":37.77,"place":"Novorossiysk, Russia","headline":"one line, under 100 chars","section":"geopolitical","classification":"SIGINT - VERIFIED","confidence":"high","priority":4,"url":"https://..."}}
]}}
```

Rules for this block: lat/lon numeric decimal degrees for the place the event occurred;
section is one of geopolitical, technology, uap, research; confidence is high, medium or
low; priority is 1-5, where 5 demands immediate attention and 1 is routine, scored
higher for anything matching the standing requirements above; url must be one you
actually retrieved. Valid JSON only, no comments, no trailing
commas. If there are no locatable events, output {{"events":[]}}.

Begin collection now."""


# ---------------------------------------------------------- event parsing ----

def extract_events(text):
    """Pull the trailing geolocated-events JSON block out of the model output.

    Returns (events, prose). The block is stripped from the prose so it is never
    rendered as a code fence on the page.
    """
    if not text:
        return [], text
    matches = list(re.finditer(r'```json\s*(.*?)```', text, re.DOTALL))
    for m in reversed(matches):
        try:
            payload = json.loads(m.group(1).strip())
        except Exception:
            continue
        raw = payload.get('events') if isinstance(payload, dict) else payload
        if not isinstance(raw, list):
            continue
        events = []
        for e in raw:
            if not isinstance(e, dict):
                continue
            try:
                lat, lon = float(e['lat']), float(e['lon'])
            except (KeyError, TypeError, ValueError):
                continue
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                continue
            try:
                pri = max(1, min(5, int(e.get('priority', 3))))
            except (TypeError, ValueError):
                pri = 3
            events.append({
                'lat': lat,
                'lon': lon,
                'priority': pri,
                'place': str(e.get('place', ''))[:120],
                'headline': str(e.get('headline', ''))[:240],
                'section': str(e.get('section', 'geopolitical'))[:40],
                'classification': str(e.get('classification', ''))[:40],
                'confidence': str(e.get('confidence', ''))[:20],
                'url': str(e.get('url', ''))[:500],
            })
        prose = (text[:m.start()] + text[m.end():]).strip()
        print(f"Parsed {len(events)} geolocated events from model output")
        return events, prose
    print("No parseable geolocated-events block in model output")
    return [], text


# ---------------------------------------------------------- server feeds ----

def _get(url, timeout=20):
    r = requests.get(url, timeout=timeout, headers={
        'Accept': 'application/json',
        # api.weather.gov rejects clients without a descriptive UA
        'User-Agent': 'TridentBrief/1.0 (github.com/TridentIntelFree/Trident-Brief)',
    })
    if r.status_code != 200:
        raise RuntimeError(f'HTTP {r.status_code}: {r.text[:120]}')
    return r.json()


def _try(urls, timeout=20):
    """First URL that answers wins. Returns (data, None) or (None, reason)."""
    last = 'no url tried'
    for u in urls:
        try:
            return _get(u, timeout), None
        except Exception as e:
            last = str(e)[:160]
            print(f"    {u.split('?')[0]} -> {last}")
    return None, last


def _centroid(geom):
    """Mean position of a GeoJSON Polygon/MultiPolygon exterior ring."""
    if not geom:
        return None
    t, c = geom.get('type'), geom.get('coordinates')
    try:
        if t == 'Point':
            return float(c[1]), float(c[0])
        ring = c[0] if t == 'Polygon' else c[0][0] if t == 'MultiPolygon' else None
        if not ring:
            return None
        pts = [(float(y), float(x)) for x, y in ring if -90 <= float(y) <= 90]
        if not pts:
            return None
        return sum(p[0] for p in pts)/len(pts), sum(p[1] for p in pts)/len(pts)
    except Exception:
        return None


def _alert(f):
    p = f.get('properties') or {}
    a = {'event': (p.get('event') or '')[:80], 'area': (p.get('areaDesc') or '')[:120],
         'severity': p.get('severity') or '', 'expires': p.get('expires')}
    ll = _centroid(f.get('geometry'))
    if ll:
        a['lat'], a['lon'] = round(ll[0], 3), round(ll[1], 3)
    return a


def _launch(l):
    pad = l.get('pad') or {}
    out = {'name': (l.get('name') or '')[:120], 'net': l.get('net'),
           'status': ((l.get('status') or {}).get('abbrev') or ''),
           'pad': ((pad.get('location') or {}).get('name') or pad.get('name') or '')[:120]}
    try:
        lat, lon = float(pad.get('latitude')), float(pad.get('longitude'))
        if -90 <= lat <= 90 and -180 <= lon <= 180:
            out['lat'], out['lon'] = lat, lon
    except (TypeError, ValueError):
        pass
    return out


def fetch_disasters():
    """GDACS global disaster alerts -- floods, cyclones, volcanoes, wildfires.

    No key, worldwide, and already geolocated. Best effort: if the shape is not
    what we expect the layer is simply absent.
    """
    # GDACS rejects a request without eventtype ("Eventtype is required"), and
    # the accepted parameter set varies by endpoint, so try progressively
    # simpler forms rather than relying on one.
    types = 'EQ;TC;FL;VO;DR;WF'
    d, err = _try([
        f'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist={types}&alertlevel=Green;Orange;Red',
        f'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventtype={types}',
        f'https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventtype={types}',
        'https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventlist=EQ;TC;FL;VO',
    ], timeout=25)
    if d is None:
        return None, err
    out = []
    for f in (d.get('features') or []):
        p = f.get('properties') or {}
        ll = _centroid(f.get('geometry'))
        if not ll:
            continue
        out.append({
            'lat': round(ll[0], 3), 'lon': round(ll[1], 3),
            'kind': (p.get('eventtype') or '')[:8],
            'name': (p.get('eventname') or p.get('htmldescription') or p.get('name') or '')[:120],
            'level': (p.get('alertlevel') or '')[:10],
            'from': p.get('fromdate'),
            'url': (p.get('url') or {}).get('report', '') if isinstance(p.get('url'), dict) else '',
        })
    return out[:200], None


SKYWATCH_CATALOG = os.environ.get(
    'SKYWATCH_CATALOG',
    'https://raw.githubusercontent.com/TridentIntelFree/skywatch-unified/main/catalog.json')

# Notable objects always kept regardless of the sampling stride.
NOTABLE_SATS = {25544, 20580, 48274, 25994, 27424, 36411, 43013, 41866, 33591, 28654, 29155, 37849}
SAT_TARGET = 1600


def _tle_elements(entry):
    """[name, norad, category, tle1, tle2] -> compact mean elements, or None.

    Stored as numbers rather than raw TLE strings: the page only needs the mean
    elements to propagate, and this is roughly a third of the bytes.
    """
    try:
        name, nid, _cat, l1, l2 = entry[0], entry[1], entry[2], entry[3], entry[4]
        yy, dd = int(l1[18:20]), float(l1[20:32])
        epoch = datetime(yy + (2000 if yy < 57 else 1900), 1, 1, tzinfo=timezone.utc) \
            + timedelta(days=dd - 1)
        inc, raan = float(l2[8:16]), float(l2[17:25])
        ecc = float('0.' + l2[26:33].strip())
        argp, ma, mm = float(l2[34:42]), float(l2[43:51]), float(l2[52:63])
        if not (0 < mm < 20) or not (0 <= ecc < 1) or not (0 <= inc <= 180):
            return None
        return [str(name).strip()[:28], int(nid), round(epoch.timestamp()),
                round(inc, 4), round(raan, 4), round(ecc, 7),
                round(argp, 4), round(ma, 4), round(mm, 8)]
    except Exception:
        return None


AIR_ANCHORS = [
    (40.7, -74.0), (34.0, -118.2), (41.9, -87.6), (29.8, -95.4),
    (51.5, -0.1), (50.1, 8.7), (41.9, 12.5), (40.4, -3.7),
    (25.3, 55.3), (35.7, 139.7), (31.2, 121.5), (28.6, 77.2),
    (1.35, 103.8), (-33.9, 151.2), (-23.5, -46.6), (-26.2, 28.0),
]


# airplanes.live answers 403 to every unregistered request ("Please contact us
# at contact@airplanes.live"), so it is tried last rather than first: putting it
# ahead of the others cost a wasted round-trip on all seventeen queries.
def _ac_urls(lat, lon, nm=250):
    return [f'https://opendata.adsb.fi/api/v2/lat/{lat:.4f}/lon/{lon:.4f}/dist/{nm}',
            f'https://api.adsb.lol/v2/lat/{lat:.4f}/lon/{lon:.4f}/dist/{nm}',
            f'https://api.airplanes.live/v2/point/{lat:.4f}/{lon:.4f}/{nm}']


def fetch_aircraft():
    """Collect the air picture here rather than in the browser.

    Every ADS-B provider refuses cross-origin requests from at least some
    browsers; the Skywatch project hits the same wall and marks the layer
    'blocked' in its own code. The Actions runner has no such restriction, so
    the picture is collected server-side and served same-origin, where nothing
    can refuse it. It is a snapshot, not a live feed, and the page says so.
    """
    seen, out = set(), []

    def take(rows, mil=False):
        for a in rows or []:
            lat, lon = a.get('lat'), a.get('lon')
            if lat is None or lon is None:
                continue
            key = a.get('hex') or a.get('r') or a.get('flight')
            if not key or key in seen:
                continue
            seen.add(key)
            rec = {'hex': key, 'flight': (a.get('flight') or '').strip()[:10],
                   't': (a.get('t') or '')[:8], 'lat': round(lat, 3), 'lon': round(lon, 3)}
            alt = a.get('alt_baro')
            if alt is not None:
                rec['alt_baro'] = alt if alt == 'ground' else int(alt)
            if a.get('gs') is not None:
                try:
                    rec['gs'] = int(a['gs'])
                except (TypeError, ValueError):
                    pass
            if a.get('squawk'):
                rec['squawk'] = str(a['squawk'])[:4]
            if mil or (a.get('dbFlags') and int(a['dbFlags']) & 1):
                rec['_mil'] = True
            out.append(rec)

    d, _ = _try(['https://opendata.adsb.fi/api/v2/mil',
                 'https://api.adsb.lol/v2/mil',
                 'https://api.airplanes.live/v2/mil'], timeout=25)
    if d:
        take(d.get('ac') or d.get('aircraft'), mil=True)
    mil_n = len(out)

    for i, (lat, lon) in enumerate(AIR_ANCHORS):
        if i:
            time.sleep(0.4)   # one anchor drew a 429 when fired back to back
        d, _ = _try(_ac_urls(lat, lon), timeout=20)
        if d:
            take(d.get('ac') or d.get('aircraft'))

    if not out:
        return None, 'no provider answered from the runner either'

    out = out[:5000]
    os.makedirs('assets', exist_ok=True)
    with open('assets/aircraft.json', 'w', encoding='utf-8') as f:
        json.dump({'fetched_at': datetime.now(timezone.utc).isoformat(),
                   'military': mil_n, 'count': len(out), 'ac': out},
                  f, separators=(',', ':'))
    print(f"  aircraft: {len(out)} ({mil_n} military) -> assets/aircraft.json "
          f"({os.path.getsize('assets/aircraft.json')//1024} KB)")
    return len(out), None


# AIS ship-and-cargo type codes worth calling out by name.
SHIP_TYPES = {
    30: 'Fishing', 31: 'Towing', 32: 'Towing (large)', 33: 'Dredging', 34: 'Diving ops',
    35: 'MILITARY OPS', 36: 'Sailing', 37: 'Pleasure craft',
    50: 'Pilot vessel', 51: 'Search and rescue', 52: 'Tug', 53: 'Port tender',
    54: 'Anti-pollution', 55: 'LAW ENFORCEMENT', 58: 'Medical transport',
}


def _ship_kind(code):
    try:
        c = int(code)
    except (TypeError, ValueError):
        return ''
    if c in SHIP_TYPES:
        return SHIP_TYPES[c]
    if 60 <= c <= 69: return 'Passenger'
    if 70 <= c <= 79: return 'Cargo'
    if 80 <= c <= 89: return 'Tanker'
    if 40 <= c <= 49: return 'High-speed craft'
    return ''


def _aisstream_global(api_key, seconds=25, cap=8000):
    """Global AIS via AISStream.io.

    AIS is VHF radio with roughly 40-60nm line of sight, so open-ocean coverage
    only exists via satellite AIS, which is commercial. AISStream aggregates
    both and gives it away on a free tier, but it needs an account key and
    speaks websocket rather than REST. We connect, subscribe to the whole
    globe, listen for a fixed window, and take a snapshot of whatever reported.
    """
    try:
        import asyncio
        import websockets
    except ImportError:
        return None, 'websockets package not installed'

    async def collect():
        seen = {}
        sub = {'APIKey': api_key,
               'BoundingBoxes': [[[-90, -180], [90, 180]]],
               'FilterMessageTypes': ['PositionReport', 'ShipStaticData']}
        async with websockets.connect('wss://stream.aisstream.io/v0/stream',
                                      ping_interval=None, max_size=None) as ws:
            await ws.send(json.dumps(sub))
            deadline = time.time() + seconds
            while time.time() < deadline and len(seen) < cap:
                left = deadline - time.time()
                if left <= 0:
                    break
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=left)
                except asyncio.TimeoutError:
                    break
                try:
                    msg = json.loads(raw)
                except Exception:
                    continue
                if msg.get('error'):
                    raise RuntimeError(str(msg['error'])[:120])
                meta = msg.get('MetaData') or {}
                mmsi = meta.get('MMSI') or meta.get('MMSI_String')
                if mmsi is None:
                    continue
                mmsi = int(mmsi)
                rec = seen.setdefault(mmsi, {'mmsi': mmsi})
                lat, lon = meta.get('latitude'), meta.get('longitude')
                if lat is not None and lon is not None:
                    rec['lat'], rec['lon'] = round(lat, 4), round(lon, 4)
                name = (meta.get('ShipName') or '').strip()
                if name:
                    rec['name'] = name[:28]
                body = (msg.get('Message') or {})
                pr = body.get('PositionReport') or {}
                if pr.get('Sog') is not None:
                    try: rec['sog'] = round(float(pr['Sog']), 1)
                    except (TypeError, ValueError): pass
                if pr.get('TrueHeading') is not None and pr['TrueHeading'] < 360:
                    rec['hdg'] = pr['TrueHeading']
                sd = body.get('ShipStaticData') or {}
                if sd.get('Type') is not None:
                    kind = _ship_kind(sd['Type'])
                    if kind:
                        rec['kind'] = kind
                        if kind in ('MILITARY OPS', 'LAW ENFORCEMENT', 'Search and rescue'):
                            rec['_mil'] = True
        return [v for v in seen.values() if 'lat' in v]

    try:
        out = asyncio.run(collect())
    except Exception as e:
        return None, str(e)[:160]
    if not out:
        return None, 'connected but no positions in window'
    return out, None


def fetch_vessels():
    """Live AIS vessel positions.

    Free keyless AIS is scarce: the global providers (MarineTraffic,
    VesselFinder, AISStream) all want an account. Digitraffic publishes Finnish
    and Baltic AIS as open data with no key, which is real live shipping but
    regionally bounded -- the tile says so rather than implying global coverage.
    """
    out, source = [], []

    # Global coverage, if a key is configured. Never required: without it the
    # regional feed below still runs.
    ais_key = os.environ.get('AISSTREAM_API_KEY', '').strip()
    if ais_key:
        g, err = _aisstream_global(ais_key)
        if g:
            out.extend(g)
            source.append(f'global {len(g)}')
            print(f"  vessels: {len(g)} global (AISStream)")
        else:
            print(f"    AISStream unavailable: {err}")
    else:
        print('    AISSTREAM_API_KEY not set - regional AIS only')

    hdr_note = 'Digitraffic-User'
    try:
        r = requests.get('https://meri.digitraffic.fi/api/ais/v1/locations', timeout=30,
                         headers={'Accept': 'application/json',
                                  hdr_note: 'TridentBrief/1.0 (github.com/TridentIntelFree/Trident-Brief)'})
        if r.status_code != 200:
            if out:
                print(f"    Digitraffic HTTP {r.status_code}; keeping global only")
                return _finish_vessels(out, source), None
            return None, f'HTTP {r.status_code}: {r.text[:100]}'
        loc = r.json()
    except Exception as e:
        if out:
            print(f"    Digitraffic unavailable ({str(e)[:60]}); keeping global only")
            return _finish_vessels(out, source), None
        return None, str(e)[:160]

    # Names and ship types live on a separate endpoint; positions still stand
    # without them, so a failure here is not fatal.
    meta = {}
    try:
        r2 = requests.get('https://meri.digitraffic.fi/api/ais/v1/vessels', timeout=30,
                          headers={'Accept': 'application/json',
                                   hdr_note: 'TridentBrief/1.0 (github.com/TridentIntelFree/Trident-Brief)'})
        if r2.status_code == 200:
            rows = r2.json()
            rows = rows.get('vessels', rows) if isinstance(rows, dict) else rows
            for v in rows or []:
                m = v.get('mmsi')
                if m is not None:
                    meta[int(m)] = ((v.get('name') or '').strip()[:28], v.get('shipType'))
    except Exception as e:
        print(f"    vessel metadata unavailable: {str(e)[:80]}")

    feats = loc.get('features') if isinstance(loc, dict) else None
    if not feats:
        if out:
            return _finish_vessels(out, source), None
        return None, 'no features in AIS response'

    regional = []
    for f in feats:
        g, p = f.get('geometry') or {}, f.get('properties') or {}
        c = g.get('coordinates') or []
        if len(c) < 2:
            continue
        mmsi = f.get('mmsi') or p.get('mmsi')
        name, stype = meta.get(int(mmsi), ('', None)) if mmsi is not None else ('', None)
        rec = {'mmsi': mmsi, 'lat': round(c[1], 4), 'lon': round(c[0], 4)}
        if name:
            rec['name'] = name
        kind = _ship_kind(stype)
        if kind:
            rec['kind'] = kind
            if kind in ('MILITARY OPS', 'LAW ENFORCEMENT', 'Search and rescue'):
                rec['_mil'] = True
        if p.get('sog') is not None:
            try: rec['sog'] = round(float(p['sog']), 1)
            except (TypeError, ValueError): pass
        if p.get('heading') is not None:
            rec['hdg'] = p['heading']
        regional.append(rec)

    source.append(f'Baltic {len(regional)}')
    print(f"  vessels: {len(regional)} regional (Digitraffic)")
    out.extend(regional)
    return _finish_vessels(out, source), None


def _finish_vessels(rows, source):
    """De-duplicate by MMSI, preferring the record that carries a ship type."""
    best = {}
    for v in rows:
        m = v.get('mmsi')
        if m is None:
            continue
        cur = best.get(m)
        if cur is None or (not cur.get('kind') and v.get('kind')):
            best[m] = v
    out = list(best.values())[:9000]
    mil = sum(1 for v in out if v.get('_mil'))
    print(f"  vessels: {len(out)} total ({mil} military/enforcement) [{', '.join(source)}]")
    return out


def fetch_skywatch():
    """Satellite catalogue from the user's own Skywatch project.

    Every tracked object -- payloads, rocket bodies, debris and unknowns -- is
    written to assets/satellites.json rather than embedded in the page. At
    ~2.4MB raw (~820KB gzipped, which is how Pages serves it) it would otherwise
    triple the size of index.html and block first paint; as a separate
    same-origin asset the page renders immediately and the catalogue streams in.
    """
    try:
        r = requests.get(SKYWATCH_CATALOG, timeout=120)
        if r.status_code != 200:
            return None, f'HTTP {r.status_code}'
        cat = r.json()
    except Exception as e:
        return None, str(e)[:160]

    raw = cat.get('sats') or []
    out, counts = [], {}
    for e in raw:
        if len(e) < 5:
            continue
        kind = e[2] if e[2] in ('P', 'R', 'D', 'U') else 'U'
        el = _tle_elements(e)
        if not el:
            continue
        # Debris names are generic ("THOR ABLE DEB (YO)") and make up a third of
        # the payload; the NORAD id identifies them well enough.
        name = '' if kind == 'D' else el[0]
        out.append([name, el[1], el[2], round(el[3], 2), round(el[4], 2),
                    round(el[5], 6), round(el[6], 2), round(el[7], 2),
                    round(el[8], 6), kind])
        counts[kind] = counts.get(kind, 0) + 1
    if not out:
        return None, 'no objects parsed'

    os.makedirs('assets', exist_ok=True)
    with open('assets/satellites.json', 'w', encoding='utf-8') as f:
        json.dump({'generated': cat.get('generated'), 'counts': counts, 'sats': out},
                  f, separators=(',', ':'))
    size = os.path.getsize('assets/satellites.json') // 1024
    print(f"  skywatch: {len(out)} objects {counts} -> assets/satellites.json ({size} KB)")
    return counts, None


def fetch_server_feeds():
    """Fetch the rate-limited / CORS-awkward feeds here instead of in the browser.

    These run on the Actions runner: no CORS, and the rate limit is not tied to
    each visitor's IP. Any feed that fails is simply absent; the page degrades.
    """
    feeds = {}

    errors = {}

    # all_day carries every recorded event (~250-400/day) rather than the ~30
    # that clear M2.5. Magnitude drives point size on the globe.
    d, err = _try(['https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
                   'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson'])
    if d is None:
        errors['quakes'] = err
    else:
        quakes = []
        for f in d.get('features', []):
            p, g = f.get('properties') or {}, f.get('geometry') or {}
            c = g.get('coordinates') or []
            if len(c) >= 2 and p.get('mag') is not None:
                quakes.append({'lat': c[1], 'lon': c[0], 'depth': c[2] if len(c) > 2 else None,
                               'mag': p['mag'], 'place': p.get('place', ''),
                               'time': p.get('time'), 'url': p.get('url', '')})
        quakes.sort(key=lambda q: q['mag'], reverse=True)
        feeds['quakes'] = quakes[:400]
        print(f"  quakes: {len(feeds['quakes'])}")

    d, err = _try([
        'https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=10',
        'https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=10',
        'https://lldev.thespacedevs.com/2.2.0/launch/upcoming/?limit=10',
        'https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=10&mode=list',
    ], timeout=25)
    if d is None:
        errors['launches'] = err
    else:
        feeds['launches'] = [_launch(l) for l in d.get('results', [])]
        print(f"  launches: {len(feeds['launches'])}")

    d, err = _try([
        'https://api.weather.gov/alerts/active?severity=Severe,Extreme',
        'https://api.weather.gov/alerts/active?status=actual&message_type=alert',
        'https://api.weather.gov/alerts/active',
    ])
    if d is None:
        errors['alerts'] = err
    else:
        feeds['alerts'] = [_alert(f) for f in d.get('features', [])
                           if ((f.get('properties') or {}).get('severity') in ('Severe', 'Extreme'))]
        print(f"  alerts: {len(feeds['alerts'])}")

    ves, err = fetch_vessels()
    if ves is None:
        errors['vessels'] = err
        print(f"  vessels failed: {err}")
    else:
        feeds['vessels'] = ves

    ac, err = fetch_aircraft()
    if ac is None:
        errors['aircraft'] = err
        print(f"  aircraft failed: {err}")
    else:
        feeds['aircount'] = ac

    sats, err = fetch_skywatch()
    if sats is None:
        errors['sats'] = err
        print(f"  skywatch failed: {err}")
    else:
        feeds['satcounts'] = sats

    dis, err = fetch_disasters()
    if dis is None:
        errors['disasters'] = err
    else:
        feeds['disasters'] = dis
        print(f"  disasters: {len(dis)}")

    # Recorded so the page can name the real reason, and retry that feed from the
    # visitor's own browser -- a residential IP is often not rate-limited or
    # geo-blocked where a shared CI runner IP is.
    feeds['errors'] = errors
    feeds['fetched_at'] = datetime.now(timezone.utc).isoformat()
    write_feed_status(feeds)
    return feeds


def write_feed_status(feeds):
    """Publish a small feed-health file alongside the page.

    The feeds-only job does not commit, so a failure there is otherwise only
    visible in an Actions log. This lands at assets/feed-status.json on the live
    site, where it can be read directly.
    """
    counts = {}
    for k in ('quakes', 'launches', 'alerts', 'disasters', 'vessels'):
        counts[k] = len(feeds[k]) if isinstance(feeds.get(k), list) else None
    counts['aircraft'] = feeds.get('aircount')
    counts['satellites'] = feeds.get('satcounts')
    status = {'fetched_at': feeds.get('fetched_at'),
              'collected': counts,
              'errors': feeds.get('errors') or {}}
    try:
        os.makedirs('assets', exist_ok=True)
        with open('assets/feed-status.json', 'w', encoding='utf-8') as f:
            json.dump(status, f, indent=2)
        print('  feed status -> assets/feed-status.json')
        for k, v in (status['errors'] or {}).items():
            print(f'    FAILED {k}: {str(v)[:150]}')
    except Exception as e:
        print(f'  could not write feed status: {e}')


# --------------------------------------------------------------- storage ----

def load_cache():
    try:
        with open(CACHE_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"No usable cache: {e}")
        return {}


def load_cached_brief():
    text = (load_cache().get('content') or '').strip()
    # Never resurrect a cached error payload as if it were a brief.
    if text and not text.startswith('Error generating brief'):
        return text
    return None


HISTORY_FILE = 'history.json'


def _km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p = math.pi / 180
    d_lat, d_lon = (lat2 - lat1) * p, (lon2 - lon1) * p
    x = (math.sin(d_lat / 2) ** 2
         + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin(d_lon / 2) ** 2)
    return 2 * r * math.asin(min(1.0, math.sqrt(x)))


def load_history():
    try:
        with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {'briefs': [], 'places': []}


def update_history(events, archive_path, content, when):
    """Accumulate events across briefs so patterns become visible.

    A single brief cannot show that somewhere has been hit four times this
    week. This costs no tokens -- the events are already parsed -- and it is
    the cheapest real intelligence value in the pipeline. Committed with the
    brief so it survives the runner being discarded.
    """
    try:
        with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
            h = json.load(f)
    except Exception:
        h = {}
    briefs = h.get('briefs') or []
    places = {p['key']: p for p in (h.get('places') or []) if p.get('key')}

    bluf = ''
    for line in content.splitlines():
        t = line.strip()
        if t and not t.startswith('#'):
            bluf = re.sub(r'\[\[\d+\]\]\([^)]*\)', '', t)
            bluf = re.sub(r'[*`]', '', bluf)[:240]
            break

    stamp = when.isoformat()
    briefs.insert(0, {'at': stamp, 'path': archive_path, 'bluf': bluf,
                      'events': len(events),
                      'headlines': [e.get('headline', '')[:120] for e in events[:6]]})

    for e in events:
        # Match to an existing location by distance, not by a rounded key:
        # rounding splits neighbours that straddle a boundary (44.72 and 44.75
        # round apart while being 3km from each other).
        p = None
        for cand in places.values():
            if _km(e['lat'], e['lon'], cand['lat'], cand['lon']) <= 30:
                p = cand
                break
        if p is None:
            key = f"{round(e['lat'], 2)},{round(e['lon'], 2)}"
            p = {'key': key, 'lat': e['lat'], 'lon': e['lon'], 'place': e.get('place', ''),
                 'count': 0, 'first': stamp, 'headlines': [], 'maxPriority': 0}
            places[key] = p
        p['count'] += 1
        p['last'] = stamp
        if e.get('place'):
            p['place'] = e['place']
        p['maxPriority'] = max(p.get('maxPriority', 0), e.get('priority', 3))
        head = e.get('headline', '')[:120]
        if head and head not in p['headlines']:
            p['headlines'].insert(0, head)
            p['headlines'] = p['headlines'][:4]

    ranked = sorted(places.values(), key=lambda x: (-x['count'], x.get('last', '')))
    out = {'updated': stamp, 'briefs': briefs[:60], 'places': ranked[:300]}
    with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=1)
    repeat = sum(1 for p in ranked if p['count'] > 1)
    print(f"  history: {len(ranked)} locations tracked, {repeat} seen more than once")
    return out


def write_cache(content, provider, events, feeds):
    with open(CACHE_FILE, 'w', encoding='utf-8') as f:
        json.dump({
            'date': datetime.now(timezone.utc).strftime('%B %d, %Y'),
            'content': content,
            'provider': provider,
            'events': events,
            'feeds': feeds,
            'generated_at': datetime.now(timezone.utc).isoformat(),
        }, f, indent=2)


def write_archive(content, when):
    """Persist this run's brief. Named to the minute so a second run in the same
    day does not overwrite the first."""
    os.makedirs(ARCHIVE_DIR, exist_ok=True)
    name = when.strftime('%Y-%m-%d-%H%M') + '.md'
    with open(os.path.join(ARCHIVE_DIR, name), 'w', encoding='utf-8') as f:
        f.write(content)
    return index_archive()


def index_archive():
    """Rebuild archive/index.json from the .md files on disk, newest first."""
    os.makedirs(ARCHIVE_DIR, exist_ok=True)
    entries = []
    for name in sorted(os.listdir(ARCHIVE_DIR), reverse=True):
        if not name.endswith('.md'):
            continue
        stem = name[:-3]
        label = stem.upper()
        for fmt, out in (('%Y-%m-%d-%H%M', '%d %b %Y %H:%MZ'), ('%Y-%m-%d', '%d %b %Y')):
            try:
                label = datetime.strptime(stem, fmt).strftime(out).upper()
                break
            except ValueError:
                continue
        entries.append({'date': label, 'path': f'{ARCHIVE_DIR}/{name}'})
    with open(os.path.join(ARCHIVE_DIR, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(entries, f, indent=2)
    return entries


# ---------------------------------------------------------------- render ----

def js_json(value):
    """JSON-encode for embedding inside a <script> block.

    json.dumps leaves '<' intact, so a literal '</script>' in model output would
    close the script tag early and blank the page. Escaping the HTML-significant
    characters as \\uXXXX keeps the value byte-identical to the JS engine while
    making it inert to the HTML parser.
    """
    return (json.dumps(value)
            .replace('<', '\\u003c')
            .replace('>', '\\u003e')
            .replace('&', '\\u0026')
            .replace(' ', '\\u2028')
            .replace(' ', '\\u2029'))


def render(content, provider, badge, timestamp, archive, events, feeds, stale=False, history=None):
    """Fill template.html and write index.html.

    Brief text is injected as a JSON string literal, never as raw HTML, so a
    stray '<' or '</pre>' in model output can no longer break the page.
    """
    with open(TEMPLATE_FILE, 'r', encoding='utf-8') as f:
        html = f.read()

    try:
        with open('assets/coastline.json', 'r', encoding='utf-8') as f:
            coastline = json.load(f)
    except Exception as e:
        print(f"Coastline geometry unavailable ({e}); globe will draw without landmasses")
        coastline = {'lines': []}

    # The collection key is NOT written into the page by default.
    #
    # index.html is published to GitHub Pages, so anything in it is readable by
    # every visitor via View Source -- the key was never leaked by GitHub
    # Secrets, it was leaked by this line putting it in a public file. The page
    # falls back to asking the viewer for their own key and keeping it in their
    # own browser, so the local-brief feature still works without publishing
    # anyone's credentials.
    #
    # Setting PUBLISH_GROK_KEY=1 restores the old behaviour. No workflow sets
    # it, and it should stay that way unless the key is one you are content to
    # make public.
    grok_key = (os.environ.get('GROK_API_KEY', '')
                if os.environ.get('PUBLISH_GROK_KEY') == '1' else '')
    if grok_key:
        print('WARNING: embedding GROK_API_KEY in index.html - it will be public')

    subs = {
        '__TIMESTAMP__': escape(timestamp),
        '__BADGE__': escape(badge),
        '__PROVIDER__': escape(provider),
        '__BRIEF_JSON__': js_json(content),
        '__BUILT_AT_JSON__': js_json(datetime.now(timezone.utc).isoformat()),
        '__IS_STALE_JSON__': 'true' if stale else 'false',
        '__ARCHIVE_JSON__': js_json(archive),
        '__EVENTS_JSON__': js_json(events),
        '__FEEDS_JSON__': js_json(feeds),
        '__COASTLINE_JSON__': js_json(coastline.get('lines', [])),
        '__HISTORY_JSON__': js_json(history or load_history()),
        '__GROK_KEY_JSON__': js_json(grok_key),
    }
    for token, value in subs.items():
        html = html.replace(token, value)

    leftover = [t for t in subs if t in html]
    if leftover:
        raise Exception(f"Template placeholders not substituted: {leftover}")

    with open('index.html', 'w', encoding='utf-8') as f:
        f.write(html)


# ------------------------------------------------------------------ main ----

def main():
    now = datetime.now(timezone.utc)
    timestamp = now.strftime('%Y-%m-%d %H:%M UTC')

    if '--feeds-only' in sys.argv:
        # Refresh the live layers and redeploy without calling any LLM, so a
        # cheap job can run often enough to keep the air picture current while
        # the brief itself stays on its twice-daily schedule.
        cache = load_cache()
        content = load_cached_brief()
        if not content:
            raise Exception('--feeds-only requires a usable brief in ' + CACHE_FILE)
        print('Refreshing feeds only (no collection)...')
        feeds = fetch_server_feeds()
        render(content, cache.get('provider', 'CACHED'), 'FEEDS-REFRESH', timestamp,
               index_archive(), cache.get('events', []), feeds, False, load_history())
        cache['feeds'] = feeds
        with open(CACHE_FILE, 'w', encoding='utf-8') as f:
            json.dump(cache, f, indent=2)
        print('Feeds refreshed at ' + timestamp)
        return

    if '--offline' in sys.argv:
        # Re-render index.html from cache. No API calls, no new archive entry.
        cache = load_cache()
        content = load_cached_brief()
        if not content:
            raise Exception('--offline requires a usable brief in ' + CACHE_FILE)
        # Cache may predate the events field, or still carry the raw block.
        events, content = extract_events(content)
        if not events:
            events = cache.get('events', [])
        render(content, 'CACHED - offline re-render', 'CACHE-RENDER', timestamp,
               index_archive(), events, cache.get('feeds', {}), True, load_history())
        print('Re-rendered index.html from cache (offline mode)')
        return

    window_end = now
    window_start = now - timedelta(hours=WINDOW_HOURS)
    deep = deep_run(now)
    print(f"Collection depth: {'deep (all sections)' if deep else 'core (sections 1-2)'}")
    prompt = build_prompt(window_start, window_end, previous_digest(load_cached_brief()),
                          load_watchlist(), deep)

    stale = False
    print(f"Initiating collection, {WINDOW_HOURS}h window, Grok 4.1 + x_search + web_search...")
    content, error = generate_with_grok(prompt)

    if content:
        provider = "Grok 4.1 Fast Reasoning - Multi-INT Fusion (X Search + Web Search)"
        badge = "GROK-4.1-MULTI-INT-FUSION"
    else:
        print(f"Grok failed: {error}")
        print("Falling back to Groq...")
        content, error = generate_with_groq(prompt)
        if content:
            provider = "Groq Llama 3.3 (Backup)"
            badge = "GROQ-BACKUP"
        else:
            # Both providers down. Rather than deploying nothing, re-render the
            # last good brief and flag it as cached on the page.
            content = load_cached_brief()
            if content:
                print(f"All providers failed ({error}); re-rendering cached brief.")
                provider = "CACHED - last successful collection"
                badge = "CACHE-STALE"
                stale = True
            else:
                raise Exception(f"All providers failed and no cache available: {error}")

    if stale:
        events, feeds = load_cache().get('events', []), load_cache().get('feeds', {})
    else:
        events, content = extract_events(content)
        print("Fetching server-side feeds...")
        feeds = fetch_server_feeds()

    archive = write_archive(content, now)
    hist = update_history(events, (archive[0]['path'] if archive else ''), content, now) \
        if not stale else load_history()
    render(content, provider, badge, timestamp, archive, events, feeds, stale, hist)
    write_cache(content, provider, events, feeds)
    print(f"Brief generated successfully at {timestamp}")


if __name__ == '__main__':
    main()
