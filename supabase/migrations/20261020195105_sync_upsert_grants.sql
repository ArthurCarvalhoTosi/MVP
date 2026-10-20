-- The app pushes with a PostgREST upsert, which sets every column it sends on conflict,
-- including the key columns table_name and id (to the same values). Without UPDATE on them the
-- whole push fails. The owner still can't move a row to someone else: user_id stays ungranted
-- and RLS checks it.
grant update (table_name, id) on public.sync_records to authenticated;
