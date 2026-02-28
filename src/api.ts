import { invoke } from "@tauri-apps/api/core";

let _baseUrl: string | null = null;

export async function getBaseUrl(): Promise<string> {
  if (_baseUrl) return _baseUrl;

  if (import.meta.env.DEV) {
    _baseUrl = "/api";
  } else {
    const port = await invoke<number>("get_backend_port");
    _baseUrl = `http://127.0.0.1:${port}`;
  }
  return _baseUrl;
}

export async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const base = await getBaseUrl();
  return fetch(`${base}${path}`, init);
}
