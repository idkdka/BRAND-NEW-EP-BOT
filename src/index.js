import 'dotenv/config';
import http from 'node:http';
import { Client, GatewayIntentBits, Events, Partials } from 'discord.js';
import { commands } from './commands.js';
import { getConfig } from './db.js';
import { hasRole, isAdmin } from './utils.js';
import { setupCommand, handleSetupComponent } from './setup.js';
import { handleEpqcComponent } from './quota.js';
import {
  handleEp,
  handleOp,
  handleXp,
  handleAssign,
  handleReset,
  handleResetComponent,
  applyEpAndLog,
} from './handlers.js';
import { ranksCommand, handleRanksComponent } from './ranks.js';
import { grouprankCommand, groupapiCommand, handleGroupApiComponent } from './grouprank.js';

const PREFIX = '-';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // privileged — for member fetch / quota checks
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // privileged — for the -logep prefix command
  ],
  partials: [Partials.Message, Partials.Channel],
});

// ---------- Command registration (per-guild = instant) ----------

async function registerForGuild(guild) {
  try {
    await guild.commands.set(commands);
    console.log(`Registered ${commands.length} commands in "${guild.name}".`);
  } catch (e) {
    console.error(`Failed to register commands in ${guild.id}:`, e.message);
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  for (const [, guild] of c.guilds.cache) await registerForGuild(guild);
});

client.on(Events.GuildCreate, (guild) => registerForGuild(guild));

// ---------- Interaction routing ----------

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      switch (interaction.commandName) {
        case 'setup':
          return setupCommand(interaction);
        case 'ep':
          return handleEp(interaction);
        case 'op':
          return handleOp(interaction);
        case 'xp':
          return handleXp(interaction);
        case 'assign':
          return handleAssign(interaction);
        case 'ranks':
          return ranksCommand(interaction);
        case 'grouprank':
          return grouprankCommand(interaction);
        case 'groupapi':
          return groupapiCommand(interaction);
        case 'reset':
          return handleReset(interaction);
      }
      return;
    }

    // Components & modals routed by customId prefix.
    if (interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit()) {
      const id = interaction.customId;
      if (id.startsWith('setup:')) return handleSetupComponent(interaction);
      if (id.startsWith('reset:')) return handleResetComponent(interaction);
      if (id.startsWith('epqc:')) return handleEpqcComponent(interaction);
      if (id.startsWith('ranks:')) return handleRanksComponent(interaction);
      if (id.startsWith('gapi:')) return handleGroupApiComponent(interaction);
    }
  } catch (err) {
    console.error('Interaction error:', err);
    const msg = { content: '⚠️ Something went wrong while processing that.', ephemeral: true };
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(msg);
      else if (interaction.isRepliable()) await interaction.reply(msg);
    } catch {
      /* ignore */
    }
  }
});

// ---------- Prefix command: -logep ----------

// Delete a message, ignoring "missing permission" / "already deleted" errors.
const safeDelete = (msg) => (msg ? msg.delete().catch(() => {}) : Promise.resolve());

// Delete several messages in sequence (used to clear the -logep back-and-forth).
async function cleanup(messages) {
  for (const m of messages) await safeDelete(m);
}

// Post a short message that removes itself after a few seconds, so error/cancel
// feedback doesn't linger in the channel.
async function sendTemp(channel, content, ms = 6000) {
  try {
    const m = await channel.send(content);
    setTimeout(() => safeDelete(m), ms);
  } catch {
    /* ignore */
  }
}

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot || !message.guild) return;
    if (!message.content.startsWith(PREFIX)) return;

    const [cmd] = message.content.slice(PREFIX.length).trim().split(/\s+/);
    if (cmd.toLowerCase() !== 'logep') return;

    const cfg = getConfig(message.guild.id);

    // Same permission as /assign ep: Officer role (or admin).
    if (!hasRole(message.member, cfg.officer_role) && !isAdmin(message.member)) {
      return message.reply('🚫 Only members with the **Officer** role can give EP.');
    }

    if (!message.reference?.messageId) {
      return message.reply(
        'Reply to a message that mentions the member(s) you want to give EP to, then run `-logep`.',
      );
    }

    let replied;
    try {
      replied = await message.channel.messages.fetch(message.reference.messageId);
    } catch {
      return message.reply('I couldn’t fetch the message you replied to.');
    }

    const targets = [...replied.mentions.members.filter((m) => !m.user.bot).values()];
    if (!targets.length) {
      return message.reply('That message doesn’t mention any members.');
    }

    // Prompt for the amount and keep a reference so we can delete it later.
    const prompt = await message.reply(
      `How much EP would you like to give to **${targets.length}** member(s)? ` +
        'Reply with a number (negative to remove), or type `cancel`.',
    );

    const collected = await message.channel
      .awaitMessages({
        filter: (m) => m.author.id === message.author.id,
        max: 1,
        time: 60_000,
        errors: ['time'],
      })
      .catch(() => null);

    if (!collected) {
      await cleanup([message, prompt]); // tidy up; no check added on timeout
      return sendTemp(message.channel, '⏳ Timed out — no EP was given.');
    }

    const amountReply = collected.first();
    const text = amountReply.content.trim().toLowerCase();

    if (text === 'cancel') {
      await cleanup([message, prompt, amountReply]);
      return sendTemp(message.channel, 'Cancelled — nothing was given.');
    }

    const amount = parseInt(text, 10);
    if (Number.isNaN(amount) || amount === 0) {
      await cleanup([message, prompt, amountReply]);
      return sendTemp(message.channel, 'That isn’t a valid amount — nothing was given.');
    }

    // Apply the EP and log it to the EP log channel (this is the permanent record).
    await applyEpAndLog(message.guild, targets, amount, message.author);

    // Add a ✅ to the event-log message to mark it as handled, then delete the
    // command back-and-forth. IMPORTANT: `replied` (the event log message that was
    // reacted to) is never included in the cleanup, so it is never deleted.
    await replied.react('✅').catch(() => {});
    await cleanup([message, prompt, amountReply]);
  } catch (err) {
    console.error('Prefix command error:', err);
  }
});

// ---------- Boot ----------

if (!process.env.DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN in environment. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

// Tiny health server so hosts like Railway/Render detect an open port and can
// run a health check. The bot itself doesn't need HTTP — this just keeps the
// platform happy and gives you a URL that reports whether the bot is connected.
const port = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(client.isReady() ? 200 : 503, { 'Content-Type': 'text/plain' });
    res.end(client.isReady() ? 'Bot online' : 'Bot connecting…');
  })
  .listen(port, () => console.log(`Health server listening on :${port}`));

// Don't let an unexpected error take the whole process down silently.
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

client.login(process.env.DISCORD_TOKEN);
