# Deploy guide

The site is one Vercel project (team `service-agents-demo`, project `nimbus-ai-demos`) serving the built page and three serverless functions from `backend/`. The URL stays stable; a custom domain can be added later without breaking links.

## Every release

1. Edit sources only: `src/index.template.html`, `kb.json`, `backend/personas/personas.json`, `backend/lib/retrieval.mjs`, `version.json` (bump version and build date), `findings.json`, `eval/gold.json`.
2. `npm test` (build, eval, four gates, audit probe). Do not deploy on red.
3. `cd backend && npx vercel --prod` (login expires periodically: `npx vercel login`).
4. Verify on the live site: hard refresh, status pill shows `Live · hybrid RAG · v<version>`, one cited answer, one escalation, the X-ray, phone width.
5. If the head, title, description, or card image changed: `linkedin.com/post-inspector` on the URL, then remove and re-add the LinkedIn Featured card. Old shares keep their old preview.
6. `git add -A && git commit && git push` with the repo identity set to the GitHub account name (never a personal name).

## Environment variables (Production)

`API_KEY`, `PROVIDER=gemini`, `CHAT_MODEL=gemini-2.5-flash`, optional `TOP_K`, `FAITHFULNESS`, `ALLOW_ORIGIN`. Set with `npx vercel env add NAME production`; changes take effect on the next deploy.

## Why the build step exists

`vercel.json` carries a Content-Security-Policy whose `script-src` pins the SHA-256 of each inline script. Editing any script by hand in `backend/index.html` breaks the page under that policy; editing the template and rebuilding recomputes the hashes. The gates serve the page under the exact deploy headers and fail on any CSP violation, so a broken hash cannot reach production through `npm test`.

## Health and rollbacks

`GET /api/health` returns `{ ok, version, provider, model }` without spending a model call; the page's status pill reads it. Vercel keeps previous deployments: `npx vercel ls` and `npx vercel promote <deployment-url>` roll back in seconds.

## Cost and limits

Vercel free tier plus pennies of Gemini usage. Fair-use limits: 20 chat messages per 5 minutes per visitor, 600 per day per warm instance; voice 10 per 5 minutes, 150 per day; message cap 4,000 characters, last 40 turns.
