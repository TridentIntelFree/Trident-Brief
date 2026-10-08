# Trident-Brief

[![Generate Intelligence Brief](https://github.com/TridentIntelFree/Trident-Brief/actions/workflows/generate-brief.yml/badge.svg)](https://github.com/TridentIntelFree/Trident-Brief/actions/workflows/generate-brief.yml)

**The Trident Brief**, published by **Appalachian Intel** — an automated multi-INT fusion
brief published to GitHub Pages.

## What it does

A scheduled GitHub Action tasks Grok (with X search + web search) for a 24-hour
collection across four requirement areas — geopolitical/military, technology and
cybersecurity, UAP, and parapsychology/consciousness research — then renders the
result as a static page. Groq/Llama stands by as a fallback provider; if both are
unavailable the last good brief is re-published and flagged as cached.

Before the model starts, the collector also gathers primary-source leads it has
to work through: active maritime navigational warnings (missile firings,
rocket debris areas, live fire) from the UK Hydrographic Office (NAVAREA I),
the Japan Coast Guard (NAVAREA XI) and China's coastal maritime bureaus
(machine-translated), plus NGA whenever its frozen public feed comes back, and
GDELT armed-conflict hotspots. Each run also
scores the previous brief's indicators and warnings against what happened.

It also reads about 25 outlets' own RSS feeds (world desks, theatre outlets,
defence, maritime, space, cyber, US homeland; no Reddit, by choice) plus
CISA's Known Exploited Vulnerabilities list, and hands the model the headlines
from the collection window. Those cost nothing, so the model's paid searches go
to X and to detail rather than to finding stories a feed already had.

On the page, the same headlines appear in a WIRE panel that the half-hourly
feed refresh keeps current, with anything newer than the brief marked NEW. The
globe's GPS JAM layer marks where many aircraft at once report degraded GPS
accuracy (the gpsjam.org method, over a rolling six hours), and the terrain
panel shows the site's weather from Open-Meteo. None of these calls a model.

## Partner OSINT

`fetch_osint_partners()` in `generate_brief_final.py` reads three outside
sources on every collection and refresh:
- **situationmonitor's** structured events (its `data` branch);
- **tracker-data's** Telegram war-channel posts, tagged by lean and
  machine-translated to English by a free translator (no key, no Grok spend);
- **DeepStateMap's** front line via tracker-data, with the 7- and 30-day
  change in Russian-held area.

Where it goes:
- **Prompts:** the full set goes to the brief's leads and the Crystal Ball
  (`osint_lines`).
- **Page:** a trimmed set (`osint_for_page`) feeds the globe layers and the
  OSINT Feed section.

Everything is passed on as claims with source and lean.

## Area brief (owner only)

`area_brief.py`, run each morning by `.github/workflows/area-brief.yml`
(10:47 UTC, about 6:47 a.m. Eastern). It covers Tazewell County, Virginia
(24651): Tazewell, Richlands, Cedar Bluff and Bluefield, with Bluefield WV and
Mercer County.
- **Topics:** law enforcement and courts; fire, EMS and rescue; hazards,
  weather and roads; government and politics.
- **Free leads first:** NWS alerts for the county and its neighbours, and
  local headlines from Google News and the area's outlets. Grok then searches
  X and the web.
- **Secret:** only `GROK_API_KEY`, nothing else.
- **Output:** written to `data/area/tazewell.json`. The page shows it only
  through a hidden gesture; it is hidden, not locked.
- **Names and specifics:** police and court items carry names, charges, bond
  and court dates as the source reports them (`NAME_PRIVATE` in the script).
- **Testing sources:** run the workflow by hand with *dry run* ticked to see
  which free sources answer, without calling Grok.

## Analyst Desk (owner only)

`analyst_desk.py`, run each morning by `.github/workflows/analyst-desk.yml`
(12:13 UTC), using only `GROK_API_KEY`.
- **One budget-aware call:** Grok's X search is limited to up to 20 followed
  accounts and the last 48 hours. Grok is told the costs and given a budget of
  3 searches, and writes the box in the same call.
- **Finding accounts:** new accounts come from who the followed ones quote or
  credit. An open search for similar accounts runs on Sundays only. An
  account found on two days is followed from then on.
- **Output:** `data/analyst/desk.json` holds the box and the per-run cost
  breakdown; `data/analyst/roster.json` holds who is followed and found.
- **On the page:** shown only through a hidden gesture; it is hidden, not
  locked.

## Crystal Ball (owner only)

**Forecasts in four windows, scored.** Every morning there is a fresh 48-hour
set, a 7-day set weekly, a 30-day set monthly and a 12-month set quarterly:
about 8, 8, 8 and 12 questions. Every question names how it settles (a
source, a threshold, a deadline). Up to four forecasters answer, and each is
scored against its own baseline:
- **The engine** (`forecast_engine.py`, free). It answers questions on what
  the app measures over years: Ukraine's alarms, Israel's rocket alerts,
  Russia's claimed personnel and drone losses, and USGS quakes. It forecasts
  by analog: the fly brain (the Mushroom Body hash, a similarity search) finds
  the past days most like today, and what followed them is the forecast,
  shrunk toward the plain base rate. These questions settle themselves from
  the records.
- **The oracle** (Grok, one call). It answers the questions the records cannot,
  starting from base rates.
- **The fly.** For an oracle question, it reports how often the most similar
  past warnings came true. It answers only when it has at least four genuine
  precedents.
- **The crowd.** Open Polymarket questions on world affairs are put to the
  oracle without their price, and both are scored when the market settles.
  The biggest disagreements are shown only behind the small "hello" box at
  the top right. They are not shown in the Crystal Ball.

The ledger shows a Brier score per window and forecaster, against its
baseline, plus a calibration chart. Event questions are settled by a separate
small grading call with web search, comparing reported numbers with each
question's threshold.

`crystal_ball.py`, run each morning by `.github/workflows/crystal-ball.yml`
(12:43 UTC), using only `GROK_API_KEY`. It makes one reasoning call with no
searching, over:
- the latest brief and the live layers in `latest-brief.json`;
- the Analyst Desk's single-source and contested claims;
- a track record built from the archive: each brief's INDICATORS AND WARNINGS
  scored by the next brief's FORECAST CHECK;
- its own earlier forecasts.

What it writes:
- **`data/crystal/ball.json`:** forecasts with probabilities, pre-headline
  signals, the nuclear-risk read, the Doomsday Clock (read from
  thebulletin.org, with a fallback of 85 s), the scoreboard and the per-run
  cost.
- **`data/crystal/forecasts.json`:** every forecast and how it resolved.
- **`data/crystal/log.json`:** the daily indicator counts behind "rising
  against baseline".

The page shows it only through a hidden gesture; it is hidden, not locked.

**Its look is its own, on purpose.** Velvet, candlelight and gold lettering
replace the site's style. A 3D glass ball on a bronze stand (`assets/oracle.js`,
on the three.js the globe already loads) holds turning smoke and one glowing
orb per forecast; an orb's size and brightness follow its probability, and
touching it opens that forecast. There is also a brass Doomsday Clock.
"The heavens tonight" is a real sky read as astrology, for fun:
- **The sky:** positions for that moment, computed in the browser by
  [Astronomy Engine](https://github.com/cosinekitty/astronomy) (MIT, bundled
  as `assets/astronomy.min.js`).
- **What it shows:** a zodiac chart, the moon's phase, retrogrades and
  aspects.
- **The reading:** written from traditional meanings and labelled as forecasting
  nothing.

All of it is drawn on the device, with no model call and no cost per run, and
it sleeps while it is off screen.

**The professional reading** (`astro_lore.py`, after the Crystal Ball each
morning, written to `data/crystal/astro.json`) is mundane astrology, the
branch that reads nations and world events:
- **The sky:** dignities, stations, out-of-bounds planets, the lunar node and
  a void-of-course Moon.
- **National charts:** for the watch theatres, with what is crossing them now.
  Charts whose hour is uncertain leave out the Moon and the angles.
- **The last new moon:** set for each capital, with whole-sign houses.
- **A five-week almanac.**
- **The lore against the intel:** each configuration's traditional meaning and
  the day's intel are fingerprinted by the same fly-brain hash as the Mushroom
  Body, and the closest overlaps are shown.
- **The fair test:** astrology's own claims (an afflicted Mars brings war, full
  moons bring trouble, eclipses bring earthquakes) are checked weekly against
  years of records. Those are Ukraine's alarms, Israel's rocket alerts, Russia's
  claimed losses and USGS quakes. Each day is compared with its own month, the
  control is the same sky slid along the calendar, and the result is corrected
  for multiple claims. Its verdicts are printed whatever they are.
- **The reading:** a second, separate Grok call (about a cent, no searching)
  writes it from these computed facts only, so astrology never reaches the
  forecasts.

## Brief me

`assets/briefing.js` reads the brief aloud as a spoken briefing, using the
speech voices already on the device (Web Speech API): no key, no cost, nothing
uploaded, and it works offline once the page has loaded. The written brief is
turned into a script for the ear first:
- X handles, citation numbers and the collector's notes are left out;
- classification chips become words;
- times are read the military way;
- indicator lines become "watch for / that would mean / first sign /
  assessed".

There are two modes: the full brief, or key judgements (the bottom line,
assessments, forecast check and indicators). The player highlights the line
being read and has section skip, speed and voice controls.

## Indicators

`fetch_indicators()` reads six more open sources on every collection. They are
free, need no key and make no model call.
- **Air-raid alerts:**
  - Ukraine: Vadimkin/ukrainian-air-raid-sirens-dataset, volunteer data
    updated daily.
  - Israel: dleshem/israel-alerts-data, a commit per Home Front Command alert.

  Both files are tens of megabytes, so only their last ~300 KB is fetched, by
  HTTP range.
- **War losses:** Ukraine's MoD claims (PetroIvaniuk/2022-Ukraine-Russia-War-Dataset),
  with a spike test against the 30-day norm, beside Oryx's photo-verified
  counts for both sides (leedrake5/Russia-Ukraine).
- **Internet outages:** IODA's 48-hour summary by country and region (Georgia
  Tech).
- **Sanctions lists:** OpenSanctions' target count per list, with 7- and
  30-day changes. The page's own copy (`assets/sanctions.json`) keeps the
  history.

They feed:
- the brief's prompt and the Crystal Ball, which baselines alarm and loss
  counts;
- the AIR RAIDS globe layer and the Indicators section;
- `intel.py indicators`.

## Signals

**Live tuner.** You listen live through a public KiwiSDR receiver, inside the
page (`assets/signals.js`):
- **Controls:** presets (UVB-76, The Pip, Squeaky Wheel, HFGCS 8992 / 11175 /
  4724, Shannon VOLMET, WWV), free tuning in USB/LSB/AM/CW, and a scan that
  steps through the presets and reports each one's signal level and what the
  detectors heard.
- **Waterfall and seeking:** the receiver's own waterfall scrolls under the
  dial. You can tap a trace to tune it, drag to move along the band, use the
  wheel or arrow keys to tune by the chosen step (10 Hz to 10 kHz), and
  ctrl+wheel or −/+ to zoom. SEEK ◀ ▶ jumps to the next signal standing 9 dB
  clear of the noise, moving the view along the band until it finds one.
  Band menus cover the broadcast bands, the ham bands and aviation, maritime
  and utility allocations.
- **Receiver DSP:** the filter width is adjustable, with a default for each
  mode (2.4 kHz SSB, 8 kHz AM, 0.5 kHz CW). The Kiwi's noise blanker and
  spectral noise reduction run on the receiver.
- **Transcribe + translate:** one press writes out the speech in the last
  10–60 s of the channel and puts it into English. It uses Whisper running
  on the listener's own device (transformers.js in a worker), and the audio
  never leaves the device.
  - **Models:** quick (tiny, about 40 MB), better (base, about 80 MB), or best
    for desktops (small, about 250 MB). The model is downloaded once from
    Hugging Face and kept by the browser.
  - **Language:** detected automatically, or set by hand.
  - **Reliability:** weak shortwave makes Whisper guess, and over static it
    invents subtitle phrases ("Thank you for watching", "Продолжение
    следует"). Those, and runs of repeated words, are flagged as probably not
    speech. A transcript is a lead, not a finding.
- **Morse → text:** decodes CW in what you hear, in the browser.
  - It finds the strongest steady tone and follows its level.
  - It learns the sender's speed from the dots and dashes, and keeps
    following it as the sender changes speed.
  - It writes letters, figures, punctuation and prosigns (`<AR>`, `<SK>`,
    `<KN>`…).
  - Only the text is kept: a log per channel in the browser, which survives a
    reload, with SAVE TEXT (.txt), COPY and CLEAR. No audio is stored.
  - Tested on synthetic Morse: error-free from 12 to 35 wpm and down to
    6 dB signal-to-noise (in 500 Hz), with uneven hand-keying. At 3 dB about
    half the characters are wrong. Thirty seconds of noise alone gave
    nothing.
- **Receiver choice:** the receiver nearest the transmitter is chosen
  automatically, and one that is full or refuses is skipped.
- **Protocol:** the page speaks the Kiwi's own WebSocket audio protocol and
  decodes its IMA ADPCM audio, the same handshake as jks-prv/kiwiclient.
- **Courtesy:** one listener at a time, identified as "Trident Brief
  listener". The waterfall shares the audio connection's session, so the
  receiver counts the two as one user. The receiver's own limits apply, and the page lets go after an
  hour without a touch.
- **Which receivers:** an HTTPS page may only open secure connections. Of the
  roughly 860 public KiwiSDRs, the ones that serve HTTPS are found weekly by
  `tuner_receivers.py` (`.github/workflows/tuner-receivers.yml`) and written to
  `data/tuner/receivers.json`. The first check, on 7 Oct 2026, found 16, mostly
  in Europe. The approach follows Priyom's pavlova dispatcher.

**Reported by radio monitors.** Once a day, alongside the Analyst Desk, one X
search (at most two) collects first-hand logs of these stations from the people
who monitor them round the clock. Every report must link the post it came
from. They are shown in the section and kept in `data/analyst/desk.json`
(`radio`).

**The analyzer** is a spectrogram that runs entirely in the browser (Web
Audio). It takes the tuner, another tab's audio (desktop Chrome or Edge), the
microphone, or a recording, and nothing is uploaded. Two detectors run on their
own fixed 2048-point spectrum:
- *pulse train*: periodicity of the energy in eight sub-bands over 12 s, which
  gives the Buzzer's rate;
- *voice?*: the median frame-to-frame change of the speech-band level, never
  counted on frames that carry the Buzzer's own harmonic comb.

In live mode the audio clocks both the detectors and the waterfall, so they
keep running in a background tab.

**Retired:** `radio_monitor.py` recorded these channels round the clock through
a relay of public receivers until 7 Oct 2026. It now runs only by hand. Its
recordings stay on the `radio-data` branch and in the section's archive.

## Appalachistan

The trail-map section at the bottom of the page (`assets/appalachistan.js`,
with Leaflet 1.9.4 vendored under `assets/leaflet/`, BSD-2). Its trail data,
`assets/appalachia.json`, is built from OpenStreetMap through Overpass by its
own workflow (`.github/workflows/trail-data.yml`, daily and on demand) and
committed; a complete build under 30 days old is left alone. Run it by hand from
the Actions tab (Build Trail Data -> Run workflow) to rebuild sooner. `sw.js` is
the service worker that keeps the page, the map and saved USGS tiles on the
device so the section works with no signal. Tiles from OpenTopoMap,
OpenStreetMap, Esri and Waymarked Trails are never stored, as their terms
require.

Built for being stuck in the woods:

- **Installs as an app.** `manifest.webmanifest` and `assets/icons/` let "Add to
  Home Screen" open it full screen and offline, with Map and Emergency
  shortcuts (`#appBand`, `#apSos`).
- **POCKET mode.** No web page can use GPS with the screen off, so the screen
  stays on but goes pure black and touch-locked, and the track keeps
  recording. Hold for two seconds to come back. If the phone locks anyway, it
  says how long nothing was recorded.
- **Signal catcher** (EMERGENCY tab). When signal appears and GPS is on, at most
  every 30 minutes (10 after a failure), never in data-saver or private mode:
  NWS alerts and a 12-hour Open-Meteo forecast for the position rounded to
  about a kilometre, and about 1 MB of USGS map around you if that ground was
  never saved.
- **Plan a walking route** (GO TO tab). It uses OpenStreetMap paths (Overpass)
  and AWS terrain heights, fetched once with signal. Tobler's hiking function
  times two routes: a trails-and-roads route over the mapped network, and the
  quickest route over a ~30 m terrain grid. Each comes with a profile, climb,
  steep ground, drop-offs, crossings, water and ways out, a cue sheet and a
  daylight check. The kept route, plus the map along it, is followed offline
  with an off-route warning.
- **Route settings:** ANYWHERE, or PUBLIC LAND ONLY (Forest Service ownership
  plus PAD-US open-access land; private land avoided, and any unavoidable
  crossing listed). Then WALK ALL THE WAY, or DRIVE, THEN WALK, which drives
  OSM roads to the best place to park, then walks in.
- **Text my location** asks four times before it opens Messages. There is no
  call button.
- **Survival guide.** Collapsible, Appalachian-specific, saved with the page.

## What a run costs

xAI bills per search as well as per token, and the searches are most of it: on
25 Sep 2026 two runs of 10 and 12 searches cost $0.19 and $0.21, of which the
prompt and the written brief were a few cents. Every run now logs its cost in
dollars and its search count against `SEARCH_BUDGET` (default 8, set as an
environment variable in the workflow), and both land in
`assets/feed-status.json` under `collection`. The brief's usage is also on the
xAI console, where the figures are per day.

## God's Eye live signal layer

The page carries a live panel of free, keyless public feeds, an approach adapted
from [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) (MIT).
That project is a Node/Vite app and is not built for static hosting, so rather
than embedding it the same class of feeds are pulled client-side:

| Tile | Source |
|---|---|
| Seismic | USGS, M2.5+ / 24h |
| Air picture | adsb.lol — 100nm, mil-flagged, 7500/7600/7700 squawk alerts |
| Hazard | NOAA/NWS active alerts |
| Orbital | wheretheiss.at — ISS position, altitude, velocity |
| Space launch | Launch Library 2, live T-minus |

Each tile fetches independently behind a timeout and degrades to `FEED UNAVAILABLE`
on its own, so no single feed can take the page down. Entering a ZIP in the local
brief panel re-targets every tile onto that area.

## Terrain and imagery — analysing the ground under a contact

Any contact on the globe, or any lat/lon typed in, can be opened in an analysis
panel that reads the ground itself. Five layers, all keyless and all fetched
client-side:

| Layer | Source | What it answers |
|---|---|---|
| Topography | USGS 3DEP where it exists, AWS Terrain Tiles elsewhere | height, relief, contours, line of sight |
| Slope | derived | where wheels, tracks and feet can go |
| Viewshed | derived, radial sweep with curvature and refraction | what an observer at a point can see |
| Activity | this page's own collection | what has been reported inside this ground |
| Imagery | Sentinel-2 L2A true colour, infrared and SWIR, `sentinel-cogs` on S3 | what is there, and what changed: before/after either side of an event's date |

Elevation comes from the USGS directly wherever the USGS has published it.
The 1/3 arc-second 3DEP DEM is a Cloud Optimized GeoTIFF per 1-degree square
in the same bucket the imagery uses, so the panel reads the header, pulls only
the internal tiles it needs, and decodes LZW with a floating-point predictor in
the page. Downtown Minneapolis comes back 254.81 m, checked against an
independent decode of the same bytes.

Only the native level is ever used, and that is deliberate rather than an
oversight: over the US the global tiles are themselves a re-encoding of 3DEP,
so an overview at 20 or 40 m buys nothing over the free tiles while costing
megabytes. What the fallback cannot give is the native posting, because above
about z13 its pyramid interpolates — measured, not assumed: the mean difference
against the next zoom halves exactly at each step (0.861, 0.440, 0.200,
0.063 m). So the panel takes 3DEP when the whole read fits a 20 MB budget, and
falls back otherwise. Either way the readout names the source and the posting.

The imagery layer has no tile server behind it. Sentinel-2 scenes are Cloud
Optimized GeoTIFFs in a public bucket that answers HTTP range requests with
`Access-Control-Allow-Origin: *`, so the page reads a file's own header, works
out which of its internal tiles cover the ground on screen, and pulls only
those — typically 1 to 4 MB out of a file of hundreds. The TCI images are
Deflate with a horizontal predictor, which `DecompressionStream` handles
natively, so no decoding library is shipped. The scene path is derived from
latitude and longitude by MGRS arithmetic, which is what makes this work
without the STAC search API.

Cloud is the limit, not resolution. Over one 100 km square in a single month
the cover ran from 0.00% to 99.92%, so the panel reads every candidate's
metadata, picks the clearest recent pass, and offers the rest in a list. The
level of the image pyramid is chosen from what the panel can actually display
and from the tile byte counts already in the header, so a phone downloads a
quarter of what a desktop does for the same view.

## Privacy

Free, open source, and not watching anyone: no accounts, ads, cookies,
analytics or tracking pixels. The footer's PRIVACY panel lists every outside
site the page contacts and when, and what it keeps on the device. It has a
**private mode** (the page then asks nobody but GitHub for anything on its
own; anything a visitor presses still works) and a button that erases
everything the site saved on the device. The page sends no referrer, and the
Crystal Ball's fonts are served from `assets/fonts/` rather than Google Fonts.
GitHub, as the host, still sees visitors' IP addresses; the owner does not. Hidden
features are hidden, not secret: the panel names them, says what they contact,
and also lists what the server jobs contact.

## Layout

| Path | Purpose |
|---|---|
| `generate_brief_final.py` | Collection + render pipeline |
| `template.html` | Page template, `__TOKEN__` placeholders |
| `index.html` | Build artifact — regenerated on every deploy, not hand-edited |
| `latest-brief.json` | Last successful brief, used as the cache fallback |
| `archive/` | Prior briefs plus a generated `index.json` the page reads |
| `.github/workflows/generate-brief.yml` | Twice daily at 11:04 and 23:04 UTC, plus manual dispatch |

## Versions

The build version lives in `VERSION` (currently 1.13.0) and appears in the page
header, the footer and `assets/feed-status.json`. MAJOR.MINOR.PATCH: PATCH for
fixes, MINOR for a new feature or layer, MAJOR for a change to what the brief
is. Changes per version are in [`CHANGELOG.md`](CHANGELOG.md).

## Running locally

Re-render `index.html` from the cached brief, without calling any API:

```bash
python3 generate_brief_final.py --offline
```

A full collection run needs `GROK_API_KEY` (and optionally `GROQ_API_KEY`) in the
environment.

## Notes

Each run commits `latest-brief.json` and `archive/` back to the repository. That
is deliberate: GitHub disables scheduled workflows after 60 days with no
repository activity, which is what silently stopped this brief in May 2026. The
daily commit keeps the repo active so the schedule cannot expire again.

`index.html` is excluded from that commit; it is a build artifact, rebuilt on
every deploy. No API key is ever written into the page: a static host has
nowhere to keep a secret, so anything in it is readable by every visitor. The
Local Intelligence Brief runs on the visitor's own xAI key, typed into the page
and kept only in their browser. The owner's local brief runs on GitHub
instead (`.github/workflows/local-brief.yml`, `local_brief.py`), with the Grok
key already in the repository's secrets, so the key never reaches a phone. The
owner's panel -- opened by tapping the version number in the header five times
-- holds only a fine-grained GitHub token (Actions: read and write, Contents:
read-only) and the passphrase also stored as the `LOCAL_BRIEF_PASSPHRASE`
secret. Because the repository is public, the ZIP is sent encrypted with that
passphrase and the brief is committed encrypted to `data/local-brief/`, where
only the panel can open it. Whether xAI accepts calls made
straight from a browser is checked on every feed refresh and recorded in
`assets/feed-status.json` under `xai_browser`.

## Analysis from a Claude Code session

`python3 intel.py sync && python3 intel.py` prints an overview of everything
the app has gathered. It reads the `main`, `intel-data` (published by each
half-hourly refresh) and `radio-data` branches. `python3 intel.py help` lists
the views, and `CLAUDE.md` explains how sessions should use them.

