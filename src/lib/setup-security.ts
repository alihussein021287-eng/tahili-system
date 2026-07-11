const SETUP_DISABLED_MESSAGE = "التهيئة غير متاحة";

export function isInitialSetupAllowed(value = process.env.ALLOW_INITIAL_SETUP) {
  return value === "true";
}

export function assertInitialSetupAllowed(value = process.env.ALLOW_INITIAL_SETUP) {
  if (!isInitialSetupAllowed(value)) throw new Error(SETUP_DISABLED_MESSAGE);
}

