import { supabase } from '../supabase';
import { type Database } from '../../types/supabase';
import { type CompanySettings } from '../../types/domain';

type CompanyRow = Database['public']['Tables']['companies']['Row'];
type CompanyInsert = Database['public']['Tables']['companies']['Insert'];

function toDomain(row: CompanyRow): CompanySettings {
    return {
        id: row.id,
        name: row.name,
        cnpj: row.cnpj || '',
        address: row.address || '',
        email: row.email || '',
        phone: row.phone || '',
        logo: row.logo_url || undefined,
        responsibleName: row.responsible_name || '',
        responsibleCpf: row.responsible_cpf || '',
        responsibleCrea: row.responsible_crea || '',
        proposalCover: row.proposal_cover || undefined,
        proposalTerms: row.proposal_terms || undefined,
    };
}

function toInsert(company: Partial<CompanySettings>): Omit<CompanyInsert, 'user_id'> {
    return {
        name: company.name || 'Minha Empresa',
        cnpj: company.cnpj,
        address: company.address,
        email: company.email,
        phone: company.phone,
        logo_url: company.logo,
        responsible_name: company.responsibleName,
        responsible_cpf: company.responsibleCpf,
        responsible_crea: company.responsibleCrea,
        proposal_cover: company.proposalCover,
        proposal_terms: company.proposalTerms,
        updated_at: new Date().toISOString(),
    };
}

export const CompanyService = {
    async get(): Promise<CompanySettings | null> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Usuário não autenticado');

        const { data, error } = await supabase
            .from('companies')
            .select('*')
            .eq('user_id', user.id)
            .maybeSingle();

        if (error) throw error;
        return data ? toDomain(data) : null;
    },

    async upsert(company: Partial<CompanySettings>): Promise<CompanySettings> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Usuário não autenticado');

        const existing = await this.get();
        const payload = {
            ...toInsert(company),
            user_id: user.id,
        };

        if (existing && existing.id) {
            const { data, error } = await (supabase
                .from('companies') as any)
                .update(payload)
                .eq('id', existing.id)
                .eq('user_id', user.id)
                .select()
                .single();
            if (error) throw error;
            return toDomain(data);
        } else {
            const { data, error } = await (supabase
                .from('companies') as any)
                .insert({ ...payload, created_at: new Date().toISOString() })
                .select()
                .single();
            if (error) throw error;
            return toDomain(data);
        }
    }
};
