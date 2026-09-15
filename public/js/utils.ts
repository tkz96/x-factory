// public/js/utils.ts — DOM selector, HTTP API, and input value utilities.

export const $ = <T extends Element = HTMLElement>(sel: string): T | null =>
  document.querySelector<T>(sel);

export const $$ = <T extends Element = HTMLElement>(
  sel: string,
): NodeListOf<T> => document.querySelectorAll<T>(sel);

export function showError(el: HTMLElement | null, msg: string): void {
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}

export function hideError(el: HTMLElement | null): void {
  if (!el) return;
  el.hidden = true;
  el.textContent = "";
}

export async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  const opts: RequestInit = {
    method,
    headers,
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, opts);
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export function setVal(id: string, val: string | null | undefined): void {
  if (!id) return;
  const sel = id.startsWith("#") || id.startsWith(".") ? id : `#${id}`;
  const el = $<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(sel);
  if (el) el.value = val || "";
}

export function getVal(id: string, fallback = ""): string {
  if (!id) return fallback;
  const sel = id.startsWith("#") || id.startsWith(".") ? id : `#${id}`;
  const el = $<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(sel);
  return el ? el.value : fallback;
}
