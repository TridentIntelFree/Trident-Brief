"""Owner's local brief, run on GitHub so the xAI key never leaves GitHub Secrets.

The site's hidden owner panel asks GitHub to run .github/workflows/local-brief.yml
with two inputs: a request id, and the ZIP code encrypted with the owner's
passphrase. The repository is public, so everything about a run -- its inputs,
its log, the files it commits -- is public too. So the ZIP arrives encrypted,
is masked in the log the moment it is decrypted, and the finished brief is
encrypted with the same passphrase before it is committed to
data/local-brief/<request id>.json, where only the owner's panel can open it.

Encryption matches the browser's WebCrypto: PBKDF2-SHA256 (310,000 rounds,
16-byte salt) -> AES-256-GCM (12-byte IV), tag appended to the ciphertext,
fields base64: {"s": salt, "i": iv, "c": ciphertext}.
"""
import base64
import glob
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone

import requests
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

OUT_DIR = 'data/local-brief'
KEEP = 10              # locked results kept in the repository
ROUNDS = 310000


def _key(passphrase, salt):
    return hashlib.pbkdf2_hmac('sha256', passphrase.encode('utf-8'), salt, ROUNDS, 32)


def unlock(blob, passphrase):
    d = json.loads(base64.urlsafe_b64decode(blob + '=' * (-len(blob) % 4)))
    salt, iv, ct = (base64.b64decode(d[k]) for k in ('s', 'i', 'c'))
    return AESGCM(_key(passphrase, salt)).decrypt(iv, ct, None).decode('utf-8')


def lock(text, passphrase):
    salt, iv = os.urandom(16), os.urandom(12)
    ct = AESGCM(_key(passphrase, salt)).encrypt(iv, text.encode('utf-8'), None)
    return {'s': base64.b64encode(salt).decode(), 'i': base64.b64encode(iv).decode(),
            'c': base64.b64encode(ct).decode()}


def prompt_for(zip_code, now):
    return (
        f'LOCALIZED INTELLIGENCE BRIEF - ZIP CODE {zip_code}\n'
        f'Today is {now:%d %B %Y}, {now:%H:%M} UTC.\n'
        'Collection Period: Past 24 hours\n'
        f'Search Radius: 200 miles from ZIP {zip_code}\n\n'
        'MISSION: Generate tactical intelligence brief for local area using BOTH X/Twitter search AND web search. '
        'Pull from local news sites, police department websites, government portals, AND social media.\n\n'
        'PRIORITY LOCAL INTELLIGENCE REQUIREMENTS:\n\n'
        '1. LAW ENFORCEMENT & PUBLIC SAFETY\n'
        '- Search X for local police, sheriff, fire/EMS accounts and incidents\n'
        '- Search web for local news crime reports, police blotters, court records\n\n'
        '2. CRIME & SECURITY THREATS\n'
        '- Monitor X for crime reports, trends, gang activity, security concerns\n'
        '- Search web for local newspaper crime sections, FBI field office alerts\n\n'
        '3. LOCAL POLITICS & GOVERNMENT\n'
        '- Track X for city council, county decisions, local elections, policy changes\n'
        '- Search web for local government meeting minutes, press releases\n\n'
        '4. BUSINESS & ECONOMIC INTELLIGENCE\n'
        '- Monitor X for business openings/closings, corporate announcements\n'
        '- Search web for local business journals, economic development news\n\n'
        '5. REGIONAL THREATS & HAZARDS\n'
        '- Search X for weather, disasters, infrastructure failures, health concerns\n'
        '- Search web for NWS alerts, FEMA updates, state emergency management\n\n'
        'RULES: report only what you retrieved in this session, each item with its source and a working link '
        'written inline as [text](url) -- every item its own link, never a numbered footnote reused on another '
        'item. Say plainly when an area had nothing verifiable.\n\n'
        'INTELLIGENCE CLASSIFICATION:\n'
        '[SIGINT - VERIFIED]: Official law enforcement, government accounts\n'
        '[HUMINT - LOCAL CHATTER]: Community reports, citizen observations\n'
        '[OSINT - NEWS]: Local news outlet reporting\n'
        '[OSINT - WEB]: Government websites, official databases, verified web sources\n\n'
        f'Search X AND the web NOW for location-specific intelligence within 200 miles of ZIP {zip_code}.')


def ask_grok(prompt, key):
    r = requests.post('https://api.x.ai/v1/responses', timeout=240,
                      headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {key}'},
                      json={'model': 'grok-4-1-fast-reasoning',
                            'input': [{'role': 'system', 'content':
                                       'You are a local intelligence analyst with real-time X/Twitter access and web '
                                       'search. Generate tactical intelligence for a specific area from local accounts, '
                                       'news sites, government portals and chatter, using both X search and web search.'},
                                      {'role': 'user', 'content': prompt}],
                            'tools': [{'type': 'x_search'}, {'type': 'web_search'}],
                            'temperature': 0.6,
                            'max_output_tokens': 8000})
    if r.status_code != 200:
        raise RuntimeError(f'xAI answered HTTP {r.status_code}: {r.text[:200]}')
    data = r.json()
    parts = [b.get('text', '') for item in data.get('output', []) if item.get('type') == 'message'
             for b in item.get('content', []) if b.get('type') in ('output_text', 'text')]
    text = '\n'.join(parts) or data.get('output_text') or ''
    if not text:
        raise RuntimeError('xAI returned no text')
    ticks = (data.get('usage') or {}).get('cost_in_usd_ticks')
    return text, (round(ticks / 1e10, 4) if isinstance(ticks, int) else None)


def main():
    req = os.environ.get('REQ_ID', '')
    if not re.fullmatch(r'[a-z0-9]{8,40}', req):
        sys.exit('bad request id')
    passphrase = os.environ.get('LOCAL_BRIEF_PASSPHRASE', '')
    if len(passphrase) < 8:
        sys.exit('Set the LOCAL_BRIEF_PASSPHRASE secret (at least 8 characters, longer is better).')
    now = datetime.now(timezone.utc)
    result = {'at': now.strftime('%Y-%m-%dT%H:%M:%SZ')}
    try:
        try:
            zip_code = unlock(os.environ.get('ZIP_ENC', ''), passphrase).strip()
        except Exception:
            raise RuntimeError('could not unlock the ZIP: the passphrase saved on your phone does not match '
                               'the LOCAL_BRIEF_PASSPHRASE secret')
        if not re.fullmatch(r'\d{5}', zip_code):
            raise RuntimeError('the unlocked ZIP is not 5 digits')
        print(f'::add-mask::{zip_code}')         # never let the ZIP reach the public log
        result['zip'] = zip_code
        key = os.environ.get('GROK_API_KEY', '')
        if not key:
            raise RuntimeError('the GROK_API_KEY secret is not set')
        text, cost = ask_grok(prompt_for(zip_code, now), key)
        result.update(brief=text, cost_usd=cost)
        print(f'local brief {req}: {len(text)} characters'
              + (f', cost ${cost:.3f}' if cost is not None else ''))
    except Exception as e:
        # A failure is reported back to the panel, locked like a brief, rather
        # than leaving it waiting for a file that never comes.
        result['error'] = str(e)[:300]
        print(f'local brief {req}: failed ({type(e).__name__})')

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, f'{req}.json'), 'w', encoding='utf-8') as f:
        json.dump({'v': 1, 'at': result['at'], 'req': req, 'blob': lock(json.dumps(result), passphrase)},
                  f, separators=(',', ':'))
    # Keep the last few; older locked results are deleted.
    files = []
    for p in glob.glob(os.path.join(OUT_DIR, '*.json')):
        try:
            with open(p, encoding='utf-8') as f:
                files.append((json.load(f).get('at', ''), p))
        except Exception:
            files.append(('', p))
    for _, p in sorted(files, reverse=True)[KEEP:]:
        os.remove(p)


if __name__ == '__main__':
    main()
