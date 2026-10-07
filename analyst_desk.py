"""Analyst Desk: what the OSINT and defence-analyst community on X has been
saying over the last 48 hours, condensed into one box.

Run once a day by .github/workflows/analyst-desk.yml, on the GROK_API_KEY
secret and nothing else.

Built to be cheap. The first version made three calls (gather, discover,
condense) and cost $0.43 a run. Now:
- one call does the gathering and the writing, with X search limited to up
  to 20 followed accounts (the most one search accepts);
- Grok is told what costs money -- each search, every post it pulls in, every
  token it thinks or writes -- and given a search budget, so its reasoning
  goes into planning a few good searches instead of many loose ones; the API
  is also asked to cap tool calls, where it accepts that;
- new accounts come free from the posts already read (who the followed
  accounts quote or credit); the open search for similar accounts runs only
  on Sundays;
- every run logs what it spent on searching, reading, thinking and writing.

An account found on two different days joins the followed list (capped).
When more than 20 are followed, each day's 20 are the untried ones first,
then the ones posting most recently, then the longest unchecked.

Output: data/analyst/desk.json (the box, plus the cost breakdown) and
data/analyst/roster.json (who is followed and found). The page keeps the box
hidden until the owner's gesture; it is hidden, not locked.
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
PER_SEARCH = 20            # most handles one x_search accepts
FOLLOW_CAP = 40            # followed accounts, starter list included
PROMOTE_DAYS = 2           # a found account joins after turning up on this many days
SEARCH_BUDGET = int(os.environ.get('DESK_SEARCH_BUDGET') or 3)
DISCOVER_WEEKDAY = 6       # Sunday: the one day an open search for new accounts runs

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

ECONOMY = (
    'COST DISCIPLINE: this runs on a small personal budget. You are billed for every search call, for every post '
    'a search pulls into your context, and for every token you think or write. Use your reasoning to plan, not to '
    'wander: decide your searches before you make any, make each one count, and stop as soon as you have enough. '
    'Never repeat or rephrase a search. Do not open reply threads. Keep your thinking short and your answer tight.')


class Spend:
    """What each call cost, and on what."""
    def __init__(self):
        self.calls = []

    def add(self, label, data):
        u = data.get('usage') or {}
        ticks = u.get('cost_in_usd_ticks')
        row = {'step': label,
               'cost_usd': round(ticks / 1e10, 4) if isinstance(ticks, int) else None,
               'input_tokens': u.get('input_tokens'),
               'reasoning_tokens': (u.get('output_tokens_details') or {}).get('reasoning_tokens'),
               'output_tokens': u.get('output_tokens'),
               'searches': (u.get('server_side_tool_usage_details') or u.get('server_side_tool_usage')
                            or u.get('num_server_side_tools_used')),
               'sources': u.get('num_sources_used')}
        self.calls.append(row)
        print('  ' + label + ': ' + ', '.join(f'{k}={v}' for k, v in row.items() if k != 'step' and v is not None))

    def total(self):
        return round(sum(c['cost_usd'] or 0 for c in self.calls), 4)


SPEND = Spend()
NO_CAP = [False]           # set once the API refuses max_tool_calls


def grok(label, prompt, tools=None, max_tokens=6000, max_tool_calls=None):
    key = os.environ.get('GROK_API_KEY', '')
    if not key:
        sys.exit('The GROK_API_KEY secret is not set.')
    body = {'model': MODEL, 'input': [{'role': 'user', 'content': prompt}],
            'temperature': 0.3, 'max_output_tokens': max_tokens}
    if tools:
        body['tools'] = tools
        if max_tool_calls and not NO_CAP[0]:
            body['max_tool_calls'] = max_tool_calls
    for _ in range(2):
        r = requests.post('https://api.x.ai/v1/responses', timeout=300, json=body,
                          headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {key}'})
        if r.status_code == 400 and 'max_tool_calls' in body:
            print(f'  max_tool_calls not accepted ({r.text[:120]}); the prompt budget alone holds it')
            body.pop('max_tool_calls')
            NO_CAP[0] = True
            continue
        break
    if r.status_code != 200:
        raise RuntimeError(f'xAI answered HTTP {r.status_code}: {r.text[:300]}')
    data = r.json()
    SPEND.add(label, data)
    parts = [b.get('text', '') for item in data.get('output', []) if item.get('type') == 'message'
             for b in item.get('content', []) if b.get('type') in ('output_text', 'text')]
    return ('\n'.join(parts) or data.get('output_text') or '').strip()


def clean_handle(h):
    h = str(h or '').strip().lstrip('@')
    return h if re.fullmatch(r'[A-Za-z0-9_]{1,15}', h) else ''


def x_post(url):
    return bool(re.match(r'https://(x|twitter)\.com/[A-Za-z0-9_]{1,15}/status/\d+', str(url or '')))


def split_meta(text):
    """The box, and the JSON notes Grok appends after it."""
    m = re.search(r'```json\s*(\{.*?\})\s*```\s*$', text, re.S) or re.search(r'(\{[^{}]*"posting"[\s\S]*\})\s*$', text)
    if not m:
        return text.strip(), {}
    try:
        meta = json.loads(m.group(1))
    except Exception:
        meta = {}
    return text[:m.start()].strip(), meta if isinstance(meta, dict) else {}


def desk_prompt(handles, now):
    return f"""{ECONOMY}

SEARCH BUDGET: at most {SEARCH_BUDGET} X searches. Your X search is already limited to the accounts below and to
the last {HOURS} hours, so one broad search across them usually finds most of what matters; spend a second or
third only on a major story that needs another account's post.

ACCOUNTS: {', '.join('@' + h for h in handles)}

TASK: write the ANALYST DESK -- what this OSINT and defence-analyst community has been reporting and assessing
in the last {HOURS} hours. It is {now:%d %B %Y, %H:%M} UTC.

Write it in markdown:
**BLUF:** two or three sentences: what the community is focused on and the single most important thing.

## MAIN THREADS
For each of the 4-6 biggest stories: a ### heading, then 2-4 bullets on who is saying what, each naming the
account(s) and linking the post inline as [@handle](https://x.com/handle/status/id). Say where several
independent accounts agree.

## CONTESTED
Claims they disagree on, or that one has corrected or walked back. "Nothing contested." if none.

## SINGLE-SOURCE CLAIMS
Up to 5 notable claims only one account is making, each marked unconfirmed, with its link.

## WORTH WATCHING
2-4 lines: what these analysts expect next or are watching for.

Rules: attribute everything; never present one account's claim as fact; link only posts you actually
retrieved; never reuse a link for a different point; under 700 words.

Then, after the box, append exactly one fenced JSON block (no searching for it -- use what you already read):
```json
{{"posting": ["handles of the listed accounts that had posts in the window"],
  "cited": [{{"handle": "an account NOT in the list above that these posts quote, credit or retweet", "why": "few words"}}],
  "claims": <number of distinct claims you saw>}}
```"""


def discover_prompt(topics, following):
    return f"""{ECONOMY}

SEARCH BUDGET: at most 2 X searches.

Find up to 6 OSINT, open-source intelligence or defence/security analyst accounts that posted substantive,
sourced reporting or analysis in the last {HOURS} hours on: {'; '.join(topics) or 'the major conflicts'}.
Not any of these (already followed): {', '.join('@' + h for h in following)}.
Prefer accounts that geolocate, cite sources, or are cited by others; skip repost-only aggregators, parody
accounts and official government accounts.
Return ONLY a JSON array: [{{"handle": "account", "why": "one sentence", "url": "https://x.com/<handle>/status/<id>"}}]"""


# People who listen to these stations round the clock and post what they hear.
# A seed for the search, not a fence: the search is open, so other monitors'
# reports turn up too.
RADIO_SEEDS = ['shortwave78', 'priyom_org']
RADIO_STATIONS = ('UVB-76 "the Buzzer" (4625 kHz), The Pip (5448 / 3756 kHz), the Squeaky Wheel (5473 / 3828 kHz), '
                  'the US Air Force HFGCS network (8992, 11175, 4724 kHz: Emergency Action Messages, Skyking), '
                  'and military numbers stations')


def radio_prompt(now):
    return f"""{ECONOMY}

SEARCH BUDGET: at most 2 X searches, over the last {HOURS} hours.

TASK: list what shortwave monitors reported hearing on {RADIO_STATIONS} in the last {HOURS} hours. It is
{now:%d %B %Y, %H:%M} UTC. Accounts such as {', '.join('@' + h for h in RADIO_SEEDS)} post these logs; anyone
else's first-hand report counts too. One search for the station names and frequencies usually finds them.

Only first-hand logs of a transmission (a voice message, an EAM or Skyking, the buzzer stopping or changing, a
numbers broadcast), not news articles or speculation about what they mean. Copy message text as posted; do not
interpret codewords. Return ONLY a JSON array, newest first, at most 15 items, [] if none:
[{{"at": "YYYY-MM-DDTHH:MMZ (the transmission time if given, else the post time)", "station": "UVB-76",
   "khz": 4625, "what": "voice message: callsign and codeword as posted", "by": "handle", "url": "https://x.com/handle/status/id"}}]"""


def radio_watch(now, since):
    """Monitor reports for the page's Signals section; never fails the desk."""
    try:
        text = grok('radio', radio_prompt(now), [{'type': 'x_search', 'from_date': since.strftime('%Y-%m-%d')}],
                    max_tokens=2500, max_tool_calls=2)
        m = re.search(r'\[.*\]', text, re.S)
        rows = json.loads(m.group(0)) if m else []
    except Exception as e:
        print(f'  radio reports skipped: {str(e)[:160]}')
        return None
    out = []
    for r in rows if isinstance(rows, list) else []:
        if not isinstance(r, dict) or not x_post(r.get('url')):
            continue                              # a report must link the post it came from
        khz = r.get('khz')
        out.append({'at': str(r.get('at', ''))[:17], 'station': str(r.get('station', ''))[:40],
                    'khz': khz if isinstance(khz, (int, float)) else None, 'what': str(r.get('what', ''))[:240],
                    'by': clean_handle(r.get('by')), 'url': r['url']})
    print(f'  radio: {len(out)} monitor reports')
    return out[:15]


def load_roster():
    try:
        with open(OUT_ROSTER, encoding='utf-8') as f:
            r = json.load(f)
    except Exception:
        r = {}
    r.setdefault('found', {})
    r.setdefault('stats', {})
    return r


def following(roster):
    promoted = [h for h, v in sorted(roster['found'].items(), key=lambda kv: -len(kv[1].get('days', [])))
                if len(v.get('days', [])) >= PROMOTE_DAYS]
    out = []
    for h in STARTER + promoted:
        if h.lower() not in {x.lower() for x in out}:
            out.append(h)
    return out[:FOLLOW_CAP]


def todays(follow, stats):
    """Up to PER_SEARCH accounts: untried first, then the most recently posting, then the longest unchecked."""
    if len(follow) <= PER_SEARCH:
        return follow
    def key(h):
        s = stats.get(h) or {}
        return (bool(s.get('checked')), _neg(s.get('posted', '')), s.get('checked', ''))
    return sorted(follow, key=key)[:PER_SEARCH]


def _neg(day):
    """Sort later dates first inside an ascending sort."""
    return ''.join(chr(255 - ord(c)) for c in day) if day else chr(255)


def note_found(roster, handle, why, url, day):
    v = roster['found'].setdefault(handle, {'days': [], 'why': '', 'url': ''})
    if day not in v['days']:
        v['days'] = (v['days'] + [day])[-14:]
    v['why'] = why or v['why']
    v['url'] = url or v['url']


def main():
    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=HOURS)
    day = now.strftime('%Y-%m-%d')
    roster = load_roster()
    follow = following(roster)
    today = todays(follow, roster['stats'])
    print(f'following {len(follow)} accounts; searching {len(today)} today')

    def run(handles):
        xs = {'type': 'x_search', 'allowed_x_handles': handles, 'from_date': since.strftime('%Y-%m-%d')}
        return grok('desk', desk_prompt(handles, now), [xs], max_tokens=6000, max_tool_calls=SEARCH_BUDGET)
    try:
        text = run(today)
    except RuntimeError as e:
        if 'HTTP 400' not in str(e) or len(today) <= 10:
            raise
        print(f'  {len(today)} accounts refused in one search ({str(e)[:120]}); using the first 10')
        today = today[:10]
        text = run(today)
    desk, meta = split_meta(text)
    if not desk or '## MAIN THREADS' not in desk.upper():
        sys.exit('Grok returned no usable desk; the previous one is left in place.')
    links = re.findall(r'\]\((https?://[^)\s]+)\)', desk)
    print(f'desk: {len(desk)} characters, {len(links)} links, {sum(not x_post(u) for u in links)} not X posts')

    posting = {clean_handle(h).lower() for h in meta.get('posting') or []}
    for h in today:
        s = roster['stats'].setdefault(h, {})
        s['checked'] = day
        if h.lower() in posting:
            s['posted'] = day

    followed_lc = {h.lower() for h in follow}
    found = []
    for c in meta.get('cited') or []:
        h = clean_handle(c.get('handle') if isinstance(c, dict) else c)
        if h and h.lower() not in followed_lc:
            found.append({'handle': h, 'why': 'quoted or credited by followed accounts' +
                          (': ' + str(c.get('why'))[:120] if isinstance(c, dict) and c.get('why') else ''), 'url': ''})
    if now.weekday() == DISCOVER_WEEKDAY:
        topics = re.findall(r'^###\s+(.+)$', desk, re.M)[:6]
        try:
            m = re.search(r'\[.*\]', grok('discover', discover_prompt(topics, follow),
                                          [{'type': 'x_search', 'from_date': since.strftime('%Y-%m-%d')}],
                                          max_tokens=2500, max_tool_calls=2), re.S)
            for f in json.loads(m.group(0)) if m else []:
                h = clean_handle(f.get('handle')) if isinstance(f, dict) else ''
                if h and h.lower() not in followed_lc and x_post(f.get('url')):
                    found.append({'handle': h, 'why': str(f.get('why', ''))[:200], 'url': f['url']})
        except Exception as e:
            print(f'  discovery skipped: {str(e)[:160]}')
    seen = set()
    found = [f for f in found if not (f['handle'].lower() in seen or seen.add(f['handle'].lower()))]
    print(f'{len(found)} accounts found: ' + ', '.join('@' + f['handle'] for f in found))
    for f in found:
        note_found(roster, f['handle'], f['why'], f['url'], day)
    cut = (now - timedelta(days=21)).strftime('%Y-%m-%d')
    roster['found'] = {h: v for h, v in roster['found'].items() if v['days'] and v['days'][-1] >= cut}

    radio = radio_watch(now, since)
    newly = [h for h in following(roster) if h not in follow]
    out = {'v': 2, 'at': now.strftime('%Y-%m-%dT%H:%M:%SZ'), 'hours': HOURS, 'desk': desk,
           'followed': follow, 'searched': today, 'claims': meta.get('claims') if isinstance(meta.get('claims'), int) else None,
           'accounts_with_claims': len(posting), 'found_today': found, 'promoted': newly,
           'cost_usd': SPEND.total(), 'spend': SPEND.calls, 'search_budget': SEARCH_BUDGET}
    if radio is not None:
        out['radio'] = radio
    roster.update(starter=STARTER, following=following(roster), updated=out['at'])
    os.makedirs(os.path.dirname(OUT_DESK), exist_ok=True)
    with open(OUT_DESK, 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'))
    with open(OUT_ROSTER, 'w', encoding='utf-8') as f:
        json.dump(roster, f, indent=1, sort_keys=True)
    print(f'written: {OUT_DESK}; total cost ${SPEND.total():.3f}')


if __name__ == '__main__':
    main()
