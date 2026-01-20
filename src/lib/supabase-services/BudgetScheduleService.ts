import { supabase } from '../supabase';
import { type Database } from '../../types/supabase';
import { type BudgetSchedule } from '../../types/domain';

type BudgetScheduleRow = Database['public']['Tables']['budget_schedules']['Row'];
type BudgetScheduleInsert = Database['public']['Tables']['budget_schedules']['Insert'];

function toDomain(row: BudgetScheduleRow): BudgetSchedule {
    return {
        id: row.id,
        budgetId: row.budget_id,
        itemId: row.item_id,
        period: row.period,
        percentage: row.percentage,
        value: row.value,
    };
}

function toInsert(schedule: BudgetSchedule): BudgetScheduleInsert {
    return {
        budget_id: schedule.budgetId,
        item_id: schedule.itemId,
        period: schedule.period,
        percentage: schedule.percentage,
        value: schedule.value,
    };
}

export const BudgetScheduleService = {
    async getByBudgetId(budgetId: string): Promise<BudgetSchedule[]> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Usuário não autenticado');

        const { data, error } = await supabase
            .from('budget_schedules')
            .select('*')
            .eq('budget_id', budgetId)
            .eq('user_id', user.id)
            .order('period');

        if (error) throw error;
        return data.map(toDomain);
    },

    async create(schedule: BudgetSchedule): Promise<BudgetSchedule> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Usuário não autenticado');

        const payload = {
            ...toInsert(schedule),
            user_id: user.id,
            created_at: new Date().toISOString()
        };
        const { data, error } = await (supabase
            .from('budget_schedules') as any)
            .insert(payload)
            .select()
            .single();

        if (error) throw error;
        return toDomain(data);
    },

    async saveBatch(budgetId: string, schedules: Partial<BudgetSchedule>[]): Promise<void> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Usuário não autenticado');

        // 1. Delete all existing schedules for this budget
        const { error: deleteError } = await supabase
            .from('budget_schedules')
            .delete()
            .eq('budget_id', budgetId)
            .eq('user_id', user.id);

        if (deleteError) throw deleteError;

        if (schedules.length === 0) return;

        // 2. Insert new ones in bulk
        const payloads = schedules.map(s => ({
            budget_id: budgetId,
            item_id: s.itemId,
            period: s.period,
            percentage: s.percentage,
            value: s.value,
            user_id: user.id,
            created_at: new Date().toISOString()
        }));

        const { error: insertError } = await (supabase
            .from('budget_schedules') as any)
            .insert(payloads);

        if (insertError) throw insertError;
    },

    async delete(id: string): Promise<void> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Usuário não autenticado');

        const { error } = await supabase
            .from('budget_schedules')
            .delete()
            .eq('id', id)
            .eq('user_id', user.id);

        if (error) throw error;
    }
};
