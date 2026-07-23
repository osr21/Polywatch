const STORAGE_KEY = "polywatch_admin_token";

/**
 * Fund-risk endpoints (bot config, order cancellation, credential
 * re-derivation) require a shared admin token set on the server via the
 * ADMIN_TOKEN secret. This module stores the token the owner enters in
 * localStorage (single browser/device) and exposes it to both the
 * Orval-generated API client (via setAuthTokenGetter) and any raw fetch
 * calls that bypass the generated client.
 */
export function getAdminToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setAdminToken(token: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    /* localStorage unavailable — ignore */
  }
}

export function clearAdminToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function adminAuthHeaders(): Record<string, string> {
  const token = getAdminToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
