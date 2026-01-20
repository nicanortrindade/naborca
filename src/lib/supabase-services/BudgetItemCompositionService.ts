import { supabase } from '../supabase';
import { type Database } from '../../types/supabase';
import { type BudgetItemComposition } from '../../types/domain';

type Row = Database['public']['Tables']['budget_item_compositions']['Row'];
type Insert = Database['public']['Tables']['budget_item_compositions']['Insert'];

function toDomain(row: Row): BudgetItemComposition {
    const meta = (row as any).metadata || {};
    const basePrice = row.unit_price;
    let effectivePrice = basePrice;

    // Logic: Amount takes precedence (or is exclusive strategy)
    if (meta.adjustment_amount !== undefined && meta.adjustment_amount !== null) {
        effectivePrice = basePrice + (Number(meta.adjustment_amount) || 0);
    } else if (meta.adjustment_factor !== undefined && meta.adjustment_factor !== null) {
        effectivePrice = basePrice * (Number(meta.adjustment_factor) || 1);
    }

    return {
        id: row.id,
        budgetItemId: row.budget_item_id,
        description: row.description,
        unit: row.unit || '',
        quantity: row.quantity,
        unitPrice: effectivePrice,
        baseUnitPrice: basePrice,
        totalPrice: effectivePrice * row.quantity,
        type: row.type as any,
        updatedAt: new Date(row.updated_at),
        metadata: meta
    };
}

function toInsert(item: Partial<BudgetItemComposition>): any {
    return {
        budget_item_id: item.budgetItemId!,
        description: item.description!,
        unit: item.unit || '',
        quantity: item.quantity || 1,
        unit_price: item.unitPrice || 0,
        total_price: item.totalPrice || 0,
        type: item.type as any || 'material',
        updated_at: new Date().toISOString(),
        metadata: item.metadata
    };
}

export const BudgetItemCompositionService = {
    async getByBudgetItemId(budgetItemId: string): Promise<BudgetItemComposition[]> {
        const { data, error } = await supabase
            .from('budget_item_compositions')
            .select('*')
            .eq('budget_item_id', budgetItemId);

        if (error) throw error;
        return data.map(toDomain);
    },

    async create(item: Partial<BudgetItemComposition>): Promise<BudgetItemComposition> {
        const { data, error } = await (supabase
            .from('budget_item_compositions') as any)
            .insert(toInsert(item))
            .select()
            .single();

        if (error) throw error;
        return toDomain(data);
    },

    async update(id: string, item: Partial<BudgetItemComposition>): Promise<BudgetItemComposition> {
        // Map camelCase to snake_case for the payload
        const dbPayload: any = {
            updated_at: new Date().toISOString()
        };
        if (item.description !== undefined) dbPayload.description = item.description;
        if (item.unit !== undefined) dbPayload.unit = item.unit;
        if (item.quantity !== undefined) dbPayload.quantity = item.quantity;
        if (item.unitPrice !== undefined) dbPayload.unit_price = item.unitPrice;
        if (item.totalPrice !== undefined) dbPayload.total_price = item.totalPrice;
        if (item.type !== undefined) dbPayload.type = item.type;
        if (item.metadata !== undefined) dbPayload.metadata = item.metadata;

        const { data, error } = await (supabase
            .from('budget_item_compositions') as any)
            .update(dbPayload)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        return toDomain(data);
    },

    async delete(id: string): Promise<void> {
        const { error } = await supabase
            .from('budget_item_compositions')
            .delete()
            .eq('id', id);

        if (error) throw error;
    },

    async deleteByBudgetItemId(budgetItemId: string): Promise<void> {
        const { error } = await supabase
            .from('budget_item_compositions')
            .delete()
            .eq('budget_item_id', budgetItemId);

        if (error) throw error;
    },

    async batchCreate(items: Partial<BudgetItemComposition>[]): Promise<BudgetItemComposition[]> {
        const payloads = items.map(toInsert);
        const { data, error } = await (supabase
            .from('budget_item_compositions') as any)
            .insert(payloads)
            .select();

        if (error) throw error;
        return data.map(toDomain);
    }
};
