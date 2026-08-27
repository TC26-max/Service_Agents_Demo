# Grounded — Provable RAG — Interview Explainer

Talking points for **Grounded** (https://nimbus-ai-demos.vercel.app) — positioned as **provable RAG**: not "I built a RAG chatbot" (everyone has one) but "my retrieval is inspectable — watch it rank, click the citations, read the tests." Nimbus is the fictional client company it serves. Speak in "I" statements; keep answers to 2–3 bullets unless asked to go deeper.

**The one-liner:** "Everyone has a RAG demo; mine proves itself. Open the Retrieval X-ray and watch the hybrid ranking work — the chatbot is just a UI on top of a retrieval engine you can inspect."

## What it is

- A live, public demo of **two production-style conversational AI systems** for one fictional SaaS ("Nimbus"): a **customer-support agent** and a **sales/lead-qualification bot**, on a single hub page — no login, no API key, never asleep.
- Every answer is **RAG-grounded**: the bot retrieves the most relevant passages from a knowledge base (8 docs / 36 passages) and answers **only** from them, with **clickable citations** that open the exact source passage.
- Built-in **trust UI**: grounded/not-in-knowledge-base badges on every reply, retrieved-context peek, a browsable *and editable* knowledge base (change a doc, watch answers change), feedback buttons, and live session analytics (asked / grounded / escalated).
- **Voice mode**: speak your question — audio is transcribed server-side and the same grounded pipeline answers; replies can be read aloud by the browser.
- The company is fictional on purpose — everything is safely shareable and every behavior is inspectable.

## How it was built

- **Frontend:** one static HTML page, vanilla JS, no framework — hosts anywhere, effectively always up.
- **Backend:** two small Vercel serverless functions — `/api/chat` (**hybrid retrieval**: semantic embeddings + keyword ranking merged with **reciprocal rank fusion**, top-3 passages, then citation-grounded generation with SSE streaming; also serves the X-ray's rank-only mode) and `/api/transcribe` (speech-to-text for voice mode). API key lives server-side; visitors need nothing.
- **Retrieval X-ray:** a third tab that runs retrieval WITHOUT generation — every chunk ranked with semantic and keyword scores visible. The single strongest anti-"wrapper" proof in the demo.
- **Why hybrid?** Embeddings catch paraphrases ("can't sign in" → password reset); keyword catches exact terms embeddings blur (SCIM, BAA). RRF merges the two rankings without needing comparable scores — the production-standard pattern.
- **Why no vector database?** 36 chunks — in-memory cosine over a cached embedding matrix is faster than a network hop to Pinecone. Knowing when NOT to add infrastructure is the point. (At ~10k+ chunks: pgvector or similar.)
- **Provider-flexible by env var** (OpenAI-compatible interface): currently Gemini embeddings + Flash-tier chat model, temperature 0.3, 400-token replies — the whole demo runs for pennies a month.
- **Guardrail layer in the system prompt, independently red-teamed**: 12 findings (crisis handling, prompt-injection resistance, identity-gating, no invented prices/discounts, no phantom bookings) — all fixed, all documented.
- The repo carries the full engineering trail: design docs with the authoritative prompts, a scenario test matrix, the red-team report, a deploy guide, and a **versioned prompt changelog**.

## Why it was built this way

- **Grounding + citations**, because hallucination is the #1 objection to customer-facing AI. Here every claim is verifiable by the visitor, and when the KB doesn't cover something the bot says so and escalates instead of guessing.
- **Escalation-aware by design**: the bot knows what it must NOT handle — security incidents, legal/privacy, refunds beyond policy, anyone asking for a human — and hands off honestly (ticket + "a specialist will email you"), never "hold on, an agent is coming" when nobody is.
- **Question vs. request distinction**: "what's your refund policy?" gets a cited FAQ answer; "I want a refund for 3 months" triggers the escalation workflow. Most chatbots can't tell these apart.
- **Serverless + static** because a portfolio demo that's asleep or errors out is worse than none: zero-maintenance, always-on, ~free.
- **A deliberately cheap model**, because support automation only makes business sense at low cost-per-conversation — and the model is swappable with one env var when quality demands more.

## The story to tell (differentiator)

- After launch I **probed the live bot like an adversarial user** and found the deployed prompt had drifted from the design spec — a condensed version had silently dropped the "user asks for a human" escalation trigger.
- I fixed it in **versioned iterations (v1.1 → v2.0)**, learning en route: models exploit any behavior you didn't explicitly forbid; they'll copy your prompt's formatting into customer-facing replies; patched prompts accrete contradictions, so I refactored to a clean, priority-ordered prompt.
- Every fix was **re-tested on the live surface, multiple runs plus hostile phrasing**, because one clean pass is variance, not verification.
- Point: I don't just build bots — I **test, monitor, and maintain** them like products.

## Numbers to have ready

- 2 assistants · 8 docs / 36 KB passages · top-4 retrieval · temp 0.3 · 400-token cap · 12 red-team findings fixed · ~17-scenario test matrix · runs on Vercel free tier + pennies of model spend.

## Likely questions, short answers

- **"Why no LangChain/framework?"** — Small surface area: one retrieval step, one generation step. Fewer dependencies means I can explain every line; frameworks earn their keep at multi-agent/orchestration scale, not here.
- **"How do you prevent hallucination?"** — Retrieval-only answering, citations the user can click, a grounded/ungrounded badge on every reply, honest fallback + escalation, and a test matrix that includes false-premise questions.
- **"What would production add?"** — Real ticket creation in a helpdesk, out-of-band identity verification for high-risk changes, rate limiting, conversation logging with an eval harness, and a human-handoff queue. (All scoped in the proposal doc.)
- **"Why transcribe speech on the server instead of in the browser?"** — The browser's built-in speech recognition fails unpredictably across setups; server-side transcription is reliable everywhere and keeps the same key-stays-private architecture.
- **"What broke / hardest bug?"** — Tell the escalation-drift story above; it lands better than claiming nothing broke. (Sequel if asked: a model upgrade silently truncated replies — the new model's hidden "reasoning" tokens ate the reply budget. Found it by testing on a phone; fixed with one config line.)
