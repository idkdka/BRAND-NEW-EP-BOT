import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';

export const BRAND = 0x5865f2; // discord blurple

export function hasRole(member, roleId) {
  return !!roleId && member.roles.cache.has(roleId);
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
