import { supabase } from '../supabase';

// =====================================================
// SINAPI Service - Base de Referência Pública
// =====================================================

export interface SinapiPriceTable {
    id: string;
    source: string;
    uf: string;
    competence: string;
    regime: 'DESONERADO' | 'NAO_DESONERADO';
    file_urls?: any;
    is_mock?: boolean;
    source_tag?: string;
    created_at: string;
}

export interface SinapiInput {
    id: string;
    source: string;
    code: string;
    description: string;
    unit?: string;
    category?: string;
    active: boolean;
}

export interface SinapiInputWithPrice extends SinapiInput {
    price?: number;
    uf?: string;
    competence?: string;
    regime?: string;
}

export interface SinapiComposition {
    id: string;
    source: string;
    code: string;
    description: string;
    unit?: string;
    composition_type?: string;
    active: boolean;
}

export interface SinapiCompositionWithPrice extends SinapiComposition {
    price?: number;
    uf?: string;
    competence?: string;
    regime?: string;
    items_count?: number;
}

export interface SinapiCompositionItem {
    id: string;
    price_table_id: string;
    composition_code: string;
    item_type: 'INSUMO' | 'COMPOSICAO';
    item_code: string;
    coefficient: number;
    unit?: string;
}

export interface SinapiImportRun {
    id: string;
    user_id?: string;
    uf: string;
    year: number;
    months?: number[];
    regimes?: string[];
    status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'ERROR';
    logs?: string;
    counts?: {
        inputs?: number;
        compositions?: number;
        input_prices?: number;
        composition_prices?: number;
        composition_items?: number;
        skipped_months?: number[];
    };
    error_message?: string;
    started_at: string;
    finished_at?: string;
}

export const SinapiService = {
    // =====================================================
    // PRICE TABLES
    // =====================================================

    /**
     * Busca tabelas de preço.
     * Por padrão, filtra bases mock (is_mock=false).
     * Use includeMock=true para incluir bases de teste.
     */
    async getPriceTables(filters?: { uf?: string; competence?: string; regime?: string; includeMock?: boolean }): Promise<SinapiPriceTable[]> {
        // LEGACY TABLE REPLACEMENT: Pointing to new structure if possible, but price_tables might still be separate.
        // User directive was "sinapi_inputs" is legacy. "sinapi_price_tables" might still be valid or renamed.
        // Assuming "sinapi_price_tables" is still the metadata table for now, as user focused on 'insumos'.
        let query = (supabase.from('sinapi_price_tables') as any).select('*');

        // REGRA: Não mostrar mocks por padrão (sem fallback silencioso)
        if (!filters?.includeMock) {
            query = query.eq('is_mock', false);
        }

        if (filters?.uf) query = query.eq('uf', filters.uf);
        if (filters?.competence) query = query.eq('competence', filters.competence);
        if (filters?.regime) query = query.eq('regime', filters.regime);

        const { data, error } = await query.order('competence', { ascending: false });
        if (error) throw error;
        return data || [];
    },

    /**
     * Busca tabela de preço específica.
     * Somente bases oficiais (is_mock=false).
     * Se não encontrar, retorna null (sem fallback silencioso).
     */
    async getPriceTable(uf: string, competence: string, regime: string): Promise<SinapiPriceTable | null> {
        const { data, error } = await (supabase
            .from('sinapi_price_tables') as any)
            .select('*')
            .eq('uf', uf)
            .eq('competence', competence)
            .eq('regime', regime)
            .eq('is_mock', false)
            .single();

        if (error && error.code !== 'PGRST116') throw error;
        return data;
    },

    /**
     * Verifica se existe base SINAPI para o orçamento.
     * Retorna mensagem de erro se não encontrar.
     */
    async validateBaseForBudget(uf: string, competence: string, regime: string): Promise<{ valid: boolean; message?: string }> {
        const table = await this.getPriceTable(uf, competence, regime);
        if (!table) {
            return {
                valid: false,
                message: `Base SINAPI não encontrada para ${uf}/${competence}/${regime === 'DESONERADO' ? 'Desonerado' : 'Não Desonerado'}`
            };
        }
        return { valid: true };
    },

    /**
     * Marca uma tabela de preços como mock/legado.
     */
    async markAsMock(priceTableId: string, isMock: boolean = true, sourceTag: string = 'MOCK'): Promise<void> {
        const { error } = await (supabase
            .from('sinapi_price_tables') as any)
            .update({ is_mock: isMock, source_tag: sourceTag })
            .eq('id', priceTableId);

        if (error) throw error;
    },

    /**
     * Marca TODAS as tabelas existentes como mock.
     * Usar antes de importar base oficial para isolar dados antigos.
     */
    async markAllExistingAsMock(): Promise<number> {
        const { data, error } = await (supabase
            .from('sinapi_price_tables') as any)
            .update({ is_mock: true, source_tag: 'LEGACY' })
            .eq('is_mock', false)
            .select('id');

        if (error) throw error;
        return data?.length || 0;
    },

    async upsertPriceTable(table: Omit<SinapiPriceTable, 'id' | 'created_at'>): Promise<SinapiPriceTable> {
        // Parâmetros corretos para a RPC (MUST match banco!)
        const source = table.source || 'SINAPI';
        const uf = table.uf;
        const competencia = table.competence; // Variável local com nome correto
        const regime = table.regime;
        const isMock = table.is_mock ?? false;

        console.log(`[SINAPI SERVICE] upsertPriceTable: source=${source} uf=${uf} competencia=${competencia} regime=${regime} is_mock=${isMock}`);

        // Chamada RPC com parâmetros EXATOS (p_competencia, NÃO p_competence!)
        const { data: id, error } = await (supabase.rpc as any)('ingest_sinapi_price_table', {
            p_source: source,
            p_uf: uf,
            p_competencia: competencia,
            p_regime: regime,
            p_is_mock: isMock
        });

        if (error) {
            console.error('[SINAPI SERVICE] ERRO na RPC ingest_sinapi_price_table:', error);
            // Fallback DESATIVADO - RLS impede acesso direto e causa erros de UUID null
            throw new Error(`RPC ingest_sinapi_price_table falhou: ${error.message}. Fallback desativado.`);
        }

        // Validar que a RPC retornou um UUID válido
        if (!id) {
            console.error('[SINAPI SERVICE] RPC retornou id nulo/undefined');
            throw new Error('RPC ingest_sinapi_price_table não retornou ID válido.');
        }

        console.log(`[SINAPI SERVICE] Price table criada/atualizada: id=${id}`);

        // Recuperar o objeto criado
        const { data: finalData, error: fetchError } = await (supabase
            .from('sinapi_price_tables') as any)
            .select('*')
            .eq('id', id)
            .single();

        if (fetchError) {
            console.error('[SINAPI SERVICE] Erro ao recuperar price_table após criação:', fetchError);
            throw fetchError;
        }

        return finalData;
    },

    // =====================================================
    // INPUTS (Insumos)
    // =====================================================

    async searchInputs(query: string, filters?: { uf?: string; competence?: string; regime?: string }): Promise<SinapiInputWithPrice[]> {
        // REFACTOR: Use 'insumos' instead of 'sinapi_inputs'
        // 'insumos' view/table is the new source of truth.

        // Se temos filtros de preço, usamos a view apropriada ou a tabela 'insumos' filtrada
        if (filters?.uf && filters?.competence && filters?.regime) {
            // Assuming 'insumos' contains price info or we join. 
            // For now, simpler to search 'insumos' directly which is the request.
            // Note: 'insumos' might duplicate if it has prices, or just be the catalog.
            // User said: "View/Tabela: public.insumos (retorna INPUT e COMPOSITION)"
            const { data, error } = await (supabase
                .from('insumos') as any)
                .select('*')
                // .eq('uf', filters.uf) // If insumos has UF/Competence columns
                .or(`description.ilike.%${query}%,code.ilike.%${query}%`)
                .eq('type', 'INPUT') // Filter for inputs only
                .limit(100);

            if (error) throw error;
            return data || [];
        }

        // Busca simples
        const { data, error } = await (supabase
            .from('insumos') as any)
            .select('*')
            .or(`description.ilike.%${query}%,code.ilike.%${query}%`)
            .eq('type', 'INPUT')
            .limit(100);

        if (error) throw error;
        return data || [];
    },

    async getInputByCode(code: string): Promise<SinapiInput | null> {
        const { data, error } = await (supabase
            .from('insumos') as any)
            .select('*')
            .eq('code', code)
            // .eq('type', 'INPUT') // Optional redundancy if code is unique
            .single();

        if (error && error.code !== 'PGRST116') throw error;
        return data;
    },

    async getInputPrice(code: string, uf: string, competence: string, regime: string): Promise<number | null> {
        const priceTable = await this.getPriceTable(uf, competence, regime);
        if (!priceTable) return null;

        const { data, error } = await (supabase
            .from('sinapi_input_prices') as any)
            .select('price')
            .eq('price_table_id', priceTable.id)
            .eq('input_code', code)
            .single();

        if (error && error.code !== 'PGRST116') throw error;
        return data?.price || null;
    },

    async batchUpsertInputs(inputs: Array<{ code: string; description: string; unit?: string; category?: string }>): Promise<number> {
        const CHUNK_SIZE = 1000;
        let successCount = 0;

        for (let i = 0; i < inputs.length; i += CHUNK_SIZE) {
            const chunk = inputs.slice(i, i + CHUNK_SIZE);

            // RPC
            const { data, error } = await (supabase.rpc as any)('ingest_sinapi_inputs_batch', {
                p_inputs: chunk
            });

            if (error) {
                console.error('[SINAPI SERVICE] RPC Error ingest_sinapi_inputs_batch:', error);
                // Fallback DESATIVADO - throw direto
                throw new Error(`RPC ingest_sinapi_inputs_batch falhou: ${error.message}`);
            } else {
                // RPC retornou sucesso: pode ser número ou void
                // Se retornar número, usar ele; senão, assumir chunk.length
                const count = typeof data === 'number' ? data : chunk.length;
                successCount += count;
            }
        }
        console.log(`[SINAPI SERVICE] batchUpsertInputs: ${successCount} de ${inputs.length} inputs persistidos`);
        return successCount;
    },

    async batchUpsertInputPrices(priceTableId: string, prices: Array<{ input_code: string; price: number }>): Promise<number> {
        if (!prices || prices.length === 0) {
            console.log('[SINAPI SERVICE] batchUpsertInputPrices: nenhum preço para persistir');
            return 0;
        }

        // Garantir que é um array puro com formato correto para a RPC
        // RPC espera: Array<{code: string, price: number}> (campo 'code', não 'input_code')
        const formattedPrices: Array<{ code: string; price: number }> = prices.map(p => ({
            code: p.input_code,
            price: p.price
        }));

        console.log('[SINAPI SERVICE] batchUpsertInputPrices payload', {
            priceTableId,
            count: Array.isArray(formattedPrices) ? formattedPrices.length : 'NOT_ARRAY',
            sample: Array.isArray(formattedPrices) ? formattedPrices[0] : formattedPrices,
        });

        const CHUNK_SIZE = 1000;
        let successCount = 0;

        for (let i = 0; i < formattedPrices.length; i += CHUNK_SIZE) {
            const chunk = formattedPrices.slice(i, i + CHUNK_SIZE);

            // Chamada RPC com parâmetros EXATOS da assinatura do banco:
            // ingest_sinapi_input_prices_batch(p_price_table_id uuid, p_prices jsonb)
            const { data, error } = await (supabase.rpc as any)('ingest_sinapi_input_prices_batch', {
                p_price_table_id: priceTableId,
                p_prices: chunk
            });

            if (error) {
                console.error('[SINAPI SERVICE] RPC Error ingest_sinapi_input_prices_batch:', error);
                throw new Error(`RPC ingest_sinapi_input_prices_batch falhou: ${error.message}`);
            } else {
                const count = typeof data === 'number' ? data : chunk.length;
                successCount += count;
            }
        }

        console.log('[SINAPI SERVICE] batchUpsertInputPrices OK', { count: successCount });
        return successCount;
    },

    // =====================================================
    // COMPOSITIONS (Composições/CPU)
    // =====================================================

    async searchCompositions(query: string, filters?: { uf?: string; competence?: string; regime?: string }): Promise<SinapiCompositionWithPrice[]> {
        // REFACTOR: Use 'insumos' (filtered by type COMPOSITION) or 'compositions' table
        // User said: "View/Tabela: public.insumos (retorna INPUT e COMPOSITION)"

        if (filters?.uf && filters?.competence && filters?.regime) {
            const { data, error } = await (supabase
                .from('insumos') as any)
                .select('*')
                // .eq('uf', filters.uf)
                .or(`description.ilike.%${query}%,code.ilike.%${query}%`)
                .eq('type', 'COMPOSITION')
                .limit(100);

            if (error) throw error;
            return data || [];
        }

        const { data, error } = await (supabase
            .from('insumos') as any)
            .select('*')
            .or(`description.ilike.%${query}%,code.ilike.%${query}%`)
            .eq('type', 'COMPOSITION')
            .limit(100);

        if (error) throw error;
        return data || [];
    },

    async getCompositionByCode(code: string): Promise<SinapiComposition | null> {
        const { data, error } = await (supabase
            .from('insumos') as any) // Unified view
            .select('*')
            .eq('code', code)
            .eq('type', 'COMPOSITION') // Critical to differentiate if code overlaps
            .single();

        if (error && error.code !== 'PGRST116') throw error;
        return data;
    },

    async getCompositionItems(compositionCode: string, uf: string, competence: string, regime: string): Promise<Array<SinapiCompositionItem & { description?: string; price?: number }>> {
        const priceTable = await this.getPriceTable(uf, competence, regime);
        if (!priceTable) return [];

        const { data: items, error } = await (supabase
            .from('sinapi_composition_items') as any)
            .select('*')
            .eq('price_table_id', priceTable.id)
            .eq('composition_code', compositionCode);

        if (error) throw error;
        if (!items || items.length === 0) return [];

        // Enriquecer com descrições e preços
        const enrichedItems = await Promise.all(items.map(async (item: any) => {
            let description = '';
            let price: number | null = null;

            if (item.item_type === 'INSUMO') {
                const input = await this.getInputByCode(item.item_code);
                description = input?.description || '';
                price = await this.getInputPrice(item.item_code, uf, competence, regime);
            } else {
                const comp = await this.getCompositionByCode(item.item_code);
                description = comp?.description || '';
                const compPrice = await (supabase
                    .from('sinapi_composition_prices') as any)
                    .select('price')
                    .eq('price_table_id', priceTable.id)
                    .eq('composition_code', item.item_code)
                    .single();
                price = compPrice.data?.price || null;
            }

            return { ...item, description, price };
        }));

        return enrichedItems;
    },

    async batchUpsertCompositions(compositions: Array<{ code: string; description: string; unit?: string; composition_type?: string }>): Promise<number> {
        const CHUNK_SIZE = 1000;
        let successCount = 0;

        for (let i = 0; i < compositions.length; i += CHUNK_SIZE) {
            const chunk = compositions.slice(i, i + CHUNK_SIZE);

            // RPC
            const { data, error } = await (supabase.rpc as any)('ingest_sinapi_compositions_batch', {
                p_compositions: chunk
            });

            if (error) {
                console.error('[SINAPI SERVICE] RPC Error ingest_sinapi_compositions_batch:', error);
                throw new Error(`RPC ingest_sinapi_compositions_batch falhou: ${error.message}`);
            } else {
                const count = typeof data === 'number' && data !== null ? data : chunk.length;
                successCount += count;
            }
        }
        console.log(`[SINAPI SERVICE] batchUpsertCompositions OK - Total: ${successCount}`);
        return successCount;
    },

    async batchUpsertCompositionPrices(priceTableId: string, prices: Array<{ composition_code: string; price: number }>): Promise<number> {
        if (!prices || prices.length === 0) {
            console.log('[SINAPI SERVICE] batchUpsertCompositionPrices: nenhum preço para persistir');
            return 0;
        }

        // Garantir formato correto para a RPC
        // RPC espera: Array<{code: string, price: number}> (campo 'code', não 'composition_code')
        const formattedPrices: Array<{ code: string; price: number }> = prices.map(p => ({
            code: p.composition_code,
            price: p.price
        }));

        console.log('[SINAPI SERVICE] batchUpsertCompositionPrices payload', {
            priceTableId,
            count: Array.isArray(formattedPrices) ? formattedPrices.length : 'NOT_ARRAY',
            sample: Array.isArray(formattedPrices) ? formattedPrices[0] : formattedPrices,
        });

        const CHUNK_SIZE = 1000;
        let successCount = 0;

        for (let i = 0; i < formattedPrices.length; i += CHUNK_SIZE) {
            const chunk = formattedPrices.slice(i, i + CHUNK_SIZE);

            // Chamada RPC com parâmetros EXATOS:
            // ingest_sinapi_composition_prices_batch(p_price_table_id uuid, p_prices jsonb)
            const { data, error } = await (supabase.rpc as any)('ingest_sinapi_composition_prices_batch', {
                p_price_table_id: priceTableId,
                p_prices: chunk
            });

            if (error) {
                console.error('[SINAPI SERVICE] RPC Error ingest_sinapi_composition_prices_batch:', error);
                throw new Error(`RPC ingest_sinapi_composition_prices_batch falhou: ${error.message}`);
            } else {
                const count = typeof data === 'number' ? data : chunk.length;
                successCount += count;
            }
        }

        console.log('[SINAPI SERVICE] batchUpsertCompositionPrices OK', { count: successCount });
        return successCount;
    },

    async batchUpsertCompositionItems(priceTableId: string, items: Array<{
        composition_code: string;
        item_type: 'INSUMO' | 'COMPOSICAO';
        item_code: string;
        coefficient: number;
        unit?: string;
    }>): Promise<number> {
        const totalBefore = items.length;

        // DEDUPLICAÇÃO: Evitar "ON CONFLICT DO UPDATE command cannot affect row a second time"
        // Chave única: price_table_id|composition_code|item_type|item_code
        const itemMap = new Map<string, typeof items[0]>();
        const duplicateKeys: Record<string, number> = {};

        for (const item of items) {
            const key = `${priceTableId}|${item.composition_code}|${item.item_type}|${item.item_code}`;

            if (itemMap.has(key)) {
                // Contabilizar duplicata
                duplicateKeys[key] = (duplicateKeys[key] || 1) + 1;
            }

            // Manter o último (ou poderia manter o de maior coefficient)
            itemMap.set(key, item);
        }

        const dedupedItems = Array.from(itemMap.values());
        const totalAfter = dedupedItems.length;
        const duplicatesRemoved = totalBefore - totalAfter;

        console.log(`[SINAPI SERVICE] Composition Items - Before dedupe: ${totalBefore}, After: ${totalAfter}, Duplicates removed: ${duplicatesRemoved}`);

        if (duplicatesRemoved > 0) {
            const topDupes = Object.entries(duplicateKeys)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([key, count]) => `${key} (x${count})`)
                .join(', ');
            console.warn(`[SINAPI SERVICE] Top duplicate keys: ${topDupes}`);
        }

        if (dedupedItems.length === 0) {
            console.warn('[SINAPI SERVICE] Nenhum item para persistir após dedupe');
            return 0;
        }

        const CHUNK_SIZE = 1000;
        let successCount = 0;

        for (let i = 0; i < dedupedItems.length; i += CHUNK_SIZE) {
            const chunk = dedupedItems.slice(i, i + CHUNK_SIZE);

            console.log(`[SINAPI SERVICE] batchUpsertCompositionItems chunk ${i / CHUNK_SIZE + 1}`, {
                count: chunk.length,
                sample: chunk[0]
            });

            // RPC: ingest_sinapi_composition_items_batch(p_price_table_id, p_items)
            const { data, error } = await (supabase.rpc as any)('ingest_sinapi_composition_items_batch', {
                p_price_table_id: priceTableId,
                p_items: chunk
            });

            if (error) {
                console.error('[SINAPI SERVICE] RPC Error ingest_sinapi_composition_items_batch:', error);
                throw new Error(`RPC ingest_sinapi_composition_items_batch falhou: ${error.message}`);
            } else {
                // Se RPC retornou número, usar; senão assumir chunk.length
                const count = typeof data === 'number' && data !== null ? data : chunk.length;
                successCount += count;
                console.log(`[SINAPI SERVICE] Chunk persisted OK, count: ${count}`);
            }
        }

        console.log(`[SINAPI SERVICE] batchUpsertCompositionItems OK - Total: ${successCount} (from ${totalBefore} original, ${totalAfter} after dedupe)`);
        return successCount;
    },

    // =====================================================
    // IMPORT RUNS (Auditoria)
    // =====================================================

    async getImportRuns(limit = 20): Promise<SinapiImportRun[]> {
        const { data, error } = await (supabase
            .from('sinapi_import_runs') as any)
            .select('*')
            .order('started_at', { ascending: false })
            .limit(limit);

        if (error) throw error;
        return data || [];
    },

    async createImportRun(run: Omit<SinapiImportRun, 'id' | 'started_at'>): Promise<SinapiImportRun> {
        const { data: { user } } = await supabase.auth.getUser();

        const { data, error } = await (supabase
            .from('sinapi_import_runs') as any)
            .insert({
                user_id: user?.id,
                uf: run.uf,
                year: run.year,
                months: run.months,
                regimes: run.regimes,
                status: run.status || 'PENDING',
                logs: run.logs
            })
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    async updateImportRun(id: string, updates: Partial<SinapiImportRun>): Promise<void> {
        const { error } = await (supabase
            .from('sinapi_import_runs') as any)
            .update({
                status: updates.status,
                logs: updates.logs,
                counts: updates.counts,
                error_message: updates.error_message,
                finished_at: updates.finished_at
            })
            .eq('id', id);

        if (error) throw error;
    },

    // =====================================================
    // STATS
    // =====================================================

    async getStats(includeMock: boolean = false): Promise<{
        price_tables: number;
        inputs: number;
        compositions: number;
        ufs: string[];
        latest_competence: string | null;
        mock_count: number;
    }> {
        let tableQuery = (supabase.from('sinapi_price_tables') as any).select('id, uf, competence, is_mock', { count: 'exact' });
        if (!includeMock) {
            tableQuery = tableQuery.eq('is_mock', false);
        }

        const [tables, inputs, compositions, mockTables] = await Promise.all([
            tableQuery,
            (supabase.from('insumos') as any).select('id', { count: 'exact' }),
            (supabase.from('sinapi_compositions') as any).select('id', { count: 'exact' }),
            (supabase.from('sinapi_price_tables') as any).select('id', { count: 'exact' }).eq('is_mock', true)
        ]);

        const ufs = [...new Set((tables.data || []).map((t: any) => t.uf))];
        const latestCompetence = (tables.data || []).sort((a: any, b: any) => b.competence.localeCompare(a.competence))[0]?.competence || null;

        return {
            price_tables: tables.count || 0,
            inputs: inputs.count || 0,
            compositions: compositions.count || 0,
            ufs: ufs as string[],
            latest_competence: latestCompetence,
            mock_count: mockTables.count || 0
        };
    }
};
