export function incrementAuthVersion() {
  return { authVersion: { increment: 1 } } as const;
}

export function incrementAuthVersionIf(securityValueChanged: boolean) {
  return securityValueChanged ? incrementAuthVersion() : {};
}
