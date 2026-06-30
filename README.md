# Nimbus — Two Grounded Conversational AI Systems

_Privately built for demonstration & portfolio purposes only · Built by Emilio Rigales_

Two production-style, multi-turn LLM assistants for one fictional SaaS company (**Nimbus**),
on a single page with a tool switcher. Every answer is **grounded in company documents and
cited**, so anyone can verify it.

| System | What it does | Theme |
|--------|--------------|-------|
| **Support Assistant** | Resolves account, billing, integration, and bug questions; verifies identity; escalates with a ticket | Conservative / enterprise |
| **Sales Assistant** | Qualifies the visitor, recommends a plan, books a demo | Modern / fun |

## Try it now
Open **`index.html`** (also live in the Cowork sidebar). Pick a tool, ask a question, and
**click any citation** to see the exact source — or open the **Knowledge Base** tab to browse
and even edit the docs and watch answers change. Runs on the built-in model here; no key needed.

## What makes it robust
- **RAG grounding** — retrieves the most relevant passages and answers only from them.
- **Clickable citations → source viewer** with the cited passage highlighted in its full doc.
- **Browsable + editable Knowledge Base** (`kb.json`, `knowledge-base/`) — 8 docs, 36 passages.
- **RAG on/off toggle**, **retrieved-context peek**, **faithfulness check**, **feedback + mini-analytics**.
- **Honest fallback** — if it's not in the docs, the bot says so and escalates instead of guessing.
- **Red-teamed guardrails** — identity gating, crisis handling, injection resistance, no invented pricing.

## Make it a public, always-on site
See **`DEPLOY-GUIDE.md`**. Short version: deploy `backend/` (full semantic RAG) to **Vercel**,
set `BACKEND` in `index.html`, and host the page on Vercel / Cloudflare Pages / GitHub Pages.
Visitors need no key; nothing sleeps.

## What's in this folder
- **`index.html`** — the one-page hub (tool switcher + grounded chat + knowledge base).
- **`kb.json` / `knowledge-base/`** — the company documents that power citations.
- **`backend/`** — deployable full-semantic RAG API (`api/chat.js`, `ingest.mjs`) for Vercel/Cloudflare.
- **`DESIGN-support-agent.md` / `DESIGN-sales-chatbot.md`** — designs + authoritative prompts.
- **`support-agent.html` / `sales-chatbot.html`** — the original standalone single-bot apps.
- **`deploy/…`** — simple Gradio (Hugging Face) bundles for the individual bots (alternative).
- **`TEST-REPORT.md`** — scenario matrix, transcripts, red-team findings + fixes.
- **`Proposal-Nimbus-AI-Assistants.docx`** — the full proposal.
- **`DEPLOY-GUIDE.md`** — publish instructions.

## Stack
Static one-page hub (vanilla JS) · per-assistant theming · RAG with clickable citations ·
pluggable LLM (built-in / OpenAI / Anthropic) · deployable Vercel backend (embeddings + cosine,
faithfulness check) · system-prompt guardrail layer (independently red-teamed).

> Nimbus is fictional; all data is illustrative — please don't enter real personal or payment info.
