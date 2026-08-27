-- supabase/migrations/0003_seed_industries.sql
insert into interests (user_id, type, label, parent_interest_id, weight)
values
  ('00000000-0000-0000-0000-000000000001', 'industry', 'Mining', null, 1.0),
  ('00000000-0000-0000-0000-000000000001', 'industry', 'AI', null, 1.0),
  ('00000000-0000-0000-0000-000000000001', 'industry', 'Technology', null, 1.0),
  ('00000000-0000-0000-0000-000000000001', 'industry', 'Energy', null, 1.0);
