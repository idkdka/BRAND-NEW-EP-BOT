// Trello integration — creates a card whenever someone verifies (see verify.js).
// Needs TRELLO_API_KEY and TRELLO_TOKEN in the environment (never stored in the
// config file, same convention as ROBLOX_API_KEY / ROBLOX_COOKIE).

const TRELLO_API = 'https://api.trello.com/1';

function creds() {
  const key = process.env.TRELLO_API_KEY;
  const token = process.env.TRELLO_TOKEN;
  if (!key || !token) return null;
  return { key, token };
}

// Create a card named `name` on the given list (and board), with the given
// label applied. Returns { ok, id, url } or { error }.
export async function createCard({ name, listId, labelId, boardId }) {
  const c = creds();
  if (!c) return { error: 'Trello is not configured (set `TRELLO_API_KEY` and `TRELLO_TOKEN`).' };
  if (!listId) return { error: 'No Trello list is configured.' };

  const params = new URLSearchParams({ key: c.key, token: c.token, idList: listId, name });
  if (labelId) params.set('idLabels', labelId);
  if (boardId) params.set('idBoard', boardId);

  let res;
  try {
    res = await fetch(`${TRELLO_API}/cards?${params.toString()}`, { method: 'POST' });
  } catch (e) {
    return { error: `Could not reach Trello: ${e.message}` };
  }

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const msg = json?.message || json?.raw || 'unknown';
    return { error: `Trello rejected the card (HTTP ${res.status}: ${msg}).` };
  }
  return { ok: true, id: json.id, url: json.shortUrl || json.url };
}
