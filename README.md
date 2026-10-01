# TAM Map

A total-addressable-market map for vertical market software, built for companies that sell to Main Street businesses. It plots three layers on one map: the **accounts** (sized by enrollment, sites, players, whatever the niche counts), the **channels** that reach the buyer before any ad does (libraries, leagues, associations), and the **results** already on the board. A tier rule ranks everything untouched by size and drive distance from the wins, and pairs each next move with its nearest partner venue.

The worked example is SMC Solutions, a chess education company in Santa Clara County: 26 school districts, 44 public library branches, 8 community centers, and 11 venues already won. Type any other niche into the box at the top and Claude generates the same config (buyer, accounts with sizes and coordinates, channels, tier rule) so the map reruns for it.

## How it works

- `index.html` is the whole front end. No build step, no framework. The map is an SVG drawn from a config object; sizing, tiering, and next moves are computed in the page from editable inputs.
- `api/generate.js` is a Vercel serverless function. It takes `{ niche, geography }`, calls the Claude Messages API with a tool schema that mirrors the config shape, and returns the JSON. The page adds the result as a new tab and keeps it in the browser.
- Statuses (Untouched / Warm / Active / Won) are clickable on every account and venue, and persist per browser.

## Run locally

```bash
npm install
cp .env.example .env.local     # add your ANTHROPIC_API_KEY
npx vercel dev                 # serves index.html and /api/generate at http://localhost:3000
```

Opening `index.html` directly in a browser works for the SMC map and the templates, but the generator needs the API route, so use `vercel dev` or the deployed site for that.

## Deploy

1. Push this repo to GitHub.
2. In Vercel, **Add New → Project → Import** the repo. Framework preset: **Other**. Leave build and output settings empty.
3. Under **Environment Variables**, add `ANTHROPIC_API_KEY`. Optional: `ANTHROPIC_MODEL`, `RATE_LIMIT_PER_IP`, `RATE_LIMIT_GLOBAL`.
4. Deploy. The page is at the root; the API is at `/api/generate`.

## Rate limiting

`api/generate.js` caps generations per IP and per day in memory. Serverless instances don't share memory, so treat it as a deterrent. For a hard cap, swap the `hits` map for Vercel KV or Upstash Redis.

## Data notes

SMC enrollment figures come from Ed-Data and CDE district profiles (2024–25 and 2025–26); values marked ~ are rounded. Library branches come from the Santa Clara County Library District, San José Public Library, and city library systems. Generated niches are Claude's first pass from public data and are labeled as such in the page; verify a row before relying on it.
