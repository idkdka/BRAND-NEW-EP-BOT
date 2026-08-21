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
