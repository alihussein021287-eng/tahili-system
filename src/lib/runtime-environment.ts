export type TahiliRuntimeEnvironment = "development" | "production";

export function tahiliRuntimeEnvironment(
  env: Record<string, string | undefined> = process.env,
): TahiliRuntimeEnvironment {
  return env.TAHILI_ENVIRONMENT === "production" ? "production" : "development";
}
