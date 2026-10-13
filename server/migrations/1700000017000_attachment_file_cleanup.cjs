exports.up = (pgm) => pgm.sql(`
  lock table lesson_attachments in access exclusive mode;
  create table attachment_file_cleanup (
    id uuid primary key default gen_random_uuid(),
    attachment_id uuid not null, lesson_id uuid not null, file_path text not null,
    created_at timestamptz not null default clock_timestamp(),
    attempts integer not null default 0 check(attempts between 0 and 1000000),
    next_attempt_at timestamptz not null default clock_timestamp(),
    last_error text check(last_error in ('filesystem_error','unsafe_path','still_referenced'))
  );
  create index attachment_file_cleanup_ready on attachment_file_cleanup(next_attempt_at,created_at,id);
  create index attachment_file_cleanup_attachment on attachment_file_cleanup(attachment_id);
  create function enqueue_attachment_file_cleanup() returns trigger language plpgsql as $$
  begin
    -- No FK back to deleted content: cascade must not erase the cleanup job.
    -- Qualify by the firing table's schema, never a caller's search_path.
    execute format('insert into %I.attachment_file_cleanup (attachment_id,lesson_id,file_path) values ($1,$2,$3)',TG_TABLE_SCHEMA)
      using old.id,old.lesson_id,old.file_path;
    return old;
  end;
  $$;
  create trigger attachment_file_cleanup_on_delete after delete on lesson_attachments
    for each row execute function enqueue_attachment_file_cleanup();
`);
exports.down = (pgm) => pgm.sql(`
  lock table lesson_attachments,attachment_file_cleanup in access exclusive mode;
  do $$ begin
    if exists(select 1 from attachment_file_cleanup) then
      raise exception 'pending_attachment_file_cleanup';
    end if;
  end $$;
  drop trigger attachment_file_cleanup_on_delete on lesson_attachments;
  drop function enqueue_attachment_file_cleanup();
  drop table attachment_file_cleanup;
`);
