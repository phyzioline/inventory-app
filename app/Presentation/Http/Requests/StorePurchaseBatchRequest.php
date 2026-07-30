<?php

namespace App\Presentation\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StorePurchaseBatchRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $userId = (int) $this->user()->id;

        return [
            'supplier_id' => [
                'required',
                Rule::exists('suppliers', 'id')->where(fn ($q) => $q->where('user_id', $userId)),
            ],
            'location_id' => [
                'required',
                Rule::exists('inventory_locations', 'id')->where(fn ($q) => $q->where('user_id', $userId)),
            ],
            'reference_number' => 'nullable|string',
            'invoice_date' => 'nullable|date',
            'notes' => 'nullable|string',
            'items' => 'required|array|min:1',
            'items.*.master_product_id' => [
                'required',
                Rule::exists('master_products', 'id')->where(fn ($q) => $q->where('user_id', $userId)),
            ],
            'items.*.sku_id' => 'nullable|integer|min:1',
            'items.*.quantity' => 'required|numeric|min:0.01',
            'items.*.unit_price' => 'required|numeric|min:0',
        ];
    }
}
