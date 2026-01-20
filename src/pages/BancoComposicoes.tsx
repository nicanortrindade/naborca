import { useState, useEffect } from 'react';
import type { Composicao, ComposicaoItem, Insumo } from '../types/domain';
import { CompositionService } from '../lib/supabase-services/CompositionService';
import { InsumoService } from '../lib/supabase-services/InsumoService';
import { Layers, Search, Trash2, Plus, X, Edit3, AlertTriangle, ChevronDown, ChevronRight, Save, Database, PlusCircle } from 'lucide-react';

const FONTE_LABELS: Record<string, string> = {
    SINAPI: 'SINAPI',
    ORSE: 'ORSE',
    SEINFRA: 'SEINFRA',
    SICRO: 'SICRO',
    PROPRIO: 'Próprio',
};

const BancoComposicoes = () => {
    const [searchTerm, setSearchTerm] = useState('');
    const [filterFonte, setFilterFonte] = useState<string>('');
    const [showModal, setShowModal] = useState(false);
    const [editingComposicao, setEditingComposicao] = useState<Composicao | null>(null);
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

    // Busca de insumos para adicionar
    const [insumoSearch, setInsumoSearch] = useState('');
    const [showInsumoSearch, setShowInsumoSearch] = useState(false);

    // Form state
    const [formData, setFormData] = useState<Partial<Composicao>>({
        codigo: '',
        descricao: '',
        unidade: 'UN',
        fonte: 'PROPRIO',
        custoTotal: 0,
        dataReferencia: new Date(),
        isOficial: false,
        isCustomizada: true,
    });
    const [formItems, setFormItems] = useState<ComposicaoItem[]>([]);

    const [composicoes, setComposicoes] = useState<Composicao[]>([]);
    const [composicaoItems, setComposicaoItems] = useState<Record<string, ComposicaoItem[]>>({});
    const [insumosDisponiveis, setInsumosDisponiveis] = useState<Insumo[]>([]);
    const [totalComposicoes, setTotalComposicoes] = useState(0);
    const [loading, setLoading] = useState(true);

    const fetchComposicoes = async () => {
        setLoading(true);
        try {
            let results = await CompositionService.getAll();
            if (filterFonte) {
                results = results.filter(c => c.fonte === filterFonte);
            }
            if (searchTerm) {
                const term = searchTerm.toLowerCase();
                results = results.filter(c =>
                    c.codigo.toLowerCase().includes(term) ||
                    c.descricao.toLowerCase().includes(term)
                );
            }
            setComposicoes(results.slice(0, 100));
            setTotalComposicoes(results.length);
        } catch (error) {
            console.error('Error fetching composicoes:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchComposicoes();
    }, [searchTerm, filterFonte]);

    useEffect(() => {
        const fetchItems = async () => {
            const allItems: Record<string, ComposicaoItem[]> = { ...composicaoItems };
            for (const id of expandedIds) {
                if (!allItems[id]) {
                    const items = await CompositionService.getItems(id);
                    allItems[id] = items;
                }
            }
            setComposicaoItems(allItems);
        };
        fetchItems();
    }, [expandedIds]);

    useEffect(() => {
        const searchInsumos = async () => {
            if (!insumoSearch || insumoSearch.length < 2) {
                setInsumosDisponiveis([]);
                return;
            }
            try {
                const results = await InsumoService.search(insumoSearch);
                setInsumosDisponiveis(results);
            } catch (error) {
                console.error('Error searching insumos:', error);
            }
        };
        searchInsumos();
    }, [insumoSearch]);

    // Recalcular custo total dos itens
    const calcularCustoTotal = (items: ComposicaoItem[]): number => {
        return items.reduce((sum, item) => sum + (item.coeficiente * item.precoUnitario), 0);
    };

    const handleToggleExpand = (id: string) => {
        const newSet = new Set(expandedIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        setExpandedIds(newSet);
    };

    const handleNew = () => {
        resetForm();
        setEditingComposicao(null);
        setShowModal(true);
    };

    const handleEdit = async (composicao: Composicao) => {
        setEditingComposicao(composicao);
        setFormData(composicao);
        // Carregar itens
        if (composicao.id) {
            const items = await CompositionService.getItems(composicao.id);
            setFormItems(items);
        }
        setShowModal(true);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Tem certeza que deseja excluir esta composição e todos os seus itens?')) return;

        try {
            await CompositionService.delete(id);
            fetchComposicoes();
        } catch (error) {
            console.error(error);
            alert('Erro ao excluir composição.');
        }
    };

    const resetForm = () => {
        setFormData({
            codigo: '',
            descricao: '',
            unidade: 'UN',
            fonte: 'PROPRIO',
            custoTotal: 0,
            dataReferencia: new Date(),
            isOficial: false,
            isCustomizada: true,
        });
        setFormItems([]);
    };

    const handleAddInsumo = (insumo: Insumo) => {
        // Verificar se já existe
        if (formItems.some(item => item.insumoId === insumo.id)) {
            alert('Este insumo já foi adicionado à composição.');
            return;
        }

        const newItem: ComposicaoItem = {
            composicaoId: editingComposicao?.id || '',
            insumoId: insumo.id!,
            codigoInsumo: insumo.codigo,
            descricaoInsumo: insumo.descricao,
            unidadeInsumo: insumo.unidade,
            coeficiente: 1,
            precoUnitario: insumo.preco,
            custoTotal: insumo.preco,
        };

        const updatedItems = [...formItems, newItem];
        setFormItems(updatedItems);
        setFormData({ ...formData, custoTotal: calcularCustoTotal(updatedItems) });
        setInsumoSearch('');
        setShowInsumoSearch(false);
    };

    const handleUpdateCoeficiente = (index: number, coef: number) => {
        const updatedItems = [...formItems];
        updatedItems[index].coeficiente = coef;
        updatedItems[index].custoTotal = coef * updatedItems[index].precoUnitario;
        setFormItems(updatedItems);
        setFormData({ ...formData, custoTotal: calcularCustoTotal(updatedItems) });
    };

    const handleRemoveItem = (index: number) => {
        const updatedItems = formItems.filter((_, i) => i !== index);
        setFormItems(updatedItems);
        setFormData({ ...formData, custoTotal: calcularCustoTotal(updatedItems) });
    };

    const handleSave = async () => {
        if (!formData.codigo || !formData.descricao || !formData.unidade) {
            alert('Preencha pelo menos Código, Descrição e Unidade.');
            return;
        }

        if (formItems.length === 0) {
            alert('Uma composição deve ter pelo menos um insumo vinculado.');
            return;
        }

        try {
            const custoTotal = calcularCustoTotal(formItems);

            if (editingComposicao?.id) {
                // Atualizar composição
                await CompositionService.update(editingComposicao.id, {
                    ...formData,
                    custoTotal,
                    updatedAt: new Date(),
                }, formItems);
            } else {
                // Nova composição
                await CompositionService.create({
                    ...formData as Composicao,
                    custoTotal,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                }, formItems);
            }

            setShowModal(false);
            resetForm();
            fetchComposicoes();
        } catch (error) {
            console.error(error);
            alert('Erro ao salvar composição.');
        }
    };



    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-gradient-to-br from-purple-500 to-purple-700 rounded-2xl flex items-center justify-center shadow-lg">
                        <Layers className="text-white" size={28} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-primary">Banco de Composições (CPU)</h1>
                        <p className="text-secondary text-sm">Serviços compostos por insumos vinculados</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleNew}
                        className="bg-purple-600 text-white px-4 py-2 rounded-xl flex items-center gap-2 font-semibold shadow-md hover:bg-purple-700"
                    >
                        <Plus size={18} />
                        Nova Composição
                    </button>
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                    <p className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Total CPUs</p>
                    <p className="text-2xl font-bold text-primary">{totalComposicoes || 0}</p>
                </div>
                {Object.entries(FONTE_LABELS).slice(0, 3).map(([key, label]) => (
                    <div key={key} className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                        <p className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">{label}</p>
                        <p className="text-2xl font-bold text-primary">
                            {composicoes?.filter(c => c.fonte === key).length || 0}
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
                        placeholder="Buscar por código ou descrição..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:border-purple-500 outline-none text-sm"
                    />
                </div>
                <select
                    value={filterFonte}
                    onChange={(e) => setFilterFonte(e.target.value)}
                    className="px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 min-w-[160px]"
                >
                    <option value="">Todas as Fontes</option>
                    {Object.entries(FONTE_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                    ))}
                </select>
            </div>

            {/* Composições List */}
            <div className="space-y-3">
                {composicoes?.map((comp) => (
                    <div key={comp.id} className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                        {/* Header da Composição */}
                        <div
                            className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50"
                            onClick={() => handleToggleExpand(comp.id!)}
                        >
                            <div className="flex items-center gap-4">
                                <button className="text-slate-400">
                                    {expandedIds.has(comp.id!) ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                                </button>
                                <div>
                                    <div className="flex items-center gap-3">
                                        <span className="font-mono text-xs text-slate-400">{comp.codigo}</span>
                                        <h3 className="font-bold text-slate-700">{comp.descricao}</h3>
                                        {comp.isCustomizada && (
                                            <span className="text-[10px] font-bold px-2 py-0.5 bg-amber-50 text-amber-600 rounded uppercase">
                                                Customizada
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-4 mt-1 text-xs text-slate-400">
                                        <span>Unidade: <strong>{comp.unidade}</strong></span>
                                        <span>Fonte: <strong>{comp.fonte}</strong></span>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-6">
                                <div className="text-right">
                                    <p className="text-[10px] text-slate-400 uppercase">Custo Total</p>
                                    <p className="text-lg font-bold text-primary">
                                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(comp.custoTotal)}
                                    </p>
                                </div>
                                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                    <button
                                        onClick={() => handleEdit(comp)}
                                        className="p-2 text-slate-400 hover:text-blue-600 hover:bg-slate-100 rounded-lg"
                                    >
                                        <Edit3 size={16} />
                                    </button>
                                    <button
                                        onClick={() => handleDelete(comp.id!)}
                                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-slate-100 rounded-lg"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Itens (Expandido) */}
                        {expandedIds.has(comp.id!) && (
                            <div className="border-t border-slate-100 bg-slate-50/50">
                                <table className="w-full text-xs">
                                    <thead className="bg-slate-100 text-[10px] uppercase text-slate-500 font-bold">
                                        <tr>
                                            <th className="p-3 text-left">Código</th>
                                            <th className="p-3 text-left">Insumo</th>
                                            <th className="p-3 text-center">Unid.</th>
                                            <th className="p-3 text-right">Coef.</th>
                                            <th className="p-3 text-right">Preço Unit.</th>
                                            <th className="p-3 text-right">Custo</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {composicaoItems?.[comp.id!]?.map((item, idx) => (
                                            <tr key={idx} className="border-t border-slate-100">
                                                <td className="p-3 font-mono text-slate-400">{item.codigoInsumo}</td>
                                                <td className="p-3 text-slate-600">{item.descricaoInsumo}</td>
                                                <td className="p-3 text-center text-slate-400">{item.unidadeInsumo}</td>
                                                <td className="p-3 text-right font-mono">{item.coeficiente.toFixed(4)}</td>
                                                <td className="p-3 text-right font-mono">
                                                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.precoUnitario)}
                                                </td>
                                                <td className="p-3 text-right font-mono font-bold">
                                                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.custoTotal)}
                                                </td>
                                            </tr>
                                        ))}
                                        {(!composicaoItems?.[comp.id!] || composicaoItems[comp.id!].length === 0) && (
                                            <tr>
                                                <td colSpan={6} className="p-6 text-center text-slate-400">
                                                    Nenhum insumo vinculado
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                ))}

                {composicoes?.length === 0 && (
                    <div className="bg-white rounded-xl border border-slate-100 p-12 text-center text-slate-400">
                        <Database size={32} className="mx-auto mb-3 opacity-30" />
                        <p className="font-medium">Nenhuma composição encontrada</p>
                        <p className="text-xs mt-1">Importe uma base oficial ou crie manualmente</p>
                    </div>
                )}
            </div>

            {/* Modal de Edição/Criação */}
            {showModal && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
                        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-purple-600 text-white">
                            <h3 className="text-xl font-bold">
                                {editingComposicao ? 'Editar Composição' : 'Nova Composição (CPU)'}
                            </h3>
                            <button onClick={() => setShowModal(false)} className="p-2 hover:bg-white/20 rounded-lg">
                                <X size={24} />
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto flex-1 space-y-6">
                            {/* Aviso de CPU customizada */}
                            {formData.isCustomizada && (
                                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                                    <AlertTriangle size={20} className="text-amber-500 shrink-0 mt-0.5" />
                                    <div>
                                        <p className="font-bold text-amber-700">Composição Customizada</p>
                                        <p className="text-sm text-amber-600">CPUs personalizadas são de responsabilidade do usuário e não possuem conformidade com bases oficiais.</p>
                                    </div>
                                </div>
                            )}

                            {/* Dados da Composição */}
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Código *</label>
                                    <input
                                        type="text"
                                        value={formData.codigo}
                                        onChange={(e) => setFormData({ ...formData, codigo: e.target.value })}
                                        className="w-full p-3 border border-slate-200 rounded-xl text-sm"
                                        placeholder="CPU-001"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Unidade *</label>
                                    <input
                                        type="text"
                                        value={formData.unidade}
                                        onChange={(e) => setFormData({ ...formData, unidade: e.target.value.toUpperCase() })}
                                        className="w-full p-3 border border-slate-200 rounded-xl text-sm"
                                        placeholder="M2, M3, UN..."
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Fonte</label>
                                    <select
                                        value={formData.fonte}
                                        onChange={(e) => setFormData({ ...formData, fonte: e.target.value })}
                                        className="w-full p-3 border border-slate-200 rounded-xl text-sm"
                                    >
                                        {Object.entries(FONTE_LABELS).map(([key, label]) => (
                                            <option key={key} value={key}>{label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Descrição *</label>
                                <textarea
                                    value={formData.descricao}
                                    onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
                                    className="w-full p-3 border border-slate-200 rounded-xl text-sm"
                                    rows={2}
                                    placeholder="Descrição do serviço..."
                                />
                            </div>

                            {/* Insumos Vinculados */}
                            <div>
                                <div className="flex items-center justify-between mb-3">
                                    <label className="text-xs font-bold text-slate-500 uppercase">Insumos Vinculados</label>
                                    <button
                                        onClick={() => setShowInsumoSearch(!showInsumoSearch)}
                                        className="text-xs font-bold text-purple-600 hover:text-purple-700 flex items-center gap-1"
                                    >
                                        <PlusCircle size={14} />
                                        Adicionar Insumo
                                    </button>
                                </div>

                                {/* Barra de busca de insumos */}
                                {showInsumoSearch && (
                                    <div className="mb-4 relative">
                                        <input
                                            type="text"
                                            placeholder="Buscar insumo por código ou descrição..."
                                            value={insumoSearch}
                                            onChange={(e) => setInsumoSearch(e.target.value)}
                                            className="w-full p-3 pl-10 border-2 border-purple-200 rounded-xl text-sm focus:border-purple-500 outline-none"
                                            autoFocus
                                        />
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-purple-300" size={18} />

                                        {insumosDisponiveis && insumosDisponiveis.length > 0 && (
                                            <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                                                {insumosDisponiveis.map((insumo) => (
                                                    <button
                                                        key={insumo.id}
                                                        onClick={() => handleAddInsumo(insumo)}
                                                        className="w-full p-3 text-left hover:bg-purple-50 flex items-center justify-between border-b border-slate-100 last:border-0"
                                                    >
                                                        <div>
                                                            <span className="font-mono text-xs text-slate-400">{insumo.codigo}</span>
                                                            <p className="text-sm text-slate-700">{insumo.descricao}</p>
                                                        </div>
                                                        <span className="font-bold text-sm">
                                                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(insumo.preco)}
                                                        </span>
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Tabela de itens */}
                                <div className="border border-slate-200 rounded-xl overflow-hidden">
                                    <table className="w-full text-xs">
                                        <thead className="bg-slate-100 text-[10px] uppercase text-slate-500 font-bold">
                                            <tr>
                                                <th className="p-3 text-left">Insumo</th>
                                                <th className="p-3 text-center w-20">Unid.</th>
                                                <th className="p-3 text-center w-28">Coeficiente</th>
                                                <th className="p-3 text-right w-28">Preço</th>
                                                <th className="p-3 text-right w-28">Custo</th>
                                                <th className="p-3 text-center w-16"></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {formItems.map((item, idx) => (
                                                <tr key={idx} className="border-t border-slate-100">
                                                    <td className="p-3">
                                                        <span className="font-mono text-[10px] text-slate-400">{item.codigoInsumo}</span>
                                                        <p className="text-slate-700">{item.descricaoInsumo}</p>
                                                    </td>
                                                    <td className="p-3 text-center text-slate-400">{item.unidadeInsumo}</td>
                                                    <td className="p-3">
                                                        <input
                                                            type="number"
                                                            step="0.0001"
                                                            value={item.coeficiente}
                                                            onChange={(e) => handleUpdateCoeficiente(idx, parseFloat(e.target.value) || 0)}
                                                            className="w-full p-2 border border-slate-200 rounded text-right font-mono text-xs"
                                                        />
                                                    </td>
                                                    <td className="p-3 text-right font-mono">
                                                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.precoUnitario)}
                                                    </td>
                                                    <td className="p-3 text-right font-mono font-bold text-purple-600">
                                                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.custoTotal)}
                                                    </td>
                                                    <td className="p-3 text-center">
                                                        <button
                                                            onClick={() => handleRemoveItem(idx)}
                                                            className="text-slate-400 hover:text-red-500"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                            {formItems.length === 0 && (
                                                <tr>
                                                    <td colSpan={6} className="p-8 text-center text-slate-400">
                                                        <PlusCircle size={24} className="mx-auto mb-2 opacity-30" />
                                                        Adicione insumos à composição
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                        <tfoot className="bg-slate-50 font-bold">
                                            <tr>
                                                <td colSpan={4} className="p-3 text-right uppercase text-[10px] text-slate-500">Custo Total da Composição</td>
                                                <td className="p-3 text-right text-lg text-purple-700">
                                                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(formData.custoTotal || 0)}
                                                </td>
                                                <td></td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>
                        </div>

                        <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-between items-center">
                            <p className="text-xs text-slate-400">
                                {formItems.length} insumo(s) vinculado(s)
                            </p>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setShowModal(false)}
                                    className="px-6 py-3 font-medium text-slate-500 hover:text-slate-700"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={handleSave}
                                    disabled={formItems.length === 0}
                                    className="bg-purple-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-purple-700 shadow-md flex items-center gap-2 disabled:opacity-50"
                                >
                                    <Save size={18} />
                                    Salvar Composição
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default BancoComposicoes;
