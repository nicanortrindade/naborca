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
 * Gera itemNumber hierárquico para N níveis (ex: 1, 1.1, 1.1.1, 1.1.1.1, ...)
 * Usa parentId para construir a árvore e atribui números sequenciais por grupo de irmãos.
 * Retorna um Map<string, string> de itemId → itemNumber.
 */
export function generateItemNumbers(items: any[]): Map<string, string> {
    // 1. Construir mapa de filhos agrupados por parentId
    const childrenMap = new Map<string | null, any[]>();
    for (const item of items) {
        const pid = item.parentId || null;
        if (!childrenMap.has(pid)) childrenMap.set(pid, []);
        childrenMap.get(pid)!.push(item);
    }

    // 2. Ordenar cada grupo de filhos por order (ou order_index)
    for (const [, children] of childrenMap) {
        children.sort((a: any, b: any) => {
            const oa = a.order ?? a.order_index ?? 0;
            const ob = b.order ?? b.order_index ?? 0;
            return oa - ob;
        });
    }

    // 3. Percorrer recursivamente e atribuir números
    const result = new Map<string, string>();

    function traverse(parentId: string | null, prefix: string) {
        const children = childrenMap.get(parentId);
        if (!children) return;
        let counter = 0;
        for (const child of children) {
            counter++;
            const num = prefix ? `${prefix}.${counter}` : `${counter}`;
            if (child.id) {
                result.set(child.id, num);
            }
            traverse(child.id, num);
        }
    }

    traverse(null, '');
    return result;
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

    // 1. Construir mapa de filhos por parentId
    const childrenMap = new Map<string, BudgetItem[]>();
    const parentIds = new Set<string>();
    for (const item of items) {
        if (item.parentId) {
            if (!childrenMap.has(item.parentId)) childrenMap.set(item.parentId, []);
            childrenMap.get(item.parentId)!.push(item);
            parentIds.add(item.parentId);
        }
    }

    // 2. Calcular recursivamente bottom-up (funciona para N níveis)
    function calcItem(item: BudgetItem): CalculatedItem {
        const existing = itemMap.get(item.id!);
        if (existing) return existing;

        const children = childrenMap.get(item.id!) || [];
        const isGroup = parentIds.has(item.id!) ||
            item.type === 'group' ||
            (item as any).type === 'etapa' ||
            (item as any).type === 'subetapa' ||
            item.level < 3;

        let baseUnit = 0;
        let baseTotal = 0;
        let finalUnit = 0;
        let finalTotal = 0;

        if (isGroup && children.length > 0) {
            // Grupo: soma recursiva dos filhos
            for (const child of children) {
                const childCalc = calcItem(child);
                baseTotal += childCalc.baseTotal;
                finalTotal += childCalc.finalTotal;
            }
        } else if (!isGroup) {
            // Item folha: calcula diretamente
            const qty = safeNum(item.quantity);
            const unit = safeNum(item.unitPrice);
            const itemBdi = (item.customBDI != null && item.customBDI > 0)
                ? item.customBDI
                : bdiPercent;
            const itemBdiMult = 1 + (safeNum(itemBdi) / 100);

            baseUnit = unit;
            baseTotal = qty * unit;
            finalUnit = baseUnit * itemBdiMult;
            finalTotal = baseTotal * itemBdiMult;
        }

        const calc: CalculatedItem = {
            id: item.id!,
            baseUnit,
            baseTotal,
            finalUnit,
            finalTotal,
            weight: 0,
            level: item.level || 1,
            isGroup: !!isGroup,
        };
        itemMap.set(item.id!, calc);
        return calc;
    }

    // 3. Calcular todos os itens
    for (const item of items) {
        calcItem(item);
    }

    // 4. Total global: soma dos itens folha (level >= 3 e !isGroup) para evitar dupla contagem
    let totalGlobalBase = 0;
    let totalGlobalFinal = 0;
    itemMap.forEach(calc => {
        if (!calc.isGroup) {
            totalGlobalBase += calc.baseTotal;
            totalGlobalFinal += calc.finalTotal;
        }
    });

    // 5. Calcular pesos
    const totalForWeight = totalGlobalFinal || 1;
    itemMap.forEach(calc => {
        calc.weight = (calc.finalTotal / totalForWeight) * 100;
    });

    return {
        itemMap,
        totalGlobalBase,
        totalGlobalFinal,
        bdiMultiplier,
    };
}
