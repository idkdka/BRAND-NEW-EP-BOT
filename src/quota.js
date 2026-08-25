import { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } from 'discord.js';
import { getConfig, getPoints } from './db.js';
import { hasRole, isAdmin, baseEmbed, deny, sendLog, chunkLines } from './utils.js';

// Highest strike index (0-based) a member currently holds among the given role IDs, or -1.
function highestStrike(member, strikeRoles) {
  for (let i = strikeRoles.length - 1; i >= 0; i--) {
    if (strikeRoles[i] && member.roles.cache.has(strikeRoles[i])) return i;
  }
  return -1;
}

// Members with the Inactivity Notice or Permanent Quota Excuse role are skipped
// entirely during quota checks — no strikes, no kicks.
function isExcused(member, cfg) {
  return (
    (cfg.inactivity_notice_role && member.roles.cache.has(cfg.inactivity_notice_role)) ||
    (cfg.quota_excuse_role && member.roles.cache.has(cfg.quota_excuse_role))
  );
}

const ORD = ['1st', '2nd', '3rd', '4th'];

// ======================= EP QUOTA CHECK =======================

export async function epQuotacheck(interaction) {
  const cfg = getConfig(interaction.guildId);

  if (!hasRole(interaction.member, cfg.upper_hicom_role) && !isAdmin(interaction.member)) {
    return deny(interaction, 'You need the **Upper HICOM** role to run the EP quota check.');
  }

  const missing = [];
  for (const f of ['strike1_role', 'strike2_role', 'strike3_role', 'strike4_role']) {
    if (!cfg[f]) missing.push(f);
  }
  if (!cfg.ep_log_channel) missing.push('ep_log_channel');
  if (missing.length) {
    return deny(interaction, `Setup is incomplete. Missing: ${missing.join(', ')}. Run \`/setup\` first.`);
  }

  // This can kick members, so confirm first.
  const embed = baseEmbed('⚠️ Confirm EP Quota Check').setDescription(
    `Quota is **${cfg.ep_quota} EP**. Members under it get the next strike; members already on ` +
      'the 4th strike will be **kicked**. Members over quota lose their highest strike.\n\n' +
      'Members with the **Inactivity Notice** or **Permanent Quota Excuse** role are skipped.\n\nProceed?',
  );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('epqc:confirm').setLabel('Run EP Quota Check').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('epqc:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
  await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
}

export async function handleEpqcComponent(interaction) {
  const cfg = getConfig(interaction.guildId);
  if (interaction.customId === 'epqc:cancel') {
    return interaction.update({ content: 'Cancelled — nothing changed.', embeds: [], components: [] });
  }
  // confirm
  if (!hasRole(interaction.member, cfg.upper_hicom_role) && !isAdmin(interaction.member)) {
    return deny(interaction, 'You need the **Upper HICOM** role to run the EP quota check.');
  }
  await interaction.update({ content: '⏳ Running EP quota check…', embeds: [], components: [] });
  await runEpCheck(interaction, cfg);
}

async function runEpCheck(interaction, cfg) {
  const guild = interaction.guild;
  const quota = cfg.ep_quota;
  const strikes = [cfg.strike1_role, cfg.strike2_role, cfg.strike3_role, cfg.strike4_role];

  const all = await guild.members.fetch();
  let targets = all.filter((m) => !m.user.bot);
  if (cfg.member_role) targets = targets.filter((m) => m.roles.cache.has(cfg.member_role));

  const lines = [];
  const excused = [];
  let struck = 0,
    kicked = 0,
    removed = 0,
    failed = 0;

  for (const member of targets.values()) {
    if (isExcused(member, cfg)) {
      excused.push(member.user.tag);
      continue;
    }
    const ep = getPoints(guild.id, member.id).ep;

    if (ep < quota) {
      const hi = highestStrike(member, strikes);
      if (hi >= 3) {
        // Already on 4th strike -> kick (with safety guards).
        if (member.id === guild.ownerId) {
          lines.push(`⛔ ${member.user.tag} — at 4th strike but is the server owner; not kicked.`);
          failed++;
          continue;
        }
        if (!member.kickable) {
          lines.push(`⛔ ${member.user.tag} — at 4th strike but I lack permission/hierarchy to kick.`);
          failed++;
          continue;
        }
        try {
          await member.kick(`EP quota check: below ${quota} EP on 4th strike (had ${ep})`);
          lines.push(`👢 KICKED ${member.user.tag} — ${ep} EP, was on 4th strike.`);
          kicked++;
        } catch (e) {
          lines.push(`⛔ ${member.user.tag} — kick failed: ${e.message}`);
          failed++;
        }
      } else {
        const next = hi + 1; // index of strike to add
        try {
          await member.roles.add(strikes[next], `EP quota check: ${ep} EP < ${quota}`);
          lines.push(`➕ ${member.user.tag} — ${ep} EP, given **${ORD[next]} strike**.`);
          struck++;
        } catch (e) {
          lines.push(`⛔ ${member.user.tag} — could not add ${ORD[next]} strike: ${e.message}`);
          failed++;
        }
      }
    } else if (ep > quota) {
      const hi = highestStrike(member, strikes);
      if (hi >= 0) {
        try {
          await member.roles.remove(strikes[hi], `EP quota check: ${ep} EP > ${quota}`);
          lines.push(`➖ ${member.user.tag} — ${ep} EP, removed **${ORD[hi]} strike**.`);
          removed++;
        } catch (e) {
          lines.push(`⛔ ${member.user.tag} — could not remove ${ORD[hi]} strike: ${e.message}`);
          failed++;
        }
      }
    }
    // ep === quota -> no change
  }

  await finishCheck(interaction, {
    title: '📋 EP Quota Check Complete',
    quotaText: `EP quota: ${quota}`,
    counts: `Strikes given: **${struck}** • Kicked: **${kicked}** • Strikes removed: **${removed}** • Failed: **${failed}**`,
    lines,
    excused,
    logChannel: cfg.ep_log_channel,
    runner: interaction.user,
  });
}

// ======================= OP QUOTA CHECK =======================

export async function opQuotacheck(interaction) {
  const cfg = getConfig(interaction.guildId);

  const allowed =
    hasRole(interaction.member, cfg.upper_hicom_role) ||
    hasRole(interaction.member, cfg.overseer_role) ||
    isAdmin(interaction.member);
  if (!allowed) {
    return deny(interaction, 'You need the **Upper HICOM** or **Officer Overseer** role to run the OP quota check.');
  }

  const missing = [];
  if (!cfg.officer_role) missing.push('officer_role');
  if (!cfg.strike1_role) missing.push('strike1_role');
  if (!cfg.strike2_role) missing.push('strike2_role');
  if (!cfg.op_log_channel) missing.push('op_log_channel');
  if (missing.length) {
    return deny(interaction, `Setup is incomplete. Missing: ${missing.join(', ')}. Run \`/setup\` first.`);
  }

  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild;
  const quota = cfg.op_quota;
  const opStrikes = [cfg.strike1_role, cfg.strike2_role];

  const all = await guild.members.fetch();
  const officers = all.filter((m) => !m.user.bot && m.roles.cache.has(cfg.officer_role));

  const lines = [];
  const escalated = []; // officers pushed to 2nd OP strike (runner should be notified)
  const excused = [];
  let struck = 0,
    removed = 0,
    failed = 0;

  for (const member of officers.values()) {
    if (isExcused(member, cfg)) {
      excused.push(member.user.tag);
      continue;
    }
    const op = getPoints(guild.id, member.id).op;

    if (op < quota) {
      const hi = highestStrike(member, opStrikes); // -1, 0, or 1
      if (hi < 0) {
        try {
          await member.roles.add(opStrikes[0], `OP quota check: ${op} OP < ${quota}`);
          lines.push(`➕ ${member.user.tag} — ${op} OP, given **1st strike**.`);
          struck++;
        } catch (e) {
          lines.push(`⛔ ${member.user.tag} — could not add 1st strike: ${e.message}`);
          failed++;
        }
      } else if (hi === 0) {
        try {
          await member.roles.add(opStrikes[1], `OP quota check: ${op} OP < ${quota}, already striked`);
          lines.push(`⏫ ${member.user.tag} — ${op} OP, already had 1st strike → given **2nd strike**.`);
          escalated.push(`${member} (${op} OP)`);
          struck++;
        } catch (e) {
          lines.push(`⛔ ${member.user.tag} — could not add 2nd strike: ${e.message}`);
          failed++;
        }
      } else {
        // Already on 2nd strike (max for OP).
        lines.push(`⚠️ ${member.user.tag} — ${op} OP, already on **2nd strike** (max).`);
        escalated.push(`${member} (${op} OP — already maxed)`);
      }
    } else if (op >= quota + 4) {
      const toRemove = opStrikes.filter((r) => r && member.roles.cache.has(r));
      if (toRemove.length) {
        try {
          await member.roles.remove(toRemove, `OP quota check: ${op} OP ≥ ${quota + 4}`);
          lines.push(`➖ ${member.user.tag} — ${op} OP, cleared OP strike(s).`);
          removed++;
        } catch (e) {
          lines.push(`⛔ ${member.user.tag} — could not remove strike(s): ${e.message}`);
          failed++;
        }
      }
    }
    // between quota and quota+4 -> no change
  }

  await finishCheck(interaction, {
    title: '📋 OP Quota Check Complete',
    quotaText: `OP quota: ${quota} (strikes clear at ${quota + 4}+)`,
    counts: `Strikes given: **${struck}** • Strikes removed: **${removed}** • Failed: **${failed}**`,
    lines,
    excused,
    logChannel: cfg.op_log_channel,
    runner: interaction.user,
    highlight: escalated.length
      ? { name: '⚠️ Escalated to 2nd OP strike', value: escalated.join('\n').slice(0, 1024) }
      : null,
  });
}

// ======================= shared output =======================

async function finishCheck(interaction, opts) {
  const { title, quotaText, counts, lines, excused, logChannel, runner, highlight } = opts;

  const embed = baseEmbed(title)
    .setDescription(`${quotaText}\nRun by ${runner}\n\n${counts}`)
    .setFooter({ text: lines.length ? `${lines.length} action(s) taken` : 'No changes were needed' });

  if (highlight) embed.addFields(highlight);

  if (excused && excused.length) {
    embed.addFields({
      name: `🛡️ Excused — skipped (${excused.length})`,
      value: excused.join(', ').slice(0, 1024),
    });
  }

  // Put detail lines into fields, attaching a file if it overflows.
  let file = null;
  if (lines.length) {
    const chunks = chunkLines(lines);
    if (chunks.length <= 3) {
      chunks.forEach((c, i) => embed.addFields({ name: i === 0 ? 'Details' : '\u200b', value: c }));
    } else {
      embed.addFields({ name: 'Details', value: 'Full list attached as a file (too long to inline).' });
      file = new AttachmentBuilder(Buffer.from(lines.join('\n'), 'utf8'), {
        name: `${title.replace(/[^a-z]/gi, '_').toLowerCase()}.txt`,
      });
    }
  }

  const payload = { embeds: [embed] };
  if (file) payload.files = [file];

  // Reply to the runner.
  if (interaction.deferred || interaction.replied) await interaction.followUp({ ...payload, ephemeral: true });
  else await interaction.reply({ ...payload, ephemeral: true });

  // And log to the channel.
  await sendLog(interaction.guild, logChannel, payload);
}
