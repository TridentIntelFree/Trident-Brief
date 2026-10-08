"""Crystal Ball: a projected forecast built from what the site has already gathered.

Run once a day by .github/workflows/crystal-ball.yml, on the GROK_API_KEY secret
and nothing else. It does no searching -- one reasoning call over data already
in the repository, so it costs cents:

- the latest brief (its assessments and indicators & warnings);
- the live layers from the last collection: about 160 wire headlines by desk,
  GDELT conflict hotspots, GPS-jamming cells, severe alerts, disasters,
  significant quakes, launches, and the UVB-76/HFGCS monitor reports;
- the Analyst Desk's contested and single-source claims -- the pre-headline
  layer, what the OSINT community is saying before the news does;
- a track record: every archived brief's warnings with their stated odds,
  scored by the next brief's FORECAST CHECK, so it knows whether "likely" has
  run hot or cold;
- its own earlier forecasts: each one is resolved once its window closes and
  scored (Brier), and the running score goes back into the next forecast;
- a daily log of the indicator counts, so it can say what is rising against
  its own baseline (meaningful after about two weeks of log);
- the Doomsday Clock, read from the Bulletin of the Atomic Scientists' page.

Output: data/crystal/ball.json (what the page shows), data/crystal/forecasts.json
(every forecast and how it resolved), data/crystal/log.json (the indicator log).
The page keeps it hidden until the owner's gesture; it is hidden, not locked.
"""
import glob
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

import requests

from generate_brief_final import closing_items, osint_lines, indicator_lines
import forecast_engine as fe

DIR = 'data/crystal'
OUT = os.path.join(DIR, 'ball.json')
FORECASTS = os.path.join(DIR, 'forecasts.json')
LOG = os.path.join(DIR, 'log.json')
DESK = 'data/analyst/desk.json'
MODEL = 'grok-4-1-fast-reasoning'
HORIZONS = {'48h': 2, '7d': 7, '30d': 30, '1y': 365, '24h': 1, '72h': 3}    # the last two: older forecasts
WINDOW_NAME = {'48h': 'the next 48 hours', '7d': 'the next 7 days', '30d': 'the next 30 days', '1y': 'the next 12 months'}
QUOTA = {'48h': 8, '7d': 8, '30d': 8, '1y': 12}       # questions per window, all forecasters together
CADENCE = {'48h': 0, '7d': 6, '30d': 28, '1y': 88}    # days before a window gets a fresh set: daily, weekly, monthly, quarterly
GRACE_DAYS = 3             # an unresolved forecast is closed as unclear this long after its deadline
BASELINE_DAYS = 5          # log days needed before "what's rising" is reported
CLOCK_URL = 'https://thebulletin.org/doomsday-clock/'
CLOCK_FALLBACK = {'seconds': 85, 'set': '2026-01-27'}     # last known setting

# Words of estimative probability and the bands they stand for (ICD 203).
WEP = [('almost no chance', 0, 5), ('very unlikely', 5, 20), ('unlikely', 20, 45),
       ('roughly even chance', 45, 55), ('likely', 55, 80), ('very likely', 80, 95),
       ('almost certain', 95, 100)]
WEP_RE = re.compile(r'almost no chance|very unlikely|almost certain|very likely|roughly even chance|'
                    r'\bunlikely\b|\blikely\b', re.I)

# Rough regions for the GPS-jamming log: (name, lat_min, lat_max, lon_min, lon_max).
REGIONS = [('Baltic', 53, 66, 9, 32), ('Black Sea / Ukraine', 43, 53, 22, 42), ('Eastern Med / Levant', 29, 38, 26, 37),
           ('Gulf / Iran', 22, 32, 44, 63), ('Red Sea / Yemen', 11, 22, 32, 45), ('Caucasus', 38, 44, 38, 50),
           ('Russia west', 53, 62, 32, 60), ('Korea / Japan', 30, 46, 124, 146), ('South China Sea', 0, 25, 105, 122),
           ('Western Europe', 43, 53, -10, 9), ('North America', 24, 50, -125, -66)]


def wep_for(p):
    for term, lo, hi in WEP:
        if p <= hi:
            return term
    return 'almost certain'


# ---------------------------------------------------------------- inputs
def doomsday(prev):
    clock = dict(prev or CLOCK_FALLBACK)
    try:
        r = requests.get(CLOCK_URL, timeout=20, headers={'User-Agent': 'TridentBrief/1.0'})
        m = re.search(r'(\d{1,3})\s*seconds?\s*to\s*midnight', r.text, re.I) if r.status_code == 200 else None
        if m and 1 <= int(m.group(1)) <= 900:
            if int(m.group(1)) != clock.get('seconds'):
                clock['set'] = datetime.now(timezone.utc).strftime('%Y-%m-%d')    # first seen at this value
            clock['seconds'] = int(m.group(1))
            clock['checked'] = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    except Exception as e:
        print(f'  doomsday clock: page not read ({str(e)[:80]}); keeping {clock["seconds"]} s')
    return clock


def track_record():
    """Each archived brief's warnings, scored by the next brief's FORECAST CHECK, by stated odds."""
    files = sorted(f for f in glob.glob('archive/*.md') if re.search(r'\d{4}-\d\d-\d\d-\d{4}\.md$', f))
    rec, items = {}, []
    pairs = 0
    for prev, nxt in zip(files, files[1:]):
        try:
            ind = closing_items(open(prev, encoding='utf-8').read(), r'INDICATORS')[:8]
            chk = closing_items(open(nxt, encoding='utf-8').read(), r'FORECAST CHECK')
        except Exception:
            continue
        for i, c in zip(ind, chk):
            terms = WEP_RE.findall(i.split('->')[-1]) or WEP_RE.findall(i)
            v = re.search(r'\b(NOT TRIGGERED|TRIGGERED|OPEN|OVERTAKEN)\b', c, re.I)
            if not terms or not v:
                continue
            t, v = terms[-1].lower(), v.group(1).upper()
            row = rec.setdefault(t, {'called': 0, 'triggered': 0, 'not': 0, 'open': 0})
            row['called'] += 1
            row[{'TRIGGERED': 'triggered', 'NOT TRIGGERED': 'not'}.get(v, 'open')] += 1
            pairs += 1
            if v in ('TRIGGERED', 'NOT TRIGGERED'):           # for the fly: past warnings and how they turned out
                items.append({'text': i.split('->')[0].strip()[:300], 'outcome': 'happened' if v == 'TRIGGERED' else 'did_not_happen'})
    for t, row in rec.items():
        done = row['triggered'] + row['not']
        row['rate'] = round(row['triggered'] / done, 2) if done else None
    order = [w[0] for w in WEP]
    return {'pairs': pairs, 'briefs': len(files), 'items': items,
            'by_term': dict(sorted(rec.items(), key=lambda kv: order.index(kv[0]) if kv[0] in order else 99))}


def snapshot(feeds):
    """The live layers, cut down to what bears on what happens next, plus counts for the log."""
    s, counts = {}, {}
    g = feeds.get('gdelt') or []
    s['gdelt'] = [f"{h.get('place')}: {h.get('events')} conflict events, {h.get('outlets')} outlets ({', '.join(h.get('what') or [])})"
                  for h in sorted(g, key=lambda h: -(h.get('events') or 0))[:15]]
    counts['gdelt_hotspots'] = len(g)
    counts['gdelt_conflict_rows'] = (feeds.get('gdelt_meta') or {}).get('conflict_rows')
    counts['gdelt_places'] = {h.get('place'): h.get('events') for h in g if h.get('place')}
    cells = (feeds.get('gpsjam') or {}).get('cells') or []
    jam = {}
    for la, lo, n, bad, ac in cells:
        for name, a, b, c, d in REGIONS:
            if a <= la <= b and c <= lo <= d:
                jam[name] = jam.get(name, 0) + 1
                break
        else:
            jam['elsewhere'] = jam.get('elsewhere', 0) + 1
    s['gps_jamming'] = f'{len(cells)} flagged 1-degree cells over 6 h; by region: ' + \
        ', '.join(f'{k} {v}' for k, v in sorted(jam.items(), key=lambda kv: -kv[1]))
    counts['jam_cells'] = len(cells)
    counts['jam_regions'] = jam
    al = [a for a in feeds.get('alerts') or [] if str(a.get('severity')) in ('Extreme', 'Severe')]
    s['alerts'] = [f"{a.get('event')} - {a.get('area', '')[:80]}" for a in al[:10]]
    counts['alerts_severe'] = len(al)
    dis = [d for d in feeds.get('disasters') or [] if str(d.get('level')) in ('Orange', 'Red')]
    s['disasters'] = [f"{d.get('level')}: {d.get('name')}" for d in dis[:10]]
    counts['disasters_orange_red'] = len(dis)
    s['quakes'] = [f"M{q.get('mag')} {q.get('place')}" for q in feeds.get('quakes') or [] if (q.get('mag') or 0) >= 5.5][:8]
    s['launches'] = [f"{l.get('net', '')[:16]} {l.get('name')} ({l.get('status')})" for l in (feeds.get('launches') or [])[:8]]
    wire = feeds.get('wire') or []
    desks = {}
    for w in wire:
        desks.setdefault(w.get('d', '?'), []).append(w)
    s['headlines'] = {d: [w.get('t') for w in ws[:12]] for d, ws in desks.items() if d != 'signals'}
    s['signals_reports'] = [f"{(w.get('at') or '')[:16]} {w.get('t')}" for w in desks.get('signals', [])[:10]]
    counts['wire_by_desk'] = {d: len(ws) for d, ws in desks.items()}
    counts['signals_reports'] = len(desks.get('signals', []))
    o = feeds.get('osint') or {}
    th = {}
    for e in o.get('sm') or []:
        if e.get('ty') != 'diplomacy':
            th[e.get('th') or '?'] = th.get(e.get('th') or '?', 0) + 1
    counts['osint_events_by_theater'] = th
    counts['telegram_posts'] = sum((o.get('tg_lean') or {}).values()) or None
    if o.get('front'):
        counts['front_km2'] = o['front'].get('km2')
    s['osint'] = osint_lines(o, sm_max=20, tg_max=12)
    ind = feeds.get('indicators') or {}
    s['indicators'] = indicator_lines(ind)[1:-1]
    ua = ind.get('ua_alerts') or {}
    if ua.get('daily'):
        counts['ua_air_raid_alarms_day'] = ua['daily'][-1][1]
        counts['ua_oblasts_peak_48h'] = (ua.get('peak48') or {}).get('oblasts')
    il = ind.get('il_alerts') or {}
    if il.get('daily'):
        counts['il_alerts_day'] = il['daily'][-1][1]
    ox = ind.get('oryx') or {}
    if ox.get('russia'):
        counts['oryx_russia_7d'] = ox['russia'].get('change_7d')
        counts['oryx_ukraine_7d'] = (ox.get('ukraine') or {}).get('change_7d')
    counts['aircraft'] = feeds.get('aircount')
    counts['vessels'] = len(feeds.get('vessels') or [])
    return s, counts


def movers(log, today):
    """Indicators running well above their own recent average."""
    past = [v for d, v in sorted(log.items()) if d < today][-14:]
    if len(past) < BASELINE_DAYS:
        return {'baseline_days': len(past), 'needed': BASELINE_DAYS, 'rising': []}
    cur, out = log[today], []

    def check(label, now, vals, floor):
        vals = [v for v in vals if isinstance(v, (int, float))]
        if not isinstance(now, (int, float)) or not vals:
            return
        mean = sum(vals) / len(vals)
        if now >= floor and now >= 1.5 * max(mean, 1):
            out.append({'what': label, 'now': now, 'usual': round(mean, 1), 'x': round(now / max(mean, 1), 1)})
    for k in ('gdelt_conflict_rows', 'jam_cells', 'alerts_severe', 'disasters_orange_red', 'signals_reports'):
        check(k.replace('_', ' '), cur.get(k), [p.get(k) for p in past], 3)
    for r, n in (cur.get('jam_regions') or {}).items():
        check(f'GPS jamming: {r}', n, [(p.get('jam_regions') or {}).get(r, 0) for p in past], 3)
    for pl, n in (cur.get('gdelt_places') or {}).items():
        check(f'GDELT conflict events: {pl}', n, [(p.get('gdelt_places') or {}).get(pl, 0) for p in past], 8)
    for t, n in (cur.get('osint_events_by_theater') or {}).items():
        check(f'structured conflict events: {t}', n, [(p.get('osint_events_by_theater') or {}).get(t, 0) for p in past], 6)
    check('Telegram war-channel posts', cur.get('telegram_posts'), [p.get('telegram_posts') for p in past], 50)
    check('Ukraine air-raid alarms a day', cur.get('ua_air_raid_alarms_day'), [p.get('ua_air_raid_alarms_day') for p in past], 60)
    check('Ukrainian oblasts under alarm at once', cur.get('ua_oblasts_peak_48h'), [p.get('ua_oblasts_peak_48h') for p in past], 8)
    check('Israel Home Front alerts a day', cur.get('il_alerts_day'), [p.get('il_alerts_day') for p in past], 5)
    check('Oryx verified Russian losses, 7 days', cur.get('oryx_russia_7d'), [p.get('oryx_russia_7d') for p in past], 40)
    check('Oryx verified Ukrainian losses, 7 days', cur.get('oryx_ukraine_7d'), [p.get('oryx_ukraine_7d') for p in past], 40)
    for d, n in (cur.get('wire_by_desk') or {}).items():
        check(f'headlines, {d} desk', n, [(p.get('wire_by_desk') or {}).get(d, 0) for p in past], 6)
    out.sort(key=lambda m: -m['x'])
    return {'baseline_days': len(past), 'needed': BASELINE_DAYS, 'rising': out[:10]}


def desk_signals():
    try:
        d = json.load(open(DESK, encoding='utf-8'))
    except Exception:
        return ''
    keep, on = [], False
    for line in (d.get('desk') or '').splitlines():
        if line.startswith('## '):
            on = bool(re.search(r'CONTESTED|SINGLE-SOURCE|WATCHING', line, re.I))
        if on:
            keep.append(line)
    return f"(Analyst Desk, {d.get('at', '')})\n" + '\n'.join(keep) if keep else ''


def brief_text():
    try:
        c = json.load(open('latest-brief.json', encoding='utf-8'))
    except Exception:
        return '', {}, ''
    return (c.get('content') or '')[:14000], c.get('feeds') or {}, c.get('generated_at') or ''


def load(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return default


# ------------------------------------------------------------- scoring
def score(forecasts):
    done = [f for f in forecasts if f.get('outcome') in ('happened', 'did_not_happen')]
    if not done:
        return {'resolved': 0}
    brier = sum((f['probability'] / 100 - (1 if f['outcome'] == 'happened' else 0)) ** 2 for f in done) / len(done)
    hits = sum(1 for f in done if (f['probability'] >= 50) == (f['outcome'] == 'happened'))
    return {'resolved': len(done), 'brier': round(brier, 3), 'right_side': hits,
            'unclear': sum(1 for f in forecasts if f.get('outcome') == 'unclear'),
            'recent': [{'event': f['event'], 'p': f['probability'], 'outcome': f['outcome'], 'resolved': f.get('resolved')}
                       for f in sorted(done, key=lambda f: f.get('resolved', ''), reverse=True)[:10]]}


# --------------------------------------------------------------- prompt
def build_prompt(now, brief, collected, snap, mov, record, sc, desk, due_windows, engine, markets, quota):
    def lines(xs):
        return '\n'.join('- ' + str(x) for x in xs) or '- none'
    heads = '\n'.join(f'{d.upper()}: ' + ' | '.join(t for t in ts if t) for d, ts in snap.get('headlines', {}).items())
    rec = '\n'.join(f"- '{t}': called {r['called']}x, came true {r['triggered']}, did not {r['not']}, still open {r['open']}"
                    + (f" -> {int(r['rate'] * 100)}% came true" if r.get('rate') is not None else '')
                    for t, r in record['by_term'].items()) or '- no history yet'
    board = []
    for w, row in (sc.get('by_window') or {}).items():
        o = row.get('oracle')
        if o:
            board.append(f"{WINDOW_NAME[w]}: {o['n']} resolved, Brier {o['brier']} (baseline {o['baseline']})")
    own = ('Your resolved forecasts so far: ' + '; '.join(board) + '. Lower Brier is better; beat the baseline.') if board \
        else 'None of your forecasts has resolved yet.'
    rising = (lines(f"{m['what']}: {m['now']} vs usual {m['usual']} ({m['x']}x)" for m in mov['rising'])
              if mov['baseline_days'] >= mov['needed'] else
              f"- baseline still building ({mov['baseline_days']} of {mov['needed']} days logged); no rising list yet")
    eng = '\n'.join(f"- [{WINDOW_NAME[f['horizon']]}] {f['event']}: {f['probability']}% (base rate {f['base_rate']}%)" for f in engine) or '- none'
    mk = '\n'.join(f"- id {m['id']} [{WINDOW_NAME[m['window']]}, settles {m['end'][:10]}]: {m['question']}"
                   + (f" Rules: {m['rules'][:300]}" if m.get('rules') else '') for m in markets) or '- none today'
    asks = '; '.join(f"{quota[w]} for {WINDOW_NAME[w]} (horizon \"{w}\")" for w in due_windows if quota.get(w))
    return f"""CRYSTAL BALL -- projected forecast. It is {now:%A %d %B %Y, %H:%M} UTC.

You are a superforecaster. Your forecasts are scored by Brier score against a baseline, in four windows:
48 hours, 7 days, 30 days and 12 months. Accuracy is the only goal. Work only from the material below
(no searching), think in a straight line, and do not restate the inputs.

How good forecasters work, and how you will work:
- Start from a base rate: how often does this kind of thing happen in a window this long? Then adjust for
  the specific signals. Say both.
- Every question must settle cleanly: name the source that would report it, the exact threshold, and the
  deadline. "Tensions rise" is not a forecast; "Taiwan MND reports 25 or more PLA aircraft on a single day
  before 15 October" is.
- Use the full range. Most events in 48 hours do not happen; longer windows allow more.

== LATEST BRIEF (collected {collected[:16]}) ==
{brief}

== LEADING INDICATORS (live layers at the last collection) ==
GDELT conflict hotspots:
{lines(snap.get('gdelt', []))}
GPS jamming: {snap.get('gps_jamming', 'n/a')}
Severe weather/hazard alerts:
{lines(snap.get('alerts', []))}
Orange/red disasters (GDACS):
{lines(snap.get('disasters', []))}
Significant quakes: {', '.join(snap.get('quakes', [])) or 'none'}
Upcoming launches:
{lines(snap.get('launches', []))}
UVB-76 / HFGCS monitor reports (strategic radio; timing only, content is coded):
{lines(snap.get('signals_reports', []))}

== PARTNER OSINT (other open-source projects; claims, with their lean) ==
{chr(10).join(snap.get('osint') or ['- not available this run'])}

== INDICATORS (air-raid alarms, losses, internet outages, sanctions lists) ==
{chr(10).join(snap.get('indicators') or ['- not available this run'])}

== RISING AGAINST BASELINE ==
{rising}

== PRE-HEADLINE: what the OSINT community is saying before the news ==
{desk or '- no analyst desk today'}

== HEADLINES (wire, by desk) ==
{heads}

== THE ENGINE (statistical forecasts from years of records; already on the board, do not repeat them) ==
{eng}
Use these as base rates for the tempo of the war and of rocket fire when you judge related events.

== TRACK RECORD ==
The briefs' own warnings, by the odds they stated, as scored afterwards:
{rec}
{own}
If a term has come true much more or less often than its band, adjust.

== MARKET QUESTIONS (forecast each one; you are being compared with the crowd, so judge independently) ==
{mk}

== WRITE ==
New forecasts today: {asks}.
Return ONLY one JSON object:
{{"bluf": "two or three sentences: the outlook and the single biggest risk",
  "forecasts": [{{"horizon": "one of the windows above", "region": "short", "event": "the event, specific and observable",
     "criterion": "exactly how it settles: the source, the threshold, the deadline",
     "base_rate": 0-100, "probability": 0-100, "basis": ["the signals that move you off the base rate"],
     "watch_for": "the earliest sign it is coming", "wrong_if": "what would show this forecast is wrong"}}],
  "market_forecasts": [{{"id": "...", "probability": 0-100, "basis": "one sentence"}}],
  "pre_headline": [{{"signal": "something moving that is not in the headlines yet", "source": "where you saw it",
     "why": "what it may lead to"}}],
  "nuclear": {{"trend": "steady | rising | easing", "why": "one or two sentences on nuclear and strategic risk"}}}}
Rules: exactly the numbers asked for in each window; about the future only, never already true; no two about the
same event; none that duplicate the engine's questions; a spread of probabilities, including low ones; for the
12-month window, structural questions (wars ending or starting, leaders falling, treaties, nuclear tests, borders);
pre_headline up to 6, only things the headlines do not already carry."""


def grade_prompt(now, due):
    items = '\n'.join(f"- id {f['id']}: \"{f['event']}\" — settles by: {f.get('criterion') or 'the event as stated'} "
                      f"(window {f['made'][:10]} to {f['deadline'][:10]})" for f in due)
    return f"""You are grading forecasts that have come due. It is {now:%d %B %Y}. For each one, search for what
actually happened inside its window and settle it strictly by its stated criterion.
- If the criterion names a number, compare the reported number with it: 16 crossings is NOT 25.
- "happened" only with a report from inside the window; "did_not_happen" when the window passed without one;
  "unclear" only when the reporting genuinely cannot settle it.
- Search efficiently: about one search per forecast, never more than {max(4, len(due) + 2)} in all.

{items}

Return ONLY JSON: {{"resolutions": [{{"id": "...", "outcome": "happened | did_not_happen | unclear",
"evidence": "one sentence with the figure or fact", "url": "the source"}}]}}"""


def ask(prompt, tools=None):
    key = os.environ.get('GROK_API_KEY', '')
    if not key:
        sys.exit('The GROK_API_KEY secret is not set.')
    r = requests.post('https://api.x.ai/v1/responses', timeout=300,
                      headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {key}'},
                      json={'model': MODEL, 'input': [{'role': 'user', 'content': prompt}],
                            'temperature': 0.3, 'max_output_tokens': 12000, **({'tools': tools} if tools else {})})
    if r.status_code != 200:
        raise RuntimeError(f'xAI answered HTTP {r.status_code}: {r.text[:300]}')
    data = r.json()
    u = data.get('usage') or {}
    ticks = u.get('cost_in_usd_ticks')
    spend = {'cost_usd': round(ticks / 1e10, 4) if isinstance(ticks, int) else None,
             'input_tokens': u.get('input_tokens'), 'output_tokens': u.get('output_tokens'),
             'reasoning_tokens': (u.get('output_tokens_details') or {}).get('reasoning_tokens')}
    print('  spend: ' + ', '.join(f'{k}={v}' for k, v in spend.items()))
    text = '\n'.join(b.get('text', '') for item in data.get('output', []) if item.get('type') == 'message'
                     for b in item.get('content', []) if b.get('type') in ('output_text', 'text'))
    m = re.search(r'\{.*\}', text or '', re.S)
    if not m:
        raise RuntimeError('no JSON in the answer')
    return json.loads(m.group(0)), spend


# ----------------------------------------------------------------- main
def due_windows(forecasts, now):
    """Which windows get a fresh set today: 48 hours daily, a week weekly, a month monthly, a year quarterly."""
    out = []
    for w, every in CADENCE.items():
        made = [f['made'] for f in forecasts if f.get('horizon') == w and f.get('source')]   # sets made since the four windows began
        last = max(made) if made else ''
        if not last or last < (now - timedelta(days=every, hours=-2)).strftime('%Y-%m-%dT%H:%M:%SZ') or every == 0:
            out.append(w)
    return out


def settle(forecasts, series, now, stamp):
    """Settle what can be settled for free: the engine from the records, markets from Polymarket."""
    n = 0
    for f in forecasts:
        if f.get('outcome') or f['deadline'] > stamp:
            continue
        got = None
        if f.get('source') == 'engine':
            got = fe.resolve_engine(f, series, now)
        elif f.get('market'):
            got = fe.resolve_market(f)
        if got:
            f.update(outcome=got[0], resolved=stamp, evidence=got[1])
            n += 1
        elif f.get('source') == 'engine' and f['deadline'] < (now - timedelta(days=21)).strftime('%Y-%m-%dT%H:%M:%SZ'):
            f.update(outcome='unclear', resolved=stamp, evidence='the record never covered the window')
    return n


def main():
    now = datetime.now(timezone.utc)
    stamp, today = now.strftime('%Y-%m-%dT%H:%M:%SZ'), now.strftime('%Y-%m-%d')
    os.makedirs(DIR, exist_ok=True)
    prev = load(OUT, {})
    brief, feeds, collected = brief_text()
    if not brief:
        sys.exit('No brief to work from (latest-brief.json is missing).')
    snap, counts = snapshot(feeds)
    log = load(LOG, {})
    log[today] = counts
    log = dict(sorted(log.items())[-60:])
    mov = movers(log, today)
    record = track_record()
    forecasts = load(FORECASTS, [])
    series, notes = fe.refresh_series(now)
    for n in notes:
        print('  records: ' + n)

    # 1. settle: free first (records, markets), then one search call for the event questions
    free = settle(forecasts, series, now, stamp)
    for f in forecasts:     # close the ones that have been unresolvable for too long
        if not f.get('outcome') and f['deadline'] < (now - timedelta(days=GRACE_DAYS + 7)).strftime('%Y-%m-%dT%H:%M:%SZ'):
            f.update(outcome='unclear', resolved=stamp, evidence='not settled within the grace period')
    due = [f for f in forecasts if not f.get('outcome') and f['deadline'] <= stamp
           and f.get('source', 'oracle') == 'oracle' and not f.get('market')][:12]
    grade_spend = None
    if due:
        try:
            g, grade_spend = ask(grade_prompt(now, due), tools=[{'type': 'web_search'}])
            by_id = {f['id']: f for f in forecasts}
            for r in g.get('resolutions') or []:
                f = by_id.get(str(r.get('id')))
                if f and not f.get('outcome') and r.get('outcome') in ('happened', 'did_not_happen', 'unclear'):
                    if r['outcome'] == 'unclear' and f['deadline'] > (now - timedelta(days=GRACE_DAYS)).strftime('%Y-%m-%dT%H:%M:%SZ'):
                        continue        # give it more days before calling it unclear
                    f.update(outcome=r['outcome'], resolved=stamp, evidence=str(r.get('evidence', ''))[:200],
                             url=str(r.get('url', ''))[:300])
        except Exception as e:
            print(f'  grading skipped this run: {str(e)[:120]}')
    print(f"settled {free} free, {len(due)} sent for grading")

    # 2. today's windows: the engine and the markets first, then the Oracle fills the rest
    windows = due_windows(forecasts, now)
    engine = [f for w in windows for f in fe.engine_forecasts(series, now, w)]
    markets = []
    for w in windows:
        for m in fe.fetch_markets(now, w):
            if not any((f.get('market') or {}).get('id') == m['id'] and not f.get('outcome') for f in forecasts):
                markets.append(dict(m, window=w))
    quota = {w: max(2, QUOTA[w] - sum(1 for f in engine if f['horizon'] == w) - sum(1 for m in markets if m['window'] == w))
             for w in windows}
    sc = fe.scoreboard(forecasts)
    clock = doomsday(prev.get('clock'))
    print(f"windows today: {', '.join(windows)}; engine {len(engine)}, markets {len(markets)}, Oracle asked {quota}")

    ans, spend = ask(build_prompt(now, brief, collected, snap, mov, record, sc, desk_signals(), windows, engine, markets, quota))

    # 3. the new set: the Oracle's questions (with the fly's view), the market questions, the engine's
    run = now.strftime('%Y-%m-%dT%H%M')
    new, n = [], 0
    items = record.get('items', []) + [{'text': f['event'], 'outcome': f['outcome']} for f in forecasts
                                        if f.get('source', 'oracle') == 'oracle' and f.get('outcome') in ('happened', 'did_not_happen')]
    for f in ans.get('forecasts') or []:
        try:
            h = str(f.get('horizon', '')).strip().lower().replace(' ', '')
            h = h if h in windows else windows[0]
            p = max(1, min(99, int(round(float(f.get('probability'))))))
            n += 1
            ev = str(f.get('event', ''))[:300]
            new.append({'id': f'{run}-{n}', 'source': 'oracle', 'made': stamp, 'horizon': h,
                        'deadline': (now + timedelta(days=HORIZONS[h])).strftime('%Y-%m-%dT%H:%M:%SZ'),
                        'region': str(f.get('region', ''))[:40], 'event': ev, 'criterion': str(f.get('criterion', ''))[:300],
                        'probability': p, 'term': wep_for(p), 'base_rate': max(0, min(100, int(float(f.get('base_rate') or 0)))),
                        'basis': [str(b)[:160] for b in (f.get('basis') or [])][:4],
                        'watch_for': str(f.get('watch_for', ''))[:200], 'wrong_if': str(f.get('wrong_if', ''))[:200],
                        'fly': fe.fly_on_warnings(ev, items)})
        except Exception:
            continue
    mf = {str(x.get('id')): x for x in ans.get('market_forecasts') or [] if isinstance(x, dict)}
    for m in markets:
        x = mf.get(m['id'])
        try:
            p = max(1, min(99, int(round(float(x.get('probability'))))))
        except Exception:
            continue
        n += 1
        new.append({'id': f'{run}-{n}', 'source': 'oracle', 'made': stamp, 'horizon': m['window'], 'deadline': m['end'],
                    'region': 'Market', 'event': m['question'], 'criterion': 'as Polymarket settles it', 'probability': p,
                    'term': wep_for(p), 'basis': [str(x.get('basis', ''))[:200]],
                    'market': {'id': m['id'], 'p_market': m['p_market'], 'url': m['url']}})
    for f in engine:
        n += 1
        new.append(dict(f, id=f'{run}-{n}', made=stamp, term=wep_for(f['probability']),
                        deadline=f['resolve']['end'] + 'T23:59:59Z'))
    if not any(f['source'] == 'oracle' for f in new):
        sys.exit('Grok returned no usable forecasts; the previous crystal ball is left in place.')
    # every run's forecasts are kept and scored, a rerun on the same day included: discarding a set
    # before it is due would hide forecasts that might have gone wrong
    forecasts = forecasts + new
    sc = fe.scoreboard(forecasts)
    latest = {}                         # the newest set in each window is what the page shows
    for f in forecasts:
        w = f.get('horizon')
        if w in QUOTA and not f.get('outcome'):
            latest.setdefault(w, {})
            latest[w].setdefault(f['made'], []).append(f)
    current = {w: sets[max(sets)] for w, sets in latest.items()}
    nuc = ans.get('nuclear') or {}
    total = round((spend.get('cost_usd') or 0) + ((grade_spend or {}).get('cost_usd') or 0), 4)
    out = {'v': 2, 'at': stamp, 'brief_collected': collected, 'bluf': str(ans.get('bluf', ''))[:600],
           'forecasts': [f for w in QUOTA for f in current.get(w, [])],
           'windows': {w: {'made': current[w][0]['made'], 'n': len(current[w])} for w in current},
           'pre_headline': [{k: str(p.get(k, ''))[:240] for k in ('signal', 'source', 'why')}
                            for p in (ans.get('pre_headline') or []) if isinstance(p, dict)][:6],
           'nuclear': {'trend': str(nuc.get('trend', 'steady'))[:10], 'why': str(nuc.get('why', ''))[:400]},
           'clock': clock, 'score': score(forecasts), 'scoreboard': sc, 'record': {k: v for k, v in record.items() if k != 'items'},
           'rising': mov,
           'recent': [{k: f.get(k) for k in ('event', 'probability', 'outcome', 'evidence', 'horizon', 'source', 'resolved', 'url')}
                      for f in sorted((f for f in forecasts if f.get('outcome') in ('happened', 'did_not_happen')),
                                      key=lambda f: f.get('resolved', ''), reverse=True)[:12]],
           'open': [{k: f[k] for k in ('event', 'probability', 'deadline', 'horizon')}
                    for f in forecasts if not f.get('outcome') and f['made'] < min(x['made'] for x in new)][:12],
           'spend': spend, 'grade_spend': grade_spend, 'cost_usd': total}
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'))
    with open(FORECASTS, 'w', encoding='utf-8') as f:
        json.dump(forecasts[-1500:], f, indent=1)
    with open(LOG, 'w', encoding='utf-8') as f:
        json.dump(log, f, separators=(',', ':'))
    per = ', '.join(f"{w} {sum(1 for x in new if x['horizon'] == w)}" for w in windows)
    print(f"written: {len(new)} forecasts ({per}), {sc['resolved']} resolved on file, clock {clock['seconds']} s, cost ${total}")


if __name__ == '__main__':
    main()
