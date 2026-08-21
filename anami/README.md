# Anami — setup

1. Create a Supabase project. Run `supabase/migrations/0001_init.sql` in its SQL editor.
2. Copy `.env.local.example` to `.env.local` and fill in `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY` (from Supabase project settings), `ANTHROPIC_API_KEY`,
   `NEWS_API_KEY` (from newsapi.org), and `CRON_SECRET` (any random string).
3. `npm install`
4. `npm run dev` — visit http://localhost:3000
5. To deploy: connect this repo to a Vercel project, set the same env vars there,
   and set `CRON_SECRET` in the Vercel project settings so Vercel Cron's automatic
   `Authorization` header on requests to `/api/generate` matches what the route checks.
