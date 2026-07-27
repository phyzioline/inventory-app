<?php

namespace Database\Seeders;

use App\Domain\Models\SubscriptionPlan;
use Illuminate\Database\Seeder;

class SubscriptionPlansSeeder extends Seeder
{
    public function run(): void
    {
        // Cheap launch pricing (EGP) — demo-friendly for Paymob live checkout.
        SubscriptionPlan::query()->updateOrCreate(
            ['plan_code' => 'free'],
            [
                'name' => 'مجاني',
                'price_monthly' => 0,
                'price_yearly' => 0,
                'features' => [
                    'support' => 'community',
                    'label_en' => 'Free',
                ],
                'limits' => [
                    'warehouses' => 1,
                    'channels' => 2,
                    'monthly_orders' => 200,
                ],
                'is_active' => true,
                'sort_order' => 1,
            ]
        );

        SubscriptionPlan::query()->updateOrCreate(
            ['plan_code' => 'starter'],
            [
                'name' => 'أساسي',
                'price_monthly' => 49,
                'price_yearly' => 490,
                'features' => [
                    'support' => 'email',
                    'label_en' => 'Starter',
                ],
                'limits' => [
                    'warehouses' => 3,
                    'channels' => 5,
                    'monthly_orders' => 2000,
                ],
                'is_active' => true,
                'sort_order' => 2,
            ]
        );

        SubscriptionPlan::query()->updateOrCreate(
            ['plan_code' => 'pro'],
            [
                'name' => 'احترافي',
                'price_monthly' => 149,
                'price_yearly' => 1490,
                'features' => [
                    'support' => 'priority',
                    'label_en' => 'Pro',
                ],
                'limits' => [
                    'warehouses' => null,
                    'channels' => null,
                    'monthly_orders' => null,
                ],
                'is_active' => true,
                'sort_order' => 3,
            ]
        );
    }
}
