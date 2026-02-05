import { supabase } from '../supabase';
import { type Database } from '../../types/supabase';
import { type BudgetItem } from '../../types/domain';

type BudgetItemRow = Database['public']['Tables']['budget_items']['Row'];


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

// ============================================================================
// REGRA 0: SSOT - Colunas compatíveis com o schema atual
// Evita erros de PostgREST por colunas inexistentes (ex: final_price, total_price)
// ============================================================================
export const BUDGET_ITEMS_SELECT = `
    id, budget_id, parent_id, order_index, level, item_number, code, description,
    unit, quantity, unit_price, total_price, final_price, type, source, item_type,
    composition_id, insumo_id, custom_bdi, cost_center, notes, hydration_status,
    calculation_memory, calculation_steps, is_locked, is_desonerated, updated_at
`.replace(/\s+/g, '');

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
        // Alinhado ao schema REAL (sem coluna 'total')
        finalPrice: row.final_price ?? row.unit_price,
        totalPrice: row.total_price ?? 0,
        type: (row.type as any) || 'material',
        source: (row.source as any) || 'OWN',
        itemType: (row.item_type as any) || undefined,
        calculationMemory: row.calculation_memory || undefined,
        calculationSteps: row.calculation_steps || undefined,
        isLocked: row.is_locked || false,
        isDesonerated: row.is_desonerated || false,
        updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
    };
}

function toInsert(item: Partial<BudgetItem>): any {
    const payload: any = {
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
        total_price: item.totalPrice ?? (item.quantity ?? 1) * (item.unitPrice ?? 0),
        final_price: item.finalPrice ?? item.totalPrice ?? (item.quantity ?? 1) * (item.unitPrice ?? 0),
        type: item.type || 'material',
        source: item.source || 'OWN',
        item_type: item.itemType,
        calculation_memory: item.calculationMemory,
        calculation_steps: item.calculationSteps,
        is_locked: item.isLocked,
        is_desonerated: item.isDesonerated,
        updated_at: new Date().toISOString(),
    };
    return payload;
}

export const BudgetItemService = {
    async getByBudgetId(
        budgetId: string,
        opts?: { pageSize?: number; onProgress?: (loaded: number, total: number) => void }
    ): Promise<BudgetItem[]> {
        // Initial setup
        const INITIAL_PAGE_SIZE = opts?.pageSize || 1000;
        let currentSize = INITIAL_PAGE_SIZE;
        let offset = 0;
        let allItems: any[] = [];

        while (true) {
            try {
                // Fetch next batch using SSOT select
                const { data, error } = await supabase
                    .from('budget_items')
                    .select(BUDGET_ITEMS_SELECT)
                    .eq('budget_id', budgetId)
                    .range(offset, offset + currentSize - 1);

                if (error) throw error;

                if (data && data.length > 0) {
                    allItems = allItems.concat(data);
                    offset += data.length;

                    // Progress update (Total is unknown since we removed count)
                    if (opts?.onProgress) {
                        opts.onProgress(allItems.length, 0); // 0 indicates unknown total
                    }

                    // Stop if we got less than requested, meaning end of list
                    if (data.length < currentSize) break;
                } else {
                    // Empty data/null means done
                    break;
                }

                // If success, try to restore page size slightly if it was reduced?
                // For safety/simplicity, we keep currentSize stable or let it stay reduced to be safe.

            } catch (err: any) {
                console.warn(`[BudgetItemService] Fetch failed at offset ${offset} (size ${currentSize}).`, err);

                // ADAPTIVE RETRY LOGIC
                // Reduce page size by half
                const newSize = Math.floor(currentSize / 2);

                if (newSize >= 100) {
                    console.log(`[BudgetItemService] Retrying with size ${newSize}...`);
                    currentSize = newSize;
                    continue; // Retry SAME offset with smaller batch
                }

                // If already at minimum size, allow failure to propagate
                console.error(`[BudgetItemService] Failed even with min size. Aborting.`);
                throw err;
            }
        }

        // CLIENT-SIDE SORT (Critical since we removed server sort)
        // Must maintain order_index stability
        allItems.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));

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
        if (item.totalPrice !== undefined) payload.total_price = item.totalPrice;
        if (item.finalPrice !== undefined) payload.final_price = item.finalPrice;
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
            if (item.totalPrice !== undefined) payload.total_price = item.totalPrice;
            if (item.finalPrice !== undefined) payload.final_price = item.finalPrice;

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
