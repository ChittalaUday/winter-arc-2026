# Winter Arc Tracker

A fitness tracker with Vercel Node.js API functions and Neon PostgreSQL. Signup, login, goals, targets, workout history/deletion, charts, badges, meals, personal records, shared leaderboards, comparisons and CSV export use server-backed accounts. Theme preferences remain in browser storage.

## Deploy on Vercel Hobby + Neon Free

1. Connect this repository to a personal Vercel Hobby project. Use Framework Preset **Other**, the repository root, Build Command `npm run build`, and Output Directory `dist` (also configured in vercel.json). Use Node.js 24.
2. Create a Neon Free database. Add its connection string as a **Sensitive**, server-only `DATABASE_URL` in Vercel's Production environment. Never use a public environment variable prefix or commit a real environment file.
3. Initialize the schema once with `npm run db:migrate`, supplying `DATABASE_URL` privately through your shell environment or an ignored local environment file. The script creates the `winter_arc` schema without deleting existing data. Do not run migrations on each API request.
4. Redeploy after adding the variable. Open the deployment, create a new server account, and test login and saving a workout.
5. Configure a separate Neon database/branch for preview deployments if needed. Production credentials should not be enabled for all previews. `APP_ORIGIN` optionally fixes the allowed request origin to your exact canonical HTTPS URL; otherwise the current deployment host is used.

The Hobby plan is for personal, non-commercial use. This implementation requires no paid add-ons, custom domain, Redis, or hosted authentication. Availability depends on Vercel and Neon free allowances. Keep both accounts on free plans if you want no paid usage.

## Secrets and authentication

Database access happens only in backend code. Passwords use salted scrypt hashes. Login issues an HttpOnly, Secure, SameSite cookie; only a hash of its random token is stored in the database. Sessions expire after 30 days and logout revokes them. Every record operation derives its owner from the session. Mutations require same-origin JSON requests. Rate limits live in PostgreSQL, not function memory. Errors and logs do not expose driver credentials.

Use separate migration and restricted runtime database roles where practical. Rotate any connection string shared in chat or otherwise exposed before production use. There is no password-reset/email flow in this version; these were not existing tracker features.

## Existing browser data

Local accounts do not become server identities. Create a server account, then use the import panel to copy your own previous local tracker data. It offers local accounts found on this browser and domain. Imports preserve original browser records, never upload old credential hashes, and can be retried without duplicating records. Clearing browser storage before import removes that source data. Imports accept up to 1,000 workouts and meals each within a 256 KiB request.

The shared leaderboard exposes only usernames and aggregate training statistics. Personal goals, meals, notes, weights and passwords are excluded.

## Local development and tests

```bash
npm ci
# Copy .env.example to .env.local and fill it privately.
node --env-file=.env.local --import tsx scripts/migrate.ts
node --env-file=.env.local --import tsx scripts/dev.ts
```

Open http://127.0.0.1:8766. The local server serves only the frontend and API. A secure cookie is intentionally used; modern browsers support secure cookies on localhost/loopback. Use HTTPS in production.

```bash
npm test
npm run typecheck
npm run build
# Optional: run against a disposable test database, with DATABASE_URL set privately.
node --env-file=.env.local --import tsx scripts/live-test.ts
```

Tests use embedded PostgreSQL (PGlite) for real SQL and execute the frontend script against that API with DOM/browser stubs. The live smoke script creates and removes its own disposable test accounts. These checks do not replace visual browser testing.
