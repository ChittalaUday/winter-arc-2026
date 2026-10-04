# Vercel Hobby + Neon Free deployment

Approved scope: keep the existing fitness tracker UI and features, replace local credentials and records with server authentication and PostgreSQL, keep all database credentials outside Git, and use free plans only.

## Architecture

The static frontend calls `/api/tracker?action=...` on the same origin. A Node.js Vercel Function validates JSON with Zod, checks a server session, applies ownership filters, and queries Neon through the HTTPS serverless driver. The frontend never gets a connection string or database password.

## Work and verification

1. Add schema under `winter_arc` with users, sessions, targets, workouts, meals, personal records and persistent auth rate limits. Passwords use salted scrypt hashes; session tokens are random and stored as hashes.
2. Implement signup/login/logout, state, goals, targets, workout creation/deletion, meals, record updates, aggregate leaderboards and comparisons. Validate types and ranges, reject unknown fields, check request origins, use parameterized SQL, and redact errors.
3. Connect existing forms and rendering to the API. Keep theme in local storage. Offer explicit imports of old tracker records without sending old password hashes. Imports are atomic and idempotent.
4. Run PostgreSQL integration and frontend flow tests, type checking, build verification, live Neon smoke tests and credential leakage checks. Document any blocked browser checks.
5. Push the reviewed code to main. Production deployment requires the user to set DATABASE_URL in Vercel and redeploy. Do not connect preview environments to production data by default.

## Environment and database

Use Node.js 24. DATABASE_URL is private, server-side configuration. Optionally set APP_ORIGIN to the exact canonical HTTPS origin; omit it if supporting multiple deployment domains. Build output is limited to the static frontend. Database credentials are never embedded in build output.

Run `npm run db:migrate` with the database URL provided through the process environment. Migrations create an isolated schema and never drop existing tables. Do not run migrations from an API request or embed production credentials in scripts.

A database owner connection is acceptable for initial setup/testing. For production, prefer a restricted runtime role with USAGE on winter_arc and SELECT/INSERT/UPDATE/DELETE on its tables; keep schema-owner credentials for migrations only.

## Free plan constraints

Stay on Vercel Hobby and Neon Free, with the free vercel.app address. No paid authentication, Redis, email service, file storage, timers, or continuous polling. SQL computes the shared leaderboard when state loads or changes. Free quotas can limit availability; the API must return useful errors when the database is unavailable. Vercel Hobby is for personal, non-commercial use.

## Review focus

User ownership, CSRF/origin validation, hashed credentials/sessions, bounded input/import sizes, no private fields in shared statistics, idempotency, timeout/error redaction, and build exclusion of server files and secrets.
