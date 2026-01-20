// =====================================================
// MULTI-FILE INGESTION (ORDEM CONTROLADA)
// =====================================================

import type { IngestionProgress, IngestionResult } from './sinapiIngestion';
import { validateSinapiFiles, SINAPI_IMPORT_ORDER, ingestSinapiFromFile } from './sinapiIngestion';

/**
 * Ingestão SINAPI a partir de múltiplos arquivos (ORDEM CRÍTICA!)
 * USO: Processar todos arquivos SINAPI 2025 na sequência correta
 */
export async function ingestSinapiMultipleFiles(
    files: File[],
    uf: string = 'BA',
    competence: string = '2025-01',
    onProgress?: (progress: IngestionProgress) => void
): Promise<IngestionResult> {
    const result: IngestionResult = {
        success: false,
        counts: {
            inputs: 0,
            compositions: 0,
            input_prices: 0,
            composition_prices: 0,
            composition_items: 0
        },
        errors: [],
        logs: []
    };

    const log = (msg: string) => {
        result.logs.push(`[${new Date().toISOString()}] ${msg}`);
        console.log(`[SINAPI IMPORT] ${msg}`);
    };

    try {
        log('INICIANDO IMPORTAÇÃO MÚLTIPLA DE ARQUIVOS');
        log(`UF=${uf}, Competência=${competence}`);

        // 1. Validar arquivos
        const validation = validateSinapiFiles(files);

        if (!validation.valid) {
            const error = `Arquivos SINAPI obrigatórios ausentes: ${validation.missing.join(', ')}`;
            log(`ERRO: ${error}`);
            result.errors.push(error);
            return result;
        }

        log(`✓ Validação completa: ${validation.detected.length} arquivos detectados`);
        validation.detected.forEach(({ type, file }) => {
            log(`  - ${type}: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
        });

        // 2. Importação sequencial na ordem fixa
        log('INICIANDO ORDEM CONTROLADA');
        console.log('[SINAPI IMPORT] INICIANDO ORDEM CONTROLADA');

        let step = 1;
        const totalSteps = SINAPI_IMPORT_ORDER.length;

        for (const fileType of SINAPI_IMPORT_ORDER) {
            const file = validation.filesMap.get(fileType)!;

            log(`[${step}/${totalSteps}] Processando ${fileType}: ${file.name}`);
            console.log(`[SINAPI IMPORT] ${fileType} → ${file.name}`);

            onProgress?.({
                step: fileType,
                message: `Processando ${fileType}...`,
                current: step,
                total: totalSteps
            });

            // Executar ingestão para este arquivo
            const fileResult = await ingestSinapiFromFile(file, uf, competence);

            // Acumular resultados
            result.counts.inputs += fileResult.counts.inputs;
            result.counts.compositions += fileResult.counts.compositions;
            result.counts.input_prices += fileResult.counts.input_prices;
            result.counts.composition_prices += fileResult.counts.composition_prices;
            result.counts.composition_items += fileResult.counts.composition_items;

            // Acumular logs e erros
            result.logs.push(...fileResult.logs);
            result.errors.push(...fileResult.errors);

            if (!fileResult.success) {
                log(`⚠️ ${fileType} concluído com avisos`);
            } else {
                log(`✓ ${fileType} processado com sucesso`);
            }

            step++;
        }

        log('FINALIZADO COM SUCESSO');
        console.log('[SINAPI IMPORT] FINALIZADO COM SUCESSO');

        result.success = result.errors.length === 0;
        log(`Totais acumulados: ${result.counts.inputs} insumos, ${result.counts.compositions} composições, ${result.counts.composition_items} itens`);

        onProgress?.({
            step: 'done',
            message: 'Importação múltipla concluída!',
            current: totalSteps,
            total: totalSteps
        });

    } catch (err: any) {
        const error = `Erro fatal na importação múltipla: ${err.message}`;
        log(error);
        result.errors.push(error);
    }

    return result;
}
