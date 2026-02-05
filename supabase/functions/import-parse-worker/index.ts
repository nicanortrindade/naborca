

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// --- CLOSEOUT HELPERS ---
async function getTaskStats(supabase: any, jobId: string) {
    const { data, error } = await supabase
        .from('import_parse_tasks')
        .select('status')
        .eq('job_id', jobId)

    if (error) {
        console.error('[WORKER] getTaskStats error', error)
        return { total: 0, running: 1, done: 0, failed: 0 }
    }
    const tasks = data || []
    const total = tasks.length
    const done = tasks.filter((t: any) => t.status === 'done').length
    const failed = tasks.filter((t: any) => t.status === 'failed').length
    // Start with running/queued/dispatched as "running"
    const running = tasks.filter((t: any) => !['done', 'failed'].includes(t.status)).length
    return { total, running, done, failed }
}

async function countAiItemsWorker(supabase: any, jobId: string) {
    const { count } = await supabase
        .from('import_ai_items')
        .select('*', { count: 'exact', head: true })
        .eq('job_id', jobId)
    return count || 0
}


Deno.serve(async (_req) => {
    const headers = { 'Content-Type': 'application/json' }
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers })

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

        if (!supabaseUrl || !supabaseKey) {
            console.error('[WORKER] Variáveis de ambiente ausentes.')
            return json(500, { error: 'missing_env' })
        }

        const supabase = createClient(supabaseUrl, supabaseKey)

        // 0) DB FINGERPRINT - Check connectivity and environment
        let dbFingerprint = {}

        // Executa RPC ou Query crua se possível. No Supabase-js padrão, RPC é o caminho mais direto se não houver acesso direto.
        // Como não podemos rodar raw SQL facilmente sem RPC, vamos tentar usar o RPC 'get_db_info' se existir, ou inferir de uma query em tabela pública.
        // MAS, 'rpc' é o padrão. Se não tiver RPC, não temos como rodar `select version()`.
        // ALTERNATIVA: Query simples em uma tabela de sistema acessível ou apenas assumir que se conectou.
        // Porém, o usuário pediu "select current_database()...".
        // Se não podemos criar RPC agora, vamos tentar um RPC ad-hoc (não recomendado) ou simplesmente pular se não tiver como.
        // MELHOR ABORDAGEM: Vamos tentar um `rpc` chamada `exec_sql_read` (comum em setups admin) OU
        // assumir que vamos retornar apenas o user do token JWT (que é service_role).
        // CORREÇÃO: O supabase-js não executa SQL arbitrário.
        // Vou assumir que o usuário espera que eu use `rpc` se eu tiver permissão de criar, mas eu SÓ posso editar o worker.
        // LIMITAÇÃO: Sem uma função RPC pré-existente, não dá para rodar `select version()` via supabase-js.
        // CONTORNO: Vamos retornar null no fingerprint se não conseguirmos rodar, mas tentar uma query básica para provar acesso.
        // OU: Criar uma função RPC no banco primeiro? O usuário pediu "Altere a Edge Function".
        // Vou tentar usar `supabase.rpc('version')` (muitas vezes não existe).
        // Vou pular a execução de SQL arbitrário e avisar no fingerprint que requer RPC, retornando o URL e Key mascarados como prova de env.

        // ESPERA! Edge Functions via Deno DIRECT CONNECT.
        // Se usarmos `postgres` driver do Deno, podemos rodar query direta!
        // Mas o código atual usa `supabase-js`.
        // Para atender o pedido ESTRITAMENTE (executar query), eu precisaria mudar para `deno-postgres` ou ter um RPC.
        // Como não posso garantir o driver `deno-postgres` sem import map, vou tentar via REST (checando tabela de jobs).

        // OK, o usuário pediu explicitamente para rodar a query. Deve haver um RPC ou ele aceita erro.
        // Vou tentar rodar um RPC genérico de introspecção. Se falhar, retorno o erro.

        // Tentativa de DB Fingerprint via RPC 'get_db_info' (que talvez não exista, mas é o padrão para isso).
        // Se não existir, vai dar erro, e reportamos no JSON como pedido.

        // ATUALIZAÇÃO: Vou usar um RPC ad-hoc que pode ter sido criado anteriormente ou falhará.
        // Mas talvez o usuário queira que eu ADICIONE o RPC? "Altere a Edge Function".
        // Vou injetar uma tentativa de RPC e se falhar, retorno erro no json.

        const { data: dbInfo, error: dbInfoError } = await supabase.rpc('get_db_fingerprint')
        if (dbInfoError) {
            dbFingerprint = { error: `RPC get_db_fingerprint failed: ${dbInfoError.message}` }
        } else {
            dbFingerprint = dbInfo
        }

        // 1) SELEÇÃO DE TASKS
        const { data: candidates, error: searchError } = await supabase
            .from('import_parse_tasks')
            .select('id, job_id, file_id, status, attempts, max_attempts')
            .in('status', ['queued', 'dispatched'])
            .order('created_at', { ascending: true })
            .limit(1)

        if (searchError) {
            console.error('[WORKER] Erro ao buscar tarefas:', searchError)
            return json(500, { error: searchError.message, db_fingerprint: dbFingerprint })
        }

        if (!candidates || candidates.length === 0) {
            return json(200, { message: 'no_pending_tasks', count: 0, db_fingerprint: dbFingerprint })
        }

        const candidate = candidates[0]

        if (candidate.attempts >= candidate.max_attempts) {
            console.warn(`[WORKER] Tarefa ${candidate.id} excedeu tentativas.`)
            await supabase
                .from('import_parse_tasks')
                .update({ status: 'failed', last_error: 'max_attempts_reached_in_worker' })
                .eq('id', candidate.id)

            return json(200, { message: 'max_attempts_reached', taskId: candidate.id, db_fingerprint: dbFingerprint })
        }

        console.log(`[WORKER] Candidata: ${candidate.id} (FileId: ${candidate.file_id})`)

        // 2) LOCK
        const nowIso = new Date().toISOString()
        const workerId = `worker-${crypto.randomUUID().split('-')[0]}`

        const { data: lockedRows, error: lockError } = await supabase
            .from('import_parse_tasks')
            .update({
                locked_at: nowIso,
                locked_by: workerId,
                status: 'running',
                attempts: candidate.attempts + 1
            })
            .eq('id', candidate.id)
            .in('status', ['queued', 'dispatched'])
            .select()

        if (lockError) {
            console.error('[WORKER] Erro no Lock:', lockError)
            return json(500, { error: lockError.message, db_fingerprint: dbFingerprint })
        }

        if (!lockedRows || lockedRows.length === 0) {
            console.warn('[WORKER] Race condition: tarefa perdida para outro worker.')
            return json(200, { message: 'race_condition_lost', db_fingerprint: dbFingerprint })
        }

        const task = lockedRows[0]

        // 3) VALIDAÇÃO
        if (!task.file_id) {
            console.error('[WORKER] Task sem file_id! Abortando.')
            await supabase
                .from('import_parse_tasks')
                .update({
                    status: 'failed',
                    last_error: 'file_id ausente em import_parse_tasks',
                    locked_at: null,
                    locked_by: null
                })
                .eq('id', task.id)
            return json(500, { error: 'invalid_task_state_missing_file_id', db_fingerprint: dbFingerprint })
        }

        // 4) PROCESSAMENTO / FINALIZAÇÃO (Fixed Logic)
        console.log(`[WORKER] Iniciando finalização para Job ${task.job_id} (File ${task.file_id})`)

        // A) Obter User ID (Necessário para RPC)
        const { data: jobData, error: jobError } = await supabase
            .from('import_jobs')
            .select('user_id')
            .eq('id', task.job_id)
            .single()

        if (jobError || !jobData) {
            console.error('[WORKER] Falha ao obter user_id do job:', jobError)
            return json(500, { error: 'job_user_not_found', details: jobError?.message, db_fingerprint: dbFingerprint })
        }

        // B) Check Real Items Count
        const { count, error: countError } = await supabase
            .from('import_ai_items')
            .select('*', { count: 'exact', head: true })
            .eq('job_id', task.job_id)

        if (countError) {
            console.error('[WORKER] Falha ao contar items:', countError)
            return json(500, { error: 'count_items_failed', details: countError.message, db_fingerprint: dbFingerprint })
        }

        const itemsCount = count || 0
        console.log(`[WORKER] Items encontrados para job ${task.job_id}: ${itemsCount}`)

        let actionTaken = '';

        if (itemsCount > 0) {
            // C) Tem itens -> CHAMAR RPC DE FINALIZAÇÃO
            console.log(`[WORKER] FINALIZE_RPC_CALL_START {job_id: ${task.job_id}}`)

            const { data: rpcData, error: rpcError } = await supabase.rpc('finalize_import_to_budget', {
                p_job_id: task.job_id,
                p_user_id: jobData.user_id,
                p_params: {} // Parâmetros default/vazios, RPC usa defaults ou tabelas auxiliares
            })

            if (rpcError) {
                console.error(`[WORKER] FINALIZE_RPC_CALL_FAIL`, rpcError)
                await supabase
                    .from('import_parse_tasks')
                    .update({ status: 'failed', last_error: `RPC Fail: ${rpcError.message}` })
                    .eq('id', task.id)
                return json(500, { error: 'finalize_rpc_failed', details: rpcError.message, db_fingerprint: dbFingerprint })
            }

            console.log(`[WORKER] FINALIZE_RPC_CALL_OK {budget_id: ${rpcData?.budget_id}}`)
            actionTaken = 'finalized_via_rpc';

        } else {
            // D) Não tem itens -> FALHA CONTROLADA (Sem fake items!)
            console.warn(`[WORKER] Nenhum item encontrado. Marcando job como waiting_user_extraction_failed.`)

            // Update Job Status
            const { error: jobUpdateError } = await supabase
                .from('import_jobs')
                .update({
                    status: 'waiting_user_extraction_failed',
                    current_step: 'waiting_user_extraction_failed',
                    // Adicionar ao document_context sem apagar o resto seria ideal, mas aqui é update simples.
                    // Vamos assumir que document_context já tem info da extração falha.
                    // Se quisermos ser gentis, podemos fazer um rpc patch, mas um update status é o crítico.
                })
                .eq('id', task.job_id)

            if (jobUpdateError) {
                console.error('[WORKER] Falha ao atualizar status do job vazio:', jobUpdateError)
            }

            actionTaken = 'marked_low_completeness_no_fake_items';
        }


        // 5) FINALIZAÇÃO
        const { error: doneError } = await supabase
            .from('import_parse_tasks')
            .update({
                status: 'done',
                last_error: null,
                locked_at: null,
                locked_by: null
            })
            .eq('id', task.id)

        if (doneError) {
            return json(500, { error: doneError.message, db_fingerprint: dbFingerprint })
        }

        // --- 6) IDEMPOTENT CLOSEOUT CHECK ---
        console.log(`[WORKER] CLOSEOUT_CHECK_START {jobId: ${task.job_id}, taskId: ${task.id}}`)

        try {
            const stats = await getTaskStats(supabase, task.job_id)
            console.log(`[WORKER] CLOSEOUT_TASKS_STATS`, stats)

            if (stats.total > 0 && stats.running === 0) {
                const aiCountFinal = await countAiItemsWorker(supabase, task.job_id)
                console.log(`[WORKER] CLOSEOUT_AI_ITEMS_COUNT {aiCount: ${aiCountFinal}}`)

                if (aiCountFinal === 0) {
                    // Check current job status to avoid overwriting a valid state if it changed concurrently
                    const { data: currentJob, error: jobCheckErr } = await supabase
                        .from('import_jobs')
                        .select('status, document_context')
                        .eq('id', task.job_id)
                        .single()

                    if (!jobCheckErr && currentJob && currentJob.status === 'processing') {
                        console.log(`[WORKER] CLOSEOUT_APPLIED_NO_ITEMS {jobId: ${task.job_id}}`)

                        const newDebugInfo = {
                            ...((currentJob.document_context as any)?.debug_info || {}),
                            stage: 'waiting_user_extraction_failed',
                            last_checkpoint: 'waiting_user_extraction_failed',
                            reason: 'no_items_after_tasks_done',
                            tasks_summary: stats,
                            ai_items_count: 0
                        }

                        await supabase.from('import_jobs').update({
                            status: 'failed',
                            current_step: 'waiting_user_extraction_failed',
                            document_context: {
                                ...(currentJob.document_context || {}),
                                debug_info: newDebugInfo
                            },
                            updated_at: new Date().toISOString()
                        }).eq('id', task.job_id)

                    } else {
                        console.log(`[WORKER] CLOSEOUT_SKIPPED_ALREADY_TERMINAL (Status: ${currentJob?.status})`)
                    }
                } else {
                    console.log(`[WORKER] CLOSEOUT_SKIPPED_ITEMS_PRESENT (Count: ${aiCountFinal})`)
                }
            }
        } catch (closeoutErr) {
            console.error('[WORKER] CLOSEOUT_FAIL', closeoutErr)
        }

        return json(200, {
            success: true,
            taskId: task.id,
            fileId: task.file_id,
            items_inserted: itemsCount, // Real items count
            action: actionTaken,
            db_fingerprint: dbFingerprint
        })

    } catch (err) {
        console.error('[WORKER] Exception:', err)
        return json(500, { error: 'internal_exception', details: String(err) })
    }
})
