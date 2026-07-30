<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('inventory_transactions') && ! Schema::hasColumn('inventory_transactions', 'balance_after')) {
            Schema::table('inventory_transactions', function (Blueprint $table) {
                $table->decimal('balance_after', 15, 4)->nullable()->after('quantity');
            });
        }

        foreach (['master_products', 'skus', 'customers', 'suppliers'] as $tableName) {
            if (Schema::hasTable($tableName) && ! Schema::hasColumn($tableName, 'deleted_at')) {
                Schema::table($tableName, function (Blueprint $table) {
                    $table->softDeletes();
                });
            }
        }

        if (! Schema::hasTable('inventory_audit_logs')) {
            Schema::create('inventory_audit_logs', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('user_id')->nullable()->index();
                $table->string('action', 64);
                $table->string('subject_type', 191)->nullable();
                $table->unsignedBigInteger('subject_id')->nullable();
                $table->json('payload')->nullable();
                $table->timestamps();
                $table->index(['subject_type', 'subject_id']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_audit_logs');

        foreach (['master_products', 'skus', 'customers', 'suppliers'] as $tableName) {
            if (Schema::hasTable($tableName) && Schema::hasColumn($tableName, 'deleted_at')) {
                Schema::table($tableName, function (Blueprint $table) {
                    $table->dropSoftDeletes();
                });
            }
        }

        if (Schema::hasTable('inventory_transactions') && Schema::hasColumn('inventory_transactions', 'balance_after')) {
            Schema::table('inventory_transactions', function (Blueprint $table) {
                $table->dropColumn('balance_after');
            });
        }
    }
};
