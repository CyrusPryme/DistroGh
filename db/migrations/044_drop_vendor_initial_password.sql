-- Stop storing plaintext vendor passwords.
-- Login secrets live only as bcrypt hashes on public.users. A generated
-- temporary password is returned once when an application is approved and
-- is not written back onto the vendor row.

UPDATE public.vendors
SET initial_password = NULL
WHERE initial_password IS NOT NULL;

ALTER TABLE public.vendors
  DROP COLUMN initial_password;
