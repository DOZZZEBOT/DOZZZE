# DOZZZE Discord bot (example)

A minimal Discord consumer built on `@dozzze/client`. Exposes a single
`/dozzze` slash command with two subcommands:

- `/dozzze ask prompt:<text>` — forwards the prompt to the coordinator,
  waits for the result, replies.
- `/dozzze health` — reports coordinator queue stats.

**This is example code.** Copy it, tweak it, deploy it yourself.
DOZZZE does not run a central bot — the whole point is that anyone can.

## Setup

1. Create a new Discord application at <https://discord.com/developers/applications>
2. In the "Bot" tab, reset the token and keep it handy.
3. In the "OAuth2 → URL Generator" tab, check `applications.commands` and
   `bot`; in bot permissions, `Send Messages` is enough. Invite the bot
   to a server you own.
4. Copy `.env.example` to `.env` and fill in:

   ```
   DISCORD_TOKEN=...
   DISCORD_APP_ID=...
   DISCORD_GUILD_ID=...           # optional, for dev; registers commands instantly
   DOZZZE_COORD_URL=http://127.0.0.1:8787
   DOZZZE_COORD_API_KEY=...        # only if your coordinator has auth enabled
   ```

5. `npm install && npm run register && npm start`

## Files

- `register-commands.ts` — posts the slash command schema to Discord.
  Run once on deploy, or whenever you change command shapes.
- `bot.ts` — the long-lived bot. On every `/dozzze ask`, it defers the
  reply, submits a job, polls for a result (max 2 minutes), and edits
  the reply with the LLM's output.

## Notes

- Use `DISCORD_GUILD_ID` for dev — guild-scoped commands register
  instantly. Global commands take up to an hour to propagate.
- The bot does not persist anything. If the process restarts while a
  job is in-flight, the user sees a generic timeout error.
- Abuse protection is the coordinator's job: set
  `DOZZZE_COORD_API_KEYS` on the coord, then each bot instance gets a
  unique key with its own rate limit.
