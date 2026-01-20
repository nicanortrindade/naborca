import { supabase } from '../supabase';
import { type Database } from '../../types/supabase';
import { type Proposal } from '../../types/domain';

type ProposalRow = Database['public']['Tables']['proposals']['Row'];
type ProposalInsert = Database['public']['Tables']['proposals']['Insert'];
type ProposalUpdate = Database['public']['Tables']['proposals']['Update'];

function toDomain(row: ProposalRow): Proposal {
    return {
        id: row.id,
        nome: row.nome,
        budgetId: row.budget_id,
        budgetName: row.budget_name,
        clientId: row.client_id || undefined,
        clientName: row.client_name,
        valorTotal: row.valor_total,
        status: row.status as any,
        tipoOrcamento: row.tipo_orcamento as any,
        empresaNome: row.empresa_nome,
        empresaCnpj: row.empresa_cnpj,
        responsavelNome: row.responsavel_nome,
        responsavelCrea: row.responsavel_crea,
        logoBase64: row.logo_base64 || undefined,
        incluiCurvaABC: row.inclui_curva_abc,
        incluiMemorialCalculo: row.inclui_memorial_calculo,
        incluiCronograma: row.inclui_cronograma,
        termosRessalvas: row.termos_ressalvas || '',
        geradaEm: new Date(row.gerada_em),
        revisadaEm: row.revisada_em ? new Date(row.revisada_em) : undefined,
        aprovadaEm: row.aprovada_em ? new Date(row.aprovada_em) : undefined,
        emitidaEm: row.emitida_em ? new Date(row.emitida_em) : undefined,
        observacoes: row.observacoes || undefined,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
    };
}


export const ProposalService = {
    async getAll(): Promise<Proposal[]> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('User not authenticated');

        const { data, error } = await supabase
            .from('proposals')
            .select('*')
            .eq('user_id', user.id)
            .order('gerada_em', { ascending: false });

        if (error) throw error;
        return data.map(toDomain);
    },

    async getById(id: string): Promise<Proposal> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('User not authenticated');

        const { data, error } = await supabase
            .from('proposals')
            .select('*')
            .eq('id', id)
            .eq('user_id', user.id)
            .single();

        if (error) throw error;
        return toDomain(data);
    },

    async create(proposal: Partial<Proposal>): Promise<Proposal> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('User not authenticated');

        // We need to cast to any or construct a valid Insert object manually because toInsert expects full Proposal
        // But for creation we should probably enforce required fields or use what we have.
        // Let's assume the caller provides enough data.
        // We will cast to Proposal for toInsert, but in reality we might want a Partial version of toInsert or manual construction.
        // For consistency with other services, let's inject user_id and use toInsert as if it's full, 
        // OR better, manual payload construction if toInsert is strict.
        // toInsert expects "Proposal". Let's stick to manual payload construction for flexibility or just trust the caller passes a valid shape that satisfies what we need.

        // Actually, toInsert is strict. Let's make a partial friendly helper or just manual mapping.
        // Manual mapping is safer for "Partial" inputs.

        const payload: any = {
            nome: proposal.nome,
            budget_id: proposal.budgetId,
            budget_name: proposal.budgetName,
            client_id: proposal.clientId,
            client_name: proposal.clientName,
            valor_total: proposal.valorTotal,
            status: proposal.status,
            tipo_orcamento: proposal.tipoOrcamento,
            empresa_nome: proposal.empresaNome,
            empresa_cnpj: proposal.empresaCnpj,
            responsavel_nome: proposal.responsavelNome,
            responsavel_crea: proposal.responsavelCrea,
            logo_base64: proposal.logoBase64,
            inclui_curva_abc: proposal.incluiCurvaABC,
            inclui_memorial_calculo: proposal.incluiMemorialCalculo,
            inclui_cronograma: proposal.incluiCronograma,
            termos_ressalvas: proposal.termosRessalvas,
            gerada_em: proposal.geradaEm?.toISOString(),
            revisada_em: proposal.revisadaEm?.toISOString(),
            aprovada_em: proposal.aprovadaEm?.toISOString(),
            emitida_em: proposal.emitidaEm?.toISOString(),
            observacoes: proposal.observacoes,
            user_id: user.id,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };

        const { data, error } = await (supabase
            .from('proposals') as any)
            .insert(payload)
            .select()
            .single();

        if (error) throw error;
        return toDomain(data);
    },

    async update(id: string, proposal: Partial<Proposal>): Promise<Proposal> {
        const payload: any = {};
        if (proposal.nome !== undefined) payload.nome = proposal.nome;
        if (proposal.budgetId !== undefined) payload.budget_id = proposal.budgetId;
        if (proposal.budgetName !== undefined) payload.budget_name = proposal.budgetName;
        if (proposal.clientId !== undefined) payload.client_id = proposal.clientId;
        if (proposal.clientName !== undefined) payload.client_name = proposal.clientName;
        if (proposal.valorTotal !== undefined) payload.valor_total = proposal.valorTotal;
        if (proposal.status !== undefined) payload.status = proposal.status;
        if (proposal.tipoOrcamento !== undefined) payload.tipo_orcamento = proposal.tipoOrcamento;
        if (proposal.empresaNome !== undefined) payload.empresa_nome = proposal.empresaNome;
        if (proposal.empresaCnpj !== undefined) payload.empresa_cnpj = proposal.empresaCnpj;
        if (proposal.responsavelNome !== undefined) payload.responsavel_nome = proposal.responsavelNome;
        if (proposal.responsavelCrea !== undefined) payload.responsavel_crea = proposal.responsavelCrea;
        if (proposal.logoBase64 !== undefined) payload.logo_base64 = proposal.logoBase64;
        if (proposal.incluiCurvaABC !== undefined) payload.inclui_curva_abc = proposal.incluiCurvaABC;
        if (proposal.incluiMemorialCalculo !== undefined) payload.inclui_memorial_calculo = proposal.incluiMemorialCalculo;
        if (proposal.incluiCronograma !== undefined) payload.inclui_cronograma = proposal.incluiCronograma;
        if (proposal.termosRessalvas !== undefined) payload.termos_ressalvas = proposal.termosRessalvas;
        if (proposal.geradaEm !== undefined) payload.gerada_em = proposal.geradaEm.toISOString();
        if (proposal.revisadaEm !== undefined) payload.revisada_em = proposal.revisadaEm?.toISOString();
        if (proposal.aprovadaEm !== undefined) payload.aprovada_em = proposal.aprovadaEm?.toISOString();
        if (proposal.emitidaEm !== undefined) payload.emitida_em = proposal.emitidaEm?.toISOString();
        if (proposal.observacoes !== undefined) payload.observacoes = proposal.observacoes;

        payload.updated_at = new Date().toISOString();

        const { data, error } = await (supabase
            .from('proposals') as any)
            .update(payload)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        return toDomain(data);
    },

    async delete(id: string): Promise<void> {
        const { error } = await supabase
            .from('proposals')
            .delete()
            .eq('id', id);

        if (error) throw error;
    }
};
