import { useState, useEffect, useMemo } from 'react';
import { ClientService } from '../lib/supabase-services/ClientService';
import { BudgetService } from '../lib/supabase-services/BudgetService';
import { type Client, type Budget } from '../types/domain';
import { Building2, User, Search, Plus, X, Edit3, Trash2, FileSpreadsheet, MapPin, Phone, Mail, CheckCircle, XCircle, ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';
import { useNavigate } from 'react-router-dom';

const UF_LIST = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

const OBRA_LABELS: Record<string, string> = {
    predial: 'Predial',
    saneamento: 'Saneamento',
    pavimentacao: 'Pavimentação',
    reforma: 'Reforma',
    outro: 'Outro',
};

const Clients = () => {
    const navigate = useNavigate();
    const [searchTerm, setSearchTerm] = useState('');
    const [filterTipo, setFilterTipo] = useState<string>('');
    const [filterAtivo, setFilterAtivo] = useState<string>('');
    const [showModal, setShowModal] = useState(false);
    const [editingClient, setEditingClient] = useState<Client | null>(null);
    const [selectedClient, setSelectedClient] = useState<Client | null>(null);
    const [allClients, setAllClients] = useState<Client[]>([]);
    const [linkedBudgets, setLinkedBudgets] = useState<Budget[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Form state
    const [formData, setFormData] = useState<Partial<Client>>({
        nome: '',
        documento: '',
        tipoDocumento: 'cnpj',
        tipoCliente: 'publico',
        orgao: '',
        endereco: '',
        cidade: '',
        uf: '',
        responsavel: '',
        telefone: '',
        email: '',
        obraPredominante: undefined,
        isAtivo: true,
        observacoes: '',
    });

    // Fetch clients
    const fetchClients = async () => {
        try {
            const data = await ClientService.getAll();
            setAllClients(data);
        } catch (error) {
            console.error('Error fetching clients:', error);
            alert('Erro ao carregar clientes.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchClients();
    }, []);

    // Filter clients
    const filteredClients = useMemo(() => {
        let results = [...allClients];

        if (filterTipo) {
            results = results.filter(c => c.tipoCliente === filterTipo);
        }

        if (filterAtivo === 'ativo') {
            results = results.filter(c => c.isAtivo);
        } else if (filterAtivo === 'inativo') {
            results = results.filter(c => !c.isAtivo);
        }

        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            results = results.filter(c =>
                c.nome.toLowerCase().includes(term) ||
                c.documento.includes(term) ||
                (c.orgao && c.orgao.toLowerCase().includes(term))
            );
        }

        return results.sort((a, b) => a.nome.localeCompare(b.nome));
    }, [allClients, searchTerm, filterTipo, filterAtivo]);

    // Query linked budgets
    useEffect(() => {
        const fetchLinkedBudgets = async () => {
            if (!selectedClient) {
                setLinkedBudgets([]);
                return;
            }
            try {
                // Fetch all for now, optimize later with filter at service level if needed
                const allBudgets = await BudgetService.getAll();
                const related = allBudgets.filter(b => b.client === selectedClient.nome);
                setLinkedBudgets(related);
            } catch (error) {
                console.error('Error fetching linked budgets:', error);
            }
        };

        fetchLinkedBudgets();
    }, [selectedClient]);

    const totalClients = allClients.length;
    const activeClients = allClients.filter(c => c.isAtivo).length;

    const formatDocument = (doc: string, tipo: 'cpf' | 'cnpj') => {
        const numbers = doc.replace(/\D/g, '');
        if (tipo === 'cpf') {
            return numbers.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
        }
        return numbers.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    };

    const handleSave = async () => {
        if (!formData.nome || !formData.documento) {
            alert('Preencha pelo menos Nome/Razão Social e CPF/CNPJ.');
            return;
        }

        try {
            if (editingClient?.id) {
                await ClientService.update(editingClient.id, {
                    ...formData,
                    updatedAt: new Date(),
                });
            } else {
                await ClientService.create({
                    ...formData,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                });
            }
            setShowModal(false);
            resetForm();
            fetchClients();
        } catch (error) {
            console.error(error);
            alert('Erro ao salvar cliente.');
        }
    };

    const handleEdit = (client: Client) => {
        setEditingClient(client);
        setFormData(client);
        setShowModal(true);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Tem certeza que deseja excluir este cliente?')) return;
        try {
            await ClientService.delete(id);
            if (selectedClient?.id === id) setSelectedClient(null);
            fetchClients();
        } catch (error) {
            console.error(error);
            alert('Erro ao excluir cliente.');
        }
    };

    const handleNew = () => {
        resetForm();
        setEditingClient(null);
        setShowModal(true);
    };

    const resetForm = () => {
        setFormData({
            nome: '',
            documento: '',
            tipoDocumento: 'cnpj',
            tipoCliente: 'publico',
            orgao: '',
            endereco: '',
            cidade: '',
            uf: '',
            responsavel: '',
            telefone: '',
            email: '',
            obraPredominante: undefined,
            isAtivo: true,
            observacoes: '',
        });
    };

    const toggleAtivo = async (client: Client) => {
        if (!client.id) return;
        try {
            await ClientService.update(client.id, { isAtivo: !client.isAtivo, updatedAt: new Date() });
            fetchClients();
            // Also update selected client state if it's the same
            if (selectedClient?.id === client.id) {
                setSelectedClient({ ...client, isAtivo: !client.isAtivo });
            }
        } catch (error) {
            console.error(error);
            alert('Erro ao atualizar status do cliente.');
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-gradient-to-br from-slate-600 to-slate-800 rounded-2xl flex items-center justify-center shadow-lg">
                        <Building2 className="text-white" size={28} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-primary">Clientes</h1>
                        <p className="text-secondary text-sm">Cadastro de órgãos, entidades e contratantes</p>
                    </div>
                </div>
                <button
                    onClick={handleNew}
                    className="bg-slate-800 text-white px-5 py-3 rounded-xl flex items-center gap-2 font-semibold shadow-md hover:bg-slate-700"
                >
                    <Plus size={18} />
                    Adicionar Cliente
                </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
                <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                    <p className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Total</p>
                    <p className="text-2xl font-bold text-primary">{totalClients || 0}</p>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                    <p className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Ativos</p>
                    <p className="text-2xl font-bold text-green-600">{activeClients || 0}</p>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                    <p className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Inativos</p>
                    <p className="text-2xl font-bold text-slate-400">{(totalClients || 0) - (activeClients || 0)}</p>
                </div>
            </div>

            {/* Filters & Search */}
            <div className="flex flex-col md:flex-row gap-4">
                <div className="relative flex-1">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                        type="text"
                        placeholder="Buscar por nome, documento ou órgão..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:border-slate-400 outline-none text-sm"
                    />
                </div>
                <select
                    value={filterTipo}
                    onChange={(e) => setFilterTipo(e.target.value)}
                    className="px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 min-w-[140px]"
                >
                    <option value="">Todos os Tipos</option>
                    <option value="publico">Público</option>
                    <option value="privado">Privado</option>
                </select>
                <select
                    value={filterAtivo}
                    onChange={(e) => setFilterAtivo(e.target.value)}
                    className="px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 min-w-[120px]"
                >
                    <option value="">Todos</option>
                    <option value="ativo">Ativos</option>
                    <option value="inativo">Inativos</option>
                </select>
            </div>

            {/* Main Content */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Client List */}
                <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                    <div className="divide-y divide-slate-100">
                        {isLoading ? (
                            <div className="p-12 text-center text-slate-400">Carregando clientes...</div>
                        ) : filteredClients.map((client) => (
                            <div
                                key={client.id}
                                onClick={() => setSelectedClient(client)}
                                className={clsx(
                                    "p-4 flex items-center justify-between cursor-pointer transition-colors",
                                    selectedClient?.id === client.id ? "bg-slate-50" : "hover:bg-slate-50/50"
                                )}
                            >
                                <div className="flex items-center gap-4 flex-1 min-w-0">
                                    <div className={clsx(
                                        "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                                        client.tipoCliente === 'publico' ? "bg-blue-50 text-blue-600" : "bg-slate-100 text-slate-600"
                                    )}>
                                        {client.tipoDocumento === 'cnpj' ? <Building2 size={18} /> : <User size={18} />}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <h3 className="font-bold text-slate-700 truncate">{client.nome}</h3>
                                            {!client.isAtivo && (
                                                <span className="text-[10px] font-bold px-1.5 py-0.5 bg-slate-200 text-slate-500 rounded">INATIVO</span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5">
                                            <span className="font-mono">{formatDocument(client.documento, client.tipoDocumento)}</span>
                                            {client.tipoCliente === 'publico' && client.orgao && (
                                                <>
                                                    <span>•</span>
                                                    <span className="truncate">{client.orgao}</span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={clsx(
                                        "text-[10px] font-bold px-2 py-1 rounded uppercase",
                                        client.tipoCliente === 'publico' ? "bg-blue-50 text-blue-600" : "bg-slate-100 text-slate-500"
                                    )}>
                                        {client.tipoCliente}
                                    </span>
                                    <ChevronRight size={16} className="text-slate-300" />
                                </div>
                            </div>
                        ))}
                        {!isLoading && filteredClients.length === 0 && (
                            <div className="p-12 text-center text-slate-400">
                                <Building2 size={32} className="mx-auto mb-3 opacity-30" />
                                <p className="font-medium">Nenhum cliente cadastrado</p>
                                <p className="text-xs mt-1">Clique em "Adicionar Cliente" para começar</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Client Details Panel */}
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                    {selectedClient ? (
                        <div className="flex flex-col h-full">
                            <div className="p-4 border-b border-slate-100 bg-slate-50">
                                <div className="flex items-center justify-between">
                                    <h3 className="font-bold text-slate-700">Detalhes</h3>
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={() => handleEdit(selectedClient)}
                                            className="p-2 text-slate-400 hover:text-blue-600 hover:bg-slate-100 rounded-lg"
                                            title="Editar"
                                        >
                                            <Edit3 size={16} />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(selectedClient.id!)}
                                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-slate-100 rounded-lg"
                                            title="Excluir"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div className="p-4 space-y-4 flex-1 overflow-y-auto">
                                <div>
                                    <p className="text-[10px] uppercase text-slate-400 font-bold">Nome/Razão Social</p>
                                    <p className="font-bold text-slate-700">{selectedClient.nome}</p>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-[10px] uppercase text-slate-400 font-bold">{selectedClient.tipoDocumento === 'cpf' ? 'CPF' : 'CNPJ'}</p>
                                        <p className="font-mono text-sm">{formatDocument(selectedClient.documento, selectedClient.tipoDocumento)}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] uppercase text-slate-400 font-bold">Status</p>
                                        <button
                                            onClick={() => toggleAtivo(selectedClient)}
                                            className={clsx(
                                                "flex items-center gap-1 text-sm font-medium",
                                                selectedClient.isAtivo ? "text-green-600" : "text-slate-400"
                                            )}
                                        >
                                            {selectedClient.isAtivo ? <CheckCircle size={14} /> : <XCircle size={14} />}
                                            {selectedClient.isAtivo ? 'Ativo' : 'Inativo'}
                                        </button>
                                    </div>
                                </div>
                                {selectedClient.tipoCliente === 'publico' && selectedClient.orgao && (
                                    <div>
                                        <p className="text-[10px] uppercase text-slate-400 font-bold">Órgão/Entidade</p>
                                        <p className="text-sm text-slate-600">{selectedClient.orgao}</p>
                                    </div>
                                )}
                                {(selectedClient.endereco || selectedClient.cidade) && (
                                    <div>
                                        <p className="text-[10px] uppercase text-slate-400 font-bold flex items-center gap-1">
                                            <MapPin size={10} /> Endereço
                                        </p>
                                        <p className="text-sm text-slate-600">
                                            {selectedClient.endereco}
                                            {selectedClient.cidade && ` - ${selectedClient.cidade}`}
                                            {selectedClient.uf && `/${selectedClient.uf}`}
                                        </p>
                                    </div>
                                )}
                                {selectedClient.responsavel && (
                                    <div>
                                        <p className="text-[10px] uppercase text-slate-400 font-bold">Responsável/Contato</p>
                                        <p className="text-sm text-slate-600">{selectedClient.responsavel}</p>
                                    </div>
                                )}
                                <div className="grid grid-cols-2 gap-4">
                                    {selectedClient.telefone && (
                                        <div>
                                            <p className="text-[10px] uppercase text-slate-400 font-bold flex items-center gap-1">
                                                <Phone size={10} /> Telefone
                                            </p>
                                            <p className="text-sm text-slate-600">{selectedClient.telefone}</p>
                                        </div>
                                    )}
                                    {selectedClient.email && (
                                        <div>
                                            <p className="text-[10px] uppercase text-slate-400 font-bold flex items-center gap-1">
                                                <Mail size={10} /> E-mail
                                            </p>
                                            <p className="text-sm text-slate-600 truncate">{selectedClient.email}</p>
                                        </div>
                                    )}
                                </div>

                                {/* Orçamentos vinculados */}
                                <div className="pt-4 border-t border-slate-100">
                                    <p className="text-[10px] uppercase text-slate-400 font-bold flex items-center gap-1 mb-2">
                                        <FileSpreadsheet size={12} /> Orçamentos Vinculados
                                    </p>
                                    {linkedBudgets && linkedBudgets.length > 0 ? (
                                        <div className="space-y-2">
                                            {linkedBudgets.map((budget) => (
                                                <button
                                                    key={budget.id}
                                                    onClick={() => navigate(`/budgets/${budget.id}`)}
                                                    className="w-full text-left p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
                                                >
                                                    <p className="font-medium text-sm text-slate-700">{budget.name}</p>
                                                    <div className="flex items-center justify-between mt-1">
                                                        <span className={clsx(
                                                            "text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
                                                            budget.status === 'approved' && "bg-green-100 text-green-700",
                                                            budget.status === 'pending' && "bg-amber-100 text-amber-700",
                                                            budget.status === 'draft' && "bg-slate-100 text-slate-500"
                                                        )}>
                                                            {budget.status === 'approved' ? 'Aprovado' : budget.status === 'pending' ? 'Pendente' : 'Rascunho'}
                                                        </span>
                                                        <span className="text-xs font-mono text-slate-400">
                                                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(budget.totalValue)}
                                                        </span>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-xs text-slate-400 italic">Nenhum orçamento vinculado</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="p-8 text-center text-slate-400">
                            <User size={32} className="mx-auto mb-3 opacity-30" />
                            <p className="text-sm">Selecione um cliente para ver detalhes</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Modal de Edição/Criação */}
            {showModal && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                            <h3 className="text-xl font-bold text-primary">
                                {editingClient ? 'Editar Cliente' : 'Novo Cliente'}
                            </h3>
                            <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600">
                                <X size={24} />
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto flex-1 space-y-4">
                            {/* Tipo de Cliente e Documento */}
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tipo de Cliente</label>
                                    <select
                                        value={formData.tipoCliente}
                                        onChange={(e) => setFormData({ ...formData, tipoCliente: e.target.value as any })}
                                        className="w-full p-3 border border-slate-200 rounded-xl text-sm"
                                    >
                                        <option value="publico">Público</option>
                                        <option value="privado">Privado</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tipo Documento</label>
                                    <select
                                        value={formData.tipoDocumento}
                                        onChange={(e) => setFormData({ ...formData, tipoDocumento: e.target.value as any })}
                                        className="w-full p-3 border border-slate-200 rounded-xl text-sm"
                                    >
                                        <option value="cnpj">CNPJ</option>
                                        <option value="cpf">CPF</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                                        {formData.tipoDocumento === 'cpf' ? 'CPF *' : 'CNPJ *'}
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.documento}
                                        onChange={(e) => setFormData({ ...formData, documento: e.target.value.replace(/\D/g, '') })}
                                        className="w-full p-3 border border-slate-200 rounded-xl text-sm font-mono"
                                        placeholder={formData.tipoDocumento === 'cpf' ? '00000000000' : '00000000000000'}
                                        maxLength={formData.tipoDocumento === 'cpf' ? 11 : 14}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nome/Razão Social *</label>
                                <input
                                    type="text"
                                    value={formData.nome}
                                    onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                                    className="w-full p-3 border border-slate-200 rounded-xl text-sm"
                                    placeholder="Nome completo ou razão social"
                                />
                            </div>

                            {formData.tipoCliente === 'publico' && (
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Órgão/Entidade</label>
                                    <input
                                        type="text"
                                        value={formData.orgao}
                                        onChange={(e) => setFormData({ ...formData, orgao: e.target.value })}
                                        className="w-full p-3 border border-slate-200 rounded-xl text-sm"
                                        placeholder="Ex: Prefeitura Municipal de..."
                                    />
                                </div>
                            )}

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Endereço</label>
                                <input
                                    type="text"
                                    value={formData.endereco}
                                    onChange={(e) => setFormData({ ...formData, endereco: e.target.value })}
                                    className="w-full p-3 border border-slate-200 rounded-xl text-sm"
                                    placeholder="Rua, número, bairro..."
                                />
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                                <div className="col-span-2">
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Cidade</label>
                                    <input
                                        type="text"
                                        value={formData.cidade}
                                        onChange={(e) => setFormData({ ...formData, cidade: e.target.value })}
                                        className="w-full p-3 border border-slate-200 rounded-xl text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">UF</label>
                                    <select
                                        value={formData.uf}
                                        onChange={(e) => setFormData({ ...formData, uf: e.target.value })}
                                        className="w-full p-3 border border-slate-200 rounded-xl text-sm"
                                    >
                                        <option value="">Selecione</option>
                                        {UF_LIST.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Responsável/Contato Técnico</label>
                                    <input
                                        type="text"
                                        value={formData.responsavel}
                                        onChange={(e) => setFormData({ ...formData, responsavel: e.target.value })}
                                        className="w-full p-3 border border-slate-200 rounded-xl text-sm"
                                        placeholder="Nome do responsável"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Obra Predominante</label>
                                    <select
                                        value={formData.obraPredominante || ''}
                                        onChange={(e) => setFormData({ ...formData, obraPredominante: e.target.value as any || undefined })}
                                        className="w-full p-3 border border-slate-200 rounded-xl text-sm"
                                    >
                                        <option value="">Não definido</option>
                                        {Object.entries(OBRA_LABELS).map(([key, label]) => (
                                            <option key={key} value={key}>{label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Telefone</label>
                                    <input
                                        type="text"
                                        value={formData.telefone}
                                        onChange={(e) => setFormData({ ...formData, telefone: e.target.value })}
                                        className="w-full p-3 border border-slate-200 rounded-xl text-sm"
                                        placeholder="(00) 00000-0000"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">E-mail</label>
                                    <input
                                        type="email"
                                        value={formData.email}
                                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                        className="w-full p-3 border border-slate-200 rounded-xl text-sm"
                                        placeholder="email@exemplo.com"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Observações</label>
                                <textarea
                                    value={formData.observacoes}
                                    onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
                                    className="w-full p-3 border border-slate-200 rounded-xl text-sm"
                                    rows={2}
                                    placeholder="Notas internas (opcional)..."
                                />
                            </div>

                            <div className="flex items-center gap-3">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={formData.isAtivo}
                                        onChange={(e) => setFormData({ ...formData, isAtivo: e.target.checked })}
                                        className="w-4 h-4 rounded border-slate-300"
                                    />
                                    <span className="text-sm font-medium text-slate-600">Cliente ativo</span>
                                </label>
                            </div>
                        </div>

                        <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                            <button
                                onClick={() => setShowModal(false)}
                                className="px-6 py-3 font-medium text-slate-500 hover:text-slate-700"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleSave}
                                className="bg-slate-800 text-white px-8 py-3 rounded-xl font-bold hover:bg-slate-700 shadow-md"
                            >
                                Salvar Cliente
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Clients;
