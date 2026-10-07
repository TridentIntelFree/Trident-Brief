# Changelog

Versions are MAJOR.MINOR.PATCH, kept in the `VERSION` file and shown in the
page header and footer. Bump PATCH for fixes, MINOR for a new feature or layer,
MAJOR for a change to what the brief is.

## 1.19.0 — 2026-10-07

### Tuner: transcribe + translate, on the device
- **TRANSCRIBE + TRANSLATE** writes out the speech in the last 10, 20, 30 or
  60 seconds of the channel, then gives it in English. Whisper runs in the
  listener's browser (transformers.js 4.3.1, in a worker, WebAssembly, 8-bit
  weights). Nothing is sent anywhere, and there is no model call and no cost
  per run.
  - **Models:** quick (whisper-tiny, about 40 MB), better (base, about 80 MB,
    the default) or best for desktops (small, about 250 MB). The model is
    downloaded once from Hugging Face; the progress is shown, and the browser
    keeps it.
  - **Language:** detected automatically, or set to Russian, Ukrainian,
    English, Chinese, Korean, Arabic, Persian, Hebrew, Spanish, French or
    German.
  - **The clip:** the last minute of what you hear is held in memory. It is
    cleared on every retune, so a transcript is always one channel.
  - **Probably not speech:** Whisper invents subtitle phrases over static
    ("Thank you for watching", "Продолжение следует", "字幕"). Those, and runs
    of repeated words, are flagged in either language, and their text is
    dimmed.
  - Each transcript is also logged in the analyzer's events.
  - **Not tested with the real model:** the model host and CDN are blocked
    from the build sandbox. The page side was tested in a browser with a
    stand-in model: the clip capture (a real 12 s clip at 16 kHz), model
    progress, the two passes, the flags, and the clearing on retune.

### Lists fold
- The Event Board, Wire, OSINT Feed, Indicators and Recurring Locations now
  fold to their heading, like Signals. Tap the heading or ▾ hide. Each
  remembers its state in the browser.

## 1.18.1 — 2026-10-07

### Fixed
- **OPEN RECORDING → PLAY did nothing** from 1.16.0 on. The tuner's audio
  routine had the same name as the recording player's, so the recording
  player called the tuner's instead and returned without playing. The tuner's
  routine is renamed. A recording plays again, and the tuner is unaffected
  (both checked in a browser).

## 1.18.0 — 2026-10-07

### Tuner: waterfall, seek, bands, filters
- **Waterfall.** The receiver's live waterfall and spectrum are shown under
  the dial, with the passband and tuning line drawn on it. The levels adjust
  themselves to the band's noise.
  - Tap a trace to tune it, or drag to move along the band.
  - The wheel or the arrow keys tune by the chosen step, from 10 Hz to
    10 kHz; ctrl+wheel or −/+ zooms.
  - The waterfall uses the same receiver session as the audio, so it takes
    no extra slot.
- **Seek ◀ ▶** finds the next signal standing 9 dB clear of the noise in
  either direction. When the view holds none, the view moves along the band
  and the search continues (up to eight views).
- **Band menus:** 12 broadcast bands, 10 ham bands, and aviation, maritime,
  military and time-signal allocations. Each opens zoomed to fit, in the
  band's usual mode.
- **Filter width** is a slider with a default for each mode (2.4 kHz SSB,
  8 kHz AM, 0.5 kHz CW).
- **Noise blanker and noise reduction** run on the receiver (the Kiwi's own
  DSP), alone or together.
- Cost: nothing per run; it all happens in the visitor's browser.

## 1.17.0 — 2026-10-07

### Indicators: alarms, losses, outages, sanctions
Six more open sources, all free and keyless, are read on every collection.
- **Air-raid alerts, Ukraine** ([Vadimkin](https://github.com/Vadimkin/ukrainian-air-raid-sirens-dataset)).
  It shows alarms per day, the most oblasts under alarm at once, and hours
  under alarm per oblast. The data is volunteer-compiled and updated about
  once a day; windows are measured to its newest record, so lag does not look
  like calm.
- **Air-raid alerts, Israel** ([dleshem](https://github.com/dleshem/israel-alerts-data)).
  Home Front Command alerts are counted by type (rockets, drones,
  infiltration), with all-clears and pre-warnings kept apart. Times are
  converted from Israel local time.
- **War losses.** Ukraine's MoD daily claims of Russian losses
  ([PetroIvaniuk](https://github.com/PetroIvaniuk/2022-Ukraine-Russia-War-Dataset))
  are flagged when a day is two standard deviations off its 30-day norm. They
  are shown beside Oryx's photo-verified counts for both sides
  ([leedrake5](https://github.com/leedrake5/Russia-Ukraine)), with 7- and
  30-day changes.
- **Internet outages:** IODA (Georgia Tech), by country and region over 48
  hours, with the watched theatres picked out.
- **Sanctions lists:** OpenSanctions' target counts for ten major lists,
  with changes measured from this app's own readings.
- **Light on the source servers.** The two alert archives are 31 MB and
  66 MB, so only their last ~300 KB is fetched, by HTTP range.
- **Where it shows up:**
  - a new AIR RAIDS globe layer (Ukrainian oblasts sized by hours under alarm)
  - a new Indicators section with five cards
  - the brief's prompt
  - the Crystal Ball's snapshot and its rising-against-baseline checks
  - `intel.py indicators`, the overview, and the daily digests' trend table

## 1.16.0 — 2026-10-07

### A live tuner, in place of the recorder
- **Signals is now a live shortwave tuner.** It plays a public KiwiSDR
  receiver inside the page and feeds the analyzer, so the detectors hear what
  you hear.
  - Presets: UVB-76, The Pip, Squeaky Wheel, HFGCS 8992 / 11175 / 4724,
    Shannon VOLMET, WWV.
  - Free tuning in USB/LSB/AM/CW with ±0.1 and ±1 kHz steps.
  - A scan that steps through the presets and reports each one's signal and
    what the detectors made of it. It can stop on voice.
  - A signal meter, plus RECORD CLIP for what you hear.
- **Receivers are picked for you.** The nearest to the transmitter is tried
  first; a full or refusing one is skipped, or you choose one.
- **Courtesy.** It is one listener on one receiver, named "Trident Brief
  listener", and lets go after an hour untouched.
- **Which receivers it can use.** An HTTPS page may only use receivers that
  serve HTTPS. A weekly check (`tuner_receivers.py`) found 16 of the ~860
  public KiwiSDRs on 7 Oct 2026, mostly in Europe, one in Connecticut, two in
  South America. Hattingen, Germany, was hearing UVB-76's buzzer when tested.
- **Reported by radio monitors.** Once a day the Analyst Desk run also
  collects first-hand logs of these stations posted on X, each linked to its
  post, and the section lists them. Cost: one more call with at most two
  searches, about 1–3 cents a day.
- **The round-the-clock recorder is retired.** Its schedule is off; it can
  still be run by hand. What it caught is kept in an archive at the foot of
  the section.
- Tested against the protocol with real Kiwi audio frames: the handshake,
  ADPCM decoding, playback buffering (no drops at real-time pace), a full
  receiver being skipped, and the Buzzer locked at 17.7 a minute through
  the tuner.

## 1.15.2 — 2026-10-07

### No more Reddit
- The two Reddit feeds (defence subreddits and the signal-monitoring
  subreddits) are gone, along with their retry and rate-limit workarounds.
- The model is told not to search or cite Reddit, and a Reddit citation is
  logged as a warning.
- Reddit posts carried over in the week-long monitor list are dropped. The
  numbers-stations feed stays.

## 1.15.1 — 2026-10-07

- Japan's warnings give positions in degrees, minutes and seconds
  (21-29-38N 128-10-05E). These are now read, so its rocket-launch drop zones
  and the Nanpo Shoto gunnery area appear on the globe instead of "no
  position".

## 1.15.0 — 2026-10-07

### An analysis interface for Claude sessions
- **`intel.py`** reads everything the app gathers from the repository's
  branches. It works where the live site is unreachable (Claude Code sessions
  cannot open github.io or x.com).
- Views:
  - an overview with each source's freshness
  - the brief and its archive
  - maritime warnings
  - OSINT, Telegram, front line
  - GDELT, wire, quakes, launches, disasters, GPS jamming
  - the radio timeline, plus radio clip spectrograms
  - the Crystal Ball, Analyst Desk and Tazewell brief
  - search across every text source, including past briefs
  - a day-by-day trend table, and raw JSON
- **The half-hourly refresh now publishes an `intel-data` branch.** It holds
  the full latest feeds, hourly digests for 72 hours and daily digests for
  60 days, so trends build up from today. No model calls, no cost.
- **`CLAUDE.md`** tells every new session how to use it, how to weigh each
  source, and the owner's standing rules.

## 1.14.1 — 2026-10-07

### Radio: the Buzzer is no longer mistaken for voice
- The relay is now hearing UVB-76's real Buzzer on 4625 kHz: a buzz every
  3.4 s (17.6 a minute), 25-30 dB above the noise, from receivers in northern
  Sweden and southwest England.
- Its on/off and fading passed every voice test, so on 6 October twelve
  clips of pure buzz were filed as "voice". Every one was checked on a
  spectrogram, and all were the buzzer.
- The detectors (relay and page) now learn the buzz's harmonic fingerprint
  from the clip itself, and a frame carrying it never counts as voice. A
  real message replaces the buzz, so it still registers: tested with speech
  spliced into a buzz recording.
- The live analyzer also retracts a short "voice?" logged before it had
  recognised the buzz.
- The 6 October UVB-76 entries are relabelled "buzz" on the next relay run.
  The HFGCS voice heard that day (11175 kHz at 16:55Z, 8992 kHz at 21:34Z)
  was real and is kept.

### Maritime warnings
- China's coastal bureaus refused NGA's header set (HTTP 403), so the first
  live run read "0 military warnings". The UK, Japan and China are now asked
  as a plain browser, and a refusal is reported instead of passing as zero.
  The first run after the fix found 11: Bohai Sea exercises, Zhoushan, the
  Beibu Gulf, and two Hainan rocket-launch closures.
- 航警 ("navigational warning") no longer comes out of the translator as
  "Aviation Police".

## 1.14.0 — 2026-10-07

### Maritime warnings: new sources, since NGA's feed is dead
- **NGA's public warning feed has been frozen since May 2024.** Every format
  (JSON, text, CSV), every filter and asking as a browser all return the same
  386 warnings, and asking for 2026 returns none. The page's "navwarn: feed
  appears frozen" was accurate: no fix on our side can revive it.
- **Warnings now come from the coordinators that publish their own:**
  - **UK Hydrographic Office:** NAVAREA I (northeast Atlantic, North Sea,
    Baltic approaches) and UK coastal warnings, full text from one page.
    Covers, for example, the Hebrides live-firing range.
  - **Japan Coast Guard:** NAVAREA XI (Japan, Korea, the Chinese coast,
    western Pacific), including rocket launches, space debris and gunnery.
    Only warnings whose title or category could matter are read in full.
  - **China Maritime Safety Administration:** the 11 coastal bureaus'
    navigational warnings, kept only when the title names military exercises,
    live fire, missiles or rocket debris. Text is machine-translated for free,
    positions are read from the Chinese original, and the panel shows both.
- NGA is still asked each run and counts again as soon as it is live.
- Each warning links to its own source. The brief cites that link, and the
  globe's warning panel names the authority.

## 1.13.3 — 2026-10-07

### Maritime warnings: asking NGA as a browser
- NGA's warning feed has answered every run with the same 386 warnings, the
  newest from May 2024, so the maritime layer has been reporting "feed
  appears frozen". NGA's own app and World Monitor use this same address
  successfully, and World Monitor asks as a browser.
- Each refresh now also asks as a browser, with a cache-buster, and keeps
  whichever answer is newest. The log records the CDN's cache headers.

## 1.13.2 — 2026-10-06

### Translation fix
- The first live run got nothing from either free translator from GitHub's
  servers. Requests now identify as a browser, a third free endpoint is
  tried (the one Chrome's dictionary extension uses, 20 posts per request),
  and the refresh log records each translator's response code.

## 1.13.1 — 2026-10-06

### Telegram posts in English
- The Russian and Ukrainian war-channel posts are machine-translated to
  English on each feed refresh. The OSINT Feed, the globe's Telegram panels,
  the brief and the Crystal Ball all read the English text.
- **Free, with no key and no Grok spend.** It tries Microsoft's Edge
  translator first, then Google's free web translator. Each post is
  translated once: earlier translations are read back from the live site
  (`assets/tg-en.json`), so a refresh only sends posts that are new since the
  last one, about ten.
- In the feed, "translated from Russian · original" under a post opens the
  original text. If both translators refuse, posts stay in the original
  language until a later refresh succeeds.

## 1.13.0 — 2026-10-06

### Partner OSINT: other open-source trackers, folded in
- **Three new sources**, read on every half-hourly refresh at no cost:
  - **[situationmonitor](https://github.com/hassmax/situationmonitor):**
    structured conflict events from Bluesky, Telegram and news, refreshed every
    15 minutes. Each has a theatre, type, place, status (corroborated or
    unconfirmed), number of reports and casualties. The last 48 hours are
    kept (about 680 events today).
  - **[tracker-data](https://github.com/gutmanis/tracker-data):** about 40
    Telegram war channels, each post tagged with its channel's lean. The last
    24 hours are kept (about 410 posts today, mostly from Russian state and
    pro-Russian channels, which the page says plainly).
  - **The front line:** DeepStateMap's Russian-held territory with its daily
    history, so the change is measured. Today: 115,613 km², +22 km² in 7 days,
    +93 km² in 30 days.
- **On the globe:**
  - **EVENTS:** coloured by type.
  - **TELEGRAM:** clusters coloured by the channels' lean. Posts the source
    could not place are kept off the map.
  - **FRONT LINE:** the outline itself.

  These work in both the 2D and 3D globes, with detail panels and box select.
- **New OSINT Feed section:**
  - a front-line card;
  - the Telegram lean split;
  - events by theatre;
  - a merged, newest-first feed with source/theatre filters and links to the
    original posts.
- **Feeds the analysis:**
  - the main brief's leads and the Crystal Ball both get the front-line
    change, the most severe and corroborated events, and the newest Telegram
    claims, with rules to treat each as a claim from its named source;
  - the Crystal Ball's baseline log now tracks events by theatre, Telegram
    volume and front-line area.
- Links from outside sources are escaped as attributes, and only http(s)
  links are followed.

## 1.12.3 — 2026-10-06

### Signals: learn from people already doing this
- **UVB-76 is tuned the way the 24/7 Buzzer streamers tune it:** 4625 kHz
  upper sideband, 50–4000 Hz, not AM. This setting is taken from
  [kiwi-reload](https://github.com/noaa-apt/kiwi-reload), the open-source
  tool behind those streams.
- **Receivers that already hear it come first.** Each run reads kiwi-reload's
  published list of the KiwiSDRs its users stream UVB-76 from, mostly in
  Sweden and Finland, near the transmitter.
  - Those get most of the slices.
  - Receivers the relay has proven itself come next, and the rest are still
    explored.
  - The no-repeat and free-slot rules are unchanged.

## 1.12.2 — 2026-10-06

### Signals: only call what is really there
- Listening confirmed what the analysis now says: the slices so far are
  **noise**. There are only three labels:
  - **VOICE:** speech.
  - **BUZZING:** a real on/off pulse train, swinging 8 dB or more, at the
    Buzzer's 12–50 per minute.
  - **NOISE ONLY:** everything else. A steady hum or a fade is not the
    station. (The 1.12.1 "SIGNAL" label is gone.)
- **The relay learns which receivers hear the station.** Each receiver keeps
  a score: how many of its slices actually had the buzz or voice.
  - Receivers that have heard UVB-76 are preferred about two times in three.
  - One slice in three still goes to an untried receiver, so new good ones
    are found.
  - A receiver is still never used twice running.
  - Noise on HFGCS is normal; it is silent most of the time.
- Slices recorded before the detectors were calibrated are dropped from the
  timeline and events.
- Receiver names with accents display correctly.

## 1.12.1 — 2026-10-06

### Signals: calibrated on real recordings
- **The first live relay worked**, with real slices from receivers in France
  and England. It also showed the voice detector taking static crashes for
  speech. Voice now has to be *peaky* as well as changing: speech has
  harmonics and formants, while radio noise and static are spectrally flat
  (flatness about 0.55 on the real slices). Checked on the real slices (no
  false voice) and on test recordings (voice still found). The same rule
  applies in the recorder and in the page's analyzer.
- A slice with only static is labelled **NOISE ONLY**, not "signal".
- **UVB-76** prefers receivers in central and eastern Europe and the Nordics,
  nearer the transmitter, and widens to all of Europe when too few are free.
- Removed a stray coordinates file the recorder left beside the audio.

## 1.12.0 — 2026-10-06

### Signals: real recordings, no outside links
- **Real shortwave audio.** A phone cannot receive shortwave, so a new *Radio
  Watch* workflow borrows public KiwiSDR receivers. It runs a relay for about
  24 minutes of every half hour, covering UVB-76 (4625 kHz AM) and HFGCS
  (8992 and 11175 kHz USB) at the same time.
  - **2-minute slices**, each from a different receiver. No receiver is used
    twice in a row.
  - **Only receivers with at least two free places**, so no one's last slot is
    taken.
  - **Regions:** UVB-76 from receivers in Europe; HFGCS from North America or
    Europe.
  - **Identified** to receiver owners as "TridentBrief".
- **Every slice is analysed:** the Buzzer's pulse rate, voice, and signal
  level.
  - The latest slice per channel can be played or loaded straight into the
    spectrum analyzer.
  - Slices with voice (a UVB-76 message or an HFGCS broadcast) are kept as
    timestamped events.
  - A 48-hour timeline shows when each channel was buzzing, carried voice,
    was quiet, or was not recorded.
- **Storage:** results go to a separate `radio-data` branch, replaced on every
  run, so audio never builds up in the repository's history. The site
  reads them from there.
- **Removed** the outside receiver links and the Reddit monitor reports from
  the section. The analyzer's own sources (tab audio, microphone, file) stay.

## 1.11.0 — 2026-10-06

### Crystal Ball (owner only, hidden)
- **A projected forecast, not a retelling.** Once a day, around 8:45 a.m.
  Eastern, a new *Crystal Ball* workflow makes one reasoning call with no
  searching (cents a run), using only `GROK_API_KEY`. It works from what the
  site already gathered:
  - the latest brief;
  - the live layers: headlines by desk, GDELT conflict hotspots, GPS-jamming
    regions, severe alerts, disasters, quakes, launches, and UVB-76/HFGCS
    reports;
  - the Analyst Desk's contested and single-source claims (the pre-headline
    layer).
- **Its forecasts:** 7–10 of them across 24 hours, 72 hours and 7 days. Each
  gives the event, a probability with its estimative term, the signals behind
  it, the earliest sign to watch for, and what would prove it wrong.
- **Also on the box:**
  - **Pre-headline signals:** what is moving that is not in the news yet.
  - **A nuclear-risk read for the week:** steady, rising or easing.
  - **The Doomsday Clock**, read daily from the Bulletin of the Atomic
    Scientists (85 seconds to midnight, set 27 January 2026).
- **Keeps score:**
  - **Its own forecasts** are resolved when their window closes, scored with
    a Brier score, and fed back into the next forecast.
  - **The brief's past warnings** are scored by the odds they stated (80
    warnings from 65 briefs): "likely" came true 76%, "roughly even chance"
    41% and "unlikely" 5%. Grok is told to correct for that.
- **Learns what's rising.** A daily indicator log builds a baseline. After five
  days, anything running well above its own average is listed.
- **Hidden on the page** behind its own gesture, separate from the Tazewell
  brief and the Analyst Desk. It can be read aloud.
- **Brief me** now reads card layouts cleanly (pauses between lines, labels
  spoken).

## 1.10.1 — 2026-10-06

### Analyst Desk: built to be cheap
- The first run cost $0.43. The desk now:
  - **makes one call a day instead of three**: gathering and writing happen
    in the same request;
  - **tells Grok what costs money**: every search, every post pulled in,
    every token thought or written. It gets a budget of 3 searches and is
    asked to plan them first, never repeat one, and stop once it has the
    main threads. The API is also asked to cap tool calls, where it accepts
    that;
  - **finds new accounts at no extra cost**, from who the followed accounts
    quote or credit in posts already read. The open search for similar
    accounts runs only on Sundays;
  - **searches the best 20 each day** once more than 20 accounts are
    followed: untried accounts first, then the most recently posting, then
    the longest unchecked;
  - **logs every run's spend** on searching, reading, thinking and writing,
    and shows the cost on the box.

## 1.10.0 — 2026-10-06

### Analyst Desk (owner only, hidden)
- **The OSINT and analyst community on X, condensed.** Once a day, around
  8:15 a.m. Eastern, a new *Analyst Desk* workflow does three steps, using only
  `GROK_API_KEY`:
  1. **Gather:** reads the last 48 hours of posts from the followed accounts
     (batches of up to 20 per X search, falling back to 10).
  2. **Discover:** finds other analyst accounts on the same stories, plus the
     ones the followed accounts quote or credit.
  3. **Condense:** writes a short box: bottom line, main threads (who is
     saying what, linked to the posts), contested claims, single-source
     claims marked unconfirmed, and what the analysts are watching. This pass
     does no searching, so every link is a post the gather step returned.
- **Self-growing list.** It starts with 20 accounts: @sentdefender,
  @Osinttechnical, @IntelCrab, @Faytuks, @AuroraIntel, @ELINTNews,
  @Global_Mil_Info, @RALee85, @KofmanMichael, @wartranslated, @Tendar,
  @noelreports, @GeoConfirmed, @oryxspioenkop, @CalibreObscura, @detresfa_,
  @TheStudyofWar, @JominiW, @Archer83Able and @CovertShores.
  - An account found on two different days is followed from then on, up to
    40 accounts.
  - Found accounts not seen for three weeks are dropped.
  - The list lives in `data/analyst/roster.json`.
- **Hidden on the page** behind its own gesture, separate from the Tazewell
  brief. It shows the followed accounts (new ones marked) and today's finds,
  and can be read aloud.
- Brief me says "IntelCrab reports", not "at IntelCrab reports".

## 1.9.0 — 2026-10-05

### Area brief: Tazewell County (owner only, hidden)
- **A daily area brief** for Tazewell County, VA (24651): Tazewell, North
  Tazewell, Richlands, Cedar Bluff and Bluefield, with Bluefield WV and Mercer
  County, plus neighbouring counties when something spills over.
  - **Topics:** law enforcement and courts (sheriff, state police, town
    police), fire/EMS/rescue, hazards (NWS alerts, flooding, roads, power,
    water), and local and state politics.
  - **Schedule:** written every morning at about 6:47 a.m. Eastern by a new
    *Area Brief* workflow, using the existing `GROK_API_KEY` secret and
    nothing else.
  - **Names and specifics:** police and court items give names, ages and
    hometowns as the source reports them, plus the charges, bond, court dates,
    locations, agencies and times. Minors stay unnamed unless an official
    source names them, and charges are written as charges.
  - **Free leads first:** NWS alerts for seven counties, Google News, and
    local outlets (WVVA, Bluefield Daily Telegraph, Richlands News-Press, WJHL,
    WVNS, Cardinal News, Lootpress, WOAY). Game-stream listings and obituaries
    are filtered out. Grok then searches X and the web with a budget of about
    8 searches.
- **Hidden on the page** until the owner's gesture, with no passphrase or
  setup. It is hidden, not locked: the file sits in the public repository.
  It can be read aloud with Brief me.
- **Brief me** can now read any brief on the page, not only the main one.
- **Brief me fix:** words before a mid-word stop such as "U.S.", "P.L.A." or
  "6:47" were skipped when spoken. Text is now split word by word, so
  nothing is dropped.

## 1.8.0 — 2026-09-26

### Brief me (new)
- **The brief, read aloud as a briefing.** 🔊 BRIEF ME in the toolbar opens a
  player at the bottom of the screen. It uses the device's own speech voices:
  free, nothing uploaded, and it works offline once the page has loaded.
- **Written for the ear.** The text is rewritten into a spoken script before
  it is read:
  - It opens with the collection time in Zulu. It says "Section one",
    "Bottom line up front" and "Assessment:".
  - Chips are spoken as "From social media:", "Reported:", "Confirmed:" and
    "Unverified chatter:".
  - X handles become "accounts on X", and citation numbers, links, the
    "searched:" notes and "(Section 2)" references are dropped.
  - Times are spoken as "fourteen zero three Zulu". The collection date is not
    repeated on every line.
  - Symbols are spoken as words: "~" → "about", ">150" → "more than 150",
    "24–48h" → "24 to 48 hours".
  - Acronyms a voice would say as a word are spelled out (U.S., P.L.A.,
    A.D.I.Z.).
  - Forecasts are read as "Forecast two: open", and each indicator as "Watch
    for… That would mean… First sign… Assessed…".
- **Two modes.** *Full brief* runs about 7 minutes today. *Key judgements*
  reads the bottom line, each theatre's assessment, the forecast check and the
  indicators, in about 3.
- **Player controls:**
  - play/pause, line and section skip, and a progress bar you can tap to jump;
  - speed from 0.85× to 1.5×;
  - a voice picker that ranks the device's best English voices first and
    leaves out the novelty ones;
  - the line being read is highlighted and followed down the page, and
    tapping any line reads from there;
  - the screen stays awake while it plays.

## 1.7.1 — 2026-09-26

### Signals
- **LISTEN no longer takes you off the page.** The receivers are plain-http
  sites, which an https page may not embed, so they open in a tab of their own.
  - That tab is reused and retuned for each station.
  - A note under the cards says what to do next: SHARE TAB AUDIO on a
    desktop, MICROPHONE or a recording on a phone.
  - Where the browser will not open a tab at all (an in-app browser), the
    receiver opens in place. Coming back lands on the Signals section with a
    note on how to run both together.
- **Monitor reports get their own Reddit request.** Sharing one feed with the
  busy defence subreddits pushed a week of UVB-76/HFGCS posts out of Reddit's
  100-post window within hours. r/uvb76, r/numbersstations, r/HFGCS and
  r/shortwave are now fetched separately, 20 s after the first request, with
  one retry if Reddit answers 429. The half-hourly refreshes alternate which
  Reddit request goes first, since the runner's second request is often
  refused.
- **The week of reports survives a refused request.** Each run reads the
  reports already published (`assets/signals.json`, deployed, not committed),
  adds what it got, and drops anything older than 7 days.

## 1.7.0 — 2026-09-26

### Signals — UVB-76 & HFGCS (new section)
- **Listen live:** each station card has buttons that open a public web
  receiver already tuned:
  - UVB-76 on 4625 kHz, USB or AM;
  - HFGCS on 8992 and 11175 kHz, USB;
  - links to the KiwiSDR map and list for a receiver nearer you.
- **Spectrum analyzer in the page** (Web Audio; nothing is uploaded):
  - *Sources:* another tab's audio (share the receiver's tab, desktop
    Chrome/Edge), the microphone, or a recording.
  - *Live view:* a scrolling waterfall with UTC ticks, a spectrum line with
    peak hold, and a cursor readout of frequency, level and time.
  - *Recording view:* a full time-by-frequency picture with a time axis; tap
    it to play from that point.
  - *Settings:* range 3–24 kHz, FFT 1024–16384, four colour maps, floor and
    ceiling, and auto level.
  - *Saving:* PNG snapshot, recorded clips (webm), marks, and events as CSV.
- **Detectors,** on their own fixed spectrum so settings never change what they
  find:
  - *pulse train:* sub-band periodicity, which reports the Buzzer's rate per
    minute;
  - *voice?:* the moment-to-moment change of the speech band, a stretch of
    it;
  - pulse trains starting and stopping.

  Tested on synthetic buzz, voice and noise recordings, including a buzz 2 dB
  under the noise: rates were measured to within 0.1/min, and noise with
  static crashes gave no detections. Live monitoring keeps running while the
  tab is in the background.
- **Monitor reports:** a new `signals` wire desk kept for 7 days, fed by:
  - r/uvb76, r/numbersstations and r/HFGCS;
  - r/shortwave posts that match the stations;
  - numbers-stations.com.

  Each report is tagged UVB-76 or HFGCS, and they are listed in the section
  and on the wire.
- The brief's STRATEGIC line may cite strategic radio activity, as timing only:
  the content is encrypted, so it is weak evidence.

## 1.6.0 — 2026-09-26

### Local Intelligence Brief
- **The owner's brief runs on GitHub, on the key already there.** The hidden
  panel (five taps on the version number) no longer holds an xAI key; the copy
  v1.5.8 saved is wiped. It asks GitHub to run the new *Local Brief* workflow,
  which calls Grok with the `GROK_API_KEY` secret, exactly as the main brief
  does, then shows the result about two minutes later.
- **Private in a public repository.** Everything about a run is public, so the
  panel encrypts the ZIP with the owner's passphrase before sending it, the
  workflow masks it in the log, and the finished brief is committed encrypted
  (PBKDF2 + AES-GCM) to `data/local-brief/`; the last ten are kept. The same
  passphrase is stored as the `LOCAL_BRIEF_PASSPHRASE` secret.
- **The phone holds only** a fine-grained GitHub token limited to running and
  reading this repository's Actions -- it cannot read secrets or change code --
  and the passphrase. "Forget this device" removes both.
- The panel follows the run and says what went wrong: a rejected token, a token
  without the right permission, a failed run (with a link to it), or a
  passphrase that does not match the secret.

## 1.5.8 — 2026-09-26

### Local Intelligence Brief
- **A private panel instead of a code.** The owner's controls are gone from the
  public page. Tapping the version number in the header five times opens a
  private panel where the owner pastes their xAI key once; it is saved on that
  device only. From then on that device -- and only that device -- shows a small
  "my local brief" button with a ZIP box, remembering the last ZIP, and a
  "forget this device" link. The public section keeps only the
  bring-your-own-key box. What protects the owner's key is that it never leaves
  their devices; hiding the way in just keeps the controls out of sight.
- xAI confirmed it accepts browser requests from the site (CORS preflight 200,
  any origin, any header), so both boxes work from the live page.

## 1.5.7 — 2026-09-26

### Local Intelligence Brief
- **Usable with your own key.** The section said to use your own xAI key but
  gave nowhere to enter one: the only way in was a four-digit access code, and
  the key was asked for in a pop-up that many phone browsers block. There is now
  a key box on the page -- no code needed -- with an option to remember the key
  in that browser and a link to forget it.
- **The owner code means something.** The old code, 0330, was written in the
  page's source for anyone to read. It is gone. The owner enters a code and
  their key once per device; the key is saved there encrypted under the code
  (PBKDF2 + AES-GCM), and the code is stored nowhere. On any other device the
  code unlocks nothing.
- **Plain errors.** A key xAI rejects says so; a request the browser refuses to
  send says that instead, and that the key was not the problem.
- **Does xAI allow it?** Each feed refresh now asks xAI the same CORS question a
  browser does and records the answer in `assets/feed-status.json`
  (`xai_browser`), so it is known whether the local brief can run from the page.
- The switch that could publish the collection key in the page is removed.

## 1.5.6 — 2026-09-26

### Appalachistan
- **Honest about what the data is.** Rebuilt with full-geometry lengths, the
  trail measures 2,108 miles (was 2,077) against the official ~2,197 -- OSM's
  line is smoother than the trail as measured on the ground. The HERE tab now
  says so with this build's own numbers (about 90 miles low at Katahdin, less
  further south), and the fine print no longer promises a close match.
- **Water warning.** OpenStreetMap has only 219 water sources along the whole
  trail, a small fraction of the real springs and streams; at Damascus the
  "next water" it listed was 21 miles on. The list now says in plain terms that
  a gap does not mean there is no water, and to plan water from a current guide
  or recent hiker reports.

## 1.5.5 — 2026-09-26

### Appalachistan
- **Trail miles measured on the real line.** The first complete build (all 14
  sections: 383 shelters, 219 water sources, 489 campsites, 631 peaks, 456
  viewpoints, 147 waterfalls, 66 trailheads, 143 trail towns) measured the
  trail at 2,077 miles, about 120 short of its official ~2,200. The line is
  simplified to keep the file small, and measuring the simplified line
  straightened every switchback and bend. Each way now carries its length
  measured on OpenStreetMap's full geometry, and trail miles along the route are
  scaled to it; the page reads those miles rather than measuring the drawing.
- The page no longer claims its miles match a guidebook's to a few tenths: they
  come from OpenStreetMap's line and are for distances between points.
- A forced rebuild now refetches every section but keeps each cached one until
  it is replaced, so a rebuild that stalls halfway loses nothing.

## 1.5.4 — 2026-09-25

### Appalachistan
- **Trail miles start at Springer.** The second build brought in 12 of the
  trail's 14 sections -- 293 shelters, 131 water sources, 212 campsites, 460
  peaks, 307 viewpoints, 117 waterfalls, 43 trailheads and 122 trail towns --
  but measured the route as 0 miles: it started from the southernmost point in
  the data, which with Georgia still missing was the Approach Trail's lone
  stretch at Amicalola Falls. The route now starts from the trail end nearest
  Springer Mountain's summit.
- Every section relation found is remembered, even when part of the search
  fails, so later runs never lose track of one.

## 1.5.3 — 2026-09-25

### Appalachistan
- **The trail fills in over several runs.** The first build in its own job
  found all 14 of the trail's relations but got only 3 of them (153 miles, no
  points) before every Overpass server was answering 429 or 504. Each section
  is now kept in `data/trail_sections.json` as soon as it arrives, and the
  next run fetches only what is still missing, so a bad night costs nothing
  already won. The build runs daily -- and returns immediately, without
  querying Overpass, once the data is complete and under a month old. Requests
  are spaced twelve seconds apart, and a "too many requests" answer is waited
  out for a minute rather than counted as a failure.
- The map says when the trail data is incomplete and how many sections are in.

## 1.5.2 — 2026-09-25

### Appalachistan
- **The trail build has its own workflow.** Even section by section, a slow
  Overpass held the half-hourly feed refresh -- and with it every site deploy,
  the evening brief included -- for a quarter of an hour, and the run was
  cancelled. The trail data is static, so it no longer belongs in that job:
  *Build Trail Data* runs weekly and on demand, builds the file and commits it,
  and every deploy carries the committed copy. The feed refresh never contacts
  Overpass. Each request is capped at two minutes, a server that fails twice is
  skipped for the rest of the run, and the whole build stops after an hour; an
  incomplete build never replaces a complete one.

## 1.5.1 — 2026-09-25

### Appalachistan
- **Trail data did not build.** The first run asked Overpass for the whole
  trail and everything near it in one request, and all three public servers
  answered 504 (gateway timeout). The trail is now fetched the way it is
  mapped: two tiny queries find the relation and its sections, then each
  section's line and nearby points come in a request of their own, with a
  pause between them.
- **No hammering while Overpass is down.** A failed build leaves a small marker
  on the site, and the half-hourly refresh waits three hours before trying
  again instead of spending five minutes on it every run. A build missing any
  section is published but retried the next day until it is complete. The map
  says when the trail data is still being built.

## 1.5.0 — 2026-09-25

### Appalachistan
A trail map for the Appalachian Trail at the bottom of the page, built to be
carried: it keeps working with no signal.

- **Maps.** USGS Topo, USGS Imagery + Topo and USGS Shaded Relief (public
  domain), plus the USGS 3DEP lidar hillshade -- the bare ground at about a
  metre, which shows switchbacks, trail benches, old grades and stream cuts
  under the canopy that no topo draws. Online only: OpenTopoMap, OpenStreetMap
  (footpaths to zoom 19), Esri sub-metre imagery, and the Waymarked Trails
  hiking-route overlay. The map zooms to 19.
- **Trail data.** The whole AT line and, near it, shelters, campsites, water,
  peaks, viewpoints, trailheads, waterfalls and trail towns, from
  OpenStreetMap. Built on the site's next refresh, then re-read from the live
  site and rebuilt monthly, so Overpass is queried once a month, not every half
  hour. Each point carries a trail mile from Springer, measured along the
  line; miles are only published when the route comes out between 2,050 and
  2,350 miles long, and breaks under 300 m (a ford, the Kennebec ferry) are
  bridged first.
- **GPS.** Position with its accuracy circle, follow mode, a heading arrow
  (GPS course, or the phone's compass), and the screen kept awake while it
  runs. Coordinates as decimal degrees, degrees-minutes, DMS, UTM and
  USNG/MGRS (the grid US search and rescue uses; checked against pyproj and
  the mgrs library).
- **On the trail.** Your trail mile and distance off the trail; the next water,
  shelter and campsite northbound and southbound by trail distance; the
  nearest shelter, water, trailhead and town in a straight line; sunrise,
  sunset, last light and daylight left, computed on the phone.
- **Go to** any shelter, waypoint or map point: distance, true bearing, a
  pointing arrow and the along-trail distance.
- **Track** recording with distance, moving time, pace and rough climb;
  **waypoints**; **GPX export** of both and **GPX import** of routes from
  other apps; **measure** a route by tapping it out.
- **Emergency** card: coordinates in large type in decimal and USNG, trail
  mile, a text-message link and copy/share of the location, a 911 link, and
  the nearest ways out.
- **Offline.** A service worker keeps the page, the map library, the trail
  data and every USGS tile looked at on the device. The OFFLINE tab saves the
  current view or a stretch of trail between two miles (1.5 km either side),
  to zoom 16 for the topo or 17 for the lidar, with the tile count and size
  shown first. If the phone shows signal but the network stalls, the saved
  page opens after six seconds instead of hanging.

The page says plainly what it is not: a substitute for a paper map and
compass; a recorder that runs with the screen off; a source of guidebook
miles.

### Page
- The Mushroom Body and the Brief Archive sections fold down to their heading
  line, closed by default; the choice is remembered.

## 1.4.0 — 2026-09-25

### Page
- **Wire panel.** The headlines the pipeline reads for the brief -- about 30
  outlets' own feeds plus four defence subreddits and CISA's exploited
  vulnerabilities list -- are now on the page too, under WIRE. The half-hourly
  feed refresh re-reads them, so the panel stays current while the brief ages:
  anything published since the brief was collected is marked NEW, and the
  header shows how many. Filter by theatre, by what came in since the brief, or
  by stories two or more outlets carried. Headlines only, each linked to its
  outlet; links that are not plain http(s) are dropped. Costs nothing.
- **GPS JAM layer.** Aircraft broadcast how accurate they believe their own GPS
  position is; when that collapses for many aircraft in one area at once, the
  usual cause is jamming or spoofing. The collector now reads that from the
  ADS-B picture it already gathers -- with nine extra sample points over the
  Baltic, the Kola border, the Black Sea, the eastern Mediterranean, the
  Levant, Iraq, the Caucasus and the India-Pakistan border -- and marks 1-degree
  squares where over 2% (amber) or 10% (red) of airborne civil aircraft report
  degraded GPS over the last six hours. A cell needs five sightings and two
  different aircraft, so one bad receiver is not "jamming"; military
  transponders, MLAT and aircraft on the ground are left out. On both globes,
  with a detail panel, box-select and the terrain activity layer. The same
  signal gpsjam.org maps daily. Costs nothing.
- **Weather at the site.** The terrain panel now shows the weather where you
  are looking, from Open-Meteo (free, no key): conditions, wind and gusts in
  knots, visibility, cloud, precipitation, and the next 24 hours' worst gust,
  rain chance and lowest visibility, with sunrise and sunset in UTC. Gusts over
  25 kn and visibility under 5 km are highlighted. A model forecast, and
  labelled as one.

## 1.3.2 — 2026-09-25

### Brief
- **Headline feeds that failed.** The first live run read 23 of 29 feeds.
  Reddit answered the first subreddit and rate-limited the other three, so the
  four now come in one request, each post still labelled with its subreddit.
  ISW and Times of Israel refuse the runner (403) and Focus Taiwan's feed is gone
  (404); Ukrainska Pravda, Middle East Eye, the Jerusalem Post and the Taipei
  Times stand in for them.

## 1.3.1 — 2026-09-25

### Brief
- **Wrong links.** The first 1.3.0 brief cost $0.148 (six searches, down from
  ten to twelve) but cited the headline list badly: it numbered its links as
  footnotes and hung the same X post on a CISA advisory, a Supreme Court ruling
  and the Ukrainian General Staff report. Headlines are now handed over as
  ready-made markdown links, the tasking says each item carries its own, and the
  run log warns when one link is cited on several items.
- **Quiet theatres with headlines.** It called the Americas, South Asia and
  Strategic quiet with 106 headlines in hand. A theatre with a headline in the
  window may no longer be called quiet.
- **Assessments dropped.** It wrote no section Assessments and no confidence
  statements. A short checklist at the end of the tasking now covers
  Assessments, links, quiet verdicts and OR queries.

## 1.3.0 — 2026-09-25

### Brief
- **Free headlines, fewer paid searches.** Searches were most of the bill
  (about $0.20 a run; the prompt and the written brief were a few cents), and
  most web searches were finding what an outlet's RSS feed publishes anyway.
  The pipeline now reads about 25 feeds and CISA's Known Exploited
  Vulnerabilities list before the model starts and hands it the headlines from
  the window -- grouped by theatre, with a story several outlets carried merged
  into one line naming all of them. The model cites those directly and spends
  its searches on X and on detail.
- **A search budget.** The tasking asked for roughly twenty searches a run
  (both tools on every theatre, three Reddit searches, two per section for 3
  and 4); it now states a budget of about eight, mostly X. The five or six
  `site:reddit.com` searches per run, which produced no Reddit citation in any
  recent brief, are gone: four defence subreddits come in through their feeds
  instead, when Reddit lets the runner in.
- **X search limited to the window.** Posts from before the collection window
  are no longer returned, so each X search spends its results on usable posts.
  If the API rejects the date limit, the run retries once without it.
- **Cost in the log.** Each run prints its cost in dollars and its search count
  against the budget; both are in `assets/feed-status.json`. A feed that fails
  is named there under `wire_detail`.

## 1.2.0 — 2026-09-25

### Globe
- **Leads layers.** The navigational warnings and conflict hotspots the
  collector hands the model are now on the globe too, under a new LEADS group.
  Conflict hotspots (pink) are sized by how many separate outlets reported them.
  Navigational warnings (lime) show a marker plus the area the warning actually
  names -- its outline, track line or radius -- drawn on the surface and parsed
  from the warning's own coordinates, with each lettered area kept separate.
  Both open in the detail panel (full warning text; the outlets behind a
  hotspot), work with box-select, show in the terrain panel's activity layer, and
  offer BEFORE / AFTER imagery. A warning's date is the day it was issued, and
  the panel says the activity it announces may fall later.

### Brief
- **Navigational warnings were stale.** The first live run kept 24 of 386
  "active" warnings, and the newest of them was 868 days old -- permanent
  ranges, old ordnance reports, cable-laying ships. The collector now asks NGA
  several ways and keeps the freshest answer, logging what each returned; drops
  warnings issued more than 45 days ago; drops routine commercial survey and
  cable work; and if the newest warning of all is over three weeks old, reports
  the feed as frozen rather than passing old notices off as news. "Submarine
  volcanic activity" is no longer filed as a military exercise, and unexploded
  ordnance is labelled as such rather than as live fire.
- **Sections 3 and 4 must be searched.** The first brief under 1.1.1 issued no
  search at all for Technology/Cyber or Homeland, then called both quiet. Each
  now needs its searches and a "searched:" line before a quiet verdict, and the
  run log warns when a section is called quiet without one.

### What the first 1.1.1 brief did well
It scored all four of the previous brief's calls with mixed verdicts, gave every
new indicator a probability term and every assessment a confidence, and followed
a GDELT lead to Ethiopia -- outside its usual theatres -- noting it as unverified.

## 1.1.1 — 2026-09-25

The first numbered build. It rolls up everything shipped to date, plus this
release's changes.

### Site analysis
- **Before / after imagery around an event's date.** An event on the globe or
  the event board opens its ground straight onto two Sentinel-2 passes: the
  latest clear one before the date and the earliest clear one after it, with a
  slider to swipe between them. The date comes from the event's source where
  it gave one, otherwise from the start of the reporting brief's collection
  window, so nothing labelled "before" can post-date the event. Any date can
  also be entered by hand. If no pass has come over since the date, the page
  says so rather than showing an older one.
- **Cloud over *this* ground, not the whole granule.** Each candidate pass is
  ranked by its own per-pixel scene classification, read at a coarse overview
  for a few kilobytes. Taipei's granule reported 32% cloud while the city
  itself was 88% overcast; the panel now picks the pass that is 8% cloud over
  the city.
- **Infrared and SWIR views.** Colour infrared (vegetation health, clearing,
  flooding) and shortwave infrared (burn scars, fire, disturbed earth, less
  haze). Both passes in a comparison share one stretch, with cloud excluded from
  it, so colour differences come from the ground rather than the processing.
- **USGS 3DEP elevation** where it exists: native 1/3 arc-second posts read
  straight from the USGS files, with the global tiles as fallback.

### Brief
- **Forecast check.** Each run scores the previous brief's indicators as
  TRIGGERED, NOT TRIGGERED, OPEN or OVERTAKEN, and a TRIGGERED verdict has to
  point at a sourced item in the brief.
- **Estimative language.** Judgements use the intelligence community's standard
  probability terms, each with a defined range, and every assessment states its
  confidence separately. New indicators must be specific enough to score.
- **Primary-source leads.** Active NGA maritime navigational warnings (missile
  firings, rocket debris areas, live fire) and GDELT armed-conflict hotspots
  are collected before the model starts and handed to it to work through. A
  warning can be cited as the official notice it is. GDELT is a guide to where
  to search and is never cited as evidence. A "leads worked" line records what
  was followed up.
- Fixed: the previous brief's forecasts and open questions were fed back to the
  next run as items it had already reported.

### Page
- **You can see what you selected.** Tapping a contact puts a lock-on reticle
  on it, in its own colour, which follows it as the globe turns or as a
  satellite moves. A card on the globe names it, with DETAILS to jump to the
  full panel and × to clear. A tap that hits nothing shows a brief ring, so a
  miss is distinguishable from a hit. Before this, the 3D globe drew no mark at
  all, and on a phone the only feedback was a panel below the fold.
- **SHOW ON GLOBE turns the 3D globe.** It, and every other jump-to-place
  button, only ever rotated the 2D globe, so on the 3D view it selected an
  event and left it on the far side of the planet. It now flies the event to
  the centre of the view.
- Appalachian Intel named as publisher; tridents replace the swords.
- The header shows when the brief was actually collected. It had been showing
  the half-hourly feed refresh, which reported "0m since collection" on briefs
  most of a day old.
- The next-collection countdown includes the 23:00 UTC run.
- The title holds one line on phones.
