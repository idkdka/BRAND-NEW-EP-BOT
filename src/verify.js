import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { getGroupConfig, setVerification } from './db.js';
import { hasRole, isAdmin, baseEmbed, deny } from './utils.js';
import { getUserIdFromUsername, getUserInfo } from './roblox.js';
import { getConfig } from './db.js';

// A random numeric code the user must place in their Roblox bio.
function genCode() {
  let s = '';
  for (let i = 0; i < 8; i++) s += Math.floor(Math.random() * 10);
  return s;
}

function isOwner(interaction) {
  return interaction.user.id === getGroupConfig(interaction.guildId).superuser_id;
}

// ---------- Shared: resolve a username and show the code + confirm button ----------

async function startVerification(interaction, username) {
  await interaction.deferReply({ ephemeral: true });

  const found = await getUserIdFromUsername(username);
  if (found.error) return interaction.editReply(`🚫 ${found.error}`);

  const code = genCode();
  const embed = baseEmbed('🔗 Roblox Verification')
    .setDescription(
      `You’re verifying as **${found.name}** (ID \`${found.id}\`).\n\n` +
        `**1.** Copy this code:\n\`\`\`\n${code}\n\`\`\`\n` +
        '**2.** Paste it anywhere in your Roblox profile **About/Description**, and save.\n' +
        '**3.** Click **I’ve added it** below.',
    )
    .setFooter({ text: 'Not the right account? Run the command again with the correct username.' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`verify:confirm:${found.id}:${code}`)
      .setLabel('I’ve added it')
      .setStyle(ButtonStyle.Success),
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ---------- /verifypanel (UH only) ----------

export async function verifyPanelCommand(interaction) {
  const cfg = getConfig(interaction.guildId);
  if (!hasRole(interaction.member, cfg.upper_hicom_role) && !isAdmin(interaction.member)) {
    return deny(interaction, 'Only **Upper HICOM** can post the verification panel.');
  }

  const embed = baseEmbed('✅ Verify with Roblox').setDescription(
    'Click the button below to link your Roblox account. You’ll enter your Roblox ' +
      'username, add a short code to your profile bio, and confirm — that’s it.',
  );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('verify:start').setLabel('Verify').setStyle(ButtonStyle.Success),
  );

  await interaction.channel.send({ embeds: [embed], components: [row] });
  await interaction.reply({ content: '✅ Verification panel posted.', ephemeral: true });
}

// ---------- /verify (anyone) ----------

export async function verifyCommand(interaction) {
  const username = interaction.options.getString('username');
  return startVerification(interaction, username);
}

// ---------- /forceverify (owner only) ----------

export async function forceVerifyCommand(interaction) {
  if (!isOwner(interaction)) {
    return deny(interaction, 'Only the bot owner can manually verify people.');
  }
  const target = interaction.options.getUser('user');
  const robloxInput = interaction.options.getString('roblox').trim();

  await interaction.deferReply({ ephemeral: true });

  let info;
  if (/^\d+$/.test(robloxInput)) {
    // Looks like a Roblox user ID.
    info = await getUserInfo(robloxInput);
  } else {
    // Treat as a username.
    const found = await getUserIdFromUsername(robloxInput);
    if (found.error) return interaction.editReply(`🚫 ${found.error}`);
    info = await getUserInfo(found.id);
  }
  if (info.error) return interaction.editReply(`🚫 ${info.error}`);

  setVerification(interaction.guildId, target.id, info.id, info.name);
  await interaction.editReply(
    `✅ Manually verified ${target} as **${info.name}** (ID \`${info.id}\`).`,
  );
}

// ---------- Component handler (verify:*) ----------

export async function handleVerifyComponent(interaction) {
  const id = interaction.customId;

  // Panel button -> username modal.
  if (id === 'verify:start') {
    const modal = new ModalBuilder().setCustomId('verify:username').setTitle('Roblox Verification');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('username')
          .setLabel('Your Roblox username')
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
    );
    return interaction.showModal(modal);
  }

  // Username modal submitted.
  if (id === 'verify:username') {
    return startVerification(interaction, interaction.fields.getTextInputValue('username').trim());
  }

  // Confirm button: verify:confirm:<robloxId>:<code>
  if (id.startsWith('verify:confirm:')) {
    const [, , robloxId, code] = id.split(':');
    await interaction.deferReply({ ephemeral: true });

    const info = await getUserInfo(robloxId);
    if (info.error) return interaction.editReply(`🚫 ${info.error}`);

    if (!info.description.includes(code)) {
      return interaction.editReply(
        '🚫 I couldn’t find the code in your Roblox bio yet. Make sure you saved your ' +
          'profile, wait a moment, then click **I’ve added it** again.',
      );
    }

    setVerification(interaction.guildId, interaction.user.id, info.id, info.name);
    // Best-effort: disable the button on the original message.
    interaction.message?.edit({ components: [] }).catch(() => {});
    return interaction.editReply(`✅ Verified! You’re linked to **${info.name}** (ID \`${info.id}\`).`);
  }
}
