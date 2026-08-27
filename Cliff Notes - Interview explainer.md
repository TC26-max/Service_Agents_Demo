# Cliff Notes — Interview Explainer

**The name:** Grounded — Provable RAG: AI assistants that cite their sources.
**The pitch in one line:** "Everyone has an AI chatbot demo. Mine shows its work — you can literally watch it search before it answers."
**The link:** nimbus-ai-demos.vercel.app · always on, nothing to install, anyone can try it. (Nimbus is the made-up company the assistants serve — like a case study carrying the client's name.)

## What it is (one breath)

Two AI chat assistants for a made-up software company — one does customer support, one does sales. They're live on a public page, and every answer shows its receipts.

## The big idea

- Normal chatbots make things up. Mine take an **open-book test**: they can only answer from the company's own documents, and every answer includes a **clickable citation** so you can check it yourself.
- If the answer isn't in the documents, the bot **says so** and hands you to a human — it never guesses.
- You can even **open and edit the documents** on the page, and the bot's answers change to match. That's the proof it's really answering from them.
- There's also a **voice mode** — speak your question, hear the answer. Same brain, spoken.
- And an **X-ray view**: type anything and watch the search itself — every document ranked and scored, before any answer gets written. That's the "provable" part: the search isn't hidden, it's on display.

## How it works (plain version)

- The page itself is just a simple website — cheap, fast, never crashes.
- Behind it, two small programs in the cloud do the work: one **finds** the few paragraphs that match your question and **writes** an answer using only them; the other turns your **spoken** question into text.
- The AI's key is hidden on the server, so visitors need nothing, and running the whole thing costs pennies a month.

## What makes it "professional grade"

- It was **stress-tested like an attacker**: tricked into revealing instructions, fed fake "I'm the admin" claims, asked for made-up discounts. 12 weaknesses were found and fixed — all written up.
- It knows its limits: security problems, legal stuff, refunds outside policy, or anyone asking for a human get **handed off honestly** — a ticket and "a specialist will email you," never a fake "hold on, an agent is coming."
- It can tell a **question from a request**: "what's your refund policy?" gets an answer; "give me a refund" starts the hand-off process. Most bots can't tell those apart.

## The story to tell (this is the gold)

"After launch, I tested my own live bot the way a difficult customer would — and caught it breaking one of its own rules. The shipped version had lost the 'user asks for a human' rule. I fixed it in versioned steps, re-tested every fix on the live site multiple times, and when the cheap AI model still couldn't hold one behavior, I swapped in a stronger model with one setting change. I don't just build these — I test and maintain them like a product."

## If they ask…

- **"Does it lie?"** — It's only allowed to answer from the documents, it shows its sources, and it admits when it doesn't know.
- **"What did it cost?"** — Almost nothing: free hosting tier plus pennies of AI usage.
- **"What would a real company need to add?"** — Real support tickets, stronger identity checks, and logging/monitoring. I have that scoped.
- **"What broke?"** — Tell the story above. A real bug you found and fixed beats pretending nothing broke.
