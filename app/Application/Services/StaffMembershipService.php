<?php

namespace App\Application\Services;

use App\Application\Support\TenantContext;
use App\Domain\Models\Wms\TenantMembership;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class StaffMembershipService
{
    public function __construct(
        private readonly InventoryAbilityService $abilities,
    ) {}

    /**
     * @return list<array<string, mixed>>
     */
    public function listForTenant(): array
    {
        $this->abilities->assertCan('staff.manage');
        $tenantId = (int) TenantContext::id();

        return TenantMembership::query()
            ->with('member:id,name,email')
            ->where('tenant_user_id', $tenantId)
            ->orderByDesc('id')
            ->get()
            ->map(fn (TenantMembership $m) => [
                'id' => $m->id,
                'role' => $m->role,
                'invited_at' => optional($m->invited_at)?->toIso8601String(),
                'accepted_at' => optional($m->accepted_at)?->toIso8601String(),
                'member' => [
                    'id' => $m->member?->id,
                    'name' => $m->member?->name,
                    'email' => $m->member?->email,
                ],
            ])
            ->all();
    }

    /**
     * Invite or create a staff user under the current tenant.
     *
     * @return array{membership: TenantMembership, temporary_password: ?string}
     */
    public function invite(string $email, string $name, string $role): array
    {
        $this->abilities->assertCan('staff.manage');
        $tenantId = (int) TenantContext::id();

        if (! in_array($role, ['manager', 'warehouse', 'accountant', 'viewer'], true)) {
            throw ValidationException::withMessages(['role' => ['Invalid role.']]);
        }

        // Only the tenant owner (or manager with staff.manage) may invite — never nest under staff's own id.
        if (TenantContext::role() === 'viewer') {
            abort(403);
        }

        $email = strtolower(trim($email));
        $temporaryPassword = null;

        return DB::transaction(function () use ($email, $name, $role, $tenantId, &$temporaryPassword) {
            $member = User::query()->whereRaw('LOWER(email) = ?', [$email])->first();
            if (! $member) {
                $temporaryPassword = Str::password(12);
                $member = User::create([
                    'name' => $name !== '' ? $name : strtok($email, '@'),
                    'email' => $email,
                    'password' => Hash::make($temporaryPassword),
                ]);
            }

            if ((int) $member->id === $tenantId) {
                throw ValidationException::withMessages(['email' => ['Cannot invite the tenant owner as staff.']]);
            }

            $existing = TenantMembership::withTrashed()
                ->where('tenant_user_id', $tenantId)
                ->where('member_user_id', $member->id)
                ->first();

            if ($existing) {
                if ($existing->trashed()) {
                    $existing->restore();
                }
                $existing->fill([
                    'role' => $role,
                    'invited_at' => now(),
                    'accepted_at' => now(),
                ])->save();
                $membership = $existing;
            } else {
                $membership = TenantMembership::create([
                    'tenant_user_id' => $tenantId,
                    'member_user_id' => $member->id,
                    'role' => $role,
                    'invited_at' => now(),
                    'accepted_at' => now(),
                ]);
            }

            return [
                'membership' => $membership->load('member:id,name,email'),
                'temporary_password' => $temporaryPassword,
            ];
        });
    }

    public function updateRole(int $membershipId, string $role): TenantMembership
    {
        $this->abilities->assertCan('staff.manage');
        $tenantId = (int) TenantContext::id();

        if (! in_array($role, ['manager', 'warehouse', 'accountant', 'viewer'], true)) {
            throw ValidationException::withMessages(['role' => ['Invalid role.']]);
        }

        $membership = TenantMembership::query()
            ->where('tenant_user_id', $tenantId)
            ->whereKey($membershipId)
            ->firstOrFail();

        $membership->update(['role' => $role]);

        return $membership->fresh('member:id,name,email');
    }

    public function revoke(int $membershipId): void
    {
        $this->abilities->assertCan('staff.manage');
        $tenantId = (int) TenantContext::id();

        $membership = TenantMembership::query()
            ->where('tenant_user_id', $tenantId)
            ->whereKey($membershipId)
            ->firstOrFail();

        $membership->delete();
        TenantContext::flush();
    }
}
