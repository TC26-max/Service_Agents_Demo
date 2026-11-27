# Grounded: Provable RAG, AI assistants that cite their sources

_Live at **https://nimbus-ai-demos.vercel.app** · Privately built for demonstration and portfolio purposes only · v3.2.0_

**Grounded** is the demo site; **Nimbus** is the fictional SaaS company its two assistants serve. Built AI-assisted; every behavior specified, tested against a gold set, red-teamed, and explainable. The **Tested** tab on the site lists what broke and how each item is guarded.

## What it is

Two production-style assistants on one page: a **customer-support agent** (escalation-aware, identity-gated, question versus request routing, illustrative NIM-##### ticket cards) and a **sales assistant** (qualifies the visitor, recommends a plan, captures a demo request). Every knowledge answer is retrieved from a 36-passage knowledge base and cited (hand-offs and refusals carry their own badges instead); citation chips open the source with the passage highlighted; the knowledge base is browsable and editable on the page, and edits change the answers for that session, including on the deployed backend.

**Provable RAG** means the retrieval is not a black box. Hybrid search (semantic embeddings plus keyword tf-idf, merged with reciprocal rank fusion) powers every answer, and the **Retrieval X-ray** tab runs the ranking layer alone: type a query, see all 36 passages scored, no generation involved. The same retriever module runs in the page and on the server.

## What is true, precisely

- **Cited answers.** Knowledge answers carry [S#] citations to clickable sources. Escalations, refusals and hand-offs are deliberately uncited and carry their own badges (Handed off, Not in knowledge base, Action claim).
- **Honest hand-offs.** The assistants cannot perform actions. A request for a human, a refund beyond policy, or a security concern produces a warm acknowledgment plus a server-issued illustrative ticket ID; a claim guard flags any reply that pretends an action happened.
- **Identity check.** The support bot asks for the email on file and workspace URL before account specifics. It is illustrative and low-assurance by design; the demo values are shown on screen.
- **Retrieval numbers.** Keyword-path recall on the in-sample-adjacent gold set is stamped into the Tested tab at build time from the shipped retriever; the hybrid number needs a live key (`npm run eval:live`) and is reported as not yet measured until then.
- **Guard layer.** The prompts state the rules, and deterministic code enforces them: invisible characters are stripped from visitor text, earlier answers must carry the server's signature, passages are fenced, and every reply passes output rules before it is final (no requests for card numbers or codes, no contact details that are not in the original knowledge base, no recital of the prompts, no stretched discounts). The badge under an answer says which rule changed it. The prompts themselves are public and linked from the page.
- **Faithfulness verification** exists behind `FAITHFULNESS=1` and is off in the public deployment to keep it free.
- **Fair use.** 20 chat messages per 5 minutes and 120 per day per visitor, voice 10 per 5 minutes, per warm instance, counting accepted requests only; a request carries at most 12 turns and 12,000 characters. Not authentication, not a security boundary; it bounds cost. A Vercel WAF rule in front of it is recommended (see `DEPLOY-GUIDE.md`).
- **Privacy.** Questions and voice clips are sent to Google Gemini to write the answer; the page says so under the composer, and the sales assistant suggests example contact details instead of real ones.

## How it is built

- `src/index.template.html` plus `kb.json`, `backend/personas/personas.json`, `backend/lib/retrieval.mjs`, `version.json`, `findings.json` and `eval/results.json` are the single sources. `node build.mjs` assembles `backend/public/index.html`, `backend/vercel.json` (with a Content-Security-Policy that pins the SHA-256 of each inline script) and `FIXES-APPLIED-<date>.md`. The build is deterministic.
- `backend/api/chat.js`: hybrid retrieval, citation-grounded generation, SSE streaming with a JSON fallback, capped and labelled visitor edits, role-whitelisted messages, server-issued ticket IDs, fixed error copy. `backend/api/transcribe.js`: speech-to-text behind a short-lived page token. `backend/api/health.js`: health probe that drives the status pill, with a cached model canary at `?deep=1`. `backend/lib/guard.mjs`: the guard layer. `backend/api/csp-report.js`: counts-only CSP violation reports.
- Provider-flexible by environment variable (currently Google Gemini: `gemini-embedding-001` and `gemini-2.5-flash` with reasoning disabled).
- Vercel Root Directory is `backend/`, and only `backend/public/` is served as static files: server code, prompts and the knowledge base are bundled into the functions, never published as URLs. Pull requests get preview deployments and `main` deploys production; see `DEPLOY-GUIDE.md`.

## Tests and gates

`npm test` runs the build, the retrieval eval, and three gates, then both audit probes:

| Gate | What it asserts |
|---|---|
| `test/gate-static.mjs` | no em or en dashes anywhere; every persona rule present in both personas and in the built page; docs do not overstate; deterministic build; CSP hashes match the built scripts; pen name exactly once; version stamps consistent |
| `test/gate-endpoint.mjs` | real handlers over HTTP with the provider mocked: role whitelist, capped and labelled edits, no provider text in errors, limiter keyed on the platform IP and counting accepted requests only, request caps, malformed tokens and JSON, WAV-only voice, server files not published, security.txt, CSP reporting, CORS, voice token, stream equals JSON, forced fallback, ticket uniqueness, 36 scored passages, TOP_K |
| `test/gate-ui.mjs` | the built page in headless Chromium under the deploy headers: no CSP errors, no dead controls, demo credentials, claim guard on 20 phantom and 20 legitimate phrasings, bot-switch filing, queued suggestions, Escape and deep links, axe-core with no serious issues in every view and theme, keyboard focus kept in the intro and the source drawer, citation lists, privacy note, phone layout with the composer in view and 44 px controls |
| `eval/run.mjs` | keyword-path recall on `eval/gold.json` with the shipped retriever; floor 0.6 |
| `probe-2026-09-01.mjs` | reproduces every September audit finding and must report zero |
| `probe-2026-11.mjs` | reproduces the November server-side findings and must report zero |
| `.github/workflows/canary.yml` | daily: the live model still answers (deep health check) |

GitHub Actions runs the same on every push.

## Evidence

- `AUDIT-2026-09-01.md` and `AUDIT-2026-11-26.md`: the two audits, every finding reproduced by execution.
- `FIXES-APPLIED-<date>.md`: generated from `findings.json` at each release, before and after numbers, gate per finding.
- `SECURITY.md`: how to report a vulnerability (also `/.well-known/security.txt` on the site).
- `TEST-REPORT.md` and `LIVE-TEST-REPORT.md`: historical (June 2026) design-time reports, kept for the record.
- `DESIGN-support-agent.md`, `DESIGN-sales-chatbot.md`: historical designs; the shipped prompts live in `backend/personas/personas.json`.
- `CHANGELOG.md`.

## Sister project

Harlan & West IT Service Desk, built with the same method (three audits, gated fixes): see the author's GitHub profile linked from the site footer.

## Folder map

`backend/` (Vercel root: `public/` static files, `api/`, `lib/`, `personas/`, `kb.json`) · `src/` (page template) · `kb.json`, `knowledge-base/` (the fictional company documents) · `eval/` (gold set, runner, results) · `test/` (gates and the shared harness) · `tools/og-image.py` (card generator) · `build.mjs`, `version.json`, `findings.json`.

> Nimbus is fictional; all data is illustrative. Please don't enter real personal or payment information.
