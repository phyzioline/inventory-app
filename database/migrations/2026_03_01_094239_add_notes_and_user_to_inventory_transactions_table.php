<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('inventory_transactions', function (Blueprint $table) {
            if (! Schema::hasColumn('inventory_transactions', 'notes')) {
                $table->text('notes')->nullable()->after('reference_id');
            }
            if (! Schema::hasColumn('inventory_transactions', 'user_id')) {
                $table->unsignedBigInteger('user_id')->nullable()->after('notes');
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('inventory_transactions', function (Blueprint $table) {
            $table->dropColumnIfExists('notes');
            $table->dropColumnIfExists('user_id');
        });
    }
};
