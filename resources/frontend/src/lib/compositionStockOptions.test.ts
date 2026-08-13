import { describe, expect, it } from 'vitest';
import {
    buildCompositionSkuLocationOptions,
    pickCompositionDestOption,
    pickCompositionSourceOption,
} from '@/lib/compositionStockOptions';

const shopChannel = { id: 5, name: 'المحل', type: 'pos', slug: 'المحل' };
const merchantChannel = { id: 4, name: 'امازون فيزيولاين  التاجر', type: 'amazon_merchant', slug: 'امازون-فيزيولاين-التاجر' };
const shopLoc = { id: 16, name: 'المحل', type: 'physical', channel_id: null };
const cairoLoc = { id: 1, name: 'Main Cairo Warehouse', type: 'warehouse', channel_id: null };
const merchantLoc = { id: 22, name: 'امازون فيزيولاين  التاجر', type: 'channel', channel_id: 4 };

describe('compositionStockOptions', () => {
    it('drops merchant phantom listings and keeps shop warehouse rows including qty 0', () => {
        const options = buildCompositionSkuLocationOptions({
            skus: [
                {
                    id: 14249,
                    sku: 'PHY422',
                    channel: shopChannel,
                    inventory: [
                        { location_id: 1, quantity: 8, location: cairoLoc },
                        { location_id: 16, quantity: 0, location: shopLoc },
                    ],
                },
                {
                    id: 7912,
                    sku: '75-QB8D-3MQX',
                    channel: merchantChannel,
                    inventory: [{ location_id: 22, quantity: 0, location: merchantLoc }],
                },
            ],
        });

        expect(options.map((o) => o.value)).toEqual(['14249:1', '14249:16']);
        expect(options.find((o) => o.locationId === '16')?.qty).toBe(0);
    });

    it('defaults dest to the same warehouse even when that row has 0 and another warehouse has stock', () => {
        const singles = buildCompositionSkuLocationOptions({
            skus: [{
                id: 14389,
                sku: 'SKUPHY-6455',
                channel: shopChannel,
                inventory: [{ location_id: 16, quantity: 96, location: shopLoc }],
            }],
        });
        const packs = buildCompositionSkuLocationOptions({
            skus: [{
                id: 14249,
                sku: 'PHY422',
                channel: shopChannel,
                inventory: [
                    { location_id: 1, quantity: 8, location: cairoLoc },
                    { location_id: 16, quantity: 0, location: shopLoc },
                ],
            }],
        });

        const source = pickCompositionSourceOption(singles);
        expect(source?.locationId).toBe('16');

        const dest = pickCompositionDestOption(packs, source?.locationId);
        expect(dest?.value).toBe('14249:16');
        expect(dest?.locationName).toBe('المحل');
    });

    it('falls back to highest shop qty when dest has no row at the source warehouse', () => {
        const dest = pickCompositionDestOption(
            [
                { value: 'a:1', label: 'a', qty: 8, skuId: 'a', locationId: '1', locationName: 'Cairo', kind: 'shop' },
                { value: 'a:99', label: 'a', qty: 2, skuId: 'a', locationId: '99', locationName: 'Other', kind: 'shop' },
            ],
            '16',
        );
        expect(dest?.value).toBe('a:1');
    });
});
