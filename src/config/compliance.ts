/**
 * COMPLIANCE JURÍDICO - LICITAÇÕES E DOCUMENTOS OFICIAIS
 * 
 * DIRETRIZ OBRIGATÓRIA:
 * Avisos, disclaimers e textos explicativos NUNCA devem aparecer em documentos
 * oficiais exportados (PDFs, Excel, propostas). Esses arquivos são enviados a
 * órgãos públicos e devem conter APENAS informações técnicas do edital.
 * 
 * ONDE EXIBIR AVISOS:
 * - Interface do sistema (UI)
 * - Modais de confirmação
 * - Tooltips e banners
 * - Telas de revisão e validação
 * 
 * ONDE NUNCA EXIBIR:
 * - PDFs de propostas
 * - Planilhas Excel exportadas
 * - Relatórios oficiais
 * - Documentos para licitação
 */

export const COMPLIANCE_DISCLAIMERS = {
    /**
     * Aviso Legal - Responsabilidade Técnica
     * Exibir: Telas de revisão, validação, comparação
     * NÃO exibir: PDFs, Excel
     */
    LEGAL_COMPLIANCE: {
        title: "Aviso Legal - Ferramenta Auxiliar",
        message: `Este sistema é uma ferramenta de PRODUTIVIDADE e ORGANIZAÇÃO. Todas as análises, 
        validações e sugestões são AUTOMATIZADAS e NÃO substituem:
        
        • Verificação técnica por profissional habilitado (Engenheiro/Arquiteto)
        • Parecer jurídico especializado em licitações
        • Análise contábil e financeira
        • Revisão de conformidade com edital específico
        
        O usuário é INTEGRALMENTE RESPONSÁVEL pela veracidade, precisão e conformidade 
        de todos os dados inseridos e documentos gerados.`,
        severity: 'warning' as const,
        showOnPages: ['review', 'validation', 'comparison', 'scenarios']
    },

    /**
     * Aviso de Exportação - Antes de Gerar Documentos Oficiais
     * Exibir: Modal antes de gerar PDF/Excel
     * NÃO exibir: Dentro do documento
     */
    EXPORT_WARNING: {
        title: "⚠️ Atenção - Documento Oficial",
        message: `Você está prestes a gerar um DOCUMENTO OFICIAL para licitação.
        
        ANTES DE EXPORTAR, VERIFIQUE:
        ✓ Todos os valores estão corretos e atualizados
        ✓ BDI e Encargos Sociais estão conforme edital
        ✓ Composições de preço estão completas
        ✓ Dados da empresa estão corretos
        ✓ Não há itens duplicados ou inconsistentes
        
        IMPORTANTE:
        • Este documento será enviado ao órgão público
        • Erros podem desclassificar sua proposta
        • Revise TODOS os dados antes de exportar
        • Mantenha backup do orçamento original
        
        Confirma a geração do documento?`,
        severity: 'critical' as const,
        requiresConfirmation: true
    },

    /**
     * Aviso de Validação Automática
     * Exibir: Tela de revisão de proposta
     * NÃO exibir: PDFs, Excel
     */
    AUTO_VALIDATION: {
        title: "Validação Automática - Limitações",
        message: `As validações automáticas são INDICATIVAS e baseadas em padrões gerais.
        
        LIMITAÇÕES CONHECIDAS:
        • Não analisa conformidade com edital específico
        • Não verifica legislação municipal/estadual aplicável
        • Não valida cálculos estruturais ou dimensionamentos
        • Não substitui memorial descritivo técnico
        
        SEMPRE realize:
        • Revisão técnica por profissional habilitado
        • Verificação de conformidade com edital
        • Validação de preços com tabelas oficiais atualizadas
        • Conferência de todos os cálculos manualmente`,
        severity: 'info' as const
    },

    /**
     * Aviso de Correção Dirigida
     * Exibir: Ao usar funcionalidades de auto-correção
     * NÃO exibir: PDFs, Excel
     */
    AUTO_CORRECTION: {
        title: "Auto-Correção - Uso Responsável",
        message: `As funcionalidades de correção automática são AUXILIARES.
        
        O sistema tenta identificar e sugerir correções, porém:
        • NÃO garante 100% de precisão técnica ou jurídica
        • Pode não detectar todos os problemas
        • Pode sugerir correções inadequadas ao contexto
        
        TODAS as correções automáticas ou sugeridas DEVEM ser:
        ✓ Revisadas por responsável técnico habilitado
        ✓ Validadas contra o edital específico
        ✓ Conferidas antes da submissão da proposta
        
        O uso desta ferramenta NÃO constitui consultoria profissional.`,
        severity: 'warning' as const
    },

    /**
     * Aviso de Comparação de Preços
     * Exibir: Tela de comparação de orçamentos
     * NÃO exibir: PDFs, Excel
     */
    PRICE_COMPARISON: {
        title: "Comparação de Preços - Orientação",
        message: `A comparação de preços é baseada em dados inseridos no sistema.
        
        ATENÇÃO:
        • Preços de tabelas oficiais podem estar desatualizados
        • Variações regionais não são automaticamente consideradas
        • Condições específicas de obra podem alterar custos
        • Desoneração e regimes tributários devem ser verificados
        
        Para licitações públicas:
        • Use SEMPRE tabelas oficiais atualizadas (SINAPI, SICRO, etc.)
        • Verifique data de referência dos preços
        • Considere legislação específica do órgão
        • Documente fonte de todos os preços utilizados`,
        severity: 'info' as const
    },

    /**
     * Aviso de Simulação de Cenários
     * Exibir: Tela de cenários
     * NÃO exibir: PDFs, Excel
     */
    SCENARIO_SIMULATION: {
        title: "Simulação de Cenários - Finalidade",
        message: `As simulações de cenários são para PLANEJAMENTO INTERNO.
        
        IMPORTANTE:
        • Cenários simulados NÃO devem ser enviados como proposta oficial
        • Use apenas para análise de viabilidade e estratégia
        • Valores simulados podem não refletir custos reais
        • Sempre gere proposta final a partir do orçamento base validado
        
        Para submissão oficial:
        • Use APENAS o orçamento base aprovado
        • Não envie múltiplas versões ao órgão
        • Mantenha documentação de todas as premissas`,
        severity: 'info' as const
    },

    /**
     * Aviso de Dados Sensíveis
     * Exibir: Ao configurar empresa/dados
     * NÃO exibir: PDFs, Excel
     */
    DATA_PRIVACY: {
        title: "Proteção de Dados - LGPD",
        message: `Seus dados são armazenados de forma segura e isolada.
        
        GARANTIAS:
        • Cada usuário acessa apenas seus próprios dados
        • Dados de empresa são privados e protegidos
        • Orçamentos não são compartilhados entre usuários
        • Backup e segurança são responsabilidade do usuário
        
        RECOMENDAÇÕES:
        • Não compartilhe credenciais de acesso
        • Faça backup regular de dados importantes
        • Revise permissões de usuários periodicamente
        • Exporte documentos importantes localmente`,
        severity: 'info' as const
    }
};

/**
 * Configuração de Modais de Confirmação
 * Exibir ANTES de gerar documentos oficiais
 */
export const EXPORT_CONFIRMATIONS = {
    PDF_PROPOSAL: {
        title: "Gerar Proposta em PDF",
        message: "Este documento será usado em licitação pública?",
        checklistItems: [
            "Todos os valores foram revisados",
            "BDI está conforme edital",
            "Dados da empresa estão corretos",
            "Não há itens duplicados",
            "Composições estão completas"
        ],
        warningText: "Erros podem desclassificar sua proposta. Revise cuidadosamente.",
        confirmButtonText: "Confirmar e Gerar PDF",
        cancelButtonText: "Cancelar e Revisar"
    },

    EXCEL_BUDGET: {
        title: "Exportar Planilha Orçamentária",
        message: "Esta planilha será enviada ao órgão público?",
        checklistItems: [
            "Estrutura hierárquica está correta",
            "Quantidades foram conferidas",
            "Preços unitários estão atualizados",
            "Fonte dos preços está documentada",
            "Totais foram recalculados"
        ],
        warningText: "Planilhas oficiais devem seguir formato do edital.",
        confirmButtonText: "Confirmar e Exportar",
        cancelButtonText: "Cancelar"
    },

    EXCEL_ANALYTIC: {
        title: "Exportar Composições de Preços (CPU)",
        message: "Este detalhamento será anexado à proposta?",
        checklistItems: [
            "Todas as composições estão completas",
            "Coeficientes foram verificados",
            "Preços de insumos estão atualizados",
            "Produtividades estão corretas",
            "Não há composições vazias"
        ],
        warningText: "Composições incompletas podem gerar questionamentos.",
        confirmButtonText: "Confirmar e Exportar",
        cancelButtonText: "Cancelar"
    }
};

/**
 * Tooltips Informativos
 * Exibir: Ao passar mouse sobre campos/botões
 * NÃO exibir: PDFs, Excel
 */
export const TOOLTIPS = {
    BDI_CALCULATOR: "BDI (Benefícios e Despesas Indiretas) deve ser calculado conforme Acórdão TCU 2622/2013. Verifique se os percentuais estão de acordo com o edital.",

    ENCARGOS_SOCIAIS: "Encargos Sociais variam conforme tipo de mão de obra (horista/mensalista) e legislação vigente. Consulte tabelas oficiais atualizadas.",

    PRICE_SOURCE: "Sempre documente a fonte dos preços (SINAPI, SICRO, cotações). Em licitações, preços sem fonte podem ser questionados.",

    COMPOSITION_REQUIRED: "Itens de serviço geralmente requerem composição de preços detalhada. Verifique requisitos do edital.",

    DESONERACAO: "Desoneração da folha de pagamento: verifique se aplica ao seu caso e se está prevista no edital.",

    EXPORT_PDF: "O PDF gerado NÃO conterá avisos do sistema. Será um documento limpo para licitação.",

    EXPORT_EXCEL: "A planilha Excel NÃO conterá avisos do sistema. Será um documento limpo para licitação."
};

/**
 * Função auxiliar para verificar se deve exibir disclaimer em uma página
 */
export function shouldShowDisclaimer(
    disclaimerKey: keyof typeof COMPLIANCE_DISCLAIMERS,
    currentPage: string
): boolean {
    const disclaimer = COMPLIANCE_DISCLAIMERS[disclaimerKey];

    if (!('showOnPages' in disclaimer)) {
        return true; // Exibe em todas as páginas se não especificado
    }

    return disclaimer.showOnPages.includes(currentPage);
}

/**
 * Função para obter mensagem de confirmação de exportação
 */
export function getExportConfirmation(exportType: keyof typeof EXPORT_CONFIRMATIONS) {
    return EXPORT_CONFIRMATIONS[exportType];
}
