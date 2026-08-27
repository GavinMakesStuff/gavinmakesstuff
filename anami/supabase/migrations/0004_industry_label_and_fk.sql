-- Denormalize the industry label onto stories so archived editions keep their
-- industry sections after an interest is renamed or deleted.
alter table stories add column if not exists interest_label text;

-- An interest can be deleted from /settings; its historical stories must survive.
alter table stories drop constraint if exists stories_interest_id_fkey;
alter table stories
  add constraint stories_interest_id_fkey
  foreign key (interest_id) references interests(id) on delete set null;

-- Prevent duplicate seed rows (fixes the non-idempotent 0003 seed). Scoped to top-level
-- industries only, so two industries may each carry a sub-topic with the same label.
drop index if exists interests_user_type_label_uniq;
create unique index if not exists interests_user_industry_label_uniq
  on interests (user_id, label) where type = 'industry' and parent_interest_id is null;
