// backend/lib/retrieval.mjs: the one retriever.
// Imported by api/chat.js and injected verbatim into the page by build.mjs (export keywords stripped),
// so the offline preview, the Retrieval X-ray fallback, and the deployed path rank identically.
// Plain functions only: no imports, no Node APIs, no browser APIs.

export const STOPWORDS = new Set("a an the of to and or for in on at is are be do does did you your we our it its this that these those with how can could would should i my me mine as from what which when where who whom why have has had was were will there here about into than then them they am been being if so not any some".split(" "));

// v3.2 (audit N-06): light plural stemming, so "plans" matches "plan" and "invoices" matches "invoice".
// Deliberately small: plurals only, never words ending in ss, us or is (class, status, analysis).
export function stem(w) {
  if (w.length <= 3 || /\d/.test(w)) return w;
  if (/[^aeiou]ies$/.test(w)) return w.slice(0, -3) + "y";
  if (/(?:ches|shes|sses|xes|zzes)$/.test(w)) return w.slice(0, -2);
  if (/(?:ss|us|is)$/.test(w)) return w;
  if (/s$/.test(w)) return w.slice(0, -1);
  return w;
}

export function tokenize(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w && w.length > 1 && !STOPWORDS.has(w)).map(stem);
}

// chunks: [{ cid, heading, text }]
export function buildKeywordIndex(chunks) {
  const docs = chunks.map(c => ({ cid: c.cid, terms: tokenize(c.heading + " " + c.text), headTerms: new Set(tokenize(c.heading)) }));
  const df = {}; for (const d of docs) for (const t of new Set(d.terms)) df[t] = (df[t] || 0) + 1;
  return { docs, df, N: docs.length };
}

export function overrideTerms(chunk, text) {
  return { terms: tokenize(chunk.heading + " " + text), headTerms: new Set(tokenize(chunk.heading)) };
}

// tf-idf with a heading boost. A single matched term that appears in more than a quarter of the
// corpus is not evidence (v3.0 rule: it produced junk keyword matches for question words), unless it
// is in the passage heading (v3.2: "plan" is common, but "Pro plan" is about plans).
export function keywordRank(q, index, k = 8, overrides = null) {
  const qt = [...new Set(tokenize(q))]; if (!qt.length) return [];
  const { docs, df, N } = index; const out = [];
  for (const d of docs) {
    const ov = overrides && overrides.get(d.cid);
    const terms = ov ? ov.terms : d.terms; const headTerms = ov ? ov.headTerms : d.headTerms;
    const tf = {}; for (const t of terms) tf[t] = (tf[t] || 0) + 1;
    let s = 0, matched = 0, rare = false;
    for (const t of qt) {
      if (!tf[t]) continue;
      matched++; if ((df[t] || 0) <= N * 0.25 || headTerms.has(t)) rare = true;
      let w = Math.log(1 + N / (df[t] || 1)) * (1 + Math.log(tf[t])); if (headTerms.has(t)) w *= 1.6; s += w;
    }
    if (!matched || (matched === 1 && !rare)) continue;
    out.push({ cid: d.cid, s: s / Math.sqrt(terms.length || 1) });
  }
  return out.sort((a, b) => b.s - a.s).slice(0, k);
}

export function cosine(a, b) {
  let s = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return s / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// reciprocal rank fusion over any number of ranked lists of { cid }
export function rrf(lists, K = 60) {
  const m = new Map();
  for (const list of lists) list.forEach((x, i) => m.set(x.cid, (m.get(x.cid) || 0) + 1 / (K + i + 1)));
  return [...m.entries()].map(([cid, s]) => ({ cid, s })).sort((a, b) => b.s - a.s);
}

// v3.2 (audit N-06): hybrid fusion in which a weak keyword-only match cannot ride reciprocal rank fusion
// past strong semantic results. Keyword hits under kwFloor of the best keyword score are dropped first.
export function fuseHybrid(sem, kw, K = 60, kwFloor = 0.4) {
  const top = kw.length ? kw[0].s : 0;
  return rrf([sem, kw.filter(x => x.s >= top * kwFloor)], K);
}

// Retrieval quality hint used by the X-ray honesty banner: nothing scored strongly.
export function weakMatch(items, semThreshold = 0.62) {
  return !items.some(c => (c.sem != null && c.sem >= semThreshold) || c.kw != null);
}
