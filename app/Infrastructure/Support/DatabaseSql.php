<?php

namespace App\Infrastructure\Support;

use Illuminate\Support\Facades\DB;

/**
 * Small SQL fragments that differ between MySQL/MariaDB and PostgreSQL.
 *
 * Standalone port of the monolith's shared
 * Modules\Administration\app\Infrastructure\Support\DatabaseSql — logic
 * unchanged. This app is PostgreSQL-only (see CLAUDE.md / docs), but the
 * driver branches are kept as-is (same behavior as source) rather than
 * hard-coded to pgsql, since ProfitEngineService and InventoryController
 * call these helpers unmodified.
 */
final class DatabaseSql
{
    public static function driver(): string
    {
        return DB::getDriverName();
    }

    public static function isPgsql(): bool
    {
        return self::driver() === 'pgsql';
    }

    /** e.g. 2026-05 in a column alias "month" */
    public static function yearMonthSelect(string $column, string $alias = 'month'): string
    {
        if (self::isPgsql()) {
            return "TO_CHAR({$column}, 'YYYY-MM') as {$alias}";
        }

        return "DATE_FORMAT({$column}, '%Y-%m') as {$alias}";
    }

    /** Expression for GROUP BY (no alias). */
    public static function yearMonthGroupBy(string $column): string
    {
        if (self::isPgsql()) {
            return "TO_CHAR({$column}, 'YYYY-MM')";
        }

        return "DATE_FORMAT({$column}, '%Y-%m')";
    }

    public static function yearSelect(string $column, string $alias = 'year'): string
    {
        if (self::isPgsql()) {
            return "EXTRACT(YEAR FROM {$column})::int as {$alias}";
        }

        return "YEAR({$column}) as {$alias}";
    }

    public static function monthSelect(string $column, string $alias = 'month'): string
    {
        if (self::isPgsql()) {
            return "EXTRACT(MONTH FROM {$column})::int as {$alias}";
        }

        return "MONTH({$column}) as {$alias}";
    }

    public static function daySelect(string $column, string $alias = 'day'): string
    {
        if (self::isPgsql()) {
            return "EXTRACT(DAY FROM {$column})::int as {$alias}";
        }

        return "DAY({$column}) as {$alias}";
    }

    /** MySQL CHAR(n) vs PostgreSQL CHR(n) for ASCII code points in REPLACE chains. */
    public static function asciiChar(int $code): string
    {
        return self::isPgsql() ? "CHR({$code})" : "CHAR({$code})";
    }

    public static function dateCastSelect(string $column, string $alias = 'date'): string
    {
        if (self::isPgsql()) {
            return "({$column})::date as {$alias}";
        }

        return "DATE({$column}) as {$alias}";
    }

    public static function dateCastGroupBy(string $column): string
    {
        if (self::isPgsql()) {
            return "({$column})::date";
        }

        return "DATE({$column})";
    }

    /** SUM() on a column that may be varchar after MySQL → Postgres migration. */
    public static function sumNumeric(string $column): string
    {
        if (self::isPgsql()) {
            return "SUM(CAST({$column} AS numeric))";
        }

        return "SUM({$column})";
    }

    /** AVG() on a column that may be varchar after MySQL → Postgres migration. */
    public static function avgNumeric(string $column): string
    {
        if (self::isPgsql()) {
            return "AVG(CAST({$column} AS numeric))";
        }

        return "AVG({$column})";
    }

    /**
     * SUM(CASE WHEN column = 'value' …) — use single-quoted literals (Postgres treats "x" as identifiers).
     */
    public static function sumWhenEquals(string $column, string $value, ?string $alias = null): string
    {
        $literal = "'".str_replace("'", "''", $value)."'";
        $sql = "SUM(CASE WHEN {$column} = {$literal} THEN 1 ELSE 0 END)";
        if ($alias !== null) {
            $sql .= " as {$alias}";
        }

        return $sql;
    }

    /**
     * Bulk insert product_metrics rows, incrementing views on conflict.
     *
     * @param  list<mixed>  $bindings
     */
    public static function productMetricsBulkViewIncrementSql(string $columns, string $placeholders): string
    {
        if (self::isPgsql()) {
            return "INSERT INTO product_metrics ({$columns})
                    VALUES {$placeholders}
                    ON CONFLICT (product_id) DO UPDATE SET
                        views = product_metrics.views + 1,
                        updated_at = EXCLUDED.updated_at";
        }

        return "INSERT INTO product_metrics ({$columns})
                VALUES {$placeholders}
                ON DUPLICATE KEY UPDATE views = views + 1, updated_at = VALUES(updated_at)";
    }
}
