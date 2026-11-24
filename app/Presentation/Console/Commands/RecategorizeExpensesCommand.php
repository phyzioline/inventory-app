<?php

namespace App\Presentation\Console\Commands;

use App\Application\Services\InventoryAuditLogService;
use App\Domain\Models\Wms\Expense;
use App\Presentation\Console\Commands\Concerns\RequiresTenantUser;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Move named expenses to another category (e.g. staff payments booked as "general" → salaries).
 * Amount, date and account stay as they are, so totals and treasury do not move — only the category.
 */
class RecategorizeExpensesCommand extends Command
{
    use RequiresTenantUser;

    protected $signature = 'inventory:recategorize-expenses
                            {--user= : Inventory user_id (tenant) — required}
                            {--ids= : Comma-separated expense ids}
                            {--category= : Target category, e.g. salaries}
                            {--apply : Write the change (default is a dry run)}';

    protected $description = 'Change the category of chosen expenses (amount, date and account unchanged), audited.';

    public function handle(InventoryAuditLogService $audit): int
    {
        $userId = $this->requireTenantUser();
        if ($userId <= 0) {
            return self::FAILURE;
        }
        $ids = array_values(array_filter(array_map('intval', explode(',', (string) $this->option('ids')))));
        $category = trim((string) $this->option('category'));
        if ($ids === [] || $category === '') {
            $this->error('Required: --ids=1,2,3 --category=salaries');

            return self::FAILURE;
        }

        $rows = Expense::query()->where('user_id', $userId)->whereIn('id', $ids)->orderBy('expense_date')->get();
        $missing = array_diff($ids, $rows->pluck('id')->all());
        if ($missing !== []) {
            $this->error('Not found for this user: '.implode(',', $missing));

            return self::FAILURE;
        }

        $this->table(['ID', 'Date', 'Amount', 'Name', 'Description', 'From', 'To'], $rows->map(fn ($e) => [
            $e->id, substr((string) $e->expense_date, 0, 10), $e->amount, $e->vendor_name, mb_substr((string) $e->description, 0, 40),
            $e->category.'/'.$e->type, $category,
        ])->all());

        if (! $this->option('apply')) {
            $this->warn('Dry run — nothing changed. Re-run with --apply.');

            return self::SUCCESS;
        }

        DB::transaction(function () use ($rows, $category, $audit) {
            $audit->record('expense.recategorized', null, null, [
                'category' => $category,
                'original' => $rows->map(fn ($e) => $e->getAttributes())->values()->all(),
            ]);
            Expense::query()->whereIn('id', $rows->pluck('id'))->update(['category' => $category, 'type' => $category]);
        });
        $this->info("Moved {$rows->count()} expenses to {$category} (audit: expense.recategorized).");

        return self::SUCCESS;
    }
}
