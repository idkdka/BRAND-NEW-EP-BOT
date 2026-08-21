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
import { getConfig, getGroupConfig, setGroupField } from './db.js';
import { baseEmbed, deny, sendLog, isAdmin } from './utils.js';
import { resolveRobloxId, setRank } from './roblox.js';

// Work out the highest rank the caller is allowed to assign.
// Returns { min, max, tier } or null if they have no permission.
function allowedRange(member, gcfg, mainCfg) {
  if (member.id === gcfg.superuser_id) return { min: 1, max: 255, tier: 'Owner' };

  const hicomRole = gcfg.hicom_role || mainCfg.hicom_role;
  const uhRole = gcfg.uh_role || mainCfg.upper_hicom_role;
  const staffRole = gcfg.staff_role;

  let max = 0;
  let tier = null;
  const consider = (roleId, cap, name) => {
    if (roleId && member.roles.cache.has(roleId) && cap > max) {
      max = cap;
      tier = name;
    }
  };
  consider(hicomRole, gcfg.hicom_max, 'HICOM');
  consider(uhRole, gcfg.uh_max, 'UH');
  consider(staffRole, gcfg.staff_max, 'Staff');

  if (max === 0) return null;
  return { min: gcfg.min_rank, max, tier };
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

  await interaction.deferReply({ ephemeral: true });

  // 1) Resolve the Discord user to a Roblox ID via the resolver channel/bot.
  const resolved = await resolveRobloxId(interaction.guild, target.id, gcfg);
  if (resolved.error) return interaction.editReply(`🚫 ${resolved.error}`);

  // 2) Update the rank in the group.
  const result = await setRank(gcfg.group_id, resolved.robloxId, rank);
  if (result.error) return interaction.editReply(`🚫 ${result.error}`);

  const roleLabel = result.roleName ? `**${result.roleName}** (rank ${rank})` : `rank **${rank}**`;

  // 3) Reply to the runner.
  await interaction.editReply(
    `✅ Set ${target} (Roblox ID \`${resolved.robloxId}\`) to ${roleLabel} in group \`${gcfg.group_id}\`.`,
  );

  // 4) Log to both configured channels.
  const logEmbed = baseEmbed('🎖️ Group Rank Updated')
    .setDescription(`${target} was ranked in group \`${gcfg.group_id}\`.`)
    .addFields(
      { name: 'New rank', value: roleLabel, inline: true },
      { name: 'Roblox ID', value: `\`${resolved.robloxId}\``, inline: true },
      { name: 'Ranked by', value: `${interaction.user} (${perm.tier})`, inline: false },
      { name: 'Reason', value: reason.slice(0, 1024) },
    );
  for (const ch of gcfg.log_channels) await sendLog(interaction.guild, ch, { embeds: [logEmbed] });
}

// ======================= /groupapi setup =======================

const rID = (id) => (id ? `<@&${id}>` : '`not set`');
const cID = (id) => (id ? `<#${id}>` : '`not set`');

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
          `Resolver bot: \`${g.resolver_bot_id}\`\n` +
          `Owner (any rank): \`${g.superuser_id}\`\n` +
          `API key: ${keyStatus}`,
        inline: false,
      },
      {
        name: 'Channels',
        value: `Resolver: ${cID(g.resolver_channel)}\nLog 1: ${cID(g.log_channel_1)}\nLog 2: ${cID(g.log_channel_2)}`,
        inline: true,
      },
      {
        name: 'Rank roles & caps',
        value:
          `HICOM ${rID(g.hicom_role)} → 2–${g.hicom_max}\n` +
          `UH ${rID(g.uh_role)} → 2–${g.uh_max}\n` +
          `Staff ${rID(g.staff_role)} → 2–${g.staff_max}`,
        inline: true,
      },
    )
    .setFooter({ text: 'HICOM / UH left unset fall back to your main /setup HICOM & Upper HICOM roles.' });

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
    `HICOM (up to ${g.hicom_max}): ${rID(g.hicom_role)}\n` +
      `UH (up to ${g.uh_max}): ${rID(g.uh_role)}\n` +
      `Staff (up to ${g.staff_max}): ${rID(g.staff_role)}\n\n` +
      'Leave HICOM/UH unset to reuse your main HICOM & Upper HICOM roles.',
  );
  const rs = (id, ph) =>
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder().setCustomId(id).setPlaceholder(ph).setMinValues(1).setMaxValues(1),
    );
  return {
    embeds: [embed],
    components: [
      rs('gapi:role:hicom_role', 'HICOM role'),
      rs('gapi:role:uh_role', 'UH role'),
      rs('gapi:role:staff_role', 'Staff role'),
      backRow(),
    ],
  };
}

function channelsPage(guildId) {
  const g = getGroupConfig(guildId);
  const embed = baseEmbed('Channels').setDescription(
    `Resolver channel: ${cID(g.resolver_channel)}\nLog channel 1: ${cID(g.log_channel_1)}\nLog channel 2: ${cID(g.log_channel_2)}`,
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
      cs('gapi:chan:resolver_channel', 'Resolver channel'),
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
    const modal = new ModalBuilder().setCustomId('gapi:modal:ids').setTitle('Group / bot IDs');
    modal.addComponents(
      textInput('group_id', 'Roblox group ID', g.group_id),
      textInput('resolver_bot_id', 'Resolver bot ID (Discord)', g.resolver_bot_id),
      textInput('superuser_id', 'Owner Discord ID (can assign any rank)', g.superuser_id),
    );
    return interaction.showModal(modal);
  }

  if (id === 'gapi:tiers') {
    const g = getGroupConfig(guildId);
    const modal = new ModalBuilder().setCustomId('gapi:modal:tiers').setTitle('Rank caps (max rank per tier)');
    modal.addComponents(
      textInput('hicom_max', 'HICOM max rank', g.hicom_max),
      textInput('uh_max', 'UH max rank', g.uh_max),
      textInput('staff_max', 'Staff max rank', g.staff_max),
    );
    return interaction.showModal(modal);
  }

  if (id === 'gapi:modal:ids') {
    setGroupField(guildId, 'group_id', interaction.fields.getTextInputValue('group_id').trim());
    setGroupField(guildId, 'resolver_bot_id', interaction.fields.getTextInputValue('resolver_bot_id').trim());
    setGroupField(guildId, 'superuser_id', interaction.fields.getTextInputValue('superuser_id').trim());
    try {
      return await interaction.update(mainPage(guildId));
    } catch {
      return interaction.reply({ ...mainPage(guildId), ephemeral: true });
    }
  }

  if (id === 'gapi:modal:tiers') {
    for (const f of ['hicom_max', 'uh_max', 'staff_max']) {
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
    setGroupField(guildId, field, interaction.values[0]);
    return interaction.update(rolesPage(guildId));
  }

  if (id.startsWith('gapi:chan:')) {
    const field = id.slice('gapi:chan:'.length);
    setGroupField(guildId, field, interaction.values[0]);
    return interaction.update(channelsPage(guildId));
  }
}
