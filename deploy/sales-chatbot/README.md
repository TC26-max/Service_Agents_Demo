---
title: Nimbus Sales Assistant
emoji: 🟢
colorFrom: green
colorTo: emerald
sdk: gradio
sdk_version: 4.44.0
app_file: app.py
pinned: false
short_description: AI sales & lead-gen chatbot for a SaaS (demo)
---

# Nimbus Sales Assistant (demo)

A multi-turn AI **sales / lead-generation chatbot** for *Nimbus*, a fictional
work-management SaaS. Qualifies the visitor (team size, use case, timeline),
recommends the right plan, handles objections, and books a demo / captures the lead.

## Configure the model (Settings → Variables and secrets)

| Variable | Values | Default |
|----------|--------|---------|
| `LLM_PROVIDER` | `hf`, `openai`, `anthropic` | `hf` |
| `LLM_MODEL` | any model id for the provider | `Qwen/Qwen2.5-7B-Instruct` (hf) |
| `LLM_API_KEY` | your key (or use `HF_TOKEN` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`) | — |
| `LLM_BASE_URL` | OpenAI-compatible base URL (optional) | — |

- **Cheapest path (zero extra keys):** leave `LLM_PROVIDER=hf` and add a free `HF_TOKEN`
  secret. Uses free serverless inference.
- **Best quality / most reliable:** set `LLM_PROVIDER=openai` (or `anthropic`) and add the
  matching API key as a secret.

## Run locally
```bash
pip install -r requirements.txt
export LLM_PROVIDER=openai
export OPENAI_API_KEY=sk-...
python app.py
```
