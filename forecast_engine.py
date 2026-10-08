#!/usr/bin/env python3
"""The Crystal Ball's free forecasting machinery: no model call anywhere in here.

Used by crystal_ball.py each morning.

- **Records.** Daily series kept in data/crystal/astro_series.json and
  refreshed each run, fetching only what is new. They are Ukraine's air-raid
  alarms (2022-), Israel's rocket and missile alerts (2014-), Russia's daily
  personnel and drone losses as Ukraine's MoD claims them (2022-), and USGS
  magnitude 6+ earthquakes (2000-).
- **The engine.** It forecasts measurable questions about those records, for
  48 hours, a week, a month and a year, by analog forecasting. The fly brain
  finds the past days whose state looked most like today, and what followed
  those days is the forecast. The Mushroom Body circuit is a similarity
  search (Dasgupta, Stevens and Navlakha, Science 2017): a sparse random
  expansion and a winner-take-all, the same anatomy as the page's novelty
  detector, fed numbers here instead of words. Each forecast keeps the plain
  base rate beside it, so the scoreboard shows whether the analogs add
  anything.
- **The fly on warnings.** It matches a new event forecast against the brief's
  already-scored warnings, and how often the similar ones came true is a
  forecast of its own.
- **Markets.** Open Polymarket questions on world affairs are fetched as a
  benchmark. The Oracle forecasts them blind, and both are scored when the
  market settles.
- **Settling.** Questions are settled automatically from the records and the
  markets.
- **The scoreboard.** A Brier score for each forecaster in each window, against
  its baseline, and a calibration table.
"""
import csv
import io
import json
import math
import os
import random
import re
from datetime import datetime, timedelta, timezone

import requests

from generate_brief_final import IND_UA_ALERTS, IND_IL_ALERTS, IND_UA_LOSSES, fly_tag

DIR = 'data/crystal'
SERIES = os.path.join(DIR, 'astro_series.json')
UA = 'TridentBrief/1.0 (+https://github.com/TridentIntelFree/Trident-Brief)'
USGS = ('https://earthquake.usgs.gov/fdsnws/event/1/query?format=csv&minmagnitude=6&orderby=time-asc'
        '&starttime={}&endtime={}')
GAMMA = 'https://gamma-api.polymarket.com'
WINDOWS = {'48h': 2, '7d': 7, '30d': 30, '1y': 365}
WINDOW_OF = {'24h': '48h', '72h': '48h', '48h': '48h', '7d': '7d', '30d': '30d', '1y': '1y'}   # older horizons, for scoring


# ----------------------------------------------------------------- records
def _get(url, **kw):
    r = requests.get(url, timeout=kw.pop('timeout', 120), headers={'User-Agent': UA, **kw.pop('headers', {})}, **kw)
    if r.status_code not in (200, 206):
        raise RuntimeError(f'HTTP {r.status_code}')
    return r


def _csv_series(url, cache, parse, tail_bytes):
    """Daily counts from a long, time-ordered CSV: the whole file once, then only its tail."""
    have = cache or {}
    if have:
        r = _get(url, headers={'Range': f'bytes=-{tail_bytes}', 'Accept-Encoding': 'identity'})
        text = r.content.decode('utf-8', 'ignore')
        text = text.split('\n', 1)[1] if r.status_code == 206 else text
        since = (datetime.strptime(max(k for k in have if not k.startswith('_')), '%Y-%m-%d') - timedelta(days=2)).strftime('%Y-%m-%d')
    else:
        text, since = _get(url).content.decode('utf-8', 'ignore'), '0000'
    fresh, first, last = {}, None, None
    for row in csv.reader(io.StringIO(text)):
        got = parse(row)                       # (day, counts) for any dated record
        if not got:
            continue
        day, counts = got
        first, last = min(first or day, day), max(last or day, day)
        if counts and day >= since:
            fresh[day] = fresh.get(day, 0) + 1
    if have and (not first or first > since):
        raise RuntimeError('the tail did not reach back to the cached days')
    out = {k: v for k, v in have.items() if k < since and not k.startswith('_')}
    out.update(fresh)
    # the dataset grows through the day, so the newest day is not over: the last complete day is the one before
    newest = max(last or '', have.get('_newest', ''))
    out['_newest'] = newest
    out['_last'] = (datetime.strptime(newest, '%Y-%m-%d') - timedelta(days=1)).strftime('%Y-%m-%d') if newest else ''
    return out


def _ua_day(row):
    if len(row) != 4 or not re.match(r'\d{4}-\d\d-\d\d', row[1]):
        return None
    return row[1][:10], True


def _il_day(row):
    # category 1 is rockets and missiles; times are Israel local, a day boundary is close enough here
    if len(row) != 8 or not re.match(r'\d{4}-\d\d-\d\d', row[3]):
        return None
    return row[3][:10], row[4] == '1'


def _losses(kind, field):
    rows = _get(IND_UA_LOSSES.format(kind)).json()
    rows = sorted((r['date'], r[field]) for r in rows if r.get('date') and isinstance(r.get(field), (int, float)))
    out = {d: v - pv for (pd, pv), (d, v) in zip(rows, rows[1:]) if v >= pv}
    out['_last'] = rows[-1][0] if rows else ''
    return out


def _quakes(have, now):
    have = have or {}
    days = [k for k in have if not k.startswith('_')]
    start = (datetime.strptime(max(days), '%Y-%m-%d') - timedelta(days=3)).strftime('%Y-%m-%d') if days else '2000-01-01'
    out = {k: v for k, v in have.items() if k < start and not k.startswith('_')}
    y = int(start[:4])
    while y <= now.year:            # a year a request keeps each answer small
        a, b = max(start, f'{y}-01-01'), f'{y + 1}-01-01'
        for row in csv.reader(io.StringIO(_get(USGS.format(a, b)).text)):
            if row and re.match(r'\d{4}-\d\d-\d\d', row[0]):
                out[row[0][:10]] = out.get(row[0][:10], 0) + 1
        y += 1
    d = datetime(2000, 1, 1)
    yesterday = (now - timedelta(days=1)).strftime('%Y-%m-%d')
    while d.strftime('%Y-%m-%d') <= yesterday:          # days without a quake count too; today is not over
        out.setdefault(d.strftime('%Y-%m-%d'), 0)
        d += timedelta(days=1)
    out.pop(now.strftime('%Y-%m-%d'), None)
    out['_last'] = yesterday
    return out


SOURCES = {
    'ua_alarms': lambda c, now: _csv_series(IND_UA_ALERTS, c, _ua_day, 600_000),
    'il_rockets': lambda c, now: _csv_series(IND_IL_ALERTS, c, _il_day, 3_000_000),
    'ru_losses': lambda c, now: _losses('personnel', 'personnel'),
    'ru_drones': lambda c, now: _losses('equipment', 'drone'),
    'quakes': lambda c, now: _quakes(c, now),
}


def refresh_series(now):
    """Every record brought up to date; a source that fails keeps its cached days."""
    cache = json.load(open(SERIES, encoding='utf-8')) if os.path.exists(SERIES) else {}
    out, notes = {}, []
    for key, fn in SOURCES.items():
        try:
            out[key] = fn(cache.get(key), now)
        except Exception as e:
            out[key] = cache.get(key) or {}
            notes.append(f'{key}: {str(e)[:80]} (kept {len(out[key])} cached days)')
    os.makedirs(DIR, exist_ok=True)
    with open(SERIES, 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'))
    return out, notes


def last_day(s):
    """The last complete day of a record."""
    if s.get('_last'):
        return s['_last']
    days = [k for k in s if not k.startswith('_')]
    return max(days) if days else ''


def daily(s, first=None):
    """A dense list of (day, value) from the first record to the newest, gaps as zero."""
    days = sorted(k for k in s if not k.startswith('_'))
    if not days:
        return []
    d0 = datetime.strptime(first or days[0], '%Y-%m-%d')
    d1 = datetime.strptime(last_day(s), '%Y-%m-%d')
    return [((d0 + timedelta(days=i)).strftime('%Y-%m-%d'), s.get((d0 + timedelta(days=i)).strftime('%Y-%m-%d'), 0))
            for i in range((d1 - d0).days + 1)]


# -------------------------------------------------------- the fly's similarity search
FLY_KC, FLY_FANIN, FLY_WIN, FLY_SEED = 600, 3, 30, 20261008


def _wiring(dims):
    rnd = random.Random(FLY_SEED + dims)
    return [tuple(rnd.randrange(dims) for _ in range(FLY_FANIN)) for _ in range(FLY_KC)]


def fly_hash(vec, wiring):
    """Kenyon-cell tag of a state vector: sparse random expansion, then winner-take-all."""
    kc = [sum(vec[i] for i in fan) for fan in wiring]
    return frozenset(sorted(range(len(kc)), key=lambda i: kc[i], reverse=True)[:FLY_WIN])


SPANS = (1, 2, 3, 5, 7, 10, 14, 21, 30, 60, 90)


def states(vals, days):
    """Each day's state: log levels over eleven spans, three trend ratios and the season, z-scored."""
    n = len(vals)
    cum = [0.0]
    for v in vals:
        cum.append(cum[-1] + v)
    mean = lambda i, k: (cum[i + 1] - cum[max(0, i + 1 - k)]) / min(k, i + 1)
    raw = []
    for i in range(n):
        f = [math.log1p(mean(i, k)) for k in SPANS]
        f += [math.log1p(mean(i, 3)) - math.log1p(mean(i, 7)), math.log1p(mean(i, 7)) - math.log1p(mean(i, 30)),
              math.log1p(mean(i, 30)) - math.log1p(mean(i, 90))]
        doy = datetime.strptime(days[i], '%Y-%m-%d').timetuple().tm_yday / 365.25 * 2 * math.pi
        f += [math.sin(doy) * .5, math.cos(doy) * .5]
        raw.append(f)
    dims = len(raw[0])
    mu = [sum(r[j] for r in raw) / n for j in range(dims)]
    sd = [(sum((r[j] - mu[j]) ** 2 for r in raw) / n) ** .5 or 1 for j in range(dims)]
    return [[(r[j] - mu[j]) / sd[j] for j in range(dims)] for r in raw]


def analog_forecast(vals, days, gap, width, outcome, n_analogs=60, prior=8):
    """P(outcome) over the `width` days starting `gap` days after the newest record.

    Analogs are the past days whose fly tag overlaps today's most. Their
    outcomes are shrunk toward the base rate (`prior` pseudo-days), so a thin
    analog set cannot claim more than it knows.
    """
    n = len(vals)
    if n < 120:
        return None
    st = states(vals, days)
    wiring = _wiring(len(st[0]))
    tags = [fly_hash(v, wiring) for v in st]
    cum = [0.0]
    for v in vals:
        cum.append(cum[-1] + v)
    window_sum = lambda i: cum[i + gap + width + 1] - cum[i + gap + 1]      # days i+gap+1 .. i+gap+width
    eligible = [i for i in range(90, n - gap - width - 1)]
    if len(eligible) < 60:
        return None
    outs = {i: outcome(window_sum(i), i) for i in eligible}
    base = sum(outs.values()) / len(outs)
    now = tags[-1]
    ranked = sorted(eligible, key=lambda i: len(now & tags[i]), reverse=True)[:n_analogs]
    hits = sum(outs[i] for i in ranked)
    p = (hits + prior * base) / (len(ranked) + prior)
    return {'p': p, 'base': base, 'analogs': len(ranked), 'analog_hits': hits,
            'like': [days[i] for i in ranked[:5]], 'overlap': round(sum(len(now & tags[i]) for i in ranked[:10]) / 10 / FLY_WIN, 2)}


# ----------------------------------------------------------- the engine's questions
def _fmt(d):
    return datetime.strptime(d, '%Y-%m-%d').strftime('%-d %b %Y')


def engine_forecasts(series, now, window):
    """The measurable questions for one window, each with the fly's analog forecast and the base rate.

    Analog days are asked the same question relative to their own situation:
    did the next window run above that day's own recent pace? A day in a quiet
    month is a fair analog for today only on that footing.
    """
    width = WINDOWS[window]
    start = (now + timedelta(days=1)).strftime('%Y-%m-%d')
    end = (now + timedelta(days=width)).strftime('%Y-%m-%d')
    when = f'from {_fmt(start)} to {_fmt(end)}' if width > 2 else f'on {_fmt(start)} and {_fmt(end)}'
    span = 365 if window == '1y' else 30
    out = []

    def make(key, region, text, op, threshold, outcome, unit_days=False, first=None):
        rows = daily(series.get(key) or {}, first)
        if len(rows) < 200:
            return
        days = [d for d, _ in rows]
        vals = [(1 if v > 0 else 0) if unit_days else v for _, v in rows]
        gap = max(0, (now.date() - datetime.strptime(days[-1], '%Y-%m-%d').date()).days)   # records lag a little
        fc = analog_forecast(vals, days, gap, width, outcome(vals))
        if not fc:
            return
        p = max(2, min(98, round(fc['p'] * 100)))
        out.append({'source': 'engine', 'horizon': window, 'region': region, 'event': text, 'probability': p,
                    'base_rate': max(1, min(99, round(fc['base'] * 100))),
                    'basis': [f"the {fc['analogs']} past days most like today (fly-brain match): {fc['analog_hits']} were followed by this",
                              f"base rate {round(fc['base'] * 100)}% over the whole record",
                              'closest: ' + ', '.join(_fmt(d) for d in fc['like'][:3])],
                    'resolve': {'series': key, 'start': start, 'end': end, 'op': op, 'threshold': threshold, 'unit_days': unit_days},
                    'criterion': text})

    def own_pace(vals, k):
        cum = [0.0]
        for v in vals:
            cum.append(cum[-1] + v)
        return [(cum[i + 1] - cum[max(0, i + 1 - k)]) / min(k, i + 1) for i in range(len(vals))]

    def above_own_pace(vals):            # did the window beat that day's own recent pace?
        pace = own_pace(vals, span)
        return lambda x, i: x > pace[i] * width

    for key, region, what in (('ua_alarms', 'Ukraine', 'air-raid alarms'),
                              ('ru_losses', 'Ukraine', 'Russian personnel losses claimed by Ukraine\'s MoD'),
                              ('ru_drones', 'Ukraine', 'Russian drones claimed destroyed by Ukraine\'s MoD')):
        rows = daily(series.get(key) or {})
        if len(rows) < 200:
            continue
        t = round(sum(v for _, v in rows[-span:]) / span * width)
        pace = 'the past year' if window == '1y' else 'the past 30 days'
        make(key, region, f'More than {t:,} {what} {when}, a faster pace than {pace}', '>', t, above_own_pace)

    il = daily(series.get('il_rockets') or {})
    if len(il) > 200:
        if window == '48h':
            make('il_rockets', 'Israel', f'Israel has rocket or missile alerts {when} (Home Front Command)', '>=', 1,
                 lambda vals: (lambda x, i: x >= 1), unit_days=True)
        else:
            k = max(1, round(sum(1 for _, v in il[-span:] if v > 0) / span * width))
            def more_alert_days(vals):
                frac = own_pace(vals, span)
                return lambda x, i: x >= max(1, round(frac[i] * width))
            make('il_rockets', 'Israel', f'Israel has rocket or missile alerts on at least {k} day{"s" if k > 1 else ""} {when}'
                 f', as often as in {"the past year" if window == "1y" else "the past 30 days"}', '>=', k, more_alert_days, unit_days=True)

    q = daily(series.get('quakes') or {}, '2000-01-01')
    if len(q) > 3000:
        rate = sum(v for _, v in q[-3650:]) / min(3650, len(q))
        k = {'48h': 1, '7d': round(rate * 7) + 1, '30d': round(rate * 30) + 2, '1y': round(rate * 365)}[window]
        make('quakes', 'World', f'At least {k} magnitude 6+ earthquake{"s" if k > 1 else ""} worldwide {when} (USGS)', '>=', k,
             lambda vals: (lambda x, i: x >= k), first='2000-01-01')
    return out


def resolve_engine(f, series, now):
    """Settle an engine question once its records cover the whole window."""
    r = f.get('resolve') or {}
    s = series.get(r.get('series')) or {}
    if not s or last_day(s) < r.get('end', '9'):
        return None
    d0, d1 = datetime.strptime(r['start'], '%Y-%m-%d'), datetime.strptime(r['end'], '%Y-%m-%d')
    vals = [s.get((d0 + timedelta(days=i)).strftime('%Y-%m-%d'), 0) for i in range((d1 - d0).days + 1)]
    x = sum(1 for v in vals if v > 0) if r.get('unit_days') else sum(vals)
    hit = x > r['threshold'] if r['op'] == '>' else x >= r['threshold']
    return ('happened' if hit else 'did_not_happen'), f"measured {x:,} against {r['op']} {r['threshold']:,}"


# --------------------------------------------------------------- the fly on warnings
STOP = set(['about', 'above', 'additional', 'after', 'again', 'against', 'also', 'another', 'any', 'because', 'been', 'before', 'being', 'between', 'both', 'confirmed', 'could', 'day', 'days', 'during', 'each', 'either', 'from', 'further', 'have', 'hour', 'hours', 'into', 'least', 'least', 'month', 'more', 'most', 'must', 'new', 'next', 'other', 'over', 'report', 'reports', 'said', 'same', 'should', 'since', 'single', 'some', 'such', 'than', 'that', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'under', 'until', 'very', 'week', 'weeks', 'were', 'what', 'when', 'where', 'which', 'while', 'will', 'with', 'within', 'would'])


def _content(text):
    return {w for w in re.findall(r'[a-z]{4,}', text.lower()) if w not in STOP}


def fly_on_warnings(event, items, k=8, floor=.12):
    """How often the past warnings most like this forecast came true, or None when too few are alike.

    The fly's tag does the matching. Its word channels are few, so unrelated
    warnings can collide; a past warning counts only if it also shares at
    least two content words with the forecast.
    """
    tag, words = set(fly_tag(event)[0]), _content(event)
    if not tag:
        return None
    scored = []
    for it in items:
        if it.get('_tag') is None:
            it['_tag'], it['_words'] = set(fly_tag(it['text'])[0]), _content(it['text'])
        t = it['_tag']
        j = len(tag & t) / len(tag | t) if t else 0
        if j >= floor and len(words & it['_words']) >= 2:
            scored.append((j, it))
    scored.sort(key=lambda x: -x[0])
    near = scored[:k]
    if len(near) < 4:
        return None
    hits = sum(1 for _, it in near if it['outcome'] == 'happened')
    return {'p': round((hits + 1) / (len(near) + 2) * 100), 'n': len(near), 'hits': hits,
            'like': [it['text'][:120] for _, it in near[:2]]}


# ------------------------------------------------------------------- markets
MARKET_WORDS = re.compile(r'Ukrain|Russia|Putin|Zelensk|Israel|Gaza|Hamas|Hezbollah|Iran|Houthi|Yemen|Saudi|China|Taiwan|'
                          r'North Korea|NATO|ceasefire|war\b|strike|missile|nuclear|invade|invasion|troops|sanction|coup|'
                          r'Venezuela|Syria|Lebanon|Hormuz|Red Sea|Kim Jong|Xi Jinping|Pakistan|India', re.I)


def fetch_markets(now, window, n=4):
    """Open binary Polymarket questions on world affairs that settle inside this window."""
    width = WINDOWS[window]
    lo = now + timedelta(days={'48h': 0, '7d': 2, '30d': 7, '1y': 30}[window])
    hi = now + timedelta(days=width)
    pool = []
    for url in (f'{GAMMA}/events?tag_slug=geopolitics&closed=false&active=true&limit=200',
                f'{GAMMA}/markets?closed=false&active=true&limit=500&order=volume24hr&ascending=false'):
        try:
            data = _get(url, timeout=40).json()
        except Exception:
            continue
        for m in [mk for ev in data for mk in (ev.get('markets') or [])] if 'events' in url else data:
            try:
                outs = json.loads(m.get('outcomes') or '[]')
                prices = [float(x) for x in json.loads(m.get('outcomePrices') or '[]')]
                end = datetime.fromisoformat(str(m.get('endDate')).replace('Z', '+00:00'))
            except Exception:
                continue
            if outs != ['Yes', 'No'] or len(prices) != 2 or m.get('closed') or not (lo <= end <= hi):
                continue
            if not MARKET_WORDS.search(m.get('question') or '') or not (.03 <= prices[0] <= .97):
                continue
            pool.append({'id': str(m.get('id')), 'question': m['question'].strip(), 'end': end.strftime('%Y-%m-%dT%H:%M:%SZ'),
                         'p_market': round(prices[0] * 100), 'volume': float(m.get('volume') or 0),
                         'rules': re.sub(r'\s+', ' ', m.get('description') or '')[:600],
                         'url': 'https://polymarket.com/market/' + (m.get('slug') or '')})
    seen, out = set(), []
    for m in sorted(pool, key=lambda m: -m['volume']):
        if m['id'] not in seen:
            seen.add(m['id'])
            out.append(m)
    return out[:n]


def resolve_market(f):
    """A market question settles when Polymarket closes it at 1 or 0."""
    try:
        m = _get(f"{GAMMA}/markets/{f['market']['id']}", timeout=40).json()
        prices = [float(x) for x in json.loads(m.get('outcomePrices') or '[]')]
    except Exception:
        return None
    if not m.get('closed') or len(prices) != 2 or max(prices) < .99:
        return None
    return ('happened' if prices[0] > .99 else 'did_not_happen'), 'settled on Polymarket'


# ----------------------------------------------------------------- scoreboard
def scoreboard(forecasts):
    """Brier score by window and forecaster, each against its baseline, and calibration."""
    done = [f for f in forecasts if f.get('outcome') in ('happened', 'did_not_happen')]
    y = lambda f: 1 if f['outcome'] == 'happened' else 0
    br = lambda ps: round(sum((p / 100 - o) ** 2 for p, o in ps) / len(ps), 3) if ps else None
    board = {}
    for w in WINDOWS:
        fs = [f for f in done if WINDOW_OF.get(f.get('horizon')) == w]
        row = {}
        eng = [f for f in fs if f.get('source') == 'engine']
        if eng:
            row['engine'] = {'n': len(eng), 'brier': br([(f['probability'], y(f)) for f in eng]),
                             'baseline': br([(f.get('base_rate', 50), y(f)) for f in eng]), 'vs': 'the plain base rate'}
        orc = [f for f in fs if f.get('source', 'oracle') == 'oracle']
        if orc:
            rate = sum(y(f) for f in orc) / len(orc) * 100
            row['oracle'] = {'n': len(orc), 'brier': br([(f['probability'], y(f)) for f in orc]),
                             'baseline': br([(rate, y(f)) for f in orc]), 'vs': 'always guessing how often these come true'}
        fly = [f for f in fs if (f.get('fly') or {}).get('p') is not None]
        if fly:
            row['fly'] = {'n': len(fly), 'brier': br([(f['fly']['p'], y(f)) for f in fly]),
                          'oracle': br([(f['probability'], y(f)) for f in fly]), 'vs': 'the Oracle on the same questions'}
        mk = [f for f in fs if (f.get('market') or {}).get('p_market') is not None]
        if mk:
            row['market'] = {'n': len(mk), 'brier': br([(f['market']['p_market'], y(f)) for f in mk]),
                             'oracle': br([(f['probability'], y(f)) for f in mk]), 'vs': 'the Oracle on the same questions'}
        if row:
            board[w] = row
    bins = [{'lo': i * 10, 'hi': i * 10 + 10, 'n': 0, 'hit': 0} for i in range(10)]
    for f in done:
        b = bins[min(9, int(f['probability'] // 10))]
        b['n'] += 1
        b['hit'] += y(f)
    return {'resolved': len(done), 'open': sum(1 for f in forecasts if not f.get('outcome')),
            'unclear': sum(1 for f in forecasts if f.get('outcome') == 'unclear'),
            'by_window': board, 'calibration': [b for b in bins if b['n']]}
