# Changelog

## 3.2.0 (2026-11-26)

Phase 1 of AUDIT-2026-11-26.md: a deterministic guard layer around the model (lib/guard.mjs), retrieval fixes, and a model canary.

- Input: visitor messages and edits are NFKC-normalized and stripped of tag characters, zero-width and bidi controls and variation selectors (N-16).
- History: every answer is signed with an HMAC; unsigned, tampered or cross-bot assistant turns are dropped (N-08).
- Sources: each passage is fenced with a code that changes per request, so a passage cannot close itself and issue instructions.
- Output rules: a reply asking for card numbers, passwords or codes is replaced (R-SECRET); emails, links and phone numbers not in the original knowledge base or the visitor's messages are removed (R-CONTACT); card-like numbers removed (R-CARD); verbatim recitation of the prompt replaced (R-PROMPT, N-04); markdown images neutralized (R-IMAGE); a stretched student discount gets the institutional rule appended (R-STUDENT, N-05). Streamed replies are checked at the end and replaced on screen if needed; a request carrying visitor edits is answered as checked JSON, tagged Uses your edit, with the original passage beside the edit in the source drawer (N-02).
- Retrieval: light plural stemming, heading matches count as evidence, and fusion drops weak keyword-only hits (N-06). Keyword recall@3 0.73 to 0.81 on a gold set grown from 30 to 36 targeted questions.
- Model: request bodies are model-aware so CHAT_MODEL can move to Gemini 3.5 Flash-Lite; /api/health?deep=1 runs a cached canary that drives the status pill; a daily GitHub Action checks the live model (N-13).
- The prompts are linked as public from the sidebar. The November probe now runs in npm test with nothing scheduled open.

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
