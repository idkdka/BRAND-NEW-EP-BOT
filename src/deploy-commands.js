// Optional: register commands GLOBALLY (takes up to ~1 hour to appear).
// You usually DON'T need this — index.js auto-registers per-guild on startup,
// which is instant. Use this only if you want the commands available everywhere
// without the bot having to be running. Don't use both at once or you'll see
// duplicate commands.
//
//   node src/deploy-commands.js
//
import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { commands } from './commands.js';

const { DISCORD_TOKEN, CLIENT_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('Set DISCORD_TOKEN and CLIENT_ID in your .env first.');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

try {
  console.log('Registering global application commands…');
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log(`Done. Registered ${commands.length} commands globally.`);
} catch (err) {
  console.error(err);
  process.exit(1);
}
