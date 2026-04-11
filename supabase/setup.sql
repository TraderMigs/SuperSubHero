-- SuperSubHero Database Setup
-- Run this entire script in Supabase SQL Editor

-- 1. JOBS TABLE
create table if not exists sub_jobs (
  id uuid primary key default gen_random_uuid(),
  video_url text not null,
  file_path text not null,
  languages text[] default array['en'],
  dual_sub boolean default false,
  dual_pair text[],
  status text default 'queued',
  results jsonb,
  error_msg text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. AUTO-UPDATE updated_at
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists sub_jobs_updated_at on sub_jobs;
create trigger sub_jobs_updated_at
  before update on sub_jobs
  for each row execute function update_updated_at();

-- 3. RLS - disable for personal use (this is your private tool)
alter table sub_jobs disable row level security;

-- 4. STORAGE BUCKETS
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'videos',
  'videos',
  true,
  10737418240,
  array['video/mp4','video/x-matroska','video/quicktime','video/x-msvideo','video/webm','video/x-m4v','application/octet-stream']
)
on conflict (id) do update set
  public = true,
  file_size_limit = 10737418240;

insert into storage.buckets (id, name, public, file_size_limit)
values (
  'subtitles',
  'subtitles',
  true,
  52428800
)
on conflict (id) do update set public = true;

-- 5. STORAGE POLICIES - open for personal use
drop policy if exists "Public video access" on storage.objects;
create policy "Public video access"
  on storage.objects for all
  using (bucket_id = 'videos')
  with check (bucket_id = 'videos');

drop policy if exists "Public subtitle access" on storage.objects;
create policy "Public subtitle access"
  on storage.objects for all
  using (bucket_id = 'subtitles')
  with check (bucket_id = 'subtitles');

-- 6. CLEANUP FUNCTION - deletes video files older than 24 hours (saves storage)
create or replace function cleanup_old_videos()
returns void as $$
declare
  old_job record;
begin
  for old_job in
    select file_path from sub_jobs
    where created_at < now() - interval '24 hours'
    and file_path is not null
  loop
    delete from storage.objects
    where bucket_id = 'videos'
    and name = old_job.file_path;
  end loop;
end;
$$ language plpgsql security definer;

-- Done!
select 'SuperSubHero database setup complete!' as status;
