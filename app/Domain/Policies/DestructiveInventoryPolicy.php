<?php

namespace App\Domain\Policies;

use App\Application\Services\InventoryAbilityService;
use App\Application\Support\TenantContext;
use App\Models\User;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\Settlement;
use App\Domain\Models\Wms\Withdrawal;

/**
 * Destructive-action authorization. Tenant isolation via TenantContext;
 * role abilities via InventoryAbilityService.
 */
class DestructiveInventoryPolicy
{
    public function cancelOrder(User $user, InventoryOrder $order): bool
    {
        return (int) $order->user_id === (int) TenantContext::id()
            && app(InventoryAbilityService::class)->can('orders.cancel');
    }

    public function approveWithdrawal(User $user, Withdrawal $withdrawal): bool
    {
        return (int) $withdrawal->user_id === (int) TenantContext::id()
            && app(InventoryAbilityService::class)->can('withdrawal.approve');
    }

    public function deleteSettlement(User $user, Settlement $settlement): bool
    {
        return (int) $settlement->user_id === (int) TenantContext::id()
            && app(InventoryAbilityService::class)->can('settlements.write');
    }

    public function rollbackMarketplaceImport(User $user): bool
    {
        return $user->id > 0
            && app(InventoryAbilityService::class)->can('marketplace.rollback');
    }
}
