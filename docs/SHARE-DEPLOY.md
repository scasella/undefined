# One-click sharing: deploy your own share endpoint

By default **Share this session** is a manual flow: download the recording, host it somewhere that serves the raw file
with CORS (a gist works), paste the URL. Nothing is uploaded and no server is involved.

If you run your own copy of the site, you can add a **Create link** button to that dialog. It uploads the recording to a
small Cloudflare Worker *you* deploy (`server/share/`), which stores it in an R2 bucket under its content hash and
serves it back to anyone who opens the link. The public site does not use one unless its owner builds it with
`VITE_SHARE_ENDPOINT`; without that variable the dialog is the manual flow, unchanged.

What the Worker does (`server/share/worker.ts`):

- `POST /` with a recording, at most 2 MB. It is checked with the site's own loader (`src/share/source.ts`, imported
  directly, so the server and the site cannot disagree about what a valid recording is). The validated copy, serialized
  as JSON, is stored under its sha-256 hex digest. The answer is `{"hash": "...", "url": "https://.../<hash>"}`;
  uploading the same recording again gives the same hash and writes nothing.
- `GET /<hash>` (64 lowercase hex characters, nothing else) returns it as `application/json` with
  `Access-Control-Allow-Origin: *` and `Cache-Control: public, max-age=31536000, immutable`. Anything else is a 404.
- `OPTIONS` answers the CORS preflight.

## Prerequisites

- A Cloudflare account (the free plan is enough) with R2 enabled. R2 asks for a payment method even on its free tier.
- Node 20.19+ or 22.12+ and this repository checked out. No scaffolding (`npm create cloudflare`) is needed: the Worker
  and its `wrangler.toml` are already in `server/share/`. Wrangler runs through `npx` and is not added to the project.

## Deploy

```sh
cd server/share
npx wrangler@latest login                                  # opens a browser to authorize Wrangler
npx wrangler@latest r2 bucket create undefined-recordings  # the name wrangler.toml binds as RECORDINGS
npx wrangler@latest deploy                                 # prints https://undefined-share.<your-subdomain>.workers.dev
```

To use another bucket or Worker name, edit `name` and `bucket_name` in `server/share/wrangler.toml` first. To try it
locally first, `npx wrangler@latest dev` serves it at `http://localhost:8787` with a local bucket (the dev site accepts
`http://localhost` endpoints).

## Test it with curl

```sh
ENDPOINT=https://undefined-share.<your-subdomain>.workers.dev
curl -sS -X POST --data-binary @public/recordings/fibonacci.json -H 'Content-Type: application/json' "$ENDPOINT/"
# {"hash":"<64 hex>","url":"https://.../<64 hex>"}   201 the first time, 200 after that
curl -sSI "$ENDPOINT/<64 hex>"            # 200, content-type application/json, cache-control ... immutable
curl -sS -X POST --data-binary '{}' "$ENDPOINT/"   # 422 with the loader's reason
```

(Run the first command from the repository root, or give the full path to a recording.)

## Point the site at it

The endpoint is read at **build** time from `VITE_SHARE_ENDPOINT` (https, or http on localhost; no query string; a
trailing slash is dropped). An empty or invalid value means no button.

- Locally: `VITE_SHARE_ENDPOINT=https://undefined-share.<you>.workers.dev npm run build`, then serve `dist/`.
- GitHub Pages (`.github/workflows/pages.yml`): in the repository, **Settings → Secrets and variables → Actions →
  Variables → New repository variable**, name `VITE_SHARE_ENDPOINT`, value the Worker URL. Then re-run **Deploy the
  replay site** (Actions tab → *Run workflow*) or push to `main`. Delete the variable and redeploy to turn it off.

No Content-Security-Policy change is needed: the site's `connect-src` already allows `https:` (that is how
`?recording=<url>` links load), and `script-src` is untouched. The link the dialog makes is
`<your site>?recording=<endpoint>/<hash>`, which the existing loader fetches, validates and asks about before anything
loads, exactly like a gist link.

## Cost and limits

Prices change; check Cloudflare's current pages for Workers and R2. At the time of writing the free tiers cover a
personal deployment comfortably: Workers allows 100,000 requests a day; R2 includes 10 GB-month of storage, 1 million
writes and 10 million reads a month, and charges nothing for egress. A recording is usually tens of KB (the shipped
ones are 20–230 KB); the Worker refuses anything over 2 MB (`MAX_UPLOAD_BYTES` in `worker.ts`).

The endpoint is open: anyone who finds its URL can upload any valid recording up to 2 MB. The content hash makes
repeated uploads of the same file free, but nothing else limits volume. If that matters, add a Cloudflare rate-limiting
rule for `POST` on the Worker's route, or take the Worker down (`npx wrangler@latest delete`).

## Privacy

- **Content-addressed.** The stored object is the recording and nothing else; its name is the sha-256 of its bytes.
  Anyone with the link (or the hash) can read it, so treat a link as public. A recording holds the specs and test code,
  the prompts and the model's candidates, the calls typed and any dataset rows used in the session; the dialog says so
  next to the button.
- **Nothing about the uploader.** The Worker stores no IP address, no request headers, no user agent and no metadata on
  the object, and it writes no logs (`console` is never called; `observability` is off in `wrangler.toml`). Cloudflare
  itself still processes requests as it does for any Worker (for example its default request metrics in the dashboard);
  that is outside this code.
- No accounts, cookies or analytics. The site sends the upload with `credentials: 'omit'`.

## Delete a recording

Objects never expire on their own. To remove one (the hash is the last part of the share link):

```sh
cd server/share
npx wrangler@latest r2 object delete undefined-recordings/<64 hex> --remote
```

Browsers that already fetched it may keep their cached copy (it was served as immutable for a year). To remove
everything, delete the objects in the R2 dashboard (or empty and delete the bucket) and `npx wrangler@latest delete`
the Worker.
