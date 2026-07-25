<?php

namespace Database\Seeders;

use App\Domain\Models\SubscriptionPlan;
use Illuminate\Database\Seeder;

class SubscriptionPlansSeeder extends Seeder
{
    public function run(): void
    {
        SubscriptionPlan::query()->updateOrCreate(
            ['plan_code' => 'free'],
            [
                'name' => 'Free',
                'price_monthly' => 0,
                'price_yearly' => 0,
                'features' => ['support' => 'community'],
                'limits' => ['warehouses' => 1, 'channels' => 1, 'monthly_orders' => 100],
                'is_active' => true,
                'sort_order' => 1,
            ]
        );

        SubscriptionPlan::query()->updateOrCreate(
            ['plan_code' => 'pro'],
            [
                'name' => 'Pro',
                'price_monthly' => 499,
                'price_yearly' => 4990,
                'features' => ['support' => 'priority'],
                'limits' => ['warehouses' => null, 'channels' => null, 'monthly_orders' => null],
                'is_active' => true,
                'sort_order' => 2,
            ]
        );
    }
}
