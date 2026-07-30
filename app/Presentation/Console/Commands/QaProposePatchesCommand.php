<?php

namespace App\Presentation\Console\Commands;

use Illuminate\Console\Command;

/**
 * Phase 2 helper: propose Pest stubs / patch checklist from the executive scorecard.
 * Does NOT auto-open PRs — prints a human-reviewable plan.
 */
class QaProposePatchesCommand extends Command
{
    protected $signature = 'inventory:qa-propose-patches
                            {--write-stubs : Write missing Pest stub files under tests/Feature/Proposed}';

    protected $description = 'Phase 2: propose tests/patches from QA scorecard (human review before PR)';

    /** @var list<array{id: string, title: string, pest?: string, priority: string}> */
    private array $openItems = [
        [
            'id' => 'P2-AUDIT-EXPAND',
            'title' => 'Expand audit log to invoice financial edits',
            'pest' => 'InvoiceFinancialEditAuditTest',
            'priority' => 'Next',
        ],
        [
            'id' => 'P2-IDOR-WRITES',
            'title' => 'Sample write-path IDOR for PUT/DELETE channels',
            'pest' => 'ChannelWriteIdorTest',
            'priority' => 'Next',
        ],
        [
            'id' => 'P2-VALUATION-UX',
            'title' => 'Valuation method switch UX + regression Pest',
            'pest' => 'InventoryValuationMethodTest',
            'priority' => 'Later',
        ],
        [
            'id' => 'P2-LOT-SERIAL-UI',
            'title' => 'Lot/serial end-to-end UI + API',
            'pest' => 'LotSerialTrackingTest',
            'priority' => 'Later',
        ],
    ];

    public function handle(): int
    {
        $this->info('Phase 2 — proposed patches (review before any PR)');
        $this->newLine();
        $this->line('Already shipped recently: Paymob HMAC Pest, LowStockAlertService, broader audit logs.');
        $this->newLine();

        foreach ($this->openItems as $item) {
            $this->line(sprintf(
                '[%s] %s — %s%s',
                $item['priority'],
                $item['id'],
                $item['title'],
                isset($item['pest']) ? " → tests/Feature/Proposed/{$item['pest']}.php" : ''
            ));
        }

        if ($this->option('write-stubs')) {
            $dir = base_path('tests/Feature/Proposed');
            if (! is_dir($dir)) {
                mkdir($dir, 0755, true);
            }
            foreach ($this->openItems as $item) {
                if (empty($item['pest'])) {
                    continue;
                }
                $path = $dir.'/'.$item['pest'].'.php';
                if (is_file($path)) {
                    $this->warn("Skip existing: {$path}");
                    continue;
                }
                file_put_contents($path, $this->stubContents($item));
                $this->info("Wrote stub: {$path}");
            }
        }

        $this->newLine();
        $this->comment('Next human steps: review stubs → implement → Pest on phyzioline_inventory_test → open PR.');

        return self::SUCCESS;
    }

    /**
     * @param  array{id: string, title: string, pest?: string, priority: string}  $item
     */
    private function stubContents(array $item): string
    {
        $name = $item['pest'] ?? 'ProposedTest';
        $title = addslashes($item['title']);

        return <<<PHP
<?php

/**
 * Phase 2 stub — {$item['id']}: {$title}
 * Fill in assertions, then move out of Proposed/ when green.
 */
it('todo: {$name}', function () {
    \$this->markTestIncomplete('Phase 2 stub — implement after human review.');
});

PHP;
    }
}
