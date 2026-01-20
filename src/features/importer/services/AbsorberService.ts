
import type { ResolvedItem } from '../types';
import { InsumoService } from '../../../lib/supabase-services/InsumoService';
import { CompositionService } from '../../../lib/supabase-services/CompositionService';

export const AbsorberService = {
    async absorbItems(items: ResolvedItem[], competenceStr: string): Promise<ResolvedItem[]> {
        const competence = new Date(competenceStr + '-01'); // Ensure date object
        const absorbed = [...items];

        // Filter NEW items
        const newItems = absorbed.filter(i => i.status === 'NEW' && !i.dbId && i.code); // Only absorb valid codes
        if (newItems.length === 0) return absorbed;

        const insumosToCreate = newItems.filter(i => !i.isComposition);
        const compositionsToCreate = newItems.filter(i => i.isComposition);

        // Batch Create Insumos
        if (insumosToCreate.length > 0) {
            const payload = insumosToCreate.map(item => ({
                codigo: item.finalCode,
                descricao: item.finalDescription,
                unidade: item.unit,
                preco: item.finalPrice,
                tipo: 'material',
                fonte: item.originalBank || 'IMPORTADO', // Use item metadata
                dataReferencia: competence,
                isOficial: false,
                isEditavel: true,
                observacoes: `Importado de ${item.originalFile || 'Arquivo Externo'}`
            }));

            try {
                const results = await InsumoService.batchUpsert(payload);
                // Map results back to items
                const idMap = new Map<string, string>();
                results.forEach(r => idMap.set(`${r.codigo}|${r.fonte}`, r.id!));

                insumosToCreate.forEach(item => {
                    const key = `${item.finalCode}|${item.originalBank || 'IMPORTADO'}`;
                    if (idMap.has(key)) {
                        item.dbId = idMap.get(key);
                        item.dbType = 'INPUT';
                        item.status = 'LINKED';
                    }
                });
            } catch (err) {
                console.error("Batch Insumo Absorb Failed", err);
            }
        }

        // Batch Create Compositions
        if (compositionsToCreate.length > 0) {
            const payload = compositionsToCreate.map(item => ({
                codigo: item.finalCode,
                descricao: item.finalDescription,
                unidade: item.unit,
                custoTotal: item.finalPrice,
                fonte: item.originalBank || 'PROPRIO',
                dataReferencia: competence,
                isCustomizada: true
            }));

            try {
                const results = await CompositionService.batchUpsert(payload);
                const idMap = new Map<string, string>();
                results.forEach(r => idMap.set(`${r.codigo}|${r.fonte}`, r.id!));

                compositionsToCreate.forEach(item => {
                    const key = `${item.finalCode}|${item.originalBank || 'PROPRIO'}`;
                    if (idMap.has(key)) {
                        item.dbId = idMap.get(key);
                        item.dbType = 'COMPOSITION';
                        item.status = 'LINKED';
                    }
                });
            } catch (err) {
                console.error("Batch Composition Absorb Failed", err);
            }
        }

        return absorbed;
    }
};
