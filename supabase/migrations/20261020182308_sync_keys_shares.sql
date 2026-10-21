-- v1 backend: encrypted sync rows, wrapped data keys and public dossier shares.
--
-- The server is a dumb store. Each synced row travels as AES-256-GCM ciphertext made on the
-- device with the user's data key (DEK); every calculation stays on the phone. See sections
-- 8.3-8.5 of decisoes_projeto_manutencao_veicular.md.
--
-- New tables are not exposed to the Data API automatically in the hosted project, while the
-- local stack grants everything by default. Each table therefore revokes all and grants back
-- only what the app needs, column by column, so both behave the same.

-- Sync -----------------------------------------------------------------------------------

create table public.sync_records (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  table_name text not null check (
    table_name in (
      'vehicles',
      'odometer_readings',
      'maintenance_items',
      'maintenance_logs',
      'attachments',
      'vehicle_specs'
    )
  ),
  -- Local primary key. vehicle_specs reuses its vehicle's id, hence table_name in the key.
  id uuid not null,
  -- Device clock: decides last-write-wins between copies of the same row.
  updated_at timestamptz not null,
  deleted_at timestamptz,
  ciphertext bytea not null check (octet_length(ciphertext) <= 65536),
  nonce bytea not null check (octet_length(nonce) = 12),
  key_version integer not null check (key_version >= 1),
  -- Server clock: the pull cursor. A device clock running late would make other devices skip
  -- rows. Stamped when the statement runs, not at commit, so a pull must re-read a short
  -- window before its cursor; merging is idempotent, so re-reading is harmless.
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, table_name, id)
);

create index sync_records_pull_idx on public.sync_records (user_id, server_updated_at);

create function public.sync_records_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Two devices may push the same row in any order; the newer copy must win on the server
  -- too. Skipping the update (return null) keeps an upsert from failing the whole batch.
  if tg_op = 'UPDATE' and new.updated_at <= old.updated_at then
    return null;
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger sync_records_before_write
before insert or update on public.sync_records
for each row execute function public.sync_records_before_write();

alter table public.sync_records enable row level security;

create policy "Owners read their rows" on public.sync_records
for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Owners add their rows" on public.sync_records
for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Owners change their rows" on public.sync_records
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- No delete: rows are soft-deleted like the local ones; deleting the account cascades.
revoke all on public.sync_records from anon, authenticated;
grant select on public.sync_records to authenticated;
grant insert (table_name, id, updated_at, deleted_at, ciphertext, nonce, key_version)
on public.sync_records to authenticated;
grant update (updated_at, deleted_at, ciphertext, nonce, key_version)
on public.sync_records to authenticated;
grant all on public.sync_records to service_role;

-- Keys -----------------------------------------------------------------------------------

-- The DEK wrapped by the server-held KEK. Only Edge Functions (service role) touch it: no
-- policies and no grants for app users. Deleting the account deletes the DEK, which makes
-- every remaining copy of the data unreadable (crypto-shredding).
create table public.user_keys (
  user_id uuid primary key references auth.users (id) on delete cascade,
  wrapped_dek bytea not null,
  kek_version integer not null check (kek_version >= 1),
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

alter table public.user_keys enable row level security;
revoke all on public.user_keys from anon, authenticated;
grant all on public.user_keys to service_role;

-- Dossier link ---------------------------------------------------------------------------

-- A frozen copy of the resale history the owner chose to publish, decrypted on the phone
-- with explicit consent. Only the hash of the 128-bit token is stored; the public page reads
-- it through an Edge Function with rate limiting, never through this table.
create table public.dossier_shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  vehicle_id uuid not null,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  include_photos boolean not null default false,
  snapshot jsonb not null check (octet_length(snapshot::text) <= 262144),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  check (expires_at is null or expires_at > created_at)
);

create index dossier_shares_user_idx on public.dossier_shares (user_id);

alter table public.dossier_shares enable row level security;

create policy "Owners read their shares" on public.dossier_shares
for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Owners create shares" on public.dossier_shares
for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Owners revoke their shares" on public.dossier_shares
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Owners delete their shares" on public.dossier_shares
for delete to authenticated
using ((select auth.uid()) = user_id);

-- The snapshot is frozen: once shared, only the expiry and revocation can change.
revoke all on public.dossier_shares from anon, authenticated;
grant select, delete on public.dossier_shares to authenticated;
grant insert (vehicle_id, token_hash, include_photos, snapshot, expires_at)
on public.dossier_shares to authenticated;
grant update (expires_at, revoked_at) on public.dossier_shares to authenticated;
grant all on public.dossier_shares to service_role;
