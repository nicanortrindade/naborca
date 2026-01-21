
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
    origin: 'material' | 'labor' | 'equipment';
}

export function classifyItem(description: string, _type?: string): 'material' | 'labor' | 'equipment' {
    if (!description) return 'material';
    const desc = description.toUpperCase();

    // Check for Labor keywords
    const laborKeywords = [
        'PEDREIRO', 'SERVENTE', 'ENCARREGADO', 'AJUDANTE',
        'OPERADOR', 'CARPINTEIRO', 'ARMADOR', 'MONTADOR',
        'ELETRICISTA', 'ENCANADOR', 'PINTOR', 'MESTRE', 'HORISTA', 'MENSALISTA'
    ];
    if (laborKeywords.some(kw => desc.includes(kw))) return 'labor';

    // Check for Equipment keywords
    const equipKeywords = [
        'CAMINHÃO', 'TRATOR', 'LOCAÇÃO', 'EQUIPAMENTO', 'MÁQUINA', 'BETONEIRA', 'GUINCHO'
    ];
    if (equipKeywords.some(kw => desc.includes(kw))) return 'equipment';

    return 'material';
}

export function calculateAdjustmentFactors(
    adjustment: GlobalAdjustmentV2 | null | undefined,
    context: AdjustmentContext
): { materialFactor: number; laborFactor: number; bdiFactor: number } {
    const result = { materialFactor: 1, laborFactor: 1, bdiFactor: 1 };
    if (!adjustment) return result;

    const { mode, kind, value } = adjustment;
    const bdiMultiplier = context.totalFinal / context.totalBase; // Effectively (1+BDI/100)

    if (kind === 'percentage') {
        const factor = 1 + (value / 100);
        if (mode === 'global_all') {
            result.materialFactor = factor;
            result.laborFactor = factor;
        } else if (mode === 'materials_only') {
            result.materialFactor = factor;
        } else if (mode === 'bdi_only') {
            result.bdiFactor = factor;
        }
        return result;
    }

    // ABSOLUTE MODES (Fixed Total or Delta)
    // First, determine the Target Final Total
    let targetFinal = value;
    if (kind === 'fixed' || kind === 'fixed_delta') {
        targetFinal = context.totalFinal + value;
    }

    if (mode === 'global_all') {
        const factor = context.totalFinal > 0 ? targetFinal / context.totalFinal : 1;
        result.materialFactor = factor;
        result.laborFactor = factor;
    } else if (mode === 'bdi_only') {
        const factor = context.totalFinal > 0 ? targetFinal / context.totalFinal : 1;
        result.bdiFactor = factor;
    } else if (mode === 'materials_only') {
        // Precise math: targetFinal = (LaborBase + MaterialBase * Factor) * BDI_Multiplier
        // Factor = (targetFinal/BDI_Multiplier - LaborBase) / MaterialBase
        const laborBase = context.totalBase - context.totalMaterialBase;
        if (context.totalMaterialBase > 0) {
            result.materialFactor = (targetFinal / bdiMultiplier - laborBase) / context.totalMaterialBase;
        }
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
): {
    totalBase: number;
    totalFinal: number;
    totalBDI: number;
    totalMaterialBase: number;
    totalLaborBase: number;
    totalEquipmentBase: number;
} {
    if (!items || items.length === 0) return {
        totalBase: 0, totalFinal: 0, totalBDI: 0,
        totalMaterialBase: 0, totalLaborBase: 0, totalEquipmentBase: 0
    };

    // 1. Calculate Raw Context from items (Source: unmodified unitPrice/quantity)
    const context = getAdjustmentContext(items, bdiPercent);

    // 2. Calculate Factors
    const factors = calculateAdjustmentFactors(settings, context);

    // 3. Sum Adjusted Totals
    let adjBase = 0;
    let adjFinal = 0;
    let adjMaterialBase = 0;
    let adjLaborBase = 0;
    let adjEquipmentBase = 0;

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
        const itemAdjBase = adj.unitPrice * qty;
        adjBase += itemAdjBase;
        adjFinal += adj.finalPrice * qty;

        if (adj.origin === 'material') adjMaterialBase += itemAdjBase;
        else if (adj.origin === 'labor') adjLaborBase += itemAdjBase;
        else if (adj.origin === 'equipment') adjEquipmentBase += itemAdjBase;
    });

    return {
        totalBase: adjBase,
        totalFinal: adjFinal,
        totalBDI: adjFinal - adjBase,
        totalMaterialBase: adjMaterialBase,
        totalLaborBase: adjLaborBase,
        totalEquipmentBase: adjEquipmentBase
    };
}
