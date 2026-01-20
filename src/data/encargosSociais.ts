// Base de dados de Encargos Sociais - Oficial SINAPI/SICRO/SEINFRA/ORSE
// Estrutura: Horista (h) e Mensalista (m) para cada base

export interface EncargoItem {
    codigo: string;
    descricao: string;
    horista: number;
    mensalista: number;
}

export interface GrupoEncargo {
    nome: string;
    descricao: string;
    itens: EncargoItem[];
}

export interface BaseEncargos {
    id: string;
    nome: string;
    fonte: string;
    estado?: string;
    desonerado: boolean;
    dataReferencia: string;
    grupos: GrupoEncargo[];
}

// Função para calcular totais de um grupo
export const calcularTotalGrupo = (grupo: GrupoEncargo, tipo: 'horista' | 'mensalista'): number => {
    return grupo.itens.reduce((acc, item) => acc + item[tipo], 0);
};

// Função para calcular total geral de uma base
export const calcularTotalBase = (base: BaseEncargos, tipo: 'horista' | 'mensalista'): number => {
    return base.grupos.reduce((acc, grupo) => acc + calcularTotalGrupo(grupo, tipo), 0);
};

// Bases oficiais de Encargos Sociais
export const ENCARGOS_SOCIAIS_BASES: BaseEncargos[] = [
    {
        id: 'sinapi-horista-nao-desonerado',
        nome: 'SINAPI Federal (Não Desonerado)',
        fonte: 'SINAPI/IBGE',
        desonerado: false,
        dataReferencia: 'Jan/2025',
        grupos: [
            {
                nome: 'Grupo A',
                descricao: 'Encargos Sociais Básicos',
                itens: [
                    { codigo: 'A1', descricao: 'INSS', horista: 20.00, mensalista: 20.00 },
                    { codigo: 'A2', descricao: 'SESI', horista: 1.50, mensalista: 1.50 },
                    { codigo: 'A3', descricao: 'SENAI', horista: 1.00, mensalista: 1.00 },
                    { codigo: 'A4', descricao: 'INCRA', horista: 0.20, mensalista: 0.20 },
                    { codigo: 'A5', descricao: 'SEBRAE', horista: 0.60, mensalista: 0.60 },
                    { codigo: 'A6', descricao: 'Salário Educação', horista: 2.50, mensalista: 2.50 },
                    { codigo: 'A7', descricao: 'Seguro Contra Acidentes de Trabalho', horista: 3.00, mensalista: 3.00 },
                    { codigo: 'A8', descricao: 'FGTS', horista: 8.00, mensalista: 8.00 },
                    { codigo: 'A9', descricao: 'SECONCI', horista: 0.00, mensalista: 0.00 },
                ]
            },
            {
                nome: 'Grupo B',
                descricao: 'Encargos que recebem incidência de "A"',
                itens: [
                    { codigo: 'B1', descricao: 'Repouso Semanal Remunerado', horista: 17.98, mensalista: 0.00 },
                    { codigo: 'B2', descricao: 'Feriados', horista: 3.70, mensalista: 0.00 },
                    { codigo: 'B3', descricao: 'Auxílio - Enfermidade', horista: 0.88, mensalista: 0.65 },
                    { codigo: 'B4', descricao: '13º Salário', horista: 10.97, mensalista: 8.33 },
                    { codigo: 'B5', descricao: 'Licença Paternidade', horista: 0.06, mensalista: 0.05 },
                    { codigo: 'B6', descricao: 'Faltas Justificadas', horista: 0.74, mensalista: 0.56 },
                    { codigo: 'B7', descricao: 'Dias de Chuva', horista: 2.14, mensalista: 0.00 },
                    { codigo: 'B8', descricao: 'Auxílio Acidente de Trabalho', horista: 0.10, mensalista: 0.07 },
                    { codigo: 'B9', descricao: 'Férias Gozadas', horista: 9.09, mensalista: 9.09 },
                    { codigo: 'B10', descricao: 'Salário Maternidade', horista: 0.03, mensalista: 0.02 },
                ]
            },
            {
                nome: 'Grupo C',
                descricao: 'Encargos que não recebem incidência de "A"',
                itens: [
                    { codigo: 'C1', descricao: 'Aviso Prévio Indenizado', horista: 5.45, mensalista: 4.13 },
                    { codigo: 'C2', descricao: 'Aviso Prévio Trabalhado', horista: 0.13, mensalista: 0.10 },
                    { codigo: 'C3', descricao: 'Férias Indenizadas', horista: 3.52, mensalista: 2.67 },
                    { codigo: 'C4', descricao: 'Depósito Rescisão Sem Justa Causa', horista: 3.24, mensalista: 2.46 },
                    { codigo: 'C5', descricao: 'Indenização Adicional', horista: 0.49, mensalista: 0.37 },
                ]
            },
            {
                nome: 'Grupo D',
                descricao: 'Taxas de Reincidência',
                itens: [
                    { codigo: 'D1', descricao: 'Reincidência de Grupo A sobre Grupo B', horista: 18.10, mensalista: 6.87 },
                    { codigo: 'D2', descricao: 'Reincidência de Grupo A sobre Aviso Prévio Trab. e Reincidência do FGTS sobre D1', horista: 0.47, mensalista: 0.35 },
                    { codigo: 'D3', descricao: 'Incidência de Grupo A sobre o Aviso Prévio Indenizado', horista: 18.57, mensalista: 7.24 },
                ]
            }
        ]
    },
    {
        id: 'sinapi-horista-desonerado',
        nome: 'SINAPI Federal (Desonerado)',
        fonte: 'SINAPI/IBGE',
        desonerado: true,
        dataReferencia: 'Jan/2025',
        grupos: [
            {
                nome: 'Grupo A',
                descricao: 'Encargos Sociais Básicos',
                itens: [
                    { codigo: 'A1', descricao: 'INSS', horista: 0.00, mensalista: 0.00 },
                    { codigo: 'A2', descricao: 'SESI', horista: 1.50, mensalista: 1.50 },
                    { codigo: 'A3', descricao: 'SENAI', horista: 1.00, mensalista: 1.00 },
                    { codigo: 'A4', descricao: 'INCRA', horista: 0.20, mensalista: 0.20 },
                    { codigo: 'A5', descricao: 'SEBRAE', horista: 0.60, mensalista: 0.60 },
                    { codigo: 'A6', descricao: 'Salário Educação', horista: 2.50, mensalista: 2.50 },
                    { codigo: 'A7', descricao: 'Seguro Contra Acidentes de Trabalho', horista: 3.00, mensalista: 3.00 },
                    { codigo: 'A8', descricao: 'FGTS', horista: 8.00, mensalista: 8.00 },
                    { codigo: 'A9', descricao: 'SECONCI', horista: 0.00, mensalista: 0.00 },
                ]
            },
            {
                nome: 'Grupo B',
                descricao: 'Encargos que recebem incidência de "A"',
                itens: [
                    { codigo: 'B1', descricao: 'Repouso Semanal Remunerado', horista: 17.98, mensalista: 0.00 },
                    { codigo: 'B2', descricao: 'Feriados', horista: 3.70, mensalista: 0.00 },
                    { codigo: 'B3', descricao: 'Auxílio - Enfermidade', horista: 0.88, mensalista: 0.65 },
                    { codigo: 'B4', descricao: '13º Salário', horista: 10.97, mensalista: 8.33 },
                    { codigo: 'B5', descricao: 'Licença Paternidade', horista: 0.06, mensalista: 0.05 },
                    { codigo: 'B6', descricao: 'Faltas Justificadas', horista: 0.74, mensalista: 0.56 },
                    { codigo: 'B7', descricao: 'Dias de Chuva', horista: 2.14, mensalista: 0.00 },
                    { codigo: 'B8', descricao: 'Auxílio Acidente de Trabalho', horista: 0.10, mensalista: 0.07 },
                    { codigo: 'B9', descricao: 'Férias Gozadas', horista: 9.09, mensalista: 9.09 },
                    { codigo: 'B10', descricao: 'Salário Maternidade', horista: 0.03, mensalista: 0.02 },
                ]
            },
            {
                nome: 'Grupo C',
                descricao: 'Encargos que não recebem incidência de "A"',
                itens: [
                    { codigo: 'C1', descricao: 'Aviso Prévio Indenizado', horista: 5.45, mensalista: 4.13 },
                    { codigo: 'C2', descricao: 'Aviso Prévio Trabalhado', horista: 0.13, mensalista: 0.10 },
                    { codigo: 'C3', descricao: 'Férias Indenizadas', horista: 3.52, mensalista: 2.67 },
                    { codigo: 'C4', descricao: 'Depósito Rescisão Sem Justa Causa', horista: 3.24, mensalista: 2.46 },
                    { codigo: 'C5', descricao: 'Indenização Adicional', horista: 0.49, mensalista: 0.37 },
                ]
            },
            {
                nome: 'Grupo D',
                descricao: 'Taxas de Reincidência',
                itens: [
                    { codigo: 'D1', descricao: 'Reincidência de Grupo A sobre Grupo B', horista: 7.50, mensalista: 2.85 },
                    { codigo: 'D2', descricao: 'Reincidência de Grupo A sobre Aviso Prévio Trab. e Reincidência do FGTS sobre D1', horista: 0.20, mensalista: 0.15 },
                    { codigo: 'D3', descricao: 'Aviso Prévio Indenizado', horista: 7.70, mensalista: 3.00 },
                ]
            }
        ]
    },
    {
        id: 'seinfra-ce-horista',
        nome: 'SEINFRA CE (Não Desonerado)',
        fonte: 'SEINFRA/CE',
        estado: 'CE',
        desonerado: false,
        dataReferencia: 'Jan/2025',
        grupos: [
            {
                nome: 'Grupo A',
                descricao: 'Encargos Sociais Básicos',
                itens: [
                    { codigo: 'A1', descricao: 'INSS', horista: 20.00, mensalista: 20.00 },
                    { codigo: 'A2', descricao: 'SESI', horista: 1.50, mensalista: 1.50 },
                    { codigo: 'A3', descricao: 'SENAI', horista: 1.00, mensalista: 1.00 },
                    { codigo: 'A4', descricao: 'INCRA', horista: 0.20, mensalista: 0.20 },
                    { codigo: 'A5', descricao: 'SEBRAE', horista: 0.60, mensalista: 0.60 },
                    { codigo: 'A6', descricao: 'Salário Educação', horista: 2.50, mensalista: 2.50 },
                    { codigo: 'A7', descricao: 'Seguro Contra Acidentes de Trabalho', horista: 3.00, mensalista: 3.00 },
                    { codigo: 'A8', descricao: 'FGTS', horista: 8.00, mensalista: 8.00 },
                ]
            },
            {
                nome: 'Grupo B',
                descricao: 'Encargos que recebem incidência de "A"',
                itens: [
                    { codigo: 'B1', descricao: 'Repouso Semanal Remunerado', horista: 17.98, mensalista: 0.00 },
                    { codigo: 'B2', descricao: 'Feriados', horista: 3.94, mensalista: 0.00 },
                    { codigo: 'B3', descricao: 'Auxílio - Enfermidade', horista: 0.79, mensalista: 0.59 },
                    { codigo: 'B4', descricao: '13º Salário', horista: 10.91, mensalista: 8.33 },
                    { codigo: 'B5', descricao: 'Licença Paternidade', horista: 0.06, mensalista: 0.05 },
                    { codigo: 'B6', descricao: 'Faltas Justificadas', horista: 0.66, mensalista: 0.50 },
                    { codigo: 'B7', descricao: 'Dias de Chuva', horista: 1.50, mensalista: 0.00 },
                    { codigo: 'B8', descricao: 'Auxílio Acidente de Trabalho', horista: 0.09, mensalista: 0.07 },
                    { codigo: 'B9', descricao: 'Férias Gozadas', horista: 9.09, mensalista: 9.09 },
                ]
            },
            {
                nome: 'Grupo C',
                descricao: 'Encargos que não recebem incidência de "A"',
                itens: [
                    { codigo: 'C1', descricao: 'Aviso Prévio Indenizado', horista: 5.45, mensalista: 4.13 },
                    { codigo: 'C2', descricao: 'Aviso Prévio Trabalhado', horista: 0.13, mensalista: 0.10 },
                    { codigo: 'C3', descricao: 'Férias Indenizadas', horista: 3.52, mensalista: 2.67 },
                    { codigo: 'C4', descricao: 'Depósito Rescisão Sem Justa Causa', horista: 3.24, mensalista: 2.46 },
                    { codigo: 'C5', descricao: 'Indenização Adicional', horista: 0.49, mensalista: 0.37 },
                ]
            },
            {
                nome: 'Grupo D',
                descricao: 'Taxas de Reincidência',
                itens: [
                    { codigo: 'D1', descricao: 'Reincidência de Grupo A sobre Grupo B', horista: 18.10, mensalista: 6.87 },
                    { codigo: 'D2', descricao: 'Reincidência sobre Aviso Prévio Trabalhado', horista: 0.47, mensalista: 0.35 },
                    { codigo: 'D3', descricao: 'Aviso Prévio Indenizado', horista: 18.57, mensalista: 7.24 },
                ]
            }
        ]
    },
    {
        id: 'orse-se-horista',
        nome: 'ORSE SE (Não Desonerado)',
        fonte: 'ORSE/SE',
        estado: 'SE',
        desonerado: false,
        dataReferencia: 'Jan/2025',
        grupos: [
            {
                nome: 'Grupo A',
                descricao: 'Encargos Sociais Básicos',
                itens: [
                    { codigo: 'A1', descricao: 'INSS', horista: 20.00, mensalista: 20.00 },
                    { codigo: 'A2', descricao: 'SESI', horista: 1.50, mensalista: 1.50 },
                    { codigo: 'A3', descricao: 'SENAI', horista: 1.00, mensalista: 1.00 },
                    { codigo: 'A4', descricao: 'INCRA', horista: 0.20, mensalista: 0.20 },
                    { codigo: 'A5', descricao: 'SEBRAE', horista: 0.60, mensalista: 0.60 },
                    { codigo: 'A6', descricao: 'Salário Educação', horista: 2.50, mensalista: 2.50 },
                    { codigo: 'A7', descricao: 'Seguro Contra Acidentes de Trabalho', horista: 3.00, mensalista: 3.00 },
                    { codigo: 'A8', descricao: 'FGTS', horista: 8.00, mensalista: 8.00 },
                ]
            },
            {
                nome: 'Grupo B',
                descricao: 'Encargos que recebem incidência de "A"',
                itens: [
                    { codigo: 'B1', descricao: 'Repouso Semanal Remunerado', horista: 17.98, mensalista: 0.00 },
                    { codigo: 'B2', descricao: 'Feriados', horista: 3.64, mensalista: 0.00 },
                    { codigo: 'B3', descricao: 'Auxílio - Enfermidade', horista: 0.88, mensalista: 0.65 },
                    { codigo: 'B4', descricao: '13º Salário', horista: 10.95, mensalista: 8.33 },
                    { codigo: 'B5', descricao: 'Licença Paternidade', horista: 0.06, mensalista: 0.05 },
                    { codigo: 'B6', descricao: 'Faltas Justificadas', horista: 0.74, mensalista: 0.56 },
                    { codigo: 'B7', descricao: 'Dias de Chuva', horista: 1.50, mensalista: 0.00 },
                    { codigo: 'B8', descricao: 'Auxílio Acidente de Trabalho', horista: 0.10, mensalista: 0.07 },
                    { codigo: 'B9', descricao: 'Férias Gozadas', horista: 9.09, mensalista: 9.09 },
                ]
            },
            {
                nome: 'Grupo C',
                descricao: 'Encargos que não recebem incidência de "A"',
                itens: [
                    { codigo: 'C1', descricao: 'Aviso Prévio Indenizado', horista: 5.45, mensalista: 4.13 },
                    { codigo: 'C2', descricao: 'Aviso Prévio Trabalhado', horista: 0.13, mensalista: 0.10 },
                    { codigo: 'C3', descricao: 'Férias Indenizadas', horista: 3.52, mensalista: 2.67 },
                    { codigo: 'C4', descricao: 'Depósito Rescisão Sem Justa Causa', horista: 3.24, mensalista: 2.46 },
                    { codigo: 'C5', descricao: 'Indenização Adicional', horista: 0.49, mensalista: 0.37 },
                ]
            },
            {
                nome: 'Grupo D',
                descricao: 'Taxas de Reincidência',
                itens: [
                    { codigo: 'D1', descricao: 'Reincidência de Grupo A sobre Grupo B', horista: 17.95, mensalista: 6.82 },
                    { codigo: 'D2', descricao: 'Reincidência sobre Aviso Prévio Trabalhado', horista: 0.47, mensalista: 0.35 },
                    { codigo: 'D3', descricao: 'Aviso Prévio Indenizado', horista: 18.42, mensalista: 7.17 },
                ]
            }
        ]
    }
];

// Converter base antiga para novo formato para compatibilidade
export const getResumoBase = (base: BaseEncargos, tipo: 'horista' | 'mensalista') => {
    const resumo: { [key: string]: number } = {};
    base.grupos.forEach(grupo => {
        resumo[grupo.nome] = calcularTotalGrupo(grupo, tipo);
    });
    return {
        name: `${base.nome} (${tipo === 'horista' ? 'Horista' : 'Mensalista'})`,
        total: calcularTotalBase(base, tipo),
        details: resumo
    };
};
