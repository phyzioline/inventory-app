<?php

namespace App\Application\Services;

use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\Sku;
use Illuminate\Support\Collection;

/**
 * Jumia Vendor Center "orders export" → marketplace-import order rows.
 *
 * Identity rule: a Jumia line is identified by the **Jumia SKU** column
 * (e.g. GE810SE36MSGDNAFAMZ-214870994), never by "Seller Sku". Jumia products were listed
 * with the same seller SKUs as Amazon, so a seller-SKU lookup would land on an Amazon
 * listing and deduct Amazon stock. Every lookup here is scoped to Jumia channels only.
 *
 * Fulfilment lanes (same idea as Amazon FBA vs merchant):
 *   "Fulfillment by Jumia" → Jumia FBJ channel (its own warehouse location)
 *   "Dropshipping"          → Jumia merchant/dropshipping channel (deducts from المحل)
 *
 * The export has one row per unit and no quantity column, and each unit carries its own
 * status, so rows are collapsed per order + Jumia SKU before import.
 */
class JumiaOrderSheetMapper
{
    public const UNITS = '_jumia_units';

    public const ORDER_TOTAL = '_jumia_order_total';

    public const ORDER_VOID = '_jumia_order_void';

    public const ORDER_STATUSES = '_jumia_order_statuses';

    public const LANE_FBJ = 'fbj';

    public const LANE_DROPSHIPPING = 'dropshipping';

    public static function isJumiaChannel(?Channel $channel): bool
    {
        if (! $channel) {
            return false;
        }
        if (str_starts_with(strtolower(trim((string) ($channel->type ?? ''))), 'jumia')) {
            return true;
        }
        $hay = mb_strtolower(($channel->name ?? '').' '.($channel->slug ?? ''), 'UTF-8');

        return str_contains($hay, 'jumia') || str_contains($hay, 'جوميا');
    }

    public static function isDropshippingChannel(Channel $channel): bool
    {
        return self::isJumiaChannel($channel) && ChannelStockResolver::isMerchantChannelModel($channel);
    }

    /**
     * Header signature of the Vendor Center orders export (parsed headers are lower-cased).
     *
     * @param  list<array<string, mixed>>  $rows
     */
    public function looksLikeOrdersSheet(array $rows): bool
    {
        $first = $rows[0] ?? null;

        return is_array($first)
            && array_key_exists('jumia sku', $first)
            && array_key_exists('order number', $first)
            && array_key_exists('unit price', $first)
            && ! $this->looksLikeStatement($rows);
    }

    /**
     * Account statement (money sheet) — must never be imported as orders.
     *
     * @param  list<array<string, mixed>>  $rows
     */
    public function looksLikeStatement(array $rows): bool
    {
        $first = $rows[0] ?? null;

        return is_array($first)
            && array_key_exists('jumia sku', $first)
            && array_key_exists('transaction type', $first);
    }

    public function laneFromShipmentType(?string $raw): ?string
    {
        $v = strtolower(trim((string) $raw));
        if ($v === '') {
            return null;
        }
        if (str_contains($v, 'dropship') || str_contains($v, 'drop ship') || str_contains($v, 'merchant') || str_contains($v, 'seller')) {
            return self::LANE_DROPSHIPPING;
        }
        if (str_contains($v, 'by jumia') || str_contains($v, 'fbj') || str_contains($v, 'fulfil')) {
            return self::LANE_FBJ;
        }

        return null;
    }

    /**
     * Jumia channel for a sheet row's fulfilment lane. Null = no matching Jumia channel (row must be blocked).
     *
     * @param  Collection<int, Channel>  $channels
     */
    public function resolveLaneChannel(Collection $channels, ?string $shipmentType, ?Channel $preferred): ?Channel
    {
        $lane = $this->laneFromShipmentType($shipmentType);
        if ($lane === null) {
            return self::isJumiaChannel($preferred) ? $preferred : null;
        }

        $wantDropshipping = $lane === self::LANE_DROPSHIPPING;
        $candidates = $channels
            ->filter(fn (Channel $c) => self::isJumiaChannel($c) && self::isDropshippingChannel($c) === $wantDropshipping)
            ->sortBy('id')
            ->values();

        if ($preferred && $candidates->contains('id', $preferred->id)) {
            return $preferred;
        }

        return $candidates->first();
    }

    /**
     * Preferred Jumia channel when a Jumia sheet is uploaded from a non-Jumia (or no) channel.
     *
     * @param  Collection<int, Channel>  $channels
     */
    public function defaultChannel(Collection $channels): ?Channel
    {
        $jumia = $channels->filter(fn (Channel $c) => self::isJumiaChannel($c))->sortBy('id')->values();

        return $jumia->first(fn (Channel $c) => ! self::isDropshippingChannel($c)) ?? $jumia->first();
    }

    /** Canceled / failed delivery → never a sale; the unit stays (or returns) in stock. */
    public function isVoidStatus(?string $raw): bool
    {
        return (bool) preg_match('/cancel|fail|invalid/', strtolower(trim((string) $raw)));
    }

    /**
     * @param  list<string>  $rawStatuses  statuses of every unit row of the order
     */
    public function mapOrderStatus(array $rawStatuses, bool $orderVoid): string
    {
        $statuses = array_map(static fn ($s) => strtolower(trim((string) $s)), $rawStatuses);

        if ($orderVoid) {
            $failed = array_filter($statuses, static fn ($s) => str_contains($s, 'fail'));

            return $statuses !== [] && count($failed) === count($statuses) ? 'rejected' : 'cancelled';
        }

        $live = array_values(array_filter($statuses, fn ($s) => ! $this->isVoidStatus($s)));
        foreach (['return' => 'returned', 'deliver' => 'delivered'] as $needle => $status) {
            foreach ($live as $s) {
                if (str_contains($s, $needle)) {
                    return $status;
                }
            }
        }
        foreach ($live as $s) {
            if (str_contains($s, 'ship') && ! str_contains($s, 'ready')) {
                return 'shipped';
            }
        }
        foreach ($live as $s) {
            if (str_contains($s, 'pending')) {
                return 'pending';
            }
        }

        return 'processing';
    }

    /**
     * Collapse unit rows → one row per (order, Jumia SKU) carrying units and order-level facts.
     * Idempotent: already-collapsed input is returned unchanged.
     *
     * @param  list<array<string, mixed>>  $rows
     * @return list<array<string, mixed>>
     */
    public function collapseRows(array $rows): array
    {
        if ($rows === [] || array_key_exists(self::UNITS, $rows[0])) {
            return $rows;
        }

        $byOrder = [];
        foreach ($rows as $i => $row) {
            $orderId = $this->orderNumber($row);
            $byOrder[$orderId !== '' ? $orderId : '__row_'.$i][] = $row;
        }

        $out = [];
        foreach ($byOrder as $orderRows) {
            $statuses = [];
            $orderTotal = 0.0;
            $bySku = [];
            foreach ($orderRows as $row) {
                $status = (string) ($row['status'] ?? '');
                $void = $this->isVoidStatus($status);
                $statuses[] = $status;
                if (! $void) {
                    $orderTotal += $this->money($row['unit price'] ?? null);
                }
                $skuKey = strtolower(trim((string) ($row['jumia sku'] ?? '')));
                $bySku[$skuKey !== '' ? $skuKey : strtolower(trim((string) ($row['seller sku'] ?? '')))][] = [$row, $void];
            }

            $liveUnits = count(array_filter($statuses, fn ($s) => ! $this->isVoidStatus($s)));
            foreach ($bySku as $lines) {
                $live = array_values(array_filter($lines, static fn ($l) => ! $l[1]));
                $representative = ($live[0] ?? $lines[0])[0];
                $representative[self::UNITS] = count($live);
                $representative[self::ORDER_TOTAL] = round($orderTotal, 2);
                $representative[self::ORDER_VOID] = $liveUnits === 0;
                $representative[self::ORDER_STATUSES] = $statuses;
                $out[] = $representative;
            }
        }

        return $out;
    }

    /**
     * @param  callable(string): ?string  $parseDate
     * @return array<string, mixed>|null
     */
    public function mapRow(array $row, callable $parseDate): ?array
    {
        $orderId = $this->orderNumber($row);
        if ($orderId === '') {
            return null;
        }

        $jumiaSku = trim((string) ($row['jumia sku'] ?? ''));
        $sellerSku = trim((string) ($row['seller sku'] ?? ''));
        $status = (string) ($row['status'] ?? '');
        $units = array_key_exists(self::UNITS, $row) ? (int) $row[self::UNITS] : ($this->isVoidStatus($status) ? 0 : 1);
        $orderVoid = array_key_exists(self::ORDER_VOID, $row) ? (bool) $row[self::ORDER_VOID] : $units === 0;
        // Seller revenue is Unit Price (the statement credits it in full); Paid Price is net of Jumia-funded vouchers.
        $unitPrice = $this->money($row['unit price'] ?? null);
        $orderTotal = array_key_exists(self::ORDER_TOTAL, $row) ? (float) $row[self::ORDER_TOTAL] : $unitPrice * $units;
        $statuses = is_array($row[self::ORDER_STATUSES] ?? null) ? $row[self::ORDER_STATUSES] : [$status];

        return [
            'platform_order_id' => $orderId,
            'order_date' => $parseDate((string) ($row['created at'] ?? '')) ?: date('Y-m-d H:i:s'),
            'currency' => 'EGP',
            'shipping_amount' => 0.0,
            'total_amount' => $orderVoid ? 0.0 : round($orderTotal, 2),
            'is_cancelled' => $orderVoid,
            'jumia_status' => $this->mapOrderStatus($statuses, $orderVoid),
            'import_platform' => 'jumia',
            'fulfillment_hint' => $row['shipment type'] ?? null,
            'sku_hint' => $jumiaSku,
            'items' => [[
                'sku_code' => $jumiaSku !== '' ? $jumiaSku : 'UNKNOWN',
                'seller_sku' => $sellerSku,
                'quantity' => $units,
                'unit_price' => $units > 0 ? $unitPrice : 0.0,
            ]],
        ];
    }

    /**
     * Listing on THIS Jumia channel only — never another channel.
     *  1. Linked: marketplace_id (or sku) equals the Jumia SKU.
     *  2. Auto-link: exactly one unlinked listing whose code is the seller SKU or "JUM-{seller SKU}".
     *
     * @return array{sku: ?Sku, auto_linked: bool}
     */
    public function resolveListing(int $channelId, string $jumiaSku, string $sellerSku, bool $persistLink): array
    {
        $jumiaSku = trim($jumiaSku);
        if ($channelId <= 0 || $jumiaSku === '' || strtoupper($jumiaSku) === 'UNKNOWN') {
            return ['sku' => null, 'auto_linked' => false];
        }

        $lower = mb_strtolower($jumiaSku, 'UTF-8');
        $linked = Sku::query()
            ->where('channel_id', $channelId)
            ->where(fn ($q) => $q->whereRaw('LOWER(marketplace_id) = ?', [$lower])->orWhereRaw('LOWER(sku) = ?', [$lower]))
            ->orderBy('id')
            ->first();
        if ($linked) {
            return ['sku' => $linked, 'auto_linked' => false];
        }

        $sellerSku = trim($sellerSku);
        if ($sellerSku === '') {
            return ['sku' => null, 'auto_linked' => false];
        }

        $candidates = Sku::query()
            ->where('channel_id', $channelId)
            ->whereIn('sku', [$sellerSku, 'JUM-'.$sellerSku])
            ->where(fn ($q) => $q->whereNull('marketplace_id')->orWhere('marketplace_id', ''))
            ->orderBy('id')
            ->limit(2)
            ->get();
        if ($candidates->count() !== 1) {
            return ['sku' => null, 'auto_linked' => false];
        }

        $sku = $candidates->first();
        if ($persistLink) {
            $sku->marketplace_id = $jumiaSku;
            $sku->save();
        }

        return ['sku' => $sku, 'auto_linked' => true];
    }

    private function orderNumber(array $row): string
    {
        return trim((string) ($row['order number'] ?? $row['order no.'] ?? ''));
    }

    private function money(mixed $value): float
    {
        $s = str_replace([',', ' '], '', trim((string) ($value ?? '')));

        return is_numeric($s) ? (float) $s : 0.0;
    }
}
