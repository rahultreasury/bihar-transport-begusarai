# Production Release Checklist

## Release Baseline
- Branch: production-hardening
- Commit: 286eaa32a30649ba99b1ff34ca583550da5dfb02
- Working tree: modified/untracked; no reset performed.

## Database Safety
- Backup required before any migration.
- No production migration applied.
- Pending assignment uniqueness migration remains blocked by duplicate active records.

## Test Evidence
- Customer receipts PostgreSQL: 4/4 passed.
- Vendor payments PostgreSQL: 2/2 passed.
- Money engine: 10/10 passed.
- Customer payment recording: 7/7 passed.
- Petrol pump ledger: 26/26 passed.
- HTTP auth: 30/30 passed.
- Frontend build: succeeded.
- Migration lint: passed.

## Known Risks
- Assignment uniqueness migration unresolved.
- Advances, settlements, pump and reversal paths need deeper PostgreSQL evidence.
- Legacy Float monetary columns remain.

## Deployment Status
- Not deployed.
- No production migration applied.

## Rollback
- Restore database from verified backup if migration or deployment fails.
- Revert application deployment to previous commit.

## Verdict
NOT READY FOR PRODUCTION DEPLOYMENT
