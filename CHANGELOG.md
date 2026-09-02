# Changelog

## 3.0.0 (2026-09-01)

Audit-driven hardening release (see AUDIT-2026-09-01.md and FIXES-APPLIED-2026-09-01.md).

- Security: client messages role-whitelisted; visitor KB edits capped (3 x 240 chars), labelled VISITOR-EDITED and declared untrusted; provider errors never echoed; CORS allowlist instead of wildcard; generated Content-Security-Policy with per-script hashes plus nosniff, frame, referrer and permissions headers; limiter keyed on the platform client IP; voice endpoint behind a short-lived page token with a lower daily ceiling.
- Prompts: single source (backend/personas/personas.json) injected into the page at build; crisis clause restored on sales; question versus request rule for contact channels; discounts never extended; action-impossibility stated; rule list gated against every shipped prompt.
- Retrieval: one shared module in page and server; extended stopwords; single common term is not evidence; TOP_K applied; X-ray returns all 36 passages with a fold; gold set and eval runner; keyword recall stamped at build.
- Page: chat-first phone layout; reply filed to the bot that asked; queued suggestions; dead controls hidden in backend mode; demo-account card; completion-claim guard and Handed off badge; Escape closes drawer and modal; deep links (#kb, #xray, #tested, #chat); version stamp; sister-project link; Tested page generated from findings.json; health-driven status pill; server-issued ticket IDs.
- Repo: build.mjs (deterministic), root package.json with npm test (build, eval, static, endpoint, UI gates, audit probe), GitHub Actions, committed og-image generator, docs rewritten to match the code, legacy duplicates removed, no em or en dashes anywhere.

## 2.4 (2026-08-27)

- Visitor KB edits sent with requests so "edit the KB, watch the answer change" holds on the deployed backend.

## 2.3 (2026-08-27)

- Provable RAG positioning; hybrid retrieval (semantic plus keyword, reciprocal rank fusion); Retrieval X-ray tab; score chips; pipeline strip.

## 2.2 (2026-08-03)

- Renamed to Grounded; dark mode default with light toggle; SSE streaming with JSON fallback; fair-use limits; follow-up chips; escalation ticket cards; latency badge; accessibility pass; llms.txt; og card; Vercel Web Analytics.

## 2.0 and 2.1 (2026-07-30)

- Support persona rewritten after live probing found the human-request trigger missing from the shipped prompt; model upgraded to gemini-2.5-flash with reasoning disabled after hidden reasoning tokens truncated replies.

## 1.0 (2026-06-30)

- Initial hub: two grounded assistants, citations, knowledge base browser, red-team report, Vercel deployment.
