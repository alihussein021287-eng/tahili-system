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
      const meta = error && typeof error === "object" && "meta" in error ? (error as { meta?: { code?: unknown } }).meta : undefined;
      // Raw SELECT ... FOR UPDATE exposes PostgreSQL serialization failures as P2010/40001.
      const serialization = code === "P2034" || (code === "P2010" && meta?.code === "40001");
      if (attempt >= maxRetries || !serialization) throw error;
    }
  }
}
