"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BudgetService = void 0;
const supabase_1 = require("../supabase");
function toDomain(row) {
    return {
        id: row.id,
        name: row.name,
        client: row.client_name || '',
        date: new Date(row.date),
        status: row.status,
        totalValue: row.total_value,
        bdi: row.bdi || 0,
        encargosSociais: row.encargos_percentage ?? row.social_charges_percentage ?? 0,
        obraType: row.obra_type || undefined,
        proposalCover: row.proposal_cover || undefined,
        proposalTerms: row.proposal_terms || undefined,
        scheduleInterval: row.schedule_interval || undefined,
        periodLabels: row.period_labels || undefined,
        costCenters: row.cost_centers || undefined,
        isTemplate: row.is_template || false,
        desoneracao: row.desoneracao || undefined,
        version: row.version || undefined,
        revision: row.revision || undefined,
        revisionNotes: row.revision_notes || undefined,
        isFrozen: row.is_frozen || false,
        frozenAt: row.frozen_at ? new Date(row.frozen_at) : undefined,
        frozenBy: row.frozen_by || undefined,
        parentBudgetId: row.parent_budget_id || undefined,
        isScenario: row.is_scenario || false,
        scenarioName: row.scenario_name || undefined,
        // SINAPI Regime fields
        sinapiUf: row.sinapi_uf || 'BA',
        sinapiCompetence: row.sinapi_competence || '2025-01',
        sinapiRegime: row.sinapi_regime || 'NAO_DESONERADO',
        sinapiContractType: row.sinapi_contract_type || 'HORISTA',
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
        metadata: row.metadata || undefined,
        settings: row.settings || undefined
    };
}
function toInsert(budget) {
    return {
        name: budget.name,
        client_name: budget.client,
        date: budget.date ? budget.date.toISOString() : new Date().toISOString(),
        status: budget.status ?? 'draft',
        total_value: budget.totalValue || 0,
        bdi: budget.bdi || 0,
        encargos_percentage: budget.encargosSociais || 0,
        obra_type: budget.obraType,
        proposal_cover: budget.proposalCover,
        proposal_terms: budget.proposalTerms,
        schedule_interval: budget.scheduleInterval,
        period_labels: budget.periodLabels,
        cost_centers: budget.costCenters,
        is_template: budget.isTemplate ?? false,
        desoneracao: budget.desoneracao,
        version: budget.version,
        revision: budget.revision,
        revision_notes: budget.revisionNotes,
        is_frozen: budget.isFrozen ?? false,
        frozen_at: budget.frozenAt?.toISOString(),
        frozen_by: budget.frozenBy,
        parent_budget_id: budget.parentBudgetId,
        is_scenario: budget.isScenario ?? false,
        scenario_name: budget.scenarioName,
        updated_at: new Date().toISOString(),
        metadata: budget.metadata,
        settings: budget.settings
    };
}
exports.BudgetService = {
    async getAll() {
        const { data: { user } } = await supabase_1.supabase.auth.getUser();
        if (!user)
            throw new Error('Usuário não autenticado');
        const { data, error } = await supabase_1.supabase
            .from('budgets')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });
        if (error)
            throw error;
        return data.map(toDomain);
    },
    async getById(id) {
        const { data: { user } } = await supabase_1.supabase.auth.getUser();
        if (!user)
            throw new Error('Usuário não autenticado');
        const { data, error } = await supabase_1.supabase
            .from('budgets')
            .select('*')
            .eq('id', id)
            .eq('user_id', user.id)
            .single();
        if (error)
            throw error;
        return toDomain(data);
    },
    async create(budget) {
        const { data: { user } } = await supabase_1.supabase.auth.getUser();
        if (!user)
            throw new Error('Usuário não autenticado');
        const payload = {
            ...toInsert(budget),
            user_id: user.id
        };
        const { data, error } = await supabase_1.supabase
            .from('budgets')
            .insert(payload)
            .select()
            .single();
        if (error)
            throw error;
        return toDomain(data);
    },
    async update(id, budget) {
        const { data: { user } } = await supabase_1.supabase.auth.getUser();
        if (!user)
            throw new Error('Usuário não autenticado');
        const payload = {
            updated_at: new Date().toISOString(),
        };
        if (budget.name !== undefined)
            payload.name = budget.name;
        if (budget.client !== undefined)
            payload.client_name = budget.client;
        if (budget.status !== undefined)
            payload.status = budget.status;
        if (budget.bdi !== undefined)
            payload.bdi = budget.bdi;
        if (budget.encargosSociais !== undefined)
            payload.encargos_percentage = budget.encargosSociais;
        if (budget.totalValue !== undefined)
            payload.total_value = budget.totalValue;
        // SINAPI Regime fields
        if (budget.sinapiUf !== undefined)
            payload.sinapi_uf = budget.sinapiUf;
        if (budget.sinapiCompetence !== undefined)
            payload.sinapi_competence = budget.sinapiCompetence;
        if (budget.sinapiRegime !== undefined)
            payload.sinapi_regime = budget.sinapiRegime;
        if (budget.sinapiContractType !== undefined)
            payload.sinapi_contract_type = budget.sinapiContractType;
        if (budget.metadata !== undefined)
            payload.metadata = budget.metadata;
        if (budget.settings !== undefined)
            payload.settings = budget.settings;
        const { data, error } = await supabase_1.supabase
            .from('budgets')
            .update(payload)
            .eq('id', id)
            .eq('user_id', user.id)
            .select()
            .single();
        if (error)
            throw error;
        return toDomain(data);
    },
    async delete(id) {
        const { data: { user } } = await supabase_1.supabase.auth.getUser();
        if (!user)
            throw new Error('Usuário não autenticado');
        const { error } = await supabase_1.supabase
            .from('budgets')
            .delete()
            .eq('id', id)
            .eq('user_id', user.id);
        if (error)
            throw error;
    }
};
