<?php

namespace App\Presentation\Http\Requests;

use App\Application\Services\InventoryAbilityService;
use Illuminate\Foundation\Http\FormRequest;

class MarketplaceImportRequest extends FormRequest
{
    public function authorize(): bool
    {
        if ($this->user() === null) {
            return false;
        }

        return app(InventoryAbilityService::class)->can('marketplace.import');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $lockChannel = $this->boolean('lock_channel', false);

        return [
            'channel_id' => ($lockChannel ? 'required' : 'nullable').'|exists:channels,id',
            'file' => 'required|file|mimes:csv,txt,xlsx,xls',
            'lock_channel' => 'nullable|boolean',
            'async' => 'nullable|boolean',
        ];
    }
}
