"use client";

const TRUST_CLEANER_AUTH_TOKEN_KEY = "trust_cleaner_auth_token";

export function readClientAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TRUST_CLEANER_AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function writeClientAuthToken(token: string | null | undefined): void {
  if (typeof window === "undefined" || !token) return;
  try {
    window.localStorage.setItem(TRUST_CLEANER_AUTH_TOKEN_KEY, token);
  } catch {}
}

export function clearClientAuthToken(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(TRUST_CLEANER_AUTH_TOKEN_KEY);
  } catch {}
}

export function clientAuthHeaders(base?: HeadersInit): HeadersInit {
  const headers = new Headers(base);
  const token = readClientAuthToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}
