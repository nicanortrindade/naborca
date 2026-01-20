import { supabase } from '../supabase';
import { type Database } from '../../types/supabase';
import { type Insumo } from '../../types/domain';

type InsumoRow = Database['public']['Tables']['insumos']['Row'];
type InsumoInsert = Database['public']['Tables']['insumos']['Insert'];

function toDomain(row: InsumoRow): Insumo {
    return {
        id: row.id,
        codigo: row.code,
        descricao: row.description,
        unidade: row.unit || '',
        preco: row.price,
        tipo: row.type as any,
        fonte: row.fonte || '',
        dataReferencia: new Date(row.data_referencia || new Date()),
        isOficial: row.is_oficial || false,
        isEditavel: row.is_editavel || false,
        observacoes: row.observacoes || undefined,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
    };
}

function toInsert(insumo: Partial<Insumo>): Omit<InsumoInsert, 'user_id'> {
    return {
        code: insumo.codigo!,
        description: insumo.descricao!,
        unit: insumo.unidade!,
        price: insumo.preco!,
        type: insumo.tipo!,
        fonte: insumo.fonte,
        data_referencia: insumo.dataReferencia ? insumo.dataReferencia.toISOString() : undefined,
        is_oficial: insumo.isOficial,
        is_editavel: insumo.isEditavel,
        observacoes: insumo.observacoes,
        updated_at: new Date().toISOString(),
    };
}

export const InsumoService = {
    async getAll(): Promise<Insumo[]> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Usuário não autenticado');

        const { data, error } = await supabase
            .from('insumos')
            .select('*')
            .eq('user_id', user.id)
            .order('description', { ascending: true });

        if (error) throw error;
        return data.map(toDomain);
    },

    async search(query: string): Promise<Insumo[]> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Usuário não autenticado');

        const { data, error } = await supabase
            .from('insumos')
            .select('*')
            .eq('user_id', user.id)
            .or(`description.ilike.%${query}%,code.ilike.%${query}%`)
            .limit(50);

        if (error) throw error;
        return data.map(toDomain);
    },

    async create(insumo: Partial<Insumo>): Promise<Insumo> {
        const { data: { user } } = await supabase.auth.getUser();
        const payload = { ...toInsert(insumo), user_id: user?.id };
        const { data, error } = await (supabase.from('insumos') as any).insert(payload).select().single();
        if (error) throw error;
        return toDomain(data);
    },

    async getByCodes(codes: string[], source?: string): Promise<Insumo[]> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return [];

        // Use supabaseOps logic internally or just simpler chunking here
        // Since this is a read operation, we can use 'in' directly
        // But for massive lists, 'in' limit is ~65k params, usually safe for chunks of 1000

        let query = supabase
            .from('insumos')
            .select('*')
            .eq('user_id', user.id)
            .in('code', codes);

        if (source) {
            query = query.eq('fonte', source);
        }

        const { data, error } = await query;
        if (error) throw error;
        return data ? data.map(toDomain) : [];
    },

    async batchUpsert(insumos: any[]): Promise<Insumo[]> {
        const { chunk, runWithConcurrency, withRetry } = await import('../../utils/supabaseOps');
        const { data: { user } } = await supabase.auth.getUser();

        const payloads = insumos.map(i => ({
            code: i.codigo,
            description: i.descricao,
            unit: i.unidade,
            price: i.preco,
            type: i.tipo,
            fonte: i.fonte,
            user_id: user?.id,
            updated_at: new Date().toISOString(),
            is_oficial: i.isOficial,
            is_editavel: i.isEditavel,
            data_referencia: i.dataReferencia ? new Date(i.dataReferencia).toISOString() : null,
            observacoes: i.observacoes
        }));

        const chunks = chunk(payloads, 200);

        const tasks = chunks.map(batch => async () => {
            return await withRetry(async () => {
                const { data, error } = await (supabase.from('insumos') as any)
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
