const KEY = "pw_openai_api_key";

export function getStoredApiKey(): string {
  try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; }
}

export function setStoredApiKey(key: string): void {
  try {
    if (key) localStorage.setItem(KEY, key);
    else localStorage.removeItem(KEY);
  } catch { /* ignore */ }
}
