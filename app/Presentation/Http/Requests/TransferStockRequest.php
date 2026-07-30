<?php

namespace App\Presentation\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class TransferStockRequest extends FormRequest
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
        return [
            'sku_id' => 'required|exists:skus,id',
            'to_sku_id' => 'nullable|exists:skus,id',
            'from_location_id' => 'required|exists:inventory_locations,id',
            'to_location_id' => 'required|exists:inventory_locations,id|different:from_location_id',
            'quantity' => 'required|integer|min:1',
            'notes' => 'nullable|string',
            'client_transfer_id' => 'nullable|string|max:80',
        ];
    }
}
