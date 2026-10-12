exports.up = (pgm) => pgm.sql(`
  -- Existing/server events retain NULL; no journal entry is rewritten/deleted.
  alter table events add column client_event_id uuid;
  alter table events add constraint events_owner_client_id_unique unique(user_id,client_event_id);
  create table event_rate_limits (
    user_id uuid primary key references users(id) on delete cascade,
    requests integer not null check(requests>0), expires_at timestamptz not null
  );
`);
exports.down = (pgm) => pgm.sql(`
  drop table event_rate_limits;
  alter table events drop constraint events_owner_client_id_unique;
  alter table events drop column client_event_id;
`);
