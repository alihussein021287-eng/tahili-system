/**
 * Re-runs a Serializable transaction that PostgreSQL aborted with a serialization conflict (Prisma P2034).
 * The aborted attempt is rolled back completely, so a retry cannot duplicate side effects. Any other error,
 * including authorization failures, is thrown immediately.
 */
export async function withSerializableRetry<T>(run: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (attempt >= maxRetries || code !== "P2034") throw error;
    }
  }
}
