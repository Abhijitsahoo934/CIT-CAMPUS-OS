# CIT CampusFlow

## Run locally

Install Node.js 18 or newer and configure Supabase:

1. Create a Supabase project.
2. In the Supabase SQL Editor, run [`supabase-schema.sql`](./supabase-schema.sql).
3. Copy `.env.example` to `.env`.
4. Set `SUPABASE_URL` to the project URL and `SUPABASE_SERVICE_ROLE_KEY` to the project **secret/service-role key**. Keep this key private and never put it in browser code.
5. Set `CAMPUSFLOW_DEMO_PASSWORD` to a password for the demo accounts.

Then run from this directory:

```powershell
node server.js
```

Open <http://127.0.0.1:3000>. Do not open the HTML file directly: sign-in and Supabase persistence require the server. Without Supabase configuration, the app runs in demo mode and changes are not persisted.

## Demo sign-in

All four demo accounts use `password123` by default:

- `admin@cit.edu.in`
- `coord.cse@cit.edu.in`
- `f07@cit.edu.in`
- `club@cit.edu.in`

Set `CAMPUSFLOW_DEMO_PASSWORD` to change the shared demo password. In production, set this variable to at least 12 characters and serve the app over HTTPS. The demo accounts and shared-password model are for demonstrations only; replace them with managed accounts and a persistent identity provider before production use.

The server reads `.env` on startup (environment variables already set by the host take precedence). Supabase stores the shared schedule, dataset, disruption proposal, and conflict-simulation state in one JSONB row. Updates are debounced and saved for all signed-in demo roles. Sign-in itself still uses the local demo accounts; Supabase Auth is not configured in this sample.

The service-role key stays on the server. Keep Row Level Security enabled and never expose that key to the browser. The demo API currently authorizes data reads/writes by signed-in session only; for production, replace demo authentication and add server-side role/record authorization, audit logging, and backups.

If Supabase reports that `public.campusflow_app_state` is missing, run `supabase-schema.sql` in the Supabase SQL Editor, then restart `node server.js` and sign in again.

## Files

- `cit_campusflow_one_campus_one_schedule_zero_conflicts.html` — page structure
- `styles.css` — application styles
- `tailwind-config.js` — Tailwind theme
- `data.js` — embedded sample schedule and institute data
- `app.js` — CampusFlow UI and scheduling behavior
- `auth.js` — sign-in UI and session requests
- `server.js` — static server, password verification, and HTTP-only sessions
- `supabase-schema.sql` — database table and access policy setup
- `.env.example` — local Supabase configuration template

Sessions are held in memory and are cleared when the server restarts. The sample dataset is sent to the browser for the client-side scheduler; the server persists its state in Supabase but does not provide production-grade authorization for scheduling changes.
