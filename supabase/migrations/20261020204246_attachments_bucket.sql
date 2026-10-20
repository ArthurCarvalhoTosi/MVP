-- Receipt photos (slice 4). Each file is the JPEG sealed on the phone with the user's data key
-- (AES-256-GCM, the attachment id as associated data), so the bucket only ever holds
-- ciphertext. One flat folder per user: "<user id>/<attachment id>.bin".
--
-- storage.objects belongs to Supabase Storage, so there are no grants to trim here: these
-- policies are the whole access rule. Deleting a user in auth.users does not remove their
-- files; deleting the account (slice 6) empties the folder through the Storage API, and the
-- shredded data key leaves anything missed unreadable.

-- Private: no public URLs. 5 MiB is far above a 1600 px receipt and still stops junk uploads.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 5242880, array['application/octet-stream']);

-- Upload with upsert needs insert, select and update; remove needs select and delete.
create policy "Owners read their photos" on storage.objects
for select to authenticated
using (
  bucket_id = 'attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Owners add photos" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.bin$'
);

create policy "Owners replace their photos" on storage.objects
for update to authenticated
using (
  bucket_id = 'attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.bin$'
);

create policy "Owners delete their photos" on storage.objects
for delete to authenticated
using (
  bucket_id = 'attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
