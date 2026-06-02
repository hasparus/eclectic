Spec: Authorized screenshot upload to Cloudflare R2 (Worker-free)

1. Goal
   Give Claude Code (running in the remote execution environment) a one-call way to upload a PNG/JPEG/WebP/GIF and get back a stable public HTTPS URL it can embed in a PR description or comment. Uploads are validated and size-limited client-side, content-addressed (so identical bytes dedupe), and go straight to R2 via a scoped S3 token — no Worker, no server to deploy or maintain.

2. Non-goals
   Not a general file host or CDN for app assets.
   Not for private/secret images (anything uploaded is world-readable, because GitHub's Camo fetches anonymously).
   No deletion/management API in v1 (retention handled by lifecycle policy).

3. Approach: direct R2 (S3 SigV4) from a small npx CLI
   Earlier drafts put a Cloudflare Worker in front of R2 for server-side policy enforcement. That makes sense when the client is untrusted — but here the client is a single authorized agent. So we push validation to the (trusted) client and delete the deployable entirely.

   What the Worker would have bought us, and where it lands now:
   - Magic-byte type check + size cap → run in the CLI before the PUT (real byte sniffing, not bash `file` heuristics).
   - Content-addressed key / dedup → CLI computes sha256 locally; the key is deterministic from bytes, so no server needed.
   - Audit → R2 access logs + repo/PR stored as object custom metadata.
   - Revocation → rotate the scoped R2 token (same effort as rotating a Worker secret).

   Cost note: Workers are free at this volume; the saving isn't money, it's one fewer thing to deploy, keep alive, and maintain (no wrangler, no TS service, no route). The one real downgrade vs. a Worker: a leaked R2 token can write/overwrite/list objects in the bucket, whereas a Worker token could only upload valid images. Contained by scoping the token to one single-purpose, lifecycle-expired, public bucket. If abuse ever materializes, adding a Worker later is a drop-in — same URL scheme, same keys.

4. Architecture
   Claude (remote env)
   │ npx @zagrajmy/shots <file> [repo] [pr]
   │ ├─ sniff magic bytes + check size (≤10 MB)
   │ ├─ sha256(bytes) → key  s/<sha>.<ext>
   │ └─ PUT (S3 SigV4, aws4fetch, scoped R2 token)
   ▼
   <account>.r2.cloudflarestorage.com / ludamus-screenshots   (PutObject)
   ▼
   prints  https://shots.zagrajmy.dev/s/<sha>.<ext>
   ▼
   GitHub PR markdown  <img src="https://shots.zagrajmy.dev/s/<sha>.<ext>">
   └─ GitHub Camo fetches + re-hosts (anonymous GET, must be public)

   GET of /s/* is served by the bucket's custom domain (public read). Prefer a custom domain (shots.<domain>); avoid *.r2.dev for anything load-bearing (rate-limited, not meant for production).

5. CLI contract
   npx @zagrajmy/shots <file> [repo] [pr]

   Args:
   <file> (required) — path to the image
   repo (optional) — owner/name, stored as object metadata for audit
   pr (optional) — PR number, stored as object metadata for audit
   Env (required): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY

   stdout: the public URL  https://shots.zagrajmy.dev/s/<sha>.<ext>
   exit 0 → uploaded (or already present; dedup)
   exit non-zero → unsupported type, file too large, missing env, or R2 error (message on stderr)

   Idempotent: key is content-addressed = s/<sha256(bytes)>.<ext>. Re-uploading identical bytes is a no-op (HEAD-then-PUT skips the upload), so retries are safe and identical screenshots dedupe.

6. Auth & secrets
   Scoped R2 API token (S3 access key + secret) bound to the one bucket, Object Read+Write only. Claude holds it via the remote env's env-var config (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY) — not committed, not in chat.
   Rotation: generate a new token, update the env vars, delete the old token; it dies immediately.
   Tighten where R2 allows: Object Read+Write, single bucket, no admin. (R2's "Object Read & Write" includes delete; if you want to deny overwrite/delete entirely, that's not granular in R2 today — accept it, or front with a Worker later if it ever matters.)

7. Validation & limits (enforced in the CLI)
   Type allowlist by magic bytes (not the file extension): PNG, JPEG, WebP, GIF. Reject everything else (no SVG — SVG can carry script).
   Max size: 10 MB (configurable). Checked before the PUT.
   Set on PutObject: ContentType from the sniffed type, CacheControl: public, max-age=31536000, immutable, Content-Disposition: inline.
   Ignore the client filename for the key (content-addressed); keep repo/pr as R2 custom metadata (x-amz-meta-*) for audit.

8. Object key & retention
   Key: s/<sha256hex>.<ext> (immutable, dedup, cache-forever).
   Lifecycle: R2 lifecycle rule to expire s/ after, say, 365 days (PRs are usually merged long before; bump or disable for permanent history). Documented knob.

9. Public serving & GitHub rendering
   Bucket connected to custom domain shots.<domain> (Cloudflare-managed cert, on the CDN), public read.
   GET must be anonymous/public (Camo fetches without auth).
   Camo caches the image; even if R2 lifecycle later deletes it, already-rendered PRs keep showing GitHub's cached copy (best-effort, don't rely on it).

10. Network policy requirement
    The remote env's outbound network is governed by its network policy. Both endpoints must be allowlisted:
    - <account>.r2.cloudflarestorage.com — the S3 upload endpoint (PUT/HEAD).
    - shots.<domain> — the public read endpoint (and what Camo fetches).
    (This is exactly why catbox/0x0 worked/failed inconsistently earlier — the host wasn't allowlisted.)

11. Security & abuse considerations
    Scoped R2 token = capability; treat as a secret, rotate on suspicion.
    Size + type limits (in the CLI) cap malware/abuse on the honest path.
    Single-purpose bucket + lifecycle expiry contain the blast radius of a leaked token (worst case: junk objects that expire).
    Repo/PR recorded in object metadata for review.
    Reputational note: anything served under your domain is associated with you; image-only uploads for your PRs keep it boring.
    No per-token rate limit without a Worker — acceptable for a single agent; revisit if abused.

12. Observability / audit
    R2 access logs (enable on the bucket) record GET/PUT activity.
    Per-object: repo, pr, and original alt/slug live in custom metadata, so you can answer "what did the agent upload, for which PR." For richer structured logs, front with a Worker later.

13. CLI implementation (sketch, Node 20+, ESM)
    Dep: aws4fetch (Cloudflare's tiny SigV4 lib, built for R2). Node gives fetch, crypto.subtle, fs/promises natively.

    import { AwsClient } from "aws4fetch";
    import { readFile } from "node:fs/promises";

    const ACCOUNT = process.env.R2_ACCOUNT_ID;
    const BUCKET  = "ludamus-screenshots";
    const DOMAIN  = "shots.zagrajmy.dev";
    const MAX     = 10 * 1024 * 1024;

    const sniff = (b) =>
      b[0]===0x89 && b[1]===0x50 ? ["image/png","png"]  :
      b[0]===0xff && b[1]===0xd8 ? ["image/jpeg","jpg"] :
      b[0]===0x47 && b[1]===0x49 ? ["image/gif","gif"]  :
      b[0]===0x52 && b[8]===0x57 && b[9]===0x45 ? ["image/webp","webp"] : null;

    const [file, repo = "", pr = ""] = process.argv.slice(2);
    if (!file) { console.error("usage: shots <file> [repo] [pr]"); process.exit(2); }
    const body = await readFile(file);
    if (body.length > MAX) { console.error("too large"); process.exit(1); }
    const kind = sniff(body); if (!kind) { console.error("unsupported type"); process.exit(1); }
    const [ct, ext] = kind;

    const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", body))]
      .map((x) => x.toString(16).padStart(2, "0")).join("");
    const key = `s/${sha}.${ext}`;

    const client = new AwsClient({
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      service: "s3", region: "auto",
    });
    const url = `https://${ACCOUNT}.r2.cloudflarestorage.com/${BUCKET}/${key}`;

    const head = await client.fetch(url, { method: "HEAD" });
    if (!head.ok) {
      const put = await client.fetch(url, {
        method: "PUT", body,
        headers: {
          "content-type": ct,
          "cache-control": "public, max-age=31536000, immutable",
          "content-disposition": "inline",
          "x-amz-meta-repo": repo,
          "x-amz-meta-pr": pr,
        },
      });
      if (!put.ok) { console.error(`R2 ${put.status}`); process.exit(1); }
    }
    console.log(`https://${DOMAIN}/${key}`);

    Package: mirror validate-mdx-links's setup in this monorepo. bin entry → this script; publish to NPM so any session runs npx @zagrajmy/shots. Optionally wrap as a small /screenshot skill for discoverability.

14. Client usage
    npx @zagrajmy/shots after.png zagrajmy/ludamus 319   # prints the public URL
    Then ![before](URL) / ![after](URL) into the PR body via mcp__github__update_pull_request.

15. Cloudflare setup checklist (your side)
    Create R2 bucket, e.g. ludamus-screenshots.
    Add custom domain shots.zagrajmy.dev → bucket (public read).
    Lifecycle rule: expire s/ after 365d (or none).
    Create a scoped R2 API token: Object Read+Write, this bucket only. Note the Account ID, Access Key ID, Secret.
    Give Claude R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY via the remote env's env-var config.
    Allowlist both <account>.r2.cloudflarestorage.com and shots.zagrajmy.dev in the Claude environment's network policy.
    (Optional) Enable R2 access logs on the bucket.

16. Acceptance criteria
    npx @zagrajmy/shots after.png zagrajmy/ludamus 319 prints an https://shots.<domain>/s/<sha>.<ext> URL.
    That URL returns 200 image/png anonymously.
    Embedding it in a PR description renders the image (via Camo) for logged-out viewers.
    A 20 MB file → exit non-zero ("too large"); a .txt renamed .png → exit non-zero ("unsupported type").
    Re-uploading the same file returns the same URL and skips the PUT (dedup).
    Both endpoints are reachable from the Claude remote environment (network policy).

17. Open questions for you
    Package name — @zagrajmy/shots, or something else?
    Domain — shots.zagrajmy.dev, or another?
    Retention — expire s/ after 365d, or keep PR screenshots permanently?
    Token scope — Object Read+Write is fine, or do you care about denying overwrite/delete (would require a Worker)?
    Want the package scaffolded in this monorepo (mirroring validate-mdx-links) + a /screenshot skill?
