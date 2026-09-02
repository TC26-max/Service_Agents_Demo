# Grounded backend (deploy root)

Generated page plus three Vercel Node functions. Do not hand-edit `index.html`, `vercel.json`, `kb.json` or `version.json` here: they are written by `node build.mjs` from the sources in the repo root.

```
backend/
  index.html            built page (from ../src/index.template.html)
  api/chat.js           POST: hybrid RAG chat (SSE or JSON), and mode:"retrieve" (rank only)
  api/transcribe.js     POST: speech-to-text, requires the x-demo-token from /api/health
  api/health.js         GET: health, version, voice token; never spends provider calls
  lib/retrieval.mjs     the one retriever (also injected into the page at build)
  lib/security.mjs      client IP resolution, demo token
  personas/personas.json, personas/rules.json   the shipped prompts and the rules every prompt must contain
  kb.json               copied from ../kb.json at build
  vercel.json           functions config plus security headers (CSP pins the inline script hashes)
  version.json          version and build date (from ../version.json)
  og-image.png, favicon.svg, favicon-32.png, llms.txt
  ingest.mjs            optional: pre-bake kb-embeddings.json (ignored by git; embeddings are built on first request)
```

## Environment

- `API_KEY` (required), `PROVIDER` = `gemini` | `openai` | `mistral` (default openai), `CHAT_MODEL` (comma list, round-robin), `EMBED_MODEL`, `API_BASE`
- `TOP_K` (default 3, max 6), `FAITHFULNESS=1` to enable the verification call, `ALLOW_ORIGIN` (comma list of origins allowed to call the API cross-site; the page itself is same-origin and needs none), `STT_MODEL`

Environment changes need a redeploy.

## Security model, stated exactly

- The persona is server-owned. Client messages are role-whitelisted (user, assistant); nothing a client sends can carry the system role.
- Visitor knowledge-base edits are accepted as at most 3 passages of 240 characters, labelled VISITOR-EDITED in the sources block and declared untrusted in the persona. They live for the request only.
- Provider errors are logged server-side and never echoed. Rate limiting is per warm instance and keyed on `x-real-ip` or the last `x-forwarded-for` hop. The voice token is friction against scripted use, not authentication.
- There is no login, no user data and no database; nothing on the page is a security control beyond what is listed here.

## Deploy

```bash
node build.mjs && cd backend && npx vercel --prod
```

Any edit to an inline script changes its CSP hash, so always rebuild before deploying.
