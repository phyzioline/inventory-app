<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private function indexExists(string $table, string $indexName): bool
    {
        return migration_index_exists($table, $indexName);
    }

    public function up(): void
    {
        if (! Schema::hasTable('purchase_batches')) {
            return;
        }

        // Ensure user_id exists (older DBs might have been created before the add_user_id migration)
        Schema::table('purchase_batches', function (Blueprint $table) {
            if (! Schema::hasColumn('purchase_batches', 'user_id')) {
                $table->foreignId('user_id')->nullable()->after('id')->constrained('users')->nullOnDelete();
                $table->index('user_id');
            }
        });

        // Default index name for $table->string('batch_number')->unique() is usually: purchase_batches_batch_number_unique
        if ($this->indexExists('purchase_batches', 'purchase_batches_batch_number_unique')) {
            Schema::table('purchase_batches', function (Blueprint $table) {
                $table->dropUnique('purchase_batches_batch_number_unique');
            });
        }

        if (! $this->indexExists('purchase_batches', 'purchase_batches_user_id_batch_number_unique')) {
            Schema::table('purchase_batches', function (Blueprint $table) {
                $table->unique(['user_id', 'batch_number'], 'purchase_batches_user_id_batch_number_unique');
            });
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('purchase_batches')) {
            return;
        }

        if ($this->indexExists('purchase_batches', 'purchase_batches_user_id_batch_number_unique')) {
            Schema::table('purchase_batches', function (Blueprint $table) {
                $table->dropUnique('purchase_batches_user_id_batch_number_unique');
            });
        }

        if (! $this->indexExists('purchase_batches', 'purchase_batches_batch_number_unique')) {
            Schema::table('purchase_batches', function (Blueprint $table) {
                $table->unique('batch_number', 'purchase_batches_batch_number_unique');
            });
        }
    }
};
