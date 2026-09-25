# Changelog

Versions are MAJOR.MINOR.PATCH, kept in the `VERSION` file and shown in the
page header and footer. Bump PATCH for fixes, MINOR for a new feature or layer,
MAJOR for a change to what the brief is.

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
- Appalachian Intel named as publisher; tridents replace the swords.
- The header shows when the brief was actually collected. It had been showing
  the half-hourly feed refresh, which reported "0m since collection" on briefs
  most of a day old.
- The next-collection countdown includes the 23:00 UTC run.
- The title holds one line on phones.
