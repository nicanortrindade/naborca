
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

        // 4) PROCESSAMENTO
        const itemToInsert = {
            job_id: task.job_id,
            import_file_id: task.file_id,
            idx: 0,
            description: 'Falha na extração automática',
            unit: 'UN',
            quantity: 1,
            unit_price: 0,
            total: 0,
            category: 'IMPORT_ERROR',
            raw_line: 'Falha ao processar arquivo ou arquivo vazio (Placeholder gerado pelo Worker).',
            confidence: 0.1,
        }

        const { error: insertError } = await supabase
            .from('import_ai_items')
            .insert(itemToInsert)

        if (insertError) {
            console.error('[WORKER] Insert falhou:', insertError)
            await supabase
                .from('import_parse_tasks')
                .update({
                    status: 'failed',
                    last_error: `Insert Fail: ${insertError.message}`,
                    locked_at: null,
                    locked_by: null
                })
                .eq('id', task.id)

            return json(500, { error: 'insert_failed', details: insertError.message, db_fingerprint: dbFingerprint })
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

        return json(200, {
            success: true,
            taskId: task.id,
            fileId: task.file_id,
            items_inserted: 1,
            action: 'item_inserted_and_task_done',
            db_fingerprint: dbFingerprint
        })

    } catch (err) {
        console.error('[WORKER] Exception:', err)
        return json(500, { error: 'internal_exception', details: String(err) })
    }
})
