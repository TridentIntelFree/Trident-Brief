import base64
import hashlib
import json
import math
import random
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from html import escape

import requests

CACHE_FILE = 'latest-brief.json'
TEMPLATE_FILE = 'template.html'
ARCHIVE_DIR = 'archive'
WINDOW_HOURS = int(os.environ.get('COLLECTION_WINDOW_HOURS', '12'))
# Raised from 6000 with the theatre sweep. The old cap was never what made briefs
# short -- they came in around 600 output tokens against a 6000 ceiling, so the
# brevity was coming from the prompt, not the budget. This is headroom for a full
# sweep, not a target: Rule 5 tells the model length follows the world.
MAX_OUTPUT_TOKENS = int(os.environ.get('MAX_OUTPUT_TOKENS', '10000'))
WATCHLIST_FILE = 'watchlist.json'
SYSTEM_PROMPT = (
    'You are the duty intelligence analyst writing the watch brief that hands off to '
    'the next shift. You have real-time X/Twitter search and web search. '
    'Your reader is an informed generalist who needs to know what changed in the world, '
    'what it means, and what to watch for next -- not a digest of headlines. '
    'You sweep the whole board every shift, including the theatres that were quiet last '
    'time, because a theatre going from quiet to active is itself the intelligence. '
    'You separate what is confirmed from what is claimed, you say which way the evidence '
    'cuts, and you never assert anything you did not retrieve in this session. '
    'Search X and the web RIGHT NOW.')
# The standing sweep. The single biggest reason earlier briefs reported nothing but
# Ukraine was that the whole world sat in one bucket called "GEOPOLITICAL AND MILITARY"
# with a dozen X handles under it: the model searched the handles, found Ukraine (those
# accounts post constantly), and stopped. Naming the theatres makes the sweep structural
# rather than a matter of what happened to surface. A theatre that is genuinely quiet
# costs one line, which is cheap; a theatre nobody looked at costs the whole brief.
THEATRES = """- EUROPE / RUSSIA-UKRAINE: front-line movement, deep strikes, energy and port
  infrastructure, NATO air policing and Baltic/Black Sea incidents, EU and national
  policy shifts, Belarus, Moldova/Transnistria.
- MIDDLE EAST: Israel-Gaza-Lebanon-Syria, Iran (nuclear programme, IRGC, proxies),
  Yemen and Red Sea shipping, Iraq, Gulf states, Turkey.
- INDO-PACIFIC: PLA activity around Taiwan and the median line, South and East China
  Sea incidents, Korean peninsula (missile tests, DPRK-Russia), Philippines, Japan,
  AUKUS and regional force posture.
- SOUTH AND CENTRAL ASIA: India-Pakistan and Kashmir, Afghanistan, Bangladesh,
  Central Asian states and Russian/Chinese influence there.
- AFRICA: Sahel juntas and Wagner/Africa Corps, Horn of Africa and Somaliland/Ethiopia,
  Sudan, Libya, DRC and the Great Lakes, Nigeria and the Gulf of Guinea.
- AMERICAS: US homeland security and the southwest border, Mexican cartel violence,
  Venezuela, Haiti, Colombia, and hemispheric military deployments.
- STRATEGIC AND SPACE: nuclear forces and doctrine, missile and hypersonic tests,
  ASAT and counterspace activity, military launches, Arctic, undersea cables and
  pipelines, GPS jamming and spoofing.
- ECONOMIC AND ENERGY PRESSURE: sanctions and export controls, oil/gas/LNG and
  critical-mineral shocks, maritime chokepoints (Hormuz, Bab el-Mandeb, Suez, Panama,
  Malacca), shadow-fleet and insurance measures, sovereign financial stress."""

SLOW_SECTIONS = """## 5. UAP/UFO
Seeds: @DeptofDefense @AARO_DOD_Info @SenGillibrand @RepTimBurchett @ChrisKMellon
@LueElizondo @rosscoulthart; web: The Black Vault, The Debrief, Liberation Times,
AARO releases, congressional records.
Focus: official statements, hearings, document releases, sensor data. Distinguish
official positions from advocacy claims. Frequently quiet - one line is fine.

## 6. FRONTIER AND CONSCIOUSNESS RESEARCH
Seeds: web only - Nature, Science, arXiv, PubMed, university press releases, DARPA
and IARPA programme announcements.
Focus: peer-reviewed publications and funded programmes. Note methodological
criticism and replication status. Ignore popular-press speculation. Frequently
quiet - one line is fine."""


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
                        'content': SYSTEM_PROMPT
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
                'temperature': 0.6,
                'max_output_tokens': MAX_OUTPUT_TOKENS
            },
            timeout=180
        )

        # A reasoning model with no ceiling is an open-ended bill. If this
        # deployment rejects the cap, retry once uncapped rather than lose the run.
        if response.status_code == 400 and 'max_output_tokens' in response.text:
            print('  max_output_tokens rejected; retrying uncapped')
            response = requests.post(
                'https://api.x.ai/v1/responses',
                headers={'Content-Type': 'application/json',
                         'Authorization': f'Bearer {api_key}'},
                json={'model': 'grok-4-1-fast-reasoning',
                      'input': [{'role': 'system', 'content': SYSTEM_PROMPT},
                                {'role': 'user', 'content': prompt}],
                      'tools': [{'type': 'x_search'}, {'type': 'web_search'}],
                      'temperature': 0.6},
                timeout=180)
        
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



# ---------------------------------------------------------------- prompt ----

def load_watchlist():
    """Standing intelligence requirements, injected into every prompt.

    Roughly 200 tokens, and it does more for signal than any other change:
    without it the tasking is generic and returns whatever the model happens
    to find.
    """
    try:
        with open(WATCHLIST_FILE, 'r', encoding='utf-8') as f:
            w = json.load(f)
    except Exception as e:
        print(f"  no watchlist ({e}); collection will be untargeted")
        return ''
    parts = []
    for key, label in (('actors', 'ACTORS'), ('regions', 'REGIONS'), ('topics', 'TOPICS')):
        vals = [str(v).strip() for v in (w.get(key) or []) if str(v).strip()]
        if vals:
            parts.append(f'{label}: ' + '; '.join(vals[:12]))
    if not parts:
        return ''
    return ('\n=== STANDING REQUIREMENTS (highest priority) ===\n'
            'Anything matching these outranks general coverage. Search for them by name\n'
            'even if nothing surfaced organically, and tag matching items [PRIORITY].\n'
            + '\n'.join(parts) + '\n')


def deep_run(now):
    """Whether to collect the slow-moving sections this run.

    UAP and frontier research returned "No verifiable developments in window" in
    every brief on file, yet each run still paid for x_search and web_search
    against both. They are collected once a day instead of twice. The theatre
    sweep in Section 1 is never skipped: a theatre is only known to be quiet
    because it was looked at.
    """
    mode = os.environ.get('COLLECTION_DEPTH', 'auto').lower()
    if mode in ('deep', 'full'):
        return True
    if mode in ('core', 'shallow'):
        return False
    return now.hour < 12


# Lines that are the previous brief talking about itself rather than reporting the
# world. Feeding these back as "already reported" wasted digest budget and, worse,
# re-primed the model with the handle roll-call that Rule 3 exists to stamp out.
_DIGEST_SKIP = re.compile(
    r'^(assessment|collection gaps?|indicators?( and warnings?)?|overall|fusion|bluf'
    r'|changes since|no verifiable developments)', re.I)


def previous_digest(previous):
    """Condense the last brief into a short list of what was already reported.

    Fed back to the model so a run twice a day reports the delta instead of
    restating the morning's items. Only the reported items go in: section
    headings and the brief's own commentary are not things that were reported.
    """
    if not previous:
        return "None available. This is the first brief; report the full window."
    lines = []
    for raw in previous.splitlines():
        line = raw.strip()
        if not line or line.startswith('```') or line.startswith('#'):
            continue
        clean = re.sub(r'\[\[\d+\]\]\([^)]*\)', '', line)       # strip [[1]](url) citations
        clean = re.sub(r'[#*`]', '', clean).strip()
        clean = re.sub(r'^[-*]\s*', '', clean).strip()
        if len(clean) < 40 or _DIGEST_SKIP.match(clean):
            continue
        lines.append('- ' + clean[:180])
        if len(lines) >= 30:
            break
    return '\n'.join(lines) if lines else "Previous brief contained no parseable items."


def build_prompt(window_start, window_end, prev_digest, watchlist='', deep=True):
    slow_sections = SLOW_SECTIONS if deep else (
        '(Sections 5 and 6 - UAP and frontier research - are collected on the daily\n'
        'deep run only. Do not search for or report them now.)')
    return f"""MULTI-INT COLLECTION TASKING

COLLECTION WINDOW: {window_start:%Y-%m-%d %H:%M} UTC to {window_end:%Y-%m-%d %H:%M} UTC
Today's date is {window_end:%d %B %Y}. This brief runs twice a day.

You have x_search and web_search. Use them before writing anything.

=== HOW TO WORK THIS TASKING ===
You are writing a watch brief, not a news digest. The reader wants to know what changed
in the world in the last {(window_end - window_start).days * 24 + (window_end - window_start).seconds // 3600} hours, what it means, and what to watch for next.

Work in this order:
0. LISTEN - Section 1 first. Run the social searches before the sweep, while there is
            still effort to spend on them. Placing this last produced one vague line
            and a nil return that named no query.
1. SWEEP  - search every standing theatre in Section 2 by name, whether or not anything
            surfaced organically. The seed accounts named below are entry points, not the
            search space: most of what matters will come from sources not on any list.
            Search the theatre, not the handle.
            Use BOTH tools on every theatre. x_search is not a fallback for when
            web_search comes up short - a wire story is filed hours after the people
            present started posting, so the web tells you what was published and X
            tells you what is happening. A brief built only from news sites is a press
            review, and you will have skipped the faster half of the collection.
2. TRIAGE - rank by consequence, not by how loudly something was posted. A quiet policy
            change with strategic effect outranks a noisy strike that changes nothing.
3. WRITE  - every item says what happened, who reported it, and why it matters.

=== RULE 1: VERIFICATION (this rule outranks every other instruction) ===
Every factual claim must trace to a source you actually retrieved during THIS task.
- If you did not retrieve it, do not write it.
- Never reconstruct a quote, timestamp, handle, headline, figure or URL from memory,
  training data, or inference. A plausible-sounding detail you did not read is a fabrication.
- No illustrative, representative, hypothetical or "example" items. None.
- Do not adjust real-world facts to fit the requested date. If your searches surface
  nothing inside the window, say so plainly rather than inventing events to fill it.
- Breadth is never a licence to fabricate. An empty theatre reported as empty is a
  correct answer; an empty theatre filled with invented content is the worst possible one.
- NEVER cite an aggregator as the source. A Wikipedia current-events portal, a news
  roundup, or an account that reposts wire copy is a route TO a source, not a source.
  Follow it to whoever did the reporting and cite them. If you cannot, drop the item.

WHAT THIS RULE DOES NOT FORBID. Asserting an unverified claim as fact is banned.
Reporting that an unverified claim is CIRCULATING is not -- it is a different
statement, about the information environment rather than about the world, and you
can verify it by reading the posts. "Russian milblogger accounts are pushing X,
no independent confirmation, Ukrainian General Staff denies it" is true, checkable,
and often matters more than the wire story. Say who is claiming it, roughly how
widely, and what contradicts it. What people believe and repeat is intelligence
even when the claim is false -- especially when the claim is false.

=== RULE 2: SWEEP THE WHOLE BOARD ===
Every theatre in Section 2 gets its own heading and its own verdict, every run.
- One theatre per heading. Never combine several under a shared heading, and never
  write a single line covering five theatres at once. Batching them is the signature
  of not having searched them: if five theatres share one verdict, you guessed.
- Search a theatre before you call it quiet. "Quiet in window" is a finding, and you
  can only make it by looking. A theatre with nothing verifiable costs you one line,
  which is cheap; declaring it quiet unsearched is a false statement about the world.
- A brief that reports only the loudest one or two theatres has failed this tasking even
  if every line in it is true. Going from quiet to active is itself intelligence, and you
  cannot detect that in a theatre you did not look at.
- Every theatre that MOVED should carry at least one item that is not wire copy: an
  official account's own post, a local report, a named analyst's read. Three Reuters
  summaries is a press review. If Reuters is genuinely the only source that has it,
  say so - that is a finding about coverage.

=== RULE 3: A ROLL CALL IS NOT INTELLIGENCE, BUT A SILENCE CAN BE ===
Never list which handles you checked and found quiet - "@POTUS, @SecDef and @NATO had
no significant posts" is a report on your own search history, not on the world.
Collection gaps are substantive questions you could not answer - "no independent
confirmation of the damage claim at X", "casualty figures come only from one side" -
not a roll call.

The exception, and it is a real one: a source that would NORMALLY have spoken and has
not. The Russian MoD silent eighteen hours after a strike it would usually claim to
have intercepted, a foreign ministry that says nothing while its neighbours all issue
statements, an official account that goes quiet mid-event. That is not your search
history, it is a fact about the actor, and it is often the most interesting line
available. Report it only when you can say what the normal behaviour is and why this
departs from it - otherwise it is just a handle that did not post, and Rule 3 applies.

=== RULE 4: REPORT THE DELTA ===
Already reported in the previous brief - do NOT restate these. Report only what is new,
advanced, contradicted or resolved since. If a prior item materially changed, say what
changed and how.

{prev_digest}

=== RULE 5: CALIBRATION ===
Do not pad, and do not ration. If fifteen things of consequence happened, report fifteen.
If three did, report three. Length follows the world, not a target - but the sweep in
Rule 2 is mandatory either way, and a three-item brief that skipped six theatres is a
failure of collection, not a quiet day.

=== RULE 6: ATTRIBUTION ===
EVERY REPORTED ITEM BEGINS with a classification tag in square brackets - every bullet
in Sections 1 through 6. An item without one is malformed: the tag is not decoration,
it is how the reader knows whether to act on the line. After the tag: the source (handle
or outlet), a UTC timestamp, and a working URL as a markdown link.

The two closing blocks take NO tags. Indicators and warnings are forecasts and
collection gaps are open questions; neither has a source to attribute, because neither
has happened. Tagging them would claim provenance for something you inferred.

  - [OSINT - CONFIRMED] Reuters and AFP (11 Sep, 14:10 UTC) report ... [link]

Where two independent sources agree, say so and upgrade confidence. Where they conflict,
present both and say they conflict. Where a claim comes from a party with an interest in
it being believed, say whose claim it is. Cite the outlet that did the reporting, never
an aggregator standing in front of it - a Wikipedia current-events portal, a news
aggregator or a link roundup is a route to a source, not a source.

CLASSIFICATION TAGS:
[SIGINT - VERIFIED]      Official government, military or institutional account
[HUMINT - ASSESSED]      Named journalist or analyst with a track record
[HUMINT - CHATTER]       Unverified first-hand or local report - name the account and
                         say plainly that it is uncorroborated. This tag EXISTS to let
                         you report such material; it does not require corroboration
                         before you may use it, only labelling. Reporting an
                         uncorroborated claim as uncorroborated is not a rule breach.
[OSINT - SOCIAL]         What is circulating on X, Reddit or Telegram, reported as
                         circulation: who is posting, how widely, organic or pushed
[OSINT - CONFIRMED]      Independently corroborated by two or more sources
[OSINT - WEB]            Named publication, government portal or research institution

If every item in your brief is tagged [OSINT - WEB] you have written a news digest,
not a collection brief, and you have not used x_search at all.

{watchlist}
=== SECTIONS ===

## 1. CHATTER AND THE INFORMATION ENVIRONMENT
This section is FIRST on purpose. It was last, and it got whatever attention was left
after eight theatres -- one vague line and a nil return. Do this before the sweep:
social is the fast half, the posts precede the wire story by hours, and what you find
here tells you what to check in Section 2.

This section is why you have x_search. It is not a summary of the sections below.
Search X and Reddit DIRECTLY, by topic and by place name, not only the handles listed
elsewhere - the accounts worth reading during an event are usually ones nobody put on
a list.

SHOW YOUR SEARCHES. End this section with one line: "searched: " followed by the actual
query strings you ran. A nil return is only credible if you can name what you ran to get
it, and writing "no significant chatter" without that line is not a finding, it is a
skipped step.

X: search the theatre names, place names, unit designations and equipment types as
plain queries. Read replies and quote-posts, not only the original. Milblogger and
local-stringer accounts on all sides. Note when an account with reach posts something
that then propagates.
An account that reposts a wire story is not chatter - it is the wire story with a
retweet button, and citing it gains you nothing over citing the outlet. What you are
looking for is someone claiming something the wires do not have yet: a first-hand post,
footage, a unit or local account, an analyst reading a primary document. If the only X
results for a theatre are news accounts restating the headline, that is the finding -
report it as no independent chatter FOR THAT THEATRE, naming the query - not as a single
sentence covering everything at once. "No significant chatter" as one line for the whole
world is the shape of a step that was skipped, not a search that came back empty.
Reddit is not optional, and x_search does not cover it. Run web_search restricted to
reddit.com -- literally "site:reddit.com <topic>" -- for each theatre that moved, plus
the subreddit local to any incident. r/CredibleDefense, r/geopolitics,
r/UkraineWarVideoReport, r/LessCredibleDefence, r/anime_titties, country and city
subreddits. Read the comments under a thread, not just its title: the useful detail is
usually in a reply from someone on the ground. If Reddit genuinely carried nothing on a
theatre, say that in one line rather than silently omitting it - a previous run listed
these subreddits and searched none of them, and the omission was invisible in the output.

Report, for each item worth carrying:
- WHAT is being said, and by whom - name the account or subreddit
- HOW WIDELY - rough reach: a few hundred, or everywhere. Say if you cannot tell.
- WHETHER IT HOLDS UP - corroborated, contradicted, or still open. Where footage or a
  photo is the evidence, say whether anyone has geolocated or dated it.
- WHETHER IT LOOKS ORGANIC - the same wording appearing across accounts at once, brand
  new accounts, or a claim jumping languages in minutes, is itself the finding.
- WHAT THE OTHER SIDE SAYS - official denials, counter-claims, silence where a
  statement would be expected.

A widely circulating claim that turns out to be false still belongs here, labelled
false. So does a notable silence. Tag these [HUMINT - CHATTER] or [OSINT - SOCIAL];
they will not be [OSINT - WEB], and if they are you have searched the wrong thing.

## 2. STANDING THEATRE SWEEP
Each theatre below gets its own `### HEADING` and its own verdict this run. Use markdown
headings, not bold text, so the brief is navigable. Report what moved under each; give a
theatre with nothing the heading followed by "quiet in window" and move on.

{THEATRES}

Seed accounts (entry points only, not the search space): @POTUS @StateDept @SecDef
@DeptofDefense @NATO @CENTCOM @INDOPACOM @AFRICOM_ @SOUTHCOM @USForcesKorea
@ZelenskyyUa @DefenceU @IDF @IsraeliPM @MofaJapan_en @MOFA_Taiwan; analysts
@christogrozev @RALee85 @Osinttechnical @Conflicts @sentdefender @IndoPac_Info;
web: Reuters, AP, AFP, BBC Monitoring, Defense One, War on the Rocks, ISW
(understandingwar.org), Al Jazeera, Nikkei Asia, SCMP, Africa Confidential, Lloyd's List.

## 3. TECHNOLOGY AND CYBERSECURITY
Seeds: @USCYBERCOM @CISAgov @FBI @NSAGov @NCSC; researchers @briankrebs
@SwiftOnSecurity @thegrugq @vxunderground; industry @OpenAI @xAI @AnthropicAI;
web: Ars Technica, Wired, Krebs on Security, BleepingComputer, The Record, CISA KEV.
Focus: active exploitation and named intrusions with an identified victim or actor,
ransomware against infrastructure, state-linked operations, model or hardware releases
with substantive capability claims, and regulatory or export-control action.
Skip routine product marketing and vendor blogs with no incident behind them.

## 4. HOMELAND AND INFRASTRUCTURE
Seeds: @DHSgov @FBI @TSA @CISAgov @NTSB @FAANews; web: state emergency management,
regional press. Focus: incidents affecting civil aviation, rail, ports, power, water and
telecoms; domestic security events; large-scale disruption. Distinguish accident from
attack, and say when the distinction is not yet established.

{slow_sections}

=== ANALYSIS THE BRIEF MUST CARRY ===
Reporting what happened is the easy half. Every section closes with one short
**Assessment** that answers the so-what - what this signifies, whose position improved
or worsened, and what it implies - rather than restating the bullets in other words.
Where the evidence supports more than one reading, give the alternative explicitly and
say which you favour and why.

After the sections, two blocks:

**INDICATORS AND WARNINGS** - three to six things that would materially change the
picture if they occurred in the next 24-48 hours. Each written as:
indicator -> what it would mean -> where it would show up first.
These are forward-looking judgements, so they are not bound by Rule 1's retrieval
requirement - but they must follow from what you actually reported above.

**COLLECTION GAPS** - the substantive questions this brief could not answer, per Rule 3.

=== OUTPUT FORMAT ===
Markdown, with real headings: `##` for the numbered sections, `###` for each theatre
inside Section 1. Bold text is not a heading and breaks the page's navigation.
Open with a BLUF of three to five lines covering only what matters most and why - not a
list of everything below. Then the sections, then the two closing blocks.
Items as bullets, each starting with its classification tag (reported items only - see
Rule 6). Keep each item to two or three sentences: what, who reported it, why it matters.

=== REQUIRED FINAL BLOCK: GEOLOCATED EVENTS ===
After all prose, output a single fenced json code block, and nothing after it. One entry
for each reported item that has a real physical location. Omit items with no location
(policy, research, online-only) rather than inventing coordinates.

```json
{{"events":[
  {{"lat":44.72,"lon":37.77,"place":"Novorossiysk, Russia","headline":"one line, under 100 chars","section":"geopolitical","classification":"SIGINT - VERIFIED","confidence":"high","priority":4,"url":"https://..."}}
]}}
```

Rules for this block: lat/lon numeric decimal degrees for the place the event occurred;
section is one of geopolitical, technology, homeland, uap, research; confidence is high, medium or
low; priority is 1-5, where 5 demands immediate attention and 1 is routine, scored
higher for anything matching the standing requirements above; url must be one you
actually retrieved. Valid JSON only, no comments, no trailing
commas. If there are no locatable events, output {{"events":[]}}.

Begin collection now."""


# ---------------------------------------------------------- event parsing ----

def extract_events(text):
    """Pull the trailing geolocated-events JSON block out of the model output.

    Returns (events, prose). The block is stripped from the prose so it is never
    rendered as a code fence on the page.
    """
    if not text:
        return [], text
    matches = list(re.finditer(r'```json\s*(.*?)```', text, re.DOTALL))
    for m in reversed(matches):
        try:
            payload = json.loads(m.group(1).strip())
        except Exception:
            continue
        raw = payload.get('events') if isinstance(payload, dict) else payload
        if not isinstance(raw, list):
            continue
        events = []
        for e in raw:
            if not isinstance(e, dict):
                continue
            try:
                lat, lon = float(e['lat']), float(e['lon'])
            except (KeyError, TypeError, ValueError):
                continue
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                continue
            try:
                pri = max(1, min(5, int(e.get('priority', 3))))
            except (TypeError, ValueError):
                pri = 3
            events.append({
                'lat': lat,
                'lon': lon,
                'priority': pri,
                'place': str(e.get('place', ''))[:120],
                'headline': str(e.get('headline', ''))[:240],
                'section': str(e.get('section', 'geopolitical'))[:40],
                'classification': str(e.get('classification', ''))[:40],
                'confidence': str(e.get('confidence', ''))[:20],
                'url': str(e.get('url', ''))[:500],
            })
        prose = (text[:m.start()] + text[m.end():]).strip()
        print(f"Parsed {len(events)} geolocated events from model output")
        return events, prose
    print("No parseable geolocated-events block in model output")
    return [], text


# ---------------------------------------------------------- server feeds ----

def _get(url, timeout=20):
    r = requests.get(url, timeout=timeout, headers={
        'Accept': 'application/json',
        # api.weather.gov rejects clients without a descriptive UA
        'User-Agent': 'TridentBrief/1.0 (github.com/TridentIntelFree/Trident-Brief)',
    })
    if r.status_code != 200:
        raise RuntimeError(f'HTTP {r.status_code}: {r.text[:120]}')
    return r.json()


def _try(urls, timeout=20):
    """First URL that answers wins. Returns (data, None) or (None, reason)."""
    last = 'no url tried'
    for u in urls:
        try:
            return _get(u, timeout), None
        except Exception as e:
            last = str(e)[:160]
            print(f"    {u.split('?')[0]} -> {last}")
    return None, last


def _centroid(geom):
    """Mean position of a GeoJSON Polygon/MultiPolygon exterior ring."""
    if not geom:
        return None
    t, c = geom.get('type'), geom.get('coordinates')
    try:
        if t == 'Point':
            return float(c[1]), float(c[0])
        ring = c[0] if t == 'Polygon' else c[0][0] if t == 'MultiPolygon' else None
        if not ring:
            return None
        pts = [(float(y), float(x)) for x, y in ring if -90 <= float(y) <= 90]
        if not pts:
            return None
        return sum(p[0] for p in pts)/len(pts), sum(p[1] for p in pts)/len(pts)
    except Exception:
        return None


def _alert(f):
    p = f.get('properties') or {}
    a = {'event': (p.get('event') or '')[:80], 'area': (p.get('areaDesc') or '')[:120],
         'severity': p.get('severity') or '', 'expires': p.get('expires')}
    ll = _centroid(f.get('geometry'))
    if ll:
        a['lat'], a['lon'] = round(ll[0], 3), round(ll[1], 3)
    return a


def _launch(l):
    pad = l.get('pad') or {}
    out = {'name': (l.get('name') or '')[:120], 'net': l.get('net'),
           'status': ((l.get('status') or {}).get('abbrev') or ''),
           'pad': ((pad.get('location') or {}).get('name') or pad.get('name') or '')[:120]}
    try:
        lat, lon = float(pad.get('latitude')), float(pad.get('longitude'))
        if -90 <= lat <= 90 and -180 <= lon <= 180:
            out['lat'], out['lon'] = lat, lon
    except (TypeError, ValueError):
        pass
    return out


def fetch_disasters():
    """GDACS global disaster alerts -- floods, cyclones, volcanoes, wildfires.

    No key, worldwide, and already geolocated. Best effort: if the shape is not
    what we expect the layer is simply absent.
    """
    # GDACS rejects a request without eventtype ("Eventtype is required"), and
    # the accepted parameter set varies by endpoint, so try progressively
    # simpler forms rather than relying on one.
    types = 'EQ;TC;FL;VO;DR;WF'
    d, err = _try([
        f'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist={types}&alertlevel=Green;Orange;Red',
        f'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventtype={types}',
        f'https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventtype={types}',
        'https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventlist=EQ;TC;FL;VO',
    ], timeout=25)
    if d is None:
        return None, err
    out = []
    for f in (d.get('features') or []):
        p = f.get('properties') or {}
        ll = _centroid(f.get('geometry'))
        if not ll:
            continue
        out.append({
            'lat': round(ll[0], 3), 'lon': round(ll[1], 3),
            'kind': (p.get('eventtype') or '')[:8],
            'name': (p.get('eventname') or p.get('htmldescription') or p.get('name') or '')[:120],
            'level': (p.get('alertlevel') or '')[:10],
            'from': p.get('fromdate'),
            'url': (p.get('url') or {}).get('report', '') if isinstance(p.get('url'), dict) else '',
        })
    return out[:200], None


SKYWATCH_CATALOG = os.environ.get(
    'SKYWATCH_CATALOG',
    'https://raw.githubusercontent.com/TridentIntelFree/skywatch-unified/main/catalog.json')

# Notable objects always kept regardless of the sampling stride.
NOTABLE_SATS = {25544, 20580, 48274, 25994, 27424, 36411, 43013, 41866, 33591, 28654, 29155, 37849}
SAT_TARGET = 1600


def _tle_elements(entry):
    """[name, norad, category, tle1, tle2] -> compact mean elements, or None.

    Stored as numbers rather than raw TLE strings: the page only needs the mean
    elements to propagate, and this is roughly a third of the bytes.
    """
    try:
        name, nid, _cat, l1, l2 = entry[0], entry[1], entry[2], entry[3], entry[4]
        yy, dd = int(l1[18:20]), float(l1[20:32])
        epoch = datetime(yy + (2000 if yy < 57 else 1900), 1, 1, tzinfo=timezone.utc) \
            + timedelta(days=dd - 1)
        inc, raan = float(l2[8:16]), float(l2[17:25])
        ecc = float('0.' + l2[26:33].strip())
        argp, ma, mm = float(l2[34:42]), float(l2[43:51]), float(l2[52:63])
        if not (0 < mm < 20) or not (0 <= ecc < 1) or not (0 <= inc <= 180):
            return None
        return [str(name).strip()[:28], int(nid), round(epoch.timestamp()),
                round(inc, 4), round(raan, 4), round(ecc, 7),
                round(argp, 4), round(ma, 4), round(mm, 8)]
    except Exception:
        return None


AIR_ANCHORS = [
    (40.7, -74.0), (34.0, -118.2), (41.9, -87.6), (29.8, -95.4),
    (51.5, -0.1), (50.1, 8.7), (41.9, 12.5), (40.4, -3.7),
    (25.3, 55.3), (35.7, 139.7), (31.2, 121.5), (28.6, 77.2),
    (1.35, 103.8), (-33.9, 151.2), (-23.5, -46.6), (-26.2, 28.0),
]


# airplanes.live answers 403 to every unregistered request ("Please contact us
# at contact@airplanes.live"), so it is tried last rather than first: putting it
# ahead of the others cost a wasted round-trip on all seventeen queries.
def _ac_urls(lat, lon, nm=250):
    return [f'https://opendata.adsb.fi/api/v2/lat/{lat:.4f}/lon/{lon:.4f}/dist/{nm}',
            f'https://api.adsb.lol/v2/lat/{lat:.4f}/lon/{lon:.4f}/dist/{nm}',
            f'https://api.airplanes.live/v2/point/{lat:.4f}/{lon:.4f}/{nm}']


def fetch_aircraft():
    """Collect the air picture here rather than in the browser.

    Every ADS-B provider refuses cross-origin requests from at least some
    browsers; the Skywatch project hits the same wall and marks the layer
    'blocked' in its own code. The Actions runner has no such restriction, so
    the picture is collected server-side and served same-origin, where nothing
    can refuse it. It is a snapshot, not a live feed, and the page says so.
    """
    seen, out = set(), []

    def take(rows, mil=False):
        for a in rows or []:
            lat, lon = a.get('lat'), a.get('lon')
            if lat is None or lon is None:
                continue
            key = a.get('hex') or a.get('r') or a.get('flight')
            if not key or key in seen:
                continue
            seen.add(key)
            rec = {'hex': key, 'flight': (a.get('flight') or '').strip()[:10],
                   't': (a.get('t') or '')[:8], 'lat': round(lat, 3), 'lon': round(lon, 3)}
            alt = a.get('alt_baro')
            if alt is not None:
                rec['alt_baro'] = alt if alt == 'ground' else int(alt)
            if a.get('gs') is not None:
                try:
                    rec['gs'] = int(a['gs'])
                except (TypeError, ValueError):
                    pass
            if a.get('squawk'):
                rec['squawk'] = str(a['squawk'])[:4]
            # Heading, so the map can draw an aircraft pointing where it is going
            # rather than an undifferentiated dot. One int per contact.
            trk = a.get('track')
            if trk is None:
                trk = a.get('true_heading')
            if trk is not None:
                try:
                    rec['track'] = int(float(trk)) % 360
                except (TypeError, ValueError):
                    pass
            if mil or (a.get('dbFlags') and int(a['dbFlags']) & 1):
                rec['_mil'] = True
            out.append(rec)

    d, _ = _try(['https://opendata.adsb.fi/api/v2/mil',
                 'https://api.adsb.lol/v2/mil',
                 'https://api.airplanes.live/v2/mil'], timeout=25)
    if d:
        take(d.get('ac') or d.get('aircraft'), mil=True)
    mil_n = len(out)

    for i, (lat, lon) in enumerate(AIR_ANCHORS):
        if i:
            time.sleep(0.4)   # one anchor drew a 429 when fired back to back
        d, _ = _try(_ac_urls(lat, lon), timeout=20)
        if d:
            take(d.get('ac') or d.get('aircraft'))

    if not out:
        return None, 'no provider answered from the runner either'

    out = out[:5000]
    os.makedirs('assets', exist_ok=True)
    with open('assets/aircraft.json', 'w', encoding='utf-8') as f:
        json.dump({'fetched_at': datetime.now(timezone.utc).isoformat(),
                   'military': mil_n, 'count': len(out), 'ac': out},
                  f, separators=(',', ':'))
    print(f"  aircraft: {len(out)} ({mil_n} military) -> assets/aircraft.json "
          f"({os.path.getsize('assets/aircraft.json')//1024} KB)")
    return len(out), None


# AIS ship-and-cargo type codes worth calling out by name.
SHIP_TYPES = {
    30: 'Fishing', 31: 'Towing', 32: 'Towing (large)', 33: 'Dredging', 34: 'Diving ops',
    35: 'MILITARY OPS', 36: 'Sailing', 37: 'Pleasure craft',
    50: 'Pilot vessel', 51: 'Search and rescue', 52: 'Tug', 53: 'Port tender',
    54: 'Anti-pollution', 55: 'LAW ENFORCEMENT', 58: 'Medical transport',
}


def _ship_kind(code):
    try:
        c = int(code)
    except (TypeError, ValueError):
        return ''
    if c in SHIP_TYPES:
        return SHIP_TYPES[c]
    if 60 <= c <= 69: return 'Passenger'
    if 70 <= c <= 79: return 'Cargo'
    if 80 <= c <= 89: return 'Tanker'
    if 40 <= c <= 49: return 'High-speed craft'
    return ''


def _aisstream_global(api_key, seconds=25, cap=8000):
    """Global AIS via AISStream.io.

    AIS is VHF radio with roughly 40-60nm line of sight, so open-ocean coverage
    only exists via satellite AIS, which is commercial. AISStream aggregates
    both and gives it away on a free tier, but it needs an account key and
    speaks websocket rather than REST. We connect, subscribe to the whole
    globe, listen for a fixed window, and take a snapshot of whatever reported.
    """
    try:
        import asyncio
        import websockets
    except ImportError:
        return None, 'websockets package not installed'

    async def collect():
        seen = {}
        sub = {'APIKey': api_key,
               'BoundingBoxes': [[[-90, -180], [90, 180]]],
               'FilterMessageTypes': ['PositionReport', 'ShipStaticData']}
        async with websockets.connect('wss://stream.aisstream.io/v0/stream',
                                      ping_interval=None, max_size=None) as ws:
            await ws.send(json.dumps(sub))
            deadline = time.time() + seconds
            while time.time() < deadline and len(seen) < cap:
                left = deadline - time.time()
                if left <= 0:
                    break
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=left)
                except asyncio.TimeoutError:
                    break
                try:
                    msg = json.loads(raw)
                except Exception:
                    continue
                if msg.get('error'):
                    raise RuntimeError(str(msg['error'])[:120])
                meta = msg.get('MetaData') or {}
                mmsi = meta.get('MMSI') or meta.get('MMSI_String')
                if mmsi is None:
                    continue
                mmsi = int(mmsi)
                rec = seen.setdefault(mmsi, {'mmsi': mmsi})
                lat, lon = meta.get('latitude'), meta.get('longitude')
                if lat is not None and lon is not None:
                    rec['lat'], rec['lon'] = round(lat, 4), round(lon, 4)
                name = (meta.get('ShipName') or '').strip()
                if name:
                    rec['name'] = name[:28]
                body = (msg.get('Message') or {})
                pr = body.get('PositionReport') or {}
                if pr.get('Sog') is not None:
                    try: rec['sog'] = round(float(pr['Sog']), 1)
                    except (TypeError, ValueError): pass
                if pr.get('TrueHeading') is not None and pr['TrueHeading'] < 360:
                    rec['hdg'] = pr['TrueHeading']
                sd = body.get('ShipStaticData') or {}
                if sd.get('Type') is not None:
                    kind = _ship_kind(sd['Type'])
                    if kind:
                        rec['kind'] = kind
                        if kind in ('MILITARY OPS', 'LAW ENFORCEMENT', 'Search and rescue'):
                            rec['_mil'] = True
        return [v for v in seen.values() if 'lat' in v]

    try:
        out = asyncio.run(collect())
    except Exception as e:
        return None, str(e)[:160]
    if not out:
        return None, 'connected but no positions in window'
    return out, None


def fetch_vessels():
    """Live AIS vessel positions.

    Free keyless AIS is scarce: the global providers (MarineTraffic,
    VesselFinder, AISStream) all want an account. Digitraffic publishes Finnish
    and Baltic AIS as open data with no key, which is real live shipping but
    regionally bounded -- the tile says so rather than implying global coverage.
    """
    out, source = [], []

    # Global coverage, if a key is configured. Never required: without it the
    # regional feed below still runs.
    ais_key = os.environ.get('AISSTREAM_API_KEY', '').strip()
    if ais_key:
        g, err = _aisstream_global(ais_key)
        if g:
            out.extend(g)
            source.append(f'global {len(g)}')
            print(f"  vessels: {len(g)} global (AISStream)")
        else:
            print(f"    AISStream unavailable: {err}")
    else:
        print('    AISSTREAM_API_KEY not set - regional AIS only')

    hdr_note = 'Digitraffic-User'
    try:
        r = requests.get('https://meri.digitraffic.fi/api/ais/v1/locations', timeout=30,
                         headers={'Accept': 'application/json',
                                  hdr_note: 'TridentBrief/1.0 (github.com/TridentIntelFree/Trident-Brief)'})
        if r.status_code != 200:
            if out:
                print(f"    Digitraffic HTTP {r.status_code}; keeping global only")
                return _finish_vessels(out, source), None
            return None, f'HTTP {r.status_code}: {r.text[:100]}'
        loc = r.json()
    except Exception as e:
        if out:
            print(f"    Digitraffic unavailable ({str(e)[:60]}); keeping global only")
            return _finish_vessels(out, source), None
        return None, str(e)[:160]

    # Names and ship types live on a separate endpoint; positions still stand
    # without them, so a failure here is not fatal.
    meta = {}
    try:
        r2 = requests.get('https://meri.digitraffic.fi/api/ais/v1/vessels', timeout=30,
                          headers={'Accept': 'application/json',
                                   hdr_note: 'TridentBrief/1.0 (github.com/TridentIntelFree/Trident-Brief)'})
        if r2.status_code == 200:
            rows = r2.json()
            rows = rows.get('vessels', rows) if isinstance(rows, dict) else rows
            for v in rows or []:
                m = v.get('mmsi')
                if m is not None:
                    meta[int(m)] = ((v.get('name') or '').strip()[:28], v.get('shipType'))
    except Exception as e:
        print(f"    vessel metadata unavailable: {str(e)[:80]}")

    feats = loc.get('features') if isinstance(loc, dict) else None
    if not feats:
        if out:
            return _finish_vessels(out, source), None
        return None, 'no features in AIS response'

    regional = []
    for f in feats:
        g, p = f.get('geometry') or {}, f.get('properties') or {}
        c = g.get('coordinates') or []
        if len(c) < 2:
            continue
        mmsi = f.get('mmsi') or p.get('mmsi')
        name, stype = meta.get(int(mmsi), ('', None)) if mmsi is not None else ('', None)
        rec = {'mmsi': mmsi, 'lat': round(c[1], 4), 'lon': round(c[0], 4)}
        if name:
            rec['name'] = name
        kind = _ship_kind(stype)
        if kind:
            rec['kind'] = kind
            if kind in ('MILITARY OPS', 'LAW ENFORCEMENT', 'Search and rescue'):
                rec['_mil'] = True
        if p.get('sog') is not None:
            try: rec['sog'] = round(float(p['sog']), 1)
            except (TypeError, ValueError): pass
        # AIS encodes "heading not available" as 511, and course over ground as
        # 3600 (tenths of a degree). Passing either through would point the map
        # glyph at a bearing the vessel never reported.
        hdg = p.get('heading')
        if hdg is None or hdg >= 360:
            cog = p.get('cog')
            hdg = round(cog) if cog is not None and cog < 360 else None
        if hdg is not None:
            rec['hdg'] = int(hdg) % 360
        regional.append(rec)

    source.append(f'Baltic {len(regional)}')
    print(f"  vessels: {len(regional)} regional (Digitraffic)")
    out.extend(regional)
    return _finish_vessels(out, source), None


def _finish_vessels(rows, source):
    """De-duplicate by MMSI, preferring the record that carries a ship type."""
    best = {}
    for v in rows:
        m = v.get('mmsi')
        if m is None:
            continue
        cur = best.get(m)
        if cur is None or (not cur.get('kind') and v.get('kind')):
            best[m] = v
    out = list(best.values())[:9000]
    mil = sum(1 for v in out if v.get('_mil'))
    print(f"  vessels: {len(out)} total ({mil} military/enforcement) [{', '.join(source)}]")
    return out


def fetch_skywatch():
    """Satellite catalogue from the user's own Skywatch project.

    Every tracked object -- payloads, rocket bodies, debris and unknowns -- is
    written to assets/satellites.json rather than embedded in the page. At
    ~2.4MB raw (~820KB gzipped, which is how Pages serves it) it would otherwise
    triple the size of index.html and block first paint; as a separate
    same-origin asset the page renders immediately and the catalogue streams in.
    """
    try:
        r = requests.get(SKYWATCH_CATALOG, timeout=120)
        if r.status_code != 200:
            return None, f'HTTP {r.status_code}'
        cat = r.json()
    except Exception as e:
        return None, str(e)[:160]

    raw = cat.get('sats') or []
    out, counts = [], {}
    for e in raw:
        if len(e) < 5:
            continue
        kind = e[2] if e[2] in ('P', 'R', 'D', 'U') else 'U'
        el = _tle_elements(e)
        if not el:
            continue
        # Debris names are generic ("THOR ABLE DEB (YO)") and make up a third of
        # the payload; the NORAD id identifies them well enough.
        name = '' if kind == 'D' else el[0]
        out.append([name, el[1], el[2], round(el[3], 2), round(el[4], 2),
                    round(el[5], 6), round(el[6], 2), round(el[7], 2),
                    round(el[8], 6), kind])
        counts[kind] = counts.get(kind, 0) + 1
    if not out:
        return None, 'no objects parsed'

    os.makedirs('assets', exist_ok=True)
    with open('assets/satellites.json', 'w', encoding='utf-8') as f:
        json.dump({'generated': cat.get('generated'), 'counts': counts, 'sats': out},
                  f, separators=(',', ':'))
    size = os.path.getsize('assets/satellites.json') // 1024
    print(f"  skywatch: {len(out)} objects {counts} -> assets/satellites.json ({size} KB)")
    return counts, None


THREE_BASE = 'https://raw.githubusercontent.com/mrdoob/three.js/r160'
# NASA Blue Marble Next Generation, mirrored by three-globe. Public domain, and
# 4096x2048 against the 2048x1024 that ships with three.js: four times the
# pixels, with bathymetry and far more separation between desert, forest and
# ice. three.js's own earth_atmos_4096.jpg is a misnomer -- it decodes to
# 2048x1024 as well, just less compressed -- so it is no use here.
# Each entry is (filename, [urls tried in order]): the first that returns
# something plausible wins, so a dead mirror degrades to the older texture
# rather than leaving the globe untextured.
BLUE_MARBLE = 'https://raw.githubusercontent.com/vasturiano/three-globe/master/example/img'
GFX_ASSETS = [
    ('three.module.js', [THREE_BASE + '/build/three.module.js']),
    ('earth_day.jpg',   [BLUE_MARBLE + '/earth-blue-marble.jpg',
                         THREE_BASE + '/examples/textures/planets/earth_atmos_2048.jpg']),
    # Night stays the three.js lights map on purpose: it is city light on black,
    # which composites cleanly under the terminator. The Blue Marble night image
    # has moonlit terrain baked in and double-exposes the land.
    ('earth_night.png', [THREE_BASE + '/examples/textures/planets/earth_lights_2048.png']),
    ('earth_spec.jpg',  [THREE_BASE + '/examples/textures/planets/earth_specular_2048.jpg']),
    ('earth_norm.jpg',  [THREE_BASE + '/examples/textures/planets/earth_normal_2048.jpg']),
]


# A previous build's 512 KB earth_atmos_2048.jpg would otherwise satisfy the
# "already present" check forever and the globe would never pick up the Blue
# Marble. Sized to sit above the old file and below the new one.
MIN_GFX_BYTES = {'earth_day.jpg': 900_000}


def fetch_gfx_assets():
    """Vendor three.js and the Earth textures into assets/.

    Served same-origin rather than from a CDN: cdnjs is not reachable from every
    network this project has met, and an external script tag is exactly the kind
    of dependency that has failed here before. Fetched at build time and
    gitignored, so the repository stays small.
    """
    os.makedirs('assets', exist_ok=True)
    ok = 0
    for name, urls in GFX_ASSETS:
        dest = os.path.join('assets', name)
        if os.path.exists(dest) and os.path.getsize(dest) > MIN_GFX_BYTES.get(name, 1000):
            ok += 1
            continue
        for url in urls:
            try:
                r = requests.get(url, timeout=90)
                if r.status_code != 200 or len(r.content) < 1000:
                    print(f"  gfx asset {name}: HTTP {r.status_code} from {url.rsplit('/',1)[-1]}")
                    continue
                with open(dest, 'wb') as f:
                    f.write(r.content)
                ok += 1
                if url is not urls[0]:
                    print(f"  gfx asset {name}: fell back to {url.rsplit('/',1)[-1]}")
                break
            except Exception as e:
                print(f"  gfx asset {name} from {url.rsplit('/',1)[-1]} failed: {str(e)[:70]}")
    print(f"  graphics assets: {ok}/{len(GFX_ASSETS)} present"
          + ('' if ok == len(GFX_ASSETS) else ' - globe falls back to canvas'))
    return ok == len(GFX_ASSETS)


def fetch_server_feeds():
    """Fetch the rate-limited / CORS-awkward feeds here instead of in the browser.

    These run on the Actions runner: no CORS, and the rate limit is not tied to
    each visitor's IP. Any feed that fails is simply absent; the page degrades.
    """
    feeds = {}

    errors = {}

    # all_day carries every recorded event (~250-400/day) rather than the ~30
    # that clear M2.5. Magnitude drives point size on the globe.
    d, err = _try(['https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
                   'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson'])
    if d is None:
        errors['quakes'] = err
    else:
        quakes = []
        for f in d.get('features', []):
            p, g = f.get('properties') or {}, f.get('geometry') or {}
            c = g.get('coordinates') or []
            if len(c) >= 2 and p.get('mag') is not None:
                quakes.append({'lat': c[1], 'lon': c[0], 'depth': c[2] if len(c) > 2 else None,
                               'mag': p['mag'], 'place': p.get('place', ''),
                               'time': p.get('time'), 'url': p.get('url', '')})
        quakes.sort(key=lambda q: q['mag'], reverse=True)
        feeds['quakes'] = quakes[:400]
        print(f"  quakes: {len(feeds['quakes'])}")

    d, err = _try([
        'https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=10',
        'https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=10',
        'https://lldev.thespacedevs.com/2.2.0/launch/upcoming/?limit=10',
        'https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=10&mode=list',
    ], timeout=25)
    if d is None:
        errors['launches'] = err
    else:
        feeds['launches'] = [_launch(l) for l in d.get('results', [])]
        print(f"  launches: {len(feeds['launches'])}")

    d, err = _try([
        'https://api.weather.gov/alerts/active?severity=Severe,Extreme',
        'https://api.weather.gov/alerts/active?status=actual&message_type=alert',
        'https://api.weather.gov/alerts/active',
    ])
    if d is None:
        errors['alerts'] = err
    else:
        feeds['alerts'] = [_alert(f) for f in d.get('features', [])
                           if ((f.get('properties') or {}).get('severity') in ('Severe', 'Extreme'))]
        print(f"  alerts: {len(feeds['alerts'])}")

    fetch_gfx_assets()

    ves, err = fetch_vessels()
    if ves is None:
        errors['vessels'] = err
        print(f"  vessels failed: {err}")
    else:
        feeds['vessels'] = ves

    ac, err = fetch_aircraft()
    if ac is None:
        errors['aircraft'] = err
        print(f"  aircraft failed: {err}")
    else:
        feeds['aircount'] = ac

    sats, err = fetch_skywatch()
    if sats is None:
        errors['sats'] = err
        print(f"  skywatch failed: {err}")
    else:
        feeds['satcounts'] = sats

    dis, err = fetch_disasters()
    if dis is None:
        errors['disasters'] = err
    else:
        feeds['disasters'] = dis
        print(f"  disasters: {len(dis)}")

    # Recorded so the page can name the real reason, and retry that feed from the
    # visitor's own browser -- a residential IP is often not rate-limited or
    # geo-blocked where a shared CI runner IP is.
    feeds['errors'] = errors
    feeds['fetched_at'] = datetime.now(timezone.utc).isoformat()
    write_feed_status(feeds)
    return feeds


def write_feed_status(feeds):
    """Publish a small feed-health file alongside the page.

    The feeds-only job does not commit, so a failure there is otherwise only
    visible in an Actions log. This lands at assets/feed-status.json on the live
    site, where it can be read directly.
    """
    counts = {}
    for k in ('quakes', 'launches', 'alerts', 'disasters', 'vessels'):
        counts[k] = len(feeds[k]) if isinstance(feeds.get(k), list) else None
    counts['aircraft'] = feeds.get('aircount')
    counts['satellites'] = feeds.get('satcounts')
    # Which basemap actually reached the page. The globe silently degrades to the
    # older, lower-contrast three.js texture if the Blue Marble mirror is down,
    # and that degradation is invisible from the Actions log unless it is stated.
    gfx = {}
    for name in ('earth_day.jpg', 'earth_night.png', 'three.module.js'):
        path = os.path.join('assets', name)
        gfx[name] = (os.path.getsize(path) // 1024 if os.path.exists(path) else None)
    status = {'fetched_at': feeds.get('fetched_at'),
              'collected': counts,
              'assets_kb': gfx,
              'errors': feeds.get('errors') or {}}
    try:
        os.makedirs('assets', exist_ok=True)
        with open('assets/feed-status.json', 'w', encoding='utf-8') as f:
            json.dump(status, f, indent=2)
        print('  feed status -> assets/feed-status.json')
        for k, v in (status['errors'] or {}).items():
            print(f'    FAILED {k}: {str(v)[:150]}')
    except Exception as e:
        print(f'  could not write feed status: {e}')


# --------------------------------------------------------------- storage ----

def load_cache():
    try:
        with open(CACHE_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"No usable cache: {e}")
        return {}


def load_cached_brief():
    text = (load_cache().get('content') or '').strip()
    # Never resurrect a cached error payload as if it were a brief.
    if text and not text.startswith('Error generating brief'):
        return text
    return None


HISTORY_FILE = 'history.json'


def _km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p = math.pi / 180
    d_lat, d_lon = (lat2 - lat1) * p, (lon2 - lon1) * p
    x = (math.sin(d_lat / 2) ** 2
         + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin(d_lon / 2) ** 2)
    return 2 * r * math.asin(min(1.0, math.sqrt(x)))


def load_history():
    try:
        with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {'briefs': [], 'places': []}



# ============================================================ mushroom body ==
# The fruit fly's olfactory circuit is a novelty detector, and unlike the rest
# of the fly connectome it has a published, portable algorithm. Two results:
# the projection-neuron -> Kenyon-cell stage is locality-sensitive hashing
# (Dasgupta, Stevens & Navlakha, Science 2017), and the mushroom body output
# neuron reads novelty off it like a Bloom filter that forgets (Dasgupta,
# Sheehan, Stevens & Navlakha, PNAS 2018).
#
# It is worth having here because this brief's whole job is "what changed", and
# the existing answer to that is weak in two ways. history.json counts
# LOCATIONS, so a genuinely new development in Novorossiysk is indistinguishable
# from the fifth restatement of the same strike. And the delta rule spends input
# tokens every run shipping the previous brief back to the model, which only
# ever sees one brief back. This sees the whole archive, costs nothing per run,
# and -- because the fly's filter decays -- scores a theatre that has been quiet
# for three weeks as newly interesting when it wakes up, which is exactly the
# transition the standing sweep exists to catch.
#
# The anatomy is the real one: ~50 projection neurons, ~2000 Kenyon cells, each
# KC sampling about 6 PNs at random, and a winner-take-all that leaves ~5% of
# KCs firing. Only the input is ours -- headline text where the fly has odour.
PN_COUNT   = 50       # projection neurons (fly: ~50 glomeruli)
KC_COUNT   = 2000     # Kenyon cells      (fly: ~2000)
KC_FANIN   = 6        # PNs sampled per KC (fly: ~6, random)
KC_WINNERS = 100      # after winner-take-all (fly: ~5% of KCs)
FLY_SEED   = 20260911 # fixed, so a headline always hashes to the same tag
FLY_HALFLIFE_DAYS = 21.0   # how fast the filter forgets


def _fly_wiring():
    """The PN->KC connectivity. Random, but fixed for the life of the archive.

    Regenerating this would silently invalidate every novelty score ever
    stored, so it is derived from a constant seed rather than saved.
    """
    rnd = random.Random(FLY_SEED)
    return [tuple(rnd.randrange(PN_COUNT) for _ in range(KC_FANIN))
            for _ in range(KC_COUNT)]


_FLY_WIRING = None


def fly_wiring_b64():
    """The PN->KC connectivity, packed one byte per synapse for the page.

    12,000 synapses at 16 KB of base64. Shipping it means the browser can run
    the Kenyon-cell stage itself and animate the real winner-take-all -- which
    cells were driven hardest, which survived inhibition -- instead of showing
    a canned pattern next to a number computed elsewhere. PN_COUNT is 50, so
    every index fits in a byte.
    """
    global _FLY_WIRING
    if _FLY_WIRING is None:
        _FLY_WIRING = _fly_wiring()
    flat = bytes(i for fan in _FLY_WIRING for i in fan)
    return base64.b64encode(flat).decode('ascii')


def fly_tag(text):
    """Hash text to a sparse Kenyon-cell tag: the fly's own LSH.

    Word-level hashing into PN_COUNT channels stands in for the fly's odour
    receptors. Two headlines about the same event overlap in their words, so
    they overlap in PN activation, so they overlap in KC tag -- which is the
    whole point of locality-sensitive hashing and the reason this beats an
    exact-match check on strings that are never exactly equal.
    """
    global _FLY_WIRING
    if _FLY_WIRING is None:
        _FLY_WIRING = _fly_wiring()

    words = re.findall(r'[a-z0-9]{3,}', (text or '').lower())
    if not words:
        return [], [0.0] * PN_COUNT
    pn = [0.0] * PN_COUNT
    for w in words:
        pn[hash_word(w) % PN_COUNT] += 1.0
    # The fly normalises odour intensity away before the KC stage, so that a
    # strong smell and a faint one of the same thing get the same tag.
    mean = sum(pn) / PN_COUNT
    if mean <= 0:
        return [], [0.0] * PN_COUNT
    pn = [v / mean for v in pn]

    kc = [sum(pn[i] for i in fan) for fan in _FLY_WIRING]
    # Winner-take-all: the APL neuron inhibits all but the strongest KCs.
    order = sorted(range(KC_COUNT), key=lambda i: kc[i], reverse=True)
    # The PN vector comes back too: the page animates the real activation, and
    # recomputing this hash in JavaScript would risk the two drifting apart.
    return sorted(order[:KC_WINNERS]), [round(v, 2) for v in pn]


def hash_word(w):
    """Stable across runs and Python processes, unlike hash()."""
    return int(hashlib.blake2b(w.encode('utf-8'), digest_size=4).hexdigest(), 16)


def fly_novelty(tags_state, tag, now, halflife_days=FLY_HALFLIFE_DAYS):
    """Score a tag against the decaying filter, then write it in.

    Returns novelty in 0..1: 1 is a pattern the archive has never carried,
    0 is one it is saturated with. The decay is what separates "never seen"
    from "not seen lately", and the fly makes that same distinction.
    """
    if not tag:
        return 1.0, 0.0
    w = tags_state.setdefault('w', {})
    t0 = tags_state.get('at')
    # Decay everything to now before reading, so scores do not depend on how
    # many runs happened to fire in between.
    if t0:
        try:
            elapsed = (now - datetime.fromisoformat(t0)).total_seconds() / 86400.0
        except Exception:
            elapsed = 0.0
        if elapsed > 0:
            factor = 0.5 ** (elapsed / halflife_days)
            if factor < 0.01:
                w.clear()
            else:
                for k in list(w):
                    v = w[k] * factor
                    if v < 0.01:
                        del w[k]
                    else:
                        w[k] = v
    tags_state['at'] = now.isoformat()

    prior = {i: w.get(str(i), 0.0) for i in tag}
    seen = sum(prior.values()) / len(tag)
    novelty = max(0.0, min(1.0, 1.0 - seen))
    for i in tag:
        k = str(i)
        w[k] = min(1.0, w.get(k, 0.0) + 1.0 / 3.0)   # three sightings saturates
    # Cells that already carried a trace are what the MBON is actually reading;
    # the page colours them differently so the score is legible, not asserted.
    warm = sorted(i for i, v in prior.items() if v > 0.02)
    return round(novelty, 3), round(seen, 3), warm


def brief_quality(content):
    """Report format compliance to the run log.

    Written because the first measurement of this was wrong: counting tags
    across every bullet in the brief scored 6/15 and looked like a failure,
    when the nine untagged lines were all forecasts and open questions in the
    two closing blocks, which correctly carry no attribution. Compliance was
    6/6. A check that cannot tell those apart is worse than no check, so this
    one stops counting at the closing blocks.
    """
    reported, tagged, theatres = 0, 0, 0
    closing = False
    tags = {}
    for raw in content.splitlines():
        line = raw.strip()
        if re.match(r'^[*#\s]*(INDICATORS AND WARNINGS|COLLECTION GAPS)', line, re.I):
            closing = True
        if re.match(r'^###\s+\S', line):
            theatres += 1
        if closing:
            continue
        # An item is a line that opens with a bullet or straight into a tag. Runs do
        # both -- the current one drops the bullet entirely and starts at "[OSINT -
        # WEB]" -- and an earlier version of this check keyed on "- " alone, so it
        # scored a fully tagged brief 0/0 and reported nothing wrong.
        m = re.match(r'^[-*]?\s*\[((?:SIGINT|HUMINT|OSINT)[^\]]*)\]', line)
        if m:
            reported += 1
            tagged += 1
            tags[m.group(1).strip()] = tags.get(m.group(1).strip(), 0) + 1
        elif re.match(r'^[-*]\s+\S', line):
            reported += 1
    iw = bool(re.search(r'INDICATORS AND WARNINGS', content, re.I))
    gaps = bool(re.search(r'COLLECTION GAPS', content, re.I))
    print(f"  format: {tagged}/{reported} reported items tagged, {theatres} theatre headings, "
          f"I&W {'yes' if iw else 'MISSING'}, gaps {'yes' if gaps else 'MISSING'}")

    # Source mix. A brief where every citation is a news site and every tag is
    # OSINT - WEB is a press review: x_search was available and went unused, which
    # is invisible in the prose and obvious here.
    urls = re.findall(r'\((https?://[^)\s]+)\)', content)
    def hits(*needles):
        return sum(1 for u in urls if any(n in u.lower() for n in needles))
    social = {'x': hits('x.com/', 'twitter.com/'), 'reddit': hits('reddit.com'),
              'telegram': hits('t.me/', 'telegram.')}
    # Aggregators the tasking bans outright; seeing one means an item was cited to
    # a route rather than a source, and it has happened twice.
    aggregators = hits('wikipedia.org', 'news.google.', 'flipboard.', 'msn.com/')
    web_only = bool(reported) and bool(tags) and set(tags) == {'OSINT - WEB'}
    print(f"  sources: {len(urls)} citations - X {social['x']}, Reddit {social['reddit']}, "
          f"Telegram {social['telegram']} | tags: " +
          (', '.join(f'{k} x{v}' for k, v in sorted(tags.items())) or 'none'))
    if web_only or (reported and not social['x'] and not social['reddit']):
        print("  WARNING: no social sourcing in this brief - x_search appears unused")
    if reported and not social['reddit']:
        print("  note: no Reddit sourcing - Section 1 asks for it explicitly")
    if reported and not re.search(r'^\s*searched:', content, re.I | re.M):
        print("  note: Section 1 did not list the queries it ran")
    if aggregators:
        print(f"  WARNING: {aggregators} citation(s) point at an aggregator, which Rule 1 bans")
    return {'reported': reported, 'tagged': tagged, 'theatres': theatres,
            'indicators': iw, 'gaps': gaps, 'social': social, 'tags': tags,
            'aggregators': aggregators}


def update_history(events, archive_path, content, when):
    """Accumulate events across briefs so patterns become visible.

    A single brief cannot show that somewhere has been hit four times this
    week. This costs no tokens -- the events are already parsed -- and it is
    the cheapest real intelligence value in the pipeline. Committed with the
    brief so it survives the runner being discarded.
    """
    try:
        with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
            h = json.load(f)
    except Exception:
        h = {}
    briefs = h.get('briefs') or []
    places = {p['key']: p for p in (h.get('places') or []) if p.get('key')}
    fly = h.get('fly') or {'w': {}, 'at': None}

    bluf = ''
    for line in content.splitlines():
        t = line.strip()
        if t and not t.startswith('#'):
            bluf = re.sub(r'\[\[\d+\]\]\([^)]*\)', '', t)
            bluf = re.sub(r'[*`]', '', bluf)[:240]
            break

    stamp = when.isoformat()
    briefs.insert(0, {'at': stamp, 'path': archive_path, 'bluf': bluf,
                      'events': len(events),
                      'headlines': [e.get('headline', '')[:120] for e in events[:6]]})

    # Score every event through the mushroom body before the place-matching
    # below, so novelty reflects the archive as it stood BEFORE this brief.
    for e in events:
        tag, pn = fly_tag((e.get('headline', '') + ' ' + e.get('place', '')).strip())
        nov, seen, warm = fly_novelty(fly, tag, when)
        e['novelty'] = nov
        e['fly'] = {'kc': tag, 'pn': pn, 'warm': warm, 'seen': seen}

    for e in events:
        # Match to an existing location by distance, not by a rounded key:
        # rounding splits neighbours that straddle a boundary (44.72 and 44.75
        # round apart while being 3km from each other).
        p = None
        for cand in places.values():
            if _km(e['lat'], e['lon'], cand['lat'], cand['lon']) <= 30:
                p = cand
                break
        if p is None:
            key = f"{round(e['lat'], 2)},{round(e['lon'], 2)}"
            p = {'key': key, 'lat': e['lat'], 'lon': e['lon'], 'place': e.get('place', ''),
                 'count': 0, 'first': stamp, 'headlines': [], 'maxPriority': 0}
            places[key] = p
        p['count'] += 1
        p['last'] = stamp
        if e.get('place'):
            p['place'] = e['place']
        p['maxPriority'] = max(p.get('maxPriority', 0), e.get('priority', 3))
        head = e.get('headline', '')[:120]
        if head and head not in p['headlines']:
            p['headlines'].insert(0, head)
            p['headlines'] = p['headlines'][:4]

    ranked = sorted(places.values(), key=lambda x: (-x['count'], x.get('last', '')))
    # Keep a short trace of the filter's readings so the page can chart how
    # novel each brief was overall, not just the items inside this one.
    trace = h.get('flytrace') or []
    if events:
        trace.insert(0, {'at': stamp,
                         'mean': round(sum(e['novelty'] for e in events)/len(events), 3),
                         'n': len(events)})
    out = {'updated': stamp, 'briefs': briefs[:60], 'places': ranked[:300],
           'fly': fly, 'flytrace': trace[:60]}
    with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=1)
    repeat = sum(1 for p in ranked if p['count'] > 1)
    print(f"  history: {len(ranked)} locations tracked, {repeat} seen more than once")
    if events:
        novel = sum(1 for e in events if e['novelty'] >= 0.66)
        print(f"  mushroom body: {len(fly.get('w', {}))}/{KC_COUNT} Kenyon cells "
              f"carry a trace, {novel}/{len(events)} events scored novel")
    return out


def write_cache(content, provider, events, feeds):
    with open(CACHE_FILE, 'w', encoding='utf-8') as f:
        json.dump({
            'date': datetime.now(timezone.utc).strftime('%B %d, %Y'),
            'content': content,
            'provider': provider,
            'events': events,
            'feeds': feeds,
            'generated_at': datetime.now(timezone.utc).isoformat(),
        }, f, indent=2)


def write_archive(content, when):
    """Persist this run's brief. Named to the minute so a second run in the same
    day does not overwrite the first."""
    os.makedirs(ARCHIVE_DIR, exist_ok=True)
    name = when.strftime('%Y-%m-%d-%H%M') + '.md'
    with open(os.path.join(ARCHIVE_DIR, name), 'w', encoding='utf-8') as f:
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
        label = stem.upper()
        for fmt, out in (('%Y-%m-%d-%H%M', '%d %b %Y %H:%MZ'), ('%Y-%m-%d', '%d %b %Y')):
            try:
                label = datetime.strptime(stem, fmt).strftime(out).upper()
                break
            except ValueError:
                continue
        entries.append({'date': label, 'path': f'{ARCHIVE_DIR}/{name}'})
    with open(os.path.join(ARCHIVE_DIR, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(entries, f, indent=2)
    return entries


# ---------------------------------------------------------------- render ----

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
            .replace(' ', '\\u2028')
            .replace(' ', '\\u2029'))


def render(content, provider, badge, timestamp, archive, events, feeds, stale=False, history=None):
    """Fill template.html and write index.html.

    Brief text is injected as a JSON string literal, never as raw HTML, so a
    stray '<' or '</pre>' in model output can no longer break the page.
    """
    with open(TEMPLATE_FILE, 'r', encoding='utf-8') as f:
        html = f.read()

    try:
        with open('assets/coastline.json', 'r', encoding='utf-8') as f:
            coastline = json.load(f)
    except Exception as e:
        print(f"Coastline geometry unavailable ({e}); globe draws without outlines")
        coastline = {'lines': []}
    try:
        with open('assets/land.json', 'r', encoding='utf-8') as f:
            land = json.load(f)
    except Exception as e:
        print(f"Land polygons unavailable ({e}); globe draws unfilled")
        land = {'rings': []}

    # The collection key is NOT written into the page by default.
    #
    # index.html is published to GitHub Pages, so anything in it is readable by
    # every visitor via View Source -- the key was never leaked by GitHub
    # Secrets, it was leaked by this line putting it in a public file. The page
    # falls back to asking the viewer for their own key and keeping it in their
    # own browser, so the local-brief feature still works without publishing
    # anyone's credentials.
    #
    # Setting PUBLISH_GROK_KEY=1 restores the old behaviour. No workflow sets
    # it, and it should stay that way unless the key is one you are content to
    # make public.
    grok_key = (os.environ.get('GROK_API_KEY', '')
                if os.environ.get('PUBLISH_GROK_KEY') == '1' else '')
    if grok_key:
        print('WARNING: embedding GROK_API_KEY in index.html - it will be public')

    subs = {
        '__TIMESTAMP__': escape(timestamp),
        '__BADGE__': escape(badge),
        '__PROVIDER__': escape(provider),
        '__BRIEF_JSON__': js_json(content),
        '__BUILT_AT_JSON__': js_json(datetime.now(timezone.utc).isoformat()),
        '__IS_STALE_JSON__': 'true' if stale else 'false',
        '__ARCHIVE_JSON__': js_json(archive),
        '__EVENTS_JSON__': js_json(events),
        '__FEEDS_JSON__': js_json(feeds),
        '__COASTLINE_JSON__': js_json(coastline.get('lines', [])),
        '__LAND_JSON__': js_json(land.get('rings', [])),
        '__HISTORY_JSON__': js_json(history or load_history()),
        '__FLY_JSON__': js_json({'kc': KC_COUNT, 'pn': PN_COUNT, 'fanin': KC_FANIN,
                                 'winners': KC_WINNERS, 'halflife': FLY_HALFLIFE_DAYS,
                                 'wiring': fly_wiring_b64(),
                                 'trace': ((history or load_history()) or {}).get('flytrace', []),
                                 'traced': len((((history or load_history()) or {}).get('fly') or {}).get('w', {}))}),
        '__GROK_KEY_JSON__': js_json(grok_key),
    }
    for token, value in subs.items():
        html = html.replace(token, value)

    leftover = [t for t in subs if t in html]
    if leftover:
        raise Exception(f"Template placeholders not substituted: {leftover}")

    with open('index.html', 'w', encoding='utf-8') as f:
        f.write(html)


# ------------------------------------------------------------------ main ----

def main():
    now = datetime.now(timezone.utc)
    timestamp = now.strftime('%Y-%m-%d %H:%M UTC')

    if '--feeds-only' in sys.argv:
        # Refresh the live layers and redeploy without calling any LLM, so a
        # cheap job can run often enough to keep the air picture current while
        # the brief itself stays on its twice-daily schedule.
        cache = load_cache()
        content = load_cached_brief()
        if not content:
            raise Exception('--feeds-only requires a usable brief in ' + CACHE_FILE)
        print('Refreshing feeds only (no collection)...')
        feeds = fetch_server_feeds()
        render(content, cache.get('provider', 'CACHED'), 'FEEDS-REFRESH', timestamp,
               index_archive(), cache.get('events', []), feeds, False, load_history())
        cache['feeds'] = feeds
        with open(CACHE_FILE, 'w', encoding='utf-8') as f:
            json.dump(cache, f, indent=2)
        print('Feeds refreshed at ' + timestamp)
        return

    if '--offline' in sys.argv:
        # Re-render index.html from cache. No API calls, no new archive entry.
        cache = load_cache()
        content = load_cached_brief()
        if not content:
            raise Exception('--offline requires a usable brief in ' + CACHE_FILE)
        # Cache may predate the events field, or still carry the raw block.
        events, content = extract_events(content)
        if not events:
            events = cache.get('events', [])
        render(content, 'CACHED - offline re-render', 'CACHE-RENDER', timestamp,
               index_archive(), events, cache.get('feeds', {}), True, load_history())
        print('Re-rendered index.html from cache (offline mode)')
        return

    window_end = now
    window_start = now - timedelta(hours=WINDOW_HOURS)
    deep = deep_run(now)
    print(f"Collection depth: {'deep (all sections)' if deep else 'core (sections 1-2)'}")
    prompt = build_prompt(window_start, window_end, previous_digest(load_cached_brief()),
                          load_watchlist(), deep)

    stale = False
    print(f"Initiating collection, {WINDOW_HOURS}h window, Grok 4.1 + x_search + web_search...")
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

    if stale:
        events, feeds = load_cache().get('events', []), load_cache().get('feeds', {})
    else:
        events, content = extract_events(content)
        print("Fetching server-side feeds...")
        feeds = fetch_server_feeds()

    archive = write_archive(content, now)
    if not stale:
        brief_quality(content)
    hist = update_history(events, (archive[0]['path'] if archive else ''), content, now) \
        if not stale else load_history()
    render(content, provider, badge, timestamp, archive, events, feeds, stale, hist)
    write_cache(content, provider, events, feeds)
    print(f"Brief generated successfully at {timestamp}")


if __name__ == '__main__':
    main()
