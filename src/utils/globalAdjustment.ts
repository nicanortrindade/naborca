
export type GlobalAdjustmentType = 'percentage' | 'fixed';

export interface GlobalAdjustment {
    type: GlobalAdjustmentType;
    value: number; // % (ex: 10) ou Valor R$ (ex: 5000)
}

/**
 * Calcula o fator multiplicador a ser aplicado nos preços unitários.
 * @param adjustment O objeto de ajuste (do metadata)
 * @param totalBasePrice O valor total BASE (sem BDI) do orçamento (somatório dos itens)
 */
export function calculateAdjustmentFactor(
    adjustment: GlobalAdjustment | null | undefined,
    totalBasePrice: number
): number {
    if (!adjustment || adjustment.value === undefined || adjustment.value === null) return 1;

    if (adjustment.type === 'percentage') {
        // Ex: 10 (%) -> 1.10
        // Ex: -10 (%) -> 0.90
        return 1 + (adjustment.value / 100);
    }

    if (adjustment.type === 'fixed') {
        // Se Total Base é 10,000 e Ajuste é +1,000 (Delta).
        // Novo Total = 11,000.
        // Fator = 11,000 / 10,000 = 1.1.

        if (!totalBasePrice || totalBasePrice === 0) return 1; // Proteção contra divisão por zero

        // Fator = (Base + Delta) / Base
        return (totalBasePrice + adjustment.value) / totalBasePrice;
    }

    return 1;
}

/**
 * Aplica o fator ao preço.
 */
export function applyAdjustment(price: number, factor: number): number {
    if (!factor || factor === 1) return price;
    return price * factor;
}
