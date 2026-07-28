<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\Sku;

class ChannelController extends Controller
{
    /**
     * Keeps the inventory_locations row in sync with a sales channel.
     *
     * When $allowCreate is false (channel update + sync-locations), we only update an existing
     * linked location. That way a location the user deleted from Settings does not respawn
     * the next time sync-locations runs (e.g. opening a transfer dialog).
     */
    private function ensureLinkedLocation(Channel $channel, bool $allowCreate = true): array
    {
        $existing = InventoryLocation::query()
            ->where('channel_id', $channel->id)
            ->first();

        $payload = [
            'name' => $channel->name,
            'type' => 'channel',
            'is_active' => $channel->is_active !== false,
        ];

        if ($existing) {
            $existing->update($payload);

            return ['action' => 'updated', 'location_id' => $existing->id];
        }

        if (! $allowCreate) {
            return ['action' => 'skipped', 'location_id' => null];
        }

        $location = InventoryLocation::create(array_merge($payload, [
            'channel_id' => $channel->id,
            'is_main' => false,
            'wallet_balance' => 0,
        ]));

        return ['action' => 'created', 'location_id' => $location->id];
    }

    public function index()
    {
        return response()->json(Channel::all());
    }

    public function metrics()
    {
        $userId = auth()->id();

        $rows = Sku::query()
            ->select(
                'skus.channel_id',
                DB::raw('COUNT(DISTINCT skus.id) as products'),
                DB::raw('COALESCE(SUM(si.quantity), 0) as pieces'),
                DB::raw('COALESCE(SUM(si.quantity * skus.cost_price), 0) as purchase_cost')
            )
            ->leftJoin('sku_inventory as si', function ($join) use ($userId) {
                $join->on('si.sku_id', '=', 'skus.id');
                if ($userId) {
                    $join->where('si.user_id', '=', $userId);
                }
            })
            ->whereNotNull('skus.channel_id')
            ->groupBy('skus.channel_id')
            ->get();

        $map = [];
        foreach ($rows as $row) {
            $map[(string) $row->channel_id] = [
                'products' => (int) $row->products,
                'pieces' => (float) $row->pieces,
                'purchaseCost' => (float) $row->purchase_cost,
            ];
        }

        return response()->json($map);
    }

    public function store(Request $request)
    {
        $userId = optional($request->user())->id;
        $validated = $request->validate([
            'name' => 'required|string',
            'slug' => [
                'required',
                'string',
                Rule::unique('channels', 'slug')->when(
                    $userId,
                    fn ($rule) => $rule->where('user_id', $userId)
                ),
            ],
            'type' => 'nullable|string',
            'merchant_identifier' => 'nullable|string|max:100',
            'account_label' => 'nullable|string|max:100',
        ]);

        $user = $request->user();
        if ($user) {
            $validated['user_id'] = $user->id;
        }

        $channel = DB::transaction(function () use ($validated) {
            $created = Channel::create($validated);
            $this->ensureLinkedLocation($created);

            return $created;
        });

        return response()->json($channel, 201);
    }

    public function show(string $id)
    {
        return response()->json(Channel::findOrFail($id));
    }

    public function update(Request $request, string $id)
    {
        $channel = Channel::findOrFail($id);
        $userId = optional($request->user())->id;
        $validated = $request->validate([
            'name' => 'sometimes|string',
            'slug' => [
                'sometimes',
                'string',
                Rule::unique('channels', 'slug')
                    ->ignore($channel->id)
                    ->when(
                        $userId,
                        fn ($rule) => $rule->where('user_id', $userId)
                    ),
            ],
            'type' => 'nullable|string',
            'merchant_identifier' => 'nullable|string|max:100',
            'account_label' => 'nullable|string|max:100',
            'is_active' => 'nullable|boolean',
        ]);
        DB::transaction(function () use ($channel, $validated) {
            $channel->update($validated);
            $this->ensureLinkedLocation($channel->refresh(), false);
        });

        $channel = $channel->refresh();

        return response()->json($channel);
    }

    public function syncLocations()
    {
        $channels = Channel::query()->get();
        $created = 0;
        $updated = 0;

        $skipped = 0;

        foreach ($channels as $channel) {
            // IMPORTANT: do NOT recreate missing channel locations automatically.
            // If user deleted a channel warehouse from Settings, we treat it as intentional.
            // We only update metadata for existing linked rows.
            $result = $this->ensureLinkedLocation($channel, false);
            if (($result['action'] ?? '') === 'created') {
                $created++;
            } elseif (($result['action'] ?? '') === 'skipped') {
                $skipped++;
            } else {
                $updated++;
            }
        }

        return response()->json([
            'message' => 'Channel locations synced',
            'channels' => $channels->count(),
            'locations_created' => $created,
            'locations_updated' => $updated,
            'locations_skipped_no_row' => $skipped,
        ]);
    }

    public function getBySlug(string $slug)
    {
        $decodedSlug = urldecode($slug);
        $slugWithDashes = str_replace('/', '-', $decodedSlug);

        $channel = Channel::where('slug', $slug)
            ->orWhere('slug', $decodedSlug)
            ->orWhere('slug', $slugWithDashes)
            ->orWhere('name', $decodedSlug)
            ->first();

        // Partial Arabic / truncated URL segments (e.g. "التاجر") — prefer unique suffix match.
        if (! $channel && $decodedSlug !== '') {
            $like = '%'.$decodedSlug.'%';
            $matches = Channel::query()
                ->where(function ($q) use ($like) {
                    $q->where('slug', 'like', $like)->orWhere('name', 'like', $like);
                })
                ->orderBy('id')
                ->limit(5)
                ->get();
            if ($matches->count() === 1) {
                $channel = $matches->first();
            } elseif ($matches->count() > 1) {
                $channel = $matches->first(function ($c) use ($decodedSlug) {
                    return str_ends_with((string) $c->slug, $decodedSlug)
                        || str_ends_with((string) $c->name, $decodedSlug)
                        || str_contains((string) $c->slug, $decodedSlug);
                }) ?: $matches->first();
            }
        }

        if (! $channel) {
            abort(404);
        }

        // Only update an existing linked row — do NOT auto-create here. Otherwise deleting the
        // channel warehouse from Settings causes it to reappear the next time this endpoint runs
        // (e.g. opening the channel inventory page).
        $this->ensureLinkedLocation($channel, false);

        $linkedLocationId = InventoryLocation::query()
            ->where('channel_id', $channel->id)
            ->orderBy('id')
            ->value('id');

        return response()->json(array_merge(
            $channel->toArray(),
            ['linked_location_id' => $linkedLocationId]
        ));
    }

    public function destroy(string $id)
    {
        Channel::destroy($id);

        return response()->json(null, 204);
    }
}
