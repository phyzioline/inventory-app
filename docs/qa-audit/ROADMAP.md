# QA & Audit Roadmap

## Done

### Audit reports
- [x] Agents 01–10 under `docs/qa-audit/`
- [x] Functional QA completed (scenario matrix + Pest) — `06`
- [x] API Testing completed (AuthN/AuthZ/IDOR/422) — `10`
- [x] Unified scorecard — `13-executive-scorecard.md`
- [x] Discovery refreshed post-implementation — `01`
- [x] Light CI DB safety workflow — `.github/workflows/inventory-qa-safety.yml`
- [x] 11-phase-b-notes.md / 12-staff-rbac-design.md (implemented)

### Phase A / B / C + Later backlog
- [x] P0 security/treasury/morph/idempotency
- [x] Async import job + SPA polling
- [x] Staff RBAC v1
- [x] Cycle count MVP, lot/serial columns, FBA/FBM pages
- [x] Form Requests (5)
- [x] Commit `c2afe15` (+ follow-up for this completion pass)

## Pest

Run only against `phyzioline_inventory_test`:

```bash
grep DB_DATABASE .env.testing phpunit.xml
./vendor/bin/pest
```

## Not done yet (Next / Later)

- [x] Phase 2 scaffolding (`14-phase-2.md`, `inventory:qa-propose-patches`) — no auto-PR
- [x] Paymob HMAC Pest
- [x] Low-stock alerts + reorder suggestion MVP
- [x] Broader audit log (pay / settlement delete / transfer / cycle post)
- [x] SPA production build (live under `public/app/`, gitignored)
- [ ] git push (ask explicitly)
- [ ] Remaining Phase 2 stubs (invoice audit, write IDOR, valuation UX, lot/serial)

## Operating rules

```bash
pwd && git remote -v
grep DB_DATABASE .env.testing phpunit.xml
# Never: migrate:fresh on phyzioline_inventory
```
