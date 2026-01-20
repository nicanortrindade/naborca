import Dexie, { type Table } from 'dexie';

export interface Budget {
    id?: number;
    name: string;
    client: string;
    date: Date;
    status: 'draft' | 'pending' | 'approved';
    totalValue: number;
    bdi: number; // Percentage
    encargosSociais?: number; // Labor social charges percentage
    proposalCover?: string; // Text for cover
    proposalTerms?: string; // Text for terms
    scheduleInterval?: number;
    periodLabels?: string[];
    costCenters?: string[]; // List of available cost centers
    isTemplate?: boolean; // If true, this is a reusable template
    desoneracao?: number; // Desoneration factor percentage
    // Versionamento e controle
    version?: string; // Ex: "1.0", "1.1", "2.0"
    revision?: number; // Número sequencial da revisão
    revisionNotes?: string; // Notas da revisão atual
    isFrozen?: boolean; // Se true, orçamento está congelado (somente leitura)
    frozenAt?: Date; // Data do congelamento
    frozenBy?: string; // Quem congelou
    obraType?: 'predial' | 'saneamento' | 'pavimentacao' | 'reforma' | 'outro';
    parentBudgetId?: number; // ID do orçamento original (para cenários/duplicações)
    isScenario?: boolean; // Se true, é uma simulação de cenário
    scenarioName?: string; // Nome do cenário (ex: "BDI +5%", "Reajuste MO")
    createdAt: Date;
    updatedAt: Date;
}

export interface BudgetItem {
    id?: number;
    budgetId: number;
    order: number;
    level: number;
    itemNumber: string;
    code: string;
    description: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    type: 'material' | 'labor' | 'equipment' | 'service' | 'group';
    source: 'SINAPI' | 'SICRO' | 'OWN' | string;
    // Identificar se é insumo direto ou composição
    itemType?: 'insumo' | 'composicao';
    compositionId?: number; // Se itemType = 'composicao', referência à composição
    insumoId?: number; // Se itemType = 'insumo', referência ao insumo
    calculationMemory?: string; // e.g. "(2*3) + 4"
    calculationSteps?: string[]; // Step-by-step breakdown of calculation
    customBDI?: number; // Override budget BDI for this item
    costCenter?: string;
    isLocked?: boolean;
    notes?: string; // Internal annotations
    isDesonerated?: boolean; // Apply desoneration factor
    updatedAt: Date;
}

// ============================================================
// INSUMO - Elemento básico de custo (material, mão de obra, equipamento)
// Um insumo NÃO depende de outros insumos.
// ============================================================
export interface Insumo {
    id?: number;
    codigo: string;              // Código oficial (SINAPI/ORSE/etc.) ou próprio
    descricao: string;           // Descrição completa
    unidade: string;             // UN, M, M2, M3, KG, H, etc.
    preco: number;               // Preço unitário
    tipo: 'material' | 'maoDeObra' | 'equipamento' | 'servicoUnitario';
    fonte: string;               // SINAPI, ORSE, SEINFRA, SICRO, PROPRIO
    dataReferencia: Date;        // Data de referência do preço
    // Controle
    isOficial: boolean;          // Se veio de base oficial
    isEditavel: boolean;         // Se o preço pode ser editado
    observacoes?: string;        // Notas internas
    // Auditoria
    createdAt: Date;
    updatedAt: Date;
}

// ============================================================
// COMPOSIÇÃO (CPU) - Conjunto estruturado de insumos que forma um serviço
// Uma composição SEMPRE depende de insumos.
// ============================================================
export interface Composicao {
    id?: number;
    codigo: string;              // Código da composição (oficial ou próprio)
    descricao: string;           // Descrição completa do serviço
    unidade: string;             // Unidade da composição (M2, M3, UN, etc.)
    fonte: string;               // SINAPI, ORSE, SEINFRA, SICRO, PROPRIO
    custoTotal: number;          // Custo total calculado (soma dos insumos)
    dataReferencia: Date;        // Data de referência
    // Controle
    isOficial: boolean;          // Se veio de base oficial
    isCustomizada: boolean;      // Se foi modificada/criada pelo usuário
    observacoes?: string;        // Notas internas
    // Auditoria
    createdAt: Date;
    updatedAt: Date;
}

// ============================================================
// ITEM DA COMPOSIÇÃO - Vínculo entre composição e insumo
// ============================================================
export interface ComposicaoItem {
    id?: number;
    composicaoId: number;        // Referência à composição pai
    insumoId: number;            // Referência ao insumo
    codigoInsumo: string;        // Código do insumo (desnormalizado para performance)
    descricaoInsumo: string;     // Descrição do insumo (desnormalizado)
    unidadeInsumo: string;       // Unidade do insumo
    coeficiente: number;         // Quantidade/coeficiente do insumo na composição
    precoUnitario: number;       // Preço unitário do insumo no momento
    custoTotal: number;          // coeficiente * precoUnitario
}

// ============================================================
// LEGADO - Manter compatibilidade com estruturas anteriores
// ============================================================
export interface Resource {
    id?: number;
    code: string;
    description: string;
    unit: string;
    price: number;
    type: 'material' | 'labor' | 'equipment' | 'service';
    source: string; // SINAPI, SICRO, etc.
    updatedAt: Date;
}

export interface Client {
    id?: number;
    nome: string;               // Nome ou Razão Social
    documento: string;          // CPF ou CNPJ
    tipoDocumento: 'cpf' | 'cnpj';
    tipoCliente: 'publico' | 'privado';
    orgao?: string;             // Órgão/Entidade (se público)
    endereco?: string;
    cidade?: string;
    uf?: string;
    responsavel?: string;       // Contato técnico
    telefone?: string;
    email?: string;
    obraPredominante?: 'predial' | 'saneamento' | 'pavimentacao' | 'reforma' | 'outro';
    isAtivo: boolean;
    observacoes?: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface ResourceComposition {
    id?: number;
    parentCode: string;
    itemCode: string;
    description: string;
    unit: string;
    coefficient: number;
    unitPrice: number;
    source: string;
}

export interface CompanySettings {
    id?: number;
    name: string;
    cnpj: string;
    address: string;
    email: string;
    phone: string;
    logo?: string; // Base64
    responsibleName: string;
    responsibleCpf: string;
    responsibleCrea: string;
    proposalCover?: string;
    proposalTerms?: string;
}

export interface BudgetSchedule {
    id?: number;
    budgetId: number;
    itemId: number; // BudgetItem ID
    period: number; // 1, 2, 3, etc.
    percentage: number; // 0 to 100
    value: number;
}

export interface UserComposition {
    id?: number;
    code: string;
    description: string;
    unit: string;
    type: 'service' | 'composition';
    source: 'OWN';
    totalPrice: number;
    isLocked?: boolean;
    updatedAt: Date;
}

export interface UserCompositionItem {
    id?: number;
    parentCode: string;
    itemCode: string;
    description: string;
    unit: string;
    coefficient: number;
    unitPrice: number;
    totalPrice: number;
    source: string;
}

export interface BudgetItemComposition {
    id?: number;
    budgetItemId: number; // This links to BudgetItem
    code: string;
    description: string;
    unit: string;
    coefficient: number;
    unitPrice: number;
    totalPrice: number;
    source: string;
}

// ============================================================
// LOG DE AUDITORIA E HISTÓRICO - Rastreabilidade completa
// ============================================================
export interface ChangeLog {
    id?: number;
    budgetId?: number;       // Opcional, se o log for de orçamento
    itemId?: number;         // Opcional, se o log for de item
    proposalId?: number;     // Novo: ID da proposta vinculada
    action: 'create' | 'update' | 'delete' | 'status_change'; // status_change para workflow
    field?: string;
    oldValue?: string;       // JSON stringified value if complex object
    newValue?: string;
    description: string;
    user?: string;           // Novo: Usuário responsável (ou sistema)
    timestamp: Date;
}

// Proposals - Propostas técnicas/comerciais geradas
export interface Proposal {
    id?: number;
    nome: string;                    // Nome/título da proposta
    budgetId: number;                // Orçamento vinculado
    budgetName: string;              // Nome do orçamento (desnormalizado)
    clientId?: number;               // Cliente vinculado
    clientName: string;              // Nome do cliente
    valorTotal: number;              // Valor total com BDI

    // Workflow de Status Avançado
    status: 'rascunho' | 'em_revisao' | 'revisada' | 'aprovada' | 'emitida';

    tipoOrcamento: 'sintetico' | 'analitico';
    // Dados da empresa no momento da geração
    empresaNome: string;
    empresaCnpj: string;
    responsavelNome: string;
    responsavelCrea: string;
    logoBase64?: string;
    // Conteúdo incluído
    incluiCurvaABC: boolean;
    incluiMemorialCalculo: boolean;
    incluiCronograma: boolean;
    // Termos e ressalvas
    termosRessalvas: string;
    // Controle
    geradaEm: Date;
    revisadaEm?: Date;
    aprovadaEm?: Date;     // Novo
    emitidaEm?: Date;      // Novo
    observacoes?: string;
    createdAt: Date;
    updatedAt: Date;
}

// Budget attachments (files)
export interface BudgetAttachment {
    id?: number;
    budgetId: number;
    name: string;
    type: string; // MIME type
    data: string; // Base64
    size: number;
    uploadedAt: Date;
}

export class ConstructionDB extends Dexie {
    budgets!: Table<Budget>;
    budgetItems!: Table<BudgetItem>;
    resources!: Table<Resource>;
    clients!: Table<Client>;
    resourceCompositions!: Table<ResourceComposition>;
    settings!: Table<CompanySettings>;
    budgetSchedules!: Table<BudgetSchedule>;
    budgetItemCompositions!: Table<BudgetItemComposition>;
    userCompositions!: Table<UserComposition>;
    userCompositionItems!: Table<UserCompositionItem>;
    changeLogs!: Table<ChangeLog>;
    budgetAttachments!: Table<BudgetAttachment>;
    // Novas tabelas estruturadas
    insumos!: Table<Insumo>;
    composicoes!: Table<Composicao>;
    composicaoItems!: Table<ComposicaoItem>;
    proposals!: Table<Proposal>;

    constructor() {
        super('ConstructionDB');
        this.version(13).stores({
            budgets: '++id, name, client, status, date, updatedAt, isTemplate, parentBudgetId',
            budgetItems: '++id, budgetId, type, source, costCenter, itemType',
            resources: '++id, code, description, type, source',
            clients: '++id, nome, documento',
            resourceCompositions: '++id, parentCode, itemCode, source',
            settings: '++id',
            budgetSchedules: '++id, budgetId, itemId, period',
            budgetItemCompositions: '++id, budgetItemId',
            userCompositions: '++id, code, description',
            userCompositionItems: '++id, parentCode',
            changeLogs: '++id, budgetId, itemId, proposalId, action, timestamp',
            budgetAttachments: '++id, budgetId, name',
            // Novas tabelas
            insumos: '++id, codigo, descricao, tipo, fonte, dataReferencia',
            composicoes: '++id, codigo, descricao, fonte, dataReferencia',
            composicaoItems: '++id, composicaoId, insumoId',
            proposals: '++id, budgetId, clientId, status, geradaEm'
        });
    }
}

export const db = new ConstructionDB();

