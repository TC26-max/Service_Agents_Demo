# Deploy guide

The site is one Vercel project (team `service-agents-demo`, project `nimbus-ai-demos`) serving the built page and the security page from `backend/public/` and six serverless functions from `backend/api/` (chat, voice, health, CSP reports, the Red Team Arena, and the honeypot). The URL stays stable; a custom domain can be added later without breaking links.

## How releases flow (v3.1 and later)

GitHub drives deploys. The Vercel project is connected to `TC26-max/Service_Agents_Demo` with **Root Directory** `backend`:

1. Every change lands on a branch and goes through a pull request. Vercel builds a preview deployment for it automatically and links it on the pull request.
2. `npm test` runs on the pull request in GitHub Actions (build, eval, five gates, both audit probes), with the Lighthouse budget and a screenshot diff beside it. Do not merge on red.
3. Check the preview: hard refresh, status pill shows `Live · hybrid RAG · v<version>`, one cited answer, one escalation, the X-ray, one arena attempt, `/security.html`, phone width, and that `/lib/security.mjs` returns the 404 page.
4. Merge to `main`. Vercel deploys production from it.
5. If the head, title, description, or card image changed: `linkedin.com/post-inspector` on the URL, then remove and re-add the LinkedIn Featured card. Old shares keep their old preview.

One-time setup (already needed once for v3.1): in Vercel, open the project, then **Settings > Git**, and connect `TC26-max/Service_Agents_Demo`; then **Settings > Build and Deployment > Root Directory**, set `backend`, and save. Environment variables are unaffected.

Manual fallback, when Git deploys are unavailable: `node build.mjs && cd backend && npx vercel --prod` (login expires periodically: `npx vercel login`).

## What is served

Only `backend/public/` is published as static files (`outputDirectory: "public"` in the generated `vercel.json`). Server code (`api/`, `lib/`), the prompts (`personas/`), the knowledge base (`kb.json`) and `version.json` sit beside the functions and are bundled into them; requests for them get the 404 page (audit N-10).

## Environment variables (Production)

| Name | Required | Notes |
|---|---|---|
| `API_KEY` | yes | Gemini API key. |
| `PROVIDER` | yes | `gemini`. |
| `CHAT_MODEL` | no | Comma list, round-robin. Default `gemini-2.5-flash`, which Google now serves only to existing users; `gemini-3.5-flash-lite` is Google's recommended replacement (audit N-13). Request bodies adapt to the model family. |
| `TOKEN_SECRET` | recommended | Secret for the short-lived voice token, separate from the provider key (audit N-22). Any long random string, for example the output of `openssl rand -hex 32`. Until it is set, the token secret is derived from `API_KEY` as in v3.0. Changing it only signs visitors' open pages out of voice for up to 15 minutes. |
| `ARENA_ENABLED` | no | The Red Team Arena's kill switch: `0` turns it off (the page says so; everything else keeps working). On by default. |
| `ARENA_MODEL` | no | The arena's model. Default `gemini-3.5-flash-lite` with the Gemini provider, so arena traffic never competes with the main bots for the same model quota; falls back to `CHAT_MODEL` if that model is unavailable on the key. |
| `HTTPBL_KEY` | no | A free Project Honey Pot http:BL access key (12 letters, from projecthoneypot.org after signing up). When set, addresses listed as recent abusers get a tighter allowance on chat and the arena. IPv4 only; never blocks on this signal alone. `HTTPBL_THRESHOLD` (default 25) sets the threat score that counts. |
| `TOP_K`, `FAITHFULNESS`, `ALLOW_ORIGIN`, `STT_MODEL`, `EMBED_MODEL`, `API_BASE`, `TRUST_XFF` | no | See `backend/README.md`. |

Set them in the Vercel dashboard (**Settings > Environment Variables**) or with `npx vercel env add NAME production`. Changes take effect on the next deployment (redeploy the latest production deployment, or merge anything).

## Owner steps that only the dashboards can do

These come from AUDIT-2026-11-26.md and have no code equivalent:

1. **Edge rate limit (N-01).** Vercel **Firewall > Rules > Add rule**: if the request path starts with `/api/`, rate limit by IP, fixed window of 60 seconds, 40 requests, action `429`. Hobby plans allow one rate-limit rule per project; this is the one to use. The in-function limiter still applies behind it.
2. **Gemini paid tier (N-03).** In Google AI Studio, open the project that owns the API key and set up billing. Google's terms (effective Mar 23, 2026) ask that personal information not be sent to unpaid services and allow only paid services for users in the EEA, UK and Switzerland. The page now carries a privacy note and the sales bot suggests example contact details either way.
3. **Voice token secret (N-22).** Add `TOKEN_SECRET` as above.
4. **Vulnerability reports (N-21).** In the GitHub repo, **Settings > Advanced Security** (or **Code security**), enable **Private vulnerability reporting**. `/.well-known/security.txt`, the security page and the arena all point reporters there; security.txt expires on 2027-11-26 and must be renewed before then.
5. **Optional: http:BL (Phase 3).** Sign up at projecthoneypot.org, request an http:BL access key, and add it as `HTTPBL_KEY`.
6. **Optional: NVD API key.** The daily dependency watch asks the NVD only when a CVE record has no score of its own. A free key (nvd.nist.gov, Request an API Key) added as the repository secret `NVD_API_KEY` makes those lookups faster; without it they still work, more slowly.

## Switching the model (N-13)

1. In Vercel, set `CHAT_MODEL` to `gemini-3.5-flash-lite` (Preview first: add it to the Preview environment and open a pull request preview).
2. Open `/api/health?deep=1` on that deployment: `canary.ok` must be `true`, and the status pill must read Live.
3. Run `API_KEY=... PROVIDER=gemini CHAT_MODEL=gemini-3.5-flash-lite npm run eval:live` locally to record the hybrid retrieval number, and ask a few questions from the Tested page by hand.
4. Set the same value for Production and redeploy. The daily `canary` GitHub Action keeps checking it.

## Why the build step exists

`vercel.json` carries a Content-Security-Policy whose `script-src` pins the SHA-256 of each inline script. Editing any script by hand in `backend/public/index.html` breaks the page under that policy; editing the template and rebuilding recomputes the hashes. The gates serve the page under the exact deploy headers and fail on any CSP violation, so a broken hash cannot reach production through `npm test`. Violations seen by real browsers are reported to `/api/csp-report` and logged as directive, blocked origin and page path only.

## Health and rollbacks

`GET /api/health` returns `{ ok, version, provider, model, token }` without spending a model call; the page's status pill reads it. `GET /api/health?deep=1` adds `canary`, one small model call cached per warm instance (6 hours after a success, 10 minutes after a failure, at most 6 deep checks per visitor per hour); the page runs it once per visit and the daily `canary` workflow runs it from GitHub. Vercel keeps previous deployments: **Deployments**, then **Promote** on an earlier one (or `npx vercel promote <deployment-url>`) rolls back in seconds.

## Cost and limits

Vercel free tier plus pennies of Gemini usage. Fair-use limits, per warm instance, counting accepted requests only: chat 20 per 5 minutes and 120 per day per visitor, 600 per day per instance; voice 10 per 5 minutes and 30 per day per visitor, 150 per day per instance; the arena 12 per 10 minutes and 40 per day per visitor, 400 per day per instance, with attacks capped at 1,500 characters and replies at 1,200. The arena uses keyword retrieval only, so it never spends an embedding call. A chat request carries at most 12 turns and 12,000 characters (4,000 per message); voice clips must be WAV and under about 15 seconds. The function logs a line when an instance passes 80% of its daily budget and when it runs out.
