# Grounded: Provable RAG, AI assistants that cite their sources

_Live at **https://nimbus-ai-demos.vercel.app** · Privately built for demonstration and portfolio purposes only · v3.0.0_

**Grounded** is the demo site; **Nimbus** is the fictional SaaS company its two assistants serve. Built AI-assisted; every behavior specified, tested against a gold set, red-teamed, and explainable. The **Tested** tab on the site lists what broke and how each item is guarded.

## What it is

Two production-style assistants on one page: a **customer-support agent** (escalation-aware, identity-gated, question versus request routing, illustrative NIM-##### ticket cards) and a **sales assistant** (qualifies the visitor, recommends a plan, captures a demo request). Every knowledge answer is retrieved from a 36-passage knowledge base and cited (hand-offs and refusals carry their own badges instead); citation chips open the source with the passage highlighted; the knowledge base is browsable and editable on the page, and edits change the answers for that session, including on the deployed backend.

**Provable RAG** means the retrieval is not a black box. Hybrid search (semantic embeddings plus keyword tf-idf, merged with reciprocal rank fusion) powers every answer, and the **Retrieval X-ray** tab runs the ranking layer alone: type a query, see all 36 passages scored, no generation involved. The same retriever module runs in the page and on the server.

## What is true, precisely

- **Cited answers.** Knowledge answers carry [S#] citations to clickable sources. Escalations, refusals and hand-offs are deliberately uncited and carry their own badges (Handed off, Not in knowledge base, Action claim).
- **Honest hand-offs.** The assistants cannot perform actions. A request for a human, a refund beyond policy, or a security concern produces a warm acknowledgment plus a server-issued illustrative ticket ID; a claim guard flags any reply that pretends an action happened.
- **Identity check.** The support bot asks for the email on file and workspace URL before account specifics. It is illustrative and low-assurance by design; the demo values are shown on screen.
- **Retrieval numbers.** Keyword-path recall on the in-sample-adjacent gold set is stamped into the Tested tab at build time from the shipped retriever; the hybrid number needs a live key (`npm run eval:live`) and is reported as not yet measured until then.
- **Faithfulness verification** exists behind `FAITHFULNESS=1` and is off in the public deployment to keep it free.
- **Fair use.** 20 chat messages per 5 minutes per visitor, voice 10 per 5 minutes, per warm instance. Not authentication, not a security boundary; it bounds cost.

## How it is built

- `src/index.template.html` plus `kb.json`, `backend/personas/personas.json`, `backend/lib/retrieval.mjs`, `version.json`, `findings.json` and `eval/results.json` are the single sources. `node build.mjs` assembles `backend/index.html`, `backend/vercel.json` (with a Content-Security-Policy that pins the SHA-256 of each inline script) and `FIXES-APPLIED-<date>.md`. The build is deterministic.
- `backend/api/chat.js`: hybrid retrieval, citation-grounded generation, SSE streaming with a JSON fallback, capped and labelled visitor edits, role-whitelisted messages, server-issued ticket IDs, fixed error copy. `backend/api/transcribe.js`: speech-to-text behind a short-lived page token. `backend/api/health.js`: token-free health probe that drives the status pill.
- Provider-flexible by environment variable (currently Google Gemini: `gemini-embedding-001` and `gemini-2.5-flash` with reasoning disabled).
- Deploy root is `backend/`; see `DEPLOY-GUIDE.md`.

## Tests and gates

`npm test` runs the build, the retrieval eval, and four gates, then the audit probe:

| Gate | What it asserts |
|---|---|
| `test/gate-static.mjs` | no em or en dashes anywhere; every persona rule present in both personas and in the built page; docs do not overstate; deterministic build; CSP hashes match the built scripts; pen name exactly once; version stamps consistent |
| `test/gate-endpoint.mjs` | real handlers over HTTP with the provider mocked: role whitelist, capped and labelled edits, no provider text in errors, limiter keyed on the platform IP, CORS, voice token, stream equals JSON, forced fallback, ticket uniqueness, 36 scored passages, TOP_K |
| `test/gate-ui.mjs` | the built page in headless Chromium under the deploy headers: no CSP errors, hidden dead controls, demo credentials, claim guard on 20 phantom and 20 legitimate phrasings, bot-switch filing, queued suggestions, Escape and deep links, phone layout in both themes |
| `eval/run.mjs` | keyword-path recall on `eval/gold.json` with the shipped retriever; floor 0.6 |
| `probe-2026-09-01.mjs` | reproduces every audit finding and must report zero |

GitHub Actions runs the same on every push.

## Evidence

- `AUDIT-2026-09-01.md`: the audit, every finding reproduced by execution.
- `FIXES-APPLIED-2026-09-01.md`: generated from `findings.json`, before and after numbers, gate per finding.
- `TEST-REPORT.md` and `LIVE-TEST-REPORT.md`: historical (June 2026) design-time reports, kept for the record.
- `DESIGN-support-agent.md`, `DESIGN-sales-chatbot.md`: historical designs; the shipped prompts live in `backend/personas/personas.json`.
- `CHANGELOG.md`.

## Sister project

Harlan & West IT Service Desk, built with the same method (three audits, gated fixes): see the author's GitHub profile linked from the site footer.

## Folder map

`backend/` (deploy root: page, api, lib, personas, kb, og-image, llms.txt) · `src/` (page template) · `kb.json`, `knowledge-base/` (the fictional company documents) · `eval/` (gold set, runner, results) · `test/` (gates and the shared harness) · `tools/og-image.py` (card generator) · `build.mjs`, `version.json`, `findings.json`.

> Nimbus is fictional; all data is illustrative. Please don't enter real personal or payment information.
