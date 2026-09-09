import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from html import escape

import requests

CACHE_FILE = 'latest-brief.json'
TEMPLATE_FILE = 'template.html'
ARCHIVE_DIR = 'archive'
WINDOW_HOURS = int(os.environ.get('COLLECTION_WINDOW_HOURS', '12'))


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
                        'content': 'You are a SIGINT/HUMINT fusion analyst with real-time X/Twitter access and web search capabilities. Monitor verified official sources (SIGINT) and unverified local accounts (HUMINT/CHATTER). Also search the broader web for news, government sites, and intelligence sources. Distinguish between confirmed intelligence and uncorroborated chatter. Use professional intelligence terminology. Search X and the web RIGHT NOW.'
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
                'temperature': 0.6
            },
            timeout=180
        )
        
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


def build_prompt(window_start, window_end, prev_digest):
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

## 3. UAP/UFO
Search: @DeptofDefense @AARO_DOD_Info @SenGillibrand @RepTimBurchett;
@ChrisKMellon @LueElizondo @rosscoulthart; web: The Black Vault, The Debrief,
Liberation Times, AARO releases, congressional records.
Focus: official statements, hearings, document releases, sensor data. Distinguish
official positions from advocacy claims. This section is frequently empty - that is fine.

## 4. PARAPSYCHOLOGY AND CONSCIOUSNESS RESEARCH
Search: web only - Nature, Science, arXiv, PubMed, university press releases.
Focus: peer-reviewed publications and funded programs. Note methodological criticism and
replication status. Ignore popular-press speculation. Frequently empty - that is fine.

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
  {{"lat":44.72,"lon":37.77,"place":"Novorossiysk, Russia","headline":"one line, under 100 chars","section":"geopolitical","classification":"SIGINT - VERIFIED","confidence":"high","url":"https://..."}}
]}}
```

Rules for this block: lat/lon numeric decimal degrees for the place the event occurred;
section is one of geopolitical, technology, uap, research; confidence is high, medium or
low; url must be one you actually retrieved. Valid JSON only, no comments, no trailing
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
            events.append({
                'lat': lat,
                'lon': lon,
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
    r.raise_for_status()
    return r.json()


def fetch_server_feeds():
    """Fetch the rate-limited / CORS-awkward feeds here instead of in the browser.

    These run on the Actions runner: no CORS, and the rate limit is not tied to
    each visitor's IP. Any feed that fails is simply absent; the page degrades.
    """
    feeds = {}

    try:
        d = _get('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson')
        quakes = []
        for f in d.get('features', []):
            p, g = f.get('properties') or {}, f.get('geometry') or {}
            c = g.get('coordinates') or []
            if len(c) >= 2 and p.get('mag') is not None:
                quakes.append({'lat': c[1], 'lon': c[0], 'depth': c[2] if len(c) > 2 else None,
                               'mag': p['mag'], 'place': p.get('place', ''),
                               'time': p.get('time'), 'url': p.get('url', '')})
        quakes.sort(key=lambda q: q['mag'], reverse=True)
        feeds['quakes'] = quakes[:60]
        print(f"  quakes: {len(feeds['quakes'])}")
    except Exception as e:
        print(f"  quakes feed failed: {e}")

    try:
        d = _get('https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=6&mode=list', timeout=25)
        feeds['launches'] = [{
            'name': (l.get('name') or '')[:120],
            'net': l.get('net'),
            'status': ((l.get('status') or {}).get('abbrev') or ''),
            'pad': (((l.get('pad') or {}).get('location') or {}).get('name') or '')[:120],
        } for l in d.get('results', [])]
        print(f"  launches: {len(feeds['launches'])}")
    except Exception as e:
        print(f"  launches feed failed: {e}")

    try:
        d = _get('https://api.weather.gov/alerts/active?severity=Severe,Extreme&limit=60')
        feeds['alerts'] = [{
            'event': ((f.get('properties') or {}).get('event') or '')[:80],
            'area': ((f.get('properties') or {}).get('areaDesc') or '')[:120],
            'severity': ((f.get('properties') or {}).get('severity') or ''),
            'expires': (f.get('properties') or {}).get('expires'),
        } for f in d.get('features', [])]
        print(f"  alerts: {len(feeds['alerts'])}")
    except Exception as e:
        print(f"  alerts feed failed: {e}")

    feeds['fetched_at'] = datetime.now(timezone.utc).isoformat()
    return feeds


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


def render(content, provider, badge, timestamp, archive, events, feeds, stale=False):
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

    # Same key handling as before: whatever is in the environment at build time.
    grok_key = os.environ.get('GROK_API_KEY', '')

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
               index_archive(), events, cache.get('feeds', {}), True)
        print('Re-rendered index.html from cache (offline mode)')
        return

    window_end = now
    window_start = now - timedelta(hours=WINDOW_HOURS)
    prompt = build_prompt(window_start, window_end, previous_digest(load_cached_brief()))

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
    render(content, provider, badge, timestamp, archive, events, feeds, stale)
    write_cache(content, provider, events, feeds)
    print(f"Brief generated successfully at {timestamp}")


if __name__ == '__main__':
    main()
