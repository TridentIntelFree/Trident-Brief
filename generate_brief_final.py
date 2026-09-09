import json
import os
import sys
from datetime import datetime, timezone
from html import escape

import requests

def generate_with_grok(prompt):
    api_key = os.environ.get('GROK_API_KEY')
    if not api_key:
        return None, "No Grok API key"
    
    try:
        response = requests.post(
            'https://api.x.ai/v1/responses',
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {api_key}'
            },
            json={
                'model': 'grok-4-1-fast-reasoning',
                'input': [
                    {
                        'role': 'system',
                        'content': 'You are a SIGINT/HUMINT fusion analyst with real-time X/Twitter access and web search capabilities. Monitor verified official sources (SIGINT) and unverified local accounts (HUMINT/CHATTER). Also search the broader web for news, government sites, and intelligence sources. Distinguish between confirmed intelligence and uncorroborated chatter. Use professional intelligence terminology. Search X and the web RIGHT NOW.'
                    },
                    {
                        'role': 'user',
                        'content': prompt
                    }
                ],
                'tools': [
                    {'type': 'x_search'},
                    {'type': 'web_search'}
                ],
                'temperature': 0.6
            },
            timeout=180
        )
        
        if response.status_code == 200:
            data = response.json()
            text_parts = []
            for item in data.get('output', []):
                if item.get('type') == 'message':
                    for block in item.get('content', []):
                        if block.get('type') in ('output_text', 'text'):
                            text_parts.append(block.get('text', ''))
            if not text_parts and data.get('output_text'):
                text_parts.append(data['output_text'])
            if text_parts:
                return '\n'.join(text_parts), None
            else:
                return None, f"Grok returned no text. Keys: {list(data.keys())}"
        else:
            return None, f"Grok error: {response.status_code} - {response.text[:200]}"
    except Exception as e:
        return None, str(e)

def generate_with_groq(prompt):
    api_key = os.environ.get('GROQ_API_KEY')
    if not api_key:
        return None, "No Groq API key"
    
    try:
        response = requests.post(
            'https://api.groq.com/openai/v1/chat/completions',
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json'
            },
            json={
                'model': 'llama-3.3-70b-versatile',
                'messages': [{'role': 'user', 'content': prompt}],
                'temperature': 0.6,
                'max_tokens': 4000
            },
            timeout=60
        )
        
        if response.status_code == 200:
            return response.json()['choices'][0]['message']['content'], None
        return None, "Groq error"
    except Exception as e:
        return None, str(e)

def main():
    stale = False
    if '--offline' in sys.argv:
        # Re-render index.html from the cached brief. No API calls, no new
        # archive entry -- for previewing template changes locally.
        content = load_cached_brief()
        if not content:
            raise Exception('--offline requires a usable brief in ' + CACHE_FILE)
        timestamp = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
        render(content, 'CACHED - offline re-render', 'CACHE-RENDER',
               timestamp, index_archive(), True)
        print('Re-rendered index.html from cache (offline mode)')
        return

    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M UTC')
    readable_date = datetime.now().strftime('%B %d, %Y at %H:%M UTC')
    year = str(datetime.now().year)
    
    prompt = f"""SIGINT/HUMINT COLLECTION TASKING - REAL-TIME X/TWITTER MONITORING
Collection Period: Past 24 hours ending {readable_date}
Current Year: {year}

MISSION: Conduct multi-INT collection using verified official sources (SIGINT) and open chatter from local/unverified accounts (HUMINT). Use BOTH X/Twitter search AND web search to gather intelligence from multiple sources. Clearly distinguish intelligence grades.

INTELLIGENCE CLASSIFICATION SYSTEM:
[SIGINT - VERIFIED]: Official government, military, institutional accounts
[HUMINT - CHATTER]: Unverified local sources, citizen reports, rumors requiring corroboration
[OSINT - CONFIRMED]: Cross-verified by multiple independent sources
[OSINT - WEB]: Intelligence gathered from news sites, government portals, research institutions

PRIORITY INTELLIGENCE REQUIREMENTS:

1. GEOPOLITICAL AND MILITARY INTELLIGENCE

SIGINT COLLECTION TARGETS (Verified Official):
@POTUS @VP @StateDept @SecDef @DeptofDefense @NATO @EUCOM @CENTCOM @INDOPACOM @ZelenskyyUa @Ukrainian_Army @DefenceU @IDF @Israel_MOD @IsraeliPM @StateDeptSpox @PentagonPresSec

HUMINT SOURCES (Journalists/Analysts):
@christogrozev @RALee85 @Conflicts @WarMonitors @Osinttechnical @JackDetsch @laraseligman @NatashaBertrand

WEB SOURCES: Reuters, AP News, BBC, Defense One, War on the Rocks, CSIS, ISW (understandingwar.org)

Collection Focus:
- Troop movements and military deployments
- Diplomatic statements and policy shifts
- Alliance developments and joint operations
- Sanctions announcements
- Arms transfers and defense aid
- Strategic messaging

2. TECHNOLOGY AND CYBERSECURITY INTELLIGENCE

SIGINT TARGETS (Verified):
@elonmusk @sama @satyanadella @sundarpichai @tim_cook @OpenAI @Google @Microsoft @Apple @Meta @Tesla @SpaceX @xAI @USCYBERCOM @CISAgov @NSACyber @FBI

HUMINT SOURCES (Security Researchers):
@mattblaze @evacide @thegrugq @SwiftOnSecurity @troyhunt @briankrebs

WEB SOURCES: Ars Technica, The Verge, Wired, Krebs on Security, CISA.gov, BleepingComputer

Collection Focus:
- Product launches and breakthroughs
- Cybersecurity incidents
- AI policy developments
- Space programs
- Regulatory actions

3. UAP/UFO INTELLIGENCE

SIGINT TARGETS:
@DeptofDefense @AARO_DOD_Info @SenGillibrand @RepTimBurchett @SenRubioPress

HUMINT SOURCES:
@ChrisKMellon @LueElizondo @rosscoulthart @JeremyCorbell

WEB SOURCES: The Black Vault, Liberation Times, The Debrief, AARO official reports

Collection Focus:
- Official Pentagon statements
- Congressional hearings
- Credible incident reports
- Scientific research

4. PARAPSYCHOLOGY AND CONSCIOUSNESS RESEARCH

SIGINT TARGETS:
@Stanford @Harvard @Princeton @MIT @Yale @NaturePortfolio @ScienceMagazine

WEB SOURCES: Nature.com, Science.org, arXiv.org, university press releases

Collection Focus:
- Peer-reviewed publications
- Research program announcements
- Conference proceedings

INTELLIGENCE METHODOLOGY:
1. SIGINT COLLECTION: Monitor official accounts for authoritative statements, flag as [SIGINT - VERIFIED]
2. HUMINT COLLECTION: Monitor credible journalists/analysts, flag as [HUMINT - SOURCE ASSESSED]
3. CHATTER MONITORING: Search X for trending topics, local reports, flag as [HUMINT - CHATTER - UNVERIFIED]
4. WEB INTELLIGENCE: Search news sites, government portals, research databases, flag as [OSINT - WEB]
5. INTELLIGENCE FUSION: Cross-reference sources, upgrade confidence when sources align

REPORTING FORMAT:
Use classification tags for each intelligence item:
[SIGINT - VERIFIED] Official statement from @account at timestamp
[HUMINT - ASSESSED CREDIBLE] Reporter with track record reports
[HUMINT - CHATTER] Unverified reports (REQUIRES CORROBORATION)
[OSINT - WEB] News/research from named publication

Include:
- Source classification and confidence level
- Specific X accounts and timestamps
- Web source URLs when available
- Direct quotes when relevant
- Strategic implications

DISCLAIMER SECTION:
INTELLIGENCE DISCLAIMER:
- SIGINT (Verified): High confidence, official sources
- HUMINT (Assessed): Medium-high confidence, credible analysts  
- CHATTER (Unverified): Low confidence, requires corroboration
- OSINT-WEB: Confidence varies by source reputation

VALIDATION REQUIREMENTS:
- Ukraine-Russia conflict MUST be addressed
- Middle East situation MUST be covered
- All examples from {year}
- Minimum 3 SIGINT sources per section
- Clearly mark all HUMINT/CHATTER sources
- Include at least 2 web-sourced items per section

Execute multi-INT collection now."""

    print("Initiating SIGINT/HUMINT collection with Grok 4.1 + x_search + web_search...")
    content, error = generate_with_grok(prompt)
    
    if content:
        provider = "Grok 4.1 Fast Reasoning - Multi-INT Fusion (X Search + Web Search)"
        badge = "GROK-4.1-MULTI-INT-FUSION"
    else:
        print(f"Grok failed: {error}")
        print("Falling back to Groq...")
        content, error = generate_with_groq(prompt)
        if content:
            provider = "Groq Llama 3.3 (Backup)"
            badge = "GROQ-BACKUP"
        else:
            # Both providers down. Rather than deploying nothing, re-render the
            # last good brief and flag it as cached on the page.
            content = load_cached_brief()
            if content:
                print(f"All providers failed ({error}); re-rendering cached brief.")
                provider = "CACHED - last successful collection"
                badge = "CACHE-STALE"
                stale = True
            else:
                raise Exception(f"All providers failed and no cache available: {error}")

    archive = write_archive(content)
    render(content, provider, badge, timestamp, archive, stale)
    write_cache(content, provider)
    print(f"Brief generated successfully at {timestamp}")


CACHE_FILE = 'latest-brief.json'
TEMPLATE_FILE = 'template.html'
ARCHIVE_DIR = 'archive'


def load_cached_brief():
    """Return the last successfully generated brief text, if any."""
    try:
        with open(CACHE_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        text = (data.get('content') or '').strip()
        # Never resurrect a cached error payload as if it were a brief.
        if text and not text.startswith('Error generating brief'):
            return text
    except Exception as e:
        print(f"No usable cache: {e}")
    return None


def write_cache(content, provider):
    payload = {
        'date': datetime.now(timezone.utc).strftime('%B %d, %Y'),
        'content': content,
        'provider': provider,
        'generated_at': datetime.now(timezone.utc).isoformat(),
    }
    with open(CACHE_FILE, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2)


def write_archive(content):
    """Persist today's brief to archive/, then refresh the archive index."""
    os.makedirs(ARCHIVE_DIR, exist_ok=True)
    day = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    with open(os.path.join(ARCHIVE_DIR, f'{day}.md'), 'w', encoding='utf-8') as f:
        f.write(content)
    return index_archive()


def index_archive():
    """Rebuild archive/index.json from the .md files on disk, newest first."""
    os.makedirs(ARCHIVE_DIR, exist_ok=True)
    entries = []
    for name in sorted(os.listdir(ARCHIVE_DIR), reverse=True):
        if not name.endswith('.md'):
            continue
        stem = name[:-3]
        try:
            label = datetime.strptime(stem, '%Y-%m-%d').strftime('%d %b %Y').upper()
        except ValueError:
            label = stem.upper()
        entries.append({'date': label, 'path': f'{ARCHIVE_DIR}/{name}'})

    with open(os.path.join(ARCHIVE_DIR, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(entries, f, indent=2)
    return entries


def js_json(value):
    """JSON-encode for embedding inside a <script> block.

    json.dumps leaves '<' intact, so a literal '</script>' in model output would
    close the script tag early and blank the page. Escaping the HTML-significant
    characters as \\uXXXX keeps the value byte-identical to the JS engine while
    making it inert to the HTML parser.
    """
    return (json.dumps(value)
            .replace('<', '\\u003c')
            .replace('>', '\\u003e')
            .replace('&', '\\u0026')
            .replace('\u2028', '\\u2028')
            .replace('\u2029', '\\u2029'))


def render(content, provider, badge, timestamp, archive, stale=False):
    """Fill template.html and write index.html.

    Brief text is injected as a JSON string literal, never as raw HTML, so a
    stray '<' or '</pre>' in model output can no longer break the page.
    """
    with open(TEMPLATE_FILE, 'r', encoding='utf-8') as f:
        html = f.read()

    # Same key handling as before: whatever is in the environment at build time.
    grok_key = os.environ.get('GROK_API_KEY', '')

    subs = {
        '__TIMESTAMP__': escape(timestamp),
        '__BADGE__': escape(badge),
        '__PROVIDER__': escape(provider),
        '__BRIEF_JSON__': js_json(content),
        '__BUILT_AT_JSON__': js_json(datetime.now(timezone.utc).isoformat()),
        '__IS_STALE_JSON__': 'true' if stale else 'false',
        '__ARCHIVE_JSON__': js_json(archive),
        '__GROK_KEY_JSON__': js_json(grok_key),
    }
    for token, value in subs.items():
        html = html.replace(token, value)

    leftover = [t for t in subs if t in html]
    if leftover:
        raise Exception(f"Template placeholders not substituted: {leftover}")

    with open('index.html', 'w', encoding='utf-8') as f:
        f.write(html)


if __name__ == '__main__':
    main()
