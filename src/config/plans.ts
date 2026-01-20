/**
 * FEATURE FLAGS & PLANS CONFIGURATION
 * 
 * Sistema de controle de funcionalidades por plano de assinatura.
 * Preparado para futura comercialização, mas atualmente todas as features estão liberadas.
 * 
 * IMPORTANTE: Não há integração de pagamento. Isso é apenas estrutura preparatória.
 */

export type PlanTier = 'free' | 'pro' | 'enterprise';

export interface PlanFeatures {
    // Limites Quantitativos
    maxBudgets: number;
    maxBudgetItems: number;
    maxClients: number;
    maxProposals: number;
    maxCompanies: number;
    maxInsumos: number;
    maxCompositions: number;

    // Funcionalidades Avançadas
    enableAdvancedReports: boolean;
    enableBDICalculator: boolean;
    enableEncargosCalculator: boolean;
    enableCurvaABC: boolean;
    enableScenarios: boolean;
    enableComparison: boolean;
    enableSchedule: boolean;
    enableProposalReview: boolean;
    enableAutoCorrection: boolean;
    enableBulkOperations: boolean;

    // Exportação
    enablePDFExport: boolean;
    enableExcelExport: boolean;
    enableAnalyticExport: boolean;
    enableCustomBranding: boolean;

    // Integrações e Dados
    enableDataImport: boolean;
    enableDataExport: boolean;
    enableAPIAccess: boolean;
    enableBackupRestore: boolean;

    // Colaboração (Futuro)
    enableTeamCollaboration: boolean;
    maxTeamMembers: number;
    enableComments: boolean;
    enableVersionControl: boolean;

    // Suporte
    supportLevel: 'community' | 'email' | 'priority';
    enablePrioritySupport: boolean;
}

/**
 * Definição dos Planos
 * 
 * NOTA: Atualmente todos os usuários têm acesso 'enterprise'.
 * Quando ativar comercialização, ajustar lógica em getUserPlan().
 */
export const PLANS: Record<PlanTier, PlanFeatures> = {
    free: {
        // Limites Quantitativos
        maxBudgets: 5,
        maxBudgetItems: 100,
        maxClients: 10,
        maxProposals: 5,
        maxCompanies: 1,
        maxInsumos: 50,
        maxCompositions: 20,

        // Funcionalidades Avançadas
        enableAdvancedReports: false,
        enableBDICalculator: true,
        enableEncargosCalculator: true,
        enableCurvaABC: false,
        enableScenarios: false,
        enableComparison: false,
        enableSchedule: false,
        enableProposalReview: false,
        enableAutoCorrection: false,
        enableBulkOperations: false,

        // Exportação
        enablePDFExport: true,
        enableExcelExport: true,
        enableAnalyticExport: false,
        enableCustomBranding: false,

        // Integrações e Dados
        enableDataImport: true,
        enableDataExport: true,
        enableAPIAccess: false,
        enableBackupRestore: false,

        // Colaboração (Futuro)
        enableTeamCollaboration: false,
        maxTeamMembers: 1,
        enableComments: false,
        enableVersionControl: false,

        // Suporte
        supportLevel: 'community',
        enablePrioritySupport: false,
    },

    pro: {
        // Limites Quantitativos
        maxBudgets: 50,
        maxBudgetItems: 1000,
        maxClients: 100,
        maxProposals: 50,
        maxCompanies: 3,
        maxInsumos: 500,
        maxCompositions: 200,

        // Funcionalidades Avançadas
        enableAdvancedReports: true,
        enableBDICalculator: true,
        enableEncargosCalculator: true,
        enableCurvaABC: true,
        enableScenarios: true,
        enableComparison: true,
        enableSchedule: true,
        enableProposalReview: true,
        enableAutoCorrection: true,
        enableBulkOperations: true,

        // Exportação
        enablePDFExport: true,
        enableExcelExport: true,
        enableAnalyticExport: true,
        enableCustomBranding: true,

        // Integrações e Dados
        enableDataImport: true,
        enableDataExport: true,
        enableAPIAccess: false,
        enableBackupRestore: true,

        // Colaboração (Futuro)
        enableTeamCollaboration: false,
        maxTeamMembers: 1,
        enableComments: false,
        enableVersionControl: true,

        // Suporte
        supportLevel: 'email',
        enablePrioritySupport: false,
    },

    enterprise: {
        // Limites Quantitativos (Ilimitado)
        maxBudgets: Infinity,
        maxBudgetItems: Infinity,
        maxClients: Infinity,
        maxProposals: Infinity,
        maxCompanies: Infinity,
        maxInsumos: Infinity,
        maxCompositions: Infinity,

        // Funcionalidades Avançadas (Todas)
        enableAdvancedReports: true,
        enableBDICalculator: true,
        enableEncargosCalculator: true,
        enableCurvaABC: true,
        enableScenarios: true,
        enableComparison: true,
        enableSchedule: true,
        enableProposalReview: true,
        enableAutoCorrection: true,
        enableBulkOperations: true,

        // Exportação (Todas)
        enablePDFExport: true,
        enableExcelExport: true,
        enableAnalyticExport: true,
        enableCustomBranding: true,

        // Integrações e Dados (Todas)
        enableDataImport: true,
        enableDataExport: true,
        enableAPIAccess: true,
        enableBackupRestore: true,

        // Colaboração (Futuro)
        enableTeamCollaboration: true,
        maxTeamMembers: Infinity,
        enableComments: true,
        enableVersionControl: true,

        // Suporte
        supportLevel: 'priority',
        enablePrioritySupport: true,
    }
};

/**
 * Informações de Apresentação dos Planos
 * Para uso em página de pricing (futura)
 */
export const PLAN_INFO: Record<PlanTier, {
    name: string;
    description: string;
    price: string;
    priceMonthly: number | null;
    priceYearly: number | null;
    features: string[];
    recommended?: boolean;
}> = {
    free: {
        name: 'Gratuito',
        description: 'Para conhecer o sistema',
        price: 'R$ 0',
        priceMonthly: null,
        priceYearly: null,
        features: [
            'Até 5 orçamentos',
            'Até 10 clientes',
            'Exportação PDF e Excel básica',
            'Calculadoras BDI e Encargos',
            'Suporte via comunidade'
        ]
    },
    pro: {
        name: 'Profissional',
        description: 'Para profissionais e pequenas empresas',
        price: 'R$ 97/mês',
        priceMonthly: 97,
        priceYearly: 970, // 10 meses (2 de desconto)
        recommended: true,
        features: [
            'Até 50 orçamentos',
            'Até 100 clientes',
            'Relatórios avançados',
            'Curva ABC e Cenários',
            'Revisão automática de propostas',
            'Cronograma físico-financeiro',
            'Exportação analítica (CPU)',
            'Marca personalizada',
            'Backup e restauração',
            'Suporte por email'
        ]
    },
    enterprise: {
        name: 'Enterprise',
        description: 'Para empresas e equipes',
        price: 'Sob consulta',
        priceMonthly: null,
        priceYearly: null,
        features: [
            'Orçamentos ilimitados',
            'Clientes ilimitados',
            'Todas as funcionalidades PRO',
            'Múltiplas empresas',
            'API de integração',
            'Colaboração em equipe (futuro)',
            'Controle de versões',
            'Suporte prioritário',
            'Treinamento personalizado',
            'SLA garantido'
        ]
    }
};

/**
 * Obter plano do usuário
 * 
 * IMPORTANTE: Atualmente retorna sempre 'enterprise' para todos.
 * Quando ativar comercialização, buscar do banco de dados.
 */
export async function getUserPlan(userId: string): Promise<PlanTier> {
    // TODO: Quando ativar comercialização, buscar de:
    // - Tabela 'subscriptions' no Supabase
    // - Integração com gateway de pagamento
    // - Validar status de assinatura

    // Por enquanto, todos têm acesso total
    return 'enterprise';
}

/**
 * Obter features do plano do usuário
 */
export async function getUserFeatures(userId: string): Promise<PlanFeatures> {
    const plan = await getUserPlan(userId);
    return PLANS[plan];
}

/**
 * Verificar se usuário tem acesso a uma feature
 */
export async function hasFeature(
    userId: string,
    feature: keyof PlanFeatures
): Promise<boolean> {
    const features = await getUserFeatures(userId);
    const value = features[feature];

    // Se for booleano, retorna direto
    if (typeof value === 'boolean') {
        return value;
    }

    // Se for número, considera true se > 0
    if (typeof value === 'number') {
        return value > 0;
    }

    // Se for string, considera true se não vazio
    return !!value;
}

/**
 * Verificar se usuário atingiu limite de um recurso
 */
export async function checkLimit(
    userId: string,
    resource: keyof PlanFeatures,
    currentCount: number
): Promise<{ allowed: boolean; limit: number; remaining: number }> {
    const features = await getUserFeatures(userId);
    const limit = features[resource] as number;

    return {
        allowed: currentCount < limit,
        limit: limit === Infinity ? -1 : limit, // -1 indica ilimitado
        remaining: limit === Infinity ? -1 : Math.max(0, limit - currentCount)
    };
}

/**
 * Feature Flags Globais
 * Para controle de features em desenvolvimento ou beta
 */
export const FEATURE_FLAGS = {
    // Features em Desenvolvimento
    ENABLE_TEAM_COLLABORATION: false,
    ENABLE_COMMENTS: false,
    ENABLE_REAL_TIME_SYNC: false,
    ENABLE_MOBILE_APP: false,

    // Features Beta
    ENABLE_AI_SUGGESTIONS: false,
    ENABLE_PRICE_PREDICTION: false,
    ENABLE_AUTO_BUDGET_GENERATION: false,

    // Integrações Externas
    ENABLE_SINAPI_INTEGRATION: false,
    ENABLE_SICRO_INTEGRATION: false,
    ENABLE_GOVERNMENT_API: false,

    // Funcionalidades Experimentais
    ENABLE_VOICE_INPUT: false,
    ENABLE_OCR_IMPORT: false,
    ENABLE_BLOCKCHAIN_AUDIT: false,
};

/**
 * Verificar se uma feature flag está ativa
 */
export function isFeatureFlagEnabled(flag: keyof typeof FEATURE_FLAGS): boolean {
    return FEATURE_FLAGS[flag];
}
