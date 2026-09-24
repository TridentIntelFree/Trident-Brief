# Trident-Brief

[![Generate Intelligence Brief](https://github.com/TridentIntelFree/Trident-Brief/actions/workflows/generate-brief.yml/badge.svg)](https://github.com/TridentIntelFree/Trident-Brief/actions/workflows/generate-brief.yml)

Daily Intelligence Digest — an automated multi-INT fusion brief published to GitHub Pages.

## What it does

A scheduled GitHub Action tasks Grok (with X search + web search) for a 24-hour
collection across four requirement areas — geopolitical/military, technology and
cybersecurity, UAP, and parapsychology/consciousness research — then renders the
result as a static page. Groq/Llama stands by as a fallback provider; if both are
unavailable the last good brief is re-published and flagged as cached.

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
| Topography | AWS Terrain Tiles (terrarium PNG, public domain) | height, relief, contours, line of sight |
| Slope | derived | where wheels, tracks and feet can go |
| Viewshed | derived, radial sweep with curvature and refraction | what an observer at a point can see |
| Activity | this page's own collection | what has been reported inside this ground |
| Imagery | Sentinel-2 L2A true colour, `sentinel-cogs` on S3 | what is actually there |

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
