# Archived SQL Scripts

**WARNING: These scripts are for historical reference only.**

- Do NOT run these against production.
- They may contain destructive operations (DROP, ALTER, etc.).
- They may not match the current schema.
- All schema changes must go through `prisma migrate dev` locally, a reviewed `migration.sql`, and `prisma migrate deploy` in production.

If you need to fix a schema issue, create a new migration with `npx prisma migrate dev --name <description>`.
