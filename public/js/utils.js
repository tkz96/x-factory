// fallow-ignore-file coverage-gaps
// public/js/utils.js — DOM selector, HTTP API, diff formatting, and string utilities.

export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => document.querySelectorAll(sel);

export function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

export function showError(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}

export function hideError(el) {
  if (!el) return;
  el.hidden = true;
  el.textContent = "";
}

export function formatDiff(diffText) {
  if (!diffText) return "";
  const lines = diffText.split("\n");
  return lines
    .map((line) => {
      const esc = escapeHtml(line);
      if (line.startsWith("+") && !line.startsWith("+++")) {
        return `<span class="diff-line diff-add">${esc}</span>`;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        return `<span class="diff-line diff-del">${esc}</span>`;
      } else if (line.startsWith("@@")) {
        return `<span class="diff-line diff-hunk">${esc}</span>`;
      }
      return `<span class="diff-line">${esc}</span>`;
    })
    .join("\n");
}

export async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function setVal(id, val) {
  if (!id) return;
  const sel = id.startsWith("#") || id.startsWith(".") ? id : `#${id}`;
  const el = $(sel);
  if (el) el.value = val || "";
}

export function getVal(id, fallback = "") {
  if (!id) return fallback;
  const sel = id.startsWith("#") || id.startsWith(".") ? id : `#${id}`;
  const el = $(sel);
  return el ? el.value : fallback;
}
