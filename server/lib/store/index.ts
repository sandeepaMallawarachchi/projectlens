import { env } from '../env';
import { HttpError } from '../http';
import { MemoryStore } from './memory';
import { SupabaseStore } from './supabase';
import type { Store } from './types';

let instance: Store | null = null;

export function getStore(): Store {
  if (!instance) {
    const e = env();
    if (e.storage === 'supabase') {
      if (!e.supabaseUrl || !e.supabaseServiceKey) {
        throw new HttpError(500, 'server_misconfigured', 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
      }
      instance = new SupabaseStore(e.supabaseUrl, e.supabaseServiceKey);
    } else {
      instance = new MemoryStore();
    }
  }
  return instance;
}

/** Test hook. */
export function setStore(store: Store | null): void {
  instance = store;
}

export type * from './types';
