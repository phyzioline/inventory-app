<?php

declare(strict_types=1);

namespace App\Application\Services;

use App\Domain\Models\Wms\PurchaseBatch;
use App\Domain\Models\Wms\PurchaseReturn;
use App\Domain\Models\Wms\Supplier;
use App\Domain\Models\Wms\Vendor;
use App\Domain\ValueObjects\PurchasePaymentMeta;
use Illuminate\Support\Facades\DB;

/**
 * Brings a supplier account to the balance on the supplier's own statement, when the owner has agreed
 * that figure with the supplier and the difference cannot be traced to a missing invoice or payment.
 *
 * The difference is posted as one explicit, labelled line — never by editing invoices or payments:
 * - system above statement → a credit note (PurchaseReturn, refund_method credit_note, no items):
 *   no stock movement and no treasury receipt;
 * - system below statement → an adjustment purchase invoice with no items, open on credit:
 *   no stock movement and no treasury payment.
 * Both carry {@see REASON}, show on the supplier statement as a reconciliation line, and are audited.
 */
class SupplierStatementReconciliationService
{
    public const REASON = 'supplier_statement_reconciliation';

    public const AUDIT_ACTION = 'suppliers.statement_reconciled';

    public function __construct(private readonly PurchaseImportService $purchases) {}

    /**
     * @return array{kind: string, amount: float, purchase_return_id: ?int, purchase_batch_id: ?int}
     */
    public function reconcile(int $userId, Supplier $supplier, Vendor $vendor, float $systemOutstanding, float $statementBalance, string $date, string $note): array
    {
        $gap = round($systemOutstanding - $statementBalance, 2);
        if (abs($gap) < 0.01) {
            return ['kind' => 'none', 'amount' => 0.0, 'purchase_return_id' => null, 'purchase_batch_id' => null];
        }

        return DB::transaction(function () use ($userId, $supplier, $vendor, $systemOutstanding, $statementBalance, $date, $note, $gap) {
            $label = trim('Supplier statement reconciliation: statement '.number_format($statementBalance, 2, '.', '')
                .', system '.number_format($systemOutstanding, 2, '.', '').'. '.$note);
            $result = ['kind' => '', 'amount' => abs($gap), 'purchase_return_id' => null, 'purchase_batch_id' => null];

            // Latest invoice of this supplier: the credit note hangs on it; the adjustment invoice copies its currency/location.
            $anchor = PurchaseBatch::withoutGlobalScopes()
                ->where('user_id', $userId)
                ->where('vendor_id', $vendor->id)
                ->where('status', '!=', 'cancelled')
                ->orderByDesc('invoice_date')
                ->orderByDesc('id')
                ->firstOrFail();

            if ($gap > 0) {
                $return = PurchaseReturn::query()->create([
                    'user_id' => $userId,
                    'purchase_batch_id' => (int) $anchor->id,
                    'vendor_id' => (int) $vendor->id,
                    'supplier_id' => (int) $supplier->id,
                    'location_id' => $anchor->location_id,
                    'return_number' => PurchaseReturn::generateReturnNumber(),
                    'return_date' => $date,
                    'reason' => self::REASON,
                    'refund_method' => 'credit_note',
                    'subtotal' => $gap,
                    'tax_amount' => 0,
                    'grand_total' => $gap,
                    'currency' => (string) ($anchor->currency ?? 'EGP'),
                    'notes' => $label,
                    'balance_synced_at' => now(),
                ]);
                $this->purchases->adjustVendorPayableBalance((int) $vendor->id, -$gap);
                $result['kind'] = 'credit_note';
                $result['purchase_return_id'] = (int) $return->id;
            } else {
                $amount = abs($gap);
                $batch = PurchaseBatch::query()->create([
                    'batch_number' => 'STMT-'.$supplier->id.'-'.now()->format('YmdHis'),
                    'user_id' => $userId,
                    'vendor_id' => (int) $vendor->id,
                    'supplier_name_raw' => (string) $supplier->name,
                    'invoice_number' => 'STMT-'.$supplier->id.'-'.now()->format('Ymd'),
                    'invoice_date' => $date,
                    'location_id' => $anchor->location_id,
                    'currency' => (string) ($anchor->currency ?? 'EGP'),
                    'supplier_matched' => true,
                    'grand_total' => $amount,
                    'subtotal' => $amount,
                    'tax_amount' => 0,
                    'status' => 'received',
                    'notes' => PurchasePaymentMeta::writeToNotes($label."\n".self::REASON, 'credit', 0.0, $amount, 'confirmed'),
                ]);
                $this->purchases->adjustVendorPayableBalance((int) $vendor->id, $amount);
                $result['kind'] = 'adjustment_invoice';
                $result['purchase_batch_id'] = (int) $batch->id;
            }

            app(InventoryAuditLogService::class)->record(self::AUDIT_ACTION, Supplier::class, (int) $supplier->id, [
                'supplier' => (string) $supplier->name,
                'vendor_id' => (int) $vendor->id,
                'system_outstanding' => round($systemOutstanding, 2),
                'statement_balance' => round($statementBalance, 2),
                'difference' => $gap,
                'date' => $date,
                'note' => $note,
            ] + $result);

            return $result;
        });
    }

    public static function isReconciliationNote(?string $text): bool
    {
        return str_contains((string) $text, self::REASON);
    }
}
