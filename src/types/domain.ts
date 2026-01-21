
export interface Budget {
    id?: string;
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
    parentBudgetId?: string; // ID do orçamento original (para cenários/duplicações)
    isScenario?: boolean; // Se true, é uma simulação de cenário
    scenarioName?: string; // Nome do cenário (ex: "BDI +5%", "Reajuste MO")
    // SINAPI Regime Configuration (fonte única da verdade para busca de preços)
    sinapiUf?: string; // UF da base SINAPI (ex: 'BA')
    sinapiCompetence?: string; // Competência da base (ex: '2025-01')
    sinapiRegime?: 'DESONERADO' | 'NAO_DESONERADO'; // Regime definido pelos Encargos Sociais
    sinapiContractType?: 'HORISTA' | 'MENSALISTA'; // Tipo de contrato para encargos
    createdAt: Date;
    updatedAt: Date;
    metadata?: Record<string, any>; // Extra flags (e.g. divergence)
    settings?: Record<string, any>; // General budget settings and global adjustments
}


export interface BudgetItem {
    id?: string;
    budgetId: string;
    order: number;
    level: number;
    itemNumber: string;
    code: string;
    description: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    finalPrice?: number; // Price with BDI
    totalPrice: number;
    peso?: number; // Pre-calculated weight from view
    parentId?: string | null; // Hierarchy Parent
    rowType?: 'etapa' | 'subetapa' | 'item'; // From View
    type: 'material' | 'labor' | 'equipment' | 'service' | 'group';
    source: 'SINAPI' | 'SICRO' | 'OWN' | string;
    // Identificar se é insumo direto ou composição
    itemType?: 'insumo' | 'composicao';
    compositionId?: string; // Se itemType = 'composicao', referência à composição
    insumoId?: string; // Se itemType = 'insumo', referência ao insumo
    calculationMemory?: string; // e.g. "(2*3) + 4"
    calculationSteps?: string[]; // Step-by-step breakdown of calculation
    customBDI?: number; // Override budget BDI for this item
    costCenter?: string;
    isLocked?: boolean;
    notes?: string; // Internal annotations
    isDesonerated?: boolean; // Apply desoneration factor
    updatedAt: Date;
}

export interface BudgetItemComposition {
    id?: string;
    budgetItemId: string;
    description: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    type: 'material' | 'labor' | 'equipment' | 'service';
    updatedAt: Date;
    metadata?: Record<string, any>;
    baseUnitPrice?: number;
}

export interface Insumo {
    id?: string;
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

export interface Composicao {
    id?: string;
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

export interface ComposicaoItem {
    id?: string;
    composicaoId: string;        // Referência à composição pai
    insumoId: string;            // Referência ao insumo
    codigoInsumo: string;        // Código do insumo (desnormalizado para performance)
    descricaoInsumo: string;     // Descrição do insumo (desnormalizado)
    unidadeInsumo: string;       // Unidade do insumo
    coeficiente: number;         // Quantidade/coeficiente do insumo na composição
    precoUnitario: number;       // Preço unitário do insumo no momento
    custoTotal: number;          // coeficiente * precoUnitario
}

export interface Client {
    id?: string;
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

export interface CompanySettings {
    id?: string;
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
    id?: string;
    budgetId: string;
    itemId: string; // BudgetItem ID
    period: number; // 1, 2, 3, etc.
    percentage: number; // 0 to 100
    value: number;
}

export interface ChangeLog {
    id?: string;
    budgetId?: string;       // Opcional
    itemId?: string;         // Opcional
    proposalId?: string;     // Novo
    action: 'create' | 'update' | 'delete' | 'status_change';
    field?: string;
    oldValue?: string;
    newValue?: string;
    description: string;
    user?: string;
    timestamp: Date;
}

export interface Proposal {
    id?: string;
    nome: string;
    budgetId: string;
    budgetName: string;
    clientId?: string;
    clientName: string;
    valorTotal: number;
    status: 'rascunho' | 'em_revisao' | 'revisada' | 'aprovada' | 'emitida';
    tipoOrcamento: 'sintetico' | 'analitico';
    empresaNome: string;
    empresaCnpj: string;
    responsavelNome: string;
    responsavelCrea: string;
    logoBase64?: string;
    incluiCurvaABC: boolean;
    incluiMemorialCalculo: boolean;
    incluiCronograma: boolean;
    termosRessalvas: string;
    geradaEm: Date;
    revisadaEm?: Date;
    aprovadaEm?: Date;
    emitidaEm?: Date;
    observacoes?: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface BudgetAttachment {
    id?: string;
    budgetId: string;
    name: string;
    type: string;
    data: string;
    size: number;
    uploadedAt: Date;
}
