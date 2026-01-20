import type { BudgetItem } from '../types/domain';

export interface CalculatedItem {
    id: string;
    // Valores Base (Sem BDI) - Quantidade * Unitário
    baseUnit: number;
    baseTotal: number;

    // Valores Finais (Com BDI) - Base * (1 + BDI)
    finalUnit: number;
    finalTotal: number;

    // Percentuais (em relação ao Total Global Final)
    weight: number; // 0-100

    // Metadados
    level: number;
    isGroup: boolean;
}

export interface BudgetCalculationResult {
    itemMap: Map<string, CalculatedItem>;
    totalGlobalBase: number;
    totalGlobalFinal: number;
    bdiMultiplier: number;
}

/**
 * Corrige hierarquia de itens (Virtual Parenting)
 * Essencial para itens importados via planilha que podem vir sem parentId explícito.
 */
export function repairHierarchy(items: BudgetItem[]): BudgetItem[] {
    if (!items) return [];

    // Sort by order index
    const sorted = [...items].sort((a, b) => (a.order || 0) - (b.order || 0));

    let lastL1: BudgetItem | null = null;
    let lastL2: BudgetItem | null = null;

    return sorted.map(item => {
        const newItem = { ...item };

        if (newItem.level === 1) {
            lastL1 = newItem;
            lastL2 = null;
        } else if (newItem.level === 2) {
            lastL2 = newItem;
            if (!newItem.parentId && lastL1) newItem.parentId = lastL1.id;
        } else if (newItem.level >= 3) {
            if (!newItem.parentId && lastL2) newItem.parentId = lastL2.id;
            // Fallback: se não tiver L2, tenta ligar no L1 (incomum mas possível)
            else if (!newItem.parentId && lastL1) newItem.parentId = lastL1.id;
        }
        return newItem;
    });
}

/**
 * Normaliza um valor numérico para evitar NaN
 */
const safeNum = (val: any): number => {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return isNaN(val) || !isFinite(val) ? 0 : val;
    if (typeof val === 'string') {
        const clean = val.replace(/[R$\s.]/g, '').replace(',', '.');
        const num = parseFloat(clean);
        return isNaN(num) || !isFinite(num) ? 0 : num;
    }
    return 0;
};

/**
 * ENGINE DE CÁLCULO PURO
 * Fonte única da verdade para todos os cálculos do orçamento.
 * 
 * Regras:
 * 1. Calcula itens (Level 3+) a partir de Qty e UnitPrice.
 * 2. Agrega Subetapas (Level 2) somando filhos diretos.
 * 3. Agrega Etapas (Level 1) somando filhos diretos (Subetapas).
 * 4. Calcula Total Global somando Etapas.
 * 5. Calcula Pesos baseados no Total Global Final.
 */
export function calculateBudget(items: BudgetItem[], bdiPercent: number): BudgetCalculationResult {
    const bdiMultiplier = 1 + (safeNum(bdiPercent) / 100);
    const itemMap = new Map<string, CalculatedItem>();

    // Mapa auxiliar para agrupar filhos por pai
    const childrenByParent = new Map<string, BudgetItem[]>();

    // 1. Indexar e Calcular Básicos (L3+)
    items.forEach(item => {
        if (item.parentId) {
            if (!childrenByParent.has(item.parentId)) childrenByParent.set(item.parentId, []);
            childrenByParent.get(item.parentId)!.push(item);
        }

        const isGroup = item.level < 3 || item.type === 'group' || (item as any).type === 'etapa' || (item as any).type === 'subetapa';

        let baseUnit = 0;
        let baseTotal = 0;
        let finalUnit = 0;
        let finalTotal = 0;

        if (!isGroup) {
            const qty = safeNum(item.quantity);
            const unit = safeNum(item.unitPrice);

            baseUnit = unit;
            baseTotal = qty * unit;

            finalUnit = baseUnit * bdiMultiplier;
            finalTotal = baseTotal * bdiMultiplier;
        }

        itemMap.set(item.id!, {
            id: item.id!,
            baseUnit,
            baseTotal,
            finalUnit,
            finalTotal,
            weight: 0, // Será calculado depois
            level: item.level || 3,
            isGroup: !!isGroup
        });
    });

    // 2. Calcular Agregações - Subetapas (L2)
    // Precisamos garantir ordem bottom-up ou simplesmente filtrar por level.
    // Como L2 depende de L3, calculamos L2 primeiro (baseado nos L3 já calculados no passo anterior).

    const l2Items = items.filter(i => i.level === 2);
    l2Items.forEach(sub => {
        const children = items.filter(i => i.parentId === sub.id && i.level >= 3); // Filhos diretos itens

        let subBaseTotal = 0;
        let subFinalTotal = 0;

        children.forEach(child => {
            const childCalc = itemMap.get(child.id!);
            if (childCalc) {
                subBaseTotal += childCalc.baseTotal;
                subFinalTotal += childCalc.finalTotal;
            }
        });

        const subCalc = itemMap.get(sub.id!);
        if (subCalc) {
            subCalc.baseTotal = subBaseTotal;
            subCalc.finalTotal = subFinalTotal;
            // Unitário de grupo não existe ou é igual ao total? Geralmente vazio.
        }
    });

    // 3. Calcular Agregações - Etapas (L1)
    const l1Items = items.filter(i => i.level === 1);
    let totalGlobalBase = 0;
    let totalGlobalFinal = 0;

    l1Items.forEach(etapa => {
        // Filhos diretos podem ser Subetapas (L2) OU Itens (L3) órfãos/diretos?
        // Assumindo estrutura estrita L1 -> L2. Mas o sistema permite L1 -> L3?
        // Vamos somar todos os filhos diretos baseados no map calculated.

        const children = items.filter(i => i.parentId === etapa.id);

        let etapaBaseTotal = 0;
        let etapaFinalTotal = 0;

        children.forEach(child => {
            const childCalc = itemMap.get(child.id!);
            if (childCalc) {
                etapaBaseTotal += childCalc.baseTotal;
                etapaFinalTotal += childCalc.finalTotal;
            }
        });

        const etapaCalc = itemMap.get(etapa.id!);
        if (etapaCalc) {
            etapaCalc.baseTotal = etapaBaseTotal;
            etapaCalc.finalTotal = etapaFinalTotal;

            totalGlobalBase += etapaBaseTotal;
            totalGlobalFinal += etapaFinalTotal;
        }
    });

    // Se houver itens soltos no nível raiz (sem pai) que não são L1 (erro de estrutura?),
    // idealmente deveríamos somar. Mas vamos focar na soma das Etapas (L1) como Global.
    // Ajuste: Total Global deve ser a soma de todos os itens L3+ para garantir precisão, independente da hierarquia visual?
    // Regra de negócio: Orçamento = Soma das Etapas. Se houver item fora de etapa, ele é "invisible cost"?
    // Vamos manter Soma das Etapas para consistência visual.

    // 4. Calcular Pesos
    totalGlobalFinal = totalGlobalFinal || 1; // Evitar divisão por zero

    itemMap.forEach(calc => {
        calc.weight = (calc.finalTotal / totalGlobalFinal) * 100;
    });

    return {
        itemMap,
        totalGlobalBase,
        totalGlobalFinal,
        bdiMultiplier
    };
}
