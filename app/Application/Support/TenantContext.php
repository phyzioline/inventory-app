<?php

namespace App\Application\Support;

use App\Domain\Models\Wms\TenantMembership;
use App\Models\User;
use Illuminate\Support\Facades\Auth;

/**
 * Resolves the effective tenant owner id for data isolation.
 * Owners: Auth::id(). Staff members: tenant_user_id from membership.
 */
final class TenantContext
{
    private static ?int $overrideTenantId = null;

    /** @var array{tenant_id: int, role: string}|null */
    private static ?array $resolved = null;

    private static ?int $resolvedForUserId = null;

    public static function setOverride(?int $tenantUserId): void
    {
        self::$overrideTenantId = $tenantUserId;
        self::$resolved = null;
        self::$resolvedForUserId = null;
    }

    public static function clearOverride(): void
    {
        self::$overrideTenantId = null;
        self::$resolved = null;
        self::$resolvedForUserId = null;
    }

    public static function flush(): void
    {
        self::$resolved = null;
        self::$resolvedForUserId = null;
    }

    /**
     * @return array{tenant_id: int, role: string}|null
     */
    private static function resolve(): ?array
    {
        if (self::$overrideTenantId !== null) {
            if (self::$overrideTenantId <= 0) {
                return null;
            }

            return ['tenant_id' => self::$overrideTenantId, 'role' => 'owner'];
        }

        if (! Auth::check()) {
            return null;
        }

        /** @var User $user */
        $user = Auth::user();
        $uid = (int) $user->id;

        if (self::$resolved !== null && self::$resolvedForUserId === $uid) {
            return self::$resolved;
        }

        if (! \Illuminate\Support\Facades\Schema::hasTable('tenant_memberships')) {
            self::$resolvedForUserId = $uid;
            self::$resolved = ['tenant_id' => $uid, 'role' => 'owner'];

            return self::$resolved;
        }

        $membership = TenantMembership::query()
            ->where('member_user_id', $uid)
            ->whereNotNull('accepted_at')
            ->orderByDesc('id')
            ->first();

        self::$resolvedForUserId = $uid;
        self::$resolved = $membership
            ? ['tenant_id' => (int) $membership->tenant_user_id, 'role' => (string) $membership->role]
            : ['tenant_id' => $uid, 'role' => 'owner'];

        return self::$resolved;
    }

    public static function id(): ?int
    {
        $resolved = self::resolve();

        return $resolved['tenant_id'] ?? null;
    }

    public static function role(): string
    {
        $resolved = self::resolve();

        return $resolved['role'] ?? 'viewer';
    }
}
