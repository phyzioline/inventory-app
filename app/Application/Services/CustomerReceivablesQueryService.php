<?php

namespace App\Application\Services;

use Illuminate\Support\Facades\DB;

/**
 * Single source of truth for customer receivables (Customers page list + KPI cards,
 * Treasury / Capital "customer receivables" cards).
 *
 * Totals are always computed in SQL over the FULL filtered set — never by summing
 * one page of rows on the client.
 *
 * Marketplace imports create placeholder customers named "Guest" (see
 * MarketplaceImportService). Those are excluded by default and never matched by
 * name, because every guest order shares the same name and would pile onto each
 * guest row. Real customers whose name merely looks short (e.g. "Gnt", a shop
 * credit customer) must NOT be treated as guests.
 */
class CustomerReceivablesQueryService
{
    public const SORTS = ['outstanding', 'total_sales', 'total_received', 'invoice_count', 'name'];

    public static function isGuestPlaceholderName(?string $name): bool
    {
        return str_starts_with(strtolower(trim((string) $name)), 'guest');
    }

    /**
     * SQL predicate that is TRUE for a real (non-placeholder) customer name.
     */
    public static function realCustomerNameSql(string $column): string
    {
        return "(TRIM(COALESCE({$column}, '')) <> '' AND {$column} NOT ILIKE 'guest%')";
    }

    /**
     * @param  array{search?: string, start_date?: ?string, end_date?: ?string, exclude_guests?: bool}  $filters
     * @return array{data: array<int, array<string, mixed>>, total: int, totals: array<string, float|int>}
     */
    public function paginate(int $userId, array $filters, string $sort, string $direction, int $page, int $perPage): array
    {
        [$sql, $bindings] = $this->buildSummarySql($userId, $filters);

        $sortCol = match ($sort) {
            'total_sales' => 'total_sales',
            'total_received' => 'total_received',
            'invoice_count' => 'invoice_count',
            'name' => 'c.name',
            default => 'outstanding',
        };
        $direction = strtoupper($direction) === 'ASC' ? 'ASC' : 'DESC';
        $sortExpr = $sortCol === 'c.name'
            ? "c.name {$direction}"
            : "{$sortCol} {$direction}, c.name ASC";

        $offset = (max(1, $page) - 1) * $perPage;
        $rows = DB::select("{$sql} ORDER BY {$sortExpr} LIMIT {$perPage} OFFSET {$offset}", $bindings);

        $totals = $this->aggregate($sql, $bindings);

        return [
            'data' => array_map(fn ($row) => $this->mapRow($row), $rows),
            'total' => (int) $totals['customers'],
            'totals' => $totals,
        ];
    }

    /**
     * @param  array{search?: string, start_date?: ?string, end_date?: ?string, exclude_guests?: bool}  $filters
     * @return array<string, float|int>
     */
    public function totals(int $userId, array $filters = []): array
    {
        [$sql, $bindings] = $this->buildSummarySql($userId, $filters);

        return $this->aggregate($sql, $bindings);
    }

    /**
     * receivable = what customers owe us (positive balances only);
     * credit     = what we owe customers (negative balances, e.g. returns after payment);
     * net_outstanding = receivable + credit.
     *
     * @return array<string, float|int>
     */
    private function aggregate(string $sql, array $bindings): array
    {
        $agg = DB::selectOne("
            SELECT
                COUNT(*) AS customers,
                COALESCE(SUM(total_sales), 0) AS total_sales,
                COALESCE(SUM(total_received), 0) AS total_received,
                COALESCE(SUM(GREATEST(outstanding, 0)), 0) AS receivable,
                COALESCE(SUM(LEAST(outstanding, 0)), 0) AS credit,
                COALESCE(SUM(outstanding), 0) AS net_outstanding,
                COALESCE(SUM(invoice_count), 0) AS invoice_count,
                COUNT(*) FILTER (WHERE outstanding > 0.005) AS customers_owing
            FROM ({$sql}) AS sub
        ", $bindings);

        return [
            'customers' => (int) ($agg->customers ?? 0),
            'customers_owing' => (int) ($agg->customers_owing ?? 0),
            'total_sales' => round((float) ($agg->total_sales ?? 0), 2),
            'total_received' => round((float) ($agg->total_received ?? 0), 2),
            'receivable' => round((float) ($agg->receivable ?? 0), 2),
            'credit' => round((float) ($agg->credit ?? 0), 2),
            'net_outstanding' => round((float) ($agg->net_outstanding ?? 0), 2),
            'invoice_count' => (int) ($agg->invoice_count ?? 0),
        ];
    }

    /**
     * Aggregate orders by customer_id OR by exact name (legacy rows without customer_id).
     *
     * @return array{0: string, 1: array<int, mixed>}
     */
    private function buildSummarySql(int $userId, array $filters): array
    {
        $search = trim((string) ($filters['search'] ?? ''));
        $startDate = $filters['start_date'] ?? null;
        $endDate = $filters['end_date'] ?? null;
        $excludeGuests = (bool) ($filters['exclude_guests'] ?? true);
        $hasRange = $startDate && $endDate;

        $orderDateClause = $hasRange ? 'AND io.order_date BETWEEN ? AND ?' : '';
        $receiptDateClause = $hasRange ? 'AND r.receipt_date BETWEEN ? AND ?' : '';
        $searchClause = $search !== '' ? 'AND (c.name ILIKE ? OR c.email ILIKE ? OR c.phone ILIKE ?)' : '';

        // Hide marketplace Guest placeholders unless the user is explicitly searching for them.
        $guestClause = ($excludeGuests && stripos($search, 'guest') === false)
            ? 'AND '.self::realCustomerNameSql('c.name')
            : '';

        $realC2Name = self::realCustomerNameSql('c2.name');

        $sql = "
            SELECT
                c.id,
                c.name,
                c.email,
                c.phone,
                c.tax_id,
                c.address,
                c.credit_limit,
                c.current_balance,
                c.currency,
                c.is_active,
                c.user_id,
                c.created_at,
                c.updated_at,
                COALESCE(ord.total_sales, 0) AS total_sales,
                COALESCE(ord.invoice_count, 0) AS invoice_count,
                COALESCE(ord.paid_sum, 0) AS paid_sum,
                COALESCE(ord.remaining_sum, 0) AS remaining_sum,
                COALESCE(rec.receipts_total, 0) AS receipts_total,
                (COALESCE(ord.remaining_sum, 0) - COALESCE(rec.orphan_receipts, 0)) AS outstanding,
                GREATEST(0,
                    COALESCE(ord.total_sales, 0)
                    - (COALESCE(ord.remaining_sum, 0) - COALESCE(rec.orphan_receipts, 0))
                ) AS total_received
            FROM customers c
            LEFT JOIN (
                SELECT
                    resolved.customer_id,
                    SUM(resolved.total_amount) AS total_sales,
                    COUNT(*) AS invoice_count,
                    SUM(COALESCE(resolved.paid_amount, 0)) AS paid_sum,
                    -- Negative here means a credit balance owed back to the customer
                    -- (e.g. a return worth more than what was left owed on that order).
                    SUM(resolved.total_amount - COALESCE(resolved.paid_amount, 0) - COALESCE(ret.return_total, 0)) AS remaining_sum
                FROM (
                    SELECT
                        io.customer_id AS customer_id,
                        io.id AS order_id,
                        io.total_amount,
                        io.paid_amount
                    FROM inventory_orders io
                    WHERE io.user_id = ?
                      AND io.status NOT IN ('cancelled', 'rejected')
                      AND io.customer_id IS NOT NULL
                      {$orderDateClause}

                    UNION ALL

                    SELECT
                        c2.id AS customer_id,
                        io.id AS order_id,
                        io.total_amount,
                        io.paid_amount
                    FROM inventory_orders io
                    INNER JOIN customers c2
                        ON c2.user_id = io.user_id
                       AND LOWER(TRIM(COALESCE(c2.name, ''))) = LOWER(TRIM(COALESCE(io.customer_name, '')))
                       AND {$realC2Name}
                    WHERE io.user_id = ?
                      AND io.status NOT IN ('cancelled', 'rejected')
                      AND io.customer_id IS NULL
                      AND TRIM(COALESCE(io.customer_name, '')) <> ''
                      {$orderDateClause}
                ) resolved
                LEFT JOIN (
                    SELECT inventory_order_id, SUM(refund_amount) AS return_total
                    FROM inventory_returns
                    WHERE status = 'completed'
                    GROUP BY inventory_order_id
                ) ret ON ret.inventory_order_id = resolved.order_id
                GROUP BY resolved.customer_id
            ) ord ON ord.customer_id = c.id
            LEFT JOIN (
                SELECT
                    LOWER(TRIM(r.payer_name)) AS payer_key,
                    SUM(r.amount) AS receipts_total,
                    SUM(CASE WHEN r.reference_id IS NULL THEN r.amount ELSE 0 END) AS orphan_receipts
                FROM inv_receipts r
                WHERE r.user_id = ?
                  AND r.category = 'customer_collection'
                  {$receiptDateClause}
                GROUP BY LOWER(TRIM(r.payer_name))
            ) rec ON rec.payer_key = LOWER(TRIM(c.name))
            WHERE c.user_id = ?
            {$guestClause}
            {$searchClause}
        ";

        $range = $hasRange ? [$startDate, $endDate.' 23:59:59'] : [];
        $receiptRange = $hasRange ? [$startDate, $endDate] : [];

        $bindings = [
            $userId, ...$range,         // orders by customer_id
            $userId, ...$range,         // orders by name fallback
            $userId, ...$receiptRange,  // receipts
            $userId,                    // customers filter
        ];
        if ($search !== '') {
            $like = '%'.$search.'%';
            array_push($bindings, $like, $like, $like);
        }

        return [$sql, $bindings];
    }

    /**
     * @return array<string, mixed>
     */
    private function mapRow(object $row): array
    {
        return [
            'id' => $row->id,
            'name' => $row->name,
            'email' => $row->email,
            'phone' => $row->phone,
            'tax_id' => $row->tax_id,
            'address' => $row->address,
            'credit_limit' => (float) $row->credit_limit,
            'current_balance' => (float) $row->current_balance,
            'currency' => $row->currency,
            'is_active' => (bool) $row->is_active,
            'user_id' => $row->user_id,
            'created_at' => $row->created_at,
            'updated_at' => $row->updated_at,
            'summary' => [
                'total_sales' => round((float) $row->total_sales, 2),
                'total_received' => round((float) $row->total_received, 2),
                'outstanding' => round((float) $row->outstanding, 2),
                'invoice_count' => (int) $row->invoice_count,
                'avg_collection_days' => 0,
            ],
        ];
    }
}
