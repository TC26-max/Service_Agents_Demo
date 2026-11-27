// lib/project.mjs (v3.3, Phase 2): a 2D map of the knowledge base for the Retrieval X-ray.
// Principal component analysis of the passage embeddings, by power iteration with deflation:
// deterministic (fixed start vector, fixed iteration count, signs pinned), no dependencies.
// The map is a picture of the space, not the ranking: retrieval always uses full cosine similarity,
// and `kept` reports how much of the variance the two components keep, so the page can say so.

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const norm = v => Math.sqrt(dot(v, v)) || 1;

function topComponent(X, iters, against) {
  const d = X[0].length; let v = new Array(d).fill(0).map((_, i) => 1 / Math.sqrt(d) * (1 + (i % 7) / 10));
  for (let t = 0; t < iters; t++) {
    const w = new Array(d).fill(0);
    for (const row of X) { const p = dot(row, v); for (let i = 0; i < d; i++) w[i] += p * row[i]; } // X^T X v
    if (against) { const p = dot(w, against); for (let i = 0; i < d; i++) w[i] -= p * against[i]; } // stay orthogonal
    const n = norm(w); v = w.map(x => x / n);
  }
  let lambda = 0; for (const row of X) { const p = dot(row, v); lambda += p * p; }
  return { v, lambda };
}

// vectors: number[][] (one per passage). Returns { project(vec) -> [x, y] in about -1..1, points, kept }.
export function pca2(vectors, iters = 60) {
  const n = vectors.length, d = vectors[0].length;
  const mean = new Array(d).fill(0); for (const v of vectors) for (let i = 0; i < d; i++) mean[i] += v[i] / n;
  const X = vectors.map(v => v.map((x, i) => x - mean[i]));
  const total = X.reduce((s, r) => s + dot(r, r), 0) || 1;
  const c1 = topComponent(X, iters, null), c2 = topComponent(X, iters, c1.v);
  // pin the signs so the picture never flips between deploys: the first passage lands right and up
  if (dot(X[0], c1.v) < 0) c1.v = c1.v.map(x => -x);
  if (dot(X[0], c2.v) < 0) c2.v = c2.v.map(x => -x);
  const raw = X.map(r => [dot(r, c1.v), dot(r, c2.v)]);
  const sx = Math.max(1e-9, ...raw.map(p => Math.abs(p[0]))), sy = Math.max(1e-9, ...raw.map(p => Math.abs(p[1])));
  const project = vec => { const r = vec.map((x, i) => x - mean[i]); return [dot(r, c1.v) / sx, dot(r, c2.v) / sy]; };
  return { project, points: raw.map(p => [p[0] / sx, p[1] / sy]), kept: (c1.lambda + c2.lambda) / total };
}
