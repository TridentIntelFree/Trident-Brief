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
- **Radio:** a detector's "voice" is a lead, not a finding. Check the clip
  with `spectro` before saying anything was heard. The UVB-76 Buzzer is a
  harmonic comb about every 3.4 s; speech shows shifting pitch contours and
  syllable-rate level changes. Detectors fooled by the buzz have been wrong
  before (6 Oct 2026).
- Say plainly when a source is stale, frozen or missing. `intel.py` prints
  each source's age. NGA's public warning feed has been frozen at May 2024
  since at least mid-2026.

## Working on the app

- `generate_brief_final.py`: collection, prompt, page render. The main run is
  twice daily; `--feeds-only` is the half-hourly refresh with no model call.
- `template.html` / `assets/`: the page. `signals.js` is the radio analyzer,
  `briefing.js` reads the brief aloud.
- `crystal_ball.py`, `analyst_desk.py`, `area_brief.py`: hidden desks, one
  Grok call a day each.
- `radio_monitor.py`: the retired KiwiSDR relay (run by hand only).
- `tuner_receivers.py`: weekly check of which KiwiSDRs the page's live tuner
  can reach over HTTPS, written to `data/tuner/receivers.json`.
- `VERSION` and `CHANGELOG.md` are bumped with every change (PATCH for fixes,
  MINOR for features).

The owner's standing rules:

- **One secret only.** The xAI key lives in the `GROK_API_KEY` repository
  secret. Never put it in a page, never ask for another secret, and never add
  setup steps that were not asked for.
- **Hidden features stay hidden, not encrypted.** Gestures open them:
  - "Appalachian Intel" ×3: Tazewell brief
  - title ×3: Analyst Desk
  - left trident ×3: Crystal Ball
  - version ×5: owner panel
- **No Reddit,** as a source or a search.
- **Listen like a person.** Other people's receivers are used live, by a
  human pressing a button, one at a time, never recorded round the clock.
- **Mind the cost.** Prefer free sources and caching to model calls, and say
  what a change costs per run.
- **Be honest about results.** Noise is noise, a frozen feed is frozen, and
  an unverified detection is unverified.
- **Agree on the design before building** anything large or ambiguous.
