import { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } from 'discord.js';
import {
  getConfig,
  getPoints,
  addPoints,
  addPointsMulti,
  getTopEp,
  getAllPoints,
  getRanks,
  resetField,
} from './db.js';
import {
  hasRole,
  isAdmin,
  baseEmbed,
  deny,
  sendLog,
  parseUserIds,
  resolveMembers,
} from './utils.js';
import { epQuotacheck } from './quota.js';
import { syncRank } from './ranks.js';

const MEDALS = ['🥇', '🥈', '🥉', '4️⃣'];

// Every 1 EP awards this much XP.
export const XP_PER_EP = 25;

// Shared helper used by /assign ep and the -logep prefix command.
// Awards EP, the coupled XP (1 EP = XP_PER_EP), and syncs rank roles.
export async function applyEpAndLog(guild, members, amount, assigner) {
  const cfg = getConfig(guild.id);
  const ranks = getRanks(guild.id);
  const xpDelta = amount * XP_PER_EP;

  const results = [];
  const rankNotes = [];
  for (const m of members) {
    const pts = addPointsMulti(guild.id, m.id, { ep: amount, xp: xpDelta });
    const res = await syncRank(m, pts.xp, ranks);
    results.push({ member: m, ep: pts.ep, xp: pts.xp });
    if (res.direction === 'up') rankNotes.push(`${m} ranked up to <@&${res.targetRoleId}>`);
    else if (res.direction === 'down') rankNotes.push(`${m} dropped to <@&${res.targetRoleId ?? ''}>`);
  }

  const verb = amount >= 0 ? 'Gave' : 'Removed';
  const abs = Math.abs(amount);
  const embed = baseEmbed(`${verb} ${abs} EP  (${amount >= 0 ? '+' : ''}${xpDelta} XP)`)
    .setDescription(`Assigned by ${assigner}`)
    .addFields({
      name: 'Recipients',
      value: results.map((r) => `${r.member} → **${r.ep} EP**, ${r.xp} XP`).join('\n').slice(0, 1024),
    });
  if (rankNotes.length) {
    embed.addFields({ name: 'Rank changes', value: rankNotes.join('\n').slice(0, 1024) });
  }

  await sendLog(guild, cfg.ep_log_channel, { embeds: [embed] });
  return { embed, results };
}

// ======================= /ep =======================

export async function handleEp(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'view') return viewPoints(interaction, 'ep');
  if (sub === 'leaderboard') return epLeaderboard(interaction);
  if (sub === 'quotacheck') return epQuotacheck(interaction);
}

// ======================= /xp =======================

export async function handleXp(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'view') return xpView(interaction);
}

async function xpView(interaction) {
  const target = interaction.options.getUser('user') || interaction.user;
  const xp = getPoints(interaction.guildId, target.id).xp;
  const ranks = getRanks(interaction.guildId).sort((a, b) => a.xp - b.xp);

  let current = null;
  let next = null;
  for (const r of ranks) {
    if (xp >= r.xp) current = r;
    else {
      next = r;
      break;
    }
  }

  let desc = `${target} has **${xp} XP**.`;
  if (current) desc += `\nCurrent rank: <@&${current.role}>`;
  if (next) desc += `\nNext rank <@&${next.role}> at **${next.xp} XP** — ${next.xp - xp} to go.`;
  else if (current) desc += `\nThat’s the highest rank. 🎉`;

  await interaction.reply({ embeds: [baseEmbed('XP Balance').setDescription(desc)] });
}

// ======================= /op =======================

export async function handleOp(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'view') return viewPoints(interaction, 'op');
  if (sub === 'leaderboard') return opLeaderboard(interaction);
  if (sub === 'quotacheck') {
    const { opQuotacheck } = await import('./quota.js');
    return opQuotacheck(interaction);
  }
}

async function viewPoints(interaction, field) {
  const target = interaction.options.getUser('user') || interaction.user;
  const pts = getPoints(interaction.guildId, target.id);
  const label = field.toUpperCase();
  const value = pts[field];
  const embed = baseEmbed(`${label} Balance`).setDescription(
    `${target} has **${value} ${label}**.`,
  );
  await interaction.reply({ embeds: [embed] });
}

async function epLeaderboard(interaction) {
  await interaction.deferReply();
  const top = getTopEp(interaction.guildId, 4);
  if (!top.length) {
    return interaction.editReply({ embeds: [baseEmbed('🏆 EP Leaderboard').setDescription('No EP recorded yet.')] });
  }
  const lines = [];
  for (let i = 0; i < top.length; i++) {
    const row = top[i];
    let name = `<@${row.userId}>`;
    try {
      const u = await interaction.client.users.fetch(row.userId);
      name = u.tag;
    } catch {
      /* fall back to mention */
    }
    lines.push(`${MEDALS[i]} **${name}** — ${row.ep} EP`);
  }
  await interaction.editReply({
    embeds: [baseEmbed('🏆 EP Leaderboard — Top 4').setDescription(lines.join('\n'))],
  });
}

async function opLeaderboard(interaction) {
  await interaction.deferReply();
  const cfg = getConfig(interaction.guildId);
  if (!cfg.officer_role) {
    return interaction.editReply({
      embeds: [baseEmbed('🏆 OP Leaderboard').setDescription('No Officer role is set. Run `/setup` first.')],
    });
  }

  const all = await interaction.guild.members.fetch();
  const officers = all.filter((m) => !m.user.bot && m.roles.cache.has(cfg.officer_role));

  if (!officers.size) {
    return interaction.editReply({
      embeds: [baseEmbed('🏆 OP Leaderboard').setDescription('No members currently have the Officer role.')],
    });
  }

  const pointsMap = new Map(getAllPoints(interaction.guildId).map((p) => [p.userId, p.op]));
  const rows = [...officers.values()]
    .map((m) => ({ tag: m.user.tag, op: pointsMap.get(m.id) || 0 }))
    .sort((a, b) => b.op - a.op);

  const lines = rows.map((r, i) => `**${i + 1}.** ${r.tag} — ${r.op} OP`);
  const shown = lines.slice(0, 40).join('\n');
  const extra = lines.length > 40 ? `\n…and ${lines.length - 40} more.` : '';

  await interaction.editReply({
    embeds: [baseEmbed('🏆 OP Leaderboard — All Officers').setDescription(shown + extra)],
  });
}

// ======================= /assign =======================

export async function handleAssign(interaction) {
  const sub = interaction.options.getSubcommand(); // 'ep' | 'op' | 'xp'
  const cfg = getConfig(interaction.guildId);
  const amount = interaction.options.getInteger('amount');
  const usersStr = interaction.options.getString('users');

  // Permission: EP needs Officer; OP and XP need HICOM. (Admins always allowed.)
  if (sub === 'ep') {
    if (!hasRole(interaction.member, cfg.officer_role) && !isAdmin(interaction.member)) {
      return deny(interaction, 'Only members with the **Officer** role can assign EP.');
    }
  } else {
    if (!hasRole(interaction.member, cfg.hicom_role) && !isAdmin(interaction.member)) {
      return deny(interaction, `Only members with the **HICOM** role can assign ${sub.toUpperCase()}.`);
    }
  }

  if (amount === 0) return deny(interaction, 'Amount can’t be 0.');

  const ids = parseUserIds(usersStr);
  if (!ids.length) return deny(interaction, 'I couldn’t find any users. Mention them or paste their IDs.');

  await interaction.deferReply();
  const { members, missing } = await resolveMembers(interaction.guild, ids);
  if (!members.length) {
    return interaction.editReply('🚫 None of those users are in this server.');
  }
  const missFoot = missing.length
    ? { text: `${missing.length} ID(s) couldn’t be resolved and were skipped.` }
    : null;

  if (sub === 'ep') {
    const { embed } = await applyEpAndLog(interaction.guild, members, amount, interaction.user);
    if (missFoot) embed.setFooter(missFoot);
    return interaction.editReply({ embeds: [embed] });
  }

  if (sub === 'xp') {
    const ranks = getRanks(interaction.guildId);
    const results = [];
    const rankNotes = [];
    for (const m of members) {
      const pts = addPoints(interaction.guildId, m.id, 'xp', amount);
      const res = await syncRank(m, pts.xp, ranks);
      results.push({ member: m, total: pts.xp });
      if (res.direction === 'up') rankNotes.push(`${m} ranked up to <@&${res.targetRoleId}>`);
      else if (res.direction === 'down') rankNotes.push(`${m} dropped to <@&${res.targetRoleId ?? ''}>`);
    }
    const verb = amount >= 0 ? 'Gave' : 'Removed';
    const embed = baseEmbed(`${verb} ${Math.abs(amount)} XP`)
      .setDescription(`Assigned by ${interaction.user}`)
      .addFields({
        name: 'Recipients',
        value: results.map((r) => `${r.member} → **${r.total} XP**`).join('\n').slice(0, 1024),
      });
    if (rankNotes.length) embed.addFields({ name: 'Rank changes', value: rankNotes.join('\n').slice(0, 1024) });
    if (missFoot) embed.setFooter(missFoot);
    // XP has no dedicated log channel; record it in the EP log channel.
    await sendLog(interaction.guild, cfg.ep_log_channel, { embeds: [embed] });
    return interaction.editReply({ embeds: [embed] });
  }

  // OP
  const results = members.map((m) => {
    const pts = addPoints(interaction.guildId, m.id, 'op', amount);
    return { member: m, total: pts.op };
  });
  const verb = amount >= 0 ? 'Gave' : 'Removed';
  const embed = baseEmbed(`${verb} ${Math.abs(amount)} OP`)
    .setDescription(`Assigned by ${interaction.user}`)
    .addFields({
      name: 'Recipients',
      value: results.map((r) => `${r.member} → **${r.total} OP**`).join('\n').slice(0, 1024),
    });
  if (missFoot) embed.setFooter(missFoot);

  await sendLog(interaction.guild, cfg.op_log_channel, { embeds: [embed] });
  return interaction.editReply({ embeds: [embed] });
}

// ======================= /reset =======================

export async function handleReset(interaction) {
  const embed = baseEmbed('♻️ Reset Points').setDescription(
    'Choose what to reset. This sets the selected balance(s) to **0** for everyone and logs a ' +
      'snapshot of what people had. This cannot be undone.',
  );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('reset:ep').setLabel('Reset EP').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('reset:op').setLabel('Reset OP').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('reset:both').setLabel('Reset Both').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('reset:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
  await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
}

export async function handleResetComponent(interaction) {
  const which = interaction.customId.split(':')[1]; // ep | op | both | cancel
  if (which === 'cancel') {
    return interaction.update({ content: 'Cancelled — nothing was reset.', embeds: [], components: [] });
  }

  await interaction.update({ content: '⏳ Resetting…', embeds: [], components: [] });

  const guildId = interaction.guildId;
  const cfg = getConfig(guildId);
  const snapshot = getAllPoints(guildId); // before reset

  const doEp = which === 'ep' || which === 'both';
  const doOp = which === 'op' || which === 'both';

  // Build the "who had what" snapshot text.
  const epLines = snapshot
    .filter((p) => p.ep !== 0)
    .sort((a, b) => b.ep - a.ep)
    .map((p) => `${p.userId}: ${p.ep} EP`);
  const opLines = snapshot
    .filter((p) => p.op !== 0)
    .sort((a, b) => b.op - a.op)
    .map((p) => `${p.userId}: ${p.op} OP`);

  if (doEp) resetField(guildId, 'ep');
  if (doOp) resetField(guildId, 'op');

  const label = which === 'both' ? 'EP and OP' : which.toUpperCase();
  const embed = baseEmbed('♻️ Points Reset')
    .setDescription(`**${label}** reset to 0 for everyone by ${interaction.user}.`)
    .addFields(
      doEp ? { name: 'Members with EP before reset', value: String(epLines.length) } : { name: '\u200b', value: '\u200b' },
      doOp ? { name: 'Members with OP before reset', value: String(opLines.length) } : { name: '\u200b', value: '\u200b' },
    );

  // Snapshot file so nothing is lost.
  const fileBody =
    (doEp ? `=== EP before reset ===\n${epLines.join('\n') || '(none)'}\n\n` : '') +
    (doOp ? `=== OP before reset ===\n${opLines.join('\n') || '(none)'}\n` : '');
  const file = new AttachmentBuilder(Buffer.from(fileBody, 'utf8'), { name: 'reset-snapshot.txt' });

  const payload = { embeds: [embed], files: [file] };
  await interaction.followUp({ ...payload, ephemeral: true });

  // Log to the relevant channel(s).
  if (doEp) await sendLog(interaction.guild, cfg.ep_log_channel, payload);
  if (doOp && cfg.op_log_channel !== cfg.ep_log_channel) {
    await sendLog(interaction.guild, cfg.op_log_channel, payload);
  }
}
