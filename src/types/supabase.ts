export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]

export interface Database {
    public: {
        Tables: {
            companies: {
                Row: {
                    id: string
                    user_id: string
                    name: string
                    cnpj: string | null
                    address: string | null
                    email: string | null
                    phone: string | null
                    logo_url: string | null
                    responsible_name: string | null
                    responsible_cpf: string | null
                    responsible_crea: string | null
                    proposal_cover: string | null
                    proposal_terms: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    user_id?: string
                    name: string
                    cnpj?: string | null
                    address?: string | null
                    email?: string | null
                    phone?: string | null
                    logo_url?: string | null
                    responsible_name?: string | null
                    responsible_cpf?: string | null
                    responsible_crea?: string | null
                    proposal_cover?: string | null
                    proposal_terms?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    name?: string
                    cnpj?: string | null
                    address?: string | null
                    email?: string | null
                    phone?: string | null
                    logo_url?: string | null
                    responsible_name?: string | null
                    responsible_cpf?: string | null
                    responsible_crea?: string | null
                    proposal_cover?: string | null
                    proposal_terms?: string | null
                    created_at?: string
                    updated_at?: string
                }
            }
            budgets: {
                Row: {
                    id: string
                    user_id: string
                    company_id: string | null
                    name: string
                    client_name: string | null
                    date: string
                    status: string
                    total_value: number
                    bdi: number
                    encargos_percentage: number
                    obra_type: string | null
                    proposal_cover: string | null
                    proposal_terms: string | null
                    schedule_interval: number | null
                    period_labels: string[] | null
                    cost_centers: string[] | null
                    is_template: boolean | null
                    desoneracao: number | null
                    version: string | null
                    revision: number | null
                    revision_notes: string | null
                    is_frozen: boolean | null
                    frozen_at: string | null
                    frozen_by: string | null
                    parent_budget_id: string | null
                    is_scenario: boolean | null
                    scenario_name: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    user_id?: string
                    company_id?: string | null
                    name: string
                    client_name?: string | null
                    date?: string
                    status?: string
                    total_value?: number
                    bdi?: number
                    encargos_percentage?: number
                    obra_type?: string | null
                    proposal_cover?: string | null
                    proposal_terms?: string | null
                    schedule_interval?: number | null
                    period_labels?: string[] | null
                    cost_centers?: string[] | null
                    is_template?: boolean | null
                    desoneracao?: number | null
                    version?: string | null
                    revision?: number | null
                    revision_notes?: string | null
                    is_frozen?: boolean | null
                    frozen_at?: string | null
                    frozen_by?: string | null
                    parent_budget_id?: string | null
                    is_scenario?: boolean | null
                    scenario_name?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    company_id?: string | null
                    name?: string
                    client_name?: string | null
                    date?: string
                    status?: string
                    total_value?: number
                    bdi?: number
                    encargos_percentage?: number
                    obra_type?: string | null
                    proposal_cover?: string | null
                    proposal_terms?: string | null
                    schedule_interval?: number | null
                    period_labels?: string[] | null
                    cost_centers?: string[] | null
                    is_template?: boolean | null
                    desoneracao?: number | null
                    version?: string | null
                    revision?: number | null
                    revision_notes?: string | null
                    is_frozen?: boolean | null
                    frozen_at?: string | null
                    frozen_by?: string | null
                    parent_budget_id?: string | null
                    is_scenario?: boolean | null
                    scenario_name?: string | null
                    created_at?: string
                    updated_at?: string
                }
            }
            budget_items: {
                Row: {
                    id: string
                    user_id: string
                    budget_id: string
                    parent_id: string | null
                    order_index: number
                    level: number
                    item_number: string | null
                    code: string | null
                    description: string
                    unit: string | null
                    quantity: number
                    unit_price: number
                    final_price: number
                    total_price: number
                    type: string | null
                    source: string | null
                    item_type: string | null
                    composition_id: string | null
                    insumo_id: string | null
                    calculation_memory: string | null
                    calculation_steps: string[] | null
                    custom_bdi: number | null
                    cost_center: string | null
                    is_locked: boolean | null
                    notes: string | null
                    is_desonerated: boolean | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    user_id?: string
                    budget_id: string
                    parent_id?: string | null
                    order_index: number
                    level?: number
                    item_number?: string | null
                    code?: string | null
                    description: string
                    unit?: string | null
                    quantity?: number
                    unit_price?: number
                    final_price?: number
                    total_price?: number
                    type?: string | null
                    source?: string | null
                    item_type?: string | null
                    composition_id?: string | null
                    insumo_id?: string | null
                    calculation_memory?: string | null
                    calculation_steps?: string[] | null
                    custom_bdi?: number | null
                    cost_center?: string | null
                    is_locked?: boolean | null
                    notes?: string | null
                    is_desonerated?: boolean | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    budget_id?: string
                    parent_id?: string | null
                    order_index?: number
                    level?: number
                    item_number?: string | null
                    code?: string | null
                    description?: string
                    unit?: string | null
                    quantity?: number
                    unit_price?: number
                    final_price?: number
                    total_price?: number
                    type?: string | null
                    source?: string | null
                    item_type?: string | null
                    composition_id?: string | null
                    insumo_id?: string | null
                    calculation_memory?: string | null
                    calculation_steps?: string[] | null
                    custom_bdi?: number | null
                    cost_center?: string | null
                    is_locked?: boolean | null
                    notes?: string | null
                    is_desonerated?: boolean | null
                    created_at?: string
                    updated_at?: string
                }
            }
            insumos: {
                Row: {
                    id: string
                    user_id: string
                    base_id: string | null
                    code: string
                    description: string
                    unit: string | null
                    price: number
                    type: string | null
                    fonte: string | null
                    data_referencia: string | null
                    is_oficial: boolean | null
                    is_editavel: boolean | null
                    observacoes: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    user_id?: string
                    base_id?: string | null
                    code: string
                    description: string
                    unit?: string | null
                    price?: number
                    type?: string | null
                    fonte?: string | null
                    data_referencia?: string | null
                    is_oficial?: boolean | null
                    is_editavel?: boolean | null
                    observacoes?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    base_id?: string | null
                    code?: string
                    description?: string
                    unit?: string | null
                    price?: number
                    type?: string | null
                    fonte?: string | null
                    data_referencia?: string | null
                    is_oficial?: boolean | null
                    is_editavel?: boolean | null
                    observacoes?: string | null
                    created_at?: string
                    updated_at?: string
                }
            }
            compositions: {
                Row: {
                    id: string
                    user_id: string
                    base_id: string | null
                    code: string
                    description: string
                    unit: string | null
                    total_cost: number
                    fonte: string | null
                    data_referencia: string | null
                    is_oficial: boolean | null
                    is_customizada: boolean | null
                    observacoes: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    user_id?: string
                    base_id?: string | null
                    code: string
                    description: string
                    unit?: string | null
                    total_cost?: number
                    fonte?: string | null
                    data_referencia?: string | null
                    is_oficial?: boolean | null
                    is_customizada?: boolean | null
                    observacoes?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    base_id?: string | null
                    code?: string
                    description?: string
                    unit?: string | null
                    total_cost?: number
                    fonte?: string | null
                    data_referencia?: string | null
                    is_oficial?: boolean | null
                    is_customizada?: boolean | null
                    observacoes?: string | null
                    created_at?: string
                    updated_at?: string
                }
            },
            clients: {
                Row: {
                    id: string
                    user_id: string
                    nome: string
                    documento: string
                    tipo_documento: string
                    tipo_cliente: string
                    orgao: string | null
                    endereco: string | null
                    cidade: string | null
                    uf: string | null
                    responsavel: string | null
                    telefone: string | null
                    email: string | null
                    obra_predominante: string | null
                    is_ativo: boolean
                    observacoes: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    user_id?: string
                    nome: string
                    documento: string
                    tipo_documento: string
                    tipo_cliente: string
                    orgao?: string | null
                    endereco?: string | null
                    cidade?: string | null
                    uf?: string | null
                    responsavel?: string | null
                    telefone?: string | null
                    email?: string | null
                    obra_predominante?: string | null
                    is_ativo?: boolean
                    observacoes?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    nome?: string
                    documento?: string
                    tipo_documento?: string
                    tipo_cliente?: string
                    orgao?: string | null
                    endereco?: string | null
                    cidade?: string | null
                    uf?: string | null
                    responsavel?: string | null
                    telefone?: string | null
                    email?: string | null
                    obra_predominante?: string | null
                    is_ativo?: boolean
                    observacoes?: string | null
                    created_at?: string
                    updated_at?: string
                }
            },
            proposals: {
                Row: {
                    id: string
                    user_id: string
                    nome: string
                    budget_id: string
                    budget_name: string
                    client_id: string | null
                    client_name: string
                    valor_total: number
                    status: string
                    tipo_orcamento: string
                    empresa_nome: string
                    empresa_cnpj: string
                    responsavel_nome: string
                    responsavel_crea: string
                    logo_base64: string | null
                    inclui_curva_abc: boolean
                    inclui_memorial_calculo: boolean
                    inclui_cronograma: boolean
                    termos_ressalvas: string | null
                    gerada_em: string
                    revisada_em: string | null
                    aprovada_em: string | null
                    emitida_em: string | null
                    observacoes: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    user_id?: string
                    nome: string
                    budget_id: string
                    budget_name: string
                    client_id?: string | null
                    client_name: string
                    valor_total: number
                    status: string
                    tipo_orcamento: string
                    empresa_nome: string
                    empresa_cnpj: string
                    responsavel_nome: string
                    responsavel_crea: string
                    logo_base64?: string | null
                    inclui_curva_abc?: boolean
                    inclui_memorial_calculo?: boolean
                    inclui_cronograma?: boolean
                    termos_ressalvas?: string | null
                    gerada_em?: string
                    revisada_em?: string | null
                    aprovada_em?: string | null
                    emitida_em?: string | null
                    observacoes?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    nome?: string
                    budget_id?: string
                    budget_name?: string
                    client_id?: string | null
                    client_name?: string
                    valor_total?: number
                    status?: string
                    tipo_orcamento?: string
                    empresa_nome?: string
                    empresa_cnpj?: string
                    responsavel_nome?: string
                    responsavel_crea?: string
                    logo_base64?: string | null
                    inclui_curva_abc?: boolean
                    inclui_memorial_calculo?: boolean
                    inclui_cronograma?: boolean
                    termos_ressalvas?: string | null
                    gerada_em?: string
                    revisada_em?: string | null
                    aprovada_em?: string | null
                    emitida_em?: string | null
                    observacoes?: string | null
                    created_at?: string
                    updated_at?: string
                }
            },
            change_logs: {
                Row: {
                    id: string
                    user_id: string
                    budget_id: string | null
                    item_id: string | null
                    proposal_id: string | null
                    action: string
                    field: string | null
                    old_value: string | null
                    new_value: string | null
                    description: string
                    user_name: string | null
                    timestamp: string
                }
                Insert: {
                    id?: string
                    user_id?: string
                    budget_id?: string | null
                    item_id?: string | null
                    proposal_id?: string | null
                    action: string
                    field?: string | null
                    old_value?: string | null
                    new_value?: string | null
                    description: string
                    user_name?: string | null
                    timestamp?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    budget_id?: string | null
                    item_id?: string | null
                    proposal_id?: string | null
                    action?: string
                    field?: string | null
                    old_value?: string | null
                    new_value?: string | null
                    description?: string
                    user_name?: string | null
                    timestamp?: string
                }
            },
            budget_schedules: {
                Row: {
                    id: string
                    budget_id: string
                    item_id: string
                    user_id: string
                    period: number
                    percentage: number
                    value: number
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    budget_id: string
                    item_id: string
                    user_id?: string
                    period: number
                    percentage?: number
                    value?: number
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    budget_id?: string
                    item_id?: string
                    user_id?: string
                    period?: number
                    percentage?: number
                    value?: number
                    created_at?: string
                    updated_at?: string
                }
            },
            composition_items: {
                Row: {
                    id: string
                    composition_id: string
                    insumo_id: string
                    insumo_code: string | null
                    insumo_description: string | null
                    insumo_unit: string | null
                    coefficient: number
                    unit_price: number
                    total_cost: number
                    created_at: string
                }
                Insert: {
                    id?: string
                    composition_id: string
                    insumo_id: string
                    insumo_code?: string | null
                    insumo_description?: string | null
                    insumo_unit?: string | null
                    coefficient: number
                    unit_price: number
                    total_cost: number
                    created_at?: string
                }
                Update: {
                    id?: string
                    composition_id?: string
                    insumo_id?: string
                    insumo_code?: string | null
                    insumo_description?: string | null
                    insumo_unit?: string | null
                    coefficient?: number
                    unit_price?: number
                    total_cost?: number
                    created_at?: string
                }
            },
            budget_item_compositions: {
                Row: {
                    id: string
                    budget_item_id: string
                    description: string
                    unit: string | null
                    quantity: number
                    unit_price: number
                    total_price: number
                    type: string | null
                    updated_at: string
                }
                Insert: {
                    id?: string
                    budget_item_id: string
                    description: string
                    unit?: string | null
                    quantity: number
                    unit_price: number
                    total_price: number
                    type?: string | null
                    updated_at?: string
                }
                Update: {
                    id?: string
                    budget_item_id?: string
                    description?: string
                    unit?: string | null
                    quantity?: number
                    unit_price?: number
                    total_price?: number
                    type?: string | null
                    updated_at?: string
                }
            }
        }
    }
}
