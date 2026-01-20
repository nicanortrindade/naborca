import { supabase } from '../supabase';
import { type Database } from '../../types/supabase';
import { type Client } from '../../types/domain';

type ClientRow = Database['public']['Tables']['clients']['Row'];
type ClientInsert = Database['public']['Tables']['clients']['Insert'];
type ClientUpdate = Database['public']['Tables']['clients']['Update'];

function toDomain(row: ClientRow): Client {
    return {
        id: row.id,
        nome: row.nome,
        documento: row.documento,
        tipoDocumento: row.tipo_documento as 'cpf' | 'cnpj',
        tipoCliente: row.tipo_cliente as 'publico' | 'privado',
        orgao: row.orgao || undefined,
        endereco: row.endereco || undefined,
        cidade: row.cidade || undefined,
        uf: row.uf || undefined,
        responsavel: row.responsavel || undefined,
        telefone: row.telefone || undefined,
        email: row.email || undefined,
        obraPredominante: (row.obra_predominante as any) || undefined,
        isAtivo: row.is_ativo,
        observacoes: row.observacoes || undefined,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
    };
}

function toInsert(client: Partial<Client>): ClientInsert {
    return {
        nome: client.nome!,
        documento: client.documento!,
        tipo_documento: client.tipoDocumento!,
        tipo_cliente: client.tipoCliente!,
        orgao: client.orgao,
        endereco: client.endereco,
        cidade: client.cidade,
        uf: client.uf,
        responsavel: client.responsavel,
        telefone: client.telefone,
        email: client.email,
        obra_predominante: client.obraPredominante,
        is_ativo: client.isAtivo,
        observacoes: client.observacoes,
        updated_at: new Date().toISOString(),
    };
}

export const ClientService = {
    async getAll(): Promise<Client[]> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('User not authenticated');

        const { data, error } = await supabase
            .from('clients')
            .select('*')
            .eq('user_id', user.id)
            .order('nome');

        if (error) throw error;
        return data.map(toDomain);
    },

    async getById(id: string): Promise<Client> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('User not authenticated');

        const { data, error } = await supabase
            .from('clients')
            .select('*')
            .eq('id', id)
            .eq('user_id', user.id)
            .single();

        if (error) throw error;
        return toDomain(data);
    },

    async create(client: Partial<Client>): Promise<Client> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('User not authenticated');

        const payload = {
            ...toInsert(client),
            user_id: user.id,
            created_at: new Date().toISOString()
        };
        const { data, error } = await (supabase
            .from('clients') as any)
            .insert(payload)
            .select()
            .single();

        if (error) throw error;
        return toDomain(data);
    },

    async update(id: string, client: Partial<Client>): Promise<Client> {
        const payload = toInsert(client);
        const { data, error } = await (supabase
            .from('clients') as any)
            .update(payload)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        return toDomain(data);
    },

    async delete(id: string): Promise<void> {
        const { error } = await supabase
            .from('clients')
            .delete()
            .eq('id', id);

        if (error) throw error;
    }
};
