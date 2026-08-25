import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { getConfig, getRanks, setRanks } from './db.js';
import { hasRole, isAdmin, baseEmbed, deny } from './utils.js';

// ---------- Rank sync ----------
// Given a member's XP, make sure they hold exactly the highest rank role they
// qualify for, and no other rank roles. Works for rank-ups and rank-downs.
// Returns { changed, direction: 'up'|'down'|'none', targetRoleId }.
export async function syncRank(member, xp, ranks) {
  if (!ranks?.length) return { changed: false, direction: 'none', targetRoleId: null };

  const sorted = [...ranks].sort((a, b) => a.xp - b.xp);
  const roleIds = sorted.map((r) => r.role);

  // Highest rank index the member currently holds (if any).
  let prevIdx = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (member.roles.cache.has(sorted[i].role)) prevIdx = i;
  }

  // Highest rank index they now qualify for.
  let targetIdx = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (xp >= sorted[i].xp) targetIdx = i;
  }
  const targetRoleId = targetIdx >= 0 ? sorted[targetIdx].role : null;

  const toRemove = roleIds.filter((id, i) => i !== targetIdx && member.roles.cache.has(id));
  const needAdd = targetRoleId && !member.roles.cache.has(targetRoleId);

  let changed = false;
  try {
    if (toRemove.length) {
      await member.roles.remove(toRemove, 'Rank sync');
      changed = true;
    }
    if (needAdd) {
      await member.roles.add(targetRoleId, 'Rank sync');
      changed = true;
    }
  } catch (e) {
    console.error(`syncRank failed for ${member.id}:`, e.message);
    return { changed: false, direction: 'none', targetRoleId, error: e.message };
  }

  let direction = 'none';
  if (targetIdx > prevIdx) direction = 'up';
  else if (prevIdx !== -1 && targetIdx < prevIdx) direction = 'down';
  return { changed, direction, targetRoleId };
}

// ---------- Management panel (Upper HICOM only) ----------

function canManage(member, cfg) {
  return hasRole(member, cfg.upper_hicom_role) || isAdmin(member);
}

function mainPage(guildId) {
  const ranks = getRanks(guildId).sort((a, b) => a.xp - b.xp);
  const embed = baseEmbed('🎖️ Rank Management').setDescription(
    ranks.length
      ? ranks.map((r, i) => `**${i + 1}.** <@&${r.role}> — needs **${r.xp} XP**`).join('\n')
      : 'No ranks configured yet. Use **Add Rank** to create the first one (set it to 0 XP so ' +
          'new members get it on join).',
  );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ranks:add').setLabel('Add Rank').setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('ranks:remove')
      .setLabel('Remove Rank')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(ranks.length === 0),
  );
  return { embeds: [embed], components: [row] };
}

function addPage() {
  const embed = baseEmbed('Add a Rank').setDescription(
    'Pick the role for this rank. You’ll then be asked how much XP it requires. ' +
      'Picking a role that’s already a rank will update its XP.',
  );
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId('ranks:pickrole')
          .setPlaceholder('Select the rank role')
          .setMinValues(1)
          .setMaxValues(1),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ranks:back').setLabel('⬅ Cancel').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function removePage(guildId, guild) {
  const ranks = getRanks(guildId).sort((a, b) => a.xp - b.xp);
  const embed = baseEmbed('Remove a Rank').setDescription('Choose the rank role to remove.');
  const options = ranks.slice(0, 25).map((r) => {
    const name = guild.roles.cache.get(r.role)?.name || `Role ${r.role}`;
    return { label: `${name}`.slice(0, 100), description: `${r.xp} XP`, value: r.role };
  });
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('ranks:removesel')
          .setPlaceholder('Select a rank to remove')
          .addOptions(options),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ranks:back').setLabel('⬅ Cancel').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

export async function ranksCommand(interaction) {
  const cfg = getConfig(interaction.guildId);
  if (!canManage(interaction.member, cfg)) {
    return deny(interaction, 'Only **Upper HICOM** can manage ranks.');
  }
  await interaction.reply({ ...mainPage(interaction.guildId), ephemeral: true });
}

export async function handleRanksComponent(interaction) {
  const cfg = getConfig(interaction.guildId);
  if (!canManage(interaction.member, cfg)) {
    return deny(interaction, 'Only **Upper HICOM** can manage ranks.');
  }

  const id = interaction.customId;
  const guildId = interaction.guildId;

  if (id === 'ranks:back') return interaction.update(mainPage(guildId));
  if (id === 'ranks:add') return interaction.update(addPage());
  if (id === 'ranks:remove') return interaction.update(removePage(guildId, interaction.guild));

  // Role chosen -> ask for the XP threshold via a modal that carries the role id.
  if (id === 'ranks:pickrole') {
    const roleId = interaction.values[0];
    const existing = getRanks(guildId).find((r) => r.role === roleId);
    const modal = new ModalBuilder().setCustomId(`ranks:addxp:${roleId}`).setTitle('XP required');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('xp')
          .setLabel('XP required for this rank')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(existing ? String(existing.xp) : ''),
      ),
    );
    return interaction.showModal(modal);
  }

  // Modal submitted -> save the rank.
  if (id.startsWith('ranks:addxp:')) {
    const roleId = id.slice('ranks:addxp:'.length);
    const xp = parseInt(interaction.fields.getTextInputValue('xp'), 10);
    if (Number.isNaN(xp) || xp < 0) {
      return interaction.reply({ content: '🚫 XP must be a whole number of 0 or more.', ephemeral: true });
    }
    const ranks = getRanks(guildId).filter((r) => r.role !== roleId);
    ranks.push({ role: roleId, xp });
    setRanks(guildId, ranks);
    // Modal was opened from a component, so update() refreshes the panel.
    try {
      return await interaction.update(mainPage(guildId));
    } catch {
      return interaction.reply({ ...mainPage(guildId), ephemeral: true });
    }
  }

  // Remove selection.
  if (id === 'ranks:removesel') {
    const roleId = interaction.values[0];
    const ranks = getRanks(guildId).filter((r) => r.role !== roleId);
    setRanks(guildId, ranks);
    return interaction.update(mainPage(guildId));
  }
}
