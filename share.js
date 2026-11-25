// share_v1: the page asks Link to share a link to this same Mini App in Link
// chats. Link builds the link, shows its own chat picker with the text, and the
// user sends it. The page never names a URL or a chat and never learns who got it.
export const SHARE_CAPABILITY = 'share_v1';
// The picker stays open as long as the user keeps it open; this only bounds the wait.
export const SHARE_TIMEOUT_MS = 10 * 60 * 1000;
export const MAX_SHARE_TEXT = 500;

const START = /^[A-Za-z0-9._-]{1,256}$/;
// C0/C1 controls other than tab and line feed, and bidi embeddings, overrides
// and isolates, which can make text read differently from what is sent.
const FORBIDDEN = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F‪-‮⁦-⁩]/;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function validText(value) {
  return typeof value === 'string' && value.trim() !== '' && !FORBIDDEN.test(value) &&
    value.isWellFormed?.() !== false && [...value].length <= MAX_SHARE_TEXT;
}

// Application options { start?, text? } → wire params. Throws the code only.
export function shareParams(options) {
  if (options === undefined) return {};
  if (!record(options) || Object.keys(options).some(key => key !== 'start' && key !== 'text')) throw 'INVALID_SHARE_REQUEST';
  const params = {};
  if (options.start !== undefined) {
    if (typeof options.start !== 'string' || !START.test(options.start)) throw 'INVALID_SHARE_REQUEST';
    params.start = options.start;
  }
  if (options.text !== undefined) {
    if (!validText(options.text)) throw 'INVALID_SHARE_REQUEST';
    params.text = options.text;
  }
  return params;
}

// Same rules for a packet arriving at a host adapter.
export function isShareParams(params) {
  if (!record(params)) return false;
  try {
    const copy = shareParams(params);
    return Object.keys(copy).length === Object.keys(params).length;
  } catch { return false; }
}

// Host result → the only value the page sees.
export function shareResult(value) {
  if (!record(value) || !['shared', 'cancelled'].includes(value.outcome)) throw 'INVALID_HOST_RESPONSE';
  return Object.freeze({ outcome: value.outcome });
}
