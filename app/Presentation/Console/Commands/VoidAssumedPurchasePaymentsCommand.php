<?php

namespace App\Presentation\Console\Commands;

use App\Application\Services\AssumedPurchasePaymentCorrectionService;
use App\Presentation\Console\Commands\Concerns\RequiresTenantUser;
use Illuminate\Console\Command;
use Illuminate\Support\Collection;

class VoidAssumedPurchasePaymentsCommand extends Command
{
    use RequiresTenantUser;

    protected $signature = 'inventory:void-assumed-purchase-payments
                            {--user= : Inventory user_id (tenant) — required}
                            {--supplier=* : Only these supplier names, exactly as the table shows them (repeatable)}
                            {--paid-in-full : Owner confirmed these cash invoices were paid in full: set paid = invoice total, void nothing, post any amount missing from treasury on the invoice date}
                            {--apply : Write the correction (default is a dry run)}';

    protected $description = 'Void automatic treasury payments posted for more than the amount entered as paid on cash purchase invoices.';

    public function handle(AssumedPurchasePaymentCorrectionService $service): int
    {
        $userId = $this->requireTenantUser();
        if ($userId <= 0) {
            return self::FAILURE;
        }

        $paidInFull = (bool) $this->option('paid-in-full');
        $suppliers = (array) $this->option('supplier');
        if ($paidInFull && $suppliers === []) {
            $this->error('--paid-in-full needs --supplier=<name>: confirm each supplier explicitly.');

            return self::FAILURE;
        }

        $rows = $service->findExcess($userId, $suppliers);
        if ($paidInFull) {
            $unposted = $service->findUnpostedPaidInFull($userId, $suppliers);
            $unpostedIds = $unposted->pluck('batch_id')->all();
            $rows = $rows->reject(fn (array $row) => in_array($row['batch_id'], $unpostedIds, true))->values();
            if ($rows->isEmpty() && $unposted->isEmpty()) {
                $this->info('Nothing to confirm: every cash invoice of these suppliers is paid in full and posted.');

                return self::SUCCESS;
            }

            return $this->confirmPaidInFull($service, $userId, $rows, $unposted);
        }

        if ($rows->isEmpty()) {
            $this->info('No automatic purchase payments above the entered paid amount.');

            return self::SUCCESS;
        }

        $this->table(
            ['Supplier', 'Invoices', 'Invoice total', 'Entered paid', 'Auto posted', 'Excess'],
            $rows->groupBy('payee')->map(fn ($g, $payee) => [
                $payee ?: '—',
                $g->count(),
                number_format($g->sum('total'), 2),
                number_format($g->sum('entered_paid'), 2),
                number_format($g->sum('auto_paid'), 2),
                number_format($g->sum('excess'), 2),
            ])->sortByDesc(fn ($r) => (float) str_replace(',', '', $r[5]))->values()->all()
        );
        $this->line(sprintf(
            'Total: %d invoices, %s EGP posted automatically, %s EGP entered as paid, %s EGP excess.',
            $rows->count(),
            number_format($rows->sum('auto_paid'), 2),
            number_format($rows->sum('entered_paid'), 2),
            number_format($rows->sum('excess'), 2)
        ));

        if (! $this->option('apply')) {
            $this->warn('Dry run — take a backup (backup_inventory_pgsql.sh), then re-run with --apply.');

            return self::SUCCESS;
        }

        $result = $service->apply($userId, $rows);
        $this->info(sprintf(
            'Corrected %d invoices: voided %d payments (%s EGP), posted %d entered-amount payments; %s EGP no longer counted as paid (audit: %s).',
            $result['batches'],
            $result['voided_payments'],
            number_format($result['voided_amount'], 2),
            $result['replacement_payments'],
            number_format($result['excess_removed'], 2),
            AssumedPurchasePaymentCorrectionService::AUDIT_ACTION
        ));

        return self::SUCCESS;
    }

    private function confirmPaidInFull(AssumedPurchasePaymentCorrectionService $service, int $userId, Collection $rows, Collection $unposted): int
    {
        $notesChange = $rows->filter(fn (array $row) => $row['entered_paid'] < $row['total'] - 0.009);
        $aboveTotal = $rows->filter(fn (array $row) => $row['auto_paid'] > $row['total'] + 0.009);

        $this->line(sprintf(
            'Paid in full: %d invoices confirmed; %d get paid = invoice total (+%s EGP recorded as paid). No payment is voided.',
            $rows->count(),
            $notesChange->count(),
            number_format($notesChange->sum(fn (array $row) => $row['total'] - $row['entered_paid']), 2)
        ));
        if ($aboveTotal->isNotEmpty()) {
            $this->warn(sprintf('%d invoices were paid above the invoice total; the payment is kept as confirmed:', $aboveTotal->count()));
            $this->table(
                ['Batch', 'Invoice', 'Invoice total', 'Paid', 'Above total'],
                $aboveTotal->map(fn (array $row) => [
                    $row['batch_id'],
                    $row['invoice'],
                    number_format($row['total'], 2),
                    number_format($row['auto_paid'], 2),
                    number_format($row['auto_paid'] - $row['total'], 2),
                ])->values()->all()
            );
        }
        if ($unposted->isNotEmpty()) {
            $this->warn(sprintf(
                '%d cash invoices have less in treasury than their total: %s EGP will be posted as cash paid on each invoice date.',
                $unposted->count(),
                number_format($unposted->sum('shortfall'), 2)
            ));
            $this->table(
                ['Supplier', 'Batch', 'Invoice', 'Date', 'Invoice total', 'In treasury', 'To post'],
                $unposted->map(fn (array $row) => [
                    $row['payee'],
                    $row['batch_id'],
                    $row['invoice'],
                    $row['date'] ?? '—',
                    number_format($row['total'], 2),
                    number_format($row['posted'], 2),
                    number_format($row['shortfall'], 2),
                ])->values()->all()
            );
        }

        if (! $this->option('apply')) {
            $this->warn('Dry run — take a backup (backup_inventory_pgsql.sh), then re-run with --apply.');

            return self::SUCCESS;
        }

        $result = $service->confirmPaidInFull($userId, $rows);
        $this->info(sprintf(
            'Confirmed %d invoices as paid in full (+%s EGP recorded as paid; audit: %s).',
            $result['batches'],
            number_format($result['amount_confirmed'], 2),
            AssumedPurchasePaymentCorrectionService::AUDIT_ACTION_PAID_IN_FULL
        ));
        if ($unposted->isNotEmpty()) {
            $posted = $service->postMissingPaidInFull($userId, $unposted);
            $this->info(sprintf(
                'Posted %d treasury payments on their invoice dates (%s EGP, payments #%s).',
                $posted['batches'],
                number_format($posted['amount_posted'], 2),
                implode(', #', $posted['payment_ids'])
            ));
        }

        return self::SUCCESS;
    }
}
