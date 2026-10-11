# Cheap Fuel Near Me

Lists the cheapest fuel near you using the UK Government Fuel Finder API. Free to run: a GitHub Action fetches prices every 15 minutes and publishes a static site on GitHub Pages.

- `scripts/refresh.mjs` signs in with your Fuel Finder OAuth client, pulls every forecourt and price, and writes `dist/`: the page plus the stations split into ~16-mile grid tiles (`data/t/*.json`) and an index (`data/meta.json`).
- `site/index.html` looks up the postcode (postcodes.io), loads only the tiles around it, and sorts by price in the browser.
- `.github/workflows/refresh.yml` runs the script on a schedule and deploys `dist/` to Pages. If a refresh fails, nothing is deployed and the previous prices stay live.

Fuel codes: `E10`, `E5`, `B7_STANDARD`, `B7_PREMIUM`, `B10`, `HVO`.

## Setup

1. Get API credentials (free, GOV.UK One Login):
   https://www.developer.fuel-finder.service.gov.uk/fuel-finder/get-started-ifr/onelogin
2. Push this folder to a **public** GitHub repo (Pages and unlimited Action minutes are free for public repos).
3. Add the secrets (Settings → Secrets and variables → Actions, or `gh secret set FF_CLIENT_ID` / `gh secret set FF_CLIENT_SECRET`).
4. Settings → Pages → Source: **GitHub Actions**.
5. Actions → Refresh prices → Run workflow. The site appears at `https://<user>.github.io/<repo>/`.

## Local

```
npm run sample   # fake stations around London, Manchester, Glasgow
npm run serve    # http://localhost:8787
```

`FF_CLIENT_ID=.. FF_CLIENT_SECRET=.. npm run refresh` builds with real data.

## Notes

- The secret never reaches the browser: it lives in GitHub Actions secrets and only the derived prices are published.
- Bad credentials lock you out of the token endpoint for 5 minutes (HTTP 429).
- GitHub can start scheduled runs a few minutes late, and turns schedules off in public repos after 60 days without a commit. Re-enable it from the Actions tab if prices stop updating.
- Prices outside 50–400p are dropped as obvious data-entry errors. Prices older than 7 days are shown as stale.
- Fair Use Policy: keep the "Report a wrong price" link and the timestamps if you make this public.
