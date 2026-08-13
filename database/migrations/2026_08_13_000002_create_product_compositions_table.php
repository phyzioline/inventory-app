<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Manual "Product B = N x Product A" links between InventoryOffers, powering the
 * manual Unpack/Pack stock-conversion action. Deliberately flat (a component may not
 * itself already be a parent of other compositions) — enforced at the application layer
 * in ProductCompositionService, not here.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('product_compositions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('parent_offer_id')->constrained('inventory_offers')->cascadeOnDelete();
            $table->foreignId('component_offer_id')->constrained('inventory_offers')->cascadeOnDelete();
            $table->unsignedInteger('quantity_per')->default(1);
            $table->string('notes', 255)->nullable();
            $table->timestamps();

            $table->unique(['user_id', 'parent_offer_id', 'component_offer_id'], 'product_compositions_unique_link');
            $table->index('parent_offer_id');
            $table->index('component_offer_id');
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE product_compositions ADD CONSTRAINT product_compositions_not_self_ck CHECK (parent_offer_id <> component_offer_id)');
            DB::statement('ALTER TABLE product_compositions ADD CONSTRAINT product_compositions_qty_positive_ck CHECK (quantity_per >= 1)');
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('product_compositions');
    }
};
