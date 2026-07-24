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
        // Cleanup partial migration
        Schema::disableForeignKeyConstraints();
        Schema::dropIfExists('withdrawals');
        Schema::dropIfExists('profit_distributions');
        Schema::dropIfExists('capital_sources');
        Schema::dropIfExists('settlements');
        Schema::dropIfExists('inventory_returns');
        Schema::dropIfExists('order_costs');
        Schema::dropIfExists('inventory_order_items');
        Schema::dropIfExists('inventory_orders');
        Schema::dropIfExists('inventory_transactions');
        Schema::dropIfExists('sku_inventory');
        Schema::dropIfExists('skus');
        Schema::dropIfExists('inventory_offers'); // Renamed from offers
        Schema::dropIfExists('master_products');
        Schema::dropIfExists('inventory_locations');
        Schema::dropIfExists('channels');
        Schema::enableForeignKeyConstraints();

        // Channels
        Schema::create('channels', function (Blueprint $table) {
            $table->id();
            $table->string('name'); // Amazon, Noon, etc.
            $table->string('type')->nullable(); // Default, FBA, FBM
            $table->string('slug')->unique();
            $table->boolean('is_active')->default(true);
            $table->json('credentials')->nullable();
            $table->timestamps();
        });

        // Inventory Locations
        Schema::create('inventory_locations', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('type'); // Warehouse, Amazon_FBA, Store
            $table->foreignId('channel_id')->nullable()->constrained('channels')->cascadeOnDelete();
            $table->string('address')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        // Master Products
        Schema::create('master_products', function (Blueprint $table) {
            $table->id();
            $table->string('internal_name');
            $table->string('category')->nullable();
            $table->json('specifications')->nullable(); // JSON specs
            $table->string('original_supplier')->nullable();
            $table->string('original_supplier_sku')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        // Inventory Offers (Renamed from offers)
        Schema::create('inventory_offers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('master_product_id')->constrained('master_products')->cascadeOnDelete();
            $table->string('name'); // e.g. "Knee Brace Single"
            $table->string('type')->default('single'); // single, bundle
            $table->json('components')->nullable(); // For bundles
            $table->timestamps();
        });

        // SKUs (Channel Specific Items)
        Schema::create('skus', function (Blueprint $table) {
            $table->id();
            // Reference inventory_offers instead of offers
            $table->foreignId('offer_id')->constrained('inventory_offers')->cascadeOnDelete();
            $table->string('sku')->unique();
            $table->string('marketplace_id')->nullable(); // ASIN, Noon ID
            $table->foreignId('channel_id')->nullable()->constrained('channels')->nullOnDelete();
            $table->decimal('cost_price', 10, 2)->default(0);
            $table->decimal('selling_price', 10, 2)->default(0);
            $table->timestamps();
        });

        // SKU Inventory
        Schema::create('sku_inventory', function (Blueprint $table) {
            $table->id();
            $table->foreignId('sku_id')->constrained('skus')->cascadeOnDelete();
            $table->foreignId('location_id')->constrained('inventory_locations')->cascadeOnDelete();
            $table->integer('quantity')->default(0);
            $table->integer('reserved')->default(0);
            $table->timestamps();
        });

        // Inventory Transactions
        Schema::create('inventory_transactions', function (Blueprint $table) { // To track movements
            $table->id();
            $table->foreignId('sku_id')->constrained('skus')->cascadeOnDelete();
            $table->foreignId('location_id')->constrained('inventory_locations')->cascadeOnDelete();
            $table->string('type'); // IN, OUT, TRANSFER, ADJUSTMENT
            $table->integer('quantity');
            $table->string('reference_type')->nullable(); // Order, Return, PO
            $table->string('reference_id')->nullable();
            $table->timestamps();
        });

        // Inventory Orders
        Schema::create('inventory_orders', function (Blueprint $table) {
            $table->id();
            $table->string('platform_order_id')->unique(); // Amazon/Noon Order ID
            $table->foreignId('channel_id')->constrained('channels')->cascadeOnDelete();
            $table->string('status');
            $table->dateTime('order_date');
            $table->string('customer_name')->nullable();
            $table->string('customer_email')->nullable();
            $table->string('currency')->default('EGP');
            $table->decimal('total_amount', 10, 2);
            $table->decimal('shipping_amount', 10, 2)->default(0);
            $table->decimal('tax_amount', 10, 2)->default(0);
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete(); // Link to main user if matched
            $table->timestamps();
        });

        // Order Items
        Schema::create('inventory_order_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('inventory_order_id')->constrained('inventory_orders')->cascadeOnDelete();
            $table->foreignId('sku_id')->nullable()->constrained('skus')->nullOnDelete();
            $table->string('sku_code'); // Store SKU code in case SKU is deleted
            $table->string('product_name');
            $table->integer('quantity');
            $table->decimal('unit_price', 10, 2);
            $table->decimal('total_price', 10, 2);
            $table->timestamps();
        });

        // Order Costs
        Schema::create('order_costs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('inventory_order_id')->constrained('inventory_orders')->cascadeOnDelete();
            $table->string('type'); // Commission, Shipping, Ad Fee, etc.
            $table->decimal('amount', 10, 2);
            $table->timestamps();
        });

        // Returns
        Schema::create('inventory_returns', function (Blueprint $table) {
            $table->id();
            $table->foreignId('inventory_order_id')->nullable()->constrained('inventory_orders')->nullOnDelete();
            $table->string('platform_return_id')->nullable();
            $table->string('status');
            $table->string('reason')->nullable();
            $table->string('disposition')->nullable(); // Sellable, Damaged
            $table->timestamps();
        });

        // Settlements
        Schema::create('settlements', function (Blueprint $table) {
            $table->id();
            $table->foreignId('channel_id')->constrained('channels')->cascadeOnDelete();
            $table->string('report_id')->unique();
            $table->date('start_date');
            $table->date('end_date');
            $table->decimal('total_amount', 10, 2);
            $table->string('status')->default('draft');
            $table->timestamps();
        });

        // Capital
        Schema::create('capital_sources', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('type'); // Investor, Loan, Company
            $table->decimal('amount', 15, 2)->default(0);
            $table->timestamps();
        });

        Schema::create('profit_distributions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('capital_source_id')->constrained('capital_sources')->cascadeOnDelete(); // Recipient
            $table->decimal('amount', 15, 2);
            $table->date('period_start');
            $table->date('period_end');
            $table->string('status')->default('pending');
            $table->timestamps();
        });

        Schema::create('withdrawals', function (Blueprint $table) {
            $table->id();
            $table->foreignId('capital_source_id')->constrained('capital_sources')->cascadeOnDelete();
            $table->decimal('amount', 15, 2);
            $table->string('reason');
            $table->string('status')->default('pending');
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('withdrawals');
        Schema::dropIfExists('profit_distributions');
        Schema::dropIfExists('capital_sources');
        Schema::dropIfExists('settlements');
        Schema::dropIfExists('inventory_returns');
        Schema::dropIfExists('order_costs');
        Schema::dropIfExists('inventory_order_items');
        Schema::dropIfExists('inventory_orders');
        Schema::dropIfExists('inventory_transactions');
        Schema::dropIfExists('sku_inventory');
        Schema::dropIfExists('skus');
        Schema::dropIfExists('inventory_offers');
        Schema::dropIfExists('master_products');
        Schema::dropIfExists('inventory_locations');
        Schema::dropIfExists('channels');
    }
};
