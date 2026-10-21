-- Row level security and grants for the v1 tables. Each block acts as a real client role
-- (anon or authenticated with a JWT subject) and resets to postgres to inspect the result.
begin;
-- On the hosted project the CLI logs in as a temporary role that can become postgres but
-- cannot see the extensions schema; locally it is postgres already. Hence "set local role
-- postgres" instead of "reset role" throughout.
set local role postgres;
set local search_path = extensions, public;
create extension if not exists pgtap with schema extensions;
select plan(52);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.local');

create function pg_temp.act_as(who text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           json_build_object('sub', who, 'role', 'authenticated')::text, true);
$$;

-- RLS on every table ------------------------------------------------------------------

select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('public.sync_records'::regclass, 'public.user_keys'::regclass,
                 'public.dossier_shares'::regclass, 'public.dossier_opens'::regclass)),
  'RLS is enabled on every v1 table'
);

-- Anonymous ---------------------------------------------------------------------------

set local role anon;
select throws_ok('select * from public.sync_records', '42501', null,
  'anon cannot read sync rows');
select throws_ok('select * from public.dossier_shares', '42501', null,
  'anon cannot read shares');
select throws_ok('select * from public.user_keys', '42501', null,
  'anon cannot read keys');
set local role postgres;

-- sync_records ------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');

select lives_ok($$
  insert into public.sync_records (table_name, id, updated_at, ciphertext, nonce, key_version)
  values ('vehicles', '11111111-1111-1111-1111-111111111111', '2026-10-20T10:00:00Z',
          '\x01', '\x000000000000000000000000', 1)
$$, 'a user adds a row of their own');

select lives_ok($$
  insert into public.sync_records (table_name, id, updated_at, ciphertext, nonce, key_version)
  values ('vehicle_specs', '11111111-1111-1111-1111-111111111111', '2026-10-20T10:00:00Z',
          '\x02', '\x000000000000000000000000', 1)
$$, 'vehicle_specs may reuse the vehicle id');

select throws_ok($$
  insert into public.sync_records (user_id, table_name, id, updated_at, ciphertext, nonce,
                                   key_version)
  values ('00000000-0000-0000-0000-00000000000b', 'vehicles',
          '22222222-2222-2222-2222-222222222222', now(), '\x01',
          '\x000000000000000000000000', 1)
$$, '42501', null, 'a user cannot write a row for someone else');

select throws_ok($$
  insert into public.sync_records (table_name, id, updated_at, ciphertext, nonce, key_version,
                                   server_updated_at)
  values ('vehicles', '33333333-3333-3333-3333-333333333333', now(), '\x01',
          '\x000000000000000000000000', 1, '2999-01-01')
$$, '42501', null, 'a user cannot forge the server cursor');

select throws_ok($$
  insert into public.sync_records (table_name, id, updated_at, ciphertext, nonce, key_version)
  values ('device_prefs', '44444444-4444-4444-4444-444444444444', now(), '\x01',
          '\x000000000000000000000000', 1)
$$, '23514', null, 'device-local tables are never synced');

select throws_ok($$
  insert into public.sync_records (table_name, id, updated_at, ciphertext, nonce, key_version)
  values ('vehicles', '55555555-5555-5555-5555-555555555555', now(), '\x01', '\x00', 1)
$$, '23514', null, 'the nonce must be 12 bytes');

select throws_ok($$
  update public.sync_records set user_id = '00000000-0000-0000-0000-00000000000b'
$$, '42501', null, 'a row cannot change owner');

select throws_ok($$ delete from public.sync_records $$, '42501', null,
  'rows are never hard-deleted by the app');

set local role postgres;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');

select is((select count(*)::int from public.sync_records), 0,
  'another user sees none of the rows');

select lives_ok($$
  update public.sync_records set ciphertext = '\xff', updated_at = '2030-01-01'
$$, 'another user''s update runs');

set local role postgres;
select is(
  (select count(*)::int from public.sync_records where ciphertext = '\xff'), 0,
  '... but changes nothing');

-- Last-write-wins and the server cursor

create temp table cursor_before as
  select server_updated_at from public.sync_records
  where table_name = 'vehicles' and id = '11111111-1111-1111-1111-111111111111';
grant select on cursor_before to authenticated;

select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');

select lives_ok($$
  insert into public.sync_records (table_name, id, updated_at, ciphertext, nonce, key_version)
  values ('vehicles', '11111111-1111-1111-1111-111111111111', '2026-10-20T09:00:00Z', '\x0a',
          '\x000000000000000000000000', 1)
  on conflict (user_id, table_name, id) do update
  set updated_at = excluded.updated_at, ciphertext = excluded.ciphertext
$$, 'an upsert of an older copy does not fail');

select is(
  (select ciphertext from public.sync_records
   where table_name = 'vehicles' and id = '11111111-1111-1111-1111-111111111111'),
  '\x01'::bytea, '... and keeps the newer copy');

select lives_ok($$
  update public.sync_records set ciphertext = '\x0b', updated_at = '2026-10-20T10:00:00Z'
  where table_name = 'vehicles' and id = '11111111-1111-1111-1111-111111111111'
$$, 'a copy with the same timestamp runs');

select is(
  (select ciphertext from public.sync_records
   where table_name = 'vehicles' and id = '11111111-1111-1111-1111-111111111111'),
  '\x01'::bytea, '... and keeps the stored copy');

select lives_ok($$
  insert into public.sync_records (table_name, id, updated_at, ciphertext, nonce, key_version)
  values ('vehicles', '11111111-1111-1111-1111-111111111111', '2026-10-20T11:00:00Z', '\x0c',
          '\x000000000000000000000000', 1)
  on conflict (user_id, table_name, id) do update
  set updated_at = excluded.updated_at, ciphertext = excluded.ciphertext
$$, 'an upsert of a newer copy runs');

select ok(
  (select ciphertext = '\x0c' and server_updated_at > (select server_updated_at from cursor_before)
   from public.sync_records
   where table_name = 'vehicles' and id = '11111111-1111-1111-1111-111111111111'),
  '... replaces the row and moves the server cursor');

set local role postgres;

-- The upsert PostgREST sends for the app's push: every sent column is set on conflict.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select lives_ok($$
  insert into public.sync_records (table_name, id, updated_at, deleted_at, ciphertext, nonce,
                                   key_version)
  values ('vehicles', '11111111-1111-1111-1111-111111111111', '2026-10-20T12:00:00Z', null,
          '\x0d', '\x000000000000000000000000', 1)
  on conflict (user_id, table_name, id) do update set
    table_name = excluded.table_name, id = excluded.id, updated_at = excluded.updated_at,
    deleted_at = excluded.deleted_at, ciphertext = excluded.ciphertext, nonce = excluded.nonce,
    key_version = excluded.key_version
$$, 'the app''s upsert (PostgREST merge-duplicates) runs');
select is(
  (select ciphertext from public.sync_records
   where table_name = 'vehicles' and id = '11111111-1111-1111-1111-111111111111'),
  '\x0d'::bytea, '... and stores the newer copy');
set local role postgres;

-- user_keys -----------------------------------------------------------------------------

insert into public.user_keys (user_id, wrapped_dek, kek_version)
values ('00000000-0000-0000-0000-00000000000a', '\xdeadbeef', 1);

select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select throws_ok('select * from public.user_keys', '42501', null,
  'not even the owner reads the wrapped key directly');
set local role postgres;

-- dossier_shares --------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');

select lives_ok($$
  insert into public.dossier_shares (vehicle_id, token_hash, ciphertext, expires_at)
  values ('11111111-1111-1111-1111-111111111111', sha256('token-a'), '\x01aa',
          now() + interval '30 days')
$$, 'an owner creates a share');

select throws_ok($$
  update public.dossier_shares set ciphertext = '\x01bb'
$$, '42501', null, 'a share is frozen');

select throws_ok($$
  update public.dossier_shares set expires_at = null
$$, '42501', null, '... expiry included');


set local role postgres;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');

select is((select count(*)::int from public.dossier_shares), 0,
  'another user sees none of the shares');

select lives_ok($$ delete from public.dossier_shares $$, 'another user''s delete runs');

set local role postgres;
select is((select count(*)::int from public.dossier_shares), 1, '... but removes nothing');

-- Opening a link (what the dossier Edge Function does, as service_role) -------------------

select ok(
  not has_function_privilege('anon', 'public.open_dossier(bytea, text)', 'execute')
    and not has_function_privilege('authenticated', 'public.open_dossier(bytea, text)',
                                   'execute'),
  'only the Edge Function opens a dossier: no execute for anon or app users');

insert into public.dossier_shares (user_id, vehicle_id, token_hash, ciphertext, created_at,
                                   expires_at)
values ('00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111',
        sha256('token-old'), '\x01cc', now() - interval '2 days', now() - interval '1 day');

set local role service_role;

select is(public.open_dossier(sha256('token-a'), 'client-1'), '\x01aa'::bytea,
  'a live link opens');
select is(public.open_dossier(sha256('token-unknown'), 'client-1'), null,
  'an unknown link opens nothing');
select is(public.open_dossier(sha256('token-old'), 'client-1'), null,
  'an expired link opens nothing');

select lives_ok($$
  select count(public.open_dossier(sha256('token-a'), 'client-1')) from generate_series(1, 27)
$$, '30 opens from one caller in 10 minutes pass');
select throws_ok($$ select public.open_dossier(sha256('token-a'), 'client-1') $$, 'GA429',
  null, 'the 31st is refused');
select is(public.open_dossier(sha256('token-a'), 'client-2'), '\x01aa'::bytea,
  '... while another caller still opens the link');

set local role postgres;
update public.dossier_opens set window_start = now() - interval '11 minutes'
where client = 'client-1';
set local role service_role;
select is(public.open_dossier(sha256('token-a'), 'client-1'), '\x01aa'::bytea,
  'the first caller opens it again in a new window');

set local role postgres;
select is((select schedule from cron.job where jobname = 'dossier-cleanup'), '7 * * * *',
  'expired links and old counters are deleted every hour');

-- Photos (storage.objects, bucket attachments) --------------------------------------------

-- Storage blocks plain SQL deletes unless asked; the policies are what this file checks.
set local storage.allow_delete_query = 'true';

select is((select public from storage.buckets where id = 'attachments'), false,
  'the photo bucket is private');

set local role anon;
select throws_ok($$
  insert into storage.objects (bucket_id, name)
  values ('attachments', '00000000-0000-0000-0000-00000000000a/66666666-6666-6666-6666-666666666666.bin')
$$, '42501', null, 'anon cannot upload a photo');
set local role postgres;

select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');

select lives_ok($$
  insert into storage.objects (bucket_id, name)
  values ('attachments', '00000000-0000-0000-0000-00000000000a/66666666-6666-6666-6666-666666666666.bin')
$$, 'a user uploads a photo to their own folder');

select throws_ok($$
  insert into storage.objects (bucket_id, name)
  values ('attachments', '00000000-0000-0000-0000-00000000000b/77777777-7777-7777-7777-777777777777.bin')
$$, '42501', null, 'a user cannot upload into someone else''s folder');

select throws_ok($$
  insert into storage.objects (bucket_id, name)
  values ('attachments', '00000000-0000-0000-0000-00000000000a/sub/receipt.jpg')
$$, '42501', null, 'only "<user>/<attachment id>.bin" names are accepted');

set local role postgres;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');

select is((select count(*)::int from storage.objects where bucket_id = 'attachments'), 0,
  'another user sees none of the photos');

select lives_ok($$ update storage.objects set metadata = '{"forged": true}' $$,
  'another user''s update runs');

select lives_ok($$ delete from storage.objects $$, 'another user''s delete runs');

set local role anon;
select is((select count(*)::int from storage.objects where bucket_id = 'attachments'), 0,
  'anon sees none of the photos');
set local role postgres;

select is(
  (select count(*)::int from storage.objects
   where bucket_id = 'attachments' and metadata is null
     and name = '00000000-0000-0000-0000-00000000000a/66666666-6666-6666-6666-666666666666.bin'),
  1, '... and neither changed nor removed the photo');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select lives_ok($$
  delete from storage.objects
  where name = '00000000-0000-0000-0000-00000000000a/66666666-6666-6666-6666-666666666666.bin'
$$, 'the owner removes their photo');
set local role postgres;
select is(
  (select count(*)::int from storage.objects
   where name = '00000000-0000-0000-0000-00000000000a/66666666-6666-6666-6666-666666666666.bin'),
  0, '... and it is gone');

-- Account deletion ------------------------------------------------------------------------

delete from auth.users where id = '00000000-0000-0000-0000-00000000000a';

-- Only this user's rows: other local runs (the sync e2e test) may have left their own.
select is(
  (select count(*)::int from public.sync_records
   where user_id = '00000000-0000-0000-0000-00000000000a')
    + (select count(*)::int from public.user_keys
       where user_id = '00000000-0000-0000-0000-00000000000a')
    + (select count(*)::int from public.dossier_shares
       where user_id = '00000000-0000-0000-0000-00000000000a'),
  0, 'deleting the account removes rows, the wrapped key and shares');

select * from finish();
rollback;
