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
from html import escape, unescape

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
# Searches are most of the bill: a run of ~11 searches cost ~$0.20, of which the
# prompt and the written brief were a few cents. The headlines the pipeline reads
# for free cover the web's discovery work, so the paid searches go to X and to
# detail. Stated to the model as a budget; the run log compares it with the count.
SEARCH_BUDGET = int(os.environ.get('SEARCH_BUDGET', '8'))
WATCHLIST_FILE = 'watchlist.json'


def read_version():
    """The build version, from the VERSION file at the repo root.

    MAJOR.MINOR.PATCH: bump PATCH for fixes, MINOR for a new feature or layer,
    MAJOR for a change to what the brief is. The file is the single place it
    lives; the page header, footer and feed-status file all read it from here.
    """
    try:
        with open('VERSION', 'r', encoding='utf-8') as f:
            v = f.read().strip()
        return v if re.match(r'^\d+\.\d+\.\d+$', v) else 'dev'
    except OSError:
        return 'dev'


VERSION = read_version()
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


LAST_TOOL_USE = {}
LAST_GPSJAM = None


def report_tool_use(data):
    """Log what the model actually searched, from the API's own record of it.

    Three rounds of prompt changes moved X citations 3 -> 1 -> 0 while every
    version of the tasking demanded more of them, which is the point at which
    editing the prose again stops being diagnosis and starts being guessing.
    The response carries the tool calls; the parser was keeping only the
    message items and discarding them, so there has never been any evidence
    about whether x_search ran, what it was asked, or what came back.
    Defensive about the schema on purpose: it logs what it finds rather than
    assuming field names, so one run teaches us the shape.
    """
    try:
        out = data.get('output') or []
        kinds = {}
        for item in out:
            k = str(item.get('type', '?'))
            kinds[k] = kinds.get(k, 0) + 1
        print(f"  api output items: {kinds}")

        for item in out:
            k = str(item.get('type', ''))
            if 'message' in k or 'reasoning' in k:
                continue
            # Pull anything that looks like a query or a result count, whatever
            # the field happens to be called.
            bits = []
            for key in ('query', 'queries', 'search_query', 'input', 'arguments',
                        'action', 'name', 'status'):
                v = item.get(key)
                if v:
                    bits.append(f"{key}={json.dumps(v)[:180]}")
            res = item.get('results') or item.get('output') or item.get('content')
            if isinstance(res, list):
                bits.append(f"results={len(res)}")
            elif res:
                bits.append(f"results~{len(json.dumps(res))}b")
            if bits:
                print(f"    [{k}] " + ' '.join(bits))

        usage = data.get('usage') or {}
        cost = None
        if usage:
            keep = {kk: vv for kk, vv in usage.items() if isinstance(vv, int)}
            print(f"  usage: {keep}")
            # xAI bills in ticks of 1e-10 USD. The two runs of 25 Sep logged
            # 1.94e9 and 2.14e9 ticks, and the console showed $0.41 for the day.
            if isinstance(usage.get('cost_in_usd_ticks'), int):
                cost = round(usage['cost_in_usd_ticks'] / 1e10, 4)
                print(f"  cost: ${cost:.3f} this run - "
                      f"{usage.get('num_server_side_tools_used', '?')} searches "
                      f"(budget {SEARCH_BUDGET})")

        # Keep it somewhere small and always readable. This record only exists in
        # the middle of a 995-line job log, and the log endpoint is size-capped
        # from the end, so the one run that finally explained the problem nearly
        # went unread. feed-status.json is echoed whole at the end of every run.
        global LAST_TOOL_USE
        queries = []
        for item in out:
            if 'search' in str(item.get('type', '')) or item.get('name'):
                raw = item.get('input') or item.get('action') or {}
                if isinstance(raw, str):
                    try:
                        raw = json.loads(raw)
                    except Exception:
                        raw = {'query': raw}
                q = (raw or {}).get('query')
                if q:
                    queries.append({'tool': item.get('name') or item.get('type'),
                                    'q': str(q)[:120]})
        LAST_TOOL_USE = {'items': kinds, 'queries': queries,
                         'usage': {kk: vv for kk, vv in usage.items() if isinstance(vv, int)},
                         'cost_usd': cost, 'search_budget': SEARCH_BUDGET}
    except Exception as e:
        print(f"  (tool-use report failed: {str(e)[:90]})")


def generate_with_grok(prompt, since=None):
    api_key = os.environ.get('GROK_API_KEY')
    if not api_key:
        return None, "No Grok API key"

    # x_search limited to the window: every post it returns is one the brief can
    # use, instead of the loudest post of the last month on the same subject.
    xs = {'type': 'x_search'}
    if since is not None:
        xs['from_date'] = since.strftime('%Y-%m-%d')
    base = {'model': 'grok-4-1-fast-reasoning',
            'input': [{'role': 'system', 'content': SYSTEM_PROMPT},
                      {'role': 'user', 'content': prompt}],
            'tools': [xs, {'type': 'web_search'}],
            'temperature': 0.6,
            # A reasoning model with no ceiling is an open-ended bill.
            'max_output_tokens': MAX_OUTPUT_TOKENS}
    try:
        response = None
        # Each fallback drops one optional field, so a deployment that rejects it
        # costs a retry rather than the run. Only a 400 naming the field retries.
        for attempt in range(3):
            response = requests.post(
                'https://api.x.ai/v1/responses',
                headers={'Content-Type': 'application/json',
                         'Authorization': f'Bearer {api_key}'},
                json=base, timeout=180)
            if response.status_code != 400:
                break
            body = response.text
            # from_date is dropped on any 400: whatever the message names, a run
            # without it is the one that worked before it was added.
            if 'from_date' in base['tools'][0]:
                print(f'  400 with x_search from_date ({body[:120]}); retrying without it')
                base['tools'][0] = {'type': 'x_search'}
            elif 'max_output_tokens' in body and 'max_output_tokens' in base:
                print('  max_output_tokens rejected; retrying uncapped')
                base.pop('max_output_tokens')
            else:
                break

        if response.status_code == 200:
            data = response.json()
            report_tool_use(data)
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
        # Everything from the first closing block on is forecast, verdict or open
        # question. Feeding those back as "already reported" told the next run it
        # had reported events that were only ever predictions.
        if _CLOSING.match(line):
            break
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


# ------------------------------------------------- forecast accountability ----

_HEADING = re.compile(r'^(#{1,4}\s|\*\*[^*]+\*\*\s*:?\s*$)')
_CLOSING = re.compile(r'^[*#\s]*(FORECAST CHECK|INDICATORS AND WARNINGS|INDICATORS|COLLECTION GAPS)\b', re.I)


def closing_items(content, name):
    """The list items under one of the brief's closing headings.

    Both shapes the model uses are accepted -- "## INDICATORS AND WARNINGS" and a
    bare "**INDICATORS AND WARNINGS**" line -- and any other heading ends the
    block, so an Assessment paragraph that follows is not swept in.
    """
    out, on = [], False
    for raw in (content or '').splitlines():
        line = raw.strip()
        if _HEADING.match(line):
            on = bool(re.search(name, line, re.I))
            continue
        if on and re.match(r'^([-*]|\d+[.)])\s+\S', line):
            out.append(re.sub(r'^([-*]|\d+[.)])\s+', '', line).strip())
    return out


def prior_indicators(previous):
    items = closing_items(previous, r'INDICATORS')
    return [re.sub(r'\s+', ' ', i)[:300] for i in items][:8]


def forecast_block(indicators):
    if not indicators:
        return ('=== RULE 7: ACCOUNT FOR YOUR LAST FORECASTS ===\n'
                'No indicators were recovered from the previous brief, so there is nothing to\n'
                'check this run. Omit the FORECAST CHECK block.\n')
    listed = '\n'.join(f'{n}. {t}' for n, t in enumerate(indicators, 1))
    return f"""=== RULE 7: ACCOUNT FOR YOUR LAST FORECASTS ===
The previous brief made these calls. A watch brief that never looks back at its own
warnings cannot tell a good analyst from a lucky one, and the reader cannot either.

{listed}

Check each against what you found this run. Put a **FORECAST CHECK** block after the
sections and BEFORE Indicators and Warnings, one numbered line per call above, same
order, same numbers:
  1. TRIGGERED - one sentence saying what happened and where it is reported above
VERDICT is exactly one of:
  TRIGGERED      it happened. Point to the tagged item in this brief that shows it.
  NOT TRIGGERED  its window has passed and it did not happen.
  OPEN           still inside its window, no sign either way yet.
  OVERTAKEN      events made the call moot; say which events.
A TRIGGERED verdict with no supporting item above is a fabrication under Rule 1: if
you did not retrieve the evidence this run, the verdict is OPEN or NOT TRIGGERED. Expect
a mix. A check where every line carries the same verdict was probably not done, and
you should look again before writing it.
"""


def build_prompt(window_start, window_end, prev_digest, watchlist='', deep=True,
                 leads='', forecasts=''):
    slow_sections = SLOW_SECTIONS if deep else (
        '(Sections 5 and 6 - UAP and frontier research - are collected on the daily\n'
        'deep run only. Do not search for or report them now.)')
    return f"""MULTI-INT COLLECTION TASKING

COLLECTION WINDOW: {window_start:%Y-%m-%d %H:%M} UTC to {window_end:%Y-%m-%d %H:%M} UTC
Today's date is {window_end:%d %B %Y}. This brief runs twice a day.

You have x_search and web_search. Use them before writing anything.

=== SEARCH BUDGET: about {SEARCH_BUDGET} searches this run ===
Every search is billed; the HEADLINES list below was collected for free and already
covers what the main outlets published in the window. So spend searches where no feed
reaches:
  - x_search, most of the budget: the fast half, first-hand posts, local-language
    accounts, reaction to a headline. One subject per query, aimed at a theatre, a
    hotspot or a headline where people on the ground would add something.
  - web_search, two or three at most: detail or confirmation for an item you will
    carry at high priority, a GDELT hotspot or navigational warning with no headline
    behind it, or a theatre with nothing in the headlines that you are about to call
    quiet.
  - Never search for a story that is already in the headlines just to cite it - cite
    the headline. Never repeat a search in other words.
A theatre is swept when you have read its headlines and run one X query on it. With
nothing in either, it is quiet in window.

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
            The headlines tell you what was published; X tells you what is happening,
            hours before the wire files. A brief built only from the headlines is a
            press review, and you will have skipped the faster half of the collection.
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

{forecasts}
{leads}
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
Search X DIRECTLY, by topic and by place name, not only the handles listed elsewhere -
the accounts worth reading during an event are usually ones nobody put on a list.

DO THESE SEARCHES. Not "consider", not "where relevant" - issue them.
  - At least FOUR x_keyword_search calls, one per active theatre. A nil return for a
    search you did not run is a false statement, not a finding.

SHOW YOUR SEARCHES. End this section with one line: "searched: " followed by the actual
query strings you ran, exactly as issued. A nil return is only credible if you can name
what produced it.

X: search the theatre names, place names, unit designations and equipment types as
ONE SUBJECT PER QUERY. No date operators, no OR chains, no boolean strings - issue
several narrow queries instead of one wide one.
  BAD:  Ukraine drone OR Shahed OR Russia attack
  GOOD: Novorossiysk port     (then) Shahed Kyiv     (then) Sumy strike
An OR chain returns whatever is loudest across every branch at once, and that is the
wire story every time - it is the single most reliable way to guarantee this section
finds nothing but news reposts. Dropping the date operators already moved X citations
from zero to three; the OR chains are what is left. The last run was told this and
issued four OR chains anyway, so: if your query contains the word OR, split it into
separate queries before sending it.
Prefer the specific over the topical: a place, a unit, a ship or airframe name, a
person, a street. Topic-level queries return news accounts because news accounts are
what post at topic level. Search in the local language where that is where people are
posting - Ukrainian, Russian, Hebrew, Arabic, Mandarin - not only in English.
Read replies and quote-posts, not only the original. Milblogger and
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
Reddit comes to you free: the REDDIT lines in the headlines are the newest posts in
r/CredibleDefense, r/geopolitics, r/UkraineWarVideoReport and r/LessCredibleDefence.
Work those. Do not run site:reddit.com web searches - the last several runs spent five
or six searches each on them and carried no Reddit thread at all. The one exception: a
major incident with a city or country subreddit of its own, worth one search at most.

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
WORK THIS SECTION before judging it. The CYBER headlines include what CISA added to
its Known Exploited Vulnerabilities catalog in the last three days - active
exploitation, confirmed by the government, already retrieved. Read those, then run
one x_keyword_search on the most consequential item (researchers post details before
the write-ups), and a web_search only if the CYBER headlines are empty. End the section
with a "searched:" line naming the headline desk and the queries, as in Section 1. In
a 12-hour window something is almost always being actively exploited somewhere;
"quiet" here should be rare, and it is only credible with the work beside it.

## 4. HOMELAND AND INFRASTRUCTURE
Seeds: @DHSgov @FBI @TSA @CISAgov @NTSB @FAANews; web: state emergency management,
regional press. Focus: incidents affecting civil aviation, rail, ports, power, water and
telecoms; domestic security events; large-scale disruption. Distinguish accident from
attack, and say when the distinction is not yet established.
Same rule as Section 3: read the US HOMELAND headlines, run one X query, and a
web_search only if the headlines are empty - then a "searched:" line at the end of the
section. No searched line means the verdict was not earned.

{slow_sections}

=== ANALYSIS THE BRIEF MUST CARRY ===
Reporting what happened is the easy half. Every section closes with one short
**Assessment** that answers the so-what - what this signifies, whose position improved
or worsened, and what it implies - rather than restating the bullets in other words.
Where the evidence supports more than one reading, give the alternative explicitly and
say which you favour and why.

ESTIMATIVE LANGUAGE. Every judgement - in an Assessment or an indicator - carries one
of these terms, and each means exactly this range (the US Intelligence Community
standard, ICD 203):
  almost no chance 1-5% | very unlikely 5-20% | unlikely 20-45% | roughly even chance
  45-55% | likely 55-80% | very likely 80-95% | almost certain 95-99%
Do not carry a judgement with could, may, might, possibly, potentially or probably.
Those words have no range: the reader cannot tell a 10% call from a 60% one, and
neither can the next run checking it.
Separately, end each Assessment with a confidence - low, moderate or high - and the
reason for it: the quality and independence of what it rests on, and how much of it
is inference. Likelihood is how probable the outcome is; confidence is how good your
evidence is. They are different axes, and a likely outcome resting on one partisan
source is likely with low confidence, which the reader needs to know.

After the sections, the closing blocks - FORECAST CHECK per Rule 7 if it applies, then:

**INDICATORS AND WARNINGS** - three to six things that would materially change the
picture if they occurred in the next 24-48 hours. Each written as:
indicator -> what it would mean -> where it would show up first -> likelihood in the
window, as one of the terms above.
Make each one checkable: name a threshold and a window a reader could test next run.
"Tensions may rise" cannot be scored; ">20 PLA aircraft across the median line within
48h - unlikely" can. The next brief will score every one of these, so a vague indicator
only postpones being wrong.
These are forward-looking judgements, so they are not bound by Rule 1's retrieval
requirement - but they must follow from what you actually reported above.

**COLLECTION GAPS** - the substantive questions this brief could not answer, per Rule 3.

=== OUTPUT FORMAT ===
Markdown, with real headings: `##` for the numbered sections, `###` for each theatre
inside Section 1. Bold text is not a heading and breaks the page's navigation.
Open with a BLUF of three to five lines covering only what matters most and why - not a
list of everything below. Then the sections, then the closing blocks: FORECAST CHECK
(when Rule 7 gives you calls to check), INDICATORS AND WARNINGS, COLLECTION GAPS - each
under its own `##` heading. The closing blocks take no classification tags.
Items as bullets, each starting with its classification tag (reported items only - see
Rule 6). Keep each item to two or three sentences: what, who reported it, why it matters.

=== REQUIRED FINAL BLOCK: GEOLOCATED EVENTS ===
After all prose, output a single fenced json code block, and nothing after it. One entry
for each reported item that has a real physical location. Omit items with no location
(policy, research, online-only) rather than inventing coordinates.

```json
{{"events":[
  {{"lat":44.72,"lon":37.77,"place":"Novorossiysk, Russia","headline":"one line, under 100 chars","section":"geopolitical","classification":"SIGINT - VERIFIED","confidence":"high","priority":4,"when":"2026-09-24T14:10Z","url":"https://..."}}
]}}
```

Rules for this block: lat/lon numeric decimal degrees for the place the event occurred;
section is one of geopolitical, technology, homeland, uap, research; confidence is high, medium or
low; priority is 1-5, where 5 demands immediate attention and 1 is routine, scored
higher for anything matching the standing requirements above; when is the UTC time
the event itself happened, as the source gives it - a date alone is fine, and omit the
field entirely if the source does not say, rather than using the time you read it;
url must be one you actually retrieved. Valid JSON only, no comments, no trailing
commas. If there are no locatable events, output {{"events":[]}}.

BEFORE YOU SEND, check:
- every section ends with an **Assessment** carrying an estimative term and a confidence
  (low / moderate / high, with the reason);
- every link is the item's own, written inline as [text](url);
- no theatre is called quiet while a headline above covers it;
- no X query you ran contained OR.

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
            # only a real date survives: the page asks for imagery either side of
            # it, and a guessed one would put the "before" pass after the event
            w = str(e.get('when') or '').strip()
            if re.match(r'^\d{4}-\d{2}-\d{2}', w):
                events[-1]['when'] = w[:20]
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


# GPS interference. The hub anchors above sit where airliners are, which is not
# where GPS is jammed. These add the regions where jamming and spoofing are
# persistent enough to show in a half-hour sample: the Baltic and Gulf of
# Finland, the Kola border, the Black Sea, the eastern Mediterranean and the
# Levant, Iraq, the Caucasus, and the India-Pakistan border.
JAM_ANCHORS = [
    (55.0, 20.5), (59.4, 25.5), (68.5, 29.0), (44.8, 33.5), (34.8, 33.0),
    (32.8, 35.5), (33.3, 44.4), (40.3, 46.5), (31.0, 73.5),
]
JAM_HOURS = 6          # rolling window the layer aggregates over
JAM_MIN_SIGHTINGS = 5  # a cell needs this many aircraft sightings to be judged
JAM_MIN_AIRCRAFT = 2   # ...and degraded GPS from this many different aircraft,
                       # so one airframe with a faulty receiver is not "jamming"


def _gps_degraded(a):
    """(checked, degraded) for one ADS-B row, gpsjam.org's signal.

    An aircraft broadcasts how accurate it believes its own position is (NACp)
    and how far it trusts it (NIC). Jamming shows up as those collapsing for
    every aircraft in an area at once. Only airborne civil ADS-B counts: MLAT
    and TIS-B positions are computed on the ground, and some military
    transponders report low accuracy on purpose.
    """
    if str(a.get('type') or 'adsb_icao')[:4] not in ('adsb', 'adsr'):
        return False, False
    alt = a.get('alt_baro')
    if alt is None or alt == 'ground' or a.get('version') == 0:
        return False, False
    nacp, nic = a.get('nac_p'), a.get('nic')
    if nacp is None and nic is None and 'gpsOkBefore' not in a:
        return False, False
    bad = (isinstance(nacp, int) and nacp < 8) or (isinstance(nic, int) and nic < 7) \
        or 'gpsOkBefore' in a
    return True, bool(bad)


def _pages_asset(name):
    repo = os.environ.get('GITHUB_REPOSITORY', 'TridentIntelFree/Trident-Brief')
    owner, _, rname = repo.partition('/')
    return f'https://{owner.lower()}.github.io/{rname}/assets/{name}'


def gps_jam_layer(cells_now):
    """Fold this run's per-cell sample into the rolling window and summarise it.

    The feed refresh does not commit, so the window's earlier samples are read
    back from the copy already deployed on the live site. If that is not
    reachable the layer simply starts again from this run.
    """
    now = datetime.now(timezone.utc)
    runs = []
    try:
        r = requests.get(_pages_asset('gpsjam.json'), timeout=10,
                         headers={'Cache-Control': 'no-cache'})
        if r.status_code == 200:
            runs = r.json().get('runs') or []
    except Exception as e:
        print(f"  gpsjam: no earlier samples ({str(e)[:60]})")
    keep = []
    for run in runs:
        t = _wire_time(run.get('at'))
        if t and now - t <= timedelta(hours=JAM_HOURS) and isinstance(run.get('c'), dict):
            keep.append(run)
    keep.append({'at': now.strftime('%Y-%m-%dT%H:%M:%SZ'),
                 'c': {k: [v[0], v[1], sorted(v[2])[:40]] for k, v in cells_now.items()}})
    os.makedirs('assets', exist_ok=True)
    with open('assets/gpsjam.json', 'w', encoding='utf-8') as f:
        json.dump({'hours': JAM_HOURS, 'runs': keep}, f, separators=(',', ':'))

    agg = {}
    for run in keep:
        for k, (n, bad, hexes) in run['c'].items():
            a = agg.setdefault(k, [0, 0, set()])
            a[0] += n; a[1] += bad; a[2].update(hexes)
    out, checked = [], 0
    for k, (n, bad, hexes) in agg.items():
        checked += n
        if n >= JAM_MIN_SIGHTINGS and len(hexes) >= JAM_MIN_AIRCRAFT and bad / n >= 0.02:
            la, lo = (int(x) for x in k.split(','))
            out.append([la, lo, n, bad, len(hexes)])
    out.sort(key=lambda c: -c[3] / c[2])
    return {'at': keep[-1]['at'], 'hours': JAM_HOURS, 'runs': len(keep), 'checked': checked,
            'cells_seen': len(agg), 'cells': out[:400]}


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
    global LAST_GPSJAM
    seen, out, jam = set(), [], {}

    def take(rows, mil=False):
        for a in rows or []:
            lat, lon = a.get('lat'), a.get('lon')
            if lat is None or lon is None:
                continue
            key = a.get('hex') or a.get('r') or a.get('flight')
            if not key or key in seen:
                continue
            seen.add(key)
            is_mil = mil or bool(a.get('dbFlags') and int(a['dbFlags']) & 1)
            if not is_mil:
                ok, bad = _gps_degraded(a)
                if ok:
                    c = jam.setdefault(f'{math.floor(lat)},{math.floor(lon)}', [0, 0, set()])
                    c[0] += 1
                    if bad:
                        c[1] += 1
                        c[2].add(str(key))
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

    for i, (lat, lon) in enumerate(AIR_ANCHORS + JAM_ANCHORS):
        if i:
            time.sleep(0.4)   # one anchor drew a 429 when fired back to back
        d, _ = _try(_ac_urls(lat, lon), timeout=20)
        if d:
            take(d.get('ac') or d.get('aircraft'))

    if not out:
        return None, 'no provider answered from the runner either'

    try:
        LAST_GPSJAM = gps_jam_layer(jam)
        j = LAST_GPSJAM
        print(f"  gpsjam: {sum(v[0] for v in jam.values())} sightings with accuracy fields this run; "
              f"{j['runs']} run(s) in {JAM_HOURS}h, {j['cells_seen']} cells, {len(j['cells'])} flagged")
    except Exception as e:
        print(f"  gpsjam failed: {e}")

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


# ------------------------------------------------- primary-source leads ----
#
# The brief kept coming back as a press review: search, find the wire story,
# write it up. These two feeds arrive as structured data before the model
# starts, so it has to account for things no headline led it to.
#
# Neither host could be reached from the environment this was written in, so
# both parsers are built to say what they actually received when it is not
# what they expected. The first Actions run is the test: a wrong guess about
# the format shows up in the log and in assets/feed-status.json as the real
# field names, not as a silent empty list.

LEAD_REFRESH_HOURS = 2      # GDELT window on the half-hourly feeds-only run

NAVWARN_BASE = 'https://msi.nga.mil/api/publications/broadcast-warn?output=json'
# The first live run returned 386 "active" warnings and every one that
# qualified had been issued in 2022-24: the newest was 868 days old, on a
# service that issues several rocket-launch notices a week. Whichever way that
# happened -- a filter this API reads differently, a default sort, a stale
# mirror -- it cannot be settled from here, so each run asks several ways,
# logs what each returned, and keeps the freshest answer.
NAVWARN_VARIANTS = ['&status=A', '&status=active', '']
NAVWARN_MAX_AGE_DAYS = 45       # older than this is a standing notice, not a lead
NAVWARN_FROZEN_DAYS = 21        # newest warning older than this: the feed is not live
NAVWARN_PAGE = 'https://msi.nga.mil/NavWarnings'
NAVAREA_LABEL = {'4': 'NAVAREA IV', 'IV': 'NAVAREA IV', '12': 'NAVAREA XII', 'XII': 'NAVAREA XII',
                 'A': 'HYDROLANT', 'P': 'HYDROPAC', 'C': 'HYDROARC'}
# First match wins, so the space-launch pattern sits ahead of the missile one:
# "ROCKET LAUNCH" is a launch notice, not a weapons test. Unexploded ordnance
# is a hazard left behind, not live fire, and "submarine volcanic activity" is
# geology -- the first run filed it as a military exercise.
_NAVWARN_KIND = [
    ('space launch/debris', re.compile(r'SPACE DEBRIS|SPACE LAUNCH|LAUNCH VEHICLE|ROCKET LAUNCH|'
                                       r'ROCKET STAGE|REENTRY|RE-ENTRY', re.I)),
    ('missile/rocket', re.compile(r'\bMISSILES?\b|\bROCKETS?\b|\bBALLISTIC\b', re.I)),
    ('ordnance hazard', re.compile(r'UNEXPLODED|\bUXO\b|DERELICT (MINE|ORDNANCE)|MINEFIELD|'
                                   r'\bMINES?\b(?!\s+(?:OF|AND))', re.I)),
    ('live fire', re.compile(r'GUNNERY|\bFIRING\b|LIVE[- ]FIRE|WEAPONS? (FIRING|EXERCISE|TESTING)', re.I)),
    ('military exercise', re.compile(r'(NAVAL|MILITARY) (EXERCISES?|OPERATIONS)|AIRCRAFT CARRIER|'
                                     r'\bSUBMARINES?\b(?!\s+(?:VOLCAN|CABLE|PIPELINE|ERUPTION|EARTHQUAKE))',
                                     re.I)),
    ('hazardous ops', re.compile(r'HAZARDOUS OPERATIONS|UNDERWATER OPERATIONS|\bEXPLOSIVES?\b', re.I)),
    ('security incident', re.compile(r'\bATTACK(ED|S)?\b|HIJACK|PIRACY|\bARMED\b|\bDRONES?\b|'
                                     r'UNMANNED', re.I)),
]
_KIND_RANK = {k: i for i, (k, _) in enumerate(_NAVWARN_KIND)}
# Routine commercial work -- a named survey vessel or cable ship laying cable
# "until further notice" -- is a genuine hazard to mariners and noise to an
# analyst. It only stays in when something military is also in the text.
_NAVWARN_ROUTINE = re.compile(r'\bM/V\b|\bR/V\b|CABLESHIP|CABLE SHIP|SURVEY VESSEL|\bSURVEY\b|'
                              r'SEISMIC SURVEY|PIPELAY|DREDG', re.I)
_NAVWARN_MILITARY = re.compile(r'MISSILE|ROCKET|NAVAL|MILITARY|GUNNERY|FIRING|WARSHIP|NAVY', re.I)
# NGA writes positions as 36-12.00N 125-30.00E
_NGA_LL = re.compile(r'\b(\d{1,2})-(\d{1,2}(?:\.\d+)?)\s?([NS])\s*,?\s*(\d{1,3})-(\d{1,2}(?:\.\d+)?)\s?([EW])\b')


def _nga_points(text):
    pts = []
    for m in _NGA_LL.finditer(text):
        la = int(m.group(1)) + float(m.group(2)) / 60
        lo = int(m.group(4)) + float(m.group(5)) / 60
        if m.group(3) == 'S':
            la = -la
        if m.group(6) == 'W':
            lo = -lo
        if -90 <= la <= 90 and -180 <= lo <= 180 and float(m.group(2)) < 60 and float(m.group(5)) < 60:
            pts.append((la, lo))
    return pts


def _nga_time(s):
    try:
        return datetime.strptime(str(s).strip().upper(), '%d%H%MZ %b %Y').replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


# A warning's text is numbered paragraphs and lettered areas: "1. MISSILE
# FIRING ... IN AREAS BOUND BY: A. 33-40N ..., B. 32-10N ...". Positions from
# two different areas joined into one outline cross the map as a nonsense
# shape, so the text is split at those markers and each piece is read on its
# own. Coordinates never match these markers: "12.00N" has no space after the
# point.
_NGA_SPLIT = re.compile(r'(?=(?<![A-Z0-9])(?:\d{1,2}|[A-H])\.\s)')
_NGA_CIRCLE = re.compile(r'WITHIN\s+(\d+(?:\.\d+)?)\s*(?:NAUTICAL\s+)?(?:MILES?|NM)\s+(?:RADIUS\s+)?OF', re.I)


def _nga_shapes(text):
    """The areas, lines and points a warning names, for drawing it on a map."""
    shapes = []
    para = ''
    for seg in _NGA_SPLIT.split(text):
        # A lettered area inherits its paragraph's wording: in "IN AREAS BOUND
        # BY: A. ... B. ..." the word BOUND sits before the split, so area A
        # on its own would read as loose points.
        if re.match(r'^[A-H]\.\s', seg):
            up = (para + ' ' + seg).upper()
        else:
            para = seg
            up = seg.upper()
        pts = _nga_points(seg)
        if not pts:
            continue
        circ = _NGA_CIRCLE.search(seg)
        if circ and len(pts) == 1:
            shapes.append({'t': 'circle', 'p': [pts[0]], 'r': float(circ.group(1))})
        elif len(pts) >= 3 and ('BOUND' in up or 'AREA' in up):
            shapes.append({'t': 'poly', 'p': pts})
        elif len(pts) >= 2 and ('TRACK' in up or 'JOINING' in up or 'BETWEEN' in up or 'LINE' in up):
            shapes.append({'t': 'line', 'p': pts})
        else:
            shapes.extend({'t': 'pt', 'p': [p]} for p in pts)
    # an outline spanning thousands of kilometres is a misread, not an area
    out, total = [], 0
    for s in shapes:
        la = [p[0] for p in s['p']]
        lo = [p[1] for p in s['p']]
        if s['t'] in ('poly', 'line') and (max(la) - min(la) > 15 or max(lo) - min(lo) > 20):
            out.extend({'t': 'pt', 'p': [p]} for p in s['p'][:6])
            continue
        out.append(s)
    for s in out:
        s['p'] = [[round(a, 3), round(b, 3)] for a, b in s['p'][:40]]
        total += len(s['p'])
        if total > 120:
            break
    return out[:12]


def _navwarn_rows(d):
    if isinstance(d, list):
        return d
    if isinstance(d, dict):
        for k in ('broadcast-warn', 'broadcastWarn', 'warnings', 'data', 'results'):
            if isinstance(d.get(k), list):
                return d[k]
        for v in d.values():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                return v
    return None


def fetch_navwarnings():
    """Active NGA broadcast warnings, filtered to recent military, launch and hazard ones.

    These are official notices to mariners: a closure area for a missile
    firing, a rocket stage drop zone, a live-fire exercise box. They are often
    published before anyone writes about the event, and they are primary
    documents rather than somebody's account of one -- but only while they are
    current. A two-year-old standing notice is not a lead, and a feed whose
    newest entry is weeks old is not live, whatever it calls itself.
    """
    now = datetime.now(timezone.utc)
    best, report = None, []
    for v in NAVWARN_VARIANTS:
        try:
            d = _get(NAVWARN_BASE + v, timeout=30)
        except Exception as e:
            report.append(f"{v or '(none)'}: {str(e)[:60]}")
            continue
        rows = _navwarn_rows(d)
        if rows is None:
            shape = list(d.keys())[:10] if isinstance(d, dict) else type(d).__name__
            report.append(f"{v or '(none)'}: unexpected shape {shape}")
            continue
        times = [t for t in (_nga_time((r or {}).get('issueDate')) for r in rows if isinstance(r, dict)) if t]
        newest = max(times) if times else None
        report.append(f"{v or '(none)'}: {len(rows)} rows, newest "
                      f"{newest.strftime('%Y-%m-%d') if newest else 'undated'}")
        if newest and (best is None or newest > best[1] or (newest == best[1] and len(rows) > len(best[0]))):
            best = (rows, newest, v)
    print('  navwarn variants: ' + ' | '.join(report))
    if best is None:
        return None, 'no variant returned dated warnings: ' + '; '.join(report)[:200]
    rows, newest, variant = best
    age = (now - newest).days
    if age > NAVWARN_FROZEN_DAYS:
        return None, (f'feed appears frozen: newest of {len(rows)} warnings was issued '
                      f'{newest.strftime("%Y-%m-%d")}, {age} days ago')
    out, total, stale, routine = [], 0, 0, 0
    for w in rows:
        if not isinstance(w, dict):
            continue
        text = ' '.join(str(w.get('text') or w.get('msgText') or '').split())
        if not text:
            continue
        total += 1
        t = _nga_time(w.get('issueDate'))
        if not t or (now - t).days > NAVWARN_MAX_AGE_DAYS:
            stale += 1
            continue
        kind = next((k for k, rx in _NAVWARN_KIND if rx.search(text)), None)
        if not kind:
            continue
        if _NAVWARN_ROUTINE.search(text) and not _NAVWARN_MILITARY.search(text):
            routine += 1
            continue
        area = str(w.get('navArea') or w.get('area') or '').strip()
        label = NAVAREA_LABEL.get(area.upper(), f'NAVAREA {area}' if area else 'NAVWARN')
        num, yr = w.get('msgNumber'), w.get('msgYear')
        item = {'id': f'{label} {num}/{str(yr)[-2:]}' if num and yr else label,
                'kind': kind,
                'issued': str(w.get('issueDate') or '')[:40],
                'age_days': (now - t).days,
                'authority': str(w.get('authority') or '')[:80],
                'text': text[:600],
                '_t': t.timestamp()}
        pts = _nga_points(text)
        if pts:
            shapes = _nga_shapes(text)
            # The marker goes on the first area, not the mean of every point: a
            # notice with two separate debris boxes put it in open sea between
            # them, on neither.
            anchor = shapes[0]['p'] if shapes else pts
            item['lat'] = round(sum(p[0] for p in anchor) / len(anchor), 3)
            item['lon'] = round(sum(p[1] for p in anchor) / len(anchor), 3)
            item['points'] = len(pts)
            item['shapes'] = shapes
        out.append(item)
    # newest first; within a day, launches and weapons ahead of the rest
    out.sort(key=lambda i: (-int(i['_t'] // 86400), _KIND_RANK[i['kind']], 'lat' not in i))
    for i in out:
        i.pop('_t', None)
    print(f"  navwarn: variant '{variant or '(none)'}', {total} warnings, newest issued "
          f"{newest.strftime('%Y-%m-%d')}; {stale} older than {NAVWARN_MAX_AGE_DAYS} days dropped, "
          f"{routine} routine commercial dropped; {len(out)} leads, "
          f"{sum(1 for i in out if i.get('shapes'))} mappable")
    return out[:80], None


GDELT_BASE = 'http://data.gdeltproject.org/gdeltv2/'
# CAMEO base codes that mean organised armed force rather than street crime.
# GDELT codes every "assault" in every local paper, so a straight root-code
# filter on 18/19 returns the day's crime blotter from American cities.
GDELT_CODES = {
    '152': 'military alert raised', '153': 'forces mobilised', '154': 'cyber forces mobilised',
    '183': 'bombing', '185': 'assassination', '186': 'assassination attempt',
    '190': 'conventional military force', '191': 'blockade', '192': 'territory occupied',
    '193': 'small-arms fighting', '194': 'artillery and armour', '195': 'aerial weapons',
    '196': 'ceasefire violated', '200': 'mass violence', '201': 'mass expulsion',
    '202': 'mass killing', '203': 'ethnic cleansing', '204': 'weapons of mass destruction',
    # these three only count when an armed actor is on one side
    '180': 'unconventional violence', '181': 'abduction', '182': 'armed assault',
}
_GDELT_NEEDS_ARMED = {'180', '181', '182'}
_ARMED = {'MIL', 'REB', 'INS', 'SEP', 'UAF', 'SPY'}


def _gdelt_slice(url):
    import io, zipfile
    r = requests.get(url, timeout=40, headers={'User-Agent': 'TridentBrief/1.0'})
    if r.status_code != 200:
        raise RuntimeError(f'HTTP {r.status_code}')
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        name = z.namelist()[0]
        return z.read(name).decode('utf-8', errors='replace')


def fetch_gdelt(hours):
    """Where armed-conflict events clustered in the last few hours, per GDELT.

    GDELT is machine-coded from world news every 15 minutes: broad, fast and
    noisy by construction. It is used here as a map of where to look, never as
    evidence that something happened -- the prompt says so, and a hotspot has
    to be reported by at least three separate outlets to be listed at all.
    """
    from concurrent.futures import ThreadPoolExecutor
    from collections import Counter
    from urllib.parse import urlparse
    try:
        r = requests.get(GDELT_BASE + 'lastupdate.txt', timeout=20,
                         headers={'User-Agent': 'TridentBrief/1.0'})
        if r.status_code != 200:
            return None, None, f'lastupdate HTTP {r.status_code}'
        m = re.search(r'(\d{14})\.export\.CSV\.zip', r.text)
        if not m:
            return None, None, f'no export file named in lastupdate: {r.text[:120]!r}'
    except Exception as e:
        return None, None, f'lastupdate: {str(e)[:120]}'
    latest = datetime.strptime(m.group(1), '%Y%m%d%H%M%S')
    urls = [GDELT_BASE + (latest - timedelta(minutes=15 * i)).strftime('%Y%m%d%H%M%S') + '.export.CSV.zip'
            for i in range(max(1, int(hours * 4)))]

    def grab(u):
        try:
            return _gdelt_slice(u)
        except Exception:
            return None
    with ThreadPoolExecutor(max_workers=8) as ex:
        texts = list(ex.map(grab, urls))
    got = [t for t in texts if t]
    if not got:
        return None, None, f'none of {len(urls)} export slices downloaded'

    spots, rows, bad, kept = {}, 0, 0, 0
    for text in got:
        for line in text.split('\n'):
            if not line:
                continue
            f = line.split('\t')
            rows += 1
            if len(f) != 61:
                bad += 1
                continue
            base = f[27]
            if base not in GDELT_CODES or f[25] != '1':
                continue
            if base in _GDELT_NEEDS_ARMED and not ({f[12], f[22]} & _ARMED):
                continue
            if f[51] not in ('3', '4'):          # city-level only: a country centroid is not a place
                continue
            try:
                la, lo = float(f[56]), float(f[57])
                mentions = int(f[31] or 0)
            except ValueError:
                bad += 1
                continue
            kept += 1
            s = spots.setdefault(f[58] or f'{la:.2f},{lo:.2f}', {
                'place': f[52][:100], 'country': f[53], 'lat': round(la, 3), 'lon': round(lo, 3),
                'events': 0, 'mentions': 0, 'domains': set(), 'what': Counter(), 'urls': {}})
            s['events'] += 1
            s['mentions'] += mentions
            s['what'][GDELT_CODES[base]] += 1
            url = f[60].strip()
            if url.startswith('http'):
                s['domains'].add(urlparse(url).netloc.lower().replace('www.', ''))
                s['urls'][url] = max(s['urls'].get(url, 0), mentions)
    # A format change would show up as every row the wrong width; say so rather
    # than returning an empty list that reads as a quiet world.
    if rows and bad > rows * 0.2:
        return None, None, f'{bad} of {rows} rows malformed - GDELT export format may have changed'
    out = []
    for s in spots.values():
        if len(s['domains']) < 3:
            continue
        top = sorted(s['urls'].items(), key=lambda kv: -kv[1])[:2]
        out.append({'place': s['place'], 'country': s['country'], 'lat': s['lat'], 'lon': s['lon'],
                    'events': s['events'], 'outlets': len(s['domains']), 'mentions': s['mentions'],
                    'what': [k for k, _ in s['what'].most_common(2)],
                    'urls': [u for u, _ in top]})
    out.sort(key=lambda s: (-s['outlets'], -s['events']))
    meta = {'slices': len(got), 'asked': len(urls), 'rows': rows, 'conflict_rows': kept,
            'hotspots': len(out), 'latest': latest.strftime('%Y-%m-%d %H:%M UTC')}
    print(f"  gdelt: {len(got)}/{len(urls)} slices, {rows} rows, {kept} armed-conflict events, "
          f"{len(out)} hotspots with 3+ outlets")
    return out[:30], meta, None


# The wire. Every web_search costs money, and most of what the model paid to
# find with them was headline-level: what happened, who reported it, when. That
# is exactly what an RSS feed publishes, for nothing. So the pipeline reads the
# outlets' own feeds before the model starts, and the model's paid searches go
# where no feed reaches -- X, and the detail behind a lead. A feed that fails is
# skipped and named; the brief never depends on any one of them.
WIRE_FEEDS = [
    # (label, desk, url)
    ('BBC', 'world', 'https://feeds.bbci.co.uk/news/world/rss.xml'),
    ('Al Jazeera', 'world', 'https://www.aljazeera.com/xml/rss/all.xml'),
    ('Guardian', 'world', 'https://www.theguardian.com/world/rss'),
    ('DW', 'world', 'https://rss.dw.com/rdf/rss-en-world'),
    ('France 24', 'world', 'https://www.france24.com/en/rss'),
    ('NPR', 'world', 'https://feeds.npr.org/1004/rss.xml'),
    ('Kyiv Independent', 'europe', 'https://kyivindependent.com/news-archive/rss/'),
    # ISW and Times of Israel answer a runner with 403; these carry the same beats.
    ('Ukrainska Pravda', 'europe', 'https://www.pravda.com.ua/eng/rss/'),
    ('Middle East Eye', 'mideast', 'https://www.middleeasteye.net/rss'),
    ('Jerusalem Post', 'mideast', 'https://www.jpost.com/rss/rssfeedsfrontpage.aspx'),
    ('The Diplomat', 'indopac', 'https://thediplomat.com/feed/'),
    ('NK News', 'indopac', 'https://www.nknews.org/feed/'),
    ('Taipei Times', 'indopac', 'https://www.taipeitimes.com/xml/index.rss'),
    ('Africanews', 'africa', 'https://www.africanews.com/feed/rss'),
    ('USNI News', 'defense', 'https://news.usni.org/feed'),
    ('The War Zone', 'defense', 'https://www.twz.com/feed'),
    ('Breaking Defense', 'defense', 'https://breakingdefense.com/feed/'),
    ('Defense News', 'defense', 'https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml'),
    ('gCaptain', 'maritime', 'https://gcaptain.com/feed/'),
    ('SpaceNews', 'space', 'https://spacenews.com/feed/'),
    ('BleepingComputer', 'cyber', 'https://www.bleepingcomputer.com/feed/'),
    ('The Record', 'cyber', 'https://therecord.media/feed'),
    ('Krebs', 'cyber', 'https://krebsonsecurity.com/feed/'),
    ('CISA advisories', 'cyber', 'https://www.cisa.gov/cybersecurity-advisories/all.xml'),
    ('NPR US', 'homeland', 'https://feeds.npr.org/1003/rss.xml'),
    # One request for all four subreddits: four in parallel drew HTTP 429 on all
    # but the first. Each post is labelled with its own subreddit from the feed.
    # If Reddit refuses the runner, the brief says so and moves on -- it is not
    # worth a paid search per subreddit to get around it.
    ('Reddit', 'reddit', 'https://www.reddit.com/r/CredibleDefense+geopolitics+'
                         'UkraineWarVideoReport+LessCredibleDefence/new/.rss?limit=50'),
]
WIRE_KEV = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json'
WIRE_KEV_PAGE = 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog'
WIRE_PER_FEED = 8        # newest items kept from any one feed
WIRE_MAX = 70            # lines handed to the model (~4k tokens, a fraction of one search)
WIRE_DESKS = [('europe', 'EUROPE / RUSSIA-UKRAINE'), ('mideast', 'MIDDLE EAST'),
              ('indopac', 'INDO-PACIFIC'), ('africa', 'AFRICA'), ('world', 'WORLD DESKS'),
              ('defense', 'DEFENCE'), ('maritime', 'MARITIME'), ('space', 'SPACE'),
              ('cyber', 'CYBER'), ('homeland', 'US HOMELAND'), ('reddit', 'REDDIT')]
_TAG = re.compile(r'<[^>]+>')
_WORD = re.compile(r'[a-z0-9]+')
_STOP = set('the a an of in on to for and or at by with from as is are was were be after '
            'over into amid says said new its his her their it this that than up out'.split())


def _local(tag):
    return tag.rsplit('}', 1)[-1].lower()


def _wire_time(s):
    s = (s or '').strip()
    if not s:
        return None
    try:
        from email.utils import parsedate_to_datetime
        t = parsedate_to_datetime(s)
    except Exception:
        try:
            t = datetime.fromisoformat(s.replace('Z', '+00:00'))
        except Exception:
            return None
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return t.astimezone(timezone.utc)


def _wire_text(s, n):
    s = unescape(_TAG.sub(' ', unescape(s or '')))
    s = ' '.join(s.split())
    return s if len(s) <= n else s[:n - 1].rsplit(' ', 1)[0] + '…'


def parse_feed(xml_bytes):
    """RSS 2.0, RSS 1.0 (RDF) or Atom -> [{title, url, time, summary}]."""
    import xml.etree.ElementTree as ET
    root = ET.fromstring(xml_bytes)
    out = []
    for el in root.iter():
        if _local(el.tag) not in ('item', 'entry'):
            continue
        f = {'title': '', 'url': '', 'time': None, 'summary': '', 'cat': ''}
        for ch in el:
            k = _local(ch.tag)
            if k == 'category' and ch.get('term') and not f['cat']:
                f['cat'] = ch.get('term')
            elif k == 'title':
                f['title'] = _wire_text(''.join(ch.itertext()), 180)
            elif k == 'link':
                href = ch.get('href')
                if href and ch.get('rel', 'alternate') == 'alternate':
                    f['url'] = href
                elif not href and (ch.text or '').strip():
                    f['url'] = ch.text.strip()
            elif k in ('pubdate', 'published', 'updated', 'date') and not f['time']:
                f['time'] = _wire_time(ch.text)
            elif k in ('description', 'summary', 'content') and not f['summary']:
                f['summary'] = _wire_text(''.join(ch.itertext()), 150)
        # Feed content is someone else's: a link that is not plain http(s) could
        # run script when the page renders it, so it never gets that far.
        if f['title'] and re.match(r'https?://', f['url'] or '', re.I):
            out.append(f)
    return out


def _wire_one(label, url, since):
    r = requests.get(url, timeout=12, headers={
        'User-Agent': 'TridentBrief/1.0 (+https://github.com/TridentIntelFree/Trident-Brief)',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml'})
    if r.status_code != 200:
        raise RuntimeError(f'HTTP {r.status_code}')
    items = [i for i in parse_feed(r.content) if i['time'] and i['time'] >= since]
    items.sort(key=lambda i: i['time'], reverse=True)
    # The combined subreddit feed is four feeds in one, so it gets four shares.
    return items[:WIRE_PER_FEED * (4 if label == 'Reddit' else 1)]


def _wire_kev(since_days=3):
    d = _get(WIRE_KEV, timeout=20)
    cut = (datetime.now(timezone.utc) - timedelta(days=since_days)).date().isoformat()
    out = []
    for v in d.get('vulnerabilities') or []:
        if str(v.get('dateAdded', '')) >= cut:
            ransom = ' | used in ransomware' if str(v.get('knownRansomwareCampaignUse', '')).lower() == 'known' else ''
            out.append({'title': f"KEV added {v.get('dateAdded')}: {v.get('cveID')} "
                                 f"{v.get('vendorProject', '')} {v.get('product', '')} - "
                                 f"{v.get('vulnerabilityName', '')}{ransom}",
                        'url': WIRE_KEV_PAGE, 'time': None, 'summary': ''})
    return out


def _wire_key(title):
    return frozenset(w for w in _WORD.findall(title.lower()) if w not in _STOP and len(w) > 2)


def fetch_wire(hours):
    """Headlines from the outlets' own feeds, inside the window. Costs nothing.

    Returns (items, detail) where detail maps each feed to its count or its error.
    Stories carried by several outlets are merged into one line naming all of them.
    """
    from concurrent.futures import ThreadPoolExecutor
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    detail, got = {}, []

    def run(feed):
        label, desk, url = feed
        try:
            return feed, _wire_one(label, url, since), None
        except Exception as e:
            return feed, None, str(e)[:80]

    with ThreadPoolExecutor(max_workers=10) as ex:
        for (label, desk, url), items, err in ex.map(run, WIRE_FEEDS):
            if items is None:
                detail[label] = 'ERR ' + err
                continue
            detail[label] = len(items)
            for i in items:
                src = f"r/{i['cat']}" if desk == 'reddit' and i.get('cat') else label
                i.update(src=[src], desk=desk)
                got.append(i)
    try:
        kev = _wire_kev()
        detail['CISA KEV'] = len(kev)
        for i in kev:
            i.update(src=['CISA KEV'], desk='cyber')
        got = kev + got
    except Exception as e:
        detail['CISA KEV'] = 'ERR ' + str(e)[:80]

    # One story, several outlets: merge on shared headline words. Corroboration
    # across outlets is itself worth showing, and it saves the duplicate lines.
    merged = []
    for i in got:
        k = _wire_key(i['title'])
        hit = None
        if i['desk'] != 'reddit' and len(k) >= 4:
            for m in merged:
                if m['desk'] != 'reddit' and len(k & m['key']) / max(1, len(k | m['key'])) >= 0.5:
                    hit = m
                    break
        if hit:
            if i['src'][0] not in hit['src']:
                hit['src'].append(i['src'][0])
            continue
        i['key'] = k
        merged.append(i)
    for m in merged:
        m.pop('key', None)
    return merged, detail


def wire_for_page(items, cap=160):
    """The headlines in the page's own compact shape, newest first."""
    rows = sorted(items, key=lambda i: (i['time'] or datetime.min.replace(tzinfo=timezone.utc)),
                  reverse=True)
    out = []
    for i in rows[:cap]:
        r = {'s': i['src'], 'd': i['desk'], 't': i['title'], 'u': i['url']}
        if i['time']:
            r['at'] = i['time'].strftime('%Y-%m-%dT%H:%M:%SZ')
        if i.get('summary') and i['desk'] != 'reddit':
            r['m'] = i['summary']
        out.append(r)
    return out


def wire_lines(items, cap=WIRE_MAX):
    """Group by desk, most-corroborated first, and fit the cap fairly across desks."""
    by = {d: [] for d, _ in WIRE_DESKS}
    for i in items:
        by.setdefault(i['desk'], []).append(i)
    for d in by:
        by[d].sort(key=lambda i: (-len(i['src']), -(i['time'] or datetime.max.replace(
            tzinfo=timezone.utc)).timestamp()))
    # Round-robin so one busy desk cannot crowd out a quiet theatre's only story.
    keep, rank = {d: [] for d in by}, 0
    while sum(len(v) for v in keep.values()) < cap:
        moved = False
        for d in by:
            if rank < len(by[d]) and sum(len(v) for v in keep.values()) < cap:
                keep[d].append(by[d][rank])
                moved = True
        if not moved:
            break
        rank += 1
    out = []
    for d, name in WIRE_DESKS:
        if not keep.get(d):
            continue
        out.append(f'{name}:')
        for i in keep[d]:
            when = i['time'].strftime('%d %b %H:%MZ') if i['time'] else ''
            src = ', '.join(i['src'])
            summ = f" -- {i['summary']}" if i['summary'] and i['desk'] != 'reddit' else ''
            title = i['title'].replace('[', '(').replace(']', ')')
            out.append(f"- {src}{' (' + when + ')' if when else ''}: [{title}]({i['url']}){summ}")
    return out


def fetch_primary_leads(hours, wire_hours=None):
    leads, errors = {}, {}
    nw, err = fetch_navwarnings()
    if nw is None:
        errors['navwarn'] = err
        print(f"  navwarn failed: {err}")
    else:
        leads['navwarn'] = nw
    gd, meta, err = fetch_gdelt(hours)
    if gd is None:
        errors['gdelt'] = err
        print(f"  gdelt failed: {err}")
    else:
        leads['gdelt'] = gd
        leads['gdelt_meta'] = meta
    try:
        wire, detail = fetch_wire(wire_hours or hours)
        leads['wire'], leads['wire_detail'] = wire, detail
        bad = [k for k, v in detail.items() if isinstance(v, str)]
        print(f"  wire: {len(wire)} stories from {len(detail) - len(bad)}/{len(detail)} feeds"
              + (f"; failed: {', '.join(bad)}" if bad else ''))
    except Exception as e:
        errors['wire'] = str(e)[:160]
        print(f"  wire failed: {e}")
    leads['errors'] = errors
    return leads


def leads_block(leads, hours):
    """The primary-source leads as prompt text, with what to do about each kind."""
    if not leads:
        return ''
    errs = leads.get('errors') or {}
    out = ['=== PRIMARY-SOURCE LEADS (collected by the pipeline before you started) ===',
           'These did not come from a search, so they are not biased toward what is already',
           'in the news - which is the point of them. Work them: each one is either carried',
           'in the brief or knowingly passed over, and the difference is recorded below.', '']
    nw = leads.get('navwarn')
    out.append('MARITIME NAVIGATIONAL WARNINGS - NGA, issued in the last 45 days, filtered to military, '
               'launch and hazard, newest first:')
    if nw:
        for w in nw[:25]:
            pos = f"{abs(w['lat']):.1f}{'N' if w['lat'] >= 0 else 'S'} {abs(w['lon']):.1f}" \
                  f"{'E' if w['lon'] >= 0 else 'W'}" if 'lat' in w else 'no position'
            age = f" ({w['age_days']}d ago)" if w.get('age_days') is not None else ''
            out.append(f"- {w['id']} | {w['kind']} | issued {w['issued'] or '?'}{age} | {pos} | "
                       f"{w['text'][:260]}")
        out += ['',
                'A navigational warning is an official publication the pipeline retrieved this run,',
                'so it IS a source for its own contents: a declared missile-firing or rocket-debris',
                'area is a fact about what a government announced. Report one tagged',
                f'[SIGINT - VERIFIED], cite it by its ID, and link {NAVWARN_PAGE} . It is NOT a',
                'source for anything beyond its text - that a test happened, who ran it or why -',
                'which needs its own retrieved source under Rule 1. The ones that matter are the',
                'ones whose area, timing or issuing authority lines up with something in the',
                'theatres; routine gunnery off a home port does not.']
    elif 'navwarn' in errs:
        out.append(f"- unavailable this run ({str(errs['navwarn'])[:100]}). Do not treat this as")
        out.append('  "no warnings": it means none were collected.')
    else:
        out.append('- none active in these categories.')
    out.append('')
    gd = leads.get('gdelt')
    out.append(f'GDELT ARMED-CONFLICT HOTSPOTS - last {hours}h, places reported by 3+ separate outlets:')
    if gd:
        for s in gd[:20]:
            pos = f"{abs(s['lat']):.2f}{'N' if s['lat'] >= 0 else 'S'} {abs(s['lon']):.2f}" \
                  f"{'E' if s['lon'] >= 0 else 'W'}"
            out.append(f"- {s['place']} ({pos}): {s['events']} events, {s['outlets']} outlets | "
                       f"{', '.join(s['what'])} | e.g. {' '.join(s['urls'])}")
        out += ['',
                'GDELT is machine-coded from news by software, not read by anyone. It miscodes',
                'constantly - a "fight" over a budget, a film review, an anniversary of a battle.',
                'It is NEVER a source: never cite GDELT, and never report one of these places on',
                'the strength of this list. Use it as a map of where to search. For each hotspot',
                'in a theatre you cover, search the place by name; if real reporting comes back,',
                'report THAT source normally. A hotspot you searched and could not substantiate',
                'belongs in Collection Gaps as exactly that. A cluster with no western wire',
                'coverage is the most valuable kind: it is what the press review would miss.']
    elif 'gdelt' in errs:
        out.append(f"- unavailable this run ({str(errs['gdelt'])[:100]}).")
    else:
        out.append('- none cleared the three-outlet bar.')
    out.append('')
    wire = leads.get('wire') or []
    if wire:
        detail = leads.get('wire_detail') or {}
        down = [k for k, v in detail.items() if isinstance(v, str)]
        reddit_ok = isinstance(detail.get('Reddit'), int)
        out += [f'HEADLINES - last {hours}h, read from the outlets\' own feeds by the pipeline, free:',
                *wire_lines(wire),
                '',
                'The pipeline retrieved these this run, so each IS a retrieved source for what its',
                'headline and summary say: cite it as the outlet, tagged [OSINT - WEB], by copying',
                'ITS markdown link exactly. Several outlets on one line means several reported it -',
                'that is corroboration. For anything beyond the headline, search.',
                'LINKS: every item carries its own link. Never put one item\'s link on another item,',
                'and never number links as footnotes - the first 1.3.0 run hung the same X post on a',
                'CISA advisory and a Supreme Court ruling. An item with no link of its own gets none.',
                'QUIET: before calling a theatre quiet, check every desk above for it, WORLD DESKS',
                'included. A theatre with a headline in the window is not quiet - carry the headline.',
                'This list is the web half of the sweep, already done. Do not spend a web_search',
                'finding a story that is here; spend it on detail, confirmation, or a lead with no',
                'headline.' + (f' Feeds that failed this run: {", ".join(down)}.' if down else ''),
                ('REDDIT lines are the newest posts in those subreddits: titles only, unverified,'
                 ' tagged [OSINT - SOCIAL] if carried.' if reddit_ok else
                 'Reddit refused the pipeline this run. Say so in one line in Section 1; do not'
                 ' spend searches working around it.'),
                '']
    if not (nw or gd):
        return '\n'.join(out) + '\n'
    out += ['',
            'Close Section 2 with ONE line, after the last theatre: "leads worked: " then how',
            'many warnings you carried and how many you passed over, and which hotspots you',
            'searched, carried, or could not substantiate. Like the "searched:" line in Section',
            '1, this exists so a skipped step is visible rather than silent.', '']
    return '\n'.join(out)


# ------------------------------------------------------------ appalachia ----
# Appalachistan: the Appalachian Trail and what is along it, for a map that has
# to keep working with no signal. Built from OpenStreetMap through Overpass once
# a month and otherwise read back from the copy already on the live site, so
# the half-hourly refresh does not re-query Overpass every thirty minutes.
APP_FILE = 'assets/appalachia.json'
APP_VERSION = 1
APP_MAX_AGE_DAYS = 30
OVERPASS = ['https://overpass-api.de/api/interpreter',
            'https://overpass.kumi.systems/api/interpreter',
            'https://overpass.private.coffee/api/interpreter']
# One request for the whole trail and everything near it timed out on every
# public Overpass server (HTTP 504, 25 Sep). So the trail is fetched the way it
# is mapped: find the relation and its section relations with two tiny queries,
# then each section's line and nearby points in a request of its own.
APP_FIND_Q = """[out:json][timeout:60];
rel["route"="hiking"]["name"~"^Appalachian (National Scenic )?Trail"]["name"!~"International"];
out ids tags;"""
APP_KIDS_Q = """[out:json][timeout:60];
rel(id:{ids});
rel(r)["route"="hiking"];
out ids tags;"""
APP_LINE_Q = """[out:json][timeout:120];
rel({rid});
way(r);
out geom qt;"""
APP_POI_Q = """[out:json][timeout:150];
rel({rid});
way(r)->.w;
(
  nwr(around.w:1200)["amenity"="shelter"];
  nwr(around.w:1200)["tourism"~"^(wilderness_hut|alpine_hut|camp_site)$"];
  node(around.w:500)["amenity"="drinking_water"];
  node(around.w:500)["natural"="spring"];
  node(around.w:800)["natural"="peak"]["name"];
  node(around.w:600)["tourism"="viewpoint"];
  nwr(around.w:1200)["highway"="trailhead"];
  node(around.w:1200)["waterway"="waterfall"];
  node(around.w:5000)["place"~"^(town|village)$"];
);
out center tags qt;"""
APP_AT_RELATION = 156553   # OpenStreetMap's Appalachian Trail relation


def _poi_kind(t):
    if t.get('amenity') == 'shelter' or t.get('tourism') in ('wilderness_hut', 'alpine_hut'):
        return 'shelter'
    if t.get('tourism') == 'camp_site':
        return 'camp'
    if t.get('amenity') == 'drinking_water' or t.get('natural') == 'spring':
        return 'water'
    if t.get('natural') == 'peak':
        return 'peak'
    if t.get('tourism') == 'viewpoint':
        return 'view'
    if t.get('highway') == 'trailhead':
        return 'trailhead'
    if t.get('waterway') == 'waterfall':
        return 'falls'
    if t.get('place') in ('town', 'village'):
        return 'town'
    return None


APP_BUDGET_S = 3600          # the whole trail build, in its own job
_APP_T0 = [None]
_OVERPASS_BAD = {}


def _overpass(q, timeout=120):
    last = 'no server tried'
    if _APP_T0[0] and time.time() - _APP_T0[0] > APP_BUDGET_S:
        return None, 'time budget spent'
    for url in OVERPASS:
        if _OVERPASS_BAD.get(url, 0) >= 2:
            continue                   # this server has failed twice this run
        try:
            r = requests.post(url, data={'data': q}, timeout=timeout,
                              headers={'User-Agent': 'TridentBrief/1.0 (+https://github.com/TridentIntelFree/Trident-Brief)'})
            if r.status_code == 200:
                _OVERPASS_BAD[url] = 0
                return r.json(), None
            last = f'{url.split("/")[2]} HTTP {r.status_code}'
        except Exception as e:
            last = f'{url.split("/")[2]} {str(e)[:80]}'
        _OVERPASS_BAD[url] = _OVERPASS_BAD.get(url, 0) + 1
        print(f"    overpass: {last}")
    return None, last


def _m(a, b):
    return _km(a[0], a[1], b[0], b[1]) * 1000.0


def _rdp(pts, tol_m):
    """Douglas-Peucker in a local flat projection; keeps the ends."""
    if len(pts) < 3:
        return pts
    lat0 = math.radians(sum(p[0] for p in pts) / len(pts))
    kx, ky = 111320.0 * math.cos(lat0), 110540.0
    xy = [(p[1] * kx, p[0] * ky) for p in pts]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        (x1, y1), (x2, y2) = xy[i], xy[j]
        dx, dy = x2 - x1, y2 - y1
        L = dx * dx + dy * dy
        best, bk = -1.0, -1
        for k in range(i + 1, j):
            x, y = xy[k]
            if L == 0:
                d = (x - x1) ** 2 + (y - y1) ** 2
            else:
                t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / L))
                d = (x - x1 - t * dx) ** 2 + (y - y1 - t * dy) ** 2
            if d > best:
                best, bk = d, k
        if bk > 0 and best > tol_m * tol_m:
            keep[bk] = True
            stack += [(i, bk), (bk, j)]
    return [p for p, k in zip(pts, keep) if k]


def _enc(pts):
    """[[lat,lon],...] -> flat delta-coded ints at 1e-5 degrees (~1 m)."""
    out, pl, pn = [], 0, 0
    for la, lo in pts:
        a, b = round(la * 1e5), round(lo * 1e5)
        out += [a - pl, b - pn]
        pl, pn = a, b
    return out


def _at_path(ways):
    """Order the trail from Springer to Katahdin as the shortest route through the
    relation's ways, so every point along it has a trail mile. Alternates and
    side routes in the relation fall off the shortest path by themselves."""
    import heapq
    adj, geo = {}, {}
    for w in ways:
        n, g = w.get('nodes') or [], w.get('geometry') or []
        if len(n) < 2 or len(n) != len(g):
            continue
        pts = [(p['lat'], p['lon']) for p in g]
        L = sum(_m(pts[i - 1], pts[i]) for i in range(1, len(pts)))
        geo[n[0]], geo[n[-1]] = pts[0], pts[-1]
        adj.setdefault(n[0], []).append((n[-1], L, pts))
        adj.setdefault(n[-1], []).append((n[0], L, pts[::-1]))
    if not adj:
        return None
    # Bridge small breaks: two dangling ends within 300 m that OpenStreetMap
    # does not join (a river ford, a ferry, a mapping gap) are one trail. A
    # longer break is left alone -- the length check below catches that.
    cell = {}
    for k, (la, lo) in geo.items():
        cell.setdefault((int(la * 200), int(lo * 200)), []).append(k)
    dangling = [k for k in adj if len(adj[k]) == 1]
    for k in dangling:
        la, lo = geo[k]
        best, bk = 300.0, None
        cx, cy = int(la * 200), int(lo * 200)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for o in cell.get((cx + dx, cy + dy), []):
                    if o == k or any(v == o for v, _, _ in adj[k]):
                        continue
                    d = _m(geo[k], geo[o])
                    if d < best:
                        best, bk = d, o
        if bk is not None:
            adj[k].append((bk, best, [geo[k], geo[bk]]))
            adj[bk].append((k, best, [geo[bk], geo[k]]))
    start = min(adj, key=lambda k: geo[k][0])          # southern terminus
    dist, prev = {start: 0.0}, {}
    pq = [(0.0, start)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist.get(u, 1e18):
            continue
        for v, L, pts in adj[u]:
            if d + L < dist.get(v, 1e18):
                dist[v], prev[v] = d + L, (u, pts)
                heapq.heappush(pq, (d + L, v))
    end = max(dist, key=lambda k: dist[k])
    chain, v = [], end
    while v in prev:
        u, pts = prev[v]
        chain.append(pts)
        v = u
    path = []
    for pts in reversed(chain):
        path += pts if not path else pts[1:]
    return path, dist[end] / 1609.344


def _app_sections():
    """Every relation that makes up the trail: the top one and its descendants."""
    found, err = _overpass(APP_FIND_Q, timeout=90)
    # The name search scans every hiking route on Earth; if that is what the
    # server refuses, start from the trail's own relation instead.
    level = [e['id'] for e in (found or {}).get('elements', []) if e.get('type') == 'relation'] or [APP_AT_RELATION]
    if found is None:
        print(f"  appalachia: name search failed ({err}); starting from relation {APP_AT_RELATION}")
    rels, depth = list(level), 0
    while level and depth < 3:
        time.sleep(2)
        kids, err = _overpass(APP_KIDS_Q.format(ids=','.join(map(str, level))), timeout=90)
        if kids is None:
            break                      # the parents alone still carry their own ways
        level = [e['id'] for e in kids.get('elements', []) if e.get('type') == 'relation' and e['id'] not in rels]
        rels += level
        depth += 1
    return (rels, None) if rels else (None, 'no Appalachian Trail relation found')


def build_appalachia():
    t0 = time.time()
    _APP_T0[0] = t0
    rels, err = _app_sections()
    if rels is None:
        return None, 'finding the trail: ' + err
    ways, have, failed, with_ways = [], set(), [], []
    for rid in rels:
        time.sleep(2)
        got, err = _overpass(APP_LINE_Q.format(rid=rid))
        if got is None:
            failed.append(rid)
            continue
        n = 0
        for e in got.get('elements', []):
            if e.get('type') == 'way' and e.get('geometry') and e['id'] not in have:
                have.add(e['id'])
                ways.append(e)
                n += 1
        if n:
            with_ways.append(rid)
    print(f"  appalachia: {len(rels)} relations, {len(with_ways)} with ways, {len(ways)} ways"
          + (f", {len(failed)} failed" if failed else ''))
    if len(ways) < 50:
        return None, f'trail line: only {len(ways)} ways came back' + (f' ({len(failed)} sections failed)' if failed else '')
    segs, npts = [], 0
    for w in ways:
        pts = _rdp([(p['lat'], p['lon']) for p in w['geometry']], 8)
        npts += len(pts)
        segs.append(_enc(pts))
    out = {'v': APP_VERSION, 'built_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
           'source': 'OpenStreetMap contributors (ODbL), via Overpass',
           'ways': len(ways), 'segs': segs, 'pois': []}
    pp = _at_path(ways)
    cum = None
    if pp:
        path, miles = pp
        out['path_mi'] = round(miles, 1)
        # Only claim trail miles when the route came out close to the real
        # trail's length; a relation with a gap gives a path that stops short.
        if 2050 <= miles <= 2350:
            coarse = _rdp(path, 25)
            out['path'] = _enc(coarse)
            cum, c = [0.0], 0.0
            for i in range(1, len(coarse)):
                c += _m(coarse[i - 1], coarse[i]) / 1609.344
                cum.append(c)
            path_pts = coarse
        print(f"  appalachia: shortest route {miles:.0f} mi "
              f"({'miles kept' if cum else 'outside 2050-2350, miles not published'})")

    seen, poi_failed = set(), []
    for rid in with_ways:
        time.sleep(2)
        pois, perr = _overpass(APP_POI_Q.format(rid=rid))
        if pois is None:
            poi_failed.append(rid)
            continue
        for e in pois.get('elements', []):
            t = e.get('tags') or {}
            k = _poi_kind(t)
            la = e.get('lat', (e.get('center') or {}).get('lat'))
            lo = e.get('lon', (e.get('center') or {}).get('lon'))
            if not k or la is None or lo is None:
                continue
            name = (t.get('name') or '').strip()[:60]
            key = (k, round(la, 4), round(lo, 4))
            if key in seen:
                continue
            seen.add(key)
            row = [round(la, 5), round(lo, 5), k, name]
            mile = None
            if cum:
                # nearest vertex of the ordered route -- good to a few hundred metres
                best, bi = 1e18, 0
                for i in range(0, len(path_pts)):
                    q = path_pts[i]
                    d = (q[0] - la) ** 2 + ((q[1] - lo) * math.cos(math.radians(la))) ** 2
                    if d < best:
                        best, bi = d, i
                mile = round(cum[bi], 1)
            row.append(mile)
            ele = re.match(r'^\s*(-?\d+(?:\.\d+)?)', str(t.get('ele') or ''))
            row.append(round(float(ele.group(1))) if ele else None)
            out['pois'].append(row)
    # Complete means every section's line and points came back and the route
    # measured as the whole trail; anything less is rebuilt the next day.
    out['complete'] = not failed and not poi_failed and cum is not None
    if failed or poi_failed:
        out['missing'] = {'line': failed, 'pois': poi_failed}
    kinds = {}
    for r in out['pois']:
        kinds[r[2]] = kinds.get(r[2], 0) + 1
    print(f"  appalachia: built in {time.time() - t0:.0f}s - {len(ways)} ways, {npts} points, "
          f"POIs {kinds}{'' if out['complete'] else ' (incomplete, retried tomorrow)'}")
    return out, None


def appalachia_status():
    """What trail data this deploy carries, for feed-status. Reads the committed
    file only: the half-hourly refresh never queries Overpass."""
    try:
        with open(APP_FILE, encoding='utf-8') as f:
            d = json.load(f)
    except Exception:
        return None
    return {'built_at': d.get('built_at'), 'complete': d.get('complete'), 'ways': d.get('ways'),
            'pois': len(d.get('pois') or []), 'path_mi': d.get('path_mi'),
            'kb': os.path.getsize(APP_FILE) // 1024}


def build_trail_data():
    """--trail-data: rebuild assets/appalachia.json from Overpass, in its own job.

    The first attempt ran inside the half-hourly feed refresh and held the site
    deploy for a quarter of an hour while Overpass was slow. The trail is
    static, so it is now built weekly by .github/workflows/trail-data.yml and
    committed; every deploy then carries the committed file. A complete build
    less than APP_MAX_AGE_DAYS old is left alone, and a new build replaces the
    old one only if it is at least as complete."""
    old = None
    try:
        with open(APP_FILE, encoding='utf-8') as f:
            old = json.load(f)
    except Exception:
        pass
    if old and old.get('complete') and os.environ.get('TRAIL_FORCE') != '1':
        t = _wire_time(old.get('built_at'))
        if t and datetime.now(timezone.utc) - t < timedelta(days=APP_MAX_AGE_DAYS):
            print(f"Trail data is complete and recent (built {old.get('built_at')}); nothing to do.")
            return
    data, err = build_appalachia()
    if data is None:
        print(f"Trail data build failed: {err}")
        return
    if old and old.get('segs') and old.get('complete') and not data.get('complete'):
        print('New build is incomplete and the committed one is complete; keeping the committed one.')
        return
    os.makedirs('assets', exist_ok=True)
    with open(APP_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, separators=(',', ':'))
    print(f"Wrote {APP_FILE} ({os.path.getsize(APP_FILE) // 1024} KB), "
          f"{'complete' if data.get('complete') else 'incomplete: ' + json.dumps(data.get('missing'))}")


def fetch_server_feeds(leads=None):
    """Fetch the rate-limited / CORS-awkward feeds here instead of in the browser.

    These run on the Actions runner: no CORS, and the rate limit is not tied to
    each visitor's IP. Any feed that fails is simply absent; the page degrades.
    """
    feeds = {}

    errors = {}

    # A full run collected these before writing the prompt; a feeds-only run
    # fetches a short window of its own, which is also what exercises both
    # collectors every half hour without spending anything on the model.
    if leads is None:
        # The headline panel on the page shows the whole collection window, so
        # the wire keeps it even on the short-window feeds-only run.
        leads = fetch_primary_leads(LEAD_REFRESH_HOURS, wire_hours=WINDOW_HOURS)
    for k in ('navwarn', 'gdelt', 'gdelt_meta', 'wire_detail'):
        if k in leads:
            feeds[k] = leads[k]
    if leads.get('wire'):
        feeds['wire'] = wire_for_page(leads['wire'])
    errors.update(leads.get('errors') or {})

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
        if LAST_GPSJAM:
            feeds['gpsjam'] = LAST_GPSJAM

    sats, err = fetch_skywatch()
    if sats is None:
        errors['sats'] = err
        print(f"  skywatch failed: {err}")
    else:
        feeds['satcounts'] = sats

    feeds['appalachia'] = appalachia_status()

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
    for k in ('quakes', 'launches', 'alerts', 'disasters', 'vessels', 'navwarn', 'gdelt'):
        counts[k] = len(feeds[k]) if isinstance(feeds.get(k), list) else None
    counts['gdelt_detail'] = feeds.get('gdelt_meta')
    counts['wire'] = len(feeds['wire']) if isinstance(feeds.get('wire'), list) else None
    counts['wire_detail'] = feeds.get('wire_detail')
    counts['aircraft'] = feeds.get('aircount')
    counts['appalachia'] = feeds.get('appalachia')
    gj = feeds.get('gpsjam') or {}
    counts['gpsjam'] = {k: gj.get(k) for k in ('runs', 'checked', 'cells_seen')} | \
        {'flagged': len(gj.get('cells') or [])} if gj else None
    counts['satellites'] = feeds.get('satcounts')
    # Which basemap actually reached the page. The globe silently degrades to the
    # older, lower-contrast three.js texture if the Blue Marble mirror is down,
    # and that degradation is invisible from the Actions log unless it is stated.
    gfx = {}
    for name in ('earth_day.jpg', 'earth_night.png', 'three.module.js'):
        path = os.path.join('assets', name)
        gfx[name] = (os.path.getsize(path) // 1024 if os.path.exists(path) else None)
    status = {'version': VERSION,
              'fetched_at': feeds.get('fetched_at'),
              'collected': counts,
              'assets_kb': gfx,
              'collection': LAST_TOOL_USE or None,
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


def brief_quality(content, prior_n=0):
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
        if _CLOSING.match(line):
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
        print("  note: no Reddit sourcing (Reddit now comes from the headline feeds, when reachable)")
    # One link on several different items means the citations were numbered or
    # copied, not attached: the reader follows it and finds another story.
    reused = {u: n for u, n in ((u, urls.count(u)) for u in set(urls)) if n > 2}
    if reused:
        print("  WARNING: same link cited on several items - " +
              '; '.join(f'{n}x {u[:70]}' for u, n in reused.items()))
    u = (LAST_TOOL_USE or {}).get('usage') or {}
    if isinstance(u.get('num_server_side_tools_used'), int):
        n = u['num_server_side_tools_used']
        print(f"  searches: {n} against a budget of {SEARCH_BUDGET}"
              + (" - OVER BUDGET" if n > SEARCH_BUDGET + 2 else ''))
    if reported and not re.search(r'^\s*searched:', content, re.I | re.M):
        print("  note: Section 1 did not list the queries it ran")
    # A section called quiet without a searched: line inside it was not looked at.
    for m in re.finditer(r'^##\s*(\d)\.\s*([^\n]+)\n(.*?)(?=^##\s|\Z)', content, re.M | re.S):
        body = m.group(3)
        if m.group(1) not in ('1', '3', '4'):        # the sections told to show their queries
            continue
        if re.search(r'quiet in window', body, re.I) and not re.search(r'searched:', body, re.I):
            print(f"  WARNING: section {m.group(1)} ({m.group(2).strip()[:30]}) called quiet with no searches listed")
    if aggregators:
        print(f"  WARNING: {aggregators} citation(s) point at an aggregator, which Rule 1 bans")

    # Forecast accountability: did it score last run's calls, and does it make
    # calls that can be scored? A check line per prior indicator, and every new
    # indicator carrying one of the defined probability terms.
    verdicts = {}
    for item in closing_items(content, r'FORECAST CHECK'):
        m = re.search(r'\b(NOT TRIGGERED|TRIGGERED|OPEN|OVERTAKEN)\b', item, re.I)
        if m:
            v = m.group(1).upper()
            verdicts[v] = verdicts.get(v, 0) + 1
    checked = sum(verdicts.values())
    if prior_n:
        print(f"  forecast check: {checked}/{prior_n} prior calls scored - " +
              (', '.join(f'{k} {v}' for k, v in sorted(verdicts.items())) or 'none'))
        if checked < prior_n:
            print("  WARNING: not every prior indicator was scored")
        if checked >= 3 and len(verdicts) == 1:
            print("  note: every verdict is the same - the check may not have been done")
    wep = re.compile(r'almost no chance|very unlikely|\bunlikely\b|roughly even chance|'
                     r'\blikely\b|very likely|almost certain', re.I)
    iw = closing_items(content, r'INDICATORS')
    scored = sum(1 for i in iw if wep.search(i))
    hedges = len(re.findall(r'\b(could|may|might|possibly|potentially|probably)\b',
                            ' '.join(iw) + ' ' + ' '.join(
                                re.findall(r'\*\*Assessment[^*]*\*\*([^\n]*)', content)), re.I))
    conf = len(re.findall(r'\b(low|moderate|high) confidence\b|confidence[:\s]+(low|moderate|high)',
                          content, re.I))
    print(f"  estimative: {scored}/{len(iw)} indicators carry a probability term, "
          f"{conf} confidence statements, {hedges} unranged hedge words in judgements")
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


def render(content, provider, badge, timestamp, archive, events, feeds, stale=False, history=None,
           collected_at=None):
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

    # The page is re-rendered every half hour by the feeds-only job, so "now" is
    # when the feeds were refreshed, not when the brief was collected. The header
    # used to show the refresh time as the collection time and report "0m since
    # collection" on a brief eleven hours old. The two are now kept apart.
    try:
        coll = datetime.fromisoformat(collected_at) if collected_at else datetime.now(timezone.utc)
    except (TypeError, ValueError):
        coll = datetime.now(timezone.utc)
    if coll.tzinfo is None:
        coll = coll.replace(tzinfo=timezone.utc)
    subs = {
        '__TIMESTAMP__': escape(coll.strftime('%Y-%m-%d %H:%M UTC')),
        '__REFRESHED__': escape(datetime.now(timezone.utc).strftime('%H:%M UTC')),
        '__COLLECTED_AT_JSON__': js_json(coll.isoformat()),
        '__VERSION__': escape(VERSION),
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

    if '--trail-data' in sys.argv:
        build_trail_data()
        return

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
               index_archive(), cache.get('events', []), feeds, False, load_history(),
               collected_at=cache.get('generated_at'))
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
               index_archive(), events, cache.get('feeds', {}), True, load_history(),
               collected_at=cache.get('generated_at'))
        print('Re-rendered index.html from cache (offline mode)')
        return

    window_end = now
    window_start = now - timedelta(hours=WINDOW_HOURS)
    deep = deep_run(now)
    print(f"Collection depth: {'deep (all sections)' if deep else 'core (sections 1-2)'}")
    previous = load_cached_brief()
    prior = prior_indicators(previous)
    print(f"Prior indicators carried forward for checking: {len(prior)}")
    print("Collecting primary-source leads...")
    leads = fetch_primary_leads(WINDOW_HOURS)
    prompt = build_prompt(window_start, window_end, previous_digest(previous),
                          load_watchlist(), deep,
                          leads=leads_block(leads, WINDOW_HOURS),
                          forecasts=forecast_block(prior))

    stale = False
    print(f"Initiating collection, {WINDOW_HOURS}h window, Grok 4.1 + x_search + web_search...")
    content, error = generate_with_grok(prompt, since=window_start)

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
        feeds = fetch_server_feeds(leads)

    archive = write_archive(content, now)
    if not stale:
        brief_quality(content, len(prior))
    hist = update_history(events, (archive[0]['path'] if archive else ''), content, now) \
        if not stale else load_history()
    render(content, provider, badge, timestamp, archive, events, feeds, stale, hist,
           collected_at=(load_cache().get('generated_at') if stale else None))
    write_cache(content, provider, events, feeds)
    print(f"Brief generated successfully at {timestamp}")


if __name__ == '__main__':
    main()
