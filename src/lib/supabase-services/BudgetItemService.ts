import { supabase } from '../supabase';
import { type Database } from '../../types/supabase';
import { type BudgetItem } from '../../types/domain';

type BudgetItemRow = Database['public']['Tables']['budget_items']['Row'];
type BudgetItemInsert = Database['public']['Tables']['budget_items']['Insert'];

// ============================================================================
// REGRA 1: FONTE ÚNICA DE CÁLCULO - Valores vêm PRONTOS do backend
// O frontend NÃO recalcula valores, apenas calcula peso (%) dinamicamente
// ============================================================================

/**
 * ANTI-NaN Helper - Garante número válido
 */
function safeNumber(val: any): number {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return isNaN(val) || !isFinite(val) ? 0 : val;
    if (typeof val === 'string') {
        const clean = val.replace(/[R$\s.]/g, '').replace(',', '.');
        const num = parseFloat(clean);
        return isNaN(num) || !isFinite(num) ? 0 : num;
    }
    return 0;
}

/**
 * REGRA FRONTEND-ONLY: Calcula TODOS os valores no frontend
 * 
 * Esta função:
 * - Calcula finalPrice de itens: quantity * unitPrice * (1 + bdi/100)
 * - Calcula totalPrice sem BDI para referência
 * - Calcula totais de grupos (level 1 e 2) como SOMA dos filhos
 * - Calcula peso dinâmico de cada item
 * 
 * @param items - Itens do banco (apenas unitPrice e quantity garantidos)
 * @param bdi - BDI do orçamento em porcentagem (ex: 25 para 25%)
 */
export function prepareItemsForDisplay(items: BudgetItem[], bdi: number = 0): BudgetItem[] {
    if (!items || items.length === 0) return [];

    const bdiMultiplier = 1 + (safeNumber(bdi) / 100);
    const itemsCopy = items.map(i => ({ ...i }));

    // Passo 1: Calcular valores de itens reais (level 3+)
    itemsCopy.forEach((item, idx) => {
        if (item.level >= 3 && item.type !== 'group') {
            const qty = safeNumber(item.quantity);
            const unit = safeNumber(item.unitPrice);
            const totalPrice = Math.round(qty * unit * 100) / 100;
            const finalPrice = Math.round(totalPrice * bdiMultiplier * 100) / 100;

            itemsCopy[idx] = {
                ...item,
                totalPrice,
                finalPrice
            };
        }
    });

    // Passo 2: Calcular totais das subetapas (level 2) - SOMA dos filhos
    const level2Items = itemsCopy.filter(i => i.level === 2);
    level2Items.forEach(subetapa => {
        const children = itemsCopy.filter(i => i.parentId === subetapa.id && i.level >= 3);
        const totalPrice = children.reduce((acc, child) => acc + safeNumber(child.totalPrice), 0);
        const finalPrice = children.reduce((acc, child) => acc + safeNumber(child.finalPrice), 0);

        const itemIndex = itemsCopy.findIndex(i => i.id === subetapa.id);
        if (itemIndex >= 0) {
            itemsCopy[itemIndex] = {
                ...itemsCopy[itemIndex],
                totalPrice: Math.round(totalPrice * 100) / 100,
                finalPrice: Math.round(finalPrice * 100) / 100
            };
        }
    });

    // Passo 3: Calcular totais das etapas (level 1) - SOMA das subetapas
    const level1Items = itemsCopy.filter(i => i.level === 1);
    level1Items.forEach(etapa => {
        const children = itemsCopy.filter(i => i.parentId === etapa.id && i.level === 2);
        const totalPrice = children.reduce((acc, child) => acc + safeNumber(child.totalPrice), 0);
        const finalPrice = children.reduce((acc, child) => acc + safeNumber(child.finalPrice), 0);

        const itemIndex = itemsCopy.findIndex(i => i.id === etapa.id);
        if (itemIndex >= 0) {
            itemsCopy[itemIndex] = {
                ...itemsCopy[itemIndex],
                totalPrice: Math.round(totalPrice * 100) / 100,
                finalPrice: Math.round(finalPrice * 100) / 100
            };
        }
    });

    // Passo 4: Calcular total global (APENAS itens level 3+)
    const totalGlobal = itemsCopy
        .filter(i => i.level >= 3 && i.type !== 'group')
        .reduce((acc, i) => acc + safeNumber(i.finalPrice), 0);

    // Passo 5: Calcular peso dinâmico de cada item
    const itemsWithPeso = itemsCopy.map(item => {
        const itemFinalPrice = safeNumber(item.finalPrice);
        const peso = totalGlobal > 0 ? (itemFinalPrice / totalGlobal) : 0;
        const safePeso = isNaN(peso) || !isFinite(peso) ? 0 : peso;
        return { ...item, peso: safePeso };
    });

    return itemsWithPeso;
}

// Manter compatibilidade com código existente (alias)
export const recalculateItemHierarchy = (items: BudgetItem[], _bdi: number): BudgetItem[] => {
    // BDI ignorado pois valores já vêm do backend com BDI aplicado
    return prepareItemsForDisplay(items);
};

// Função para uso apenas em ajuste global (quando realmente precisa recalcular)
export function calculateItemValues(
    quantity: number,
    unitPrice: number,
    bdi: number
): { totalPrice: number; finalPrice: number } {
    const qty = safeNumber(quantity);
    const unit = safeNumber(unitPrice);
    const bdiMultiplier = 1 + (safeNumber(bdi) / 100);

    const totalPrice = Math.round(qty * unit * 100) / 100;
    const finalPrice = Math.round(totalPrice * bdiMultiplier * 100) / 100;

    return { totalPrice, finalPrice };
}

function toDomain(row: BudgetItemRow): BudgetItem {
    return {
        id: row.id,
        budgetId: row.budget_id,
        parentId: row.parent_id,
        order: row.order_index,
        level: row.level,
        itemNumber: row.item_number || '',
        code: row.code || '',
        description: row.description,
        unit: row.unit || '',
        quantity: row.quantity,
        unitPrice: row.unit_price,
        finalPrice: row.final_price || row.unit_price,
        totalPrice: row.total_price,
        type: row.type as any,
        source: row.source as any,
        itemType: (row.item_type as any) || undefined,
        compositionId: row.composition_id || undefined,
        insumoId: row.insumo_id || undefined,
        calculationMemory: row.calculation_memory || undefined,
        calculationSteps: row.calculation_steps || undefined,
        customBDI: row.custom_bdi || undefined,
        costCenter: row.cost_center || undefined,
        isLocked: row.is_locked || false,
        notes: row.notes || undefined,
        isDesonerated: row.is_desonerated || false,
        updatedAt: new Date(row.updated_at),
    };
}

function toInsert(item: Partial<BudgetItem>): Omit<BudgetItemInsert, 'user_id' | 'budget_id'> & { budget_id: string } {
    return {
        budget_id: item.budgetId!,
        parent_id: item.parentId,
        order_index: item.order!,
        level: item.level!,
        item_number: item.itemNumber,
        code: item.code,
        description: item.description!,
        unit: item.unit,
        quantity: item.quantity ?? 1,
        unit_price: item.unitPrice ?? 0,
        final_price: item.finalPrice ?? item.unitPrice ?? 0, // Garante que nunca seja null
        total_price: item.totalPrice ?? 0,
        type: item.type,
        source: item.source,
        item_type: item.itemType,
        composition_id: item.compositionId,
        insumo_id: item.insumoId,
        calculation_memory: item.calculationMemory,
        calculation_steps: item.calculationSteps,
        custom_bdi: item.customBDI,
        cost_center: item.costCenter,
        is_locked: item.isLocked,
        notes: item.notes,
        is_desonerated: item.isDesonerated,
        updated_at: new Date().toISOString(),
    };
}

export const BudgetItemService = {
    async getByBudgetId(
        budgetId: string,
        opts?: { pageSize?: number; onProgress?: (loaded: number, total: number) => void }
    ): Promise<BudgetItem[]> {
        const pageSize = opts?.pageSize || 1000;
        let currentSize = pageSize;
        let offset = 0;
        let allItems: any[] = [];
        let totalCount = 0;

        // Explicit column selection to prevent 502s on large payloads (select *)
        // Includes all columns used by toDomain and the Editor
        const columns = `
            id, budget_id, parent_id, order_index, level, item_number, code, description,
            unit, quantity, unit_price, final_price, total_price, type, source, item_type,
            composition_id, insumo_id, calculation_memory, calculation_steps, custom_bdi,
            cost_center, is_locked, notes, is_desonerated, updated_at
        `.replace(/\s+/g, '');

        while (true) {
            try {
                // Request count only on first page to allow progress tracking
                const countOpt = (offset === 0) ? { count: 'exact' as const } : undefined;

                const { data, error, count } = await supabase
                    .from('budget_items')
                    .select(columns, countOpt)
                    .eq('budget_id', budgetId)
                    .order('order_index', { ascending: true })
                    .range(offset, offset + currentSize - 1);

                if (error) throw error;

                if (offset === 0 && count !== null) {
                    totalCount = count;
                }

                if (data) {
                    allItems = allItems.concat(data);
                    offset += data.length;

                    if (opts?.onProgress) {
                        opts.onProgress(allItems.length, totalCount || allItems.length);
                    }

                    // Stop if we reached end of list
                    if (data.length < currentSize) break;
                } else {
                    break;
                }
            } catch (err) {
                console.warn(`[BudgetItemService] Fetch failed at offset ${offset} (size ${currentSize}).`, err);

                // Fallback: Retry once with smaller page size if we haven't already
                if (currentSize === pageSize && currentSize > 200) {
                    console.log(`[BudgetItemService] Retrying with half page size...`);
                    currentSize = Math.floor(currentSize / 2);
                    continue; // Retry same offset with smaller batch
                }

                throw err; // Give up if already reduced or too small
            }
        }

        return allItems.map(toDomain);
    },

    async create(item: Partial<BudgetItem>): Promise<BudgetItem> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            alert("Sessão expirada. Por favor, faça login novamente.");
            throw new Error('Usuário não autenticado');
        }

        // Validação de segurança: IDs do Supabase devem ser strings UUID
        if (!item.budgetId || (typeof item.budgetId === 'string' && item.budgetId.length < 10)) {
            const msg = `ID do Orçamento inválido (${item.budgetId}). Este orçamento parece ser local e precisa ser migrado para o Supabase antes de adicionar itens.`;
            alert(msg);
            throw new Error(msg);
        }

        const payload = {
            ...toInsert(item),
            user_id: user.id,
            created_at: new Date().toISOString()
        };

        const { data, error } = await (supabase
            .from('budget_items') as any)
            .insert(payload)
            .select()
            .single();

        if (error) {
            console.error("Erro Supabase ao Criar Item:", error);
            alert(`Erro no Banco de Dados: ${error.message}\n\nCódigo: ${error.code}\nDetalhe: ${error.details || 'Verifique as permissões de acesso.'}`);
            throw error;
        }
        return toDomain(data);
    },

    async update(id: string, item: Partial<BudgetItem>): Promise<BudgetItem> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Usuário não autenticado');

        const payload: any = {
            updated_at: new Date().toISOString(),
        };

        if (item.parentId !== undefined) payload.parent_id = item.parentId;
        if (item.order !== undefined) payload.order_index = item.order;
        if (item.description !== undefined) payload.description = item.description;
        if (item.quantity !== undefined) payload.quantity = item.quantity;
        if (item.unitPrice !== undefined) payload.unit_price = item.unitPrice;
        if (item.finalPrice !== undefined) payload.final_price = item.finalPrice;
        if (item.totalPrice !== undefined) payload.total_price = item.totalPrice;
        if (item.itemNumber !== undefined) payload.item_number = item.itemNumber;

        const { data, error } = await (supabase
            .from('budget_items') as any)
            .update(payload)
            .eq('id', id)
            .eq('user_id', user.id)
            .select()
            .single();

        if (error) throw error;
        return toDomain(data);
    },

    async delete(id: string): Promise<void> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Usuário não autenticado');

        const { error } = await supabase
            .from('budget_items')
            .delete()
            .eq('id', id)
            .eq('user_id', user.id);

        if (error) throw error;
    },

    async batchCreate(items: Partial<BudgetItem>[]): Promise<BudgetItem[]> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Usuário não autenticado');

        const payloads = items.map(item => ({
            ...toInsert(item),
            user_id: user.id,
            created_at: new Date().toISOString()
        }));

        const { data, error } = await (supabase
            .from('budget_items') as any)
            .insert(payloads)
            .select();

        if (error) throw error;
        return data.map(toDomain);
    },

    async batchDelete(ids: string[]): Promise<void> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Usuário não autenticado');

        const { error } = await supabase
            .from('budget_items')
            .delete()
            .in('id', ids)
            .eq('user_id', user.id);

        if (error) throw error;
    },

    async batchUpdate(items: Partial<BudgetItem>[]): Promise<void> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Usuário não autenticado');

        for (const item of items) {
            if (!item.id) continue;

            const payload: any = {
                updated_at: new Date().toISOString()
            };

            if (item.unitPrice !== undefined) payload.unit_price = item.unitPrice;
            if (item.finalPrice !== undefined) payload.final_price = item.finalPrice;
            if (item.totalPrice !== undefined) payload.total_price = item.totalPrice;

            const { error } = await supabase
                .from('budget_items')
                .update(payload)
                .eq('id', item.id)
                .eq('user_id', user.id);

            if (error) {
                console.error(`[batchUpdate] Erro ao atualizar item ${item.id}:`, error);
                throw error;
            }
        }
    }
};
