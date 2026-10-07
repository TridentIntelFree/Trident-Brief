#!/usr/bin/env python3
"""Everything the app gathers, in one place, for an analysis session.

The page is built from data collected on GitHub's runners: the twice-daily
brief and its feeds (main branch), the half-hourly feed refresh (published
here to the intel-data branch), the radio relay (radio-data branch) and the
hidden desks (Crystal Ball, Analyst Desk, Tazewell brief, all on main). A
Claude Code session gets the repository but not the live site, so this
reads all of it through git, falling back to raw.githubusercontent.com.

    python3 intel.py sync              fetch the latest of every branch
    python3 intel.py                   overview: what each source says now, and how fresh it is
    python3 intel.py brief [N|date]    the latest brief, or the Nth back, or one by date (2026-10-06)
    python3 intel.py warnings          maritime navigational warnings (UK, Japan, China, NGA if live)
    python3 intel.py osint [theatre]   situationmonitor events; front line; Telegram lean
    python3 intel.py telegram [N]      the latest Telegram war-channel posts, in English
    python3 intel.py gdelt | wire [N] | quakes | launches | disasters | gps
    python3 intel.py radio             UVB-76 / HFGCS timeline and voice events
    python3 intel.py spectro FILE [t0 t1]   spectrogram PNG of a radio clip (needs numpy, matplotlib, imageio-ffmpeg)
    python3 intel.py crystal | desk | area
    python3 intel.py search TERM [--days N]   every text source at once
    python3 intel.py history [days]    day-by-day trend from the daily digests
    python3 intel.py json ROOT[.path]  raw JSON (roots: feeds brief ball desk area radio history status)

The workflow side, run by refresh-feeds after each refresh:

    python3 intel.py publish OUTDIR [--prev DIR]
"""
import json
import os
import re
import subprocess
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from urllib.request import Request, urlopen

REPO = os.environ.get('GITHUB_REPOSITORY', 'TridentIntelFree/Trident-Brief')
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '.intel')
BRANCHES = ('main', 'intel-data', 'radio-data')
DAILY_KEEP = 60          # days of daily digests kept on intel-data
HOURLY_KEEP = 72         # hours of hourly digests
NOW = datetime.now(timezone.utc)


# ---------------------------------------------------------------- reading

def _git(*args):
    return subprocess.run(['git', '-C', HERE, *args], capture_output=True)


def sync():
    # never --depth: on main it would make the session's working clone shallow,
    # and the data branches are single orphan commits anyway
    for b in BRANCHES:
        r = _git('fetch', '-q', 'origin', f'+{b}:refs/remotes/origin/{b}')
        print(f"{b:11} {'ok' if r.returncode == 0 else 'FAILED ' + r.stderr.decode()[:120].strip()}")


_mem = {}


def read(branch, path, binary=False):
    """A file from a branch: git first (the session's clone), then the raw URL."""
    key = (branch, path)
    if key in _mem:
        return _mem[key]
    r = _git('show', f'origin/{branch}:{path}')
    data = r.stdout if r.returncode == 0 else None
    if data is None:
        try:
            req = Request(f'https://raw.githubusercontent.com/{REPO}/{branch}/{path}',
                          headers={'User-Agent': 'trident-intel'})
            data = urlopen(req, timeout=30).read()
        except Exception:
            data = None
    if data is not None and not binary:
        data = data.decode('utf-8', 'replace')
    _mem[key] = data
    return data


def jread(branch, path):
    t = read(branch, path)
    try:
        return json.loads(t) if t else None
    except ValueError:
        return None


def listdir(branch, path):
    r = _git('ls-tree', '--name-only', f'origin/{branch}', path.rstrip('/') + '/')
    return [p.split('/')[-1] for p in r.stdout.decode().split()] if r.returncode == 0 else []


def feeds():
    """The freshest feeds: the half-hourly snapshot if there is one, else the brief's own."""
    snap = jread('intel-data', 'latest.json')
    brief = jread('main', 'latest-brief.json') or {}
    if snap and snap.get('feeds'):
        return snap['feeds'], snap.get('at'), 'intel-data (half-hourly refresh)'
    return brief.get('feeds') or {}, brief.get('generated_at'), 'main (brief run)'


def ts(s):
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return datetime.fromtimestamp(s / 1000 if s > 1e11 else s, timezone.utc)
    s = str(s).strip()
    for fmt in ('%Y-%m-%dT%H:%M:%S.%f%z', '%Y-%m-%dT%H:%M:%S%z', '%Y-%m-%dT%H:%M%z', '%Y-%m-%d'):
        try:
            t = datetime.strptime(s.replace('Z', '+0000'), fmt)
            return t if t.tzinfo else t.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    return None


def age(s):
    t = ts(s)
    if not t:
        return '?'
    m = (NOW - t).total_seconds() / 60
    return f'{m:.0f}m ago' if m < 90 else f'{m / 60:.1f}h ago' if m < 48 * 60 else f'{m / 1440:.0f}d ago'


def head(title):
    print(f'\n== {title} ' + '=' * max(0, 70 - len(title)))


def clip(s, n=160):
    s = ' '.join(str(s or '').split())
    return s if len(s) <= n else s[:n - 1] + '…'


# ---------------------------------------------------------------- views

def v_overview():
    f, at, src = feeds()
    brief = jread('main', 'latest-brief.json') or {}
    ball = jread('main', 'data/crystal/ball.json') or {}
    desk = jread('main', 'data/analyst/desk.json') or {}
    area = jread('main', 'data/area/tazewell.json') or {}
    radio = jread('radio-data', 'radio/radio.json') or {}
    head('FRESHNESS')
    for name, t in (('feeds (' + src + ')', at), ('brief', brief.get('generated_at')), ('crystal ball', ball.get('at')),
                    ('analyst desk', desk.get('at')), ('tazewell', area.get('at')), ('radio relay', radio.get('at'))):
        print(f'  {name:42} {str(t)[:19]:20} {age(t)}')
    if f.get('errors'):
        print('  feed errors: ' + '; '.join(f'{k}: {clip(v, 90)}' for k, v in f['errors'].items()))
    head('BRIEF - BLUF')
    print(clip(_bluf(brief.get('content', '')), 900))
    v_warnings(limit=10)
    _osint_summary(f)
    head('GDELT HOTSPOTS (3+ outlets)')
    for g in (f.get('gdelt') or [])[:8]:
        print(f"  {g.get('events', 0):>4} ev {g.get('outlets', 0):>3} outlets  {clip(g.get('place'), 50):50} {', '.join(g.get('what') or [])[:60]}")
    gps = f.get('gpsjam') or {}
    head(f"GPS INTERFERENCE ({len(gps.get('cells') or [])} cells flagged, last {gps.get('hours', '?')}h)")
    print('  ' + ', '.join(f'{c[0]},{c[1]}' for c in (gps.get('cells') or [])[:15]))
    _radio_summary(radio)
    head('CRYSTAL BALL')
    cl = ball.get('clock') or {}
    print(f"  Doomsday Clock {cl.get('seconds', '?')} s to midnight; nuclear trend: {(ball.get('nuclear') or {}).get('trend', '?')}")
    print('  ' + clip(ball.get('bluf'), 400))
    for fc in (ball.get('forecasts') or [])[:5]:
        print(f"  {fc.get('probability', '?'):>3}% {fc.get('horizon', ''):>4}  {clip(fc.get('event'), 110)}")
    head('ANALYST DESK')
    print('  ' + clip(_bluf(desk.get('desk', '')), 500))
    head('TAZEWELL')
    print('  ' + clip(_bluf(area.get('brief', '')), 500))
    q = [x for x in f.get('quakes') or [] if (x.get('mag') or 0) >= 5]
    head(f'OTHER: {len(q)} quakes M5+, {len(f.get("launches") or [])} launches, '
         f'{len(f.get("disasters") or [])} GDACS events, {len(f.get("wire") or [])} wire items')


def _bluf(text):
    m = re.search(r'BLUF\**:?\**\s*(.+?)(?:\n\s*\n|\n#|$)', text or '', re.S)
    return m.group(1) if m else (text or '')[:600]


def v_brief(arg=None):
    idx = jread('main', 'archive/index.json') or []
    if arg is None or arg == '0':
        print((jread('main', 'latest-brief.json') or {}).get('content', '(no brief)'))
        return
    if re.fullmatch(r'\d+', arg):
        e = idx[int(arg)] if int(arg) < len(idx) else None
    else:
        e = next((e for e in idx if arg.replace('-', '') in e['path'].replace('-', '')), None)
    if not e:
        print('no such brief; recent:', ', '.join(x['path'].split('/')[-1] for x in idx[:10]))
        return
    print(f"# {e['date']}  ({e['path']})\n")
    print(read('main', e['path']) or '(unreadable)')


def v_warnings(limit=60):
    f, at, _ = feeds()
    nw = f.get('navwarn') or []
    head(f'MARITIME WARNINGS ({len(nw)} current; UK, Japan, China, NGA if live)')
    if not nw and (f.get('errors') or {}).get('navwarn'):
        print('  unavailable: ' + f['errors']['navwarn'])
    for w in nw[:limit]:
        pos = f"{w['lat']:.2f},{w['lon']:.2f}" if w.get('lat') is not None else 'no pos'
        print(f"  {w.get('issued', '')[:16]:16} {w.get('kind', ''):19} {clip(w.get('id'), 30):30} {pos:14} {clip(w.get('text'), 150)}")


def _osint_summary(f, theatre=None):
    o = f.get('osint') or {}
    fr = o.get('front') or {}
    head('FRONT LINE (DeepStateMap via tracker-data)')
    if fr:
        print(f"  Russian-held {fr.get('km2', 0):,} km2 as of {fr.get('as_of')}; "
              f"7d {fr.get('change_7d', 0):+} km2, 30d {fr.get('change_30d', 0):+} km2")
    lean = o.get('tg_lean') or {}
    tg = o.get('tg') or []
    head(f'TELEGRAM ({len(tg)} posts kept, 24h)')
    print('  lean: ' + ', '.join(f'{k} {v}' for k, v in sorted(lean.items(), key=lambda x: -x[1])))
    sm = [e for e in o.get('sm') or [] if not theatre or theatre.lower() in str(e.get('th', '')).lower()]
    head(f'SITUATIONMONITOR EVENTS ({len(sm)}{" in " + theatre if theatre else ""}, 48h)')
    print('  by theatre: ' + ', '.join(f'{k} {v}' for k, v in Counter(e.get('th') for e in o.get('sm') or []).most_common()))
    for e in sm[:12 if not theatre else 60]:
        cas = f" [{e.get('k') or 0}k/{e.get('inj') or 0}w]" if e.get('k') or e.get('inj') else ''
        print(f"  {str(e.get('at', ''))[5:16]:11} {e.get('th', ''):8} {e.get('ty', ''):13} {e.get('st', ''):11} "
              f"{clip(e.get('sm'), 120)}{cas}")


def v_osint(theatre=None):
    _osint_summary(feeds()[0], theatre)


def v_telegram(n='40'):
    tg = ((feeds()[0].get('osint') or {}).get('tg') or [])[:int(n)]
    head(f'TELEGRAM, latest {len(tg)} (machine-translated where marked)')
    for i in tg:
        print(f"  {str(i.get('at', ''))[5:16]} {i.get('b', ''):13} {clip(i.get('s'), 18):18} {clip(i.get('r'), 18):18} "
              f"{'[tr] ' if i.get('o') else ''}{clip(i.get('t'), 170)}")


def v_gdelt():
    for g in feeds()[0].get('gdelt') or []:
        print(f"  {g.get('events', 0):>4} ev {g.get('outlets', 0):>3} outlets  {clip(g.get('place'), 50):50} {', '.join(g.get('what') or [])}")


def v_wire(n='60'):
    w = sorted(feeds()[0].get('wire') or [], key=lambda x: x.get('at') or '', reverse=True)[:int(n)]
    for i in w:
        print(f"  {str(i.get('at', ''))[5:16]} {i.get('d', ''):8} {clip(', '.join(i.get('s') or []), 18):18} {clip(i.get('t'), 120)}")


def v_quakes():
    for q in sorted(feeds()[0].get('quakes') or [], key=lambda q: -(q.get('mag') or 0))[:30]:
        print(f"  M{q.get('mag')} {ts(q.get('time')):%m-%d %H:%MZ} depth {q.get('depth', 0):.0f} km  {q.get('place')}")


def v_launches():
    for l in feeds()[0].get('launches') or []:
        print(f"  {l.get('net', '')[:16]} {l.get('status', ''):8} {clip(l.get('name'), 50):50} {l.get('pad')}")


def v_disasters():
    for d in sorted(feeds()[0].get('disasters') or [], key=lambda d: {'Red': 0, 'Orange': 1}.get(d.get('level'), 2)):
        print(f"  {d.get('level', ''):6} {d.get('kind', ''):3} {clip(d.get('name'), 120)}")


def v_gps():
    g = feeds()[0].get('gpsjam') or {}
    print(f"window {g.get('hours')}h, {g.get('runs')} runs, {g.get('checked')} aircraft checked, {g.get('cells_seen')} cells seen")
    print('cells flagged [lat, lon, aircraft, bad, bad-in-latest-run]:')
    for c in g.get('cells') or []:
        print('  ', c)


def _radio_summary(radio, hours=24):
    tl = [t for t in radio.get('timeline') or [] if (ts(t.get('at')) or NOW) > NOW - timedelta(hours=hours)]
    head(f'RADIO ({len(tl)} two-minute slices in {hours}h)')
    for ch in sorted({t['channel'] for t in tl}):
        s = [t for t in tl if t['channel'] == ch]
        c = Counter(t['state'] for t in s)
        rates = [t['pulse_per_min'] for t in s if t.get('pulse_per_min')]
        print(f"  {ch:11} " + ', '.join(f'{k} {v}' for k, v in c.most_common())
              + (f"; buzz {min(rates):.1f}-{max(rates):.1f}/min" if rates else '')
              + f"; receivers: {clip(', '.join(sorted({t.get('rx', '?') for t in s})), 90)}")
    for e in (radio.get('events') or [])[:12]:
        secs = sum(b - a for a, b in e.get('voice') or [])
        print(f"  VOICE {e['at'][5:16]} {e.get('name', ''):12} {secs:5.1f}s via {e.get('rx')}  {e.get('file')}")


def v_radio():
    desk = jread('main', 'data/analyst/desk.json') or {}
    head(f"REPORTED BY RADIO MONITORS on X (collected {desk.get('at')}, {age(desk.get('at'))})")
    for r in desk.get('radio') or []:
        print(f"  {r.get('at', '')[:16]:16} {r.get('station', ''):14} {r.get('khz') or '':>6} {clip(r.get('what'), 110)}  @{r.get('by')} {r.get('url')}")
    if 'radio' not in desk:
        print('  (none collected yet)')
    radio = jread('radio-data', 'radio/radio.json') or {}
    print(f"\nThe recording relay was RETIRED on 7 Oct 2026; its archive was last updated {radio.get('at')} ({age(radio.get('at'))})")
    _radio_summary(radio, 48)
    head('TIMELINE (newest last)')
    for t in sorted(radio.get('timeline') or [], key=lambda t: t['at'])[-60:]:
        print(f"  {t['at'][5:16]} {t['channel']:11} {t['state']:6} {t.get('pulse_per_min') or '':>5} "
              f"voice {t.get('voice_s', 0):>5}s  {t.get('rx')}")


def v_spectro(path, t0='0', t1=None):
    """A clip from radio-data as a spectrogram PNG, to look at rather than trust a detector."""
    try:
        import numpy as np
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
    except ImportError:
        sys.exit('pip install numpy matplotlib imageio-ffmpeg')
    try:
        import imageio_ffmpeg
        ff = imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        ff = 'ffmpeg'
    rel = path if path.startswith('radio/') else 'radio/events/' + os.path.basename(path)
    data = read('radio-data', rel, binary=True) if not os.path.exists(path) else open(path, 'rb').read()
    if not data:
        sys.exit(f'no such clip: {rel}')
    os.makedirs(CACHE, exist_ok=True)
    src = os.path.join(CACHE, os.path.basename(rel))
    open(src, 'wb').write(data)
    sr = 12000
    raw = subprocess.run([ff, '-v', 'quiet', '-i', src, '-f', 's16le', '-ac', '1', '-ar', str(sr), '-'],
                         capture_output=True).stdout
    x = np.frombuffer(raw, np.int16).astype(float)
    a, b = float(t0), float(t1) if t1 else len(x) / sr
    seg = x[int(a * sr):int(b * sr)]
    fig, ax = plt.subplots(2, 1, figsize=(12, 6), gridspec_kw={'height_ratios': [3, 1]})
    ax[0].specgram(seg, NFFT=1024, Fs=sr, noverlap=896, cmap='magma')
    ax[0].set_ylim(0, 3500)
    ax[0].set_title(f'{os.path.basename(rel)}  {a:.0f}-{b:.0f}s')
    env = np.sqrt(np.convolve(seg ** 2, np.ones(600) / 600, 'same'))
    ax[1].plot(np.arange(len(env)) / sr, 20 * np.log10(env + 1))
    ax[1].set_xlim(0, len(seg) / sr)
    plt.tight_layout()
    out = os.path.join(CACHE, os.path.basename(rel).rsplit('.', 1)[0] + f'_{a:.0f}-{b:.0f}.png')
    plt.savefig(out, dpi=70)
    print(out)


def v_crystal():
    b = jread('main', 'data/crystal/ball.json') or {}
    print(f"made {b.get('at')} ({age(b.get('at'))}); clock {(b.get('clock') or {}).get('seconds')} s; "
          f"nuclear {(b.get('nuclear') or {}).get('trend')}: {(b.get('nuclear') or {}).get('why')}")
    print('\n' + (b.get('bluf') or ''))
    head('FORECASTS')
    for f in b.get('forecasts') or []:
        print(f"  {f.get('probability')}% ({f.get('term')}) by {str(f.get('deadline'))[:16]} [{f.get('region')}] {f.get('event')}")
        if f.get('watch_for'):
            print(f"      watch for: {clip(f.get('watch_for'), 200)}")
    head('PRE-HEADLINE SIGNALS')
    for p in b.get('pre_headline') or []:
        print(f"  {clip(p.get('signal'), 120)}  <- {p.get('source')}")
    head('TRACK RECORD (estimative terms vs outcomes)')
    for k, v in ((b.get('record') or {}).get('by_term') or {}).items():
        print(f"  {k:22} called {v.get('called')}, happened {v.get('triggered')}, not {v.get('not')}, open {v.get('open')}, rate {v.get('rate')}")


def v_desk():
    d = jread('main', 'data/analyst/desk.json') or {}
    print(f"{d.get('at')} ({age(d.get('at'))}), {d.get('hours')}h window, cost ${d.get('cost_usd')}\n")
    print(d.get('desk') or '(none)')


def v_area():
    a = jread('main', 'data/area/tazewell.json') or {}
    print(f"{a.get('area')} {a.get('at')} ({age(a.get('at'))})\n")
    print(a.get('brief') or '(none)')


def _texts(days):
    """(source, when, text) for everything searchable."""
    f, at, _ = feeds()
    o = f.get('osint') or {}
    for w in f.get('navwarn') or []:
        yield 'warning ' + str(w.get('id')), w.get('issued'), f"{w.get('text')} {w.get('o') or ''}"
    for e in o.get('sm') or []:
        yield 'situationmonitor', e.get('at'), f"{e.get('sm')} ({e.get('pl')})"
    for i in o.get('tg') or []:
        yield 'telegram ' + str(i.get('s')), i.get('at'), f"{i.get('t')} {i.get('o') or ''}"
    for i in f.get('wire') or []:
        yield 'wire ' + ', '.join(i.get('s') or []), i.get('at'), i.get('t')
    for g in f.get('gdelt') or []:
        yield 'gdelt', None, f"{g.get('place')} {' '.join(g.get('what') or [])}"
    for name, path, key in (('desk', 'data/analyst/desk.json', 'desk'), ('tazewell', 'data/area/tazewell.json', 'brief'),
                            ('crystal', 'data/crystal/ball.json', None)):
        d = jread('main', path) or {}
        yield name, d.get('at'), d.get(key) if key else json.dumps(d, ensure_ascii=False)
    for e in jread('main', 'archive/index.json') or []:
        t = ts(e['path'].split('/')[-1][:10])
        if t and t > NOW - timedelta(days=days):
            yield 'brief ' + e['path'].split('/')[-1], e['date'], read('main', e['path'])


def v_search(term, days=7):
    rx = re.compile(re.escape(term), re.I)
    n = 0
    for src, when, text in _texts(days):
        for m in rx.finditer(text or ''):
            a, b = max(0, m.start() - 120), m.end() + 160
            print(f"[{src} | {str(when or '')[:16]}] …{clip(text[a:b], 300)}…")
            n += 1
            if n >= 120:
                print('(first 120 hits)')
                return
    print(f'{n} hits for "{term}" (briefs: last {days} days)')


def v_history(days='30'):
    names = sorted(listdir('intel-data', 'daily'))[-int(days):]
    if not names:
        print('no daily digests yet: they start with the first refresh after intel.py publish was added')
        return
    print(f"{'date':10} {'warn':>4} {'sm':>4} {'tg':>4} {'tg ru/ua':>9} {'front km2':>10} {'d7':>5} {'gps':>4} {'wire':>4} {'gdelt':>5}  top theatres")
    for n in names:
        d = jread('intel-data', 'daily/' + n) or {}
        c, o = d.get('counts') or {}, d.get('osint') or {}
        lean, fr = o.get('tg_lean') or {}, o.get('front') or {}
        th = ', '.join(f'{k} {v}' for k, v in sorted((o.get('sm_by_theatre') or {}).items(), key=lambda x: -x[1])[:3])
        print(f"{n[:10]:10} {c.get('navwarn', 0):>4} {c.get('sm', 0):>4} {c.get('tg', 0):>4} "
              f"{str(lean.get('pro-russian', 0)) + '/' + str(lean.get('pro-ukrainian', 0)):>9} {fr.get('km2', ''):>10} "
              f"{fr.get('change_7d', ''):>5} {c.get('gps', 0):>4} {c.get('wire', 0):>4} {c.get('gdelt', 0):>5}  {th}")


def v_json(spec):
    root, _, path = spec.partition('.')
    src = {'feeds': lambda: feeds()[0], 'brief': lambda: jread('main', 'latest-brief.json'),
           'ball': lambda: jread('main', 'data/crystal/ball.json'), 'desk': lambda: jread('main', 'data/analyst/desk.json'),
           'area': lambda: jread('main', 'data/area/tazewell.json'), 'radio': lambda: jread('radio-data', 'radio/radio.json'),
           'history': lambda: jread('main', 'history.json'), 'status': lambda: jread('intel-data', 'status.json')}
    if root not in src:
        sys.exit('roots: ' + ' '.join(src))
    d = src[root]()
    for k in filter(None, path.split('.')):
        d = d[int(k)] if isinstance(d, list) else (d or {}).get(k)
    print(json.dumps(d, ensure_ascii=False, indent=1))


# ---------------------------------------------------------------- publishing

def digest(f, at):
    """One compact record of a refresh: enough to see trends without the bulk."""
    o = f.get('osint') or {}
    gps = f.get('gpsjam') or {}
    return {
        'at': at,
        'counts': {'navwarn': len(f.get('navwarn') or []), 'sm': len(o.get('sm') or []), 'tg': len(o.get('tg') or []),
                   'gps': len(gps.get('cells') or []), 'wire': len(f.get('wire') or []), 'gdelt': len(f.get('gdelt') or []),
                   'quakes': len(f.get('quakes') or []), 'vessels': len(f.get('vessels') or []),
                   'aircraft': f.get('aircount'), 'disasters': len(f.get('disasters') or [])},
        'errors': f.get('errors') or {},
        'navwarn': [{k: w.get(k) for k in ('id', 'kind', 'src', 'issued', 'lat', 'lon')} | {'text': clip(w.get('text'), 240)}
                    for w in f.get('navwarn') or []],
        'osint': {'front': {k: v for k, v in (o.get('front') or {}).items() if k != 'rings'},
                  'tg_lean': o.get('tg_lean'),
                  'sm_by_theatre': dict(Counter(e.get('th') for e in o.get('sm') or [])),
                  'sm_by_type': dict(Counter(e.get('ty') for e in o.get('sm') or [])),
                  'sm_top': [{k: e.get(k) for k in ('at', 'th', 'ty', 'st', 'n', 'pl', 'k', 'inj')} | {'sm': clip(e.get('sm'), 200)}
                             for e in sorted(o.get('sm') or [], key=lambda e: -(e.get('sev') or 0))[:40]],
                  'tg_cells': [{k: c.get(k) for k in ('lat', 'lon', 'n', 'r', 'bias')} for c in (o.get('tgcells') or [])[:30]]},
        'gdelt': [{k: g.get(k) for k in ('place', 'lat', 'lon', 'events', 'outlets', 'what')} for g in f.get('gdelt') or []],
        'gps': gps.get('cells') or [],
        'wire': [{k: i.get(k) for k in ('at', 'd', 's', 't')} for i in (f.get('wire') or [])[:80]],
        'quakes': [{k: q.get(k) for k in ('mag', 'place', 'time', 'lat', 'lon')} for q in f.get('quakes') or [] if (q.get('mag') or 0) >= 4.5],
        'launches': f.get('launches') or [],
        'disasters': [d for d in f.get('disasters') or [] if d.get('level') in ('Orange', 'Red')],
    }


def publish(out, prev=None):
    """Write the intel-data branch's contents: the latest refresh in full,
    plus hourly and daily digests carried forward from the previous copy."""
    cache = json.load(open(os.path.join(HERE, 'latest-brief.json'), encoding='utf-8'))
    f = cache.get('feeds') or {}
    at = NOW.strftime('%Y-%m-%dT%H:%M:%SZ')
    for sub in ('daily', 'hourly'):
        os.makedirs(os.path.join(out, sub), exist_ok=True)
    with open(os.path.join(out, 'latest.json'), 'w', encoding='utf-8') as fh:
        json.dump({'at': at, 'brief_at': cache.get('generated_at'), 'feeds': f}, fh, ensure_ascii=False)
    for name in ('feed-status.json', 'gpsjam.json', 'signals.json'):
        p = os.path.join(HERE, 'assets', name)
        if os.path.exists(p):
            with open(p, 'rb') as a, open(os.path.join(out, name.replace('feed-', '')), 'wb') as b:
                b.write(a.read())
    d = digest(f, at)
    keep = {'daily': (NOW - timedelta(days=DAILY_KEEP)).strftime('%Y-%m-%d'),
            'hourly': (NOW - timedelta(hours=HOURLY_KEEP)).strftime('%Y-%m-%dT%H')}
    if prev:
        for sub, cut in keep.items():
            src = os.path.join(prev, sub)
            for n in os.listdir(src) if os.path.isdir(src) else []:
                if n[:len(cut)] >= cut and n.endswith('.json'):
                    with open(os.path.join(src, n), 'rb') as a, open(os.path.join(out, sub, n), 'wb') as b:
                        b.write(a.read())
    # the day's last refresh stands for the day; one per hour for the last three days
    for sub, name in (('daily', NOW.strftime('%Y-%m-%d')), ('hourly', NOW.strftime('%Y-%m-%dT%H'))):
        with open(os.path.join(out, sub, name + '.json'), 'w', encoding='utf-8') as fh:
            json.dump(d, fh, ensure_ascii=False)
    with open(os.path.join(out, 'README.md'), 'w') as fh:
        fh.write('Machine-written by the Refresh Live Feeds workflow (intel.py publish); force-pushed each run.\n'
                 'Read it with `python3 intel.py` from the main branch.\n')
    print(f"published {at}: {sum(1 for _ in os.scandir(os.path.join(out, 'daily')))} daily, "
          f"{sum(1 for _ in os.scandir(os.path.join(out, 'hourly')))} hourly digests")


# ---------------------------------------------------------------- main

def main(argv):
    if not argv:
        return v_overview()
    cmd, args = argv[0], argv[1:]
    if cmd == 'publish':
        prev = args[args.index('--prev') + 1] if '--prev' in args else None
        return publish(args[0], prev)
    if cmd == 'search':
        days = int(args[args.index('--days') + 1]) if '--days' in args else 7
        return v_search(' '.join(a for a in args if not a.startswith('--') and a != str(days)), days)
    views = {'sync': sync, 'overview': v_overview, 'brief': v_brief, 'warnings': v_warnings, 'osint': v_osint,
             'telegram': v_telegram, 'gdelt': v_gdelt, 'wire': v_wire, 'quakes': v_quakes, 'launches': v_launches,
             'disasters': v_disasters, 'gps': v_gps, 'radio': v_radio, 'spectro': v_spectro, 'crystal': v_crystal,
             'desk': v_desk, 'area': v_area, 'history': v_history, 'json': v_json}
    if cmd not in views:
        sys.exit(__doc__)
    views[cmd](*args)


if __name__ == '__main__':
    main(sys.argv[1:])
