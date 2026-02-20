
/**
 * Implementação completa e robusta de safeMergeMetadata.
 * Realiza um merge profundo (deep merge) recursivo entre dois objetos.
 * Garante que objetos aninhados sejam mesclados em vez de sobrescritos.
 * Arrays são substituídos (comportamento padrão de patches JSONB).
 */
export function safeMergeMetadata(existing: any, updates: any): any {
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) return updates;
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) return updates;

    const result = { ...existing };
    for (const key of Object.keys(updates)) {
        const val = updates[key];
        if (val === undefined) continue; // Preserva o existente se o update for undefined

        if (val && typeof val === 'object' && !Array.isArray(val) && result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) {
            result[key] = safeMergeMetadata(result[key], val);
        } else {
            result[key] = val;
        }
    }
    return result;
}

/**
 * Persistência atômica de metadados do Stage B usando RPC JSONB nativa.
 * Garante que o merge seja feito no nível do banco de dados para evitar race conditions.
 *
 * @param supabase - Cliente Supabase
 * @param fileId - ID do arquivo
 * @param stageBData - Objeto parcial ou completo do stageB para merge
 */
export async function persistStageBMetaAtomic(supabase: any, fileId: string, stageBData: any): Promise<void> {
    // Usar RPC para operação atômica direta do PostgreSQL
    // Isso substitui a lógica anterior de fetch-merge-update client-side
    const { error } = await supabase.rpc('atomic_merge_stageb_metadata', {
        file_id: fileId,
        stageb_data: stageBData
    });

    if (error) {
        console.error('[PERSIST-STAGEB-ATOMIC-ERROR]', error);
        throw error;
    }

    console.log('[PERSIST-STAGEB-ATOMIC-SUCCESS]', { fileId });
}
