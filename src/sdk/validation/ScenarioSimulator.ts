/**
 * SERVIÇO DE SIMULAÇÃO DE CENÁRIOS
 * 
 * Este módulo permite criar simulações de cenários alternativos
 * para análise de impacto financeiro sem alterar o orçamento original.
 */

import { BudgetService } from '../../lib/supabase-services/BudgetService';
import { BudgetItemService } from '../../lib/supabase-services/BudgetItemService';
import { type Budget, type BudgetItem } from '../../types/domain';

export interface ScenarioConfig {
    name: string;
    description?: string;
    // Ajustes percentuais
    bdiAdjustment?: number;      // Ex: +5 = aumentar BDI em 5 pontos percentuais
    laborAdjustment?: number;    // Ex: +10 = aumentar mão de obra em 10%
    materialAdjustment?: number; // Ex: -5 = reduzir materiais em 5%
    equipmentAdjustment?: number;
    serviceAdjustment?: number;
    // Ajuste global
    globalAdjustment?: number;   // Aplicado a todos os itens
}

export interface ScenarioResult {
    scenarioId: string;
    scenarioName: string;
    originalTotal: number;
    adjustedTotal: number;
    difference: number;
    percentChange: number;
    adjustments: {
        type: string;
        adjustment: number;
        impact: number;
    }[];
}

/**
 * Cria um cenário de simulação a partir de um orçamento existente
 */
export async function createScenario(
    sourceBudgetId: string,
    config: ScenarioConfig
): Promise<ScenarioResult> {
    const sourceBudget = await BudgetService.getById(sourceBudgetId);
    if (!sourceBudget) {
        throw new Error('Orçamento de origem não encontrado');
    }

    const sourceItems = await BudgetItemService.getByBudgetId(sourceBudgetId);

    // Criar novo orçamento como cenário
    const scenarioBudget: Partial<Budget> = {
        name: `[CENÁRIO] ${config.name}`,
        parentBudgetId: sourceBudgetId,
        isScenario: true,
        scenarioName: config.name,
        bdi: (sourceBudget.bdi || 0) + (config.bdiAdjustment || 0),
        version: '1.0',
        revision: 1,
        status: 'draft',
        totalValue: 0, // Will update after items
        client: sourceBudget.client,
        obraType: sourceBudget.obraType,
        encargosSociais: sourceBudget.encargosSociais,
        desoneracao: sourceBudget.desoneracao
    };

    const newBudget = await BudgetService.create(scenarioBudget);
    const newBudgetId = newBudget.id!;

    // Calcular ajustes e criar itens
    const adjustments: ScenarioResult['adjustments'] = [];
    let adjustedTotal = 0;
    const itemsToCreate: Partial<BudgetItem>[] = [];

    for (const item of sourceItems) {
        let adjustedPrice = item.unitPrice;

        // Aplicar ajustes por tipo
        if (item.type === 'labor' && config.laborAdjustment) {
            adjustedPrice *= (1 + config.laborAdjustment / 100);
        } else if (item.type === 'material' && config.materialAdjustment) {
            adjustedPrice *= (1 + config.materialAdjustment / 100);
        } else if (item.type === 'equipment' && config.equipmentAdjustment) {
            adjustedPrice *= (1 + config.equipmentAdjustment / 100);
        } else if (item.type === 'service' && config.serviceAdjustment) {
            adjustedPrice *= (1 + config.serviceAdjustment / 100);
        }

        // Aplicar ajuste global
        if (config.globalAdjustment) {
            adjustedPrice *= (1 + config.globalAdjustment / 100);
        }

        const newTotalPrice = adjustedPrice * item.quantity;
        adjustedTotal += item.type !== 'group' ? newTotalPrice : 0;

        itemsToCreate.push({
            ...item,
            id: undefined,
            budgetId: newBudgetId,
            unitPrice: adjustedPrice,
            totalPrice: newTotalPrice,
            updatedAt: new Date()
        });
    }

    // Batch create items
    await BudgetItemService.batchCreate(itemsToCreate);

    // Atualizar total do cenário
    const bdiFactor = 1 + (newBudget.bdi || 0) / 100;
    const finalTotal = adjustedTotal * bdiFactor;

    await BudgetService.update(newBudgetId, {
        totalValue: adjustedTotal
    });

    // Calcular impactos
    const originalBdiFactor = 1 + (sourceBudget.bdi || 0) / 100;
    const originalTotal = sourceBudget.totalValue * originalBdiFactor;

    if (config.bdiAdjustment) {
        adjustments.push({
            type: 'BDI',
            adjustment: config.bdiAdjustment,
            impact: (finalTotal - (adjustedTotal * originalBdiFactor))
        });
    }

    // Proportional impacts can be complex, skipping for now as per original logic

    return {
        scenarioId: newBudgetId,
        scenarioName: config.name,
        originalTotal,
        adjustedTotal: finalTotal,
        difference: finalTotal - originalTotal,
        percentChange: originalTotal ? ((finalTotal - originalTotal) / originalTotal) * 100 : 0,
        adjustments
    };
}

/**
 * Congela um orçamento, impedindo edições futuras
 */
export async function freezeBudget(
    budgetId: string,
    frozenBy?: string
): Promise<void> {
    const budget = await BudgetService.getById(budgetId);
    if (!budget) {
        throw new Error('Orçamento não encontrado');
    }

    if (budget.isFrozen) {
        throw new Error('Orçamento já está congelado');
    }

    // Incrementar versão ao congelar
    const currentVersion = budget.version || '1.0';
    const [major] = currentVersion.split('.').map(Number);
    const newVersion = `${(isNaN(major) ? 1 : major) + 1}.0`;

    await BudgetService.update(budgetId, {
        isFrozen: true,
        frozenAt: new Date(),
        frozenBy: frozenBy || 'Sistema',
        version: newVersion,
        revision: (budget.revision || 0) + 1,
        status: 'approved'
    });
}

/**
 * Descongela um orçamento (cria uma nova versão editável)
 */
export async function unfreezeBudget(budgetId: string): Promise<string> {
    const budget = await BudgetService.getById(budgetId);
    if (!budget) {
        throw new Error('Orçamento não encontrado');
    }

    if (!budget.isFrozen) {
        throw new Error('Orçamento não está congelado');
    }

    // Criar cópia editável
    const items = await BudgetItemService.getByBudgetId(budgetId);

    const currentVersion = budget.version || '1.0';
    const parts = currentVersion.split('.');
    const major = parseInt(parts[0]) || 1;
    const minor = parseInt(parts[1]) || 0;
    const newVersion = `${major}.${minor + 1}`;

    const newBudgetData: Partial<Budget> = {
        ...budget,
        id: undefined,
        name: `${budget.name} (Rev. ${newVersion})`,
        isFrozen: false,
        frozenAt: undefined,
        frozenBy: undefined,
        version: newVersion,
        revision: (budget.revision || 0) + 1,
        parentBudgetId: budgetId,
        status: 'draft',
        updatedAt: new Date()
    };

    const newBudget = await BudgetService.create(newBudgetData);
    const newBudgetId = newBudget.id!;

    // Copiar itens
    const itemsToCpy = items.map(item => ({
        ...item,
        id: undefined,
        budgetId: newBudgetId,
        updatedAt: new Date()
    }));

    await BudgetItemService.batchCreate(itemsToCpy);

    return newBudgetId;
}

/**
 * Lista todos os cenários de um orçamento
 */
export async function listScenarios(parentBudgetId: string): Promise<Budget[]> {
    const allBudgets = await BudgetService.getAll();
    return allBudgets.filter(b => b.parentBudgetId === parentBudgetId && b.isScenario);
}

/**
 * Compara múltiplos cenários
 */
export async function compareScenarios(
    scenarioIds: string[]
): Promise<{
    scenarios: Array<{
        id: string;
        name: string;
        total: number;
        bdi: number;
    }>;
    baselineId: string;
    maxDifference: number;
}> {
    const scenarios = await Promise.all(
        scenarioIds.map(id => BudgetService.getById(id))
    );

    const validScenarios = scenarios.filter(Boolean) as Budget[];

    if (validScenarios.length < 2) {
        throw new Error('Precisa de pelo menos 2 cenários para comparar');
    }

    const totals = validScenarios.map(s => ({
        id: s.id!,
        name: s.name,
        total: s.totalValue * (1 + (s.bdi || 0) / 100),
        bdi: s.bdi || 0
    }));

    const values = totals.map(t => t.total);
    const maxDifference = Math.max(...values) - Math.min(...values);

    return {
        scenarios: totals,
        baselineId: validScenarios.find(s => !s.isScenario)?.id || validScenarios[0].id!,
        maxDifference
    };
}

