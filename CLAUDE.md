# The Trident Brief: notes for Claude sessions

Appalachian Intel's daily intelligence brief, live at
https://tridentintelfree.github.io/Trident-Brief/. The owner (Jay) opens
sessions here to ask for analysis of what the app has gathered, and to change
the app.

## Analysing what the app gathered

Start every analysis request with:

    python3 intel.py sync      # fetch main, intel-data and radio-data
    python3 intel.py           # overview: every source, and how fresh it is

Then drill in as the question needs:

| command | what it gives |
|---|---|
| `brief [N\|YYYY-MM-DD]` | the latest brief, or one from the archive |
| `warnings` | official maritime navigational warnings (UK NAVAREA I, Japan NAVAREA XI, China's coastal bureaus, NGA if it is ever live again) |
| `osint [theatre]` | situationmonitor events (48h), DeepStateMap front line, Telegram lean |
| `telegram [N]` | Telegram war-channel posts, machine-translated (marked `[tr]`) |
| `gdelt`, `wire [N]`, `quakes`, `launches`, `disasters`, `gps` | the other feeds |
| `indicators` | air-raid alarms (Ukraine, Israel), claimed vs verified war losses, internet outages (IODA), sanctions lists |
| `space` | space weather: NOAA G/S/R scales and 3-day outlook, Kp, solar wind, flares, CMEs with modelled Earth arrival (DONKI) |
| `radio` | what radio monitors reported on X (daily), and the retired relay's archive |
| `spectro FILE [t0 t1]` | spectrogram PNG of a radio clip, to look at with Read |
| `crystal`, `desk`, `area` | Crystal Ball forecasts, Analyst Desk, Tazewell area brief |
| `search TERM [--days N]` | every text source at once, including past briefs |
| `history [days]` | day-by-day trend from the daily digests on intel-data |
| `json ROOT[.path]` | raw data for anything the views do not cover (roots: feeds brief ball desk area radio history status) |

Where it comes from: the half-hourly feed refresh force-pushes the
`intel-data` branch (latest feeds, hourly digests for 72h, daily digests for
60 days). The radio relay that force-pushed `radio-data` was retired on 7 Oct 2026
(its archive stays there); the page now has a live tuner instead, which
listens only when a person presses a button. The briefs, archive and
hidden desks are committed to `main`. The live site and x.com are usually
blocked from these sandboxes, so use `intel.py`, not the page.

### How to read the sources

- **Estimative language.** Follow the brief's convention (ICD-203): almost no
  chance / very unlikely / unlikely / roughly even chance / likely / very
  likely / almost certain. Crystal Ball's track record (`crystal`) shows how
  those terms have held up.
- **Navigational warnings** are primary documents: they prove what a
  government announced, not that anything happened. China's are
  machine-translated; positions come from the Chinese original.
- **Telegram** posts are each channel's claims, mostly pro-Russian. They are
  never facts, and machine translation garbles slang and call signs.
- **situationmonitor** events are software-extracted. "Unconfirmed" means one
  source. Casualty numbers are sometimes wrong.
- **GDELT** is machine-coded news volume: where to look, never evidence.
- **Indicators.**
  - Ukraine's air-raid data is volunteer-compiled and updated about once a
    day, so its "24 h" is the 24 hours to its newest record.
  - Ukraine MoD loss figures are one side's claims. Oryx counts are
    photo-verified and lag by days.
  - An IODA outage is a lead (a strike, a power cut, a shutdown), not a cause.
  - Sanctions changes are counted from the app's own earlier readings.
- **Radio:** a detector's "voice" is a lead, not a finding. Check the clip
  with `spectro` before saying anything was heard. The UVB-76 Buzzer is a
  harmonic comb about every 3.4 s; speech shows shifting pitch contours and
  syllable-rate level changes. Detectors fooled by the buzz have been wrong
  before (6 Oct 2026).
- **Space weather:** SWPC readings are measurements; a CME's Earth arrival is
  a WSA-Enlil model run, often hours off, and its strength depends on a
  magnetic field measured only about an hour before arrival.
- Say plainly when a source is stale, frozen or missing. `intel.py` prints
  each source's age. NGA's public warning feed has been frozen at May 2024
  since at least mid-2026.

## Working on the app

- `generate_brief_final.py`: collection, prompt, page render. The main run is
  twice daily; `--feeds-only` is the half-hourly refresh with no model call.
- `template.html` / `assets/`: the page. `signals.js` is the radio analyzer,
  `briefing.js` reads the brief aloud.
- `crystal_ball.py`, `analyst_desk.py`, `area_brief.py`: hidden desks, one
  Grok call a day each. The Crystal Ball forecasts four windows (48 h daily,
  7 d weekly, 30 d monthly, 1 y quarterly). `forecast_engine.py` does all the
  free work around that call:
  - the records (alarms, alerts, claimed losses, quakes);
  - the statistical engine (fly-brain analog days);
  - the fly's matches against past warnings;
  - blind Polymarket benchmark questions;
  - automatic settling and the scoreboard.

  Event questions are settled by a separate small web-search grading call. `astro_lore.py` runs after the Crystal Ball: the
  computed sky, national charts, almanac, lore against the intel (fly-brain
  overlaps), a weekly fair test of astrology's claims against years of
  records, and a second small Grok call for the reading
  (`data/crystal/astro.json`).
- `radio_monitor.py`: the retired KiwiSDR relay (run by hand only).
- `tuner_receivers.py`: weekly check of which KiwiSDRs the page's live tuner
  can reach over HTTPS, written to `data/tuner/receivers.json`.
- `VERSION` and `CHANGELOG.md` are bumped with every change (PATCH for fixes,
  MINOR for features).

The owner's standing rules:

- **One secret only.** The xAI key lives in the `GROK_API_KEY` repository
  secret. Never put it in a page, never ask for another secret, and never add
  setup steps that were not asked for.
- **Hidden features stay hidden, not encrypted, and never secret.** The
  PRIVACY panel names them and everything they contact. Gestures open them:
  - "Appalachian Intel" ×3, then the code 0330: Tazewell brief (Tazewell and 200 miles around it, and its space-weather guide)
  - title ×3: Analyst Desk
  - left trident ×3: Crystal Ball
  - version ×5: owner panel
  - the small "hello" box, top right: prediction-market top picks
- **No Reddit,** as a source or a search.
- **Listen like a person.** Other people's receivers are used live, by a
  human pressing a button, one at a time, never recorded round the clock.
- **Private for visitors.** No tracking, cookies or analytics. Any new
  outside site the page contacts goes in the PRIVACY panel (`#privModal`), and
  anything it fetches on its own goes through `jget`, so private mode blocks it.
- **Always honest about contacts.** Every site the page or the server jobs
  reach out to is disclosed in the PRIVACY panel, hidden features included.
- **Walking routes walk, and never trespass.** A walking request gets a
  walking route, never a suggestion to drive or switch modes. PUBLIC LAND ONLY
  never crosses private land (only up to 250 m to leave where you start); if
  the destination can't be reached legally, the route stops at the nearest
  legal point and says so.
- **Mind the cost.** Prefer free sources and caching to model calls, and say
  what a change costs per run.
- **Be honest about results.** Noise is noise, a frozen feed is frozen, and
  an unverified detection is unverified.
- **Agree on the design before building** anything large or ambiguous.
