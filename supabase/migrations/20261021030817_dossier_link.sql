-- Slice 5: the dossier link carries its own key.
--
-- The phone draws a 128-bit secret and puts it after the "#" of the link, which browsers never
-- send to a server. The SHA-256 of the secret names the share here; a key derived from it
-- seals the copy on the phone. The server keeps only ciphertext and that hash, so neither a
-- database leak nor we can read a dossier. See "Fatia 5" in section 12 of
-- decisoes_projeto_manutencao_veicular.md.

-- Shares made under the old plain-JSON design (dev only, before launch) can't be converted.
delete from public.dossier_shares;

alter table public.dossier_shares
  drop column snapshot,
  -- Photos stay out of the link (the PDF still offers them): receipts show CPF and address,
  -- and a link gets forwarded.
  drop column include_photos,
  -- Deactivating a link deletes it, which also keeps nothing the owner turned off.
  drop column revoked_at,
  -- One format byte, then nonce + ciphertext + GCM tag.
  add column ciphertext bytea not null check (octet_length(ciphertext) <= 262144);

-- Frozen: the owner creates, lists and deletes shares, and changes nothing.
drop policy "Owners revoke their shares" on public.dossier_shares;
revoke insert, update on public.dossier_shares from authenticated;
grant insert (vehicle_id, token_hash, ciphertext, expires_at)
on public.dossier_shares to authenticated;

-- Opening a link ---------------------------------------------------------------------------

-- Fixed-window counter per caller (SHA-256 of the IP), for the rate limit. Rows live minutes.
create table public.dossier_opens (
  client text primary key,
  window_start timestamptz not null,
  hits integer not null
);

alter table public.dossier_opens enable row level security;
revoke all on public.dossier_opens from anon, authenticated;
grant all on public.dossier_opens to service_role;

-- The sealed copy behind a live link, or null for an unknown, deleted or expired one. Raises
-- GA429 past 30 opens in 10 minutes from the same caller. Only the dossier Edge Function
-- (service role) calls it; the public page never reaches the table.
create function public.open_dossier(p_token_hash bytea, p_client text)
returns bytea
language plpgsql
set search_path = ''
as $$
declare
  v_hits integer;
  v_ciphertext bytea;
begin
  insert into public.dossier_opens as o (client, window_start, hits)
  values (p_client, now(), 1)
  on conflict (client) do update set
    hits = case when o.window_start < now() - interval '10 minutes' then 1 else o.hits + 1 end,
    window_start = case
      when o.window_start < now() - interval '10 minutes' then now() else o.window_start
    end
  returning hits into v_hits;

  if v_hits > 30 then
    raise exception 'too many opens' using errcode = 'GA429';
  end if;

  select s.ciphertext into v_ciphertext
  from public.dossier_shares s
  where s.token_hash = p_token_hash and (s.expires_at is null or s.expires_at > now());
  return v_ciphertext;
end;
$$;

revoke execute on function public.open_dossier(bytea, text) from public, anon, authenticated;
grant execute on function public.open_dossier(bytea, text) to service_role;

-- Cleanup ----------------------------------------------------------------------------------

-- The privacy policy keeps a link only until it expires; opens counters only for their window.
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'dossier-cleanup',
  '7 * * * *',
  $$
    delete from public.dossier_shares where expires_at <= now();
    delete from public.dossier_opens where window_start < now() - interval '10 minutes';
  $$
);
