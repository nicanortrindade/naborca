
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
