<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;

class InventorySeeder extends Seeder
{
    public function run(): void
    {
        // 1. Create Channels
        $amazon = Channel::create([
            'name' => 'Amazon EG',
            'type' => 'FBA',
            'slug' => 'amazon-eg',
            'is_active' => true,
        ]);

        $noon = Channel::create([
            'name' => 'Noon',
            'type' => 'FBN',
            'slug' => 'noon-eg',
            'is_active' => true,
        ]);

        // 2. Create Warehouses
        $mainWh = InventoryLocation::create([
            'name' => 'Main Cairo Warehouse',
            'type' => 'Warehouse',
            'address' => 'Cairo, Egypt',
            'is_active' => true,
        ]);

        $amazonWh = InventoryLocation::create([
            'name' => 'Amazon FBA Warehouse',
            'type' => 'Amazon_FBA',
            'channel_id' => $amazon->id,
            'is_active' => true,
        ]);

        // 3. Create Master Products
        $product1 = MasterProduct::create([
            'internal_name' => 'Medical Knee Brace (Standard)',
            'category' => 'Orthopedics',
            'original_supplier' => 'MediCare Co.',
        ]);

        $product2 = MasterProduct::create([
            'internal_name' => 'Pulse Oximeter (OLED Display)',
            'category' => 'Electronics',
            'original_supplier' => 'ElectroMed',
        ]);

        // 4. Create Offers for Product 1
        $offer1 = InventoryOffer::create([
            'master_product_id' => $product1->id,
            'name' => 'Knee Brace - Single Pack',
            'type' => 'single',
        ]);

        // 5. Create SKUs for Offer 1
        $sku1 = Sku::create([
            'offer_id' => $offer1->id,
            'sku' => 'MED-KNEE-STD-AMZ',
            'marketplace_id' => 'B07VY8XYZ1',
            'channel_id' => $amazon->id,
            'cost_price' => 150.00,
            'selling_price' => 450.00,
        ]);

        // 6. Set Initial Stock
        SkuInventory::create([
            'sku_id' => $sku1->id,
            'location_id' => $mainWh->id,
            'quantity' => 100,
        ]);

        SkuInventory::create([
            'sku_id' => $sku1->id,
            'location_id' => $amazonWh->id,
            'quantity' => 25,
        ]);
    }
}
