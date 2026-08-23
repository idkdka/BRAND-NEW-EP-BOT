// Roblox integration.
//  - getUserIdFromUsername(): resolve a username -> user ID (public API).
//  - getUserInfo(): read a user's name + bio/description (Open Cloud if a key is
//    set, otherwise the public API).
//  - setRank(): update a user's group role via Roblox Open Cloud v2 (needs a key).
//
// ROBLOX_API_KEY (env) is only required for setRank. Verification lookups work
// without it via the public users API.

const OPEN_CLOUD = 'https://apis.roblox.com/cloud/v2';
const USERS_API = 'https://users.roblox.com/v1';

function apiKey() {
  return process.env.ROBLOX_API_KEY || null;
}

async function ocFetch(path, options = {}) {
  const res = await fetch(`${OPEN_CLOUD}${path}`, {
    ...options,
    headers: { 'x-api-key': apiKey(), 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json };
}

// Resolve a Roblox username to { id, name }.
export async function getUserIdFromUsername(username) {
  try {
    const res = await fetch(`${USERS_API}/usernames/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
    });
    if (!res.ok) return { error: `Roblox username lookup failed (HTTP ${res.status}).` };
    const json = await res.json();
    const u = json?.data?.[0];
    if (!u) return { error: `No Roblox user found with the username "${username}".` };
    return { id: String(u.id), name: u.name };
  } catch {
    return { error: 'Could not reach Roblox to look up that username.' };
  }
}

// Read a Roblox user's { id, name, displayName, description }.
export async function getUserInfo(userId) {
  // Prefer Open Cloud when a key is set (more reliable from server hosts).
  if (apiKey()) {
    try {
      const { ok, json } = await ocFetch(`/users/${userId}`);
      if (ok) {
        return {
          id: String(json.id ?? userId),
          name: json.name,
          displayName: json.displayName,
          description: json.about || '',
        };
      }
    } catch {
      /* fall through to public API */
    }
  }
  try {
    const res = await fetch(`${USERS_API}/users/${userId}`);
    if (res.status === 404) return { error: 'That Roblox user ID does not exist.' };
    if (!res.ok) return { error: `Roblox returned an error reading that profile (HTTP ${res.status}).` };
    const json = await res.json();
    return {
      id: String(json.id),
      name: json.name,
      displayName: json.displayName,
      description: json.description || '',
    };
  } catch {
    return { error: 'Could not reach Roblox to read that profile.' };
  }
}

// ---------- Group join requests (Open Cloud v2) ----------
// Accepting/declining a pending request is fully supported by Open Cloud; the
// "join request ID" in the URL is simply the requester's Roblox user ID.

export async function acceptJoinRequest(groupId, robloxUserId) {
  if (!apiKey()) return { error: 'Roblox API key is not configured (set `ROBLOX_API_KEY`).' };
  const { ok, status, json } = await ocFetch(`/groups/${groupId}/join-requests/${robloxUserId}:accept`, {
    method: 'POST',
  });
  if (!ok) {
    if (status === 404) return { error: 'That user doesn’t have a pending join request for this group.' };
    return { error: `Roblox rejected the accept request (HTTP ${status}: ${json?.message || 'unknown'}).` };
  }
  return { ok: true };
}

// ---------- Group kicks (legacy cookie-authenticated Ban API) ----------
// Open Cloud (the ROBLOX_API_KEY used everywhere else in this file) has NO
// endpoint to remove an existing group member — Roblox has never shipped one.
// The real mechanism is Roblox's Group Ban system (groups.roblox.com/v1/groups/
// {id}/bans/{userId}), which removes the member AND blocks them (and their alts)
// from rejoining until unbanned — a proper kick, not just a one-time removal.
// It authenticates with a logged-in account's session cookie instead of an API
// key. Requires ROBLOX_COOKIE (a .ROBLOSECURITY value) in the environment; the
// account it belongs to must outrank whoever it's kicking.
//
// User-facing wording always says "kick" / "kicked", never "ban" — this is just
// which underlying Roblox mechanism makes that stick.

const GROUPS_V1 = 'https://groups.roblox.com/v1';

function cookieHeader() {
  const cookie = process.env.ROBLOX_COOKIE;
  return cookie ? `.ROBLOSECURITY=${cookie}` : null;
}

// Roblox's cookie-authenticated endpoints require an X-CSRF-TOKEN header, which
// can only be obtained by making a request and reading it off a 403 response.
// So: try once with no token, and if rejected, retry once with the token Roblox
// hands back. (This never actually performs a mutating request without a valid
// token — the 403 happens before Roblox processes anything.)
async function legacyFetch(path, options = {}, _retried = false) {
  const cookie = cookieHeader();
  if (!cookie) {
    return { error: 'ROBLOX_COOKIE is not configured — removing group members needs a logged-in Roblox session.' };
  }

  const res = await fetch(`${GROUPS_V1}${path}`, {
    ...options,
    headers: { Cookie: cookie, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });

  if (res.status === 403 && !_retried) {
    const token = res.headers.get('x-csrf-token');
    if (token) {
      return legacyFetch(path, { ...options, headers: { ...(options.headers || {}), 'X-CSRF-TOKEN': token } }, true);
    }
  }

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json };
}

// Kick (ban) a member out of the group. Returns { ok } or { error }.
export async function kickFromGroup(groupId, robloxUserId) {
  const result = await legacyFetch(`/groups/${groupId}/bans/${robloxUserId}`, { method: 'POST' });
  if (result.error) return result;
  if (!result.ok) {
    const msg = result.json?.errors?.[0]?.message || result.json?.message || 'unknown';
    if (result.status === 400 && /not.*member/i.test(msg)) {
      return { error: 'That user is not a member of the group.' };
    }
    return { error: `Roblox rejected the kick (HTTP ${result.status}: ${msg}).` };
  }
  return { ok: true };
}

// Lift a kick, letting the user rejoin the group. Returns { ok } or { error }.
export async function unkickFromGroup(groupId, robloxUserId) {
  const result = await legacyFetch(`/groups/${groupId}/bans/${robloxUserId}`, { method: 'DELETE' });
  if (result.error) return result;
  if (!result.ok) {
    if (result.status === 404) return { error: 'That user isn’t currently kicked from the group.' };
    const msg = result.json?.errors?.[0]?.message || result.json?.message || 'unknown';
    return { error: `Roblox rejected the un-kick (HTTP ${result.status}: ${msg}).` };
  }
  return { ok: true };
}

// Pull a Roblox user ID out of one "bans" list entry. Undocumented endpoint, so
// this tolerates a few plausible shapes rather than assuming one exact schema.
function extractBannedUserId(item) {
  if (item == null) return null;
  if (typeof item === 'number' || typeof item === 'string') return String(item);
  if (item.user != null) {
    if (typeof item.user === 'object') return String(item.user.userId ?? item.user.id ?? '') || null;
    return String(item.user).replace(/^users\//, '');
  }
  if (item.userId != null) return String(item.userId);
  if (item.id != null) return String(item.id);
  return null;
}

// List everyone currently kicked from the group. Returns { ids, truncated } or
// { error }. Capped at a generous page count as a loop safety net, since the
// pagination shape isn't officially documented — `truncated` is set (never
// silently dropped) if the cap was actually hit.
export async function listKickedFromGroup(groupId) {
  const ids = [];
  let cursor = '';
  let pages = 0;
  const MAX_PAGES = 25;
  do {
    const q = new URLSearchParams({ limit: '100' });
    if (cursor) q.set('cursor', cursor);
    const result = await legacyFetch(`/groups/${groupId}/bans?${q.toString()}`, { method: 'GET' });
    if (result.error) return result;
    if (!result.ok) {
      const msg = result.json?.errors?.[0]?.message || result.json?.message || 'unknown';
      return { error: `Roblox rejected the kicked-list request (HTTP ${result.status}: ${msg}).` };
    }
    for (const item of result.json?.data || []) {
      const id = extractBannedUserId(item);
      if (id) ids.push(id);
    }
    cursor = result.json?.nextPageCursor || '';
    pages++;
  } while (cursor && pages < MAX_PAGES);
  return { ids, truncated: !!cursor };
}

// ---------- Group ranking (Open Cloud) ----------

async function findRolePathByRank(groupId, rank) {
  let pageToken = '';
  do {
    const q = new URLSearchParams({ maxPageSize: '100' });
    if (pageToken) q.set('pageToken', pageToken);
    const { ok, json } = await ocFetch(`/groups/${groupId}/roles?${q.toString()}`);
    if (!ok) return { error: `Couldn't read group roles (${json?.message || 'API error'}).` };
    for (const role of json.groupRoles || []) {
      if (Number(role.rank) === Number(rank)) return { path: role.path, name: role.displayName };
    }
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return { error: `No group role uses rank number ${rank}.` };
}

async function findMembershipPath(groupId, robloxUserId) {
  const q = new URLSearchParams({ maxPageSize: '10', filter: `user == 'users/${robloxUserId}'` });
  const { ok, json } = await ocFetch(`/groups/${groupId}/memberships?${q.toString()}`);
  if (!ok) return { error: `Couldn't look up group membership (${json?.message || 'API error'}).` };
  const m = (json.groupMemberships || [])[0];
  if (!m) return { error: 'That user is not a member of the group.' };
  return { path: m.path };
}

// Update a user's rank in the group. Returns { ok, roleName } or { error }.
export async function setRank(groupId, robloxUserId, rank) {
  if (!apiKey()) return { error: 'Roblox API key is not configured (set `ROBLOX_API_KEY`).' };
  const role = await findRolePathByRank(groupId, rank);
  if (role.error) return role;
  const mem = await findMembershipPath(groupId, robloxUserId);
  if (mem.error) return mem;
  const { ok, status, json } = await ocFetch(`/${mem.path}`, {
    method: 'PATCH',
    body: JSON.stringify({ role: role.path }),
  });
  if (!ok) return { error: `Roblox rejected the rank update (HTTP ${status}: ${json?.message || 'unknown'}).` };
  return { ok: true, roleName: role.name };
}
