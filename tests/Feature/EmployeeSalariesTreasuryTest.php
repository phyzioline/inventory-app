<?php

use App\Application\Services\TreasurySpendGuard;
use App\Domain\Models\Wms\CapitalSource;
use App\Domain\Models\Wms\Employee;
use App\Domain\Models\Wms\Expense;
use App\Domain\Models\Wms\Receipt;
use App\Models\User;

it('creates employees and imports salary beneficiaries from expenses', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    $this->postJson('/api/inventory/employees', [
        'name' => 'محمود',
        'base_salary' => 2600,
        'job_title' => 'موظف',
    ])->assertCreated()
        ->assertJsonPath('name', 'محمود');

    Expense::query()->create([
        'expense_number' => 'EXP-SAL-1',
        'type' => 'salaries',
        'category' => 'salaries',
        'amount' => 1000,
        'expense_date' => now()->toDateString(),
        'vendor_name' => 'مصطفي',
        'payment_method' => 'cash',
        'user_id' => $user->id,
    ]);

    $this->postJson('/api/inventory/employees/import-from-expenses')
        ->assertSuccessful()
        ->assertJsonPath('created', 1);

    expect(Employee::query()->where('name', 'مصطفي')->exists())->toBeTrue()
        ->and(Employee::query()->count())->toBe(2);
});

it('deducts salary expense from treasury via ExpenseController', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    CapitalSource::query()->create([
        'name' => 'Seed Capital',
        'type' => 'owner',
        'amount' => 10000,
        'ownership_percentage' => 100,
        'user_id' => $user->id,
    ]);

    Receipt::query()->create([
        'receipt_number' => 'RCPT-SAL-1',
        'type' => 'capital',
        'amount' => 10000,
        'receipt_date' => now()->toDateString(),
        'user_id' => $user->id,
    ]);

    $guard = app(TreasurySpendGuard::class);
    $before = $guard->availableCashForUser((int) $user->id);

    $response = $this->postJson('/api/inventory/expenses', [
        'category' => 'salaries',
        'amount' => 2600,
        'expense_date' => now()->toDateString(),
        'payment_method' => 'cash',
        'vendor_name' => 'محمود',
        'description' => 'راتب يونيو',
    ]);

    $response->assertCreated()
        ->assertJsonPath('category', 'salaries')
        ->assertJsonPath('vendor_name', 'محمود');

    $after = $guard->availableCashForUser((int) $user->id);

    expect($after)->toBe(round($before - 2600, 2))
        ->and(Expense::query()->where('category', 'salaries')->count())->toBe(1);
});

it('rejects salary expense when treasury balance is insufficient', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    CapitalSource::query()->create([
        'name' => 'Tiny Capital',
        'type' => 'owner',
        'amount' => 100,
        'ownership_percentage' => 100,
        'user_id' => $user->id,
    ]);

    Receipt::query()->create([
        'receipt_number' => 'RCPT-SAL-LOW',
        'type' => 'capital',
        'amount' => 100,
        'receipt_date' => now()->toDateString(),
        'user_id' => $user->id,
    ]);

    $this->postJson('/api/inventory/expenses', [
        'category' => 'salaries',
        'amount' => 5000,
        'expense_date' => now()->toDateString(),
        'payment_method' => 'cash',
        'vendor_name' => 'محمود',
    ])->assertStatus(422);
});
