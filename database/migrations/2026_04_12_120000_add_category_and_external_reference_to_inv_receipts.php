<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('inv_receipts')) {
            return;
        }

        Schema::table('inv_receipts', function (Blueprint $table) {
            if (! Schema::hasColumn('inv_receipts', 'category')) {
                $table->string('category', 64)->nullable()->after('type');
            }
            if (! Schema::hasColumn('inv_receipts', 'external_reference')) {
                $table->string('external_reference', 191)->nullable()->after('reference_id');
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('inv_receipts')) {
            return;
        }

        Schema::table('inv_receipts', function (Blueprint $table) {
            if (Schema::hasColumn('inv_receipts', 'external_reference')) {
                $table->dropColumn('external_reference');
            }
            if (Schema::hasColumn('inv_receipts', 'category')) {
                $table->dropColumn('category');
            }
        });
    }
};
