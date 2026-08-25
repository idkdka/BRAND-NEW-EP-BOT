import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
} from 'discord.js';
import { getConfig, getGroupConfig, setGroupField, getVerification } from './db.js';
import { baseEmbed, deny, sendLog, isAdmin, hasRole, hasAnyRole } from './utils.js';
import {
  setRank,
  getUserInfo,
  acceptJoinRequest,
  kickFromGroup,
  unkickFromGroup,
  listKickedFromGroup,
} from './roblox.js';

// Display names for the 4 group-permission tiers. Storage uses stable
// tier1..tier4 keys (see GROUP_DEFAULTS in db.js) specifically so a future
// rename is just a one-line edit here, not another data migration.
const TIER_LABELS = {
  tier1: 'Group Rank Permissions', // was "HICOM"
  tier2: 'Company Commander', // was "UH"
  tier3: 'HICOM', // was "Staff"
  tier4: 'Overseer', // new
};

// Work out the highest rank the caller is allowed to assign.
// Returns { min, max, tier } or null if they have no permission.
function allowedRange(member, gcfg, mainCfg) {
  if (member.id === gcfg.superuser_id) return { min: 1, max: 255, tier: 'Owner' };

  const tier1Role = gcfg.tier1_role || mainCfg.hicom_role;
  const tier2Role = gcfg.tier2_role || mainCfg.upper_hicom_role;
  const tier4Role = gcfg.tier4_role || mainCfg.overseer_role;

  let max = 0;
  let tier = null;
  const consider = (has, cap, name) => {
    if (has && cap > max) {
      max = cap;
      tier = name;
    }
  };
  consider(hasRole(member, tier1Role), gcfg.tier1_max, TIER_LABELS.tier1);
  consider(hasRole(member, tier2Role), gcfg.tier2_max, TIER_LABELS.tier2);
  consider(hasAnyRole(member, gcfg.tier3_roles), gcfg.tier3_max, TIER_LABELS.tier3);
  consider(hasRole(member, tier4Role), gcfg.tier4_max, TIER_LABELS.tier4);

  if (max === 0) return null;
  return { min: gcfg.min_rank, max, tier };
}

// The Company Commander role for group actions falls back to the main /setup
// Upper HICOM role.
function isCompanyCommander(member, gcfg, mainCfg) {
  const role = gcfg.tier2_role || mainCfg.upper_hicom_role;
  return member.id === gcfg.superuser_id || hasRole(member, role) || isAdmin(member);
}

// The (renamed) HICOM tier — up to 2 roles, no fallback (this is the old Staff tier).
function isHicomTier(member, gcfg) {
  return member.id === gcfg.superuser_id || hasAnyRole(member, gcfg.tier3_roles) || isAdmin(member);
}

// Look up a Discord member's verified Roblox link. Returns { id, name } or
// { error } — used by /groupaccept, /groupkick, and /groupunkick so they take
// a Discord user like the rest of the bot, resolving Roblox via /verify's
// stored link instead of asking for a raw Roblox username.
function resolveVerified(guildId, target) {
  const link = getVerification(guildId, target.id);
  if (!link) {
    return {
      error: `${target} isn’t verified yet. They need to run \`/verify\` (or be manually verified) first.`,
    };
  }
  return { id: link.robloxId, name: link.robloxName };
}

// ======================= /grouprank =======================

export async function grouprankCommand(interaction) {
  const gcfg = getGroupConfig(interaction.guildId);
  const mainCfg = getConfig(interaction.guildId);

  const target = interaction.options.getUser('user');
  const rank = interaction.options.getInteger('rank');
  const reason = interaction.options.getString('reason');

  // Can't rank yourself.
  if (target.id === interaction.user.id) {
    return deny(interaction, 'You can’t rank yourself.');
  }

  // Permission tier.
  const perm = allowedRange(interaction.member, gcfg, mainCfg);
  if (!perm) {
    return deny(interaction, 'You don’t have a role that can rank people in the group.');
  }
  if (rank < perm.min || rank > perm.max) {
    return deny(
      interaction,
      `As **${perm.tier}** you can only assign ranks **${perm.min}–${perm.max}**. Rank ${rank} is outside that.`,
    );
  }

  await interaction.deferReply();

  // 1) Look up the target's verified Roblox ID (stored internally).
  const link = getVerification(interaction.guildId, target.id);
  if (!link) {
    return interaction.editReply(
      `🚫 ${target} isn’t verified yet. They need to run \`/verify\` (or be manually verified) first.`,
    );
  }
  const robloxId = link.robloxId;

  // 2) Update the rank in the group.
  const result = await setRank(gcfg.group_id, robloxId, rank);
  if (result.error) return interaction.editReply(`🚫 ${result.error}`);

  const roleLabel = result.roleName ? `**${result.roleName}** (rank ${rank})` : `rank **${rank}**`;

  // 3) Reply to the runner.
  await interaction.editReply(
    `✅ Set ${target} (Roblox ID \`${robloxId}\`) to ${roleLabel} in group \`${gcfg.group_id}\`.`,
  );

  // 4) Log to both configured channels.
  const logEmbed = baseEmbed('🎖️ Group Rank Updated')
    .setDescription(`${target} was ranked in group \`${gcfg.group_id}\`.`)
    .addFields(
      { name: 'New rank', value: roleLabel, inline: true },
      { name: 'Roblox ID', value: `\`${robloxId}\``, inline: true },
      { name: 'Ranked by', value: `${interaction.user} (${perm.tier})`, inline: false },
      { name: 'Reason', value: reason.slice(0, 1024) },
    );
  for (const ch of gcfg.log_channels) await sendLog(interaction.guild, ch, { embeds: [logEmbed] });
}

// ======================= /groupaccept (UH only) =======================

export async function groupAcceptCommand(interaction) {
  const gcfg = getGroupConfig(interaction.guildId);
  const mainCfg = getConfig(interaction.guildId);

  if (!isCompanyCommander(interaction.member, gcfg, mainCfg)) {
    return deny(interaction, `Only **${TIER_LABELS.tier2}** can accept people into the group.`);
  }

  const target = interaction.options.getUser('user');
  await interaction.deferReply();

  const info = resolveVerified(interaction.guildId, target);
  if (info.error) return interaction.editReply(`🚫 ${info.error}`);
  const label = info.name ? `**${info.name}**` : 'their Roblox account';

  const result = await acceptJoinRequest(gcfg.group_id, info.id);
  if (result.error) return interaction.editReply(`🚫 ${result.error}`);

  await interaction.editReply(
    `✅ Accepted ${target} (${label}, ID \`${info.id}\`) into group \`${gcfg.group_id}\`.`,
  );

  const logEmbed = baseEmbed('✅ Group Join Request Accepted')
    .setDescription(`${target} (${label}) was accepted into group \`${gcfg.group_id}\`.`)
    .addFields(
      { name: 'Roblox ID', value: `\`${info.id}\``, inline: true },
      { name: 'Accepted by', value: `${interaction.user}`, inline: true },
    );
  for (const ch of gcfg.log_channels) await sendLog(interaction.guild, ch, { embeds: [logEmbed] });
}

// ======================= /groupkick, /groupunkick, /groupkicked (HICOM only) =======================

export async function groupKickCommand(interaction) {
  const gcfg = getGroupConfig(interaction.guildId);

  if (!isHicomTier(interaction.member, gcfg)) {
    return deny(interaction, `Only **${TIER_LABELS.tier3}** can kick people from the group.`);
  }

  const target = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason') || 'No reason given';
  await interaction.deferReply();

  const info = resolveVerified(interaction.guildId, target);
  if (info.error) return interaction.editReply(`🚫 ${info.error}`);
  const label = info.name ? `**${info.name}**` : 'their Roblox account';

  const result = await kickFromGroup(gcfg.group_id, info.id);
  if (result.error) return interaction.editReply(`🚫 ${result.error}`);

  await interaction.editReply(
    `✅ Kicked ${target} (${label}, ID \`${info.id}\`) from group \`${gcfg.group_id}\`.`,
  );

  const logEmbed = baseEmbed('👢 Member Kicked')
    .setDescription(`${target} (${label}) was kicked from group \`${gcfg.group_id}\`.`)
    .addFields(
      { name: 'Roblox ID', value: `\`${info.id}\``, inline: true },
      { name: 'Kicked by', value: `${interaction.user}`, inline: true },
      { name: 'Reason', value: reason.slice(0, 1024) },
    );
  for (const ch of gcfg.log_channels) await sendLog(interaction.guild, ch, { embeds: [logEmbed] });
}

export async function groupUnkickCommand(interaction) {
  const gcfg = getGroupConfig(interaction.guildId);

  if (!isHicomTier(interaction.member, gcfg)) {
    return deny(interaction, `Only **${TIER_LABELS.tier3}** can un-kick people from the group.`);
  }

  const target = interaction.options.getUser('user');
  await interaction.deferReply();

  const info = resolveVerified(interaction.guildId, target);
  if (info.error) return interaction.editReply(`🚫 ${info.error}`);
  const label = info.name ? `**${info.name}**` : 'their Roblox account';

  const result = await unkickFromGroup(gcfg.group_id, info.id);
  if (result.error) return interaction.editReply(`🚫 ${result.error}`);

  await interaction.editReply(
    `✅ ${target} (${label}, ID \`${info.id}\`) is no longer kicked from group \`${gcfg.group_id}\` — they can rejoin.`,
  );

  const logEmbed = baseEmbed('♻️ Member Un-kicked')
    .setDescription(`${target} (${label}) was un-kicked from group \`${gcfg.group_id}\` and may rejoin.`)
    .addFields(
      { name: 'Roblox ID', value: `\`${info.id}\``, inline: true },
      { name: 'Un-kicked by', value: `${interaction.user}`, inline: true },
    );
  for (const ch of gcfg.log_channels) await sendLog(interaction.guild, ch, { embeds: [logEmbed] });
}

export async function groupKickedCommand(interaction) {
  const gcfg = getGroupConfig(interaction.guildId);

  if (!isHicomTier(interaction.member, gcfg)) {
    return deny(interaction, `Only **${TIER_LABELS.tier3}** can view the kicked list.`);
  }

  await interaction.deferReply({ ephemeral: true });
  const result = await listKickedFromGroup(gcfg.group_id);
  if (result.error) return interaction.editReply(`🚫 ${result.error}`);

  if (!result.ids.length) {
    return interaction.editReply({
      embeds: [baseEmbed('👢 Kicked From Group').setDescription('Nobody is currently kicked from the group.')],
    });
  }

  // Best-effort: resolve usernames for the first 40; anything past that just
  // gets counted, so a huge list doesn't spam dozens of Roblox API calls.
  const shown = result.ids.slice(0, 40);
  const lines = [];
  for (const id of shown) {
    const info = await getUserInfo(id);
    lines.push(info.error ? `\`${id}\`` : `**${info.name}** (\`${id}\`)`);
  }
  let desc = lines.join('\n');
  if (result.ids.length > shown.length) desc += `\n…and ${result.ids.length - shown.length} more.`;
  if (result.truncated) desc += '\n\n⚠️ Roblox returned more pages than I read — the list may be longer than shown.';

  await interaction.editReply({
    embeds: [baseEmbed(`👢 Kicked From Group (${result.ids.length})`).setDescription(desc.slice(0, 4000))],
  });
}

// ======================= /groupapi setup =======================

const rID = (id) => (id ? `<@&${id}>` : '`not set`');
const cID = (id) => (id ? `<#${id}>` : '`not set`');
const rIDs = (ids) => (ids && ids.length ? ids.map((id) => `<@&${id}>`).join(', ') : '`not set`');

function mainPage(guildId) {
  const g = getGroupConfig(guildId);
  const keyStatus = process.env.ROBLOX_API_KEY ? '✅ set (env)' : '❌ missing — set `ROBLOX_API_KEY`';
  const embed = baseEmbed('⚙️ Group Ranking Setup')
    .setDescription('Configure the Roblox group ranking system. Changes save instantly.')
    .addFields(
      {
        name: 'IDs',
        value:
          `Group: \`${g.group_id}\`\n` +
          `Owner (any rank): \`${g.superuser_id}\`\n` +
          `API key: ${keyStatus}`,
        inline: false,
      },
      {
        name: 'Channels',
        value: `Log 1: ${cID(g.log_channel_1)}\nLog 2: ${cID(g.log_channel_2)}`,
        inline: true,
      },
      {
        name: 'Rank roles & caps',
        value:
          `${TIER_LABELS.tier1} ${rID(g.tier1_role)} → 2–${g.tier1_max}\n` +
          `${TIER_LABELS.tier2} ${rID(g.tier2_role)} → 2–${g.tier2_max}\n` +
          `${TIER_LABELS.tier3} ${rIDs(g.tier3_roles)} → 2–${g.tier3_max}\n` +
          `${TIER_LABELS.tier4} ${rID(g.tier4_role)} → 2–${g.tier4_max}`,
        inline: true,
      },
    )
    .setFooter({
      text:
        `${TIER_LABELS.tier1} / ${TIER_LABELS.tier2} / ${TIER_LABELS.tier4} left unset fall back to your ` +
        'main /setup HICOM, Upper HICOM & Officer Overseer roles.',
    });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('gapi:cat:roles').setLabel('Rank Roles').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('gapi:cat:channels').setLabel('Channels').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('gapi:ids').setLabel('IDs').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('gapi:tiers').setLabel('Rank Caps').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

function backRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('gapi:main').setLabel('⬅ Back').setStyle(ButtonStyle.Secondary),
  );
}

function rolesPage(guildId) {
  const g = getGroupConfig(guildId);
  const embed = baseEmbed('Rank Roles').setDescription(
    `${TIER_LABELS.tier1} (up to ${g.tier1_max}): ${rID(g.tier1_role)}\n` +
      `${TIER_LABELS.tier2} (up to ${g.tier2_max}): ${rID(g.tier2_role)}\n` +
      `${TIER_LABELS.tier3} (up to ${g.tier3_max}): ${rIDs(g.tier3_roles)}\n` +
      `${TIER_LABELS.tier4} (up to ${g.tier4_max}): ${rID(g.tier4_role)}\n\n` +
      `Leave ${TIER_LABELS.tier1} / ${TIER_LABELS.tier2} / ${TIER_LABELS.tier4} unset to reuse your main ` +
      `/setup HICOM, Upper HICOM, and Officer Overseer roles. ${TIER_LABELS.tier3} can be up to **2** roles — ` +
      'selecting new ones replaces the old set.',
  );
  const rs = (id, ph) =>
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder().setCustomId(id).setPlaceholder(ph).setMinValues(1).setMaxValues(1),
    );
  return {
    embeds: [embed],
    components: [
      rs('gapi:role:tier1_role', `${TIER_LABELS.tier1} role`),
      rs('gapi:role:tier2_role', `${TIER_LABELS.tier2} role`),
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId('gapi:role:tier3_roles')
          .setPlaceholder(`${TIER_LABELS.tier3} role(s) — pick up to 2`)
          .setMinValues(1)
          .setMaxValues(2),
      ),
      rs('gapi:role:tier4_role', `${TIER_LABELS.tier4} role`),
      backRow(),
    ],
  };
}

function channelsPage(guildId) {
  const g = getGroupConfig(guildId);
  const embed = baseEmbed('Channels').setDescription(
    `Log channel 1: ${cID(g.log_channel_1)}\nLog channel 2: ${cID(g.log_channel_2)}`,
  );
  const cs = (id, ph) =>
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(id)
        .setPlaceholder(ph)
        .addChannelTypes(ChannelType.GuildText)
        .setMinValues(1)
        .setMaxValues(1),
    );
  return {
    embeds: [embed],
    components: [
      cs('gapi:chan:log_channel_1', 'Log channel 1'),
      cs('gapi:chan:log_channel_2', 'Log channel 2'),
      backRow(),
    ],
  };
}

function textInput(id, label, value, required = true) {
  return new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId(id)
      .setLabel(label)
      .setStyle(TextInputStyle.Short)
      .setRequired(required)
      .setValue(value != null ? String(value) : ''),
  );
}

export async function groupapiCommand(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return deny(interaction, 'You need the **Manage Server** permission to configure group ranking.');
  }
  await interaction.reply({ ...mainPage(interaction.guildId), ephemeral: true });
}

export async function handleGroupApiComponent(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return deny(interaction, 'You need the **Manage Server** permission to do that.');
  }
  const id = interaction.customId;
  const guildId = interaction.guildId;

  if (id === 'gapi:main') return interaction.update(mainPage(guildId));
  if (id === 'gapi:cat:roles') return interaction.update(rolesPage(guildId));
  if (id === 'gapi:cat:channels') return interaction.update(channelsPage(guildId));

  if (id === 'gapi:ids') {
    const g = getGroupConfig(guildId);
    const modal = new ModalBuilder().setCustomId('gapi:modal:ids').setTitle('Group / owner IDs');
    modal.addComponents(
      textInput('group_id', 'Roblox group ID', g.group_id),
      textInput('superuser_id', 'Owner Discord ID (can assign any rank)', g.superuser_id),
    );
    return interaction.showModal(modal);
  }

  if (id === 'gapi:tiers') {
    const g = getGroupConfig(guildId);
    const modal = new ModalBuilder().setCustomId('gapi:modal:tiers').setTitle('Rank caps (max rank per tier)');
    modal.addComponents(
      textInput('tier1_max', `${TIER_LABELS.tier1} max rank`, g.tier1_max),
      textInput('tier2_max', `${TIER_LABELS.tier2} max rank`, g.tier2_max),
      textInput('tier3_max', `${TIER_LABELS.tier3} max rank`, g.tier3_max),
      textInput('tier4_max', `${TIER_LABELS.tier4} max rank`, g.tier4_max),
    );
    return interaction.showModal(modal);
  }

  if (id === 'gapi:modal:ids') {
    setGroupField(guildId, 'group_id', interaction.fields.getTextInputValue('group_id').trim());
    setGroupField(guildId, 'superuser_id', interaction.fields.getTextInputValue('superuser_id').trim());
    try {
      return await interaction.update(mainPage(guildId));
    } catch {
      return interaction.reply({ ...mainPage(guildId), ephemeral: true });
    }
  }

  if (id === 'gapi:modal:tiers') {
    for (const f of ['tier1_max', 'tier2_max', 'tier3_max', 'tier4_max']) {
      const n = parseInt(interaction.fields.getTextInputValue(f), 10);
      if (Number.isNaN(n) || n < 1 || n > 255) {
        return interaction.reply({ content: `🚫 ${f} must be a number 1–255.`, ephemeral: true });
      }
      setGroupField(guildId, f, n);
    }
    try {
      return await interaction.update(mainPage(guildId));
    } catch {
      return interaction.reply({ ...mainPage(guildId), ephemeral: true });
    }
  }

  if (id.startsWith('gapi:role:')) {
    const field = id.slice('gapi:role:'.length);
    // tier3_roles is multi-select (up to 2); everything else is single-value.
    setGroupField(guildId, field, field === 'tier3_roles' ? interaction.values : interaction.values[0]);
    return interaction.update(rolesPage(guildId));
  }

  if (id.startsWith('gapi:chan:')) {
    const field = id.slice('gapi:chan:'.length);
    setGroupField(guildId, field, interaction.values[0]);
    return interaction.update(channelsPage(guildId));
  }
}
