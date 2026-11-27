# Security policy

Grounded is a public portfolio demo of two AI assistants for a fictional company. It has no accounts, no user data and no database. Security findings are welcome and are tracked in the open: every confirmed issue gets an ID in `findings.json`, a gate in `npm test`, and an entry on the site's **Tested** page.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: https://github.com/TC26-max/Service_Agents_Demo/security/advisories/new (also listed in `/.well-known/security.txt`). Please include what you sent, what came back, and when.

Expect an acknowledgement within a week. This is a one-person project, so fixes are best effort; you will be credited on the Tested page unless you ask not to be.

## In scope

- The deployed site at https://nimbus-ai-demos.vercel.app/ and the code in this repository.
- Prompt injection, data exposure, output handling, cost abuse (OWASP Top 10 for LLM Applications 2026), and ordinary web issues (headers, CSP, CORS, the API functions).

## The Red Team Arena

The site has a public arena (the **Arena** tab) where anyone can attack a sandboxed copy of the support assistant across five levels mapped to the OWASP Top 10 for LLM Applications 2026. Code judges every attempt twice, on the model's raw reply and on what the gates let through. A **win** means a gate missed something: report it the same way as any other finding, with what you typed and when, and it will be fixed and credited. Please play by hand; the arena has its own small allowance, and scripted attempts only use it up for everyone.

The security page (https://nimbus-ai-demos.vercel.app/security.html) has the threat model, the response headers, and the OWASP, MITRE ATLAS and CIS Controls v8.1 mappings.

## Please do not

- Run volume, load or denial-of-service tests against the live site. The fair-use limits exist to keep the demo free; reproduce cost issues locally with `npm test` and the probe scripts instead.
- Attack the infrastructure providers (Vercel, Google) or anyone else's systems.
- Enter real personal, customer or payment information. Example values are fine everywhere.

## Safe harbor

Good-faith research that follows this policy is welcome; it will not be reported to anyone or pursued in any way.
