import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  RoleSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
} from 'discord.js';
import { getConfig, setConfigField } from './db.js';
import { baseEmbed, deny } from './utils.js';

const roleMention = (id) => (id ? `<@&${id}>` : '`not set`');
const chanMention = (id) => (id ? `<#${id}>` : '`not set`');

// ---------- Page renderers ----------

function mainPage(cfg) {
  const embed = baseEmbed('⚙️ EP / OP System Setup')
    .setDescription(
      'Use the buttons below to configure everything. Changes save instantly.\n' +
        'Run this command again any time to review or edit.',
    )
    .addFields(
      {
        name: 'Rank roles',
        value:
          `Officer: ${roleMention(cfg.officer_role)}\n` +
          `HICOM: ${roleMention(cfg.hicom_role)}\n` +
          `Upper HICOM: ${roleMention(cfg.upper_hicom_role)}\n` +
          `Officer Overseer: ${roleMention(cfg.overseer_role)}`,
        inline: true,
      },
      {
        name: 'Strike roles',
        value:
          `Strike 1: ${roleMention(cfg.strike1_role)}\n` +
          `Strike 2: ${roleMention(cfg.strike2_role)}\n` +
          `Strike 3: ${roleMention(cfg.strike3_role)}\n` +
          `Strike 4: ${roleMention(cfg.strike4_role)}`,
        inline: true,
      },
      {
        name: 'Channels & member role',
        value:
          `EP log: ${chanMention(cfg.ep_log_channel)}\n` +
          `OP log: ${chanMention(cfg.op_log_channel)}\n` +
          `Member role: ${roleMention(cfg.member_role)}`,
        inline: false,
      },
      {
        name: 'Quotas',
        value: `EP quota: \`${cfg.ep_quota}\`  •  OP quota: \`${cfg.op_quota}\``,
        inline: false,
      },
      {
        name: 'Quota exemptions',
        value:
          `Inactivity Notice: ${roleMention(cfg.inactivity_notice_role)}\n` +
          `Permanent Quota Excuse: ${roleMention(cfg.quota_excuse_role)}`,
        inline: false,
      },
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('setup:cat:rank').setLabel('Rank Roles').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('setup:cat:strike').setLabel('Strike Roles').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('setup:cat:channels').setLabel('Channels & Member').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('setup:cat:exempt').setLabel('Exemptions').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('setup:quotas').setLabel('Quotas').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row] };
}

function backRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('setup:main').setLabel('⬅ Back').setStyle(ButtonStyle.Secondary),
  );
}

function roleSelectRow(customId, placeholder) {
  return new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).setMinValues(1).setMaxValues(1),
  );
}

function channelSelectRow(customId, placeholder) {
  return new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .addChannelTypes(ChannelType.GuildText)
      .setMinValues(1)
      .setMaxValues(1),
  );
}

function rankPage(cfg) {
  const embed = baseEmbed('Rank Roles').setDescription(
    `Officer (can assign EP): ${roleMention(cfg.officer_role)}\n` +
      `HICOM (can assign OP): ${roleMention(cfg.hicom_role)}\n` +
      `Upper HICOM (quota checks): ${roleMention(cfg.upper_hicom_role)}\n` +
      `Officer Overseer (OP quota check): ${roleMention(cfg.overseer_role)}`,
  );
  return {
    embeds: [embed],
    components: [
      roleSelectRow('setup:role:officer_role', 'Select the Officer role'),
      roleSelectRow('setup:role:hicom_role', 'Select the HICOM role'),
      roleSelectRow('setup:role:upper_hicom_role', 'Select the Upper HICOM role'),
      roleSelectRow('setup:role:overseer_role', 'Select the Officer Overseer role'),
      backRow(),
    ],
  };
}

function strikePage(cfg) {
  const embed = baseEmbed('Strike Roles').setDescription(
    `Strike 1: ${roleMention(cfg.strike1_role)}\n` +
      `Strike 2: ${roleMention(cfg.strike2_role)}\n` +
      `Strike 3: ${roleMention(cfg.strike3_role)}\n` +
      `Strike 4: ${roleMention(cfg.strike4_role)}\n\n` +
      'OP quota checks use Strike 1 & 2. EP quota checks use all four (then kick).',
  );
  return {
    embeds: [embed],
    components: [
      roleSelectRow('setup:role:strike1_role', 'Select the 1st strike role'),
      roleSelectRow('setup:role:strike2_role', 'Select the 2nd strike role'),
      roleSelectRow('setup:role:strike3_role', 'Select the 3rd strike role'),
      roleSelectRow('setup:role:strike4_role', 'Select the 4th strike role'),
      backRow(),
    ],
  };
}

function channelsPage(cfg) {
  const embed = baseEmbed('Channels & Member Role').setDescription(
    `EP log channel: ${chanMention(cfg.ep_log_channel)}\n` +
      `OP log channel: ${chanMention(cfg.op_log_channel)}\n` +
      `Member role: ${roleMention(cfg.member_role)}\n\n` +
      'The member role (optional) limits who the **EP quota check** targets. ' +
      'If left unset, the EP quota check runs on every non-bot member.',
  );
  return {
    embeds: [embed],
    components: [
      channelSelectRow('setup:chan:ep_log_channel', 'Select the EP log channel'),
      channelSelectRow('setup:chan:op_log_channel', 'Select the OP log channel'),
      roleSelectRow('setup:role:member_role', 'Select the Member role (optional)'),
      backRow(),
    ],
  };
}

function exemptPage(cfg) {
  const embed = baseEmbed('Quota Exemptions').setDescription(
    `Inactivity Notice: ${roleMention(cfg.inactivity_notice_role)}\n` +
      `Permanent Quota Excuse: ${roleMention(cfg.quota_excuse_role)}\n\n` +
      'Members with **either** of these roles are skipped entirely during EP and OP ' +
      'quota checks — no strikes, no kicks. Both are optional.',
  );
  return {
    embeds: [embed],
    components: [
      roleSelectRow('setup:role:inactivity_notice_role', 'Select the Inactivity Notice role'),
      roleSelectRow('setup:role:quota_excuse_role', 'Select the Permanent Quota Excuse role'),
      backRow(),
    ],
  };
}

// ---------- Entry point ----------

export async function setupCommand(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return deny(interaction, 'You need the **Manage Server** permission to run setup.');
  }
  const cfg = getConfig(interaction.guildId);
  await interaction.reply({ ...mainPage(cfg), ephemeral: true });
}

// ---------- Component router ----------

export async function handleSetupComponent(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return deny(interaction, 'You need the **Manage Server** permission to do that.');
  }

  const id = interaction.customId; // e.g. setup:role:officer_role
  const guildId = interaction.guildId;

  // Navigation buttons
  if (id === 'setup:main') return interaction.update(mainPage(getConfig(guildId)));
  if (id === 'setup:cat:rank') return interaction.update(rankPage(getConfig(guildId)));
  if (id === 'setup:cat:strike') return interaction.update(strikePage(getConfig(guildId)));
  if (id === 'setup:cat:channels') return interaction.update(channelsPage(getConfig(guildId)));
  if (id === 'setup:cat:exempt') return interaction.update(exemptPage(getConfig(guildId)));

  // Quotas modal
  if (id === 'setup:quotas') {
    const cfg = getConfig(guildId);
    const modal = new ModalBuilder().setCustomId('setup:modal:quotas').setTitle('Set Quotas');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('ep_quota')
          .setLabel('EP quota (minimum EP members must have)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(cfg.ep_quota ?? 0)),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('op_quota')
          .setLabel('OP quota (minimum OP officers must have)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(cfg.op_quota ?? 0)),
      ),
    );
    return interaction.showModal(modal);
  }

  if (id === 'setup:modal:quotas') {
    const ep = parseInt(interaction.fields.getTextInputValue('ep_quota'), 10);
    const op = parseInt(interaction.fields.getTextInputValue('op_quota'), 10);
    if (Number.isNaN(ep) || Number.isNaN(op)) {
      return interaction.reply({ content: '🚫 Quotas must be whole numbers.', ephemeral: true });
    }
    setConfigField(guildId, 'ep_quota', ep);
    setConfigField(guildId, 'op_quota', op);
    return interaction.reply({
      content: `✅ Quotas saved — EP quota: \`${ep}\`, OP quota: \`${op}\`. Reopen \`/setup\` to keep editing.`,
      ephemeral: true,
    });
  }

  // Role selects: setup:role:<field>
  if (id.startsWith('setup:role:')) {
    const field = id.slice('setup:role:'.length);
    setConfigField(guildId, field, interaction.values[0]);
    const cfg = getConfig(guildId);
    // Re-render the page the field belongs to.
    if (field.startsWith('strike')) return interaction.update(strikePage(cfg));
    if (field === 'member_role') return interaction.update(channelsPage(cfg));
    if (field === 'inactivity_notice_role' || field === 'quota_excuse_role') {
      return interaction.update(exemptPage(cfg));
    }
    return interaction.update(rankPage(cfg));
  }

  // Channel selects: setup:chan:<field>
  if (id.startsWith('setup:chan:')) {
    const field = id.slice('setup:chan:'.length);
    setConfigField(guildId, field, interaction.values[0]);
    return interaction.update(channelsPage(getConfig(guildId)));
  }
}
