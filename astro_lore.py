#!/usr/bin/env python3
"""Mundane astrology for the Crystal Ball, read against the intel, and tested.

Run each morning after crystal_ball.py by .github/workflows/crystal-ball.yml.
Three parts, all written to data/crystal/astro.json for the page:

1. The sky, pro level. Real positions for now, from Astronomy Engine (MIT; the
   same library the page uses): signs and degrees, speed, retrogrades and
   stations, essential dignity, the lunar node, out-of-bounds declination, a
   void-of-course Moon. National charts for the watch theatres and what is
   crossing them now. The last new moon's chart set for each capital, with
   whole-sign houses. A 35-day almanac of lunations, eclipses, stations and
   sign changes.

2. The lore against the intel. Every active configuration carries its
   traditional mundane meaning. The fly brain the page already uses (the
   Mushroom Body hash, generate_brief_final.fly_tag) fingerprints that lore
   and every current intel item the same way, and the overlaps are where what
   the stars are said to mean meets what is being reported.

3. The fair test. Astrology makes claims that can be checked: an afflicted
   Mars brings war, full moons bring trouble, eclipses bring earthquakes.
   Each claim is tested against years of real records (Ukraine's air-raid
   alarms, Russia's claimed losses, Israel's rocket alerts, USGS earthquakes),
   with trends removed and with shifted skies as the control, and the verdict
   is printed whatever it is. It is rerun weekly; the daily counts are cached
   and only new records are fetched.

Then one Grok call (no searching, about a cent) writes the reading as a
professional mundane astrologer would, from these computed facts only. It is
a separate call from the forecasts, so astrology can never leak into them.
The page labels all of it as astrology, read for fun.
"""
import csv
import io
import json
import math
import os
import random
import re
import sys
from datetime import datetime, timedelta, timezone

import astronomy as A
import requests

from generate_brief_final import fly_tag, IND_UA_ALERTS, IND_IL_ALERTS, IND_UA_LOSSES

DIR = 'data/crystal'
OUT = os.path.join(DIR, 'astro.json')
TEST = os.path.join(DIR, 'astro_test.json')
SERIES = os.path.join(DIR, 'astro_series.json')
UA = 'TridentBrief/1.0 (+https://github.com/TridentIntelFree/Trident-Brief)'
USGS = ('https://earthquake.usgs.gov/fdsnws/event/1/query?format=csv&minmagnitude=6&orderby=time-asc'
        '&starttime={}&endtime={}')

# ------------------------------------------------------------------ the lore
SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn',
         'Aquarius', 'Pisces']
ELEMENT = ['fire', 'earth', 'air', 'water'] * 3
MODE = ['cardinal', 'fixed', 'mutable'] * 4
BODIES = [('Sun', A.Body.Sun), ('Moon', A.Body.Moon), ('Mercury', A.Body.Mercury), ('Venus', A.Body.Venus),
          ('Mars', A.Body.Mars), ('Jupiter', A.Body.Jupiter), ('Saturn', A.Body.Saturn), ('Uranus', A.Body.Uranus),
          ('Neptune', A.Body.Neptune), ('Pluto', A.Body.Pluto)]
GLYPH = {'Sun': '☉', 'Moon': '☽', 'Mercury': '☿', 'Venus': '♀', 'Mars': '♂', 'Jupiter': '♃', 'Saturn': '♄',
         'Uranus': '♅', 'Neptune': '♆', 'Pluto': '♇', 'Node': '☊', 'ASC': 'AC', 'MC': 'MC'}

# Mundane meanings, after the standard texts (Baigent, Campion and Harvey's
# Mundane Astrology; Campion's Book of World Horoscopes). Words chosen to be
# the words intel is written in, so the fly can match them.
PLANET_LORE = {
    'Sun': 'head of state president leader government sovereignty national pride prestige',
    'Moon': 'the people public mood population civilians food water refugees crowds protests',
    'Mercury': 'communications media messages talks negotiations transport roads trade cyber signals intelligence',
    'Venus': 'alliances diplomacy peace treaties money banking currency trade agreements',
    'Mars': 'war military attack strike missile drone troops offensive violence fire explosion weapons army',
    'Jupiter': 'expansion growth law courts religion foreign trade wealth inflation abroad',
    'Saturn': 'restriction sanctions blockade borders austerity shortage siege collapse authority losses',
    'Uranus': 'shock sudden upheaval revolution earthquake technology cyber satellite space grid outage rebellion',
    'Neptune': 'deception propaganda disinformation oil gas sea navy maritime fog spies chemical floods',
    'Pluto': 'nuclear power secret services underworld coup terrorism mass destruction regime transformation',
}
SIGN_LORE = {
    'Aries': 'first strike aggression soldiers weapons ignition', 'Taurus': 'land farms money banks holding ground',
    'Gemini': 'rumour media talks neighbours roads railways', 'Cancer': 'homeland home front food shelter coast',
    'Leo': 'leaders pride spectacle parades rulers', 'Virgo': 'logistics supply health labour workers',
    'Libra': 'diplomacy treaties allies balance negotiations', 'Scorpio': 'secrets intelligence espionage debt death',
    'Sagittarius': 'foreign lands borders expansion religion law', 'Capricorn': 'state institutions government hard power',
    'Aquarius': 'networks technology parliament reform crowds', 'Pisces': 'sea navy refugees hospitals illusion',
}
HOUSE_LORE = {
    1: 'the nation and its people', 2: 'the economy and treasury', 3: 'communications, transport and neighbours',
    4: 'the land, agriculture and the opposition', 5: 'culture, children and speculation',
    6: 'the armed forces, workers and public health', 7: 'foreign relations, open enemies and war',
    8: 'national debt, foreign money and death', 9: 'foreign affairs, courts and religion',
    10: 'the government and head of state', 11: 'the legislature and allies', 12: 'hidden enemies, espionage, prisons and hospitals'}
PAIR_LORE = {
    frozenset(['Mars', 'Saturn']): 'attrition, frustrated offensives, blockades and hard losses',
    frozenset(['Mars', 'Pluto']): 'ruthless force, terror and the threat of mass destruction',
    frozenset(['Mars', 'Uranus']): 'sudden attacks, explosions, accidents and technical warfare',
    frozenset(['Mars', 'Neptune']): 'covert operations, sabotage, deception in war and trouble at sea',
    frozenset(['Mars', 'Jupiter']): 'expansionist campaigns and overreach',
    frozenset(['Saturn', 'Pluto']): 'hard power, crackdowns and the reshaping of regimes',
    frozenset(['Saturn', 'Neptune']): 'eroding institutions, crises of belief and shortages',
    frozenset(['Saturn', 'Uranus']): 'old order against new: reform against reaction',
    frozenset(['Jupiter', 'Saturn']): 'the turning of political and economic cycles',
    frozenset(['Uranus', 'Pluto']): 'revolution and upheaval',
    frozenset(['Neptune', 'Pluto']): 'slow shifts in what whole societies believe',
    frozenset(['Sun', 'Mars']): 'leaders spoiling for a fight',
    frozenset(['Sun', 'Saturn']): 'leaders under pressure and losing authority',
    frozenset(['Mercury', 'Mars']): 'heated words, ultimatums and information war',
    frozenset(['Venus', 'Mars']): 'alliances strained by force; money for weapons',
}
ASPECTS = [('conjunction', 0, 8), ('sextile', 60, 4), ('square', 90, 7), ('trine', 120, 7), ('opposition', 180, 8)]
HARD = {'conjunction', 'square', 'opposition'}
# essential dignity: (rulership, exaltation, detriment, fall), traditional with the modern outer rulers
DIGNITY = {
    'Sun': (['Leo'], ['Aries'], ['Aquarius'], ['Libra']), 'Moon': (['Cancer'], ['Taurus'], ['Capricorn'], ['Scorpio']),
    'Mercury': (['Gemini', 'Virgo'], ['Virgo'], ['Sagittarius', 'Pisces'], ['Pisces']),
    'Venus': (['Taurus', 'Libra'], ['Pisces'], ['Aries', 'Scorpio'], ['Virgo']),
    'Mars': (['Aries', 'Scorpio'], ['Capricorn'], ['Taurus', 'Libra'], ['Cancer']),
    'Jupiter': (['Sagittarius', 'Pisces'], ['Cancer'], ['Gemini', 'Virgo'], ['Capricorn']),
    'Saturn': (['Capricorn', 'Aquarius'], ['Libra'], ['Cancer', 'Leo'], ['Aries']),
    'Uranus': (['Aquarius'], ['Scorpio'], ['Leo'], ['Taurus']), 'Neptune': (['Pisces'], ['Cancer'], ['Virgo'], ['Capricorn']),
    'Pluto': (['Scorpio'], ['Leo'], ['Taurus'], ['Aquarius'])}

# National charts as mundane astrologers commonly use them (Campion, The Book
# of World Horoscopes). 'timed' charts get an Ascendant and Midheaven; the
# others are set at local noon and use planets only.
NATIONS = [
    ('United States', 'Sibly chart, 4 Jul 1776, 17:10 LMT Philadelphia', (1776, 7, 4, 22, 10), 39.95, -75.17, True),
    ('Russia', 'Russian Federation, 25 Dec 1991, 19:32 Moscow', (1991, 12, 25, 16, 32), 55.75, 37.62, True),
    ('Ukraine', 'independence, 24 Aug 1991, about 18:00 Kyiv', (1991, 8, 24, 15, 0), 50.45, 30.52, False),
    ('Israel', 'independence, 14 May 1948, 16:00 Tel Aviv', (1948, 5, 14, 14, 0), 32.08, 34.78, True),
    ('Iran', 'Islamic Republic, 1 Apr 1979, 15:00 Tehran', (1979, 4, 1, 11, 30), 35.69, 51.39, True),
    ('China', "People's Republic, 1 Oct 1949, 15:01 Beijing", (1949, 10, 1, 7, 1), 39.90, 116.40, True),
    ('Taiwan', 'Republic of China, 1 Jan 1912, noon Nanjing', (1912, 1, 1, 4, 0), 32.06, 118.80, False),
    ('North Korea', 'DPRK, 9 Sep 1948, noon Pyongyang', (1948, 9, 9, 3, 0), 39.02, 125.75, False),
]
CAPITAL = {'United States': (38.90, -77.04), 'Russia': (55.75, 37.62), 'Ukraine': (50.45, 30.52), 'Israel': (31.78, 35.22),
           'Iran': (35.69, 51.39), 'China': (39.90, 116.40), 'Taiwan': (25.03, 121.57), 'North Korea': (39.02, 125.75)}
NATION_WORDS = {'United States': r'\bU\.?S\.?\b|United States|America|Washington|Pentagon|Trump',
                'Russia': r'Russia|Moscow|Kremlin|Putin', 'Ukraine': r'Ukrain|Kyiv|Kharkiv|Zelensk|Odesa|Donbas|Dnipro',
                'Israel': r'Israel|IDF|Gaza|Netanyahu|Jerusalem|Hezbollah', 'Iran': r'Iran|Tehran|IRGC|Hormuz|Khamenei',
                'China': r'China|Chinese|Beijing|PLA|Xi\b', 'Taiwan': r'Taiwan|Taipei|median line',
                'North Korea': r'North Korea|DPRK|Pyongyang|Kim Jong'}


def tm(dt):
    return A.Time.Make(dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second + dt.microsecond / 1e6)


def lon_of(body, t):
    if body == A.Body.Sun:
        return A.SunPosition(t).elon
    if body == A.Body.Moon:
        return A.EclipticGeoMoon(t).lon
    return A.Ecliptic(A.GeoVector(body, t, True)).elon


def decl_of(body, t):
    return A.EquatorFromVector(A.GeoVector(body, t, True)).dec


def sign_of(lon):
    s = int(lon // 30) % 12
    return SIGNS[s], lon - s * 30


def sep(a, b):
    return abs(((a - b + 540) % 360) - 180)


def aspect_between(a, b, orb_scale=1.0):
    d = sep(a, b)
    for name, ang, orb in ASPECTS:
        if abs(d - ang) <= orb * orb_scale:
            return name, abs(d - ang)
    return None, None


def dignity(name, sign):
    if name not in DIGNITY:
        return ''
    r, e, d, f = DIGNITY[name]
    return 'rulership' if sign in r else 'exaltation' if sign in e else 'detriment' if sign in d else 'fall' if sign in f else ''


def obliquity(t):
    return 23.4392911 - 0.0130042 * (t.tt / 36525.0)


def asc_mc(t, lat, lon):
    """Ascendant and Midheaven, from local sidereal time (standard formulas)."""
    ramc = math.radians(((A.SiderealTime(t) + lon / 15.0) % 24) * 15)
    eps = math.radians(obliquity(t))
    mc = math.degrees(math.atan2(math.sin(ramc), math.cos(ramc) * math.cos(eps))) % 360
    asc = math.degrees(math.atan2(math.cos(ramc), -(math.sin(ramc) * math.cos(eps) + math.tan(math.radians(lat)) * math.sin(eps)))) % 360
    return asc, mc


def mean_node(t):
    T = t.tt / 36525.0
    return (125.04452 - 1934.136261 * T + 0.0020708 * T * T) % 360


def positions(t):
    return {n: lon_of(b, t) for n, b in BODIES}


# ------------------------------------------------------------------ the sky
def sky_now(now):
    t, t0, t1 = tm(now), tm(now - timedelta(hours=12)), tm(now + timedelta(hours=12))
    p0, p1 = positions(t0), positions(t1)
    bodies = []
    for n, b in BODIES:
        lon = lon_of(b, t)
        s, deg = sign_of(lon)
        speed = ((p1[n] - p0[n] + 540) % 360) - 180          # degrees a day
        dec = decl_of(b, t) if n != 'Sun' else None
        bodies.append({'name': n, 'glyph': GLYPH[n], 'lon': round(lon, 3), 'sign': s, 'deg': round(deg, 2),
                       'speed': round(speed, 4), 'retro': n not in ('Sun', 'Moon') and speed < 0,
                       'dignity': dignity(n, s), 'element': ELEMENT[SIGNS.index(s)], 'mode': MODE[SIGNS.index(s)],
                       'oob': dec is not None and abs(dec) > obliquity(t), 'dec': round(dec, 2) if dec is not None else None})
    # stations: a planet slowed to almost nothing turns within a few days
    typical = {'Mercury': 1.2, 'Venus': 1.1, 'Mars': .6, 'Jupiter': .2, 'Saturn': .1, 'Uranus': .05, 'Neptune': .03, 'Pluto': .025}
    for b in bodies:
        if b['name'] in typical and abs(b['speed']) < typical[b['name']] * .08:
            b['station'] = 'stationing ' + ('direct' if b['retro'] else 'retrograde')
    node = mean_node(t)
    ns, nd = sign_of(node)
    aspects = []
    for i in range(len(bodies)):
        for j in range(i + 1, len(bodies)):
            a, b = bodies[i], bodies[j]
            name, off = aspect_between(a['lon'], b['lon'])
            if name:
                aspects.append({'a': a['name'], 'b': b['name'], 'type': name, 'orb': round(off, 2), 'hard': name in HARD,
                                'lore': PAIR_LORE.get(frozenset([a['name'], b['name']]), '')})
    aspects.sort(key=lambda x: x['orb'])
    return {'bodies': bodies, 'node': {'lon': round(node, 2), 'sign': ns, 'deg': round(nd, 2)}, 'aspects': aspects,
            'moon_phase': round(A.MoonPhase(t), 1), 'void_moon': void_moon(now)}


def void_moon(now):
    """Is the Moon void of course: will it make no major aspect before it leaves its sign?"""
    t = tm(now)
    m0 = lon_of(A.Body.Moon, t)
    sign0 = int(m0 // 30)
    others = {n: lon_of(b, t) for n, b in BODIES if n != 'Moon'}
    prev = {n: None for n in others}
    for h in range(0, 60):
        tt = tm(now + timedelta(hours=h))
        m = lon_of(A.Body.Moon, tt)
        if int(m // 30) != sign0:
            return {'void': True, 'until': (now + timedelta(hours=h)).strftime('%Y-%m-%dT%H:00Z'), 'next_sign': SIGNS[int(m // 30) % 12]}
        for n, L in others.items():
            for _, ang, _ in ASPECTS:
                d = ((m - L - ang + 540) % 360) - 180
                if prev[n] is not None and prev[n].get(ang) is not None and (prev[n][ang] < 0) != (d < 0) and abs(d) < 10:
                    return {'void': False, 'next_aspect': f'Moon {[a for a in ASPECTS if a[1] == ang][0][0]} {n}',
                            'at': (now + timedelta(hours=h)).strftime('%Y-%m-%dT%H:00Z')}
                prev[n] = prev[n] or {}
                prev[n][ang] = d
    return {'void': False}


def natal_charts():
    out = []
    for name, src, (y, mo, d, h, mi), lat, lon, timed in NATIONS:
        t = A.Time.Make(y, mo, d, h, mi, 0)
        # the Moon moves 13° a day: in a chart whose hour is unknown its place means nothing
        pts = {n: lon_of(b, t) for n, b in BODIES if timed or n != 'Moon'}
        if timed:
            pts['ASC'], pts['MC'] = asc_mc(t, lat, lon)
        out.append({'nation': name, 'source': src, 'timed': timed, 'points': pts})
    return out


def transits(sky, charts):
    """What the slower planets (and the Sun) are crossing in each national chart now, within 2 degrees."""
    now_pts = {b['name']: b for b in sky['bodies'] if b['name'] not in ('Moon', 'Mercury', 'Venus')}
    res = []
    for ch in charts:
        hits = []
        for tn, tb in now_pts.items():
            for nn, nl in ch['points'].items():
                name, off = aspect_between(tb['lon'], nl, orb_scale=.25)
                if name and off <= 2.0:
                    weight = {'Pluto': 5, 'Neptune': 4, 'Uranus': 4, 'Saturn': 4, 'Jupiter': 3, 'Mars': 3, 'Sun': 1}[tn]
                    hits.append({'transit': tn, 'natal': nn, 'type': name, 'orb': round(off, 2), 'hard': name in HARD,
                                 'weight': weight + (2 if nn in ('ASC', 'MC', 'Sun', 'Moon') else 0),
                                 'lore': PAIR_LORE.get(frozenset([tn, nn]), '')})
        hits.sort(key=lambda x: (-x['weight'], x['orb']))
        res.append({'nation': ch['nation'], 'chart': ch['source'], 'timed': ch['timed'], 'hits': hits[:6],
                    'pressure': sum(x['weight'] for x in hits if x['hard'])})
    return res


def almanac(now, days=35):
    """Lunations, eclipses, stations and sign changes in the coming weeks."""
    ev, start, end = [], tm(now), tm(now + timedelta(days=days))
    for target, label in ((0, 'New Moon'), (180, 'Full Moon')):
        t = start
        while True:
            r = A.SearchMoonPhase(target, t, days + 2)
            if not r or r.ut > end.ut:
                break
            m = lon_of(A.Body.Moon, r)
            s, d = sign_of(m)
            ev.append({'at': r.Utc().strftime('%Y-%m-%dT%H:%MZ'), 'what': f'{label} in {s} {d:.0f}°', 'kind': 'lunation'})
            t = r.AddDays(1)
    le = A.SearchLunarEclipse(start)
    while le.peak.ut <= end.ut:
        ev.append({'at': le.peak.Utc().strftime('%Y-%m-%dT%H:%MZ'), 'what': f'{le.kind.name.lower()} lunar eclipse', 'kind': 'eclipse'})
        le = A.NextLunarEclipse(le.peak)
    se = A.SearchGlobalSolarEclipse(start)
    while se.peak.ut <= end.ut:
        ev.append({'at': se.peak.Utc().strftime('%Y-%m-%dT%H:%MZ'), 'what': f'{se.kind.name.lower()} solar eclipse', 'kind': 'eclipse'})
        se = A.NextGlobalSolarEclipse(se.peak)
    prev = None
    for d in range(days + 1):
        dt = now + timedelta(days=d)
        t, t1 = tm(dt), tm(dt + timedelta(days=1))
        cur = {}
        for n, b in BODIES:
            if n == 'Moon':
                continue
            L, L1 = lon_of(b, t), lon_of(b, t1)
            cur[n] = (int(L // 30), ((L1 - L + 540) % 360) - 180)
        if prev:
            for n, (s, v) in cur.items():
                if s != prev[n][0]:
                    ev.append({'at': dt.strftime('%Y-%m-%d'), 'what': f'{n} enters {SIGNS[s]}', 'kind': 'ingress'})
                if n != 'Sun' and (v < 0) != (prev[n][1] < 0):
                    ev.append({'at': dt.strftime('%Y-%m-%d'), 'what': f'{n} stations {"retrograde" if v < 0 else "direct"}', 'kind': 'station'})
        prev = cur
    ev.sort(key=lambda e: e['at'])
    return ev


def lunation_houses(now):
    """The last new moon, set for each capital: in which whole-sign house it falls, and Mars and Saturn too."""
    nm = A.SearchMoonPhase(0, tm(now - timedelta(days=31)), 31)
    if not nm:
        return None
    pts = {n: lon_of(b, nm) for n, b in BODIES}
    out = []
    for nation, (lat, lon) in CAPITAL.items():
        asc, _ = asc_mc(nm, lat, lon)
        house = lambda L: ((int(L // 30) - int(asc // 30)) % 12) + 1
        out.append({'nation': nation, 'asc': sign_of(asc)[0],
                    'lunation_house': house(pts['Sun']), 'lunation_means': HOUSE_LORE[house(pts['Sun'])],
                    'mars_house': house(pts['Mars']), 'mars_means': HOUSE_LORE[house(pts['Mars'])],
                    'saturn_house': house(pts['Saturn']), 'saturn_means': HOUSE_LORE[house(pts['Saturn'])]})
    s, d = sign_of(pts['Sun'])
    return {'at': nm.Utc().strftime('%Y-%m-%dT%H:%MZ'), 'where': f'{s} {d:.0f}°', 'capitals': out}


# ------------------------------------------------- the lore against the intel
def intel_items():
    items = []
    try:
        ball = json.load(open(os.path.join(DIR, 'ball.json'), encoding='utf-8'))
        for f in ball.get('forecasts') or []:
            items.append({'src': 'Crystal Ball', 'text': f"{f.get('region', '')}: {f.get('event', '')}"})
        for p in ball.get('pre_headline') or []:
            items.append({'src': 'pre-headline', 'text': p.get('signal', '')})
    except Exception:
        pass
    try:
        lb = json.load(open('latest-brief.json', encoding='utf-8'))
        for line in (lb.get('content') or '').splitlines():
            line = re.sub(r'\[[^\]]*\]|\*\*|[#>*_`]', ' ', line).strip(' -')
            if 60 < len(line) < 600 and not line.lower().startswith(('quiet', 'no verifiable')):
                items.append({'src': 'brief', 'text': line[:300]})
        for w in ((lb.get('feeds') or {}).get('wire') or [])[:160]:
            if isinstance(w, dict) and (w.get('t') or w.get('title')):
                items.append({'src': (w.get('s') or ['wire'])[0], 'text': w.get('t') or w.get('title')})
    except Exception:
        pass
    return items


def jaccard(a, b):
    a, b = set(a), set(b)
    return len(a & b) / len(a | b) if a and b else 0.0


def lore_vs_intel(sky, nat, items):
    """For each active configuration, the intel its lore most resembles to the fly, and how far above chance."""
    tags = [(it, fly_tag(it['text'])[0]) for it in items]
    configs = []
    for a in sky['aspects'][:10]:
        if 'Moon' in (a['a'], a['b']):
            continue
        lore = f"{PLANET_LORE[a['a']]} {PLANET_LORE[a['b']]} {a['lore']}"
        configs.append({'label': f"{a['a']} {a['type']} {a['b']}", 'lore': a['lore'] or f"{a['a']} meets {a['b']}", 'text': lore, 'nation': None})
    for n in nat:
        for h in n['hits'][:2]:
            lore = f"{PLANET_LORE[h['transit']]} {PLANET_LORE.get(h['natal'], 'the nation leadership government')} {h['lore']}"
            configs.append({'label': f"{h['transit']} {h['type']} {n['nation']}'s {h['natal']}", 'lore': h['lore'] or f"{h['transit']} on {n['nation']}",
                            'text': lore, 'nation': n['nation']})
    out = []
    for c in configs:
        lt = fly_tag(c['text'])[0]
        pool = [(it, tg) for it, tg in tags if not c['nation'] or re.search(NATION_WORDS[c['nation']], it['text'], re.I)]
        if not pool:
            out.append({**{k: c[k] for k in ('label', 'lore', 'nation')}, 'matches': [], 'note': 'nothing in the intel about this nation today'})
            continue
        scores = [jaccard(lt, tg) for _, tg in tags]
        mu = sum(scores) / len(scores)
        sd = (sum((s - mu) ** 2 for s in scores) / len(scores)) ** .5 or 1e-9
        ranked = sorted(((jaccard(lt, tg), it) for it, tg in pool), key=lambda x: -x[0])[:3]
        out.append({**{k: c[k] for k in ('label', 'lore', 'nation')},
                    'matches': [{'src': it['src'], 'text': it['text'][:220], 'overlap': round(s, 3), 'z': round((s - mu) / sd, 1)}
                                for s, it in ranked if s > 0]})
    return out


# ------------------------------------------------------------- the fair test
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
        since = (datetime.strptime(max(have), '%Y-%m-%d') - timedelta(days=2)).strftime('%Y-%m-%d')
    else:
        text, since = _get(url).content.decode('utf-8', 'ignore'), '0000'
    fresh, first = {}, None
    for row in csv.reader(io.StringIO(text)):
        got = parse(row)                       # (day, counts) for any dated record
        if not got:
            continue
        day, counts = got
        first = min(first or day, day)
        if counts and day >= since:
            fresh[day] = fresh.get(day, 0) + 1
    if have and (not first or first > since):
        raise RuntimeError('the tail did not reach back to the cached days')
    out = {k: v for k, v in have.items() if k < since}
    out.update(fresh)
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


def load_series(now):
    """The records, kept and refreshed by forecast_engine (one cache for the Crystal Ball and the fair test)."""
    from forecast_engine import refresh_series
    series, notes = refresh_series(now)
    return {k: {d: v for d, v in s.items() if not d.startswith('_')} for k, s in series.items()}, notes


def _losses():
    rows = _get(IND_UA_LOSSES.format('personnel')).json()
    rows = sorted((r['date'], r['personnel']) for r in rows if r.get('date') and isinstance(r.get('personnel'), (int, float)))
    return {d: v - pv for (pd, pv), (d, v) in zip(rows, rows[1:]) if v >= pv}


def _quakes(have, now):
    have = have or {}
    start = (datetime.strptime(max(have), '%Y-%m-%d') - timedelta(days=3)).strftime('%Y-%m-%d') if have else '2000-01-01'
    out = {k: v for k, v in have.items() if k < start}
    y = int(start[:4])
    while y <= now.year:            # a year a request keeps each answer small
        a, b = max(start, f'{y}-01-01'), f'{y + 1}-01-01'
        for row in csv.reader(io.StringIO(_get(USGS.format(a, b)).text)):
            if row and re.match(r'\d{4}-\d\d-\d\d', row[0]):
                out[row[0][:10]] = out.get(row[0][:10], 0) + 1
        y += 1
    d = datetime.strptime(start, '%Y-%m-%d')
    while d.strftime('%Y-%m-%d') <= now.strftime('%Y-%m-%d'):      # days without a quake count too
        out.setdefault(d.strftime('%Y-%m-%d'), 0)
        d += timedelta(days=1)
    if have:
        d = datetime(2000, 1, 1)
        while d.strftime('%Y-%m-%d') < start:
            out.setdefault(d.strftime('%Y-%m-%d'), 0)
            d += timedelta(days=1)
    return out


def sky_flags(days):
    """For each day (at noon UTC): the conditions astrology makes claims about."""
    eclipses = []
    t = A.Time.Make(int(days[0][:4]) - 1, 1, 1, 0, 0, 0)
    le, se = A.SearchLunarEclipse(t), A.SearchGlobalSolarEclipse(t)
    endt = A.Time.Make(int(days[-1][:4]) + 1, 12, 31, 0, 0, 0)
    while le.peak.ut < endt.ut:
        eclipses.append(le.peak.ut); le = A.NextLunarEclipse(le.peak)
    while se.peak.ut < endt.ut:
        eclipses.append(se.peak.ut); se = A.NextGlobalSolarEclipse(se.peak)
    flags = {}
    for d in days:
        y, m, dd = int(d[:4]), int(d[5:7]), int(d[8:10])
        t, t1 = A.Time.Make(y, m, dd, 12, 0, 0), A.Time.Make(y, m, dd, 12, 0, 0).AddDays(1)
        mars, mars1 = lon_of(A.Body.Mars, t), lon_of(A.Body.Mars, t1)
        hard = False
        for b in (A.Body.Sun, A.Body.Saturn, A.Body.Uranus, A.Body.Neptune, A.Body.Pluto):
            name, off = aspect_between(mars, lon_of(b, t))
            if name in HARD and off <= 3:
                hard = True
        ph = A.MoonPhase(t)
        flags[d] = {'mars_afflicted': hard, 'mars_retro': ((mars1 - mars + 540) % 360) - 180 < 0,
                    'full_moon': sep(ph, 180) <= 12.2, 'new_or_full': sep(ph, 180) <= 12.2 or sep(ph, 0) <= 12.2,
                    'eclipse_week': any(abs(t.ut - e) <= 7 for e in eclipses)}
    return flags


CLAIMS = [
    ('Mars afflicted brings war', 'mars_afflicted', 'ua_alarms', 'Ukraine air-raid alarms a day', 'more'),
    ('Mars afflicted brings war', 'mars_afflicted', 'il_rockets', 'Israel rocket and missile alerts a day', 'more'),
    ('Mars afflicted brings war', 'mars_afflicted', 'ru_losses', "Russian personnel losses a day (Ukraine MoD's claim)", 'more'),
    ('Mars retrograde stalls offensives', 'mars_retro', 'ru_losses', "Russian personnel losses a day (Ukraine MoD's claim)", 'less'),
    ('The full moon brings trouble', 'full_moon', 'ua_alarms', 'Ukraine air-raid alarms a day', 'more'),
    ('The full moon brings trouble', 'full_moon', 'il_rockets', 'Israel rocket and missile alerts a day', 'more'),
    ('Eclipses bring earthquakes', 'eclipse_week', 'quakes', 'magnitude 6+ earthquakes a day, worldwide', 'more'),
    ('New and full moons bring earthquakes', 'new_or_full', 'quakes', 'magnitude 6+ earthquakes a day, worldwide', 'more'),
]


def detrend(series, days, half=15):
    """Each day against its own month: value / centred 31-day mean, so a war's slow growth is not mistaken for the stars."""
    v = [series.get(d, 0) for d in days]
    out = {}
    run = sum(v[:2 * half + 1])
    for i in range(half, len(v) - half):
        m = run / (2 * half + 1)
        if m > 0:
            out[days[i]] = v[i] / m
        if i + half + 1 < len(v):
            run += v[i + half + 1] - v[i - half]
    return out


def fair_test(series, now):
    results = []
    tested = [c for c in CLAIMS if series.get(c[2])]
    for claim, flag, key, metric, expect in tested:
        s = series[key]
        days = sorted(d for d in s if d <= now.strftime('%Y-%m-%d'))
        if len(days) < 200:
            continue
        # contiguous days from the first record, with gaps as zero only where the source counts zeros
        d0, d1 = datetime.strptime(days[0], '%Y-%m-%d'), datetime.strptime(days[-1], '%Y-%m-%d')
        all_days = [(d0 + timedelta(days=i)).strftime('%Y-%m-%d') for i in range((d1 - d0).days + 1)]
        flags = sky_flags(all_days)
        rel = detrend(s, all_days)
        ds = [d for d in all_days if d in rel]
        x = [flags[d][flag] for d in ds]
        y = [rel[d] for d in ds]
        n_on = sum(x)
        if n_on < 10 or n_on > len(x) - 10:
            continue

        def ratio(xs):
            on = [b for a, b in zip(xs, y) if a]; off = [b for a, b in zip(xs, y) if not a]
            return (sum(on) / len(on)) / (sum(off) / len(off)) if on and off and sum(off) > 0 else 1.0
        obs = ratio(x)
        # the control: the same sky pattern slid along the calendar, which keeps its rhythm but breaks any link to events
        rnd = random.Random(7)
        shifts = rnd.sample(range(30, len(x) - 30), min(999, len(x) - 60))
        null = [ratio(x[k:] + x[:k]) for k in shifts]
        p = (1 + sum(1 for r in null if abs(math.log(max(r, 1e-9))) >= abs(math.log(max(obs, 1e-9))))) / (1 + len(null))
        results.append({'claim': claim, 'metric': metric, 'condition': flag, 'days': len(ds), 'days_on': n_on,
                        'from': ds[0], 'to': ds[-1], 'ratio': round(obs, 3), 'p': round(p, 4),
                        'direction_as_claimed': (obs > 1) == (expect == 'more')})
    k = max(1, len(results))
    for r in results:
        r['p_adjusted'] = round(min(1.0, r['p'] * k), 4)       # Bonferroni: several claims are tested at once
        pct, pr = round((r['ratio'] - 1) * 100), f"p = {r['p']:.2f}, {r['p_adjusted']:.2f} corrected"
        if r['p_adjusted'] < .01 and r['direction_as_claimed']:
            r['verdict'] = f'a pattern stronger than chance ({pct:+d}%, {pr}), worth a sceptical second look'
        elif r['p_adjusted'] < .05 and r['direction_as_claimed']:
            r['verdict'] = f'a weak pattern ({pct:+d}%, {pr}), borderline'
        elif r['p_adjusted'] < .05:
            r['verdict'] = f'the opposite of the claim ({pct:+d}%, {pr})'
        else:
            r['verdict'] = f'no better than chance ({pct:+d}%, {pr})'
    return results


# ------------------------------------------------------------------ the reading
def reading_prompt(now, sky, nat, alm, lun, lvi, test):
    def body(b):
        return (f"{b['name']} {b['deg']:.0f}° {b['sign']}" + (' R' if b['retro'] else '') + (f" ({b['dignity']})" if b['dignity'] else '') +
                (f", {b['station']}" if b.get('station') else '') + (', out of bounds' if b['oob'] else ''))
    lines = [f'Date: {now.strftime("%A %d %B %Y, %H:%M UTC")}.',
             'POSITIONS (computed, exact): ' + '; '.join(body(b) for b in sky['bodies']) +
             f"; North Node {sky['node']['deg']:.0f}° {sky['node']['sign']}.",
             'MOON: ' + (f"void of course until {sky['void_moon']['until']} (enters {sky['void_moon']['next_sign']})" if sky['void_moon'].get('void')
                         else f"not void; next aspect {sky['void_moon'].get('next_aspect', '?')}"),
             'ASPECTS: ' + '; '.join(f"{a['a']} {a['type']} {a['b']} (orb {a['orb']}°)" for a in sky['aspects'][:12]),
             'NATIONAL CHARTS, transits within 2°:']
    for n in nat:
        lines.append(f"- {n['nation']} ({n['chart']}{'' if n['timed'] else '; time uncertain, no angles'}): " +
                     ('; '.join(f"transiting {h['transit']} {h['type']} natal {h['natal']} ({h['orb']}°)" for h in n['hits']) or 'nothing close'))
    if lun:
        lines.append(f"LAST NEW MOON {lun['at']} at {lun['where']}, whole-sign houses by capital: " +
                     '; '.join(f"{c['nation']}: lunation in house {c['lunation_house']} ({c['lunation_means']}), Mars in {c['mars_house']}, Saturn in {c['saturn_house']}"
                               for c in lun['capitals']))
    lines.append('ALMANAC, next 35 days: ' + '; '.join(f"{e['at'][:10]} {e['what']}" for e in alm))
    lines.append('WHERE THE LORE MEETS TODAY\'S INTEL (the fly-brain overlaps; z is how far above chance):')
    for c in lvi[:10]:
        if c['matches']:
            lines.append(f"- {c['label']} ({c['lore']}): " + ' | '.join(f"[{m['src']}] {m['text'][:140]} (z {m['z']})" for m in c['matches'][:2]))
    lines.append('THE FAIR TEST of astrology\'s claims against years of records (report these honestly): ' +
                 '; '.join(f"{t['claim']} vs {t['metric']}: {t['verdict']} over {t['days']} days" for t in test))
    return f"""You are a professional mundane astrologer in the tradition of Baigent, Campion and Harvey, writing the
daily astrological reading for a private intelligence brief. It is presented to the reader as astrology, for interest and fun,
next to a real forecast it must never influence. Use only the computed facts below: never invent a position, aspect, chart or
date. Write with a professional's vocabulary (dignity, rulership, lunation, ingress, station, transits to national angles,
houses) but plainly enough for a layman.

Tie the lore to the intel where the fly-brain overlaps show they touch, and say where they do not. Report the fair test's
verdicts honestly: if the records show a claim is no better than chance, say so in a sentence, without hedging and without
mockery.

{chr(10).join(lines)}

Answer with JSON only:
{{"title": "a short evocative title for today's sky",
 "overview": ["2 to 4 paragraphs: the state of the heavens and what mundane tradition says it means for the world"],
 "nations": [{{"nation": "...", "reading": "2 to 3 sentences on that chart's transits, and how they sit with today's intel about it"}}],
 "lore_and_intel": "a paragraph on where the lore and today's reporting meet, and where they do not",
 "watch": [{{"date": "YYYY-MM-DD", "note": "what an astrologer would watch for on this almanac date"}}],
 "the_test": "two or three sentences, plainly: what the records say about whether any of this predicts anything"}}"""


def main():
    now = datetime.now(timezone.utc)
    os.makedirs(DIR, exist_ok=True)
    sky = sky_now(now)
    nat = transits(sky, natal_charts())
    alm = almanac(now)
    lun = lunation_houses(now)
    lvi = lore_vs_intel(sky, nat, intel_items())
    prev_test = json.load(open(TEST, encoding='utf-8')) if os.path.exists(TEST) else {}
    cached = json.load(open(SERIES, encoding='utf-8')) if os.path.exists(SERIES) else {}
    missing = [k for k in ('ua_alarms', 'il_rockets', 'ru_losses', 'quakes') if not cached.get(k)]   # a source never loaded yet
    if ('--test' in sys.argv or not prev_test or missing or
            prev_test.get('at', '') < (now - timedelta(days=6)).strftime('%Y-%m-%d')):
        series, notes = load_series(now)
        test = {'at': now.strftime('%Y-%m-%dT%H:%M:%SZ'), 'results': fair_test(series, now), 'notes': notes}
        with open(TEST, 'w', encoding='utf-8') as f:
            json.dump(test, f, indent=1)
        print(f"fair test rerun: {len(test['results'])} claims" + (f"; {'; '.join(notes)}" if notes else ''))
    else:
        test = prev_test
    for r in test.get('results', []):
        print(f"  {r['claim']} / {r['metric']}: {r['verdict']} (n={r['days']})")
    out = {'v': 1, 'at': now.strftime('%Y-%m-%dT%H:%M:%SZ'), 'sky': sky, 'nations': nat, 'almanac': alm,
           'lunation': lun, 'lore_vs_intel': lvi, 'test': test}
    if '--no-model' not in sys.argv:
        from crystal_ball import ask
        try:
            ans, spend = ask(reading_prompt(now, sky, nat, alm, lun, lvi, test.get('results', [])))
            out['reading'] = {k: ans.get(k) for k in ('title', 'overview', 'nations', 'lore_and_intel', 'watch', 'the_test')}
            out['spend'] = spend
        except Exception as e:
            print(f'reading not written: {str(e)[:120]}')
            prev = json.load(open(OUT, encoding='utf-8')) if os.path.exists(OUT) else {}
            if prev.get('reading'):
                out['reading'], out['reading_from'] = prev['reading'], prev.get('at')
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"wrote {OUT}: {len(sky['aspects'])} aspects, {sum(len(n['hits']) for n in nat)} national transits, "
          f"{len(alm)} almanac events, {sum(len(c['matches']) for c in lvi)} lore/intel overlaps")


if __name__ == '__main__':
    main()
