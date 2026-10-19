<?php

use App\Models\User;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\Customer;
use App\Domain\Models\Wms\InventoryOrder;

/**
 * Regression: the Customers page KPI cards summed only the visible page (50 rows),
 * and a real shop credit customer named "Gnt" was hidden as if it were a marketplace
 * Guest placeholder — so its dues never reached the cards or the treasury snapshot.
 */
function seedReceivablesCustomer(User $user, Channel $channel, string $name, float $total, float $paid): Customer
{
    $customer = Customer::query()->create(['name' => $name, 'is_active' => true]);
    $customer->update(['user_id' => $user->id]);

    $order = InventoryOrder::query()->create([
        'platform_order_id' => 'SHOP-'.uniqid(),
        'channel_id' => $channel->id,
        'customer_id' => $customer->id,
        'customer_name' => $name,
        'status' => 'pending',
        'order_date' => now(),
        'currency' => 'EGP',
        'total_amount' => $total,
        'paid_amount' => $paid,
        'remaining_amount' => $total - $paid,
    ]);
    $order->update(['user_id' => $user->id]);

    return $customer;
}

function seedReceivablesFixture(User $user): void
{
    $channel = Channel::query()->create([
        'name' => 'Shop',
        'slug' => 'shop-'.uniqid(),
        'type' => 'store',
        'is_active' => true,
    ]);
    $channel->update(['user_id' => $user->id]);

    seedReceivablesCustomer($user, $channel, 'Gnt', 1000, 400);       // owes 600
    seedReceivablesCustomer($user, $channel, 'Clinic A', 500, 0);     // owes 500
    seedReceivablesCustomer($user, $channel, 'Clinic B', 300, 300);   // settled
    seedReceivablesCustomer($user, $channel, 'Guest', 9999, 0);       // marketplace placeholder
}

it('shows Gnt as a real customer and aggregates totals across all pages', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    seedReceivablesFixture($user);

    $res = $this->getJson('/api/inventory/customers/paginated-with-summary?per_page=1&page=1')
        ->assertOk()
        ->json();

    expect($res['data'])->toHaveCount(1)
        ->and($res['data'][0]['name'])->toBe('Gnt') // highest outstanding first
        ->and($res['meta']['total'])->toBe(3)
        ->and($res['meta']['totals']['receivable'])->toEqual(1100)
        ->and($res['meta']['totals']['total_sales'])->toEqual(1800)
        ->and($res['meta']['totals']['invoice_count'])->toBe(3)
        ->and($res['meta']['totals']['customers_owing'])->toBe(2);
});

it('returns the same totals from receivables-summary and excludes Guest placeholders', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    seedReceivablesFixture($user);

    $totals = $this->getJson('/api/inventory/customers/receivables-summary')->assertOk()->json();

    expect($totals['receivable'])->toEqual(1100)
        ->and($totals['customers'])->toBe(3);

    $guestSearch = $this->getJson('/api/inventory/customers/paginated-with-summary?search=guest')->assertOk()->json();
    expect($guestSearch['meta']['total'])->toBe(1);
});
