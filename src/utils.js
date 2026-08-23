import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';

export const BRAND = 0x5865f2; // discord blurple

export function hasRole(member, roleId) {
  return !!roleId && member.roles.cache.has(roleId);
}

// True if the member has ANY of the given role IDs (used for multi-role tiers
// like Staff, which can now be up to 2 roles).
export function hasAnyRole(member, roleIds) {
  if (!roleIds || !roleIds.length) return false;
  return roleIds.some((id) => id && member.roles.cache.has(id));
}

export function isAdmin(member) {
  return member.permissions.has(PermissionFlagsBits.Administrator);
}

// Pull all user mentions / raw 17-20 digit IDs out of a string -> unique IDs.
export function parseUserIds(str) {
  if (!str) return [];
  const ids = new Set();
  const re = /(?:<@!?(\d{17,20})>|(\d{17,20}))/g;
  let m;
  while ((m = re.exec(str)) !== null) ids.add(m[1] || m[2]);
  return [...ids];
}

// Resolve a list of IDs to guild members. Returns { members, missing }.
export async function resolveMembers(guild, ids) {
  const members = [];
  const missing = [];
  for (const id of ids) {
    try {
      members.push(await guild.members.fetch(id));
    } catch {
      missing.push(id);
    }
  }
  return { members, missing };
}

export async function sendLog(guild, channelId, payload) {
  if (!channelId) return false;
  try {
    const ch = await guild.channels.fetch(channelId);
    if (ch && ch.isTextBased()) {
      await ch.send(payload);
      return true;
    }
  } catch (e) {
    console.error('sendLog failed:', e.message);
  }
  return false;
}

export function baseEmbed(title) {
  return new EmbedBuilder().setColor(BRAND).setTitle(title).setTimestamp();
}

// Reply (or follow up) with an ephemeral refusal message.
export function deny(interaction, text) {
  const payload = { content: '🚫 ' + text, ephemeral: true };
  if (interaction.deferred || interaction.replied) return interaction.followUp(payload);
  return interaction.reply(payload);
}

// Set a member's server nickname to their Roblox username (called after a
// successful verification). Never throws — returns { ok } or { ok: false, reason }
// so callers can tell the user why it didn't stick (hierarchy, permissions, etc).
export async function syncNickname(member, name) {
  if (!member || !name) return { ok: false, reason: 'missing-name' };
  if (member.guild.ownerId === member.id) return { ok: false, reason: 'owner' };
  if (!member.manageable) return { ok: false, reason: 'hierarchy' };
  try {
    await member.setNickname(name.slice(0, 32), 'Roblox verification');
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

export function nicknameFailureNote(reason) {
  if (reason === 'owner') return "I couldn't update your nickname (server owners can't be renamed by bots).";
  if (reason === 'hierarchy') {
    return "I couldn't update your nickname (my role needs to be above yours to rename you).";
  }
  return `I couldn't update your nickname (${reason || 'missing permission'}).`;
}

// Split a long string into <=1024 char chunks for embed fields.
export function chunkLines(lines, max = 1000) {
  const chunks = [];
  let cur = '';
  for (const line of lines) {
    if ((cur + line + '\n').length > max) {
      if (cur) chunks.push(cur);
      cur = line + '\n';
    } else {
      cur += line + '\n';
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}
