
export type GlobalAdjustmentMode = 'materials_only' | 'bdi_only' | 'global_all';
export type GlobalAdjustmentType = 'percentage' | 'fixed' | 'fixed_target_total' | 'fixed_delta';

export interface GlobalAdjustmentV2 {
    mode: GlobalAdjustmentMode;
    kind: GlobalAdjustmentType;
    value: number;
}

export interface AdjustmentContext {
    totalBase: number;
    totalFinal: number;
    totalMaterialBase: number;
}

export interface AdjustedValues {
    unitPrice: number;
    finalPrice: number;
    origin: 'material' | 'labor';
}

export function classifyItem(description: string, type?: string): 'material' | 'labor' {
    if (!description) return 'material';
    const desc = description.toUpperCase();
    const laborKeywords = [
        'PEDREIRO', 'SERVENTE', 'ENCARREGADO', 'AJUDANTE',
        'OPERADOR', 'CARPINTEIRO', 'ARMADOR', 'MONTADOR',
        'ELETRICISTA', 'ENCANADOR', 'PINTOR', 'MESTRE'
    ];
    if (laborKeywords.some(kw => desc.includes(kw))) return 'labor';
    return 'material';
}

export function calculateAdjustmentFactors(
    adjustment: GlobalAdjustmentV2 | null | undefined,
    context: AdjustmentContext
): { materialFactor: number; laborFactor: number; bdiFactor: number } {
    const result = { materialFactor: 1, laborFactor: 1, bdiFactor: 1 };
    if (!adjustment) return result;

    const { mode, kind, value } = adjustment;
    let percentFactor = 1;

    // Normalizar Fator
    if (kind === 'percentage') {
        percentFactor = 1 + (value / 100);
    } else {
        // Absolute: fator = (Total + Delta) / Total
        let base = context.totalBase;
        if (mode === 'materials_only') base = context.totalMaterialBase;
        else if (mode === 'bdi_only') base = context.totalFinal;

        if (base > 0) {
            if (kind === 'fixed_target_total') {
                percentFactor = value / base;
            } else {
                // 'fixed' (legacy/default to delta) or 'fixed_delta'
                percentFactor = (base + value) / base;
            }
        }
    }

    switch (mode) {
        case 'global_all':
            result.materialFactor = percentFactor;
            result.laborFactor = percentFactor;
            break;
        case 'materials_only':
            result.materialFactor = percentFactor;
            break;
        case 'bdi_only':
            result.bdiFactor = percentFactor;
            break;
    }
    return result;
}

export function getAdjustedItemValues(
    item: { unitPrice: number; description: string; type?: string },
    factors: { materialFactor: number; laborFactor: number; bdiFactor: number },
    bdiPercent: number
): AdjustedValues {
    const origin = classifyItem(item.description, item.type);

    let factor = 1;
    if (origin === 'material') factor = factors.materialFactor;
    else factor = factors.laborFactor;

    const newBaseUnit = item.unitPrice * factor;
    const bdiMultiplier = 1 + (bdiPercent / 100);
    const newFinalUnit = newBaseUnit * bdiMultiplier * factors.bdiFactor;

    return {
        unitPrice: newBaseUnit,
        finalPrice: newFinalUnit,
        origin
    };
}

/**
 * Computes the Raw Context (Total Base, Total Final with BDI, Total Material)
 * from the item list. Use this to prepare the context for calculateAdjustmentFactors.
 * This is the Single Source of Truth for identifying leaf items and summing up raw values.
 */
export function getAdjustmentContext(
    items: any[],
    bdiPercent: number
): AdjustmentContext {
    if (!items || items.length === 0) {
        return { totalBase: 0, totalFinal: 0, totalMaterialBase: 0 };
    }

    let rawBase = 0;
    let rawMaterialBase = 0;

    // Use filtered leaf items logic (L3+)
    const leafItems = items.filter(i => {
        // Robust check for leaf item
        // Assuming if type!=group and level>=3 implies leaf.
        // Or simply strict level check if available.
        // Fallback: if 'type' is present use it.
        const isGroup = i.type === 'group' || (i as any).kind === 'GROUP'; // 'kind' from view model
        return !isGroup && (i.level === undefined || i.level >= 3);
    });

    leafItems.forEach(item => {
        const qty = item.quantity || 0;
        const total = (item.unitPrice || 0) * qty;
        rawBase += total;

        if (classifyItem(item.description, item.type) === 'material') {
            rawMaterialBase += total;
        }
    });

    const rawFinal = rawBase * (1 + bdiPercent / 100);

    return {
        totalBase: rawBase,
        totalFinal: rawFinal,
        totalMaterialBase: rawMaterialBase
    };
}

/**
 * Calculates the complete Budget Totals applying Global Adjustment V2.
 * SSOT for Editor Cards, PDF Summary, and Schedule.
 */
export function getAdjustedBudgetTotals(
    items: any[],
    settings: GlobalAdjustmentV2 | null | undefined,
    bdiPercent: number
): { totalBase: number; totalFinal: number; totalBDI: number } {
    if (!items || items.length === 0) return { totalBase: 0, totalFinal: 0, totalBDI: 0 };

    // 1. Calculate Raw Context from items (Source: unmodified unitPrice/quantity)
    const context = getAdjustmentContext(items, bdiPercent);

    // 2. Calculate Factors
    const factors = calculateAdjustmentFactors(settings, context);

    // 3. Sum Adjusted Totals
    let adjBase = 0;
    let adjFinal = 0;

    // Re-filter leaf items for final sum (optimization: could reuse if passed, but cheap enough)
    const leafItems = items.filter(i => {
        const isGroup = i.type === 'group' || (i as any).kind === 'GROUP';
        return !isGroup && (i.level === undefined || i.level >= 3);
    });

    leafItems.forEach(item => {
        const qty = item.quantity || 0;
        const adj = getAdjustedItemValues(
            { unitPrice: item.unitPrice || 0, description: item.description, type: item.type },
            factors,
            bdiPercent
        );
        adjBase += adj.unitPrice * qty;
        adjFinal += adj.finalPrice * qty;
    });

    return {
        totalBase: adjBase,
        totalFinal: adjFinal,
        totalBDI: adjFinal - adjBase
    };
}
