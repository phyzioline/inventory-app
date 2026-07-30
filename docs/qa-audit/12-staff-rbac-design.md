# Staff RBAC design (Phase C6 — design only)

**Date:** 2026-07-30  
**Status:** Implemented (v1) — `tenant_memberships`, `TenantContext`, `InventoryAbilityService`, staff API + Settings tab, abilities on `/auth/me`

## Current model

- One Laravel `users` row ≈ one tenant (shop owner).
- Data isolation: `IsIsolatedByUser` global scope on WMS models.
- Authorization: `auth` middleware + `Gate::before` for `is_super_admin`.
- Phase B added ownership Gates for a few destructive actions; still no staff roles.

## Target model (Clean Architecture)

| Layer | Responsibility |
|-------|----------------|
| Domain | `TenantMembership` (user_id, tenant_owner_id, role), `Role`/`Permission` value objects |
| Application | `AuthorizeInventoryAction` service; map role → abilities |
| Infrastructure | Policies registered per model; optional Spatie-free custom tables |
| Presentation | Invite staff API + Settings UI; middleware `tenant.member` |
| SPA | Hide/disable actions by `abilities` from `/auth/me` |

## Proposed roles (v1)

| Role | Abilities |
|------|-----------|
| owner | All |
| manager | Stock, imports, purchases, returns; no capital withdrawals approve |
| warehouse | Transfers, adjustments, receive; read-only finance |
| accountant | Treasury, settlements, reports; no stock OUT import confirm |
| viewer | Read-only |

## Schema sketch

```text
tenant_memberships
  id, tenant_user_id (owner), member_user_id, role, invited_at, accepted_at, deleted_at

inventory_permissions (optional seed table)
  role, ability (e.g. marketplace.import.rollback)
```

Isolation shift: prefer `tenant_user_id` on rows over `user_id = Auth::id()` long-term (migration path: backfill `tenant_user_id = user_id`, scopes use membership).

## Out of scope for now

Invite UI, email invites, Amazon SP-API, lot/serial, cycle count — see `04-feature-gap.md`.
