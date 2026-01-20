
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        const { chunk, type, price_table_id } = await req.json()

        // Valida autenticação (opcional se já protegido via API Gateway do Supabase)
        const authHeader = req.headers.get('Authorization')!
        const { data: { user }, error: authError } = await supabase.auth.getUser(
            authHeader.replace('Bearer ', '')
        )

        if (authError || !user) {
            return new Response(
                JSON.stringify({ error: 'Unauthorized' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        let result;

        // Redireciona para a RPC correta (usando service role para garantir permissão)
        // Nota: Como estamos na Edge Function com service role, poderíamos fazer insert direto também,
        // mas usar a RPC centraliza a lógica.

        if (type === 'inputs') {
            result = await supabase.rpc('ingest_sinapi_inputs_batch', { p_inputs: chunk });
        } else if (type === 'input_prices') {
            result = await supabase.rpc('ingest_sinapi_input_prices_batch', { p_price_table_id: price_table_id, p_prices: chunk });
        } else if (type === 'compositions') {
            result = await supabase.rpc('ingest_sinapi_compositions_batch', { p_compositions: chunk });
        } else if (type === 'composition_prices') {
            result = await supabase.rpc('ingest_sinapi_composition_prices_batch', { p_price_table_id: price_table_id, p_prices: chunk });
        } else if (type === 'composition_items') {
            result = await supabase.rpc('ingest_sinapi_composition_items_batch', { p_price_table_id: price_table_id, p_items: chunk });
        } else {
            throw new Error('Invalid ingestion type')
        }

        if (result.error) throw result.error

        return new Response(
            JSON.stringify(result.data),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    } catch (error) {
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
