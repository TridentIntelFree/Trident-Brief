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

from generate_brief_final import closing_items

DIR = 'data/crystal'
OUT = os.path.join(DIR, 'ball.json')
FORECASTS = os.path.join(DIR, 'forecasts.json')
LOG = os.path.join(DIR, 'log.json')
DESK = 'data/analyst/desk.json'
MODEL = 'grok-4-1-fast-reasoning'
HORIZONS = {'24h': 1, '72h': 3, '7d': 7}
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
    rec = {}
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
    for t, row in rec.items():
        done = row['triggered'] + row['not']
        row['rate'] = round(row['triggered'] / done, 2) if done else None
    order = [w[0] for w in WEP]
    return {'pairs': pairs, 'briefs': len(files),
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
def build_prompt(now, brief, collected, snap, mov, record, sc, due, desk):
    def lines(xs):
        return '\n'.join('- ' + str(x) for x in xs) or '- none'
    heads = '\n'.join(f'{d.upper()}: ' + ' | '.join(t for t in ts if t) for d, ts in snap.get('headlines', {}).items())
    rec = '\n'.join(f"- '{t}': called {r['called']}x, came true {r['triggered']}, did not {r['not']}, still open {r['open']}"
                    + (f" -> {int(r['rate'] * 100)}% came true" if r.get('rate') is not None else '')
                    for t, r in record['by_term'].items()) or '- no history yet'
    own = (f"Your own forecasts so far: {sc['resolved']} resolved, Brier score {sc.get('brier')} (0 is perfect, 0.25 is a coin "
           f"toss), {sc.get('right_side')} on the right side of 50%.") if sc.get('resolved') else 'You have no resolved forecasts yet.'
    rising = (lines(f"{m['what']}: {m['now']} vs usual {m['usual']} ({m['x']}x)" for m in mov['rising'])
              if mov['baseline_days'] >= mov['needed'] else
              f"- baseline still building ({mov['baseline_days']} of {mov['needed']} days logged); no rising list yet")
    due_txt = '\n'.join(f"- id {f['id']}: \"{f['event']}\" (said {f['probability']}% within {f['horizon']}, "
                        f"made {f['made'][:10]}, deadline {f['deadline'][:10]})" for f in due) or '- none due'
    return f"""CRYSTAL BALL -- projected forecast. It is {now:%A %d %B %Y, %H:%M} UTC.

You are a forecaster, not a reporter. Do not retell what has happened; use it to say what happens NEXT.
Work only from the material below (no searching). Reason efficiently: this runs on a small budget, so
think in a straight line toward the forecasts and do not restate the inputs.

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

== RISING AGAINST BASELINE ==
{rising}

== PRE-HEADLINE: what the OSINT community is saying before the news ==
{desk or '- no analyst desk today'}

== HEADLINES (wire, by desk) ==
{heads}

== YOUR TRACK RECORD ==
The briefs' warnings, by the odds they stated, as scored afterwards:
{rec}
{own}
Use this: if a term has come true much more or less often than its band, adjust your numbers.

== RESOLVE THESE (your earlier forecasts whose window has closed) ==
{due_txt}
Judge each only from the material above: "happened", "did_not_happen", or "unclear" if the material
does not settle it.

== WRITE ==
Return ONLY one JSON object:
{{"bluf": "two or three sentences: the outlook for the next week and the single biggest risk",
  "forecasts": [{{"horizon": "24h | 72h | 7d", "region": "short", "event": "a specific, observable event a
     headline could confirm, with its threshold", "probability": 0-100, "basis": ["the signals that point to it"],
     "watch_for": "the earliest sign it is coming", "wrong_if": "what would show this forecast is wrong"}}],
  "pre_headline": [{{"signal": "something moving that is not in the headlines yet", "source": "where you saw it",
     "why": "what it may lead to"}}],
  "nuclear": {{"trend": "steady | rising | easing", "why": "one or two sentences on nuclear and strategic risk
     this week, from the material"}},
  "resolutions": [{{"id": "...", "outcome": "happened | did_not_happen | unclear", "evidence": "short"}}]}}
Rules: 7-10 forecasts across the three horizons; every one about the future, specific enough to be scored,
never already true now; at least three below 50%; probabilities honest, not all 60-80; no two forecasts
about the same event; pre_headline up to 6, only things the headlines do not already carry."""


def ask(prompt):
    key = os.environ.get('GROK_API_KEY', '')
    if not key:
        sys.exit('The GROK_API_KEY secret is not set.')
    r = requests.post('https://api.x.ai/v1/responses', timeout=300,
                      headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {key}'},
                      json={'model': MODEL, 'input': [{'role': 'user', 'content': prompt}],
                            'temperature': 0.3, 'max_output_tokens': 8000})
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
    for f in forecasts:     # close the ones that have been unresolvable for too long
        if not f.get('outcome') and f['deadline'] < (now - timedelta(days=GRACE_DAYS)).strftime('%Y-%m-%dT%H:%M:%SZ'):
            f.update(outcome='unclear', resolved=stamp, evidence='not settled within the grace period')
    due = [f for f in forecasts if not f.get('outcome') and f['deadline'] <= stamp][:20]
    sc = score(forecasts)
    clock = doomsday(prev.get('clock'))
    print(f"track record: {record['pairs']} scored warnings from {record['briefs']} briefs; "
          f"{len(due)} of my forecasts due; baseline {mov['baseline_days']} days")

    ans, spend = ask(build_prompt(now, brief, collected, snap, mov, record, sc, due, desk_signals()))

    by_id = {f['id']: f for f in forecasts}
    for r in ans.get('resolutions') or []:
        f = by_id.get(str(r.get('id')))
        if f and not f.get('outcome') and r.get('outcome') in ('happened', 'did_not_happen', 'unclear'):
            if r['outcome'] == 'unclear' and f['deadline'] > (now - timedelta(days=GRACE_DAYS)).strftime('%Y-%m-%dT%H:%M:%SZ'):
                continue        # give it more days before calling it unclear
            f.update(outcome=r['outcome'], resolved=stamp, evidence=str(r.get('evidence', ''))[:200])
    new = []
    for n, f in enumerate(ans.get('forecasts') or [], 1):
        try:
            h = str(f.get('horizon', '')).strip().lower().replace(' ', '')
            h = h if h in HORIZONS else '72h'
            p = max(1, min(99, int(round(float(f.get('probability'))))))
            new.append({'id': f'{today}-{n}', 'made': stamp, 'horizon': h,
                        'deadline': (now + timedelta(days=HORIZONS[h])).strftime('%Y-%m-%dT%H:%M:%SZ'),
                        'region': str(f.get('region', ''))[:40], 'event': str(f.get('event', ''))[:300],
                        'probability': p, 'term': wep_for(p),
                        'basis': [str(b)[:160] for b in (f.get('basis') or [])][:4],
                        'watch_for': str(f.get('watch_for', ''))[:200], 'wrong_if': str(f.get('wrong_if', ''))[:200]})
        except Exception:
            continue
    if not new:
        sys.exit('Grok returned no usable forecasts; the previous crystal ball is left in place.')
    forecasts = [f for f in forecasts if f['made'][:10] != today] + new     # a rerun the same day replaces that day's set
    sc = score(forecasts)
    nuc = ans.get('nuclear') or {}
    out = {'v': 1, 'at': stamp, 'brief_collected': collected, 'bluf': str(ans.get('bluf', ''))[:600],
           'forecasts': new,
           'pre_headline': [{k: str(p.get(k, ''))[:240] for k in ('signal', 'source', 'why')}
                            for p in (ans.get('pre_headline') or []) if isinstance(p, dict)][:6],
           'nuclear': {'trend': str(nuc.get('trend', 'steady'))[:10], 'why': str(nuc.get('why', ''))[:400]},
           'clock': clock, 'score': sc, 'record': record, 'rising': mov,
           'open': [{k: f[k] for k in ('event', 'probability', 'deadline', 'horizon')}
                    for f in forecasts if not f.get('outcome') and f['made'][:10] != today][:12],
           'spend': spend, 'cost_usd': spend.get('cost_usd')}
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'))
    with open(FORECASTS, 'w', encoding='utf-8') as f:
        json.dump(forecasts[-400:], f, indent=1)
    with open(LOG, 'w', encoding='utf-8') as f:
        json.dump(log, f, separators=(',', ':'))
    print(f"written: {len(new)} forecasts, {len(out['pre_headline'])} pre-headline signals, "
          f"score {sc}, clock {clock['seconds']} s, cost ${spend.get('cost_usd')}")


if __name__ == '__main__':
    main()
