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
to work through: active NGA maritime navigational warnings (missile firings,
rocket debris areas, live fire) and GDELT armed-conflict hotspots. Each run also
scores the previous brief's indicators and warnings against what happened.

It also reads about 25 outlets' own RSS feeds (world desks, theatre outlets,
defence, maritime, space, cyber, US homeland, and four defence subreddits) plus
CISA's Known Exploited Vulnerabilities list, and hands the model the headlines
from the collection window. Those cost nothing, so the model's paid searches go
to X and to detail rather than to finding stories a feed already had.

On the page, the same headlines appear in a WIRE panel that the half-hourly
feed refresh keeps current, with anything newer than the brief marked NEW. The
globe's GPS JAM layer marks where many aircraft at once report degraded GPS
accuracy (the gpsjam.org method, over a rolling six hours), and the terrain
panel shows the site's weather from Open-Meteo. None of these calls a model.

## Appalachistan

The trail-map section at the bottom of the page (`assets/appalachistan.js`,
with Leaflet 1.9.4 vendored under `assets/leaflet/`, BSD-2). Its trail data,
`assets/appalachia.json`, is built from OpenStreetMap through Overpass by the
pipeline and re-read from the live site between monthly rebuilds. `sw.js` is
the service worker that keeps the page, the map and saved USGS tiles on the
device so the section works with no signal. Tiles from OpenTopoMap,
OpenStreetMap, Esri and Waymarked Trails are never stored, as their terms
require.

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

## Layout

| Path | Purpose |
|---|---|
| `generate_brief_final.py` | Collection + render pipeline |
| `template.html` | Page template, `__TOKEN__` placeholders |
| `index.html` | Build artifact — regenerated on every deploy, not hand-edited |
| `latest-brief.json` | Last successful brief, used as the cache fallback |
| `archive/` | Prior briefs plus a generated `index.json` the page reads |
| `.github/workflows/generate-brief.yml` | Daily schedule at 11:00 UTC, plus manual dispatch |

## Versions

The build version lives in `VERSION` (currently 1.5.1) and appears in the page
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

`index.html` is excluded from that commit because the local-brief feature embeds
`GROK_API_KEY` into the page at render time. A static host has nowhere to keep a
secret, so any key used by browser-side code is readable by visitors.
