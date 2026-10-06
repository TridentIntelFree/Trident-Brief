"""Radio watch: real shortwave audio of UVB-76 and HFGCS for the Signals section.

A phone cannot hear shortwave -- its radios are cellular, Wi-Fi, Bluetooth and
GPS, all far above these frequencies -- so this borrows public KiwiSDR receivers
(kiwisdr.com/public), the same ones a listener would open in a browser.

It runs a relay per channel: record a slice (2 minutes), hang up, move to a
different receiver, record the next slice, and so on for most of each half
hour. No receiver is held for more than one slice at a time, a receiver is
never used twice running, and only receivers with at least two free slots are
used, so nobody's last slot is taken. Recordings use kiwirecorder from
github.com/jks-prv/kiwiclient, connected as "TridentBrief" so owners can see
who it is.

Each slice is analysed here (the Buzzer's pulse rate, stretches of voice,
signal level) and goes into a 48-hour timeline. The latest slice per channel
is kept as an MP3 for the page's analyzer, and any slice with voice in it --
a UVB-76 message, an HFGCS broadcast -- is kept as an event clip.

Run by .github/workflows/radio-watch.yml. Output goes to RADIO_OUT (default
radio-data/radio), which that workflow publishes to the radio-data branch,
replaced on every run so audio never piles up in the repository's history.
"""
import glob
import json
import os
import random
import re
import shutil
import subprocess
import sys
import wave
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import numpy as np
import requests

OUT = os.environ.get('RADIO_OUT') or 'radio-data/radio'
KIWICLIENT = os.environ.get('KIWICLIENT', 'kiwiclient')
SECONDS = int(os.environ.get('RADIO_SLICE') or 120)        # one slice per receiver, then hand off
MINUTES = float(os.environ.get('RADIO_MINUTES') or 24)     # how long the relay runs each time
EVENTS_KEPT = 12                                            # voice clips kept per channel
KEEP_HOURS = 48
UA = 'TridentBrief/1.0 (github.com/TridentIntelFree/Trident-Brief)'

# Regions as (lat_min, lat_max, lon_min, lon_max).
EUROPE = (36, 70, -11, 45)
N_AMERICA = (24, 55, -125, -60)
CHANNELS = [
    {'id': 'uvb76', 'name': 'UVB-76', 'khz': 4625, 'mode': 'am', 'regions': [EUROPE]},
    {'id': 'hfgcs8992', 'name': 'HFGCS 8992', 'khz': 8992, 'mode': 'usb', 'regions': [N_AMERICA, EUROPE]},
    {'id': 'hfgcs11175', 'name': 'HFGCS 11175', 'khz': 11175, 'mode': 'usb', 'regions': [N_AMERICA, EUROPE]},
]


# ------------------------------------------------------------ receivers
def receivers():
    """Public KiwiSDRs from kiwisdr.com/public: each entry's fields sit in HTML comments."""
    r = requests.get('http://kiwisdr.com/public/', timeout=30, headers={'User-Agent': UA})
    r.raise_for_status()
    out, cur = [], None
    for line in r.text.splitlines():
        if "<div class='cl-info'>" in line:
            cur = {}
            continue
        if cur is None:
            continue
        m = re.search(r'<!-- (\w+)=(.*) -->', line)
        if m:
            cur[m.group(1)] = m.group(2).strip()
            continue
        m = re.search(r'>(https?://[^<]+)</a>', line)
        if m:
            cur['url'] = m.group(1).strip()
            out.append(cur)
        cur = None
    return out


def usable(rx, ch):
    try:
        if rx.get('offline', 'no') != 'no' or 'url' not in rx:
            return None
        if rx.get('pwd') not in (None, '', '0', 'no'):          # password-protected
            return None
        users, top = int(rx.get('users', 99)), int(rx.get('users_max', 0))
        if top - users < 2:
            return None
        lo, hi = (int(x) for x in rx.get('bands', '0-30000000').split('-')[:2])
        if not lo <= ch['khz'] * 1000 <= hi:
            return None
        lat, lon = (float(x) for x in re.findall(r'-?\d+(?:\.\d+)?', rx.get('gps', ''))[:2])
        if not any(a <= lat <= b and c <= lon <= d for a, b, c, d in ch['regions']):
            return None
        m = re.match(r'https?://([^:/]+)(?::(\d+))?', rx['url'])
        snr = int((re.findall(r'\d+', rx.get('snr', '')) or [0])[0])
        return {'host': m.group(1), 'port': int(m.group(2) or 80), 'url': rx['url'], 'snr': snr,
                'name': re.sub(r'<[^>]+>', '', rx.get('name', ''))[:80], 'loc': rx.get('loc', '')[:60],
                'lat': lat, 'lon': lon}
    except Exception:
        return None


def candidates(all_rx, ch, n=4):
    ok = [u for u in (usable(r, ch) for r in all_rx) if u]
    ok.sort(key=lambda u: -u['snr'])
    top = ok[:12]
    random.shuffle(top)             # spread the load across the good receivers
    return top[:n]


def record(ch, rx, path_base):
    cmd = [sys.executable, os.path.join(KIWICLIENT, 'kiwirecorder.py'), '-s', rx['host'], '-p', str(rx['port']),
           '-f', str(ch['khz']), '-m', ch['mode'], '--tlimit', str(SECONDS), '-d', os.path.dirname(path_base),
           '--fn', os.path.basename(path_base), '-u', 'TridentBrief', '--connect-retries', '1',
           '--connect-timeout', '10', '--busy-retries', '0', '-q']
    if ch['mode'] == 'usb':
        cmd += ['-L', '200', '-H', '2800']
    try:
        subprocess.run(cmd, timeout=SECONDS + 45, capture_output=True, text=True)
    except subprocess.TimeoutExpired:
        pass
    # kiwirecorder names the file from --fn; take whatever .wav it wrote for this base
    got = sorted(glob.glob(path_base + '*.wav'), key=os.path.getmtime)
    wav = got[-1] if got else None
    return wav if wav and os.path.getsize(wav) > 44 + 8000 else None


# -------------------------------------------------------------- analysis
def read_wav(path):
    with wave.open(path) as w:
        sr, n, ch, sw = w.getframerate(), w.getnframes(), w.getnchannels(), w.getsampwidth()
        raw = w.readframes(n)
    x = np.frombuffer(raw, dtype='<i2' if sw == 2 else np.uint8).astype(np.float32)
    if sw != 2:
        x = (x - 128) * 256
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    return x / 32768.0, sr


def analyse(x, sr):
    """The same detectors as the page's analyzer: sub-band periodicity for the
    Buzzer's pulse train, median step of the speech band for voice."""
    N = 2048
    hop = N // 2             # half-overlapping windows: finer timing for the pulse rate
    rows = (len(x) - N) // hop
    if rows < 40:
        return {'seconds': round(len(x) / sr, 1), 'state': 'short'}
    win = np.hanning(N)
    f = np.fft.rfftfreq(N, 1 / sr)
    edges = np.geomspace(60, min(3400, sr / 2 - 100), 9)
    bands = [(f >= a) & (f < b) for a, b in zip(edges[:-1], edges[1:])]
    speech = (f >= 300) & (f <= 3000)
    B, S, L = [], [], []
    for i in range(rows):
        X = np.abs(np.fft.rfft(x[i * hop:i * hop + N] * win)) ** 2 / (N * N) + 1e-20
        B.append([10 * np.log10(X[m].mean()) for m in bands])
        S.append(10 * np.log10(X[speech].mean()))
        L.append(10 * np.log10(X[(f >= 60) & (f <= 3400)].mean()))
    B, S, L = np.array(B), np.array(S), np.array(L)
    hz = sr / hop
    # pulses: autocorrelation per sub-band, periods 0.4-5 s
    best = (0.0, None)
    lo, hi = int(np.ceil(0.4 * hz)), min(int(5 * hz), int(rows / 2.5))
    for b in range(B.shape[1]):
        e = B[:, b] - B[:, b].mean()
        v = (e * e).sum()
        if v <= 1e-9 or hi <= lo + 2:
            continue
        ac = np.array([(e[:-L_] * e[L_:]).sum() / v for L_ in range(lo - 1, hi + 2)])
        for k in range(1, len(ac) - 1):
            if ac[k] >= ac[k - 1] and ac[k] >= ac[k + 1] and ac[k] > best[0]:
                best = (float(ac[k]), (lo - 1 + k) / hz)
                break
    pulses = best[1] if best[0] >= 0.5 else None
    # voice: 3 s windows whose speech-band level keeps changing
    w = int(3 * hz)
    floor = np.percentile(S, 10)
    voice_rows = np.zeros(rows, bool)
    for i in range(0, rows - w + 1, max(1, w // 3)):
        seg = S[i:i + w]
        if np.median(np.abs(np.diff(seg))) > 1.2 and seg.mean() - floor > 1.5:
            voice_rows[i:i + w] = True
    segs, start = [], None
    for i, on in enumerate(list(voice_rows) + [False]):
        if on and start is None:
            start = i
        elif not on and start is not None:
            if (i - start) / hz >= 1.5:
                segs.append([round(start / hz, 1), round(i / hz, 1)])
            start = None
    spread = float(np.percentile(L, 90) - np.percentile(L, 10))
    state = 'voice' if segs else 'buzz' if pulses else ('signal' if spread > 6 else 'quiet')
    return {'seconds': round(len(x) / sr, 1), 'sr': sr, 'state': state,
            'pulse_per_min': round(60 / pulses, 1) if pulses else None, 'pulse_score': round(best[0], 2),
            'voice': segs[:12], 'level_db': round(float(np.median(L)), 1), 'spread_db': round(spread, 1)}


def to_mp3(wav, mp3):
    if not shutil.which('ffmpeg'):
        return False
    r = subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-ac', '1', '-codec:a', 'libmp3lame',
                        '-b:a', '40k', mp3], capture_output=True, timeout=60)
    return r.returncode == 0 and os.path.exists(mp3)


# ------------------------------------------------------------------ main
def stamp(t=None):
    return (t or datetime.now(timezone.utc)).strftime('%Y-%m-%dT%H:%M:%SZ')


class Relay:
    """Receiver list shared by the channels, refreshed every ten minutes."""
    def __init__(self):
        self.rx, self.at = [], None

    def get(self):
        now = datetime.now(timezone.utc)
        if not self.at or now - self.at > timedelta(minutes=10):
            try:
                self.rx = receivers()
                self.at = now
                print(f'radio: {len(self.rx)} public receivers listed')
            except Exception as e:
                print(f'radio: receiver list unavailable ({str(e)[:80]})')
        return self.rx


def watch(ch, relay, deadline, state):
    """One channel's relay until the deadline."""
    os.makedirs(os.path.join(OUT, 'events'), exist_ok=True)
    recent, slices, misses = [], [], 0
    while datetime.now(timezone.utc) + timedelta(seconds=SECONDS / 2) < deadline:
        pool = [c for c in candidates(relay.get(), ch, n=8) if c['host'] not in recent[-2:]]
        if not pool:
            misses += 1
            if misses > 3:
                break
            continue
        rx, start = pool[0], datetime.now(timezone.utc)
        base = os.path.join(OUT, f"{ch['id']}-slice")
        for old in glob.glob(base + '*.wav'):
            os.remove(old)
        wav = record(ch, rx, base)
        recent.append(rx['host'])
        if not wav:
            misses += 1
            if misses > 6:
                break
            continue
        misses = 0
        x, sr = read_wav(wav)
        a = analyse(x, sr)
        slices.append({'channel': ch['id'], 'at': stamp(start), 'secs': a.get('seconds'), 'state': a['state'],
                       'pulse_per_min': a.get('pulse_per_min'),
                       'voice_s': round(sum(e - b for b, e in a.get('voice') or []), 1), 'rx': rx['loc'] or rx['host']})
        latest = os.path.join(OUT, f"{ch['id']}.mp3")
        ok = to_mp3(wav, latest)
        if ok:
            state['clips'][ch['id']] = {'channel': ch['id'], 'name': ch['name'], 'khz': ch['khz'], 'mode': ch['mode'],
                                        'at': stamp(start), 'file': f"radio/{ch['id']}.mp3",
                                        'rx': {k: rx[k] for k in ('name', 'loc', 'url', 'lat', 'lon')}, **a}
        if a.get('voice') and ok:
            name = f"events/{ch['id']}-{start:%Y%m%d-%H%M%S}.mp3"
            shutil.copyfile(latest, os.path.join(OUT, name))
            state['events'].append({'channel': ch['id'], 'name': ch['name'], 'at': stamp(start), 'file': f'radio/{name}',
                                    'voice': a['voice'], 'secs': a.get('seconds'), 'rx': rx['loc'] or rx['host']})
            print(f"  {ch['name']}: VOICE at {stamp(start)} via {rx['loc'] or rx['host']}")
        os.remove(wav)
    print(f"  {ch['name']}: {len(slices)} slice(s) via " + ', '.join(sorted({s['rx'] for s in slices}))[:200])
    return slices


def main():
    os.makedirs(OUT, exist_ok=True)
    if not os.path.exists(os.path.join(KIWICLIENT, 'kiwirecorder.py')):
        sys.exit('kiwiclient not found (set KIWICLIENT)')
    path = os.path.join(OUT, 'radio.json')
    try:
        prev = json.load(open(path, encoding='utf-8'))
    except Exception:
        prev = {}
    state = {'clips': {c['channel']: c for c in prev.get('clips') or []}, 'events': list(prev.get('events') or [])}
    deadline = datetime.now(timezone.utc) + timedelta(minutes=MINUTES)
    relay = Relay()
    relay.get()
    with ThreadPoolExecutor(max_workers=len(CHANNELS)) as ex:
        runs = list(ex.map(lambda c: watch(c, relay, deadline, state), CHANNELS))
    cut = stamp(datetime.now(timezone.utc) - timedelta(hours=KEEP_HOURS))
    timeline = [t for t in prev.get('timeline') or [] if t.get('at', '') >= cut] + [s for r in runs for s in r]
    # keep the newest event clips per channel; delete the files of the rest
    keep = []
    for ch in CHANNELS:
        evs = sorted((e for e in state['events'] if e['channel'] == ch['id']), key=lambda e: e['at'], reverse=True)
        keep += evs[:EVENTS_KEPT]
        for e in evs[EVENTS_KEPT:]:
            p = os.path.join(OUT, e['file'].split('radio/', 1)[1])
            if os.path.exists(p):
                os.remove(p)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump({'v': 2, 'at': stamp(), 'slice_seconds': SECONDS, 'minutes': MINUTES,
                   'clips': list(state['clips'].values()), 'events': sorted(keep, key=lambda e: e['at'], reverse=True),
                   'timeline': timeline[-5000:]}, f, separators=(',', ':'))
    print('radio: ' + ', '.join(f"{c['name']} {len(r)} slices" for c, r in zip(CHANNELS, runs)))


if __name__ == '__main__':
    main()
