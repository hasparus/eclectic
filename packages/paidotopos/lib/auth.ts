export const COOKIE = "paidotopos-session";
const encoder = new TextEncoder();
async function signature(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
  );
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
export function constantEqual(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
export async function createSession(secret: string) {
  const expires = String(Date.now() + 7 * 86400000);
  return `${expires}.${await signature(expires, secret)}`;
}
export async function validSession(
  token: string | undefined,
  secret: string | undefined,
) {
  if (!token || !secret) return false;
  const [expires, mac, extra] = token.split(".");
  return (
    !extra &&
    /^\d+$/.test(expires) &&
    Number(expires) > Date.now() &&
    constantEqual(mac || "", await signature(expires, secret))
  );
}
export function safeNext(path: string | null) {
  return path?.startsWith("/") &&
    !path.startsWith("//") &&
    !path.includes("\\") &&
    !/[\r\n]/.test(path)
    ? path
    : "/";
}
