<?php

use Illuminate\Support\Facades\Schema;

if (! function_exists('migration_index_exists')) {
    /**
     * Cross-driver index check (SQLite, PostgreSQL, MySQL).
     */
    function migration_index_exists(string $table, string $indexName): bool
    {
        if (! Schema::hasTable($table)) {
            return false;
        }

        return collect(Schema::getIndexes($table))
            ->pluck('name')
            ->contains($indexName);
    }
}

if (! function_exists('migration_foreign_key_exists')) {
    /**
     * Cross-driver foreign-key check by constraint name or local column.
     */
    function migration_foreign_key_exists(string $table, string $nameOrColumn): bool
    {
        if (! Schema::hasTable($table)) {
            return false;
        }

        $keys = collect(Schema::getForeignKeys($table));

        if ($keys->pluck('name')->contains($nameOrColumn)) {
            return true;
        }

        return $keys->contains(
            fn (array $fk) => in_array($nameOrColumn, $fk['columns'] ?? [], true)
        );
    }
}
