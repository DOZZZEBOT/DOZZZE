// Minimal DOZZZE Discord consumer. On /dozzze ask prompt:<text> — submits a
// job to the coordinator, awaits the result (2 min cap), and edits the
// deferred reply with the LLM output.
//
// Not production-grade: no persistence, no concurrency limit per user,
// no abuse protection beyond what the coordinator enforces.

import { Client, GatewayIntentBits, Events, MessageFlags } from 'discord.js';
import { DozzzeClient, DozzzeClientError } from '@dozzze/client';

const token = requireEnv('DISCORD_TOKEN');
const coordUrl = process.env.DOZZZE_COORD_URL ?? 'http://127.0.0.1:8787';
const apiKey = process.env.DOZZZE_COORD_API_KEY;
const model = process.env.DOZZZE_MODEL ?? 'llama3.2';
const payout = Number.parseFloat(process.env.DOZZZE_PAYOUT ?? '0.01');

const dozzze = new DozzzeClient({
  url: coordUrl,
  ...(apiKey ? { apiKey } : {}),
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.on(Events.ClientReady, (c) => {
  // eslint-disable-next-line no-console
  console.log(`ready — logged in as ${c.user.tag}, talking to ${coordUrl}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'dozzze') return;

  const sub = interaction.options.getSubcommand();
  try {
    if (sub === 'health') {
      const h = await dozzze.health();
      await interaction.reply({
        content: `coordinator OK — pending=${h.pending}, completed=${h.completed}, auth=${h.authRequired ? 'on' : 'off'}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'ask') {
      const prompt = interaction.options.getString('prompt', true);
      await interaction.deferReply();
      const result = await dozzze.submitAndAwait(
        { model, prompt, payout },
        { timeoutMs: 120_000, pollMs: 1_500 },
      );
      const preview = result.output.slice(0, 1_900);
      const footer =
        `\n\n*node ${result.nodeId}, tokens ${result.tokensIn}+${result.tokensOut}, ` +
        `${result.durationMs}ms` +
        (result.settlementTx ? `, tx \`${result.settlementTx.slice(0, 12)}…\`` : '') +
        '*';
      await interaction.editReply(preview + footer);
      return;
    }
  } catch (err) {
    const msg =
      err instanceof DozzzeClientError
        ? `coordinator error ${err.status}: ${err.message}`
        : `unexpected error: ${err instanceof Error ? err.message : String(err)}`;
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(msg);
      } else {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
    } catch {
      /* swallow secondary discord errors */
    }
  }
});

await client.login(token);

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    // eslint-disable-next-line no-console
    console.error(`missing env: ${name}. See .env.example.`);
    process.exit(1);
  }
  return v;
}
