#!/usr/bin/env python3
"""The public KiwiSDRs the page's live tuner can use.

The page is served over HTTPS, and a browser will not let an HTTPS page open
a plain ws:// connection, so the tuner can only reach receivers that answer
over TLS. Of the ~860 public KiwiSDRs only two say so in the public list, but
more sit behind their owners' own HTTPS domains. Once a week this checks
every listed receiver with a single /status request over TLS, and for the
ones that answer, opens one short audio connection to confirm it streams
(four seconds, identified as "TridentBrief check"). The result is written
to data/tuner/receivers.json, which the page reads.

The whole public list, trimmed to what a listener needs (where, antenna,
slots, the receiver's own noise figure and its address), is also written to
data/tuner/world.json from the same download, so the page can offer the
receivers it cannot reach itself as links that open their own pages.

No receiver is used for listening here: the tuner connects only when a
person presses a button, as the receivers' owners intend.
"""
import asyncio
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests
import websockets

import radio_monitor as rm

OUT = 'data/tuner/receivers.json'
WORLD = 'data/tuner/world.json'
ORIGIN = 'https://tridentintelfree.github.io'


def candidates(rx):
    """host[:port] strings worth trying over TLS for one listed receiver."""
    u = urlparse(rx['url'])
    h, p = u.hostname, u.port
    if not h or 'proxy.kiwisdr.com' in h:            # the proxy service has no TLS
        return []
    out = []
    if u.scheme == 'https' or (p and p != 80):
        out.append(f'{h}:{p}' if p and p != 443 else h)
    out.append(h)                                     # the same host on 443, behind its own TLS
    return list(dict.fromkeys(out))


def answers_tls(hp):
    try:
        r = requests.get(f'https://{hp}/status', timeout=5, headers={'User-Agent': rm.UA})
        return r.status_code == 200 and ('users' in r.text or 'status=' in r.text)
    except Exception:
        return False


async def streams(hp):
    """Frames of audio received in four seconds, or the reason for none."""
    n = 0
    try:
        async with websockets.connect(f'wss://{hp}/{int(time.time())}/SND', open_timeout=8, close_timeout=2,
                                      max_size=None, additional_headers={'Origin': ORIGIN}) as ws:
            await ws.send('SET auth t=kiwi p=')
            end = time.time() + 4
            while time.time() < end:
                try:
                    d = await asyncio.wait_for(ws.recv(), timeout=max(0.1, end - time.time()))
                except asyncio.TimeoutError:
                    break
                d = d.encode('latin-1') if isinstance(d, str) else d
                if d[:3] == b'SND':
                    n += 1
                    continue
                if d[:3] != b'MSG':
                    continue
                for pair in d[4:].decode('latin-1').split(' '):
                    k, _, v = pair.partition('=')
                    if k == 'audio_rate':
                        await ws.send(f'SET AR OK in={v} out=44100')
                    elif k == 'sample_rate':
                        for m in ('SET squelch=0 max=0', 'SET mod=am low_cut=-4000 high_cut=4000 freq=10000.000',
                                  'SET agc=1 hang=0 thresh=-100 slope=6 decay=1000 manGain=50',
                                  'SET compression=1', 'SET ident_user=TridentBrief%20check', 'SET keepalive'):
                            await ws.send(m)
                    elif k in ('too_busy', 'down', 'redirect') or (k == 'badp' and v != '0'):
                        return f'{k}={v}'
    except Exception as e:
        return 'ERR ' + str(e)[:60]
    return n


def num(v):
    m = re.findall(r'-?\d+(?:\.\d+)?', v or '')
    return float(m[0]) if m else None


def world(rxs):
    """Every public receiver that is up, open to all and placed on the map."""
    out = []
    for rx in rxs:
        m = re.findall(r'-?\d+(?:\.\d+)?', rx.get('gps', ''))
        if rx.get('offline', 'no') != 'no' or rx.get('pwd') not in (None, '', '0', 'no') or len(m) < 2 or not rx.get('url'):
            continue
        lat, lon = round(float(m[0]), 2), round(float(m[1]), 2)
        if abs(lat) > 90 or abs(lon) > 180 or (lat == 0 and lon == 0):
            continue
        snr, top = num(rx.get('snr')), num(rx.get('users_max'))
        out.append({'u': rx['url'].rstrip('/')[:120], 'loc': rx.get('loc', '')[:60], 'lat': lat, 'lon': lon,
                    'ant': rx.get('antenna', '')[:60], 'max': int(top) if top else None,
                    'snr': int(snr) if snr is not None else None})
    return sorted(out, key=lambda r: r['u'])


def main():
    rxs = rm.receivers()
    if not rxs:
        sys.exit('no receiver list; the previous one is left in place')
    w = world(rxs)
    if w:
        os.makedirs(os.path.dirname(WORLD), exist_ok=True)
        with open(WORLD, 'w', encoding='utf-8') as f:
            json.dump({'checked': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'receivers': w},
                      f, separators=(',', ':'), ensure_ascii=False)
        print(f'{len(w)} public receivers written to {WORLD}')
    jobs = [(rx, hp) for rx in rxs for hp in candidates(rx)]
    with ThreadPoolExecutor(32) as ex:
        tls = [(rx, hp) for (rx, hp), ok in zip(jobs, ex.map(lambda j: answers_tls(j[1]), jobs)) if ok]
    print(f'{len(rxs)} receivers, {len(jobs)} hosts tried, {len(tls)} answer over TLS')
    good, seen = [], set()
    for rx, hp in tls:
        key = re.sub(r':443$', '', hp)
        if key in seen:
            continue
        seen.add(key)
        res = asyncio.run(streams(key))
        print(f'  {key:40} {rx.get("loc", "")[:40]:40} -> {res}')
        if not (isinstance(res, int) and res > 5):
            continue
        m = re.findall(r'-?\d+(?:\.\d+)?', rx.get('gps', ''))
        good.append({'host': key, 'name': rx.get('name', '')[:90], 'loc': rx.get('loc', '')[:60],
                     'lat': round(float(m[0]), 2) if len(m) >= 2 else None,
                     'lon': round(float(m[1]), 2) if len(m) >= 2 else None,
                     'antenna': rx.get('antenna', '')[:90], 'slots': int(rx.get('users_max') or 0) or None})
    if not good:
        sys.exit('nothing streamed this time; the previous list is left in place')
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump({'checked': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                   'receivers': sorted(good, key=lambda r: r['host'])}, f, indent=1, ensure_ascii=False)
    print(f'{len(good)} receivers stream over wss; written to {OUT}')


if __name__ == '__main__':
    main()
