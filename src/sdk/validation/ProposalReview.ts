/**
 * SERVIÇO DE REVISÃO FINAL DE PROPOSTA
 * 
 * Este módulo realiza uma varredura completa do orçamento identificando
 * possíveis pendências técnicas. Os resultados são informativos e não
 * substituem análise técnica profissional.
 */

import { type BudgetItem, type BudgetItemComposition } from '../../types/domain';
import { BudgetService } from '../../lib/supabase-services/BudgetService';
import { BudgetItemService } from '../../lib/supabase-services/BudgetItemService';
import { supabase } from '../../lib/supabase';
import { COMPLIANCE_DISCLAIMERS } from '../../config/compliance';

// Tipos de alertas
export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertCategory =
    | 'missing_composition'
    | 'unit_incompatibility'
    | 'price_range'
    | 'bdi_issue'
    | 'cost_center'
    | 'missing_essential'
    | 'quantity_low'
    | 'quantity_high'
    | 'related_items'
    | 'version';

export interface ReviewAlert {
    id: string;
    category: AlertCategory;
    severity: AlertSeverity;
    itemId?: string;
    itemCode?: string;
    itemDescription?: string;
    title: string;
    message: string;
    technicalNote?: string;
    recommendation?: string;
}

export interface ReviewReport {
    budgetId: string;
    budgetName: string;
    generatedAt: Date;
    version: string;
    totalItems: number;
    totalAlerts: number;
    alertsByCategory: Record<AlertCategory, number>;
    alertsBySeverity: Record<AlertSeverity, number>;
    alerts: ReviewAlert[];
    disclaimer: string;
}

// Faixas de preço por tipo de recurso (referências gerais)
const PRICE_RANGES: Record<string, { min: number; max: number }> = {
    labor: { min: 10, max: 500 },      // Mão de obra por hora
    material: { min: 0.01, max: 50000 }, // Materiais diversos
    equipment: { min: 5, max: 5000 },   // Equipamentos por hora
    service: { min: 50, max: 100000 }   // Serviços compostos
};

// Unidades compatíveis (matriz simplificada)
const UNIT_COMPATIBILITY: Record<string, string[]> = {
    'M3': ['M3', 'L', 'KG', 'T', 'UN'],
    'M2': ['M2', 'M', 'UN'],
    'M': ['M', 'UN'],
    'KG': ['KG', 'T', 'UN'],
    'UN': ['UN'],
    'H': ['H', 'DIA', 'MES'],
    'VB': ['VB', 'UN', 'CJ']
};

// Itens relacionados que frequentemente aparecem juntos
const RELATED_ITEMS: Array<{ primary: string[]; requires: string[]; message: string }> = [
    {
        primary: ['CONCRETO', 'CONCRETAGEM'],
        requires: ['FORMA', 'FÔRMA', 'COFRAGEM'],
        message: 'Concreto estrutural geralmente requer formas'
    },
    {
        primary: ['ARMADURA', 'ARMAÇÃO', 'FERRAGEM', 'AÇO CA'],
        requires: ['FORMA', 'FÔRMA', 'CONCRETO'],
        message: 'Armadura geralmente acompanha concreto e formas'
    },
    {
        primary: ['PINTURA', 'TINTA'],
        requires: ['MASSA', 'SELADOR', 'PREPARO', 'EMASSAMENTO', 'LIXAMENTO'],
        message: 'Pintura geralmente requer preparo de superfície'
    },
    {
        primary: ['REVESTIMENTO CERÂMICO', 'PISO CERÂMICO', 'AZULEJO'],
        requires: ['ARGAMASSA', 'REJUNTE'],
        message: 'Revestimentos cerâmicos requerem argamassa e rejunte'
    },
    {
        primary: ['INSTALAÇÃO ELÉTRICA', 'ELETRODUTO', 'QUADRO ELÉTRICO'],
        requires: ['FIO', 'CABO', 'DISJUNTOR'],
        message: 'Instalações elétricas requerem condutores e proteção'
    },
    {
        primary: ['TUBO PVC', 'TUBULAÇÃO'],
        requires: ['CONEXÃO', 'ADESIVO', 'ANEL'],
        message: 'Tubulações requerem conexões e vedações'
    }
];

// Checklists por tipo de obra
export const OBRA_CHECKLISTS: Record<string, { name: string; essentialItems: string[] }> = {
    predial: {
        name: 'Construção Predial',
        essentialItems: [
            'SERVIÇOS PRELIMINARES', 'CANTEIRO', 'LIMPEZA TERRENO',
            'FUNDAÇÃO', 'SAPATA', 'ESTACA', 'BALDRAME',
            'ESTRUTURA', 'CONCRETO', 'ARMADURA', 'FORMA',
            'ALVENARIA', 'BLOCO', 'TIJOLO',
            'COBERTURA', 'TELHADO', 'ESTRUTURA METÁLICA',
            'INSTALAÇÕES ELÉTRICAS', 'ELETRODUTO', 'QUADRO',
            'INSTALAÇÕES HIDRÁULICAS', 'TUBO PVC', 'REGISTRO',
            'REVESTIMENTO', 'REBOCO', 'EMBOÇO',
            'PISO', 'CONTRAPISO', 'CERÂMICA',
            'PINTURA', 'MASSA', 'TINTA',
            'ESQUADRIA', 'PORTA', 'JANELA',
            'LIMPEZA FINAL'
        ]
    },
    saneamento: {
        name: 'Saneamento Básico',
        essentialItems: [
            'SERVIÇOS PRELIMINARES', 'LOCAÇÃO', 'CADASTRO',
            'ESCAVAÇÃO', 'REATERRO', 'COMPACTAÇÃO',
            'TUBO PVC', 'TUBO PEAD', 'TUBO FERRO',
            'CONEXÕES', 'REGISTROS', 'VÁLVULAS',
            'POÇO DE VISITA', 'CAIXA INSPEÇÃO',
            'LIGAÇÃO DOMICILIAR', 'CAVALETE',
            'PAVIMENTAÇÃO', 'RECOMPOSIÇÃO',
            'SINALIZAÇÃO', 'SEGURANÇA'
        ]
    },
    pavimentacao: {
        name: 'Pavimentação',
        essentialItems: [
            'SERVIÇOS PRELIMINARES', 'LOCAÇÃO', 'TOPOGRAFIA',
            'TERRAPLENAGEM', 'CORTE', 'ATERRO',
            'DRENAGEM', 'BUEIRO', 'SARJETA', 'MEIO-FIO',
            'SUB-BASE', 'BASE', 'BRITA',
            'IMPRIMAÇÃO', 'PINTURA LIGAÇÃO',
            'CBUQ', 'ASFALTO', 'CONCRETO',
            'SINALIZAÇÃO HORIZONTAL', 'SINALIZAÇÃO VERTICAL'
        ]
    },
    reforma: {
        name: 'Reforma e Manutenção',
        essentialItems: [
            'DEMOLIÇÃO', 'REMOÇÃO',
            'PROTEÇÃO', 'TAPUME',
            'RECUPERAÇÃO', 'REFORÇO',
            'INSTALAÇÕES', 'MANUTENÇÃO',
            'PINTURA', 'ACABAMENTO',
            'LIMPEZA'
        ]
    }
};

/**
 * Realiza a revisão completa de um orçamento
 * 
 * ATENÇÃO: Esta análise é auxiliar e não substitui verificação técnica profissional.
 */
export async function generateProposalReview(budgetId: string): Promise<ReviewReport> {
    const budget = await BudgetService.getById(budgetId);
    if (!budget) {
        throw new Error('Orçamento não encontrado');
    }

    const items = await BudgetItemService.getByBudgetId(budgetId);
    const alerts: ReviewAlert[] = [];
    let alertIdCounter = 0;

    const createAlert = (
        category: AlertCategory,
        severity: AlertSeverity,
        title: string,
        message: string,
        item?: BudgetItem,
        technicalNote?: string,
        recommendation?: string
    ): ReviewAlert => ({
        id: `alert_${++alertIdCounter}`,
        category,
        severity,
        itemId: item?.id as any,
        itemCode: item?.code,
        itemDescription: item?.description,
        title,
        message,
        technicalNote,
        recommendation
    });

    // 1. Verificar itens sem CPU (composição)
    for (const item of items) {
        if (item.type === 'group') continue;

        const { data: compositions, error } = await supabase
            .from('budget_item_compositions')
            .select('*')
            .eq('budget_item_id', item.id!);

        if (compositions.length === 0) {
            alerts.push(createAlert(
                'missing_composition',
                'warning',
                'Item sem composição detalhada',
                `O item "${item.description}" não possui CPU (Composição de Preço Unitário) associada.`,
                item,
                'Itens sem composição podem dificultar a análise de custos e justificativas em processos licitatórios.',
                'Considere adicionar a composição analítica do item.'
            ));
        } else {
            // 2. Verificar unidades incompatíveis
            await checkUnitCompatibility(item, compositions, alerts, createAlert);
        }

        // 3. Verificar preços fora de faixa
        checkPriceRange(item, alerts, createAlert);

        // 4. Verificar centro de custo
        if (!item.costCenter || item.costCenter.trim() === '') {
            alerts.push(createAlert(
                'cost_center',
                'info',
                'Centro de custo não definido',
                `O item "${item.description}" não possui centro de custo atribuído.`,
                item,
                'Centros de custo facilitam o controle e rastreamento financeiro da obra.',
                'Atribua um centro de custo se aplicável ao projeto.'
            ));
        }
    }

    // 5. Verificar BDI
    if (!budget.bdi || budget.bdi === 0) {
        alerts.push(createAlert(
            'bdi_issue',
            'critical',
            'BDI zerado ou não definido',
            'O orçamento está com BDI igual a zero.',
            undefined,
            'BDI zerado pode indicar proposta incompleta ou risco de prejuízo.',
            'Revise a composição do BDI antes de finalizar a proposta.'
        ));
    } else if (budget.bdi < 15 || budget.bdi > 40) {
        alerts.push(createAlert(
            'bdi_issue',
            'warning',
            'BDI possivelmente fora da faixa usual',
            `O BDI de ${budget.bdi}% pode estar ${budget.bdi < 15 ? 'abaixo' : 'acima'} das faixas típicas para obras públicas.`,
            undefined,
            'Faixas usuais de BDI para obras públicas variam conforme tipo de obra e jurisprudência do TCU.',
            'Verifique se o BDI está adequado ao tipo de contratação.'
        ));
    }

    // 6. Verificar itens relacionados
    await checkRelatedItems(items, alerts, createAlert);

    // Consolidar estatísticas
    const alertsByCategory: Record<AlertCategory, number> = {
        missing_composition: 0,
        unit_incompatibility: 0,
        price_range: 0,
        bdi_issue: 0,
        cost_center: 0,
        missing_essential: 0,
        quantity_low: 0,
        quantity_high: 0,
        related_items: 0,
        version: 0
    };

    const alertsBySeverity: Record<AlertSeverity, number> = {
        info: 0,
        warning: 0,
        critical: 0
    };

    for (const alert of alerts) {
        alertsByCategory[alert.category]++;
        alertsBySeverity[alert.severity]++;
    }

    return {
        budgetId: budgetId as any,
        budgetName: budget.name,
        generatedAt: new Date(),
        version: '1.0',
        totalItems: items.filter(i => i.type !== 'group').length,
        totalAlerts: alerts.length,
        alertsByCategory,
        alertsBySeverity,
        alerts,
        disclaimer: COMPLIANCE_DISCLAIMERS.LEGAL_COMPLIANCE.message
    };
}

/**
 * Verifica compatibilidade de unidades entre item e composição
 */
async function checkUnitCompatibility(
    item: BudgetItem,
    compositions: BudgetItemComposition[],
    alerts: ReviewAlert[],
    createAlert: Function
) {
    const itemUnit = item.unit?.toUpperCase().trim();
    const compatibleUnits = UNIT_COMPATIBILITY[itemUnit] || [itemUnit];

    for (const comp of compositions) {
        const compUnit = comp.unit?.toUpperCase().trim();
        // Verificação simplificada - em produção usar matriz mais completa
        if (compUnit && !compatibleUnits.includes(compUnit) && compUnit !== itemUnit) {
            // Alguns casos especiais que são compatíveis
            const isCompatible =
                (itemUnit === 'M3' && ['KG', 'L'].includes(compUnit)) ||
                (itemUnit === 'M2' && ['M', 'KG'].includes(compUnit)) ||
                (['H', 'DIA', 'MÊS'].includes(itemUnit) && ['H', 'DIA', 'MÊS'].includes(compUnit));

            if (!isCompatible && compUnit !== 'UN' && compUnit !== 'VB') {
                alerts.push(createAlert(
                    'unit_incompatibility',
                    'info',
                    'Possível divergência de unidades',
                    `O insumo "${comp.description}" (${compUnit}) pode ter unidade divergente do item (${itemUnit}).`,
                    item,
                    'Divergências de unidade podem indicar erro de coeficiente ou item incorreto.',
                    'Verifique se o coeficiente está correto para a unidade utilizada.'
                ));
            }
        }
    }
}

/**
 * Verifica se preços estão em faixas esperadas
 */
function checkPriceRange(
    item: BudgetItem,
    alerts: ReviewAlert[],
    createAlert: Function
) {
    const type = item.type as keyof typeof PRICE_RANGES;
    const range = PRICE_RANGES[type] || PRICE_RANGES['service'];

    if (item.unitPrice > 0) {
        if (item.unitPrice < range.min * 0.1) {
            alerts.push(createAlert(
                'price_range',
                'warning',
                'Preço unitário possivelmente baixo',
                `O item "${item.description}" tem preço unitário de R$ ${item.unitPrice.toFixed(2)}, possivelmente abaixo do esperado.`,
                item,
                'Preços muito baixos podem indicar erro de digitação ou unidade incorreta.',
                'Verifique se o preço e a unidade estão corretos.'
            ));
        } else if (item.unitPrice > range.max * 10) {
            alerts.push(createAlert(
                'price_range',
                'warning',
                'Preço unitário possivelmente alto',
                `O item "${item.description}" tem preço unitário de R$ ${item.unitPrice.toFixed(2)}, possivelmente acima do esperado.`,
                item,
                'Preços muito altos podem indicar erro ou necessidade de justificativa técnica.',
                'Verifique se o preço reflete a realidade do mercado local.'
            ));
        }
    }
}

/**
 * Verifica se itens relacionados estão presentes
 */
async function checkRelatedItems(
    items: BudgetItem[],
    alerts: ReviewAlert[],
    createAlert: Function
) {
    const descriptions = items.map(i => i.description.toUpperCase());

    for (const relation of RELATED_ITEMS) {
        const hasPrimary = relation.primary.some(keyword =>
            descriptions.some(desc => desc.includes(keyword))
        );

        if (hasPrimary) {
            const hasRequired = relation.requires.some(keyword =>
                descriptions.some(desc => desc.includes(keyword))
            );

            if (!hasRequired) {
                const primaryItem = items.find(i =>
                    relation.primary.some(k => i.description.toUpperCase().includes(k))
                );

                alerts.push(createAlert(
                    'related_items',
                    'info',
                    'Possível item relacionado ausente',
                    relation.message,
                    primaryItem,
                    'Esta verificação é baseada em padrões típicos e pode não se aplicar a todos os casos.',
                    'Avalie se os itens relacionados são necessários para o escopo do projeto.'
                ));
            }
        }
    }
}

/**
 * Verifica checklist por tipo de obra
 */
export function checkObraChecklist(
    obraType: keyof typeof OBRA_CHECKLISTS,
    items: BudgetItem[]
): { present: string[]; missing: string[] } {
    const checklist = OBRA_CHECKLISTS[obraType];
    if (!checklist) {
        return { present: [], missing: [] };
    }

    const descriptions = items.map(i => i.description.toUpperCase());
    const present: string[] = [];
    const missing: string[] = [];

    for (const essential of checklist.essentialItems) {
        const found = descriptions.some(desc => desc.includes(essential.toUpperCase()));
        if (found) {
            present.push(essential);
        } else {
            missing.push(essential);
        }
    }

    return { present, missing };
}
