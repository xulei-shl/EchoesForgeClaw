/**
 * Who placed this, without knowing who placed this.
 *
 * Two identities, and the split is the point. The address is the *pace* — one
 * blob per address per day — and it is stored only as a hash that stops being
 * derivable when the day ends. The cookie token is the *durable* one, and it
 * grants finding rather than editing: it is how "Find mine" survives a cleared
 * browser or a second device, and there is no endpoint that takes one and
 * changes anything.
 */

const encoder = new TextEncoder();

const hex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, "0")).join("");

const sha256 = async (value: string) => hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));

/** The UTC day a moment falls in, as `YYYY-MM-DD`. UTC rather than anything
 * local because the cooldown is a property of the wall, not of where you are
 * standing — two people in different timezones get the same day boundary. */
export const dayOf = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);

/**
 * An address, hashed beyond recovery.
 *
 * The day is in the digest as well as the secret, so the same address hashes
 * differently tomorrow. That is what makes the quota row expire without a
 * cleanup job: nothing can recompute yesterday's hash, so nothing can join
 * yesterday's rows to today's visitor.
 */
export const hashAddress = (ip: string, day: string, secret: string) =>
  sha256(`${secret}:${day}:${ip}`);

/**
 * The address, as Cloudflare reports it.
 *
 * `CF-Connecting-IP` and nothing else: `X-Forwarded-For` is client-supplied and
 * a rate limit that trusts it is a rate limit with an opt-out header. A request
 * arriving without one is not from the edge, and the caller refuses it rather
 * than lumping every such request under one shared bucket.
 */
export const addressOf = (request: Request) => request.headers.get("CF-Connecting-IP");

/** A fresh token. 32 bytes of CSPRNG — this is the only thing a visitor holds
 * that proves a blobatar is theirs. */
export const newToken = () => hex(crypto.getRandomValues(new Uint8Array(32)).buffer);

/** Tokens are stored hashed, so a leaked database is not a pile of working
 * credentials. Unsalted SHA-256 is right here and would not be for a password:
 * the input is 256 bits of randomness, so there is no dictionary to run. */
export const hashToken = (token: string) => sha256(token);

/** A token is only ever a hex string of the length `newToken` produces. Checked
 * before it reaches a query, so a cookie a stranger wrote cannot become a
 * pattern match against the token index. */
export const looksLikeToken = (value: string) => /^[0-9a-f]{64}$/.test(value);

export const COOKIE = "wall";

/**
 * A year, `HttpOnly`, `Secure`, `SameSite=Lax`.
 *
 * `HttpOnly` because nothing on the page needs to read it — the client finds
 * its own blob from `localStorage` on the fast path, and this is the slow path
 * that runs on a device where `localStorage` is empty. `Lax` rather than
 * `Strict` so that arriving from a shared link and clicking "Find mine" still
 * works on the first navigation.
 */
export const setCookie = (token: string) =>
  `${COOKIE}=${token}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`;

/** The token this request carries, if it carries a well-formed one. */
export function tokenFrom(request: Request): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== COOKIE) continue;
    const value = rest.join("=");
    return looksLikeToken(value) ? value : null;
  }
  return null;
}

/**
 * Constant-time string comparison, for the moderation token.
 *
 * `a === b` on a secret leaks its prefix through timing. The length is compared
 * first and does leak — that is unavoidable without hashing both sides, and the
 * length of an admin token is not the secret.
 */
export function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
