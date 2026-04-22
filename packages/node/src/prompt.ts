// Minimal interactive prompts for the CLI — avoids pulling in inquirer/prompts.
// If stdin is not a TTY, prompt helpers refuse to run and throw a clear error.

import { createInterface } from 'node:readline';

function assertTty(): void {
  if (!process.stdin.isTTY) {
    throw new Error(
      'This command needs an interactive terminal. Run it directly, not via a pipe.',
    );
  }
}

/** Prompts the user for plain text and returns the answer. */
export async function ask(question: string): Promise<string> {
  assertTty();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise<string>((resolve) => {
      rl.question(question, (ans) => resolve(ans));
    });
  } finally {
    rl.close();
  }
}

/** Prompts for a password with no echo. Falls back to echoing if muting fails. */
export async function askPassword(question: string): Promise<string> {
  assertTty();
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  // Mute stdout writes for the readline prompt after the question is printed.
  const out = process.stdout as unknown as { write: (chunk: string) => boolean };
  const originalWrite = out.write.bind(out);
  let muted = false;
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
    if (muted) {
      originalWrite('');
    } else {
      originalWrite(s);
    }
  };

  try {
    return await new Promise<string>((resolve) => {
      rl.question(question, (ans) => {
        originalWrite('\n');
        resolve(ans);
      });
      muted = true;
    });
  } finally {
    rl.close();
  }
}

/** Asks a y/N question; empty answer counts as no. */
export async function confirm(question: string): Promise<boolean> {
  const ans = (await ask(`${question} [y/N] `)).trim().toLowerCase();
  return ans === 'y' || ans === 'yes';
}
