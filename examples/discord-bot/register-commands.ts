// Registers the /dozzze slash command with Discord. Run once on deploy,
// or whenever the schema below changes. Guild-scoped when DISCORD_GUILD_ID
// is set (instant); global otherwise (up to 1h to propagate).

import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const token = requireEnv('DISCORD_TOKEN');
const appId = requireEnv('DISCORD_APP_ID');
const guildId = process.env.DISCORD_GUILD_ID;

const command = new SlashCommandBuilder()
  .setName('dozzze')
  .setDescription('Ask DOZZZE nodes a question, or check coordinator health.')
  .addSubcommand((s) =>
    s
      .setName('ask')
      .setDescription('Forward a prompt to DOZZZE and wait for the answer.')
      .addStringOption((o) =>
        o.setName('prompt').setDescription('What should the node answer?').setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s.setName('health').setDescription('Report coordinator queue stats.'),
  )
  .toJSON();

const rest = new REST({ version: '10' }).setToken(token);
const route = guildId
  ? Routes.applicationGuildCommands(appId, guildId)
  : Routes.applicationCommands(appId);

await rest.put(route, { body: [command] });
// eslint-disable-next-line no-console
console.log(`registered /dozzze on ${guildId ? `guild ${guildId}` : 'global scope'}`);

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    // eslint-disable-next-line no-console
    console.error(`missing env: ${name}. See .env.example.`);
    process.exit(1);
  }
  return v;
}
