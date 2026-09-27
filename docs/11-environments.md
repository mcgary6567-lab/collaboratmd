# Environments

Three places the app runs, each with its own database:

| Where | Database | Data |
|---|---|---|
| Production (Vercel, main branch) | Neon `main` branch | Real practices |
| Previews (Vercel, pull requests) | Neon `staging` branch | Demo and test data |
| Your computer (`npm run dev`) | Embedded (leave `DATABASE_URL` empty), or the Neon `staging` branch | Demo and test data |
| CI and end-to-end tests | Embedded, thrown away after each run | Demo data |

## Why

Until now the local `.env.local` pointed at the production database, so local testing wrote to real data. The app now refuses that: the production deployment marks its database, and a development server or preview that connects to a marked database stops with an explanation. `ALLOW_PRODUCTION_DATABASE=true` overrides it for a deliberate one-off, such as applying a migration by hand. Migration scripts that connect with `pg` directly are not affected.

## Set up staging (once, about 10 minutes)

1. **Neon:** create an **empty** database for staging: a new database in the project, or a separate Neon project. Do not branch it from `main` once real practices use the app, because a branch copies their patient data into previews. Copy its **pooled** connection string. On its first start the app creates the tables; set `SEED_DEMO_DATA=true` for the Preview environment and it also loads the demo practice (it only seeds a database that has never been seeded).
2. **Vercel:** in Project → Settings → Environment Variables, set `DATABASE_URL`:
   - **Production:** the `main` branch's pooled URL (as today).
   - **Preview:** the `staging` URL.
   - **Development:** the `staging` URL, if you use `vercel env pull`.
   Give Preview its own `AUTH_SECRET` too, so a preview session can never open production.
3. **Your computer:** in `.env.local`, set `DATABASE_URL` to the staging URL, or remove it to use the embedded database.
4. **Branch protection (GitHub):** Settings → Branches → add a rule for `main` that requires the CI checks ("Type check and unit tests", "Production build and performance", "End-to-end and accessibility", and CodeQL's "Analyze") to pass before merging. Then work on branches and merge through pull requests; each one gets a preview deployment on staging.

## Migrations

The app applies pending migrations on start, under a lock. The order that keeps production safe:

1. The change merges and deploys to previews first, which migrates `staging`.
2. When it is merged to `main`, production applies the same migrations on its first request.

Migrations are written to be additive (new tables and columns) so the old code keeps working while the new one rolls out. A migration that removes or renames something needs two releases: stop using it first, remove it later.
