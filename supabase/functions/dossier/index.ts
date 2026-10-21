import '@supabase/functions-js/edge-runtime.d.ts';
import { withSupabase } from '@supabase/server';
import { fromByteaHex, toByteaHex } from '../user-key/keys.ts';
import { handleDossier, RateLimited } from './handler.ts';

export default {
  // 'none': the page is public and the link secret is the only credential, which never comes
  // here. ctx.supabaseAdmin is the service role, the only one allowed to call open_dossier.
  // Default CORS: the page lives on another origin.
  fetch: withSupabase({ auth: 'none' }, async (req, ctx) => {
    try {
      return await handleDossier(req, async (tokenHash, client) => {
        const { data, error } = await ctx.supabaseAdmin.rpc('open_dossier', {
          p_token_hash: toByteaHex(tokenHash),
          p_client: client,
        });
        if (error?.code === 'GA429') throw new RateLimited();
        if (error) throw new Error(`open dossier: ${error.code}`);
        return data === null ? null : fromByteaHex(data);
      });
    } catch (e) {
      console.error('dossier failed:', e instanceof Error ? e.message : 'unknown');
      return Response.json({ error: 'internal' }, { status: 500 });
    }
  }),
};
