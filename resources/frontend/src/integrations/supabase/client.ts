// This file is a MOCK for the Laravel migration.
// Direct Supabase calls should be replaced with API calls via services.

const chainable = () => {
  const chain: any = {
    select: () => chain,
    order: () => chain,
    eq: () => chain,
    neq: () => chain,
    not: () => chain,
    gt: () => chain,
    gte: () => chain,
    lt: () => chain,
    lte: () => chain,
    or: () => chain,
    in: () => chain,
    limit: () => chain,
    single: () => Promise.resolve({ data: null, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (resolve: any) => resolve({ data: [], error: null }),
  };
  // Make chain itself a thenable (Promise-like)
  chain[Symbol.toStringTag] = 'Promise';
  return chain;
};

export const supabase = {
  from: (table: string) => {
    console.warn(`[Mock] supabase.from('${table}') called. Use API services instead.`);
    return {
      select: () => chainable(),
      insert: (data: any) => ({ ...chainable(), select: () => chainable() }),
      update: (data: any) => chainable(),
      delete: () => chainable(),
      upsert: (data: any) => ({ ...chainable(), select: () => chainable() }),
    };
  },
  rpc: () => Promise.resolve({ data: null, error: null }),
  auth: {
    getUser: () => Promise.resolve({ data: { user: null }, error: null }),
    onAuthStateChange: (_callback: any) => ({ data: { subscription: { unsubscribe: () => {} } } }),
    getSession: () => Promise.resolve({ data: { session: null }, error: null }),
    signInWithPassword: () => Promise.resolve({ data: {}, error: { message: "Use api.login instead" } }),
    signOut: () => Promise.resolve({ error: null }),
    resetPasswordForEmail: (_email: string, _options?: any) => Promise.resolve({ data: {}, error: null }),
    updateUser: (_updates: any) => Promise.resolve({ data: {}, error: null }),
  },
  storage: {
    from: (_bucket: string) => ({
      upload: (_path: string, _file: any) => Promise.resolve({ data: { path: 'mock-path' }, error: null }),
      getPublicUrl: (path: string) => ({ data: { publicUrl: `/storage/${path}` } }),
      remove: (_paths: string[]) => Promise.resolve({ data: [], error: null }),
    })
  }
};