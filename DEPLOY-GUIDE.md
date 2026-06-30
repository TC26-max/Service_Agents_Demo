# Deploy Guide — a public, always-on, key-free site

Goal: one public link where **anyone** can use both assistants, the bots are **never
"asleep,"** and the model key stays private. Two pieces:

1. **The page** — `index.html` (the one-page hub, static).
2. **The RAG backend** — `backend/` (full semantic retrieval + the model key).

You already have a **live preview in this session** (built-in model, on-page retrieval) — this
guide is for the durable public site.

---

## Recommended: Vercel (always-on, free, ~10 min)

### 1) (Optional) Pre-embed for faster cold starts
The backend builds embeddings automatically on its first request, so you can **skip this**.
To pre-bake them instead: `cd backend && OPENAI_API_KEY=sk-... npm run ingest`.

### 2) Deploy the backend
Push `backend/` to a Git repo and **Import** it at vercel.com (or run `npx vercel`).
In **Settings → Environment Variables** add `API_KEY` (required) and `PROVIDER` =
`mistral`, `gemini`, or `openai`. You'll get a URL like `https://nimbus-rag.vercel.app`.

### 3) Point the page at it
In `index.html`, set:
```js
const BACKEND = "https://nimbus-rag.vercel.app";
```
Now every visitor gets full semantic RAG with cited sources — **no key on their side.**

### 4) Host the page
Drop `index.html` on any static host. Easiest: the **same Vercel project**, or **Cloudflare
Pages**, or **GitHub Pages**. Done — share the link.

---

## "Never unavailable" — hosting options

| Host | Use for | Always-on? |
|------|---------|:----------:|
| **Vercel** | page **and** `/api/chat` backend in one project | ✅ serverless, sub-second cold start |
| **Cloudflare Pages + Workers** | page + API, global edge | ✅ no sleeping |
| **GitHub Pages** | the **page only** (static) — pair with a Vercel/Cloudflare API | ✅ for the page |
| ~~Hugging Face Spaces (free)~~ | not recommended here | ⚠️ sleeps after inactivity (cold start looks "down") |

> The page is static, so it's effectively always up anywhere. Only the **backend** needs a
> server — Vercel/Cloudflare functions are always-on and hold the key securely.

---

## Simplest (personal showcase, no backend)
Host `index.html` as-is. It runs on-page keyword retrieval and you add your own API key via the
⚙ button (kept in memory). Great for a quick demo; for a public "anyone can use it" site, use
the backend above so visitors need no key.

## In this session
The hub already works live via the built-in model — pick a tool and chat; click any citation to
verify it against the knowledge base.

_(Hermes was dropped — a self-hosted agent stack doesn't fit an always-on public web demo.)_
