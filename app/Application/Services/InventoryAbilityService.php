<?php

namespace App\Application\Services;

use App\Application\Support\TenantContext;
use App\Models\User;

class InventoryAbilityService
{
    /** @var array<string, list<string>> */
    public const ROLE_ABILITIES = [
        'owner' => ['*'],
        'manager' => [
            'stock.read', 'stock.write', 'transfers.write', 'adjustments.write',
            'marketplace.import', 'marketplace.rollback',
            'purchases.write', 'purchases.receive', 'returns.write',
            'orders.cancel', 'finance.read', 'reports.read', 'staff.manage',
        ],
        'warehouse' => [
            'stock.read', 'stock.write', 'transfers.write', 'adjustments.write',
            'purchases.receive', 'finance.read', 'reports.read',
        ],
        'accountant' => [
            'stock.read', 'finance.read', 'finance.write', 'settlements.write',
            'withdrawal.approve', 'reports.read',
        ],
        'viewer' => [
            'stock.read', 'finance.read', 'reports.read',
        ],
    ];

    public function roleFor(?User $user = null): string
    {
        if ($user === null) {
            return TenantContext::role();
        }

        // When checking another user context, temporarily N/A — callers use TenantContext.
        return TenantContext::role();
    }

    /**
     * @return list<string>
     */
    public function abilitiesForRole(string $role): array
    {
        return self::ROLE_ABILITIES[$role] ?? self::ROLE_ABILITIES['viewer'];
    }

    /**
     * @return list<string>
     */
    public function abilities(): array
    {
        return $this->abilitiesForRole($this->roleFor());
    }

    public function can(string $ability): bool
    {
        $abilities = $this->abilities();
        if (in_array('*', $abilities, true)) {
            return true;
        }

        return in_array($ability, $abilities, true);
    }

    public function assertCan(string $ability): void
    {
        if (! $this->can($ability)) {
            abort(403, 'Missing ability: '.$ability);
        }
    }
}
