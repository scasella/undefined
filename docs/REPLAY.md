# Replay, recordings and sharing

How the static site replays recorded sessions, how maintainers re-record them, and how to share a session of your own.
For the optional one-click upload server, see [SHARE-DEPLOY.md](SHARE-DEPLOY.md).

## Replay mode and recordings

Every session is recordable: **Session → Share…** saves a JSON file of the model candidates with their
prompts and progress lines (see [Share a session](#share-a-session) below). Recordings in `apps/site/public/recordings/` are matched by function name + spec hash + tests hash, so
replay works for the unmodified examples and for their **Break it** edits. Edit a spec to something that was never
recorded and replay mode says so, and tells you how to run live.

Maintainers re-record the shipped sessions with `npm run record` (starts the dev server, drives headless Chrome through the
real app against your Codex login, and writes `apps/site/public/recordings/*.json`; it keeps a session only if the first candidate
was rejected and prints how many tries that took). `npm run check:replay` serves the production build with no backend and
checks that each example replays from its recording through the real UI, including each `?opener=` value.

## Share a session

**Session → Share…** works on the static site as well as in live mode, because a session you *replayed* is
shareable too. Three steps:

1. **Download the recording** (`undefined-session.json`). It holds every candidate generated in this page load: live
   ones as generated, replayed ones exactly as they were recorded, credited to the model, Codex version and effort that
   really wrote them (a replayed session is never marked live; a file that mixes both puts the other model on its own
   sessions). The recording includes your spec and test code and any dataset rows used in the session, with the prompts,
   candidates, the calls you typed and each attempt's Codex progress log (which can name local file paths); nothing else. Nothing generated yet: the dialog says so.
2. **Host it** anywhere that serves the raw file with CORS: a GitHub gist's **Raw** URL or `raw.githubusercontent.com`
   both work (a `github.com/…/blob/…` or `gist.github.com/<user>/<id>` page URL is turned into its raw URL for you).
3. **Paste that URL** into the dialog and copy the link it builds: `<this site>?recording=<url>`.

A copy of the site built with the optional `VITE_SHARE_ENDPOINT` replaces steps 2 and 3 with one **Create link** button
that uploads the recording to that endpoint; see [SHARE-DEPLOY.md](SHARE-DEPLOY.md). Share links never carry the page's
own query string, so `?opener=` is not passed on.

Someone who opens the link is asked first; nothing loads or runs on its own. The page fetches that one URL when it
opens (the only request it makes to anywhere other than the site that serves it; see
[What leaves your browser](../README.md#what-leaves-your-browser)),
validates it, and shows what it holds: the functions with their test and property counts, the number of calls,
datasets, the model / CLI / date, anything that will be skipped and why, and the plain warning *"This recording
contains code written by someone else: model-written functions and the test code of the specs. It runs in your
browser's sandbox, which limits what it can do but is not a security boundary. Only load recordings from people you
trust."* A link that fails to load shows the error and the CORS hint.

The same confirmation appears when you **drop a .json file anywhere on the page** (a recording and an exported program
image are told apart by their `format`; an image gets the same *replace your program?* confirmation as **Import
image…**) or use **Session → Load
recording…** (a file picker and a URL field). **Load** adds the recording's specs and datasets (bound to their variable
names) as one revision, *Loaded recording: <title>*, registers its candidates so they replay by hash even when the live
service is up (anything it does not cover goes to the normal generator), types its first call into the REPL, and shows a
dismissible banner: *Replaying a recorded session from <source>: press Enter to run its calls; the gates run live in
your browser.* Each Enter on a recorded call types the next one in. What is checked before anything loads: every
session's spec must hash to what its candidates were recorded under and have a growable name, and every dataset's rows
must hash to their content address and fit the data limits; failures are listed and skipped. A spec of the same name in
your program is replaced (the dialog says so; roll back to undo). An older (version 1) recording that carries only hashes
replays only when you already have the matching spec, for example a shipped example; otherwise the dialog says there is
nothing it can replay. Loaded candidates last for the page load; the specs stay in your program.
