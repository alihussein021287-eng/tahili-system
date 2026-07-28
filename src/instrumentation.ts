export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.OTEL_ENABLED !== "true") return;
  try {
    const { startServerTracing } = await import("./lib/otel/server");
    startServerTracing();
  } catch {
    // Observability must never delay or fail application startup.
  }
}
