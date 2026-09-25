# Changelog

Versions are MAJOR.MINOR.PATCH, kept in the `VERSION` file and shown in the
page header and footer. Bump PATCH for fixes, MINOR for a new feature or layer,
MAJOR for a change to what the brief is.

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
