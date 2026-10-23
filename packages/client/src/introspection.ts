import { createHash } from 'node:crypto';

import type { MaybePromise } from '@entwico/dash';

const INTROSPECT_QUERY = `query ContelloIntrospectToken($token: String!) {
  contelloIntrospectToken(token: $token) {
    active audience expiresAt user { id username firstName lastName email } permissions { resourceType scope actions }
  }
}`;

export type ResourceAction = 'READ' | 'CREATE' | 'UPDATE' | 'DELETE';

// the actions the user may take on one resource of the project: the type with what identifies the
// resource (an entity model id, an i18n message collection id, an extension id, a route path
// pattern), no scope for the types without one
export type ResourcePermissions = {
  resourceType: 'ENTITY' | 'ASSET' | 'ROUTE' | 'I18N_MESSAGE_COLLECTION' | 'MODELLING' | 'EXTENSION' | (string & {});
  scope: string | null;
  actions: ResourceAction[];
};

export type IntrospectedUser = {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
};

// what a temporary token stands for in the project of the client; an inactive answer carries
// nothing else
export type TokenIntrospection =
  | { active: false }
  | {
    active: true;
    // who the token was minted for: the origin of the extension
    audience: string;
    expiresAt: Date;
    user: IntrospectedUser;
    permissions: ResourcePermissions[];
  };

type IntrospectionResult = {
  contelloIntrospectToken: {
    active: boolean;
    audience: string | null;
    expiresAt: string | null;
    user: IntrospectedUser | null;
    permissions: ResourcePermissions[] | null;
  };
};

export async function introspectToken(
  execute: <T>(query: string, variables: Record<string, unknown>) => Promise<T>,
  token: string,
): Promise<TokenIntrospection> {
  const { contelloIntrospectToken: result } = await execute<IntrospectionResult>(INTROSPECT_QUERY, { token });

  if (!result.active || !result.audience || !result.expiresAt || !result.user) {
    return { active: false };
  }

  return {
    active: true,
    audience: result.audience,
    expiresAt: new Date(result.expiresAt),
    user: result.user,
    permissions: result.permissions ?? [],
  };
}

export type TokenIntrospectorOptions = {
  // the audiences this backend serves, the origins of its extension pages: a token minted for any
  // other audience is inactive here
  audiences: string[];
  // how long an answer is reused before core is asked again, so a disabled user or an expired
  // token takes effect within this time; default one minute
  maxAgeMs?: number | undefined;
  // how many answers are kept at most; default 10000
  maxEntries?: number | undefined;
};

export type TokenIntrospector = {
  // a cached answer comes back synchronously
  introspect: (token: string) => MaybePromise<TokenIntrospection>;
};

const DEFAULT_MAX_AGE_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 10_000;

type CacheEntry = { result: TokenIntrospection; until: number };

// the introspection a backend runs on every request of an extension page: the answer of core is
// kept until its expiry or maxAgeMs, whichever comes first, keyed by a hash of the token
export function createTokenIntrospector(
  introspect: (token: string) => Promise<TokenIntrospection>,
  options: TokenIntrospectorOptions,
): TokenIntrospector {
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const audiences = new Set(options.audiences);
  const cache = new Map<string, CacheEntry>();
  const pending = new Map<string, Promise<TokenIntrospection>>();

  // entries expire within maxAgeMs of their insertion, so insertion order is close to expiry order
  // and the oldest entries are the ones to drop when the expired ones are not enough
  const evict = (now: number) => {
    for (const [key, entry] of cache) {
      if (entry.until <= now) {
        cache.delete(key);
      }
    }

    for (const key of cache.keys()) {
      if (cache.size < maxEntries) {
        break;
      }

      cache.delete(key);
    }
  };

  const lookup = async (token: string, key: string): Promise<TokenIntrospection> => {
    try {
      let result = await introspect(token);

      if (result.active && !audiences.has(result.audience)) {
        result = { active: false };
      }

      const now = Date.now();
      const until = result.active ? Math.min(result.expiresAt.getTime(), now + maxAgeMs) : now + maxAgeMs;

      if (cache.size >= maxEntries) {
        evict(now);
      }

      cache.set(key, { result, until });

      return result;
    } finally {
      pending.delete(key);
    }
  };

  return {
    introspect: (token) => {
      const key = createHash('sha256').update(token).digest('base64url');
      const cached = cache.get(key);

      if (cached && cached.until > Date.now()) {
        return cached.result;
      }

      let running = pending.get(key);

      if (!running) {
        running = lookup(token, key);
        pending.set(key, running);
      }

      return running;
    },
  };
}
