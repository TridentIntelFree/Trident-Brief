# Changelog

Versions are MAJOR.MINOR.PATCH, kept in the `VERSION` file and shown in the
page header and footer. Bump PATCH for fixes, MINOR for a new feature or layer,
MAJOR for a change to what the brief is.

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
