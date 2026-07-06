import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/** Write a transcript JSONL from an array of entry objects, return its path. */
export function writeTranscript(entries: object[]): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-test-'));
  const file = path.join(tmp, 'session.jsonl');
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  return file;
}

/** Make an assistant entry with usage + timestamp. */
export function assistantEntry(opts: {
  timestamp: string;
  input?: number;
  output?: number;
  cacheCreation?: number;
  cacheRead?: number;
}): object {
  return {
    type: 'assistant',
    timestamp: opts.timestamp,
    message: {
      usage: {
        input_tokens: opts.input ?? 0,
        output_tokens: opts.output ?? 0,
        cache_creation_input_tokens: opts.cacheCreation ?? 0,
        cache_read_input_tokens: opts.cacheRead ?? 0,
      },
    },
  };
}
