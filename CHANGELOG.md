# Changelog

## 3.1.0 (2026-11-26)

Phase 0 of AUDIT-2026-11-26.md: quick fixes for abuse, privacy and accessibility (FIXES-APPLIED-2026-11-26.md has the per-finding table).

- Abuse and cost: the limiter counts accepted requests only and gives each visitor a daily share, so one client can no longer lock everyone out (N-01); requests are capped at 12 turns and 12,000 characters and an empty request never reaches the model (N-09); malformed voice tokens are a 401 instead of a crash (N-07); the voice endpoint accepts WAV only (N-15); malformed JSON is a 400 (N-18); the voice-token secret can be set on its own with TOKEN_SECRET (N-22).
- Exposure and hygiene: only `backend/public/` is served, so server code, prompts and the knowledge base are no longer public URLs (N-10); security.txt, robots.txt, sitemap.xml, a 404 page, CSP violation reporting, COOP and CORP headers, no-store on the API (N-21); SECURITY.md.
- Privacy: a note under the composer and on the intro says questions and voice clips go to Google Gemini; the sales assistant suggests example contact details; the "free AI quota" copy is gone (N-03, code part).
- Accessibility and phones: contrast tokens split into fill and text so every pair passes (N-11); the intro is a modal dialog with the page behind it inert, and the source drawer is a labelled dialog that takes and returns focus (N-12); the phone chat fills the first screen with the composer in view and every control at 44 px (N-14); landmarks, heading order and docked tips (N-23); underlined links in running text (N-24).
- Prompts and rendering: citation lists such as [S1, S2] render as buttons, and citations never go on refusals (N-17); the sales persona names the student-discount case (N-05, live verification pending).
- Cleanup: the dead bring-your-own-key modal and third-party model calls are removed (N-20); the intro animation stops after entering (N-19).
- Tests: November probe in `npm test` as a ratchet (N-08 and N-16 scheduled for Phase 1), new endpoint and UI gates including axe-core in every view, findings register extended to 48 IDs.

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
