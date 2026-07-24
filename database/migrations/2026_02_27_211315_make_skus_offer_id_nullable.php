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
        Schema::table('skus', function (Blueprint $table) {
            $table->dropForeign(['offer_id']);
        });
        Schema::table('skus', function (Blueprint $table) {
            $table->unsignedBigInteger('offer_id')->nullable()->change();
            $table->foreign('offer_id')->references('id')->on('inventory_offers')->nullOnDelete();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('skus', function (Blueprint $table) {
            $table->dropForeign(['offer_id']);
        });
        Schema::table('skus', function (Blueprint $table) {
            $table->unsignedBigInteger('offer_id')->nullable(false)->change();
            $table->foreign('offer_id')->references('id')->on('inventory_offers')->cascadeOnDelete();
        });
    }
};
