<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // ── Upload records ──────────────────────────────────────
        Schema::create('purchase_uploads', function (Blueprint $table) {
            $table->id();
            $table->string('upload_id')->unique(); // UUID
            $table->foreignId('user_id')->constrained()->onDelete('cascade');
            $table->string('original_filename');
            $table->string('file_path'); // storage path
            $table->string('file_type'); // pdf, jpg, png, xlsx
            $table->bigInteger('file_size')->default(0);
            $table->text('raw_text')->nullable(); // extracted text
            $table->json('ai_structured_data')->nullable(); // AI parsed JSON
            $table->enum('extraction_status', ['pending', 'extracting', 'extracted', 'ai_parsing', 'parsed', 'failed'])->default('pending');
            $table->text('error_message')->nullable();
            $table->timestamps();
        });

        // ── Purchase batches ────────────────────────────────────
        Schema::create('purchase_batches', function (Blueprint $table) {
            $table->id();
            $table->string('batch_number')->unique(); // PB-2026-0001
            $table->foreignId('purchase_upload_id')->nullable()->constrained('purchase_uploads')->nullOnDelete();
            $table->foreignId('user_id')->constrained()->onDelete('cascade');

            // Supplier link
            $table->foreignId('vendor_id')->nullable()->constrained('vendors')->nullOnDelete();
            $table->string('supplier_name_raw')->nullable(); // from AI extraction
            $table->boolean('supplier_matched')->default(false);

            // Invoice info
            $table->string('invoice_number')->nullable();
            $table->date('invoice_date')->nullable();
            $table->string('currency', 10)->default('EGP');

            // Totals
            $table->decimal('subtotal', 14, 2)->default(0);
            $table->decimal('tax_amount', 14, 2)->default(0);
            $table->decimal('grand_total', 14, 2)->default(0);

            // Status workflow
            $table->enum('status', ['draft', 'review', 'approved', 'receiving', 'received', 'cancelled'])->default('draft');

            // Receiving
            $table->foreignId('location_id')->nullable()->constrained('inventory_locations')->nullOnDelete();
            $table->timestamp('received_at')->nullable();
            $table->text('notes')->nullable();

            $table->timestamps();
        });

        // ── Batch line items ────────────────────────────────────
        Schema::create('purchase_batch_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('purchase_batch_id')->constrained('purchase_batches')->onDelete('cascade');

            // Product matching
            $table->foreignId('master_product_id')->nullable()->constrained('master_products')->nullOnDelete();
            $table->foreignId('sku_id')->nullable()->constrained('skus')->nullOnDelete();
            $table->string('raw_description')->nullable(); // from AI
            $table->boolean('product_matched')->default(false);

            // Quantities
            $table->decimal('quantity', 14, 2)->default(0);
            $table->decimal('received_quantity', 14, 2)->nullable(); // actual received
            $table->decimal('unit_price', 14, 2)->default(0);
            $table->decimal('total_price', 14, 2)->default(0);

            // Variance
            $table->decimal('variance_quantity', 14, 2)->nullable();
            $table->text('variance_notes')->nullable();

            // Batch cost tracking
            $table->string('batch_cost_id')->nullable(); // for FIFO/batch cost tracking

            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('purchase_batch_items');
        Schema::dropIfExists('purchase_batches');
        Schema::dropIfExists('purchase_uploads');
    }
};
