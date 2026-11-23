<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Lookup indexes the stock / order screens join on. Before this, pg_stat_user_tables showed
 * sku_inventory with 10.3M sequential scans (23 billion rows read), purchase_batch_items 225k
 * and inventory_order_items 50k — every catalog and order page scanned whole tables
 * (fpm max_children, 2026-11-18 → 23).
 *
 * Additive only: no data is changed. Built CONCURRENTLY so production keeps reading and
 * writing while each index builds, hence no wrapping transaction.
 */
return new class extends Migration
{
    public $withinTransaction = false;

    /** @var array<string, array{0: string, 1: string}> index => [table, columns] */
    private const INDEXES = [
        'sku_inventory_sku_location_idx' => ['sku_inventory', 'sku_id, location_id'],
        'sku_inventory_location_idx' => ['sku_inventory', 'location_id'],
        'skus_offer_id_idx' => ['skus', 'offer_id'],
        'inventory_offers_master_product_id_idx' => ['inventory_offers', 'master_product_id'],
        'inventory_locations_channel_id_idx' => ['inventory_locations', 'channel_id'],
        'purchase_batch_items_batch_id_idx' => ['purchase_batch_items', 'purchase_batch_id'],
        'purchase_batch_items_master_product_id_idx' => ['purchase_batch_items', 'master_product_id'],
        'purchase_batch_items_sku_id_idx' => ['purchase_batch_items', 'sku_id'],
        'inventory_order_items_order_id_idx' => ['inventory_order_items', 'inventory_order_id'],
        'inventory_order_items_sku_id_idx' => ['inventory_order_items', 'sku_id'],
        'settlement_items_inventory_order_id_idx' => ['settlement_items', 'inventory_order_id'],
        'order_costs_inventory_order_id_idx' => ['order_costs', 'inventory_order_id'],
    ];

    public function up(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        foreach (self::INDEXES as $name => [$table, $columns]) {
            if (! $this->tableHasColumns($table, $columns)) {
                continue;
            }
            DB::statement("CREATE INDEX CONCURRENTLY IF NOT EXISTS {$name} ON {$table} ({$columns})");
        }

        foreach (array_unique(array_column(self::INDEXES, 0)) as $table) {
            if ($this->tableHasColumns($table, '')) {
                DB::statement("ANALYZE {$table}");
            }
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        foreach (array_keys(self::INDEXES) as $name) {
            DB::statement("DROP INDEX CONCURRENTLY IF EXISTS {$name}");
        }
    }

    private function tableHasColumns(string $table, string $columns): bool
    {
        if (! DB::getSchemaBuilder()->hasTable($table)) {
            return false;
        }
        foreach (array_filter(array_map('trim', explode(',', $columns))) as $column) {
            if (! DB::getSchemaBuilder()->hasColumn($table, $column)) {
                return false;
            }
        }

        return true;
    }
};
