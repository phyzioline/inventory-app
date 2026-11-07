<?php

declare(strict_types=1);

namespace App\Application\Services;

use App\Domain\Models\Wms\Customer;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\Payment;
use App\Domain\Models\Wms\Receipt;
use App\Domain\Models\Wms\Supplier;
use App\Domain\ValueObjects\NonCashSettlementMethod;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Link supplier ↔ customer as one trading party and post explicit AP/AR set-off
 * without moving treasury cash.
 */
class PartyLinkService
{
    public function __construct(
        private readonly SupplierAccountService $supplierAccounts,
    ) {}

    public function link(Supplier $supplier, Customer $customer, bool $runSetOff = false): array
    {
        if ((int) ($supplier->linked_customer_id ?? 0) === (int) $customer->id) {
            $result = ['supplier' => $supplier->fresh(['linkedCustomer']), 'customer' => $customer, 'set_off' => null];
            if ($runSetOff) {
                $result['set_off'] = $this->setOff($supplier->fresh(), null);
            }

            return $result;
        }

        if ($supplier->linked_customer_id) {
            throw ValidationException::withMessages([
                'customer_id' => ['This supplier is already linked to another customer. Unlink first.'],
            ]);
        }

        $taken = Supplier::query()
            ->where('linked_customer_id', $customer->id)
            ->where('id', '!=', $supplier->id)
            ->exists();
        if ($taken) {
            throw ValidationException::withMessages([
                'customer_id' => ['This customer is already linked to another supplier.'],
            ]);
        }

        return DB::transaction(function () use ($supplier, $customer, $runSetOff) {
            $supplier->linked_customer_id = $customer->id;
            $supplier->save();

            app(InventoryAuditLogService::class)->record(
                'supplier.link_customer',
                Supplier::class,
                (int) $supplier->id,
                ['customer_id' => (int) $customer->id],
            );

            $setOff = null;
            if ($runSetOff) {
                $setOff = $this->setOff($supplier->fresh(), null);
            }

            return [
                'supplier' => $supplier->fresh(['linkedCustomer']),
                'customer' => $customer,
                'set_off' => $setOff,
            ];
        });
    }

    public function unlink(Supplier $supplier): Supplier
    {
        if (! $supplier->linked_customer_id) {
            return $supplier;
        }

        $customerId = (int) $supplier->linked_customer_id;
        $supplier->linked_customer_id = null;
        $supplier->save();

        app(InventoryAuditLogService::class)->record(
            'supplier.unlink_customer',
            Supplier::class,
            (int) $supplier->id,
            ['customer_id' => $customerId],
        );

        return $supplier->fresh();
    }

    /**
     * Net current-account position: positive = party owes us; negative = we owe the party.
     */
    public function netPosition(float $supplierPayable, float $customerReceivable): float
    {
        return round($customerReceivable - $supplierPayable, 2);
    }

    /**
     * Post matching set-off on supplier AP and customer AR. Amount defaults to min(AP, AR).
     *
     * @return array{amount: float, payment_id: int, receipt_id: int, reference: string}|null
     */
    public function setOff(Supplier $supplier, ?float $amount = null): ?array
    {
        $customerId = (int) ($supplier->linked_customer_id ?? 0);
        if ($customerId <= 0) {
            throw ValidationException::withMessages([
                'supplier' => ['Supplier is not linked to a customer.'],
            ]);
        }

        $customer = Customer::query()->findOrFail($customerId);
        $supplierSummary = $this->supplierAccounts->summarize($supplier, null, null, false);
        $payable = max(0.0, (float) ($supplierSummary['summary']['outstanding'] ?? 0));
        $receivable = $this->customerOutstanding($customer);

        $max = round(min($payable, $receivable), 2);
        if ($max < 0.01) {
            return null;
        }

        $apply = $amount === null ? $max : round((float) $amount, 2);
        if ($apply < 0.01) {
            throw ValidationException::withMessages([
                'amount' => ['Set-off amount must be at least 0.01.'],
            ]);
        }
        if ($apply > $max + 0.00001) {
            throw ValidationException::withMessages([
                'amount' => ['Set-off cannot exceed '.number_format($max, 2).' (min of payable and receivable).'],
            ]);
        }

        return DB::transaction(function () use ($supplier, $customer, $apply) {
            $userId = (int) (Auth::id() ?? 0);
            $ref = 'SETOFF-'.strtoupper(substr(md5((string) microtime(true).$supplier->id.$customer->id), 0, 10));
            $date = now()->toDateString();
            $notes = 'مقاصة حساب جاري / Party set-off '.$ref;

            $paymentNumber = $this->nextPaymentNumber();
            $payment = Payment::query()->create([
                'payment_number' => $paymentNumber,
                'payee_type' => Supplier::class,
                'payee_id' => $supplier->id,
                'payee_name' => $supplier->name,
                'amount' => $apply,
                'payment_method' => NonCashSettlementMethod::SET_OFF,
                'payment_date' => $date,
                'status' => 'completed',
                'notes' => $notes,
                'user_id' => $userId > 0 ? $userId : null,
                'finance_account_id' => null,
                'reference_type' => Customer::class,
                'reference_id' => $customer->id,
            ]);

            $supplier->balance = round((float) ($supplier->balance ?? 0) - $apply, 2);
            $supplier->save();
            $linkedVendor = $supplier->resolveLinkedVendor();
            if ($linkedVendor) {
                $linkedVendor->updateBalance($apply, 'subtract');
            }

            $this->applySetOffToCustomerOrders($customer, $apply);

            $receipt = Receipt::query()->create([
                'receipt_number' => app(ReceiptApplicationService::class)->generateNextReceiptNumber(),
                'type' => 'Customer Payment',
                'category' => 'customer_collection',
                'amount' => $apply,
                'description' => $notes,
                'receipt_date' => $date,
                'payment_method' => NonCashSettlementMethod::SET_OFF,
                'finance_account_id' => null,
                'reference_type' => Payment::class,
                'reference_id' => $payment->id,
                'external_reference' => $ref,
                'payer_name' => $customer->name,
                'user_id' => $userId > 0 ? $userId : null,
            ]);

            app(InventoryAuditLogService::class)->record(
                'party.set_off',
                Supplier::class,
                (int) $supplier->id,
                [
                    'customer_id' => (int) $customer->id,
                    'amount' => $apply,
                    'payment_id' => $payment->id,
                    'receipt_id' => $receipt->id,
                    'reference' => $ref,
                ],
            );

            return [
                'amount' => $apply,
                'payment_id' => (int) $payment->id,
                'receipt_id' => (int) $receipt->id,
                'reference' => $ref,
            ];
        });
    }

    /**
     * Reverse a party set-off payment (and its twin receipt). Restores supplier balance and
     * unwinds order paid_amount that this set-off applied. Idempotent if already cancelled.
     *
     * @return array{payment_id: int, receipt_id: int|null, amount: float}
     */
    public function reverseSetOff(Payment $payment): array
    {
        if (! NonCashSettlementMethod::isNonCash($payment->payment_method)) {
            throw ValidationException::withMessages([
                'payment' => ['Not a party set-off payment.'],
            ]);
        }
        if (strtolower((string) ($payment->status ?? '')) === 'cancelled') {
            return [
                'payment_id' => (int) $payment->id,
                'receipt_id' => null,
                'amount' => (float) $payment->amount,
            ];
        }

        return DB::transaction(function () use ($payment) {
            $amount = round((float) $payment->amount, 2);
            $supplier = null;
            if ((int) ($payment->payee_id ?? 0) > 0) {
                $supplier = Supplier::query()->find((int) $payment->payee_id);
            }

            $receipt = Receipt::query()
                ->where('payment_method', NonCashSettlementMethod::SET_OFF)
                ->where(function ($q) use ($payment) {
                    $q->where('reference_id', $payment->id)
                        ->where(function ($q2) {
                            $q2->where('reference_type', Payment::class)
                                ->orWhere('reference_type', 'like', '%Payment');
                        });
                })
                ->first();

            // Unwind AR only for the portion still reflected on orders (oldest open first, reverse of apply).
            if ($supplier && (int) ($supplier->linked_customer_id ?? 0) > 0) {
                $customer = Customer::query()->find((int) $supplier->linked_customer_id);
                if ($customer) {
                    $this->unwindSetOffFromCustomerOrders($customer, $amount);
                }
            }

            if ($supplier) {
                $supplier->balance = round((float) ($supplier->balance ?? 0) + $amount, 2);
                $supplier->save();
                $linkedVendor = $supplier->resolveLinkedVendor();
                if ($linkedVendor) {
                    $linkedVendor->updateBalance($amount, 'add');
                }
            }

            $payment->cancel();
            $receiptId = $receipt ? (int) $receipt->id : null;
            if ($receipt) {
                $receipt->delete();
            }

            app(InventoryAuditLogService::class)->record(
                'party.set_off.reverse',
                Supplier::class,
                (int) ($supplier?->id ?? $payment->payee_id ?? 0),
                [
                    'payment_id' => (int) $payment->id,
                    'receipt_id' => $receiptId,
                    'amount' => $amount,
                    'notes' => (string) ($payment->notes ?? ''),
                ],
            );

            return [
                'payment_id' => (int) $payment->id,
                'receipt_id' => $receiptId,
                'amount' => $amount,
            ];
        });
    }

    /**
     * Undo set-off applied to customer orders (reduce paid / increase remaining), newest first.
     */
    private function unwindSetOffFromCustomerOrders(Customer $customer, float $amount): void
    {
        $left = round($amount, 2);
        if ($left < 0.01) {
            return;
        }

        $nameTrim = trim((string) $customer->name);
        $orders = InventoryOrder::query()
            ->where(function ($q) use ($customer, $nameTrim) {
                $q->where('customer_id', $customer->id);
                if ($nameTrim !== '') {
                    $q->orWhere('customer_name', $customer->name)
                        ->orWhere('customer_name', $nameTrim);
                }
            })
            ->whereNotIn('status', ['cancelled', 'rejected'])
            ->orderByDesc('order_date')
            ->orderByDesc('id')
            ->get();

        foreach ($orders as $order) {
            if ($left < 0.01) {
                break;
            }
            $paid = (float) ($order->paid_amount ?? 0);
            if ($paid < 0.01) {
                continue;
            }
            $take = min($paid, $left);
            $newPaid = round($paid - $take, 2);
            $total = (float) $order->total_amount;
            $order->paid_amount = $newPaid;
            $order->remaining_amount = round(max(0.0, $total - $newPaid), 2);
            if ($order->remaining_amount > 0.0001) {
                $order->financial_status = 'pending';
                $order->settlement_status = 'pending';
            }
            $order->save();
            $left = round($left - $take, 2);
        }
    }

    /**
     * Customer AR remaining (positive = they owe us), using the same rules as account-summary KPIs.
     */
    public function customerOutstanding(Customer $customer): float
    {
        $isGuest = CustomerReceivablesQueryService::isGuestPlaceholderName($customer->name);
        $nameTrim = $isGuest ? '' : trim((string) $customer->name);

        $orders = InventoryOrder::query()
            ->where(function ($q) use ($customer, $nameTrim) {
                $q->where('customer_id', $customer->id);
                if ($nameTrim !== '') {
                    $q->orWhere('customer_name', $customer->name)
                        ->orWhere('customer_name', $nameTrim);
                }
            })
            ->whereNotIn('status', ['cancelled', 'rejected'])
            ->get(['id', 'total_amount', 'paid_amount', 'remaining_amount']);

        $outstanding = 0.0;
        foreach ($orders as $order) {
            $total = (float) $order->total_amount;
            $paid = (float) ($order->paid_amount ?? 0);
            $remaining = $order->remaining_amount !== null
                ? (float) $order->remaining_amount
                : max(0.0, $total - $paid);
            $outstanding += $remaining;
        }

        // On-account collections reduce AR. Set-off receipts are already applied to order
        // paid_amount, so exclude them (and any Payment-linked receipt) to avoid double count.
        $orphanQuery = Receipt::query()
            ->where(function ($q) use ($customer, $nameTrim, $isGuest) {
                if ($isGuest) {
                    $q->whereRaw('0 = 1');

                    return;
                }
                $q->where('payer_name', $customer->name);
                if ($nameTrim !== '') {
                    $q->orWhere('payer_name', $nameTrim);
                }
            })
            ->where(function ($q) {
                $q->whereNull('reference_type')
                    ->orWhere(function ($q2) {
                        $q2->where('reference_type', '!=', InventoryOrder::class)
                            ->where('reference_type', 'not like', '%InventoryOrder%')
                            ->where('reference_type', '!=', Payment::class)
                            ->where('reference_type', 'not like', '%\\\\Payment');
                    });
            })
            ->where(function ($q) {
                $q->whereNull('payment_method')
                    ->orWhereRaw('LOWER(TRIM(payment_method)) <> ?', [NonCashSettlementMethod::SET_OFF]);
            });

        $orphan = (float) $orphanQuery->sum('amount');

        return round(max(0.0, $outstanding - $orphan), 2);
    }

    /**
     * Apply set-off to the customer's oldest open orders (updates paid/remaining).
     */
    private function applySetOffToCustomerOrders(Customer $customer, float $amount): void
    {
        $left = round($amount, 2);
        if ($left < 0.01) {
            return;
        }

        $nameTrim = trim((string) $customer->name);
        $orders = InventoryOrder::query()
            ->where(function ($q) use ($customer, $nameTrim) {
                $q->where('customer_id', $customer->id);
                if ($nameTrim !== '') {
                    $q->orWhere('customer_name', $customer->name)
                        ->orWhere('customer_name', $nameTrim);
                }
            })
            ->whereNotIn('status', ['cancelled', 'rejected'])
            ->orderBy('order_date')
            ->orderBy('id')
            ->get();

        foreach ($orders as $order) {
            if ($left < 0.01) {
                break;
            }
            $total = (float) $order->total_amount;
            $paid = (float) ($order->paid_amount ?? 0);
            $remaining = $order->remaining_amount !== null
                ? (float) $order->remaining_amount
                : max(0.0, $total - $paid);
            if ($remaining < 0.01) {
                continue;
            }
            $take = min($remaining, $left);
            $newPaid = round($paid + $take, 2);
            $newRemaining = round(max(0.0, $total - $newPaid), 2);
            $order->paid_amount = $newPaid;
            $order->remaining_amount = $newRemaining;
            if ($newRemaining <= 0.0001) {
                $order->financial_status = 'charged';
                $order->settlement_status = 'settled';
                $status = (string) ($order->status ?? '');
                if ($status === 'pending' || $status === 'processing') {
                    $order->status = 'sold';
                }
            }
            $order->save();
            $left = round($left - $take, 2);
        }
    }

    private function nextPaymentNumber(): string
    {
        $prefix = 'PAY-';
        $last = (string) Payment::whereNotNull('payment_number')
            ->where('payment_number', 'like', $prefix.'%')
            ->orderByDesc('id')
            ->value('payment_number');
        $lastNum = (int) preg_replace('/\D+/', '', $last ?: '');
        $next = $lastNum + 1;
        $candidate = $prefix.str_pad((string) $next, 3, '0', STR_PAD_LEFT);
        while (Payment::where('payment_number', $candidate)->exists()) {
            $next++;
            $candidate = $prefix.str_pad((string) $next, 3, '0', STR_PAD_LEFT);
        }

        return $candidate;
    }

    /**
     * Informational companion strip only (supplier rows + linked sales invoices).
     * UI/print use the classic supplier statement; set-off customer twins are omitted.
     *
     * @param  array<int, array<string, mixed>>  $supplierLedger
     * @param  array<int, array<string, mixed>>  $customerLedger
     * @return array<int, array<string, mixed>>
     */
    public function mergeCurrentAccountLedger(array $supplierLedger, array $customerLedger): array
    {
        $rows = [];
        foreach ($supplierLedger as $row) {
            $rows[] = array_merge($row, [
                'party_side' => 'supplier',
                'description' => (string) ($row['description'] ?? ''),
            ]);
        }
        foreach ($customerLedger as $row) {
            $source = (string) ($row['source'] ?? '');
            // Sales only in the companion strip — collections/set-off stay on each side's own books
            // so a merged running balance does not double-count party set-off.
            if ($source !== 'invoice') {
                continue;
            }
            $rows[] = [
                'date' => $row['date'] ?? null,
                'description' => 'بيع / اشترى منّي — '.(string) ($row['description'] ?? ''),
                // Flip AR sale onto AP view: sale reduces what we owe / increases what they owe us.
                'debit' => 0.0,
                'credit' => (float) ($row['debit'] ?? 0),
                'source' => 'customer_invoice',
                'source_id' => $row['source_id'] ?? null,
                'party_side' => 'customer',
            ];
        }

        usort($rows, static function ($a, $b) {
            $da = (string) ($a['date'] ?? '0000-00-00');
            $db = (string) ($b['date'] ?? '0000-00-00');
            if ($da === $db) {
                return ((int) ($a['source_id'] ?? 0)) <=> ((int) ($b['source_id'] ?? 0));
            }

            return $da <=> $db;
        });

        $running = 0.0;
        foreach ($rows as &$row) {
            $running += ((float) $row['debit'] - (float) $row['credit']);
            $row['balance'] = round($running, 2);
        }
        unset($row);

        return array_values($rows);
    }
}

