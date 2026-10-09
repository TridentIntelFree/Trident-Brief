# Changelog

Versions are MAJOR.MINOR.PATCH, kept in the `VERSION` file and shown in the
page header and footer. Bump PATCH for fixes, MINOR for a new feature or layer,
MAJOR for a change to what the brief is.

## 1.35.0 — 2026-10-09

### Changed: picture presets that just work
Tap a FAX or SSTV preset and wait: nothing needs setting by hand.
- **Each picture and text preset now sets the receiver for the job:**
  - the frequency (fax 1.9 kHz below the listed one, as the stations
    expect) and sideband;
  - the exact filter edges: fax 1.1–2.7 kHz, SSTV 0.9–2.7 kHz, RTTY
    0.9–2.1 kHz, enough for the signal and a tuning error, and no more,
    so less noise;
  - noise reduction off, because it smears pictures.

  Moving the width slider by hand takes over again.
- **Weather fax sets itself up:**
  - **Line rate:** "auto" by default. It is read from the phasing lines,
    or measured from how the chart repeats (60, 90, 120 or 240 a minute).
    Changing it redraws the chart without losing any of it.
  - **Tuning:** a receiver a little off frequency used to make the whole
    chart too dark or washed out. The black and white tones are now found
    in the sound's spectrum and the error, up to 300 Hz, is taken out. The
    status says how far off it was.
  - **Straight charts even when joined part way:** without phasing lines,
    the slant is measured from how the picture repeats eight lines apart.
  - **LINE UP** (also run once by itself for a chart joined part way) finds
    the chart's border and moves it to the edge. It is a best guess, and
    SHIFT is still there.
  - The sound is kept at a fixed rate, so nothing already received is lost
    when any of these change.
- **SSTV forgives a sender off frequency** by up to 250 Hz, common among
  amateurs. The start tone is measured and the whole picture read relative
  to it.
- Tested on synthesized charts with noise:
  - a chart joined part way, 150 Hz off and with a 0.08% clock error, came
    out straight and lined up by its border, with the tuning measured as
    150 Hz;
  - a 60-lines-a-minute chart, 120 Hz off: the line rate was found from its
    phasing lines and the tuning measured as 110 Hz;
  - four SSTV formats sent 120–180 Hz off frequency decoded as cleanly as
    tuned ones.

  Real fading and interference still streak a chart.

## 1.34.0 — 2026-10-09

### Added: identify and decode, in the radio section
A new IDENTIFY & DECODE panel under the tuner. It works on whatever you are
hearing: the live tuner, a shared tab, the microphone, or a recording you
open. Everything runs on your device, and nothing is sent anywhere. Only
modes sent in the clear are decoded; encrypted traffic cannot be read, and
nothing tries.
- **WHAT IS THIS?** measures the last 8 seconds and gives the likely
  matches, with an honest confidence (likely, possible, a guess) and the
  reasons. It measures:
  - how wide the signal is;
  - how many tones it uses and how far apart;
  - how fast it changes;
  - whether it is keyed on and off, sweeps, pulses or holds steady;
  - whether it is a tone sliding the way pictures are sent.

  It weighs those with the frequency against about 60 known stations (time
  signals, weather fax and RTTY, the Russian markers, US Air Force HFGCS,
  VOLMET, beacons, FT8, the SSTV calling frequencies) and the band plan. Each
  match has a DECODE IT button where a decoder exists, and a link to hear
  samples on the Signal Identification Wiki.
- **RTTY to text.** It finds the two tones itself (170, 425, 450 or 850 Hz
  apart). It tries 45.45, 50 and 75 baud and both tone orders at once, and
  keeps whichever reads as text. Save or copy the text.
- **Weather fax to a picture.** The start tone begins a new chart, and the
  phasing lines line it up and straighten its slant. SHIFT and the lean
  buttons fix a chart joined part way. Save as PNG.
- **SSTV to a picture.** Martin 1 and 2, Scottie 1, 2 and DX, Robot 36 and
  72, and PD 50 to PD 290, started by the picture's own VIS code, or by hand
  if the start was missed. Each line is re-aligned on its sync pulse, so a
  slightly fast or slow receiver does not slant the picture. Pictures
  received stay in a gallery on the page.
- **Picture & text presets** (a second row under the presets) tune
  straight to stations that send pictures or text, and start the decoder
  that reads them:
  - weather fax: US Coast Guard Boston (4235, 6340.5, 9110, 12750 kHz),
    New Orleans (8503.9), Point Reyes (8682), and the German Weather
    Service (7880);
  - SSTV: the amateur calling frequencies 14230, 14233, 7171, 3845 and
    28680 kHz;
  - RTTY: the German Weather Service's teleprinter on 10100.8 and 4583 kHz.

  Fax is tuned 1.9 kHz below the listed frequency, as the stations expect,
  and a receiver near each station is picked. SCAN still visits only the
  listening presets.
- **Morse to text** has moved into the same panel, and now also works on a
  shared tab, the microphone or a recording.
- **PICTURE VIEW** makes the analyzer slow and tall, for pictures and words
  drawn straight into a signal.
- **"New to radio? What am I looking at?"**: a short guide to the waterfall,
  the shapes signals make, sidebands, and what decoding legally means.
- Tested on synthesized signals with noise and clock error: RTTY decoded
  100% in four set-ups, fax and four SSTV formats came out clean, and the
  identifier named all 14 kinds of test signal correctly. Real signals
  fade and overlap, so expect errors on weak ones.
- Cost: none. No model, no new site contacted by the page.

### Fixed: the radio after scrolling around
- **Scrolling past the radio no longer retunes it.** The waterfall used to
  stop the page scrolling under a finger and count lifting the finger as a
  tap, so it retuned to wherever your thumb was. On a computer, the mouse
  wheel over it retuned too. Now:
  - a vertical swipe scrolls the page;
  - only a sideways drag moves the band;
  - only a short, still tap tunes;
  - the wheel tunes only after you click into the waterfall (or with
    Shift held).
- **The pictures pause while the radio is off screen.** The sound and the
  decoders keep running. They are measured and redrawn when you come back,
  so they are no longer drawn at the wrong size after the section was
  folded or out of view.

### Fixed: Whisper transcripts
- **Delete them:** each transcript has a ✕, and there is CLEAR ALL. Deleting
  also removes its line from the detections list.
- **No more hundreds of repeats.** Getting stuck on one phrase is a known
  Whisper failure. It is now kept in check three ways:
  - Whisper may only write as much as the clip's length allows;
  - if it still loops, it tries once more in its timestamp mode with a
    repetition penalty;
  - any repeat left over is folded to one copy marked ×N, with a plain note
    that it got stuck.

  A message read twice on purpose is left alone.

## 1.33.3 — 2026-10-09

### Changed: Tazewell's space-weather guide is hidden with the Tazewell report
- The "For Tazewell" guide (aurora chance, HF radio, GPS, power grid) has
  left the public SPACE WX section. It now closes the hidden Tazewell report,
  behind "Appalachian Intel" ×3 and the code 0330, and is read aloud with it.
- SPACE WX keeps the general picture: scales, Kp, solar wind, flares, CMEs,
  the forecasters' discussion and alerts.

## 1.33.2 — 2026-10-08

### Added: NOAA forecasters' discussion in space weather
- Solar wind now arrives (1.33.1 worked). NASA's DONKI still answers GitHub's
  servers with something other than JSON, so CME details may be missing.
- **NOAA's forecasters' discussion** is now read on each refresh: SWPC's
  forecasters write it twice a day, in words. It covers solar activity,
  energetic particles, solar wind and geospace, including which CMEs they
  are tracking and when any is expected at Earth. It appears as a card in
  SPACE WX, in the brief's prompt and in `intel.py space`, so CME news gets
  through even when DONKI does not answer.
- When DONKI fails, the note now records what both NASA addresses
  returned, so the cause can be found.
- Cost: free; a few hundred more prompt tokens per brief.

## 1.33.1 — 2026-10-08

### Fixed: space weather's first live run
- **Solar wind** answered 404: NOAA has moved that file. It now reads NOAA's
  real-time solar-wind files first (the active spacecraft only), and falls
  back to the older files.
- **CMEs** came back as something other than JSON. DONKI is now asked for
  JSON, and an empty answer counts as no CMEs. If NASA's CCMC server still
  fails, it tries api.nasa.gov with NASA's published demo key (not a secret,
  nothing to set up). A failure now records what came back, so the cause
  shows in the next run.
- **Alert titles** such as "CONTINUED ALERT: Electron 2MeV Integral Flux"
  now read properly.
- The first live run otherwise worked: NOAA scales, Kp, GOES X-rays and
  alerts all arrived. They showed today's M6.7 flare, with the Type II and IV
  radio bursts that usually go with a CME.

## 1.33.0 — 2026-10-08

### Added: space weather
- **A SPACE WEATHER section** (header link SPACE WX), folded on open:
  - the NOAA scales now: G (geomagnetic storm), S (solar radiation) and
    R (radio blackout), the worst in the past 24 hours, and the 3-day
    outlook with the chance of blackouts and radiation storms;
  - the Kp index, observed and forecast;
  - the solar wind at L1: speed, density, Bz and Bt;
  - GOES X-rays now and the M and X flares of the past 7 days;
  - CMEs of the past 7 days, with the WSA-Enlil modelled Earth arrival
    and Kp for any heading this way;
  - SWPC alerts and warnings from the past 48 hours;
  - **For Tazewell**, a rough guide: aurora chance, HF radio, GPS and the
    power grid, keeping what is happening now apart from what is forecast.
- Read on every half-hourly refresh by the server, from NOAA's Space Weather
  Prediction Center and NASA's DONKI through CCMC (no key). Visitors'
  browsers contact neither. The PRIVACY panel lists both.
- **The brief's prompt** gets a short space-weather summary. The model is
  told to mention it only at G3, R3 or S2 or stronger, for an Earth-directed
  CME, or as a possible cause of GPS or HF-radio trouble.
- **`intel.py space`** for sessions, plus a line in the overview and a
  space-weather record in the daily digests on intel-data.
- Cost: free data. The prompt grows by a few hundred tokens, a fraction of a
  cent per brief.
- Tested on mock NOAA and NASA responses in both layouts SWPC uses. The live
  feeds are checked on the first GitHub run.

## 1.32.0 — 2026-10-08

### Changed: the hidden area brief covers 200 miles around Tazewell
- **One report, Tazewell at the centre.** Each section gives Tazewell County
  and the towns around it in full first, then the region out to about 200
  miles, nearest first: southern West Virginia, eastern Kentucky, northeast
  Tennessee, southwest Virginia and northwest North Carolina. In the region
  it reports the bigger things: major and federal cases, crime and drug
  trends, state government actions, big employers and energy, severe weather
  and interstate closures. Every item says where (town, county, state).
- Written every morning at 6:47 a.m. Eastern by the same job and the same
  `GROK_API_KEY`, still one Grok call. It has more searches (12, was 8) and
  room for a longer answer. Cost: roughly 2–5 cents more a day than the
  county-only brief (it was about 7 cents); the run logs the real figure.
- **"Appalachian Intel" ×3 now asks for a code (0330)** before it opens, once
  per visit. It keeps the brief out of casual reach. It locks nothing: the
  brief is a plain file in the public repository, and the privacy panel says
  so.

## 1.31.0 — 2026-10-08

### Added: printing that prints what you asked for
- **PRINT / PDF** in the header asks what to print:
  - **Brief**, the whole brief as text, with no maps, globe or panels;
  - **Brief, condensed**, the BLUF and the key items (the same ones the
    quick read-aloud uses) on a page or two;
  - **Trail map**, the map on a page of its own, then the panel under it
    (where you are, nearest water, shelter and trailhead, daylight).
- **🖨 PRINT** on the trail map's toolbar prints the map straight away.
- No cost: it is all done on the phone, with no model call.

### Fixed: walking routes find the legal long way round
- **The wide search no longer loses the roads.** Looking 8 km or 20 km out,
  the roads and trails are now fetched as four quarters, one after another,
  with more time for each (2½ minutes). Before, one big request could time
  out, and the planner carried on with no roads at all, then wrongly
  reported private land in the way. If the roads still do not arrive, it now
  says so and does not claim there is no legal route.
- **Joins the nearest point along a road**, not just the road's mapped
  points, which can be a kilometre apart on a straight road. It tries up to
  30 joins within 3 km (was 8 within 1.5 km), no more than 3 to any one
  road. It skips private lanes and driveways, which go nowhere legally.
- **Bridges at the coarse scale:** on a wide search a river could cut a road
  in the grid cell beside its bridge. Road cells next to a bridge now cross.
- **The destination gets no private-land allowance** in the over-the-ground
  route either; only the 250 m to get off the land you start on. That short
  stretch is now described as such, not as "no way round".
- **Virginia DWR land always counts as permit land** (an Access Permit at 17+
  unless you hold a hunting or fishing licence), whatever access PAD-US
  lists. With I HAVE THE PERMITS it counts as public.
- **Says when land data is incomplete.** If a land source holds more parcels
  than it sends, the route says some public land may be missing. PAD-US now
  fetches up to 6,000 parcels (was 3,000).
- Cost: none (free OpenStreetMap, Forest Service and PAD-US data, on the
  phone).

### Changed: easier to get around
- **Every section starts folded** when the app opens, and so does each part
  of the brief. A folded section shows only its heading. Old saved
  "unfolded" settings are ignored.
- **Section links in the header** (BRIEF, GOD'S EYE, TERRAIN, EVENTS, WIRE,
  RADIO, OSINT, INDICATORS, RECURRING, LOCAL INTEL, NOVELTY, ARCHIVE,
  TRAIL MAP) open the section and go to it. Sections with nothing in them
  yet are left out.
- **The globe is less cluttered.** Satellites, rocket bodies and debris now
  start switched off (their buttons still turn them on). A tap picks up
  everything within a finger's width. If more than one thing is there, it
  lists them to choose from, with a button to zoom in.

### Fixed
- **Terrain analysis from the map:** the TERRAIN link on a map point now
  opens the folded terrain section, not just scrolls to it.
- **The blue back-to-top button works.** The trail map's layers were drawn
  over it. The map is now kept in its own layer, so it no longer covers the
  button, the pop-up panels or the "hello" box.
- **Buttons no longer select text** when they are held or tapped quickly,
  and quick taps no longer zoom the page.
- **Read-aloud still reads a folded brief.** It opens each part as it
  reaches it.

## 1.30.3 — 2026-10-08

### Changed: walking routes walk, and never trespass
- Nothing in the planner suggests doing anything but walking. The
  missing-land-data message no longer suggests switching mode, and the
  distance limit no longer says "pick a nearer waypoint".
- **Walks up to 60 km in a straight line** (about 3–4 days) are planned, up
  from 30 km. Beyond 60 km it suggests planning to a waypoint along the way,
  then on from there.
- **PUBLIC LAND ONLY never crosses private land.** The one allowance is up to
  250 m to leave the spot you start on; the destination no longer gets one.
- **If the destination is on private land, or cut off by it**, even after
  the wider search, the route ends at the nearest point you can reach
  legally and says how far that is from the destination.
- **If you start boxed in by private land**, with no legal way off it, it
  says that.

## 1.30.2 — 2026-10-08

### Changed: a walking route stays a walking route
- With PUBLIC LAND ONLY and no legal way in the nearby area, the planner no
  longer suggests driving. It looks again wider, about 8 km and then about
  20 km around, for public roads, trails and public land, roads and trails
  only so the data stays small. It plans the long way round on foot.
- If even that finds nothing, it says so plainly, with no driving
  suggestion: ask the landowner.
- Long routes show their time as days, at 7 hours of walking a day.

## 1.30.1 — 2026-10-08

### Fixed: PUBLIC LAND ONLY routed across known private land
- **It only made private land expensive (40 times the time), never
  forbidden.** From a start surrounded by private pasture, crossing it still
  won against a long detour. Now:
  - private land cannot be walked at all, except within 250 m of the start
    and destination (your own land, where you parked);
  - public roads through it stay walkable;
  - when no all-public way exists, it says so and suggests DRIVE, THEN WALK
    or asking the landowner, instead of drawing a trespass route.
- **No land data means no plan.** If the land-ownership maps do not arrive,
  PUBLIC LAND ONLY refuses to plan rather than quietly ignoring ownership.
- **DRIVE, THEN WALK with PUBLIC LAND ONLY parks for the walk in.** It
  scores every possible parking spot by drive time plus the walk to the
  destination over the ownership map, at 100 m cells, with private land
  impassable. Before, it parked by straight-line distance, which could leave
  you on the private side.

### Added
- **PERMIT LAND: AVOID / I HAVE THE PERMITS.** With permits, restricted
  public land counts as public: state wildlife areas, which in Virginia need
  a DWR Access Permit at 17+ unless you hold a hunting or fishing licence.
- **SHOW LAND OWNERSHIP HERE** (GO TO tab) shades the area on screen: green
  public, amber questionable, unshaded private, each with its reason. The map
  guide now says the base map's own colours do not show ownership.

## 1.30.0 — 2026-10-08

### Added: HOW TO USE THE MAP
- A collapsible guide at the top of the map section, in ten short parts:
  before you go, moving around, GPS, going somewhere, planning a route,
  tracks and pocket mode, waypoints and measuring, in trouble, what the
  colours mean, and what to do if something looks wrong.

### Improved: public land vs questionable vs private
- PUBLIC LAND ONLY now sorts every stretch three ways instead of two:
  - **Public:** Forest Service-owned land; PAD-US open-access land owned by
    a government; public roads; paths tagged for the public.
  - **Questionable:** PAD-US restricted (permit, season or fee) or unknown
    access; conservation easements; open access on private or nonprofit
    land; paths tagged permissive, or with no access tags, on land that is
    not public. It costs 6 times the time.
  - **Private:** costs 40 times the time.
- **PAD-US proclamation boundaries are ignored.** They are a national
  forest's outer line, private inholdings and all.
- Each questionable or private stretch is listed with its reason and drawn in
  amber or red dashes. While routes are compared, public land is shaded green
  and questionable land amber.
- **Gates:** gates on a walking route are listed, with those marked private
  or locked called out. For driving, bollards, blocks and chains stop the
  car, and other gates cost 15 times the time and are reported, unless tagged
  open to cars.

Cost per run: nothing; no model calls.

## 1.29.1 — 2026-10-08

### Fixed: phones running the previous version of the map
- The map snapped back, and the new route settings did not show, until a
  refresh. The service worker served the map script cache-first, so a phone
  ran the version before the last one. The read-aloud script had the same
  problem before. The map script is now fetched fresh whenever there is
  signal, and the saved copy is used only offline.
- The service worker is never taken from the browser's cache, and the page
  asks for a new one a few seconds after opening. When a new one takes over,
  the page reloads once, but not while a track is recording or pocket mode is
  on. (The test browser here would not run an update check at all, so this
  part is not proven here.)

### Changed: route settings where you can see them
- ON FOOT and GETTING THERE now sit at the top of the route section in the GO
  TO tab. They also show before a destination is picked, with how to pick one.
  With a saved route, PLAN AGAIN WITH THESE SETTINGS sits right under them.

## 1.29.0 — 2026-10-08

### Added: route settings, ANYWHERE / PUBLIC LAND ONLY / DRIVE, THEN WALK
- **ON FOOT: ANYWHERE** is the planner as it was: it ignores who owns the land.
- **ON FOOT: PUBLIC LAND ONLY** keeps to land the public may walk. That means
  Forest Service land, from the Forest Service's own ownership map, which
  shows the private inholdings inside a national forest, plus areas PAD-US
  lists as open access. Public roads and paths tagged open count too, wherever
  they run. Off trail is fine on public land. Private land costs forty times
  the time, so a route crosses it only when there is no way round, and then
  each crossing is listed by mile and drawn red-dashed on the map. If no
  public-land data arrives, it says the route cannot tell public from private.
- **GETTING THERE: DRIVE, THEN WALK** drives public roads to the best place to
  leave the car, then walks in by the foot setting chosen.
  - Roads come from OpenStreetMap: everything within 6 km of the start and
    destination, and main roads between.
  - Speeds come from road type and speed limit, and one-way streets are
    respected. All of it is worked out on the phone.
  - The parking spot is the least drive time plus walking time, marked
    "Park here".
  - It gives the drive's cue sheet, and warns about forest roads (gates,
    seasonal closures, clearance). The navigation bar follows the drive and
    the walk as one route.
- The PRIVACY panel lists the Forest Service and PAD-US map servers.

Cost per run: nothing; no model calls.

## 1.28.5 — 2026-10-08

### Fixed: the map snapped back to you while you explored
- Turning GPS on also turns on FOLLOW, and every GPS fix re-centred the map
  on you, even mid-drag or mid-zoom. Now dragging, pinching, the zoom
  buttons, a double tap, the mouse wheel or a tap on the map turns FOLLOW off,
  so you can look around and set waypoints. Press FOLLOW to go back to
  following.

## 1.28.4 — 2026-10-08

### Library: FM 21-76 is in, with a warning
- The library now has **FM 21-76 / MCRP 3-02F *Survival***, the Army and
  Marine Corps manual. It is 571 pages with searchable text, reduced to
  23.9 MB, and checked page by page for readability. With it are the NWS
  lightning brochure and the CDC tick sheet.
- **Its 1992 first aid is partly out of date.** For snakebite it describes
  cutting and suction, which current guidance says never to do. The library
  entry now says so in amber, and says to follow the app's survival guide
  where they differ.
- **Still not fetched:** the newer ATP 3-50.21 and the MSHA mines alert. Their
  hosts answer scripts with a bot check, which is not bypassed. The monthly
  run tries again.

## 1.28.3 — 2026-10-08

### Library: the Army manual, shrunk to fit a phone
- FM 21-76 arrived but is a scan over 30 MB. The library job now shrinks
  scans over 12 MB with Ghostscript (images at about 150 dpi, still readable)
  and keeps them if they come in under 40 MB. The page says when a document
  was reduced.

## 1.28.2 — 2026-10-08

### Library: the Army survival manual from a source that answers
- irp.fas.org and msha.gov answer scripts with an empty bot-check page
  (HTTP 202), and globalsecurity.org asks for payment. Getting round either
  is not on, so those two stay listed and are tried again monthly.
- Added **FM 21-76 / MCRP 3-02F *Survival* (1992)**, the classic Army and
  Marine Corps survival manual, from the Internet Archive.

## 1.28.1 — 2026-10-08

### Fixed: two of the four library manuals did not arrive
- The first fetch got the CDC tick sheet and the NWS lightning brochure. The
  Army survival manual and the MSHA mines alert came back as web pages, most
  likely bot checks, instead of PDFs.
- The fetcher now asks honestly first and then as an ordinary browser, as the
  feed collector does. It tries a second source for the Army manual, and logs
  what each server sent when no PDF arrives.

## 1.28.0 — 2026-10-08

### Added: a survival library of real manuals, for offline
- Inside the survival guide: real public-domain documents, each works of the
  US federal government:
  - **US Army ATP 3-50.21 *Survival* (2018):** the Army's survival manual,
    approved for public release;
  - **NWS "Lightning: Don't Get Caught Outside";**
  - **CDC Tick Removal (2025);**
  - **MSHA "Stay Out of Abandoned Mines".**
- OPEN reads one. SAVE FOR OFFLINE, or SAVE ALL, keeps the PDFs on the phone,
  and the service worker opens them with no signal.
- `library_fetch.py` and `.github/workflows/library.yml` fetch them onto the
  site, because the sandboxes cannot reach those servers. They run when the
  list changes and monthly for new editions. A file must be a PDF under 30 MB,
  or the old copy is kept. No secrets.
- The PRIVACY panel notes the library is served from this site.

Cost per run: nothing; no model calls.

## 1.27.0 — 2026-10-08

### Added: PLAN A WALKING ROUTE (GO TO tab)
- From where you are (or the map centre) to the GO TO destination, up to
  30 km. Planning needs signal once: OpenStreetMap's paths, roads, streams,
  springs and shelters for the area (Overpass), and terrain heights from the
  AWS terrain tiles, a few MB. Everything else is worked out on the phone.
- **Two routes, side by side:**
  - **Trails and roads:** the quickest path over the mapped network. Straight
    off-trail legs are used only to reach it, never over ground steeper than
    30°.
  - **Over the ground (quickest):** the quickest way across a grid of about
    30 m cells. It uses paths where they help and cuts across where the slope
    allows. It never crosses ground steeper than 30° off trail, or a river
    without a bridge.
- **Speed model.** Walking speed is Tobler's hiking function on the slope, at
  0.6 of that off trail.
- **The analysis, kept with the route:**
  - distance, walking time, climb and descent;
  - an elevation profile coloured by steepness, the steepest stretch each way,
    and the mix of trail, track, road and off-trail;
  - arrival against sunset, or that it is dark now and when sunrise is;
  - hazards in order: stretches steeper than 25°, ground over 45° within about
    30 m of the line (drop-offs), stream and river crossings (bridges and fords
    noted), road walks on busy roads, and how much is off trail, with what the
    data cannot see;
  - water, shelters, trailheads and roads (ways out) along it, by mile;
  - a cue sheet ("1.2 mi on Saddle Trail, 0.4 mi on FR 222…").
- **USE THIS** keeps the route on the phone, saves the USGS map about 750 m
  either side of it, and switches the navigation bar to following it:
  - the arrow aims about 80 m ahead on the route;
  - it shows distance and time left;
  - **OFF ROUTE** appears, with the way back, when you are more than about
    50 m off.

  Pocket mode's line shows the same. The route can be exported as GPX.
- Planning is a press of a button, so it also works in private mode. The
  PRIVACY panel names the Overpass servers.

### Fixed
- The track is pink, not orange: orange is the Appalachian Trail.

Cost per run: nothing; no model calls. A visitor's phone uses a few MB when
planning, and about 1–2 MB of map per route kept.

## 1.26.2 — 2026-10-08

### Fixed: a "route" on the map that had nothing to do with your waypoint
- **A destination chosen earlier was remembered across visits** and drawn as a
  red dashed line once GPS came on, with no name on it. It is now labelled
  "GO TO: name" on the map from the start, and a bar over the map says where
  you are going, how far, and which way, with &times; to stop.
- **A track left recording joined separate outings with straight lines**, in
  the same red as the GO TO line. The track is now orange, and it breaks after
  a 10-minute gap or a jump no walker could make; gaps no longer count as
  distance, and GPX export writes each piece as its own segment.

### Added: navigate to a waypoint
- Saving a waypoint from the map asks "Navigate to it now?".
- The navigation bar shows an arrow, distance and bearing (north-up, or
  ahead-up with the compass or while walking), and "YOU ARE THERE" within GPS
  accuracy. Tap it for the GO TO tab, which now offers USE COMPASS.
- Pocket mode's dim line includes the destination's distance and bearing.

## 1.26.1 — 2026-10-08

### Fixed: no way to turn GPS on from the OFFLINE tab
- Only the HERE and EMERGENCY tabs had a GPS button, and the one on the map
  bar said LOCATE. Every tab now shows START GPS, or "GPS on ± m" with STOP GPS,
  and the bar button reads START GPS / GPS ON. GPS needs no signal: tested with
  the network cut and the page loaded from its saved copy.

## 1.26.0 — 2026-10-08

### Added: the trail map as an emergency tool
- **Installs as a real app.** A manifest and trident icons, so "Add to Home
  Screen" opens it full screen, offline from the first tap. Long-press the
  icon (Android) for Map and Emergency shortcuts.
- **POCKET mode** (map bar, TRACK and EMERGENCY tabs). A web page cannot use
  GPS with the screen off on any phone, so this is the nearest thing: the
  screen stays on but pure black (OLED pixels showing black are off), touches
  are locked, and GPS keeps recording the track. A dim line with distance,
  accuracy and time moves every minute. Hold for two seconds to see the way
  out. It says plainly that the power button stops tracking, tells iPhones to
  set Auto-Lock to Never when the screen cannot be kept on, and if the phone
  locks anyway it reports the gap instead of pretending the track is whole.
- **Signal catcher** in the EMERGENCY tab. When a bar comes back, it takes NWS
  weather alerts and the next 12 hours from Open-Meteo for your position
  (rounded to about a kilometre), and saves about 1 MB of USGS map around you
  if that ground was never saved. At most every 30 minutes (10 after a
  failure), only when the phone reports a connection, never in data-saver
  mode, and in private mode only with CHECK NOW. Kept on the device for when
  the signal goes again.
- **Text my location asks four times** before it opens Messages, where Send
  still has to be pressed. The CALL 911 button is gone.
- **Survival guide**, collapsible and saved with the page, written for these
  mountains: lost (blazes, laurel hells, following water), signal and battery,
  being found, cold, lightning, flash floods, water (including mine drainage),
  bears, snakes, ticks, old mines, waterfalls, hunting season, shelter and
  first aid.
- The PRIVACY panel lists the signal catcher's contacts.

Cost per run: nothing; no model calls. A visitor's phone uses two small
requests and about 1 MB of map per new area when signal appears.

## 1.25.2 — 2026-10-08

### Changed: the PRIVACY panel discloses everything, hidden features included
- Hidden features are hidden, not secret. The panel now names them (Tazewell
  area brief, Analyst Desk, Crystal Ball, the "hello" market picks, the
  owner's panel) and says what each contacts: GitHub for data, Polymarket only
  through a clicked link, GitHub's API for the owner's panel. This reverses
  1.25.1's removal of the Crystal Ball and Polymarket names.
- New "What the server does" part: the scheduled jobs read about 70 public
  sources, use Google's and Microsoft's free translation, ask xAI's Grok (Groq
  as a fallback) to search and write, read Polymarket prices, and check
  KiwiSDR receivers weekly. Nothing about visitors goes into any of it.

## 1.25.1 — 2026-10-08

### Fixed: the hidden desks showing in the scroll
- **Phones bring a page back exactly as it was left**, so a desk opened by its
  gesture earlier sat there in the scroll for anyone to see. The hidden desks
  (Crystal Ball, Analyst Desk, Tazewell) now close themselves when a phone
  restores the page from memory, or when you come back after five minutes away,
  unless one is being read aloud.
- **Closed desks are folded too**, with no fold control showing, and they no
  longer leave a fold setting on the device. Only the gesture opens one, and it
  opens unfolded. Read-aloud works as before, and a reading already running
  carries on when the desk is hidden with its "hide" button.
- **The PRIVACY panel gave secrets away:** it named the Crystal Ball and
  Polymarket. It now says only "fonts" and "links to sources".

## 1.25.0 — 2026-10-08

### Added: privacy for visitors
- **A PRIVACY panel**, opened from the footer (or `#privacy`). It says in plain
  words what the page contacts and when, what it keeps on the device, and what
  it cannot hide: GitHub hosts the page and sees visitors' IP addresses; the
  site's owner sees nothing. No accounts, ads, cookies, analytics or pixels.
- **Private mode.** One switch in the panel. The page then asks nobody but
  GitHub for anything on its own: the air picture uses the server's snapshot,
  the space station and the browser-side feed retries stay off, and the trail
  map waits for its button. Anything a visitor presses still works.
- **Erase everything this site saved on this device:** settings, Morse logs,
  offline maps, the offline copy, the speech model and any remembered key or
  token. Only this site's own keys and caches are touched.
- **No referrer.** Other sites are not told which page a visitor came from.
  The OpenStreetMap-based tile servers, which refuse tiles without one, get
  the site name only.
- **The Crystal Ball's fonts are served from this site**, so opening it no
  longer contacts Google Fonts (Cinzel and Cormorant Garamond, SIL OFL 1.1).

Cost per run: nothing; no model calls or new sources.

## 1.24.1 — 2026-10-08

### Fixed: READ IT TO ME still skipped the Crystal Ball and the astrology
- **A stale reader on the phone.** The service worker served the read-aloud
  script cache-first: a saved copy right away, the new one fetched only for
  next time. So phones kept the reader from before the Crystal Ball fix. It is
  now fetched fresh whenever there is signal, with the saved copy only when
  offline, and the renamed cache drops every old copy on the next visit.
- **The astrology was never marked for Key judgements mode**, so that mode
  skipped it. The reading paragraphs now count, and the Heavens has its own
  🔊 READ THE HEAVENS button (10 parts in key judgements, 58 in full).
- Readings other than the main brief end with "The end.", not "End of brief."

## 1.24.0 — 2026-10-08

### Forecasts in four windows, built to be scored
- **Windows:** 48 hours (every morning), a week (weekly), a month (monthly)
  and a year (quarterly), with about 8, 8, 8 and 12 questions.
- **Settling:** every question names how it settles (a source, a threshold, a
  deadline), and each forecast states its base rate.
- **Four forecasters,** each scored against its own baseline:
  - **The engine** (`forecast_engine.py`, free, no model). It forecasts what
    the app has measured for years: Ukraine's air-raid alarms (2022–),
    Israel's rocket and missile alerts (2014–), Russian personnel and drone
    losses as Ukraine's MoD claims them (2022–), and USGS magnitude 6+
    earthquakes (2000–).
    - **How:** the fly brain finds the past days whose state looked most like
      today (the Mushroom Body circuit as a similarity search, Dasgupta et al.
      2017), and what followed them is the forecast, shrunk toward the plain
      base rate.
    - **Fair comparison:** each analog day is asked the question against its
      own recent pace, so a quiet month is a fair comparison.
    - **Settling:** automatic, from the records.
    - **Example:** today it puts Israel's chance of rocket alerts in the next
      week at 33% against a 43% base rate.
  - **The oracle** (Grok, still one call a day) takes the questions the
    records cannot answer, with the engine's numbers and its own scores in
    front of it.
  - **The fly on warnings** matches each oracle question against the brief's
    scored past warnings. It reports how often the most similar ones came
    true, and only when it has four genuine precedents (sharing content
    words, not just a hash).
  - **The crowd:** open Polymarket questions on world affairs are put to the
    oracle blind, and both are scored when they settle.
- **Grading:** a separate small call with web search settles the event
  questions, comparing reported numbers with each threshold (about $0.03, only
  when questions are due). The brief's own forecast check is now told to
  compare numbers with thresholds too, after it marked 16 crossings as
  meeting "more than 20".
- **The ledger:** a Brier score per window and forecaster against its
  baseline, a calibration chart, and recent results with their evidence.
- **"hello":** a small box at the top right opens the prediction-market top
  picks. These are the questions where our blind forecast differs most from
  the market price, with the record against the market once questions settle.
  They are kept out of the Crystal Ball. Not betting advice.
- **Upkeep:**
  - the records cache is shared with the astrology fair test, refreshed
    daily, and fetches only new rows;
  - the newest day of a dataset that grows through the day is no longer
    counted as complete.
- **Deploying:** merges that change the page now go live at once, instead of
  waiting for a scheduled run GitHub may start hours late.
- **Cost:** about $0.02–0.03 a day for the forecast call (more questions on
  the days the longer windows refresh), plus $0.03 for grading on days with
  due questions.

## 1.23.2 — 2026-10-08

### Fixed: forecasts were thrown away before they could be scored
- **The flaw:** a second Crystal Ball run on the same UTC day replaced that
  day's forecasts. A same-day rerun on 6 Oct discarded the first set
  (9 forecasts), and the manual run on the evening of 7 Oct discarded the
  morning's 8. Both sets were genuine forecasts that might have gone wrong,
  so dropping them flattered the record.
- **The fix:** every run's forecasts are now kept and scored, with an ID
  unique to the run.
- **The lost 17** are restored to `data/crystal/forecasts.json` from git
  history, unchanged. The next run resolves the ones that have come due.

## 1.23.1 — 2026-10-08

### Fixed
- The weekly fair test now also reruns whenever one of its record sources has
  never loaded, so the earthquake claims run on the next morning's job rather
  than a week later. USGS cannot be reached from the build sandbox, only from
  GitHub's runner.

## 1.23.0 — 2026-10-08

### The heavens, professional grade, and read against the intel
- **Mundane astrology** (`astro_lore.py`, each morning after the Crystal Ball):
  - **The sky:** planets in their dignity, detriment, exaltation or fall;
    stations; out-of-bounds planets; the lunar node; and a void-of-course
    Moon, computed with Astronomy Engine.
  - **National charts:** the watch theatres, as mundane astrologers commonly
    cast them: US (Sibly), Russia, Ukraine, Israel, Iran, China, Taiwan and
    North Korea. Each shows the transits within 2° now, with its Ascendant
    and Midheaven where the hour is known. Untimed charts leave out the Moon,
    which moves 13° a day.
  - **The last new moon:** set for each capital, with whole-sign houses.
  - **A five-week almanac:** lunations, eclipses, stations and sign changes.
- **The lore against the intel:**
  - **How:** each configuration's traditional mundane meaning (Mars for war,
    Saturn for sanctions and blockades, Neptune for the sea and deception…)
    and every current intel item (forecasts, brief lines, wire headlines) go
    through the same fly-brain hash the Mushroom Body uses. The closest
    overlaps are shown with how far above chance they sit, filtered to
    news about that country where a national chart is involved.
  - **Example:** today Venus square Mars ("alliances strained by force;
    money for weapons") matched the EU's new Russia sanctions list.
- **The fair test:**
  - **What:** astrology's claims are tested against years of real records:
    - Mars afflicted brings war: Ukraine's air-raid alarms (1,656 days),
      Israel's rocket alerts (3,870 days), Russia's claimed losses.
    - Mars retrograde stalls offensives.
    - Full moons bring trouble.
    - Eclipses and lunations bring earthquakes: USGS magnitude 6+ since 2000,
      run on GitHub's runner.
  - **How:** each day is compared with its own month, to remove trends. The
    control is the same sky pattern slid along the calendar 999 times. The
    p-values are shown raw and corrected for testing several claims.
  - **Result:** so far, every claim is no better than chance. The page says so.
  - **Upkeep:** rerun weekly; the daily counts are cached, and only new
    records are fetched.
- **The reading:** written each morning by Grok from these computed facts only.
  - **How:** in the voice of a professional mundane astrologer, covering
    the overview, each nation, where the lore meets the intel, what to watch
    on almanac dates, and the test's verdict, stated plainly.
  - **Cost:** a second, separate call (no searching, about a cent a day), so
    astrology cannot leak into the forecasts. Still labelled as astrology,
    for fun.

### Fixed
- **READ IT TO ME read nothing from the Crystal Ball in Key judgements mode.**
  The redesigned page marked no key judgements. It now reads the Vision, every
  forecast with its odds and words, the Doomsday Clock and the nuclear omen
  (16 parts; 56 in full mode). Glyphs are no longer read aloud.

## 1.22.0 — 2026-10-07

### The Crystal Ball, reimagined
It deliberately no longer matches the rest of the site.
- **The ball:** a 3D glass crystal ball on a bronze stand, slowly turning.
  - **Inside:** violet smoke is ray-marched through the glass.
  - **The glass:** reflects a candle-lit room and has a pale rim.
  - **Around it:** dust drifts in the candlelight.
  - **One orb per forecast:** gold when likely, rose for an even chance, ice
    blue when unlikely. The likelier the forecast, the bigger and brighter
    its orb.
  - **Touch an orb:** it rises to the glass and its forecast opens below.
  - **Drag:** turns the ball and stirs the smoke.
- **The rest:** velvet backdrop and gold Cinzel and Cormorant lettering.
  - **The page:** "The Vision" (the outlook) and a gilded card for the chosen
    forecast, with a glowing probability ring.
  - **The Doomsday Clock:** an antique brass face.
  - **New section names:** the nuclear omen, whispers before the headlines,
    omens rising, the oracle's ledger, visions still unfolding.
- **The heavens tonight, for fun:** a real astrology reading.
  - **The sky is real:** the positions of the Sun, Moon and planets are worked
    out for this moment, in your browser, by Astronomy Engine (MIT, bundled,
    116 KB, loaded only when the ball opens).
  - **What you see:** a zodiac chart with aspect lines, the moon's actual
    phase drawn, and which planets are retrograde.
  - **The reading:** written from traditional meanings, and labelled plainly
    as astrology that forecasts nothing.
  - **Checked:** the positions match the library's separate Python version
    to 0.01°.
- **Phones and old browsers:** without WebGL the ball falls back to a glowing
  CSS orb, and everything else works. The scene stops drawing while it is
  off screen, to save battery.
- **Cost:** nothing per run. No model call, and no new key.

## 1.21.2 — 2026-10-07

### Fixed: the hidden desks seemed not to open
- **The scroll stopped short.** On a phone, the long smooth scroll down to a
  desk was cut short when anything above it changed height, and with
  sections collapsing and opening that happens often. It left you at the
  radio instead of the Crystal Ball. Now the page jumps to the desk and
  re-checks for two seconds, correcting if the page moved. It stops the
  moment you touch or scroll yourself.
- **A desk could reopen folded.** A desk folded last time opened folded, as a
  bare heading far down the page. A gesture now always opens it unfolded.
- **Double-tap zoom on the title.** The title (Analyst Desk ×3) now ignores
  it, like the other gesture targets, so quick taps are not swallowed.
- Tested with every section collapsed and a layout jolt during the scroll:
  all three desks land exactly at the top of the screen, on phone and
  desktop sizes, and the owner panel opens.

## 1.21.1 — 2026-10-07

### Restored: the features that use keys the owner already has
1.21.0 misread "no more keys" as "nothing but GROK_API_KEY", and removed
working features. Everything is back as it was in 1.20.0:
- **AISStream worldwide ships** (`AISSTREAM_API_KEY`). It was set and
  working: the last brief before the removal had 3,308 ships, 2,185 of them
  outside the Baltic, which only AISStream supplies. The run after it had 916.
- **Groq** as the fallback model (`GROQ_API_KEY`).
- **The Local Intelligence Brief** on the page, with your xAI key typed in
  and kept in your browser. Its xAI check showed the page's calls were
  accepted. The browser check is back on the feed refresh.
- **The owner panel** (version ×5), `local-brief.yml` and `local_brief.py`
  (GitHub token + `LOCAL_BRIEF_PASSPHRASE`).
- Not restored: the Gemini `daily-brief.yml`. It had failed on every run and
  had not run since May 2026. Say if you want it back.
- The folding from 1.21.0 stays. The Local Intelligence Brief folds too.

## 1.21.0 — 2026-10-07

### Every section folds
- **Page sections:** all fifteen now fold to their heading. That covers God's
  Eye, Terrain, Event Board, Wire, Signals, OSINT Feed, Indicators,
  Recurring Locations, Your Area, Mushroom Body, Archive, Appalachistan and
  the three hidden desks. Tap the heading or ▾ hide. Each remembers its
  state; Mushroom Body and the Archive start folded as before.
- **The brief's own sections fold too:** each numbered section (1. Chatter …
  6. Frontier) and each theatre inside the sweep has a ▾ button. A nav chip
  or a search hit inside a folded section opens it. The arrow is drawn by CSS,
  so READ IT TO ME never says it aloud.

### Only one key: GROK_API_KEY
Everything that needed another key is gone:
- **Local Intelligence Brief** (it asked for the visitor's own xAI key). Its
  ZIP box stays as **Your Area**, which re-targets God's Eye on a ZIP code
  with no key.
- **The owner's local brief:** the version ×5 panel, `local-brief.yml` and
  `local_brief.py`. It needed a GitHub token and the
  `LOCAL_BRIEF_PASSPHRASE` secret, and had never produced a brief.
- **Groq** as a fallback model (`GROQ_API_KEY`). When Grok fails, the last
  good brief is re-published and flagged as cached, as before.
- **AISStream** worldwide ships (`AISSTREAM_API_KEY`). The keyless regional
  feed (Digitraffic) remains.
- **The old Gemini workflows** (`daily-brief.yml` and a stray nested copy)
  and `generate_brief.py`. The daily one ran a script that no longer existed,
  so it failed every day.
- **The feed refresh's check** of whether xAI accepts calls from a browser,
  which only the removed form needed.
- **Old saved keys:** any keys older versions saved in a browser are wiped on
  the next visit. (Undone in 1.21.1, which restores all of the above except
  the Gemini job.)

## 1.20.0 — 2026-10-07

### Tuner: Morse → text, with a saved log
- **MORSE → TEXT** decodes CW in the tuner's audio, in the browser. Nothing
  is sent anywhere.
  - **Finding the signal:** it finds the strongest steady tone between
    300 and 1500 Hz. Its level is read every 4 ms, with the noise level learnt
    between key-downs.
  - **Speed:** the first ten key-downs are held until the sender's speed is
    known, then decoded, so the opening letters come out right. The speed is
    re-estimated from the last 16 key-downs, so it follows a sender who speeds
    up.
  - **Noise:** a lone blip with two seconds of quiet either side is dropped
    as noise.
  - **Output:** letters, figures, punctuation and prosigns. `*` marks a
    pattern that is not Morse. The tone, speed and signal level are shown
    live.
- **The log keeps the text only, never the tone.** There is one entry per
  channel and burst, with UTC time, frequency and receiver. It is kept in
  this browser across reloads (the last 300). SAVE TEXT downloads it as a
  `.txt` file headed "machine-read and unverified"; COPY and CLEAR are beside
  it.
- **Tested on synthetic Morse** at 12 kHz with noise:
  - **Clean:** no errors at 12, 20, 28 and 35 wpm.
  - **Weak or uneven:** no errors at 6 and 10 dB SNR (in 500 Hz) with 15–30%
    timing jitter; 19 of 20 runs perfect at 22 wpm and 8 dB.
  - **Very weak:** about half the characters wrong at 3 dB.
  - **Noise alone:** 30 s gave no output.
  - **Speed change:** an 18 → 30 wpm switch costs about one letter.
  - **In the page:** a mock receiver streamed "CQ CQ DE UA3ABC K TEST 73",
    which decoded exactly and saved.
  - **Not tested on a real receiver:** the sandbox cannot reach one live.
    Real fading, interference and hand-keying will cost more than the tests
    show.
- Cost: nothing per run.

## 1.19.1 — 2026-10-07

### Courtesy to the sources
- **Asking by name.** Every warning site and translator is now asked as
  `TridentBrief/1.0 (+https://github.com/TridentIntelFree/Trident-Brief)`
  first. Only a site that refuses that (401/403/406/451, or a dropped
  connection) is asked again as a browser. That is decided once per site per
  run, and the run's log names the sites that insisted on a browser.
- **China's articles are read once.** A warning article does not change, so
  each is fetched and translated once and kept in GitHub's Actions cache
  between runs. Only the eleven bureaus' index pages are read each run, which
  cuts up to 30 article requests and a translation batch from every refresh.
  The log shows "N from cache".
- **Off the busy minutes.** Most scheduled jobs land on :00 and :30, so the
  feed refresh moves to :11 and :41, the brief to 11:04 and 23:04 UTC (the
  page's countdown follows), and the old daily job to 00:03.

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
