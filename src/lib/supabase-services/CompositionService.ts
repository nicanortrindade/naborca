import { supabase } from '../supabase';
import { type Database } from '../../types/supabase';
import { type Composicao, type ComposicaoItem } from '../../types/domain';

type CompositionRow = Database['public']['Tables']['compositions']['Row'];
type CompositionInsert = Database['public']['Tables']['compositions']['Insert'];
type CompositionItemRow = Database['public']['Tables']['composition_items']['Row'];

function toDomain(row: CompositionRow): Composicao {
    return {
        id: row.id,
        codigo: row.code,
        descricao: row.description,
        unidade: row.unit || '',
        fonte: row.fonte || '',
        custoTotal: row.total_cost,
        dataReferencia: new Date(row.data_referencia || new Date()),
        isOficial: row.is_oficial || false,
        isCustomizada: row.is_customizada || false,
        observacoes: row.observacoes || undefined,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
    };
}

function toItemDomain(row: CompositionItemRow): ComposicaoItem {
    return {
        id: row.id,
        composicaoId: row.composition_id,
        insumoId: row.insumo_id,
        codigoInsumo: row.insumo_code || '',
        descricaoInsumo: row.insumo_description || '',
        unidadeInsumo: row.insumo_unit || '',
        coeficiente: row.coefficient,
        precoUnitario: row.unit_price,
        custoTotal: row.total_cost,
    };
}

export const CompositionService = {
    async getAll(): Promise<Composicao[]> {
        const { data: { user } } = await supabase.auth.getUser();
        const { data, error } = await supabase.from('compositions').select('*').eq('user_id', user?.id);
        if (error) throw error;
        return data.map(toDomain);
    },

    async search(query: string): Promise<Composicao[]> {
        const { data: { user } } = await supabase.auth.getUser();
        const { data, error } = await supabase.from('compositions').select('*').eq('user_id', user?.id).or(`description.ilike.%${query}%,code.ilike.%${query}%`);
        if (error) throw error;
        return data.map(toDomain);
    },

    async getItems(compositionId: string): Promise<ComposicaoItem[]> {
        const { data, error } = await (supabase.from('composition_items') as any).select('*').eq('composition_id', compositionId);
        if (error) throw error;
        return data.map(toItemDomain);
    },

    async create(composition: Partial<Composicao>, items?: ComposicaoItem[]): Promise<Composicao> {
        const { data: { user } } = await supabase.auth.getUser();
        const payload: any = {
            code: composition.codigo,
            description: composition.descricao,
            unit: composition.unidade,
            total_cost: composition.custoTotal,
            fonte: composition.fonte,
            user_id: user?.id,
            data_referencia: composition.dataReferencia ? new Date(composition.dataReferencia).toISOString() : null,
            updated_at: new Date().toISOString()
        };
        const { data, error } = await (supabase.from('compositions') as any).insert(payload).select().single();
        if (error) throw error;

        if (items && items.length > 0) {
            const itemPayloads = items.map(i => ({
                composition_id: data.id,
                insumo_id: i.insumoId,
                insumo_code: i.codigoInsumo,
                insumo_description: i.descricaoInsumo,
                coefficient: i.coeficiente,
                unit_price: i.precoUnitario,
                total_cost: i.custoTotal
            }));
            await (supabase.from('composition_items') as any).insert(itemPayloads);
        }
        return toDomain(data);
    },

    async getByCodes(codes: string[]): Promise<Composicao[]> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return [];

        const { data, error } = await supabase
            .from('compositions')
            .select('*')
            .eq('user_id', user.id)
            .in('code', codes);

        if (error) throw error;
        return data ? data.map(toDomain) : [];
    },

    async batchUpsert(compositions: Partial<Composicao>[]): Promise<Composicao[]> {
        const { chunk, runWithConcurrency, withRetry } = await import('../../utils/supabaseOps');
        const { data: { user } } = await supabase.auth.getUser();

        const payloads = compositions.map(c => ({
            code: c.codigo,
            description: c.descricao,
            unit: c.unidade,
            total_cost: c.custoTotal,
            fonte: c.fonte,
            user_id: user?.id,
            data_referencia: c.dataReferencia ? new Date(c.dataReferencia).toISOString() : null,
            is_customizada: c.isCustomizada,
            updated_at: new Date().toISOString()
        }));

        const chunks = chunk(payloads, 200);

        const tasks = chunks.map(batch => async () => {
            return await withRetry(async () => {
                const { data, error } = await (supabase.from('compositions') as any)
                    .upsert(batch, { onConflict: 'code, fonte, user_id', ignoreDuplicates: false })
                    .select();

                if (error) throw error;
                return (data || []).map(toDomain);
            });
        });

        const results = await runWithConcurrency(tasks, 4);
        return results.flat();
    }
};
