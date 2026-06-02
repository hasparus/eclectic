Spec: Authorized screenshot upload to Cloudflare R2

1. Goal
   Give Claude Code (running in the remote execution environment) a one-call way to upload a PNG/JPeg/WebP/GIF and get back a stable public HTTPS URL it can embed in a PR description or comment, with uploads authenticated, validated, size‑limited, and auditable — without handing Claude raw R2 credentials.

2. Non-goals
   Not a general file host or CDN for app assets.
   Not for private/secret images (anything uploaded is world‑readable, because GitHub's Camo fetches anonymously).
   No deletion/management API in v1 (retention handled by lifecycle policy).
3. Approaches considered
   A. Direct R2 (S3 SigV4) from Claude B. Cloudflare Worker in front of R2 (recommended)
   Claude holds R2 access key + secret a single bearer token
   Policy enforcement (type/size/key layout) client-side only (untrusted) server-side, central
   Revocation rotate R2 keys (affects everything) rotate one Worker secret
   Audit R2 access logs only structured per-upload logs incl. repo/PR
   Abuse blast radius full bucket RW exactly what the Worker allows
   Build effort ~0 ~small Worker
   Recommendation: B. A tiny Worker is the difference between "Claude has S3 keys" and "Claude has a scoped, revocable upload token that can only do one thing." Given this is an authorized-but-autonomous agent, server-side policy + audit is worth the ~50 lines.

4. Architecture (recommended)
   Claude (remote env)
   │ POST https://shots.zagrajmy.dev/upload
   │ Authorization: Bearer $SCREENSHOT*UPLOAD_TOKEN
   │ multipart: file=<png>, repo=zagrajmy/ludamus, pr=319
   ▼
   Cloudflare Worker ──(validate token, magic-bytes, size)──▶ R2 bucket (PutObject)
   │ returns { "url": "https://shots.zagrajmy.dev/s/<sha256>.png" }
   ▼
   GitHub PR markdown <img src="https://shots.zagrajmy.dev/s/<sha256>.png">
   └─ GitHub Camo fetches + re-hosts (anonymous GET, must be public)
   GET of /s/* is served either by R2 custom-domain public access or by the same Worker reading from R2. Prefer a custom domain (shots.<domain>); avoid \_.r2.dev for anything load-bearing (rate-limited, not meant for production).

5. API contract
   POST /upload

Headers: Authorization: Bearer <token> (required)
Body: multipart/form-data
file (required) — the image bytes
repo (optional) — owner/name, for audit/metadata
pr (optional) — PR number, for audit/metadata
alt (optional) — human slug, sanitized into the object metadata (not the key)
200 → {"url": "...", "key": "s/<hash>.png", "bytes": 10761, "content_type": "image/png", "dedup": false}
400 invalid/missing file, unsupported type, body too large
401 missing/invalid token
413 over size limit
429 rate limited
5xx R2 error (retryable)
Idempotent: key is content‑addressed = s/<sha256(bytes)>.<ext>. Re-uploading identical bytes returns the same URL (dedup: true), so retries are safe and identical screenshots dedupe.

6. Auth & secrets
   Worker secret UPLOAD_TOKEN (Cloudflare secret binding). Claude never sees R2 keys.
   Claude side: token injected as env var SCREENSHOT_UPLOAD_TOKEN via the remote environment's env-var configuration (per code.claude.com/docs env config) — not committed, not in chat.
   Rotation: change the Worker secret + the env var; old token dies immediately. Consider 2 valid tokens during rotation.
   Optionally make it an R2 API token scoped to one bucket with Object Read+Write only as the Worker's binding (Workers use an R2 binding, so no key material in code at all — preferred).
7. Validation & limits (enforced in Worker)
   Type allowlist by magic bytes (not just declared MIME): PNG, JPEG, WebP, GIF. Reject everything else (no SVG — SVG can carry script; if needed later, sanitize separately).
   Max size: 10 MB (configurable). Reject Content-Length/stream over limit early.
   Set on PutObject: ContentType from sniffed type, CacheControl: public, max-age=31536000, immutable, Content-Disposition: inline.
   Strip/ignore client-supplied filename for the key (content-addressed); keep alt/repo/pr as R2 custom metadata for audit.
8. Object key & retention
   Key: s/<sha256hex>.<ext> (immutable, dedup, cache-forever).
   Lifecycle: R2 lifecycle rule to expire s/ after, say, 365 days (PRs are usually merged long before; bump or disable if you want permanent history). Make it a documented knob.
9. Public serving & GitHub rendering
   Bucket connected to custom domain shots.<domain> (Cloudflare-managed cert, on the CDN).
   GET must be anonymous/public (Camo fetches without auth). Only /s/\* GETs are public; /upload requires the bearer token.
   Camo caches the image; even if R2 lifecycle later deletes it, already-rendered PRs keep showing GitHub's cached copy (best-effort, don't rely on it).
10. Network policy requirement
    The remote execution environment's outbound network is governed by the environment's network policy. shots.<domain> (the upload endpoint) must be allowlisted in that policy, or the upload curl will be blocked. This is a prerequisite, called out so it isn't a surprise (this is exactly why catbox/0x0 worked/failed inconsistently for me earlier).

11. Security & abuse considerations
    Bearer token = capability; treat as a secret, rotate on suspicion.
    Per-token rate limit (e.g., 60 uploads / 10 min) via Worker + a KV/Durable Object counter or Cloudflare Rate Limiting.
    Size + type limits cap malware/abuse.
    Optional allowed-repo list in the Worker (reject uploads whose repo isn't zagrajmy/\*) so a leaked token can't be used to seed arbitrary content tied to your domain.
    Log every upload (see §12) for review.
    Reputational note: anything served under your domain is associated with you; the type allowlist + repo gating keep it boring (only images, only for your PRs).
12. Observability / audit
    Worker logs one structured line per upload: ts, repo, pr, key, bytes, content_type, token_id (last4), result. Pipe to Workers Logpush/Logs or a Logflare/R2 sink. Lets you answer "what did the agent upload, when, for which PR."

13. Client usage (how I'd call it)
    A reusable helper committed to the repo (e.g. tools/upload-screenshot.sh), so any session can use it:

#!/usr/bin/env bash

# usage: upload-screenshot.sh <file> [repo] [pr] -> prints public URL

set -euo pipefail
: "${SCREENSHOT_UPLOAD_TOKEN:?missing token}"
resp=$(curl -fsS -X POST "https://shots.zagrajmy.dev/upload" \
 -H "Authorization: Bearer ${SCREENSHOT_UPLOAD_TOKEN}" \
  -F "file=@${1}" \
 ${2:+-F "repo=${2}"} ${3:+-F "pr=${3}"})
printf '%s\n' "$resp" | python3 -c 'import sys,json;print(json.load(sys.stdin)["url"])'
Then I ![before](URL) / ![after](URL) into the PR body via mcp**github**update_pull_request. Optionally wrap this as a small /screenshot skill so it's discoverable, or a post-SendUserFile convenience.

14. Cloudflare setup checklist (your side)
    Create R2 bucket, e.g. ludamus-screenshots.
    Add custom domain shots.zagrajmy.dev → bucket (public read).
    Lifecycle rule: expire s/ after 365d (or none).
    Create Worker screenshot-upload; bind the R2 bucket; add secret UPLOAD_TOKEN.
    Route shots.zagrajmy.dev/upload* → Worker; /s/* → public bucket (or Worker GET).
    Generate a strong UPLOAD_TOKEN; give it to me via the remote env's env-var config as SCREENSHOT_UPLOAD_TOKEN.
    Allowlist shots.zagrajmy.dev in the Claude environment's network policy.
15. Worker reference implementation (sketch, TypeScript)
    export interface Env { BUCKET: R2Bucket; UPLOAD*TOKEN: string }
    const MAX = 10 * 1024 \_ 1024;
    const SNIFF: [number[], string, string][] = [
    [[0x89,0x50,0x4e,0x47], "image/png", "png"],
    [[0xff,0xd8,0xff], "image/jpeg", "jpg"],
    [[0x47,0x49,0x46,0x38], "image/gif", "gif"],
    // WEBP: "RIFF"...."WEBP" — checked separately
    ];
    const sniff = (b: Uint8Array): [string,string]|null => {
    for (const [sig,ct,ext] of SNIFF) if (sig.every((x,i)=>b[i]===x)) return [ct,ext];
    if (b[0]===0x52&&b[1]===0x49&&b[2]===0x46&&b[3]===0x46&&b[8]===0x57&&b[9]===0x45&&b[10]===0x42&&b[11]===0x50) return ["image/webp","webp"];
    return null;
    };
    const hex = (buf: ArrayBuffer) =>
    [...new Uint8Array(buf)].map(x=>x.toString(16).padStart(2,"0")).join("");

export default {
async fetch(req: Request, env: Env): Promise<Response> {
if (req.method !== "POST") return new Response("method", {status:405});
const auth = req.headers.get("authorization") ?? "";
if (auth !== `Bearer ${env.UPLOAD_TOKEN}`) return new Response("unauthorized",{status:401});
const form = await req.formData();
const file = form.get("file");
if (!(file instanceof File)) return new Response("no file",{status:400});
if (file.size > MAX) return new Response("too large",{status:413});
const bytes = new Uint8Array(await file.arrayBuffer());
const kind = sniff(bytes);
if (!kind) return new Response("unsupported type",{status:400});
const [ct, ext] = kind;
const repo = String(form.get("repo") ?? ""); // optionally validate /^zagrajmy\//
const digest = hex(await crypto.subtle.digest("SHA-256", bytes));
const key = `s/${digest}.${ext}`;
const existing = await env.BUCKET.head(key);
if (!existing) {
await env.BUCKET.put(key, bytes, {
httpMetadata: { contentType: ct, cacheControl: "public, max-age=31536000, immutable", contentDisposition: "inline" },
customMetadata: { repo, pr: String(form.get("pr") ?? ""), alt: String(form.get("alt") ?? "") },
});
}
const url = `https://shots.zagrajmy.dev/${key}`;
console.log(JSON.stringify({ ts: Date.now(), repo, pr: form.get("pr"), key, bytes: file.size, ct, dedup: !!existing }));
return Response.json({ url, key, bytes: file.size, content_type: ct, dedup: !!existing });
}
}; 16. Acceptance criteria
upload-screenshot.sh after.png zagrajmy/ludamus 319 prints an https://shots.<domain>/s/<sha>.png URL.
That URL returns 200 image/png anonymously.
Embedding it in a PR description renders the image (served via Camo) for logged-out viewers.
A request with a bad/no token → 401; a 20 MB file → 413; a .txt renamed .png → 400.
Re-uploading the same file returns the same URL with dedup:true.
The endpoint domain is reachable from the Claude remote environment (network policy). 17. Open questions for you
Domain to use (shots.zagrajmy.dev? something else?).
Retention: expire after 365d, or keep PR screenshots permanently?
Worker vs. direct R2 token — I recommend the Worker; OK to proceed with that?
Repo gating: restrict uploads to zagrajmy/\*, or leave open?
Want me to also ship the tools/upload-screenshot.sh helper + a /screenshot skill in the repo so it's reusable across sessions?
