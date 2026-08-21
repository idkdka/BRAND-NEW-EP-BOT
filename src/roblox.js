// Roblox integration:
//  - resolveRobloxId(): posts a Discord mention in the resolver channel and reads
//    the Roblox User ID back from the resolver bot's reply.
//  - setRank(): updates a user's group role via the Roblox Open Cloud v2 API.
//
// The Open Cloud API key is read from the ROBLOX_API_KEY environment variable
// (never stored in the JSON config). The key must have group member-management
// permission on the group, and the key's account must outrank the target rank.

const OPEN_CLOUD = 'https://apis.roblox.com/cloud/v2';

function apiKey() {
  return process.env.ROBLOX_API_KEY || null;
}

async function ocFetch(path, options = {}) {
  const res = await fetch(`${OPEN_CLOUD}${path}`, {
    ...options,
    headers: {
      'x-api-key': apiKey(),
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
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

// Find the role resource path (groups/{g}/roles/{r}) whose rank number matches.
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

// Find the membership resource path for a Roblox user in the group.
async function findMembershipPath(groupId, robloxUserId) {
  const q = new URLSearchParams({
    maxPageSize: '10',
    filter: `user == 'users/${robloxUserId}'`,
  });
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
  if (!ok) {
    return { error: `Roblox rejected the rank update (HTTP ${status}: ${json?.message || 'unknown'}).` };
  }
  return { ok: true, roleName: role.name };
}

// Pull a Roblox user ID out of the resolver bot's reply (content or embeds).
export function extractRobloxId(msg) {
  const parts = [msg.content || ''];
  for (const e of msg.embeds || []) {
    if (e.title) parts.push(e.title);
    if (e.description) parts.push(e.description);
    if (e.footer?.text) parts.push(e.footer.text);
    if (e.author?.name) parts.push(e.author.name);
    for (const f of e.fields || []) {
      parts.push(f.name);
      parts.push(f.value);
    }
  }
  // Strip Discord tokens (<@123>, <#123>, <@&123>) so we don't grab a snowflake.
  const text = parts.join(' ').replace(/<[@#][!&]?\d+>/g, ' ');
  // Roblox IDs are up to ~10 digits; Discord snowflakes are 17-19. Take the first
  // standalone 2-12 digit number.
  const matches = text.match(/\b\d{2,12}\b/g) || [];
  return matches[0] || null;
}

// Post the mention in the resolver channel and wait for the resolver bot's reply.
// Returns { robloxId } or { error }.
export async function resolveRobloxId(guild, discordUserId, gcfg, timeoutMs = 15000) {
  let channel;
  try {
    channel = await guild.channels.fetch(gcfg.resolver_channel);
  } catch {
    return { error: 'The resolver channel is not set or I can’t see it. Run `/groupapi setup`.' };
  }
  if (!channel?.isTextBased()) return { error: 'The resolver channel is invalid.' };

  // Start listening before we post, so we can't miss a fast reply.
  const collector = channel.createMessageCollector({
    filter: (m) => m.author.id === gcfg.resolver_bot_id,
    max: 1,
    time: timeoutMs,
  });

  const waitForReply = new Promise((resolve) => {
    collector.on('collect', (m) => resolve(m));
    collector.on('end', (collected) => resolve(collected.first() || null));
  });

  try {
    // Send just the mention; suppress the ping so it isn't noisy. The mention text
    // still lands in the message content for the resolver bot to read.
    await channel.send({ content: `<@${discordUserId}>`, allowedMentions: { parse: [] } });
  } catch {
    collector.stop();
    return { error: 'I couldn’t post in the resolver channel (missing Send Messages permission?).' };
  }

  const reply = await waitForReply;
  if (!reply) return { error: 'The resolver bot didn’t respond in time.' };

  const robloxId = extractRobloxId(reply);
  if (!robloxId) return { error: 'I couldn’t find a Roblox ID in the resolver bot’s reply.' };
  return { robloxId };
}
