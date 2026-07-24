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
        Schema::create('draft_master_products', function (Blueprint $table) {
            $table->id();

            // Proposed product data from import
            $table->string('proposed_name');
            $table->string('category')->nullable();
            $table->text('description')->nullable();
            $table->json('specifications')->nullable();
            $table->string('barcode')->nullable();
            $table->string('sku')->nullable();
            $table->string('supplier_name')->nullable();

            // Matching engine results
            $table->foreignId('matched_product_id')->nullable()
                ->constrained('master_products')
                ->onDelete('set null')
                ->comment('Product matched by the matching engine');

            $table->enum('match_confidence', ['exact', 'high', 'low', 'none'])
                ->default('none')
                ->comment('Confidence level of the match');

            // Workflow status
            $table->enum('status', ['pending', 'approved', 'rejected', 'merged'])
                ->default('pending')
                ->comment('Review status');

            $table->enum('user_action', ['create_new', 'link_existing', 'skip'])
                ->nullable()
                ->comment('User decision on how to handle this draft');

            // Metadata
            $table->foreignId('import_batch_id')->nullable()
                ->comment('Link to import batch if applicable');
            $table->foreignId('created_by')->nullable()
                ->constrained('users')
                ->comment('User who initiated the import');
            $table->text('notes')->nullable();

            $table->timestamps();

            // Indexes
            $table->index('status');
            $table->index('match_confidence');
            $table->index(['status', 'match_confidence']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('draft_master_products');
    }
};
