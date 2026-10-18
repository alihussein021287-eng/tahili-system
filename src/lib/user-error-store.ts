import { createHash } from "node:crypto";

// Explains a failed save to the person who made it. A server action that rejects a request with an
// Arabic message (a clash, a missing field, a rule) reaches the error screen in production with only
// a digest; the message is kept here for a few minutes, tied to that person's session, so the error
// screen can show the real reason instead of a generic failure.
type Entry = { message: string; owner: string; at: number };
const TTL_MS = 10 * 60_000;
const MAX = 500;
const store: Map<string, Entry> = ((globalThis as any).__tahiliUserErrors ??= new Map<string, Entry>());

const ARABIC = /[؀-ۿ]/;

/** A stable key for the browser session, from the auth cookie only (never stored as-is). */
export function sessionOwner(cookieHeader: string | null | undefined): string | null {
  const token = (cookieHeader || "").split(/;\s*/).map((part) => part.split("=")).find(([name]) => /session-token/.test(name || ""))?.slice(1).join("=");
  return token ? createHash("sha256").update(token).digest("hex") : null;
}

/** Only short, Arabic, human-written messages are kept: never database or system errors. */
export function isUserFacing(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  if (/^Prisma|^PrismaClient/.test(error.name) || /prisma|SELECT |INSERT |ECONN|stack/i.test(error.message)) return false;
  return ARABIC.test(error.message) && error.message.length <= 300;
}

export function rememberUserError(digest: string | undefined, error: unknown, owner: string | null) {
  if (!digest || !owner || !isUserFacing(error)) return;
  const now = Date.now();
  for (const [key, entry] of store) if (now - entry.at > TTL_MS) store.delete(key);
  while (store.size >= MAX) store.delete(store.keys().next().value as string);
  store.set(digest, { message: error.message, owner, at: now });
}

export function readUserError(digest: string, owner: string | null): string | null {
  const entry = store.get(digest);
  if (!entry || !owner || entry.owner !== owner || Date.now() - entry.at > TTL_MS) return null;
  return entry.message;
}
