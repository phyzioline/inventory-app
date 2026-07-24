<?php

namespace App\Application\Services;

use App\Domain\Models\Wms\Payment;
use App\Domain\Models\Wms\Supplier;
use App\Domain\Models\Wms\Vendor;

class SupplierIdentityConsolidationService
{
    /**
     * Normalize Arabic supplier names for matching (ignore spaces / case).
     */
    public function normalizeSupplierName(?string $name): string
    {
        $trimmed = trim((string) $name);
        if ($trimmed === '') {
            return '';
        }

        $collapsed = preg_replace('/\s+/u', '', $trimmed) ?? $trimmed;

        return mb_strtolower($collapsed);
    }

    /**
     * @return list<string>
     */
    public function nameAliasesFor(Supplier $supplier): array
    {
        $canonical = trim((string) $supplier->name);
        $aliases = array_values(array_unique(array_filter([
            $canonical,
            preg_replace('/\s+/u', '', $canonical) ?: null,
        ])));

        return $aliases;
    }

    public function paymentPayeeNameMatchesSupplier(Payment $payment, Supplier $supplier): bool
    {
        $normalizedPayee = $this->normalizeSupplierName($payment->payee_name);
        if ($normalizedPayee === '') {
            return false;
        }

        foreach ($this->nameAliasesFor($supplier) as $alias) {
            if ($normalizedPayee === $this->normalizeSupplierName($alias)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Orphan / legacy payee ids that still carry this supplier's name but wrong id.
     *
     * @return list<int>
     */
    public function discoverLegacyPayeeIds(Supplier $supplier, int $vendorId): array
    {
        $supplierId = (int) $supplier->id;
        $exclude = array_values(array_unique(array_filter([$supplierId, $vendorId > 0 ? $vendorId : null])));

        return Payment::query()
            ->where('user_id', (int) $supplier->user_id)
            ->when($exclude !== [], fn ($q) => $q->whereNotIn('payee_id', $exclude))
            ->orderBy('payee_id')
            ->get(['payee_id', 'payee_name'])
            ->filter(fn (Payment $p) => $this->paymentPayeeNameMatchesSupplier($p, $supplier))
            ->pluck('payee_id')
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values()
            ->all();
    }

    /**
     * @param  list<string>  $explicitPaymentNumbers
     * @return array{moved: list<string>, skipped: list<string>, already: list<string>}
     */
    public function consolidatePayments(
        Supplier $supplier,
        array $explicitPaymentNumbers = [],
        bool $dryRun = false
    ): array {
        $vendor = $supplier->resolveLinkedVendor();
        $vendorId = $vendor?->id ? (int) $vendor->id : 0;
        $canonicalName = trim((string) $supplier->name);
        $supplierClass = Supplier::class;

        $explicit = collect($explicitPaymentNumbers)
            ->map(fn ($n) => strtoupper(trim((string) $n)))
            ->filter()
            ->unique()
            ->values()
            ->all();

        $candidates = Payment::query()
            ->where('user_id', (int) $supplier->user_id)
            ->where(function ($q) use ($supplier, $vendorId, $explicit) {
                $q->where('payee_id', (int) $supplier->id);

                if ($explicit !== []) {
                    $q->orWhereIn('payment_number', $explicit);
                }

                if ($vendorId > 0) {
                    $q->orWhere(function ($q2) use ($vendorId) {
                        $q2->where('payee_id', $vendorId)
                            ->where(function ($q3) {
                                $q3->where('payee_type', Vendor::class)
                                    ->orWhere('payee_type', 'like', '%Vendor%');
                            });
                    });
                }
            })
            ->orderBy('payment_date')
            ->get();

        $legacyIds = $this->discoverLegacyPayeeIds($supplier, $vendorId);
        if ($legacyIds !== []) {
            $legacyRows = Payment::query()
                ->where('user_id', (int) $supplier->user_id)
                ->whereIn('payee_id', $legacyIds)
                ->get();
            $candidates = $candidates->merge($legacyRows)->unique('id');
        }

        $moved = [];
        $skipped = [];
        $already = [];

        /** @var Payment $payment */
        foreach ($candidates as $payment) {
            $ref = (string) ($payment->payment_number ?: $payment->id);
            $isExplicit = in_array(strtoupper($ref), $explicit, true);
            $nameMatches = $this->paymentPayeeNameMatchesSupplier($payment, $supplier);
            $onCanonicalId = (int) $payment->payee_id === (int) $supplier->id;

            if ($onCanonicalId && $nameMatches) {
                $already[] = $ref;

                continue;
            }

            if (! $isExplicit && ! $nameMatches) {
                $skipped[] = $ref;

                continue;
            }

            // Never reassign a row clearly owned by another supplier (unless explicit allowlist).
            if (! $isExplicit && $this->paymentBelongsToAnotherSupplier($payment, $supplier)) {
                $skipped[] = $ref;

                continue;
            }

            if ($dryRun) {
                $moved[] = $ref;

                continue;
            }

            $payment->update([
                'payee_id' => (int) $supplier->id,
                'payee_type' => $supplierClass,
                'payee_name' => $canonicalName,
            ]);
            $moved[] = $ref;
        }

        return [
            'moved' => $moved,
            'skipped' => $skipped,
            'already' => $already,
        ];
    }

    private function paymentBelongsToAnotherSupplier(Payment $payment, Supplier $target): bool
    {
        $payeeId = (int) $payment->payee_id;
        if ($payeeId <= 0 || $payeeId === (int) $target->id) {
            return false;
        }

        $owner = Supplier::query()->whereKey($payeeId)->first();
        if (! $owner) {
            return false;
        }

        $payeeName = trim((string) $payment->payee_name);
        if ($payeeName === '') {
            return false;
        }

        return $this->normalizeSupplierName($payeeName) === $this->normalizeSupplierName($owner->name);
    }

    /**
     * Build payee_id list for account-summary queries (canonical + vendor vendor-morph + legacy orphans).
     *
     * @return list<int>
     */
    public function resolvePaymentPayeeIdsForAccount(Supplier $supplier, int $vendorId): array
    {
        $ids = [(int) $supplier->id];

        if ($vendorId > 0) {
            $ids[] = $vendorId;
        }

        foreach ($this->discoverLegacyPayeeIds($supplier, $vendorId) as $legacyId) {
            $ids[] = $legacyId;
        }

        return array_values(array_unique(array_filter($ids, fn ($id) => (int) $id > 0)));
    }
}
