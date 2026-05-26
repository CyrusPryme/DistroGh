-- FDA certificates stored in Google Drive (Postgres holds metadata + dates)

alter table public.vendors
  add column if not exists fda_certificate_acquired_at date,
  add column if not exists fda_drive_file_id text,
  add column if not exists fda_drive_view_link text,
  add column if not exists fda_uploaded_at timestamptz;

comment on column public.vendors.fda_certificate_acquired_at is 'Date the FDA certificate was issued/acquired';
comment on column public.vendors.fda_drive_file_id is 'Google Drive file id for the FDA certificate';
comment on column public.vendors.fda_drive_view_link is 'Google Drive webViewLink for admin/vendor access';
comment on column public.vendors.fda_uploaded_at is 'When the certificate was last uploaded to Drive';
