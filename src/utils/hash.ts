import { createHash } from 'node:crypto';

export function shortHash(input: string, length = 12): string {
  return createHash('sha256').update(input).digest('hex').slice(0, length);
}
