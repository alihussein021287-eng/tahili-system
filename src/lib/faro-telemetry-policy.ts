// This is the single source of truth for approved automatic browser
// instrumentations. Synthetic envelopes never mutate this policy.
export const FARO_AUTOMATIC_INSTRUMENTATIONS: [] = [];

export const FARO_TELEMETRY_EXPECTED =
  FARO_AUTOMATIC_INSTRUMENTATIONS.length > 0;
