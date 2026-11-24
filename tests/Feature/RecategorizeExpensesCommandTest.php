<?php

use App\Domain\Models\Wms\Expense;
use App\Domain\Models\Wms\InventoryAuditLog;
use App\Models\User;

it('moves chosen expenses to salaries only with --apply, keeping amount and date, audited', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    $e = Expense::query()->create(['expense_number' => 'EXP-T-'.uniqid(), 'category' => 'general', 'type' => 'general', 'amount' => 600,
        'vendor_name' => 'نور', 'description' => 'مرتب', 'expense_date' => '2026-03-02', 'user_id' => $user->id]);

    $this->artisan('inventory:recategorize-expenses', ['--user' => $user->id, '--ids' => (string) $e->id, '--category' => 'salaries'])->assertSuccessful();
    expect($e->fresh()->category)->toBe('general');

    $this->artisan('inventory:recategorize-expenses', ['--user' => $user->id, '--ids' => (string) $e->id, '--category' => 'salaries', '--apply' => true])->assertSuccessful();
    $fresh = $e->fresh();
    expect($fresh->category)->toBe('salaries')
        ->and((float) $fresh->amount)->toBe(600.0)
        ->and(substr((string) $fresh->expense_date, 0, 10))->toBe('2026-03-02')
        ->and(InventoryAuditLog::where('action', 'expense.recategorized')->count())->toBe(1);
});
