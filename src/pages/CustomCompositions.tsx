
import React, { useState, useEffect } from 'react';
import { CompositionService } from '../lib/supabase-services/CompositionService';
import { InsumoService } from '../lib/supabase-services/InsumoService';
import type { Composicao, ComposicaoItem, Insumo } from '../types/domain';
import { Plus, Search, Trash2, Edit2, Database, Save, X, PlusCircle } from 'lucide-react';

const CustomCompositions: React.FC = () => {
    const [searchTerm, setSearchTerm] = useState('');
    const [compositions, setCompositions] = useState<Composicao[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingComp, setEditingComp] = useState<Partial<Composicao> | null>(null);
    const [items, setItems] = useState<Partial<ComposicaoItem>[]>([]);
    const [showSearch, setShowSearch] = useState(false);
    const [resourceSearch, setResourceSearch] = useState('');
    const [resources, setResources] = useState<Insumo[]>([]);

    useEffect(() => {
        loadCompositions();
    }, []);

    const loadCompositions = async () => {
        try {
            setLoading(true);
            const data = await CompositionService.getAll();
            setCompositions(data);
        } catch (error) {
            console.error('Erro ao carregar composições:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSearchResources = async (term: string) => {
        setResourceSearch(term);
        if (!term) {
            setResources([]);
            return;
        }
        try {
            const results = await InsumoService.search(term);
            setResources(results);
        } catch (error) {
            console.error('Erro ao buscar insumos:', error);
        }
    };

    const filteredCompositions = compositions.filter(c =>
        (c.descricao || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (c.codigo || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleCreateNew = () => {
        setEditingComp({
            codigo: '',
            descricao: '',
            unidade: 'UN',
            fonte: 'OWN',
            custoTotal: 0,
            isCustomizada: true
        });
        setItems([]);
    };

    const handleEdit = async (comp: Composicao) => {
        setEditingComp(comp);
        try {
            const compItems = await CompositionService.getItems(comp.id!);
            setItems(compItems);
        } catch (error) {
            console.error('Erro ao carregar itens:', error);
            setItems([]);
        }
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm('Excluir esta composição permanentemente?')) return;
        try {
            await CompositionService.delete(id);
            await loadCompositions();
        } catch (error) {
            console.error('Erro ao excluir composição:', error);
        }
    };

    const handleSave = async () => {
        if (!editingComp?.codigo || !editingComp?.descricao) {
            alert('Código e Descrição são obrigatórios.');
            return;
        }

        const custoTotal = items.reduce((acc, item) => acc + (item.custoTotal || 0), 0);
        const compData: Partial<Composicao> = { ...editingComp, custoTotal };

        const finalItems: ComposicaoItem[] = items.map(item => ({
            id: item.id,
            composicaoId: editingComp.id || '',
            insumoId: item.insumoId || '',
            codigoInsumo: item.codigoInsumo || '',
            descricaoInsumo: item.descricaoInsumo || '',
            unidadeInsumo: item.unidadeInsumo || '',
            coeficiente: item.coeficiente || 1,
            precoUnitario: item.precoUnitario || 0,
            custoTotal: item.custoTotal || 0,
        }));

        try {
            if (editingComp.id) {
                await CompositionService.update(editingComp.id, compData, finalItems);
            } else {
                await CompositionService.create(compData, finalItems);
            }
            await loadCompositions();
            setEditingComp(null);
            setItems([]);
        } catch (error) {
            console.error('Erro ao salvar composição:', error);
            alert('Erro ao salvar composição.');
        }
    };

    const addItem = (res: Insumo) => {
        setItems(prev => [...prev, {
            insumoId: res.id,
            codigoInsumo: res.codigo,
            descricaoInsumo: res.descricao,
            unidadeInsumo: res.unidade,
            coeficiente: 1,
            precoUnitario: res.preco,
            custoTotal: res.preco,
        }]);
        setShowSearch(false);
        setResourceSearch('');
        setResources([]);
    };

    const updateItem = (index: number, coeficiente: number) => {
        setItems(prev => prev.map((item, i) => {
            if (i === index) {
                return { ...item, coeficiente, custoTotal: coeficiente * (item.precoUnitario || 0) };
            }
            return item;
        }));
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
            </div>
        );
    }

    return (
        <div className="p-8 max-w-6xl mx-auto">
            <header className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-black text-slate-800">Minhas Composições</h1>
                    <p className="text-slate-500">Crie seu próprio banco de dados de preços e CPUs.</p>
                </div>
                <button
                    onClick={handleCreateNew}
                    className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-black flex items-center gap-2 hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all active:scale-95"
                >
                    <PlusCircle size={20} /> NOVA COMPOSIÇÃO
                </button>
            </header>

            <div className="relative mb-8">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                <input
                    className="w-full pl-12 pr-6 py-4 bg-white border-2 border-slate-100 rounded-2xl outline-none focus:border-blue-500 transition-all shadow-sm text-lg"
                    placeholder="Buscar em minhas composições..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                />
            </div>

            <div className="grid grid-cols-1 gap-4">
                {filteredCompositions.map(comp => (
                    <div key={comp.id} className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all flex justify-between items-center group">
                        <div className="flex gap-6 items-center">
                            <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center font-black">
                                {comp.unidade}
                            </div>
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest">{comp.fonte}</span>
                                    <span className="text-xs font-mono text-slate-400 font-bold">{comp.codigo}</span>
                                </div>
                                <h3 className="text-lg font-bold text-slate-800">{comp.descricao}</h3>
                            </div>
                        </div>
                        <div className="flex items-center gap-8">
                            <div className="text-right">
                                <div className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-1">Custo Total</div>
                                <div className="text-xl font-black text-blue-600">
                                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(comp.custoTotal)}
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => handleEdit(comp)} className="p-3 text-slate-400 hover:bg-blue-50 hover:text-blue-600 rounded-xl transition-all">
                                    <Edit2 size={20} />
                                </button>
                                <button onClick={() => handleDelete(comp.id!)} className="p-3 text-slate-400 hover:bg-red-50 hover:text-red-600 rounded-xl transition-all">
                                    <Trash2 size={20} />
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Modal de Edição/Criação */}
            {editingComp && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
                    <div className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
                        <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-blue-600 text-white">
                            <h3 className="text-2xl font-black flex items-center gap-3">
                                <Database size={28} /> {editingComp.id ? 'Editar Composição' : 'Nova Composição Própria'}
                            </h3>
                            <button onClick={() => setEditingComp(null)} className="p-2 hover:bg-white/20 rounded-full transition-colors"><X size={24} /></button>
                        </div>

                        <div className="flex-1 overflow-auto p-8">
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                                <div className="md:col-span-1">
                                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Código</label>
                                    <input
                                        className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none focus:border-blue-500 transition-all font-mono font-bold"
                                        value={editingComp.codigo}
                                        onChange={e => setEditingComp({ ...editingComp, codigo: e.target.value.toUpperCase() })}
                                        placeholder="EX: CD-001"
                                    />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Descrição da Composição</label>
                                    <input
                                        className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none focus:border-blue-500 transition-all font-bold"
                                        value={editingComp.descricao}
                                        onChange={e => setEditingComp({ ...editingComp, descricao: e.target.value.toUpperCase() })}
                                        placeholder="EX: PINTURA LÁTEX ACRÍLICA DUAS DEMÃOS"
                                    />
                                </div>
                                <div className="md:col-span-1">
                                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Unidade</label>
                                    <input
                                        className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none focus:border-blue-500 transition-all text-center font-bold"
                                        value={editingComp.unidade}
                                        onChange={e => setEditingComp({ ...editingComp, unidade: e.target.value.toUpperCase() })}
                                        placeholder="M2"
                                    />
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="flex justify-between items-center border-b pb-4">
                                    <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest">Insumos da Composição</h4>
                                    <button
                                        onClick={() => setShowSearch(true)}
                                        className="bg-blue-50 text-blue-600 px-4 py-2 rounded-xl text-xs font-black hover:bg-blue-100 transition-all flex items-center gap-2"
                                    >
                                        <Plus size={16} /> ADICIONAR INSUMO
                                    </button>
                                </div>

                                <div className="border border-slate-100 rounded-2xl overflow-hidden">
                                    <table className="w-full text-sm">
                                        <thead className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                            <tr>
                                                <th className="p-4 text-left">Insumo</th>
                                                <th className="p-4 text-center">Unid.</th>
                                                <th className="p-4 text-right">Coeficiente</th>
                                                <th className="p-4 text-right">Unitário</th>
                                                <th className="p-4 text-right">Total</th>
                                                <th className="p-4 w-10"></th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {items.map((item, idx) => (
                                                <tr key={idx} className="hover:bg-slate-50/50">
                                                    <td className="p-4">
                                                        <div className="font-bold text-slate-700">{item.descricaoInsumo}</div>
                                                        <div className="text-[10px] text-slate-400 font-mono">{item.codigoInsumo}</div>
                                                    </td>
                                                    <td className="p-4 text-center text-slate-500 font-bold">{item.unidadeInsumo}</td>
                                                    <td className="p-4">
                                                        <input
                                                            type="number"
                                                            step="0.0001"
                                                            className="w-24 ml-auto block p-2 bg-white border border-slate-200 rounded-lg text-right font-black text-blue-600 outline-none focus:border-blue-400"
                                                            value={item.coeficiente}
                                                            onChange={e => updateItem(idx, Number(e.target.value))}
                                                        />
                                                    </td>
                                                    <td className="p-4 text-right font-mono text-slate-500">
                                                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.precoUnitario || 0)}
                                                    </td>
                                                    <td className="p-4 text-right font-black text-slate-800">
                                                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.custoTotal || 0)}
                                                    </td>
                                                    <td className="p-4 text-right">
                                                        <button onClick={() => setItems(items.filter((_, i) => i !== idx))} className="text-slate-300 hover:text-red-500"><Trash2 size={16} /></button>
                                                    </td>
                                                </tr>
                                            ))}
                                            {items.length === 0 && (
                                                <tr>
                                                    <td colSpan={6} className="p-10 text-center text-slate-400 italic">Nenhum insumo adicionado.</td>
                                                </tr>
                                            )}
                                        </tbody>
                                        <tfoot className="bg-slate-50 font-black border-t">
                                            <tr>
                                                <td colSpan={4} className="p-4 text-right uppercase text-xs text-slate-400 tracking-widest">Custo Total da Composição:</td>
                                                <td className="p-4 text-right text-blue-700 text-lg">
                                                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(items.reduce((acc, i) => acc + (i.custoTotal || 0), 0))}
                                                </td>
                                                <td></td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>
                        </div>

                        <div className="p-8 bg-slate-50 border-t flex justify-end gap-4">
                            <button onClick={() => setEditingComp(null)} className="px-8 py-3 text-slate-500 font-black hover:bg-slate-100 rounded-2xl transition-all uppercase tracking-widest text-xs">Descartar</button>
                            <button onClick={handleSave} className="px-10 py-3 bg-blue-600 text-white font-black rounded-2xl hover:bg-blue-700 shadow-xl shadow-blue-200 transition-all active:scale-95 uppercase tracking-widest text-xs flex items-center gap-2">
                                <Save size={18} /> SALVAR COMPOSIÇÃO
                            </button>
                        </div>

                        {/* Search Overlay */}
                        {showSearch && (
                            <div className="absolute inset-0 bg-white/95 backdrop-blur-sm z-[60] flex flex-col p-8 animate-in slide-in-from-bottom-4">
                                <div className="flex justify-between items-center mb-8">
                                    <h4 className="text-2xl font-black text-slate-800">Adicionar Insumo ou Serviço</h4>
                                    <button onClick={() => setShowSearch(false)} className="text-slate-400 hover:text-slate-600"><X size={32} /></button>
                                </div>
                                <div className="relative mb-8">
                                    <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400" size={24} />
                                    <input
                                        autoFocus
                                        className="w-full pl-16 pr-8 py-6 bg-white border-2 border-slate-100 rounded-2xl outline-none focus:border-blue-500 transition-all text-xl shadow-sm"
                                        placeholder="Buscar no banco de dados (SINAPI, ORSE, etc)..."
                                        value={resourceSearch}
                                        onChange={e => handleSearchResources(e.target.value)}
                                    />
                                </div>
                                <div className="flex-1 overflow-auto space-y-2">
                                    {resources.map(res => (
                                        <div
                                            key={res.id}
                                            onClick={() => addItem(res)}
                                            className="p-6 bg-white border border-slate-100 rounded-2xl flex justify-between items-center cursor-pointer hover:bg-blue-50 transition-all group"
                                        >
                                            <div>
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded text-[10px] font-black uppercase">{res.fonte}</span>
                                                    <span className="text-xs font-mono text-slate-400 font-bold">{res.codigo}</span>
                                                </div>
                                                <div className="font-bold text-slate-800 group-hover:text-blue-700">{res.descricao}</div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-xs text-slate-400 font-bold uppercase mb-1">{res.unidade}</div>
                                                <div className="text-lg font-black text-slate-900">
                                                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(res.preco)}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    {resourceSearch && resources.length === 0 && (
                                        <div className="text-center py-20 text-slate-400 italic font-medium">Nenhum resultado encontrado para "{resourceSearch}"</div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default CustomCompositions;
