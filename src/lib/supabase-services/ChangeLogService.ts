import { supabase } from '../supabase';
import { type Database } from '../../types/supabase';
import { type ChangeLog } from '../../types/domain';

type ChangeLogRow = Database['public']['Tables']['change_logs']['Row'];
type ChangeLogInsert = Database['public']['Tables']['change_logs']['Insert'];

function toDomain(row: ChangeLogRow): ChangeLog {
    return {
        id: row.id,
        budgetId: row.budget_id || undefined,
        itemId: row.item_id || undefined,
        proposalId: row.proposal_id || undefined,
        action: row.action as any,
        field: row.field || undefined,
        oldValue: row.old_value || undefined,
        newValue: row.new_value || undefined,
        description: row.description,
        user: row.user_name || undefined,
        timestamp: new Date(row.timestamp),
    };
}

function toInsert(log: ChangeLog): ChangeLogInsert {
    return {
        budget_id: log.budgetId,
        item_id: log.itemId,
        proposal_id: log.proposalId,
        action: log.action,
        field: log.field,
        old_value: log.oldValue,
        new_value: log.newValue,
        description: log.description,
        user_name: log.user,
        timestamp: log.timestamp.toISOString(),
    };
}

export const ChangeLogService = {
    async getByBudgetId(budgetId: string): Promise<ChangeLog[]> {
        const { data, error } = await supabase
            .from('change_logs')
            .select('*')
            .eq('budget_id', budgetId)
            .order('timestamp', { ascending: false });

        if (error) throw error;
        return data.map(toDomain);
    },

    async getByProposalId(proposalId: string): Promise<ChangeLog[]> {
        const { data, error } = await supabase
            .from('change_logs')
            .select('*')
            .eq('proposal_id', proposalId)
            .order('timestamp', { ascending: false });

        if (error) throw error;
        return data.map(toDomain);
    },

    async create(log: ChangeLog): Promise<ChangeLog> {
        const payload = toInsert(log);
        const { data, error } = await (supabase
            .from('change_logs') as any)
            .insert(payload)
            .select()
            .single();

        if (error) throw error;
        return toDomain(data);
    },
};
