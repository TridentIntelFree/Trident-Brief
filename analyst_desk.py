"""Analyst Desk: what the OSINT and defence-analyst community on X has been
saying over the last 48 hours, condensed into one box.

Run once a day by .github/workflows/analyst-desk.yml, on the GROK_API_KEY
secret and nothing else. Three steps:

1. Gather -- Grok's X search, limited to the followed accounts (batches of up
   to 20, the most one search accepts), returns each account's claims from the
   last 48 hours with links to the posts.
2. Discover -- an open X search for other analyst and OSINT accounts on the
   same stories, plus the accounts the followed ones quote or credit. An
   account found on two different days joins the followed list (capped).
3. Condense -- one pass with no searching writes the box from what was
   gathered, so every link in it is a post that step 1 actually returned.

Output: data/analyst/desk.json (the box) and data/analyst/roster.json (who is
followed and who was found). The page keeps the box hidden until the owner's
gesture; it is hidden, not locked, since the repository is public.
"""
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

import requests

OUT_DESK = 'data/analyst/desk.json'
OUT_ROSTER = 'data/analyst/roster.json'
HOURS = 48
BATCH = 20                 # most handles one x_search accepts; drops to 10 if refused
FOLLOW_CAP = 40            # followed accounts, starter list included
PROMOTE_DAYS = 2           # a found account joins after turning up on this many days

STARTER = [
    # conflict and military news
    'sentdefender', 'Osinttechnical', 'IntelCrab', 'Faytuks', 'AuroraIntel', 'ELINTNews', 'Global_Mil_Info',
    # Ukraine and Russia
    'RALee85', 'KofmanMichael', 'wartranslated', 'Tendar', 'noelreports',
    # verification and geolocation
    'GeoConfirmed', 'oryxspioenkop', 'CalibreObscura', 'detresfa_',
    # analysis
    'TheStudyofWar', 'JominiW', 'Archer83Able', 'CovertShores',
]

MODEL = 'grok-4-1-fast-reasoning'
COST = [0.0]


def grok(messages, tools=None, max_tokens=6000, temperature=0.3):
    key = os.environ.get('GROK_API_KEY', '')
    if not key:
        sys.exit('The GROK_API_KEY secret is not set.')
    body = {'model': MODEL, 'input': messages, 'temperature': temperature, 'max_output_tokens': max_tokens}
    if tools:
        body['tools'] = tools
    r = requests.post('https://api.x.ai/v1/responses', timeout=300, json=body,
                      headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {key}'})
    if r.status_code != 200:
        raise RuntimeError(f'xAI answered HTTP {r.status_code}: {r.text[:300]}')
    data = r.json()
    ticks = (data.get('usage') or {}).get('cost_in_usd_ticks')
    if isinstance(ticks, int):
        COST[0] += ticks / 1e10
    parts = [b.get('text', '') for item in data.get('output', []) if item.get('type') == 'message'
             for b in item.get('content', []) if b.get('type') in ('output_text', 'text')]
    return ('\n'.join(parts) or data.get('output_text') or '').strip()


def json_from(text, want=list):
    """The model is asked for bare JSON; take the first array or object it wrote."""
    m = re.search(r'\[.*\]' if want is list else r'\{.*\}', text, re.S)
    if not m:
        return want()
    try:
        v = json.loads(m.group(0))
        return v if isinstance(v, want) else want()
    except Exception:
        return want()


def clean_handle(h):
    h = str(h or '').strip().lstrip('@')
    return h if re.fullmatch(r'[A-Za-z0-9_]{1,15}', h) else ''


def x_post(url):
    return bool(re.match(r'https://(x|twitter)\.com/[A-Za-z0-9_]{1,15}/status/\d+', str(url or '')))


def gather(handles, since):
    """Claims from the followed accounts, batch by batch."""
    claims, size, i = [], BATCH, 0
    while i < len(handles):
        batch = handles[i:i + size]
        tools = [{'type': 'x_search', 'allowed_x_handles': batch, 'from_date': since.strftime('%Y-%m-%d')}]
        prompt = (
            f'Search X for posts from these accounts in the last {HOURS} hours: '
            + ', '.join('@' + h for h in batch) + '.\n'
            'Return ONLY a JSON array, one object per distinct claim or report (skip jokes, promos, replies with '
            'no substance), most significant first, at most 30 objects:\n'
            '[{"handle": "account", "time": "YYYY-MM-DDTHH:MMZ", "topic": "short topic, e.g. Ukraine - Pokrovsk", '
            '"claim": "what they report or assess, one or two factual sentences", '
            '"kind": "report | analysis | claim | correction", "url": "https://x.com/<handle>/status/<id>", '
            '"cites": ["other accounts they quote or credit"]}]\n'
            'Use only posts you actually retrieved; every url must be the real post.')
        try:
            text = grok([{'role': 'user', 'content': prompt}], tools, max_tokens=7000)
        except RuntimeError as e:
            if size > 10 and '400' in str(e):
                print(f'  {size} handles refused ({str(e)[:120]}); retrying in batches of 10')
                size = 10
                continue
            print(f'  batch {i // size + 1} failed: {str(e)[:160]}')
            i += size
            continue
        got = [c for c in json_from(text) if isinstance(c, dict) and x_post(c.get('url')) and c.get('claim')]
        print(f'  batch {i // size + 1}: {len(batch)} accounts -> {len(got)} claims')
        claims += got
        i += size
    return claims


def discover(claims, following, since):
    topics = []
    for c in claims:
        t = str(c.get('topic', '')).strip()
        if t and t not in topics:
            topics.append(t)
    cited = {}
    for c in claims:
        for h in c.get('cites') or []:
            h = clean_handle(h)
            if h and h.lower() not in {f.lower() for f in following}:
                cited[h] = cited.get(h, 0) + 1
    prompt = (
        f'Search X for OSINT, open-source intelligence and defence/security analyst accounts that posted substantive '
        f'reporting or analysis in the last {HOURS} hours on these stories: ' + '; '.join(topics[:8] or ['major conflicts']) + '.\n'
        'Do not include any of these, they are already followed: ' + ', '.join('@' + h for h in following) + '.\n'
        'Prefer accounts that geolocate, cite sources, or are cited by others; skip aggregators that only repost, '
        'parody accounts and official government accounts.\n'
        'Return ONLY a JSON array of at most 8: [{"handle": "account", "why": "what they cover and why they are '
        'credible, one sentence", "url": "https://x.com/<handle>/status/<id> of one recent post"}]')
    found = []
    try:
        text = grok([{'role': 'user', 'content': prompt}],
                    [{'type': 'x_search', 'from_date': since.strftime('%Y-%m-%d')}], max_tokens=3000)
        for f in json_from(text):
            if isinstance(f, dict) and clean_handle(f.get('handle')) and x_post(f.get('url')):
                found.append({'handle': clean_handle(f['handle']), 'why': str(f.get('why', ''))[:200], 'url': f['url']})
    except RuntimeError as e:
        print(f'  discovery failed: {str(e)[:160]}')
    for h, n in sorted(cited.items(), key=lambda kv: -kv[1])[:8]:
        if h.lower() not in {f['handle'].lower() for f in found}:
            found.append({'handle': h, 'why': f'quoted or credited {n}x by followed accounts', 'url': ''})
    return found


def condense(claims, now):
    lines = '\n'.join(
        f"- @{c.get('handle')} | {c.get('time', '')} | {c.get('topic', '')} | {c.get('kind', '')} | "
        f"{str(c.get('claim', ''))[:300]} | {c.get('url')}" for c in claims)
    prompt = f"""ANALYST DESK -- the OSINT and defence-analyst community on X, last {HOURS} hours.
It is {now:%d %B %Y, %H:%M} UTC. Below is every claim gathered from the followed accounts (handle | time |
topic | kind | claim | link). Use only this material and only these links.

{lines or '- (nothing was gathered)'}

Write the box in markdown:
**BLUF:** two or three sentences: what the community is focused on and the single most important thing.

## MAIN THREADS
For each of the 4-7 biggest stories: a ### heading, then 2-4 bullets on who is saying what, each bullet
naming the account(s) and linking the post inline as [@handle](url). Say where several independent
accounts agree.

## CONTESTED
Claims the accounts disagree on, or that one has corrected or walked back. "Nothing contested." if none.

## SINGLE-SOURCE CLAIMS
Notable claims only one account is making, each marked unconfirmed, with its link. Keep to the 5 most notable.

## WORTH WATCHING
2-4 lines: what these analysts expect next or are watching for.

Rules: be brief and factual; attribute everything ("@IntelCrab reports..."); never present a single account's
claim as fact; no links other than the ones above; never reuse one link for a different point.
"""
    return grok([{'role': 'user', 'content': prompt}], None, max_tokens=5000, temperature=0.3)


def load_roster():
    try:
        with open(OUT_ROSTER, encoding='utf-8') as f:
            r = json.load(f)
    except Exception:
        r = {}
    r.setdefault('found', {})
    return r


def following(roster):
    promoted = [h for h, v in sorted(roster['found'].items(), key=lambda kv: -len(kv[1].get('days', [])))
                if len(v.get('days', [])) >= PROMOTE_DAYS]
    out = []
    for h in STARTER + promoted:
        if h.lower() not in {x.lower() for x in out}:
            out.append(h)
    return out[:FOLLOW_CAP]


def main():
    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=HOURS)
    day = now.strftime('%Y-%m-%d')
    roster = load_roster()
    follow = following(roster)
    print(f'following {len(follow)} accounts')

    claims = gather(follow, since)
    print(f'{len(claims)} claims gathered')
    found = discover(claims, follow, since)
    print(f'{len(found)} accounts found: ' + ', '.join('@' + f['handle'] for f in found))
    for f in found:
        v = roster['found'].setdefault(f['handle'], {'days': [], 'why': '', 'url': ''})
        if day not in v['days']:
            v['days'] = (v['days'] + [day])[-14:]
        v['why'] = f['why'] or v['why']
        v['url'] = f['url'] or v['url']
    # forget found accounts not seen for three weeks
    cut = (now - timedelta(days=21)).strftime('%Y-%m-%d')
    roster['found'] = {h: v for h, v in roster['found'].items() if v['days'] and v['days'][-1] >= cut}

    desk = condense(claims, now) if claims else ''
    if not desk:
        sys.exit('Nothing was gathered from the followed accounts; the previous desk is left in place.')
    newly = [h for h in following(roster) if h not in follow]
    out = {'v': 1, 'at': now.strftime('%Y-%m-%dT%H:%M:%SZ'), 'hours': HOURS, 'desk': desk,
           'followed': follow, 'claims': len(claims), 'accounts_with_claims': len({str(c.get('handle', '')).lower() for c in claims}),
           'found_today': found, 'promoted': newly, 'cost_usd': round(COST[0], 4)}
    roster.update(starter=STARTER, following=following(roster), updated=out['at'])
    os.makedirs(os.path.dirname(OUT_DESK), exist_ok=True)
    with open(OUT_DESK, 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'))
    with open(OUT_ROSTER, 'w', encoding='utf-8') as f:
        json.dump(roster, f, indent=1, sort_keys=True)
    print(f'written: {OUT_DESK} ({len(desk)} characters), cost ${COST[0]:.3f}')


if __name__ == '__main__':
    main()
