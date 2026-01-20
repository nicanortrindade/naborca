import { supabase } from '../../../lib/supabase';
import type { ParsedItem, ResolvedItem, ImportSessionState } from '../types';
import { InsumoService } from '../../../lib/supabase-services/InsumoService';
import { CompositionService } from '../../../lib/supabase-services/CompositionService';
import { chunk, runWithConcurrency, withRetry } from '../../../utils/supabaseOps';

export const ImportResolutionService = {
    async resolveItems(
        items: ParsedItem[],
        session: ImportSessionState
    ): Promise<ResolvedItem[]> {

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("User not found");

        // 1. Map items to ResolvedItem skeleton
        const processing = items.map(i => ({
            ...i,
            status: 'NEW',
            conflictType: 'NONE',
            finalCode: i.code,
            finalDescription: i.description,
            finalPrice: i.totalPrice, // Default
            // Ensure flags correctly transferred
            isComposition: i.isComposition || (i.compositionItems && i.compositionItems.length > 0),
        } as ResolvedItem));

        // 2. Identify Unique Codes to Bulk Fetch
        const validItems = processing.filter(i => i.code && i.code.trim().length > 0);
        const allCodes = Array.from(new Set(validItems.map(i => i.code)));

        if (allCodes.length === 0) return processing;

        // 3. Batch Fetch from DB (Insumos & Compositions)
        // Store in Map<Code, Item[]> to handle multiple versions/sources
        const insumoMap = new Map<string, any[]>();
        const compMap = new Map<string, any[]>();

        const codeChunks = chunk(allCodes, 200);

        // Fetch tasks
        const fetchTasks = codeChunks.map(batchCodes => async () => {
            const [insumos, comps] = await Promise.all([
                withRetry(() => InsumoService.getByCodes(batchCodes)),
                withRetry(() => CompositionService.getByCodes(batchCodes))
            ]);

            // Index Insumos
            insumos.forEach(curr => {
                const list = insumoMap.get(curr.codigo) || [];
                list.push(curr);
                insumoMap.set(curr.codigo, list);
            });

            // Index Compositions
            comps.forEach(curr => {
                const list = compMap.get(curr.codigo) || [];
                list.push(curr);
                compMap.set(curr.codigo, list);
            });
        });

        // Execute 4 concurrent requests
        await runWithConcurrency(fetchTasks, 4);

        // 4. In-Memory Matching Logic
        for (const item of processing) {
            // Groups skip resolution
            if (!item.code) {
                item.status = 'SKIPPED';
                continue;
            }

            // Determine Desired Source for this item
            const desiredSource = (session.baseMode === 'FIXA' && session.fixedBase)
                ? session.fixedBase
                : (item.detectedSource || 'PRÓPRIO');

            // Improved Matcher: Filter by Source, Sort by Recency
            const findBestMatch = (candidates: any[] | undefined) => {
                if (!candidates || candidates.length === 0) return null;

                // Prioritize Exact Source Match
                const exactMatches = candidates.filter(c => c.fonte === desiredSource);
                if (exactMatches.length > 0) {
                    // Sort descending by reference date (newest first)
                    return exactMatches.sort((a, b) => {
                        const tA = new Date(a.dataReferencia || 0).getTime();
                        const tB = new Date(b.dataReferencia || 0).getTime();
                        return tB - tA;
                    })[0];
                }

                // Optional: Fallback logic?
                // Legacy code was strict on source. We stick to strict.
                return null;
            };

            // Check Insumos First
            const insumoMatch = findBestMatch(insumoMap.get(item.code));
            if (insumoMatch) {
                item.status = 'LINKED';
                item.dbId = insumoMatch.id;
                item.dbType = 'INPUT';
                item.dbDescription = insumoMatch.descricao;
                item.dbPrice = insumoMatch.preco;
                item.finalPrice = insumoMatch.preco; // Use DB Price
                continue;
            }

            // Check Compositions Second
            const compMatch = findBestMatch(compMap.get(item.code));
            if (compMatch) {
                item.status = 'LINKED';
                item.dbId = compMatch.id;
                item.dbType = 'COMPOSITION';
                item.dbDescription = compMatch.descricao;

                // Conflict Check (Description Mismatch for PROPRIO)
                if (desiredSource === 'PRÓPRIO') {
                    const descImport = (item.description || '').trim().toLowerCase();
                    const descDb = (compMatch.descricao || '').trim().toLowerCase();
                    // Simple heuristic: if difference > significant (e.g. strict string)
                    if (descImport !== descDb) {
                        item.status = 'CONFLICT';
                        item.conflictType = 'DESCRIPTION_MISMATCH';
                    }
                }
                continue;
            }

            // No Match -> NEW
            item.status = 'NEW';
            item.competence = session.referenceDate;
            item.originalBank = desiredSource; // Mark proposed source

            if (item.isComposition || (item.compositionItems && item.compositionItems.length > 0)) {
                item.compositionHasAnalytic = !!(item.compositionItems && item.compositionItems.length > 0);
                item.compositionOrigin = 'imported_sintetico';
            }
        }

        return processing;
    }
};
