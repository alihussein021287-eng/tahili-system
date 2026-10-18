export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.OTEL_ENABLED !== "true") return;
  try {
    const { startServerTracing } = await import("./lib/otel/server");
    startServerTracing();
  } catch {
    // Observability must never delay or fail application startup.
  }
}

/** Keeps the reason of a rejected save so the error screen can tell the user what went wrong. */
export async function onRequestError(error: unknown, request: { headers: Record<string, string | string[] | undefined> }) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { rememberUserError, sessionOwner } = await import("./lib/user-error-store");
    const cookie = request.headers?.cookie;
    rememberUserError((error as { digest?: string })?.digest, error, sessionOwner(Array.isArray(cookie) ? cookie.join("; ") : cookie));
  } catch {
    // Error reporting must never cause another error.
  }
}
