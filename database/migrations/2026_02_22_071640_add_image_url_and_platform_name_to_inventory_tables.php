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
        Schema::table('master_products', function (Blueprint $table) {
            $table->string('image_url')->nullable()->after('category');
        });

        Schema::table('skus', function (Blueprint $table) {
            $table->string('name')->nullable()->after('offer_id');
            $table->string('image_url')->nullable()->after('selling_price');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('skus', function (Blueprint $table) {
            $table->dropColumn(['name', 'image_url']);
        });

        Schema::table('master_products', function (Blueprint $table) {
            $table->dropColumn('image_url');
        });
    }
};
