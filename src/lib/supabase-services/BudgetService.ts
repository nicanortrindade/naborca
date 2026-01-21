import { supabase } from '../supabase';
import { type Database } from '../../types/supabase';
import { type Budget } from '../../types/domain';

type BudgetRow = Database['public']['Tables']['budgets']['Row'];
type BudgetInsert = Database['public']['Tables']['budgets']['Insert'];

function toDomain(row: BudgetRow): Budget {
    return {
        id: row.id,
        name: row.name,
        client: row.client_name || '',
        date: new Date(row.date),
        status: row.status as any,
        totalValue: row.total_value,
        bdi: row.bdi || 0,
        encargosSociais: row.encargos_percentage ?? (row as any).social_charges_percentage ?? 0,
        obraType: (row.obra_type as any) || undefined,
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
        sinapiUf: (row as any).sinapi_uf || 'BA',
        sinapiCompetence: (row as any).sinapi_competence || '2025-01',
        sinapiRegime: (row as any).sinapi_regime || 'NAO_DESONERADO',
        sinapiContractType: (row as any).sinapi_contract_type || 'HORISTA',
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
        metadata: (row as any).metadata || undefined,
        settings: (row as any).settings || undefined
    };
}


function toInsert(budget: Partial<Budget>): Omit<BudgetInsert, 'user_id'> {
    return {
        name: budget.name!,
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
    } as any;
}

export const BudgetService = {
    async getAll(): Promise<Budget[]> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Usuário não autenticado');

        const { data, error } = await supabase
            .from('budgets')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data.map(toDomain);
    },

    async getById(id: string): Promise<Budget> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Usuário não autenticado');

        const { data, error } = await supabase
            .from('budgets')
            .select('*')
            .eq('id', id)
            .eq('user_id', user.id)
            .single();

        if (error) throw error;
        return toDomain(data);
    },

    async create(budget: Partial<Budget>): Promise<Budget> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Usuário não autenticado');

        const payload = {
            ...toInsert(budget),
            user_id: user.id
        };

        const { data, error } = await (supabase
            .from('budgets') as any)
            .insert(payload)
            .select()
            .single();

        if (error) throw error;
        return toDomain(data);
    },

    async update(id: string, budget: Partial<Budget>): Promise<Budget> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Usuário não autenticado');

        const payload: any = {
            updated_at: new Date().toISOString(),
        };

        if (budget.name !== undefined) payload.name = budget.name;
        if (budget.client !== undefined) payload.client_name = budget.client;
        if (budget.status !== undefined) payload.status = budget.status;
        if (budget.bdi !== undefined) payload.bdi = budget.bdi;
        if (budget.encargosSociais !== undefined) payload.encargos_percentage = budget.encargosSociais;
        if (budget.totalValue !== undefined) payload.total_value = budget.totalValue;
        // SINAPI Regime fields
        if (budget.sinapiUf !== undefined) payload.sinapi_uf = budget.sinapiUf;
        if (budget.sinapiCompetence !== undefined) payload.sinapi_competence = budget.sinapiCompetence;
        if (budget.sinapiRegime !== undefined) payload.sinapi_regime = budget.sinapiRegime;
        if (budget.sinapiContractType !== undefined) payload.sinapi_contract_type = budget.sinapiContractType;
        if (budget.settings !== undefined) payload.settings = budget.settings;

        const { data, error } = await (supabase
            .from('budgets') as any)
            .update(payload)
            .eq('id', id)
            .eq('user_id', user.id)
            .select()
            .single();

        if (error) throw error;
        return toDomain(data);
    },

    async delete(id: string): Promise<void> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Usuário não autenticado');

        const { error } = await supabase
            .from('budgets')
            .delete()
            .eq('id', id)
            .eq('user_id', user.id);

        if (error) throw error;
    }
};
