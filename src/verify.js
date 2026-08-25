import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { getGroupConfig, setVerification } from './db.js';
import { hasRole, isAdmin, baseEmbed, deny, sendLog, syncNickname, nicknameFailureNote } from './utils.js';
import { getUserIdFromUsername, getUserInfo } from './roblox.js';
import { createCard } from './trello.js';
import { getConfig } from './db.js';

// Word list for verification codes (short, unambiguous, safe).
const CODE_WORDS = [
  'apple', 'amber', 'anchor', 'arrow', 'aspen', 'badge', 'bamboo', 'birch', 'bison',
  'bloom', 'bramble', 'branch', 'breeze', 'bronze', 'brook', 'cactus', 'candle', 'canyon',
  'cedar', 'cherry', 'cinder', 'clay', 'clover', 'cobalt', 'comet', 'copper', 'coral',
  'cosmic', 'cotton', 'crane', 'crimson', 'crystal', 'dapper', 'dawn', 'delta', 'dune',
  'ember', 'falcon', 'fern', 'flint', 'forest', 'fox', 'garnet', 'ginger', 'glacier',
  'granite', 'harbor', 'hazel', 'heron', 'indigo', 'iris', 'ivory', 'jade', 'jasper',
  'juniper', 'kite', 'lantern', 'lark', 'lily', 'lotus', 'lunar', 'lynx', 'magnet',
  'mango', 'maple', 'marble', 'meadow', 'meteor', 'mint', 'moss', 'nectar', 'nimbus',
  'oak', 'ocean', 'olive', 'onyx', 'opal', 'orbit', 'otter', 'pebble', 'pepper',
  'pine', 'plum', 'quartz', 'quill', 'raven', 'reef', 'ridge', 'river', 'robin',
  'rowan', 'ruby', 'saffron', 'sage', 'sapphire', 'shadow', 'silver', 'slate', 'solar',
  'spruce', 'stone', 'storm', 'summit', 'sunset', 'tango', 'thistle', 'thorn', 'tiger',
  'topaz', 'valley', 'velvet', 'willow', 'wolf', 'zephyr',
];

// A random code (a few hyphen-joined words) the user must place in their Roblox bio.
function genCode() {
  const words = [];
  for (let i = 0; i < 4; i++) {
    words.push(CODE_WORDS[Math.floor(Math.random() * CODE_WORDS.length)]);
  }
  return words.join('-');
}

function isOwner(interaction) {
  return interaction.user.id === getGroupConfig(interaction.guildId).superuser_id;
}

// After a successful verification: log it to the configured channel and create
// a Trello card for the new Roblox link. Both are best-effort — a failure here
// never blocks verification from succeeding, it's just reported back as a note.
async function postVerificationSideEffects(guild, discordUserId, robloxId, robloxName) {
  const cfg = getConfig(guild.id);
  const notes = [];

  if (cfg.verify_log_channel) {
    const embed = baseEmbed('🔗 New Verification').setDescription(
      `<@${discordUserId}> linked to **${robloxName || 'an unknown Roblox account'}** (ID \`${robloxId}\`).`,
    );
    const posted = await sendLog(guild, cfg.verify_log_channel, { embeds: [embed] });
    if (!posted) notes.push('couldn’t post to the verification log channel (check the channel ID and my permissions there)');
  }

  if (cfg.trello_list_id) {
    const card = await createCard({
      name: robloxName || `Roblox ID ${robloxId}`,
      listId: cfg.trello_list_id,
      labelId: cfg.trello_label_id,
      boardId: cfg.trello_board_id,
    });
    if (card.error) notes.push(`Trello card wasn’t created (${card.error})`);
  }

  return notes;
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

  const notes = [];
  try {
    const member = await interaction.guild.members.fetch(target.id);
    const nickResult = await syncNickname(member, info.name);
    if (!nickResult.ok) notes.push(nicknameFailureNote(nickResult.reason));
  } catch {
    // Not resolvable as a guild member (e.g. left the server) — skip the nickname.
  }
  notes.push(...(await postVerificationSideEffects(interaction.guild, target.id, info.id, info.name)));

  const noteText = notes.length ? '\n' + notes.map((n) => `⚠️ ${n}`).join('\n') : '';
  await interaction.editReply(
    `✅ Manually verified ${target} as **${info.name}** (ID \`${info.id}\`).${noteText}`,
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

    const notes = [];
    const nickResult = await syncNickname(interaction.member, info.name);
    if (!nickResult.ok) notes.push(nicknameFailureNote(nickResult.reason));
    notes.push(...(await postVerificationSideEffects(interaction.guild, interaction.user.id, info.id, info.name)));

    const noteText = notes.length ? '\n' + notes.map((n) => `⚠️ ${n}`).join('\n') : '';
    return interaction.editReply(
      `✅ Verified! You’re linked to **${info.name}** (ID \`${info.id}\`).${noteText}`,
    );
  }
}
