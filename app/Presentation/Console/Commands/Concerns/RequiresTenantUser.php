<?php

namespace App\Presentation\Console\Commands\Concerns;

use App\Models\User;
use Illuminate\Support\Facades\Auth;

trait RequiresTenantUser
{
    /**
     * Require --user=<id>, login as that tenant, return user id (or 0 on failure after printing error).
     */
    protected function requireTenantUser(?string $optionName = 'user'): int
    {
        $raw = $this->option($optionName);
        // Back-compat: some commands historically used --user-id
        if (($raw === null || $raw === '') && $optionName === 'user' && $this->hasOption('user-id')) {
            $raw = $this->option('user-id');
        }

        $userId = (int) ($raw ?: 0);
        if ($userId <= 0) {
            $this->error('Required: --user=<inventory_user_id> (tenant that owns the settlements/orders).');

            return 0;
        }

        $user = User::query()->find($userId);
        if (! $user) {
            $this->error("User #{$userId} not found.");

            return 0;
        }

        Auth::loginUsingId($userId);

        return $userId;
    }
}
