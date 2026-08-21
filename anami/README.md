# Anami — setup

1. Create a Supabase project. Run `supabase/migrations/0001_init.sql` in its SQL editor.
2. Copy `.env.local.example` to `.env.local` and fill in `ANAMI_SUPABASE_URL`,
   `ANAMI_SUPABASE_SERVICE_ROLE_KEY` (from Supabase project settings), `ANTHROPIC_API_KEY`,
   `NEWS_API_KEY` (from newsapi.org), and `CRON_SECRET` (any random string).
3. `npm install`
4. `npm run dev` — visit http://localhost:3000
5. To deploy: connect this repo to a Vercel project, set the same env vars there.
   `CRON_SECRET` must be named exactly that on the Vercel project (not prefixed) —
   Vercel specifically recognizes that name and automatically sends its value as
   the `Authorization` header on cron-triggered requests to `/api/generate`, which
   is what the route checks against. `ANAMI_SUPABASE_URL`/`ANAMI_SUPABASE_SERVICE_ROLE_KEY`
   have no such platform requirement and can be named however you like, as long as
   `lib/supabase.ts` reads the same names.
