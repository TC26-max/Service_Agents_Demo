# Grounded backend (Vercel root directory)

Generated page plus four Vercel Node functions. Do not hand-edit `public/index.html`, `vercel.json`, `kb.json` or `version.json` here: they are written by `node build.mjs` from the sources in the repo root.

```
backend/
  public/               the ONLY static root (vercel.json outputDirectory): built page, 404 page,
                        og-image.png, favicon.svg, favicon-32.png, llms.txt, robots.txt, sitemap.xml,
                        .well-known/security.txt
  api/chat.js           POST: hybrid RAG chat (SSE or JSON), and mode:"retrieve" (rank only)
  api/transcribe.js     POST: speech-to-text for WAV audio, requires the x-demo-token from /api/health
  api/health.js         GET: health, version, voice token; never spends provider calls
  api/csp-report.js     POST: CSP violation reports, logged as counts-only fields
  lib/retrieval.mjs     the one retriever (also injected into the page at build)
  lib/security.mjs      client IP resolution, JSON body parsing, demo token
  lib/limits.mjs        fair-use limiter shared by the functions (accepted requests only)
  personas/personas.json, personas/rules.json   the shipped prompts and the rules every prompt must contain
  kb.json               copied from ../kb.json at build (bundled into the chat function, not published)
  vercel.json           output directory, functions config, security headers (CSP pins the inline script hashes)
  version.json          version and build date (from ../version.json)
  ingest.mjs            optional: pre-bake kb-embeddings.json (ignored by git; embeddings are built on first request)
```

## Environment

- `API_KEY` (required), `PROVIDER` = `gemini` | `openai` | `mistral` (default openai), `CHAT_MODEL` (comma list, round-robin), `EMBED_MODEL`, `API_BASE`
- `TOKEN_SECRET` (recommended): secret for the voice token, independent of the provider key
- `TOP_K` (default 3, max 6), `FAITHFULNESS=1` to enable the verification call, `ALLOW_ORIGIN` (comma list of origins allowed to call the API cross-site; the page itself is same-origin and needs none), `STT_MODEL`, `TRUST_XFF=1` only behind a proxy that appends the client address to `x-forwarded-for`

Environment changes need a redeploy.

## Security model, stated exactly

- The persona is server-owned. Client messages are role-whitelisted (user, assistant); nothing a client sends can carry the system role. A request carries at most 12 turns and 12,000 characters, and one without a visitor message is refused before any provider call.
- Visitor knowledge-base edits are accepted as at most 3 passages of 240 characters, labelled VISITOR-EDITED in the sources block and declared untrusted in the persona. They live for the request only.
- Provider errors are logged server-side and never echoed. Rate limiting is per warm instance, keyed on `x-real-ip`, counts accepted requests only, and gives each address a daily share of the instance budget. The voice token is friction against scripted use, not authentication.
- Assistant turns in the history are still written by the client and are not yet signed (audit N-08, scheduled).
- There is no login, no user data and no database; nothing on the page is a security control beyond what is listed here.

## Deploy

Git deploys from `main` with this folder as the Vercel Root Directory; see `../DEPLOY-GUIDE.md`. Manual fallback:

```bash
node build.mjs && cd backend && npx vercel --prod
```

Any edit to an inline script changes its CSP hash, so always rebuild before deploying.
