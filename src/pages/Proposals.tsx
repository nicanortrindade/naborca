import { useState, useEffect, useMemo } from 'react';
// import { db, type Proposal } from '../sdk/database/orm/db'; // Removed Dexie
import { ProposalService } from '../lib/supabase-services/ProposalService';
import { BudgetService } from '../lib/supabase-services/BudgetService';
import { ClientService } from '../lib/supabase-services/ClientService';
import { CompanyService } from '../lib/supabase-services/CompanyService';
import { ChangeLogService } from '../lib/supabase-services/ChangeLogService';
import { BudgetItemService } from '../lib/supabase-services/BudgetItemService';
import { type Proposal, type Budget, type Client, type CompanySettings, type ChangeLog } from '../types/domain';
import {
    FileText, Search, Plus, X, Download, Copy, Trash2, FileSpreadsheet,
    Building2, Clock, AlertTriangle, ChevronRight, Settings,
    Shield, CheckCircle2, Lock, History, Edit3, Eye, Info
} from 'lucide-react';
import { clsx } from 'clsx';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { generateProposalPDF } from '../sdk/reports/ProposalGenerator';

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any; description: string }> = {
    rascunho: { label: 'Rascunho', color: 'bg-slate-100 text-slate-600', icon: Edit3, description: 'Edição livre' },
    em_revisao: { label: 'Em Revisão', color: 'bg-amber-50 text-amber-700', icon: Clock, description: 'Análise técnica em andamento' },
    revisada: { label: 'Revisada', color: 'bg-blue-50 text-blue-700', icon: CheckCircle2, description: 'Validada tecnicamente' },
    aprovada: { label: 'Aprovada', color: 'bg-green-50 text-green-700', icon: Shield, description: 'Aprovada para envio' },
    emitida: { label: 'Emitida', color: 'bg-purple-50 text-purple-700', icon: Lock, description: 'Documento finalizado e travado' },
    // Legado
    gerada: { label: 'Gerada (Antigo)', color: 'bg-slate-50 text-slate-500', icon: FileText, description: 'Status legado' },
};

const TERMOS_PADRAO = `Este documento foi elaborado com base em informações fornecidas pelo usuário e referências de bases oficiais de preços (SINAPI, SICRO, ORSE, SEINFRA, entre outras). Os valores apresentados são estimativos e podem sofrer alterações de acordo com as condições reais de execução, disponibilidade de materiais e mão de obra, e variações de mercado.

A proposta não substitui análise técnica, jurídica ou editalícia específica. A empresa responsável pela elaboração não se responsabiliza por eventuais divergências entre os valores apresentados e os valores finais de execução.

Esta proposta tem validade de 30 (trinta) dias a partir da data de emissão, salvo disposição em contrário expressamente indicada.`;

const Proposals = () => {
    const navigate = useNavigate();
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<string>('');
    const [showNewModal, setShowNewModal] = useState(false);
    const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
    const [viewModalOpen, setViewModalOpen] = useState(false);
    const [viewTab, setViewTab] = useState<'details' | 'history'>('details');
    // Estados para edição no modal
    const [isEditing, setIsEditing] = useState(false);
    const [editData, setEditData] = useState({ nome: '', termosRessalvas: '' });

    // Form state para nova proposta
    const [step, setStep] = useState(1);
    const [selectedBudgetId, setSelectedBudgetId] = useState<string | null>(null);
    const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
    const [formData, setFormData] = useState({
        nome: '',
        tipoOrcamento: 'sintetico' as 'sintetico' | 'analitico',
        incluiCurvaABC: false,
        incluiMemorialCalculo: false,
        incluiCronograma: false,
        termosRessalvas: TERMOS_PADRAO,
    });

    const [allProposals, setAllProposals] = useState<Proposal[]>([]);
    const [budgets, setBudgets] = useState<Budget[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);
    const [logs, setLogs] = useState<ChangeLog[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchData = async () => {
        setIsLoading(true);
        try {
            const [proposalsData, budgetsData, clientsData, companyData] = await Promise.all([
                ProposalService.getAll(),
                BudgetService.getAll(),
                ClientService.getAll(),
                CompanyService.get()
            ]);
            setAllProposals(proposalsData);
            setBudgets(budgetsData);
            setClients(clientsData.filter(c => c.isAtivo));
            setCompanySettings(companyData);
        } catch (error) {
            console.error(error);
            alert('Erro ao carregar dados.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const fetchLogs = async () => {
        if (!selectedProposal?.id) {
            setLogs([]);
            return;
        }
        try {
            const data = await ChangeLogService.getByProposalId(selectedProposal.id);
            setLogs(data);
        } catch (error) {
            console.error(error);
        }
    };

    useEffect(() => {
        if (viewModalOpen && selectedProposal) {
            fetchLogs();
        }
    }, [viewModalOpen, selectedProposal]);


    // Filter proposals
    const proposals = useMemo(() => {
        let results = [...allProposals];

        if (filterStatus) {
            results = results.filter(p => p.status === filterStatus);
        }

        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            results = results.filter(p =>
                p.nome.toLowerCase().includes(term) ||
                p.clientName.toLowerCase().includes(term) ||
                p.budgetName.toLowerCase().includes(term)
            );
        }
        return results;
    }, [allProposals, searchTerm, filterStatus]);


    const selectedBudget = budgets.find(b => b.id === selectedBudgetId);
    const selectedClient = clients.find(c => c.id === selectedClientId);

    const totalProposals = allProposals.length;

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
    };

    const resetForm = () => {
        setStep(1);
        setSelectedBudgetId(null);
        setSelectedClientId(null);
        setFormData({
            nome: '',
            tipoOrcamento: 'sintetico',
            incluiCurvaABC: false,
            incluiMemorialCalculo: false,
            incluiCronograma: false,
            termosRessalvas: TERMOS_PADRAO,
        });
    };

    const handleGenerateProposal = async () => {
        if (!selectedBudget || !companySettings) {
            // If company settings are missing, we should probably warn or allow proceed with defaults but better warn
            if (!companySettings) {
                alert('Configure os dados da empresa antes de gerar uma proposta.');
                return;
            }
            alert('Selecione um orçamento.');
            return;
        }

        try {
            const items = await BudgetItemService.getByBudgetId(selectedBudget.id!);
            const bdiMultiplier = 1 + (selectedBudget.bdi || 0) / 100;
            const valorTotal = items.reduce((sum, item) => sum + item.totalPrice, 0) * bdiMultiplier;

            await ProposalService.create({
                nome: formData.nome || `Proposta - ${selectedBudget.name}`,
                budgetId: selectedBudget.id!,
                budgetName: selectedBudget.name,
                clientId: selectedClientId || undefined,
                clientName: selectedClient?.nome || selectedBudget.client || 'Não informado',
                valorTotal,
                status: 'rascunho', // Novo padrão
                tipoOrcamento: formData.tipoOrcamento,
                empresaNome: companySettings.name,
                empresaCnpj: companySettings.cnpj,
                responsavelNome: companySettings.responsibleName,
                responsavelCrea: companySettings.responsibleCrea,
                logoBase64: companySettings.logo,
                incluiCurvaABC: formData.incluiCurvaABC,
                incluiMemorialCalculo: formData.incluiMemorialCalculo,
                incluiCronograma: formData.incluiCronograma,
                termosRessalvas: formData.termosRessalvas,
                geradaEm: new Date(),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            // Gerar PDF automaticamente
            const proposalData = {
                budgetName: selectedBudget.name,
                clientName: selectedClient?.nome || selectedBudget.client || 'Não informado',
                date: new Date(),
                totalValue: valorTotal,
                bdi: selectedBudget.bdi || 0,
                // Cast items to any to bypass strict type check for 'composition' if missing
                items: items.map((item, idx) => ({
                    ...item,
                    itemNumber: String(idx + 1).padStart(2, '0'),
                })) as any[],
                companySettings,
            };

            generateProposalPDF(proposalData, formData.tipoOrcamento === 'sintetico' ? 'synthetic' : 'analytic');

            setShowNewModal(false);
            resetForm();
            fetchData();
        } catch (error) {
            console.error(error);
            alert('Erro ao gerar proposta.');
        }
    };

    const handleDownloadPDF = async (proposal: Proposal) => {
        try {
            if (!proposal.budgetId) {
                alert('Orçamento vinculado não encontrado.');
                return;
            }

            const [budget, items, settings] = await Promise.all([
                BudgetService.getById(proposal.budgetId),
                BudgetItemService.getByBudgetId(proposal.budgetId),
                CompanyService.get()
            ]);

            if (!budget || !settings) {
                alert('Dados do orçamento ou empresa não encontrados.');
                return;
            }

            const proposalData = {
                budgetName: proposal.budgetName,
                clientName: proposal.clientName,
                date: proposal.geradaEm,
                totalValue: proposal.valorTotal,
                bdi: budget.bdi || 0,
                items: items.map((item, idx) => ({
                    ...item,
                    itemNumber: String(idx + 1).padStart(2, '0'),
                })) as any[],
                companySettings: settings,
            };

            generateProposalPDF(proposalData, proposal.tipoOrcamento === 'sintetico' ? 'synthetic' : 'analytic');
        } catch (error) {
            console.error(error);
            alert('Erro ao gerar PDF.');
        }
    };

    const handleDuplicate = async (proposal: Proposal) => {
        try {
            const { id, ...rest } = proposal;
            await ProposalService.create({
                ...rest,
                nome: `${rest.nome} (Cópia)`,
                status: 'rascunho',
                geradaEm: new Date(),
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            fetchData();
        } catch (error) {
            console.error(error);
            alert('Erro ao duplicar proposta.');
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Tem certeza que deseja excluir esta proposta? Esta ação não pode ser desfeita.')) return;
        try {
            await ProposalService.delete(id);
            if (selectedProposal?.id === id) setSelectedProposal(null);
            fetchData();
        } catch (error) {
            console.error(error);
            alert('Erro ao excluir proposta.');
        }
    };

    const handleStatusChange = async (proposal: Proposal, newStatus: Proposal['status']) => {
        if (!confirm(`Deseja alterar o status para "${STATUS_CONFIG[newStatus].label}"?`)) return;
        if (!proposal.id) return;

        const oldStatus = STATUS_CONFIG[proposal.status]?.label || proposal.status;
        const newStatusLabel = STATUS_CONFIG[newStatus].label;
        const currentUser = companySettings?.responsibleName || 'Usuário Sistema';

        try {
            // Update Proposal
            const updates: Partial<Proposal> = {
                status: newStatus,
                updatedAt: new Date(),
            };
            if (newStatus === 'revisada') updates.revisadaEm = new Date();
            if (newStatus === 'aprovada') updates.aprovadaEm = new Date();
            if (newStatus === 'emitida') updates.emitidaEm = new Date();

            await ProposalService.update(proposal.id, updates);

            // Log change
            await ChangeLogService.create({
                proposalId: proposal.id,
                action: 'status_change',
                description: `Status alterado de "${oldStatus}" para "${newStatusLabel}"`,
                oldValue: proposal.status,
                newValue: newStatus,
                user: currentUser,
                timestamp: new Date()
            });

            // Refresh selected proposal
            const updated = await ProposalService.getById(proposal.id);
            setSelectedProposal(updated);
            fetchData();
            fetchLogs();
        } catch (error) {
            console.error(error);
            alert('Erro ao atualizar status.');
        }
    };

    const handleUpdateProposal = async () => {
        if (!selectedProposal || !selectedProposal.id) return;

        const changes: string[] = [];
        if (editData.nome !== selectedProposal.nome) changes.push('Nome');
        if (editData.termosRessalvas !== selectedProposal.termosRessalvas) changes.push('Termos e Ressalvas');

        if (changes.length === 0) {
            setIsEditing(false);
            return;
        }

        try {
            await ProposalService.update(selectedProposal.id, {
                nome: editData.nome,
                termosRessalvas: editData.termosRessalvas,
                updatedAt: new Date()
            });

            await ChangeLogService.create({
                proposalId: selectedProposal.id,
                action: 'update',
                description: `Alteração técnica: ${changes.join(', ')}`,
                user: companySettings?.responsibleName || 'Sistema',
                timestamp: new Date()
            });

            const updated = await ProposalService.getById(selectedProposal.id);
            setSelectedProposal(updated);
            setIsEditing(false);
            fetchData();
            fetchLogs();
        } catch (error) {
            console.error(error);
            alert('Erro ao atualizar proposta.');
        }
    };

    const handleOpenDetails = (proposal: Proposal) => {
        setSelectedProposal(proposal);
        setEditData({ nome: proposal.nome, termosRessalvas: proposal.termosRessalvas });
        setIsEditing(false);
        setViewModalOpen(true);
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-gradient-to-br from-indigo-500 to-indigo-700 rounded-2xl flex items-center justify-center shadow-lg">
                        <FileText className="text-white" size={28} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-primary">Propostas</h1>
                        <p className="text-secondary text-sm">Geração e gestão de propostas técnicas e comerciais</p>
                    </div>
                </div>
                <button
                    onClick={() => setShowNewModal(true)}
                    className="bg-indigo-600 text-white px-5 py-3 rounded-xl flex items-center gap-2 font-semibold shadow-md hover:bg-indigo-700"
                >
                    <Plus size={18} />
                    Gerar Proposta
                </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                    <p className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Total</p>
                    <p className="text-2xl font-bold text-primary">{totalProposals || 0}</p>
                </div>
                {Object.entries(STATUS_CONFIG).filter(([k]) => k !== 'gerada').map(([key, { label }]) => (
                    <div key={key} className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                        <p className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">{label}</p>
                        <p className="text-2xl font-bold text-primary">
                            {proposals?.filter(p => p.status === key).length || 0}
                        </p>
                    </div>
                ))}
            </div>

            {/* Filters & Search */}
            <div className="flex flex-col md:flex-row gap-4">
                <div className="relative flex-1">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                        type="text"
                        placeholder="Buscar por nome, cliente ou orçamento..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:border-indigo-400 outline-none text-sm"
                    />
                </div>
                <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 min-w-[140px]"
                >
                    <option value="">Todos os Status</option>
                    {Object.entries(STATUS_CONFIG).map(([key, { label }]) => (
                        <option key={key} value={key}>{label}</option>
                    ))}
                </select>
            </div>

            {/* Proposals Table */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-[10px] uppercase text-slate-500 font-bold tracking-wider">
                            <tr>
                                <th className="p-4">Proposta</th>
                                <th className="p-4">Orçamento Vinculado</th>
                                <th className="p-4">Cliente</th>
                                <th className="p-4 text-right">Valor Total</th>
                                <th className="p-4 text-center">Data</th>
                                <th className="p-4 text-center">Status</th>
                                <th className="p-4 text-center">Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading ? (
                                <tr>
                                    <td colSpan={7} className="p-12 text-center text-slate-400">Carregando propostas...</td>
                                </tr>
                            ) : proposals.map((proposal) => {
                                const StatusIcon = STATUS_CONFIG[proposal.status]?.icon || FileText;
                                const config = STATUS_CONFIG[proposal.status] || STATUS_CONFIG['rascunho'];
                                return (
                                    <tr key={proposal.id} className="border-t border-slate-100 hover:bg-slate-50 transition-colors">
                                        <td className="p-4">
                                            <p className="font-bold text-slate-700">{proposal.nome}</p>
                                            <p className="text-[10px] text-slate-400 mt-0.5">
                                                {proposal.tipoOrcamento === 'analitico' ? 'Analítico' : 'Sintético'}
                                            </p>
                                        </td>
                                        <td className="p-4">
                                            <button
                                                onClick={() => navigate(`/budgets/${proposal.budgetId}`)}
                                                className="flex items-center gap-2 text-indigo-600 hover:text-indigo-800"
                                            >
                                                <FileSpreadsheet size={14} />
                                                <span className="font-medium">{proposal.budgetName}</span>
                                            </button>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex items-center gap-2 text-slate-600">
                                                <Building2 size={14} className="text-slate-400" />
                                                <span>{proposal.clientName}</span>
                                            </div>
                                        </td>
                                        <td className="p-4 text-right font-mono font-bold text-slate-700">
                                            {formatCurrency(proposal.valorTotal)}
                                        </td>
                                        <td className="p-4 text-center text-slate-500 text-xs">
                                            {format(new Date(proposal.geradaEm), "dd/MM/yyyy", { locale: ptBR })}
                                        </td>
                                        <td className="p-4 text-center">
                                            <span className={clsx(
                                                "inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded uppercase",
                                                config.color
                                            )}>
                                                <StatusIcon size={12} />
                                                {config.label}
                                            </span>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex items-center justify-center gap-1">
                                                <button
                                                    onClick={() => handleDownloadPDF(proposal)}
                                                    className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded-lg"
                                                    title="Baixar PDF"
                                                >
                                                    <Download size={16} />
                                                </button>
                                                <button
                                                    onClick={() => handleOpenDetails(proposal)}
                                                    className="p-2 text-slate-400 hover:text-blue-600 hover:bg-slate-100 rounded-lg"
                                                    title="Ver Detalhes e Status"
                                                >
                                                    <Eye size={16} />
                                                </button>
                                                <button
                                                    onClick={() => handleDuplicate(proposal)}
                                                    className="p-2 text-slate-400 hover:text-amber-600 hover:bg-slate-100 rounded-lg"
                                                    title="Duplicar"
                                                >
                                                    <Copy size={16} />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(proposal.id!)}
                                                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-slate-100 rounded-lg"
                                                    title="Excluir"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            {!isLoading && proposals.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="p-12 text-center text-slate-400">
                                        <FileText size={32} className="mx-auto mb-3 opacity-30" />
                                        <p className="font-medium">Nenhuma proposta encontrada</p>
                                        <p className="text-xs mt-1">Clique em "Gerar Proposta" para criar uma nova</p>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Aviso de Compliance */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-start gap-3">
                <AlertTriangle size={18} className="text-slate-400 shrink-0 mt-0.5" />
                <p className="text-xs text-slate-500">
                    <strong>Aviso:</strong> As propostas geradas são baseadas em dados informados pelo usuário e referências oficiais.
                    Não substituem análise técnica, jurídica ou editalícia específica.
                    O sistema não garante habilitação ou vitória em processos licitatórios.
                </p>
            </div>

            {/* Modal de Nova Proposta */}
            {
                showNewModal && (
                    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
                            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-indigo-600 text-white">
                                <div>
                                    <h3 className="text-xl font-bold">Gerar Nova Proposta</h3>
                                    <p className="text-indigo-200 text-sm">Etapa {step} de 3</p>
                                </div>
                                <button onClick={() => { setShowNewModal(false); resetForm(); }} className="p-2 hover:bg-white/20 rounded-lg">
                                    <X size={24} />
                                </button>
                            </div>

                            <div className="p-6 overflow-y-auto flex-1">
                                {/* Step 1: Selecionar Orçamento */}
                                {step === 1 && (
                                    <div className="space-y-4">
                                        <div>
                                            <h4 className="font-bold text-slate-700 mb-1">Selecione o Orçamento</h4>
                                            <p className="text-sm text-slate-500">Escolha o orçamento que será base para a proposta</p>
                                        </div>
                                        <div className="space-y-2 max-h-[400px] overflow-y-auto">
                                            {budgets.filter(b => !b.isTemplate && !b.isScenario).map((budget) => (
                                                <button
                                                    key={budget.id}
                                                    onClick={() => {
                                                        setSelectedBudgetId(budget.id!);
                                                        setFormData(prev => ({ ...prev, nome: `Proposta - ${budget.name}` }));
                                                    }}
                                                    className={clsx(
                                                        "w-full p-4 border rounded-xl text-left transition-all",
                                                        selectedBudgetId === budget.id
                                                            ? "border-indigo-500 bg-indigo-50"
                                                            : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                                                    )}
                                                >
                                                    <div className="flex items-center justify-between">
                                                        <div>
                                                            <p className="font-bold text-slate-700">{budget.name}</p>
                                                            <p className="text-xs text-slate-400 mt-0.5">{budget.client}</p>
                                                        </div>
                                                        <div className="text-right">
                                                            <p className="font-mono font-bold text-slate-700">
                                                                {formatCurrency(budget.totalValue * (1 + (budget.bdi || 0) / 100))}
                                                            </p>
                                                            <span className={clsx(
                                                                "text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
                                                                budget.status === 'approved' && "bg-green-100 text-green-700",
                                                                budget.status === 'pending' && "bg-amber-100 text-amber-700",
                                                                budget.status === 'draft' && "bg-slate-100 text-slate-500"
                                                            )}>
                                                                {budget.status === 'approved' ? 'Aprovado' : budget.status === 'pending' ? 'Pendente' : 'Rascunho'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </button>
                                            ))}
                                            {(budgets.filter(b => !b.isTemplate && !b.isScenario).length === 0) && (
                                                <div className="p-8 text-center text-slate-400 border border-dashed border-slate-200 rounded-xl">
                                                    <FileSpreadsheet size={32} className="mx-auto mb-2 opacity-30" />
                                                    <p>Nenhum orçamento disponível</p>
                                                    <button
                                                        onClick={() => navigate('/budgets')}
                                                        className="text-indigo-600 text-sm font-medium mt-2"
                                                    >
                                                        Criar orçamento
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Step 2: Selecionar Cliente (opcional) e Configurações */}
                                {step === 2 && (
                                    <div className="space-y-6">
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nome da Proposta</label>
                                            <input
                                                type="text"
                                                value={formData.nome}
                                                onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                                                className="w-full p-3 border border-slate-200 rounded-xl text-sm"
                                                placeholder="Ex: Proposta Técnica - Obra XYZ"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Cliente (Opcional)</label>
                                            <div className="grid grid-cols-2 gap-2 max-h-[200px] overflow-y-auto">
                                                <button
                                                    onClick={() => setSelectedClientId(null)}
                                                    className={clsx(
                                                        "p-3 border rounded-xl text-left text-sm",
                                                        selectedClientId === null
                                                            ? "border-indigo-500 bg-indigo-50"
                                                            : "border-slate-200 hover:bg-slate-50"
                                                    )}
                                                >
                                                    Usar cliente do orçamento
                                                </button>
                                                {clients?.map((client) => (
                                                    <button
                                                        key={client.id}
                                                        onClick={() => setSelectedClientId(client.id!)}
                                                        className={clsx(
                                                            "p-3 border rounded-xl text-left",
                                                            selectedClientId === client.id
                                                                ? "border-indigo-500 bg-indigo-50"
                                                                : "border-slate-200 hover:bg-slate-50"
                                                        )}
                                                    >
                                                        <p className="font-medium text-sm text-slate-700 truncate">{client.nome}</p>
                                                        <p className="text-[10px] text-slate-400">{client.tipoCliente === 'publico' ? 'Público' : 'Privado'}</p>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tipo de Orçamento</label>
                                                <select
                                                    value={formData.tipoOrcamento}
                                                    onChange={(e) => setFormData({ ...formData, tipoOrcamento: e.target.value as any })}
                                                    className="w-full p-3 border border-slate-200 rounded-xl text-sm"
                                                >
                                                    <option value="sintetico">Sintético (Resumido)</option>
                                                    <option value="analitico">Analítico (Detalhado)</option>
                                                </select>
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Anexos (quando disponíveis)</label>
                                            <div className="space-y-2">
                                                <label className="flex items-center gap-3 p-3 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50">
                                                    <input
                                                        type="checkbox"
                                                        checked={formData.incluiCurvaABC}
                                                        onChange={(e) => setFormData({ ...formData, incluiCurvaABC: e.target.checked })}
                                                        className="w-4 h-4 rounded border-slate-300"
                                                    />
                                                    <span className="text-sm text-slate-700">Incluir Curva ABC</span>
                                                </label>
                                                <label className="flex items-center gap-3 p-3 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50">
                                                    <input
                                                        type="checkbox"
                                                        checked={formData.incluiMemorialCalculo}
                                                        onChange={(e) => setFormData({ ...formData, incluiMemorialCalculo: e.target.checked })}
                                                        className="w-4 h-4 rounded border-slate-300"
                                                    />
                                                    <span className="text-sm text-slate-700">Incluir Memorial de Cálculo</span>
                                                </label>
                                                <label className="flex items-center gap-3 p-3 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50">
                                                    <input
                                                        type="checkbox"
                                                        checked={formData.incluiCronograma}
                                                        onChange={(e) => setFormData({ ...formData, incluiCronograma: e.target.checked })}
                                                        className="w-4 h-4 rounded border-slate-300"
                                                    />
                                                    <span className="text-sm text-slate-700">Incluir Cronograma Físico-Financeiro</span>
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Step 3: Confirmar Dados da Empresa */}
                                {step === 3 && (
                                    <div className="space-y-6">
                                        <div className="bg-slate-50 rounded-xl p-4">
                                            <h4 className="font-bold text-slate-700 mb-3 flex items-center gap-2">
                                                <Settings size={16} />
                                                Dados da Empresa
                                            </h4>
                                            {companySettings ? (
                                                <div className="grid grid-cols-2 gap-4 text-sm">
                                                    <div>
                                                        <p className="text-slate-400 text-[10px] uppercase">Razão Social</p>
                                                        <p className="font-medium text-slate-700">{companySettings.name || 'Não informado'}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-slate-400 text-[10px] uppercase">CNPJ</p>
                                                        <p className="font-mono text-slate-700">{companySettings.cnpj || 'Não informado'}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-slate-400 text-[10px] uppercase">Responsável Técnico</p>
                                                        <p className="font-medium text-slate-700">{companySettings.responsibleName || 'Não informado'}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-slate-400 text-[10px] uppercase">CREA/CAU</p>
                                                        <p className="font-mono text-slate-700">{companySettings.responsibleCrea || 'Não informado'}</p>
                                                    </div>
                                                    {companySettings.logo && (
                                                        <div className="col-span-2">
                                                            <p className="text-slate-400 text-[10px] uppercase mb-2">Logomarca</p>
                                                            <img src={companySettings.logo} alt="Logo" className="h-16 object-contain" />
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <div className="text-center py-4">
                                                    <p className="text-slate-400 text-sm">Dados da empresa não configurados</p>
                                                    <button
                                                        onClick={() => navigate('/settings')}
                                                        className="text-indigo-600 font-medium text-sm mt-2"
                                                    >
                                                        Configurar agora
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Termos e Ressalvas</label>
                                            <textarea
                                                value={formData.termosRessalvas}
                                                onChange={(e) => setFormData({ ...formData, termosRessalvas: e.target.value })}
                                                className="w-full p-3 border border-slate-200 rounded-xl text-sm font-mono"
                                                rows={6}
                                            />
                                        </div>

                                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                                            <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                                            <div className="text-sm text-amber-700">
                                                <p className="font-bold">Aviso Legal</p>
                                                <p className="text-xs mt-1">
                                                    Documento gerado com base em dados informados pelo usuário e referências oficiais.
                                                    Não substitui análise técnica, jurídica ou editalícia.
                                                </p>
                                            </div>
                                        </div>

                                        {/* Resumo */}
                                        <div className="bg-indigo-50 rounded-xl p-4">
                                            <h4 className="font-bold text-indigo-700 mb-3">Resumo da Proposta</h4>
                                            <div className="grid grid-cols-2 gap-4 text-sm">
                                                <div>
                                                    <p className="text-indigo-400 text-[10px] uppercase">Orçamento</p>
                                                    <p className="font-medium text-indigo-800">{selectedBudget?.name}</p>
                                                </div>
                                                <div>
                                                    <p className="text-indigo-400 text-[10px] uppercase">Cliente</p>
                                                    <p className="font-medium text-indigo-800">{selectedClient?.nome || selectedBudget?.client || 'Não informado'}</p>
                                                </div>
                                                <div>
                                                    <p className="text-indigo-400 text-[10px] uppercase">Tipo</p>
                                                    <p className="font-medium text-indigo-800">{formData.tipoOrcamento === 'analitico' ? 'Analítico' : 'Sintético'}</p>
                                                </div>
                                                <div>
                                                    <p className="text-indigo-400 text-[10px] uppercase">Valor Estimado</p>
                                                    <p className="font-mono font-bold text-indigo-800">
                                                        {selectedBudget && formatCurrency(selectedBudget.totalValue * (1 + (selectedBudget.bdi || 0) / 100))}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-between items-center">
                                <div>
                                    {step > 1 && (
                                        <button
                                            onClick={() => setStep(step - 1)}
                                            className="px-6 py-3 font-medium text-slate-500 hover:text-slate-700"
                                        >
                                            Voltar
                                        </button>
                                    )}
                                </div>
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => { setShowNewModal(false); resetForm(); }}
                                        className="px-6 py-3 font-medium text-slate-500 hover:text-slate-700"
                                    >
                                        Cancelar
                                    </button>
                                    {step < 3 ? (
                                        <button
                                            onClick={() => setStep(step + 1)}
                                            disabled={step === 1 && !selectedBudgetId}
                                            className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-indigo-700 shadow-md flex items-center gap-2 disabled:opacity-50"
                                        >
                                            Próximo
                                            <ChevronRight size={18} />
                                        </button>
                                    ) : (
                                        <button
                                            onClick={handleGenerateProposal}
                                            disabled={!companySettings}
                                            className="bg-green-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-green-700 shadow-md flex items-center gap-2 disabled:opacity-50"
                                        >
                                            <FileText size={18} />
                                            Gerar Proposta
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }
            {/* Modal de Detalhes e Workflow */}
            {
                viewModalOpen && selectedProposal && (
                    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
                            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-white">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className={clsx("px-2 py-0.5 rounded text-[10px] font-black uppercase flex items-center gap-1", STATUS_CONFIG[selectedProposal.status]?.color || 'bg-slate-100')}>
                                            {STATUS_CONFIG[selectedProposal.status]?.icon && <span className="w-3 h-3"><StatusIconWrapper icon={STATUS_CONFIG[selectedProposal.status].icon} /></span>}
                                            {STATUS_CONFIG[selectedProposal.status]?.label}
                                        </span>
                                        <span className="text-slate-400 text-xs">#{selectedProposal.id}</span>
                                    </div>
                                    {isEditing ? (
                                        <input
                                            type="text"
                                            value={editData.nome}
                                            onChange={(e) => setEditData({ ...editData, nome: e.target.value })}
                                            className="text-xl font-bold text-slate-800 border-b border-indigo-300 outline-none w-full bg-indigo-50/30 px-2 rounded"
                                        />
                                    ) : (
                                        <h3 className="text-xl font-bold text-slate-800">{selectedProposal.nome}</h3>
                                    )}
                                </div>
                                <button onClick={() => setViewModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400">
                                    <X size={24} />
                                </button>
                            </div>

                            {/* Tabs */}
                            <div className="flex border-b border-slate-100 px-6">
                                <button
                                    onClick={() => setViewTab('details')}
                                    className={clsx("px-4 py-3 text-sm font-bold border-b-2 transition-colors flex items-center gap-2", viewTab === 'details' ? "border-indigo-600 text-indigo-600" : "border-transparent text-slate-500 hover:text-slate-700")}
                                >
                                    <FileText size={16} /> Detalhes & Workflow
                                </button>
                                <button
                                    onClick={() => setViewTab('history')}
                                    className={clsx("px-4 py-3 text-sm font-bold border-b-2 transition-colors flex items-center gap-2", viewTab === 'history' ? "border-indigo-600 text-indigo-600" : "border-transparent text-slate-500 hover:text-slate-700")}
                                >
                                    <History size={16} /> Histórico de Auditoria
                                </button>
                            </div>

                            <div className="p-6 overflow-y-auto flex-1 bg-slate-50/50">
                                {viewTab === 'details' ? (
                                    <div className="space-y-6">
                                        {/* Workflow Actions */}
                                        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                                            <h4 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                                                <Settings size={18} className="text-slate-400" />
                                                Controle de Status
                                            </h4>
                                            <div className="flex flex-wrap gap-2">
                                                {(selectedProposal.status === 'rascunho' || (selectedProposal.status as string) === 'gerada') && (
                                                    <button onClick={() => handleStatusChange(selectedProposal!, 'em_revisao')} className="px-4 py-2 bg-amber-100 text-amber-700 rounded-lg font-bold text-sm hover:bg-amber-200 flex items-center gap-2">
                                                        <Clock size={16} /> Enviar para Revisão
                                                    </button>
                                                )}
                                                {(selectedProposal.status === 'em_revisao' || selectedProposal.status === 'rascunho') && (
                                                    <button onClick={() => handleStatusChange(selectedProposal!, 'revisada')} className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg font-bold text-sm hover:bg-blue-200 flex items-center gap-2">
                                                        <CheckCircle2 size={16} /> Marcar como Revisada
                                                    </button>
                                                )}
                                                {selectedProposal.status === 'revisada' && (
                                                    <button onClick={() => handleStatusChange(selectedProposal!, 'aprovada')} className="px-4 py-2 bg-green-100 text-green-700 rounded-lg font-bold text-sm hover:bg-green-200 flex items-center gap-2">
                                                        <Shield size={16} /> Aprovar Proposta
                                                    </button>
                                                )}
                                                {selectedProposal.status === 'aprovada' && (
                                                    <button onClick={() => handleStatusChange(selectedProposal!, 'emitida')} className="px-4 py-2 bg-purple-100 text-purple-700 rounded-lg font-bold text-sm hover:bg-purple-200 flex items-center gap-2">
                                                        <Lock size={16} /> Emitir Final (Travar)
                                                    </button>
                                                )}
                                                {selectedProposal.status !== 'rascunho' && selectedProposal.status !== 'emitida' && (
                                                    <button onClick={() => handleStatusChange(selectedProposal!, 'rascunho')} className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg font-bold text-sm hover:bg-slate-50 flex items-center gap-2">
                                                        <Edit3 size={16} /> Retornar ao Rascunho
                                                    </button>
                                                )}
                                            </div>
                                            <p className="text-xs text-slate-400 mt-3">
                                                * A alteração de status gera um registro inalterável no histórico de auditoria.
                                            </p>
                                        </div>

                                        {/* Terms and Annotations */}
                                        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                                            <div className="flex justify-between items-center mb-4">
                                                <h4 className="font-bold text-slate-800">Termos e Ressalvas</h4>
                                                {(selectedProposal.status === 'rascunho' || selectedProposal.status === 'em_revisao') && !isEditing && (
                                                    <button
                                                        onClick={() => setIsEditing(true)}
                                                        className="text-indigo-600 font-bold text-xs flex items-center gap-1 hover:text-indigo-800"
                                                    >
                                                        <Edit3 size={14} /> Editar Conteúdo
                                                    </button>
                                                )}
                                            </div>
                                            {isEditing ? (
                                                <textarea
                                                    value={editData.termosRessalvas}
                                                    onChange={(e) => setEditData({ ...editData, termosRessalvas: e.target.value })}
                                                    className="w-full p-3 border border-indigo-200 rounded-xl text-sm font-mono min-h-[200px] outline-none focus:ring-2 focus:ring-indigo-100"
                                                />
                                            ) : (
                                                <div className="p-4 bg-slate-50 rounded-xl text-sm text-slate-600 whitespace-pre-wrap font-mono">
                                                    {selectedProposal.termosRessalvas}
                                                </div>
                                            )}
                                            {isEditing && (
                                                <div className="flex justify-end gap-2 mt-4">
                                                    <button onClick={() => setIsEditing(false)} className="px-4 py-2 text-slate-500 font-bold text-xs hover:bg-slate-50 rounded-lg">Cancelar</button>
                                                    <button onClick={handleUpdateProposal} className="px-4 py-2 bg-indigo-600 text-white font-bold text-xs rounded-lg hover:bg-indigo-700">Salvar Alterações</button>
                                                </div>
                                            )}
                                        </div>

                                        {/* Info Cards */}
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="bg-white p-4 rounded-xl border border-slate-200">
                                                <p className="text-xs font-bold text-slate-400 uppercase">Orçamento Base</p>
                                                <p className="font-semibold text-slate-700 mt-1">{selectedProposal.budgetName}</p>
                                                <p className="text-xs text-slate-500">{formatCurrency(selectedProposal.valorTotal)}</p>
                                            </div>
                                            <div className="bg-white p-4 rounded-xl border border-slate-200">
                                                <p className="text-xs font-bold text-slate-400 uppercase">Cliente</p>
                                                <p className="font-semibold text-slate-700 mt-1">{selectedProposal.clientName}</p>
                                            </div>
                                            <div className="bg-white p-4 rounded-xl border border-slate-200">
                                                <p className="text-xs font-bold text-slate-400 uppercase">Empresa Responsável</p>
                                                <p className="font-semibold text-slate-700 mt-1">{selectedProposal.empresaNome}</p>
                                                <p className="text-xs text-slate-500">Resp: {selectedProposal.responsavelNome}</p>
                                            </div>
                                            <div className="bg-white p-4 rounded-xl border border-slate-200">
                                                <p className="text-xs font-bold text-slate-400 uppercase">Configurações</p>
                                                <div className="flex gap-2 mt-1 flex-wrap">
                                                    {selectedProposal.incluiCurvaABC && <span className="bg-slate-100 text-slate-600 text-[10px] px-1.5 py-0.5 rounded font-bold">ABC</span>}
                                                    {selectedProposal.incluiMemorialCalculo && <span className="bg-slate-100 text-slate-600 text-[10px] px-1.5 py-0.5 rounded font-bold">Memorial</span>}
                                                    {selectedProposal.incluiCronograma && <span className="bg-slate-100 text-slate-600 text-[10px] px-1.5 py-0.5 rounded font-bold">Cronograma</span>}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-2 p-3 bg-blue-50 text-blue-800 rounded-lg text-sm border border-blue-100">
                                            <Info size={16} className="shrink-0" />
                                            Histórico gerado automaticamente para fins de rastreabilidade técnica.
                                        </div>

                                        <div className="relative border-l-2 border-slate-200 ml-3 space-y-6 py-2">
                                            {logs?.map((log) => (
                                                <div key={log.id} className="relative pl-6">
                                                    <div className={clsx(
                                                        "absolute -left-[9px] top-0 w-4 h-4 rounded-full border-2 bg-white",
                                                        log.action === 'status_change' ? "border-blue-500" : "border-slate-300"
                                                    )}></div>
                                                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                                                        <div className="flex justify-between items-start mb-2">
                                                            <span className="font-bold text-slate-700 text-sm">{log.description}</span>
                                                            <span className="text-[10px] text-slate-400">
                                                                {format(new Date(log.timestamp), "dd/MM/yyyy HH:mm")}
                                                            </span>
                                                        </div>

                                                        {log.action === 'status_change' && (
                                                            <div className="flex items-center gap-2 text-xs mb-2">
                                                                <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded line-through">{STATUS_CONFIG[log.oldValue as string]?.label || log.oldValue}</span>
                                                                <ChevronRight size={12} className="text-slate-400" />
                                                                <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded font-bold">{STATUS_CONFIG[log.newValue as string]?.label || log.newValue}</span>
                                                            </div>
                                                        )}

                                                        <div className="pt-2 border-t border-slate-50 flex justify-between items-center mt-2">
                                                            <span className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1">
                                                                <Shield size={10} />
                                                                {log.user || 'Sistema'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                            {(!logs || logs.length === 0) && (
                                                <p className="text-slate-400 text-sm pl-6 italic">Nenhum registro encontrado.</p>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="p-4 border-t border-slate-100 bg-white flex justify-end gap-3">
                                <button
                                    onClick={() => handleDownloadPDF(selectedProposal)}
                                    className="px-4 py-2 border border-slate-200 text-slate-700 font-bold rounded-lg hover:bg-slate-50 flex items-center gap-2 text-sm"
                                >
                                    <Download size={16} /> Baixar PDF
                                </button>
                                {selectedProposal.status === 'emitida' && (
                                    <button
                                        disabled
                                        className="px-4 py-2 bg-slate-100 text-slate-400 font-bold rounded-lg flex items-center gap-2 text-sm cursor-not-allowed"
                                    >
                                        <Lock size={16} /> Proposta Emitida
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
};

// Helper component for dynamic icons
const StatusIconWrapper = ({ icon: Icon }: { icon: any }) => <Icon size="100%" />;

export default Proposals;
