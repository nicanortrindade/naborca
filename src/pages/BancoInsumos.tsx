import { useState, useEffect } from 'react';
import type { Insumo } from '../types/domain';
import { InsumoService } from '../lib/supabase-services/InsumoService';
import { Package, Search, Trash2, Plus, X, Edit3, AlertTriangle, Database } from 'lucide-react';
import { clsx } from 'clsx';

const TIPO_LABELS: Record<string, string> = {
    material: 'Material',
    maoDeObra: 'Mão de Obra',
    equipamento: 'Equipamento',
    servicoUnitario: 'Serviço Unitário',
};

const FONTE_LABELS: Record<string, string> = {
    SINAPI: 'SINAPI',
    ORSE: 'ORSE',
    SEINFRA: 'SEINFRA',
    SICRO: 'SICRO',
    PROPRIO: 'Próprio',
};

const BancoInsumos = () => {
    const [searchTerm, setSearchTerm] = useState('');
    const [filterTipo, setFilterTipo] = useState<string>('');
    const [filterFonte, setFilterFonte] = useState<string>('');
    const [showModal, setShowModal] = useState(false);
    const [editingInsumo, setEditingInsumo] = useState<Insumo | null>(null);

    const [formData, setFormData] = useState<Partial<Insumo>>({
        codigo: '',
        descricao: '',
        unidade: 'UN',
        preco: 0,
        tipo: 'material',
        fonte: 'PROPRIO',
        dataReferencia: new Date(),
        isOficial: false,
        isEditavel: true,
    });

    const [insumos, setInsumos] = useState<Insumo[]>([]);
    const [totalInsumos, setTotalInsumos] = useState(0);
    const [loading, setLoading] = useState(true);

    const fetchInsumos = async () => {
        setLoading(true);
        try {
            // No Supabase, o ideal seria fazer o filtro no banco.
            // Por simplicidade aqui, traremos os itens e filtraremos, 
            // ou podemos usar a busca do service se searchTerm estiver presente.

            let results: Insumo[] = [];

            if (searchTerm && searchTerm.length > 2) {
                results = await InsumoService.search(searchTerm);
            } else {
                results = await InsumoService.getAll();
            }

            // Aplicar filtros locais for simple implementation
            if (filterTipo) {
                results = results.filter(i => i.tipo === filterTipo);
            }
            if (filterFonte) {
                results = results.filter(i => i.fonte === filterFonte);
            }

            setInsumos(results.slice(0, 100));
            setTotalInsumos(results.length);
        } catch (error) {
            console.error('Error fetching insumos:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchInsumos();
    }, [searchTerm, filterTipo, filterFonte]);

    const handleSave = async () => {
        if (!formData.codigo || !formData.descricao || !formData.unidade) {
            alert('Preencha pelo menos Código, Descrição e Unidade.');
            return;
        }

        try {
            if (editingInsumo?.id) {
                await InsumoService.update(editingInsumo.id, {
                    ...formData,
                    updatedAt: new Date(),
                });
            } else {
                await InsumoService.create({
                    ...formData as Insumo,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                });
            }
            setShowModal(false);
            resetForm();
            fetchInsumos(); // Refresh list
        } catch (error) {
            console.error(error);
            alert('Erro ao salvar insumo.');
        }
    };

    const handleEdit = (insumo: Insumo) => {
        setEditingInsumo(insumo);
        setFormData(insumo);
        setShowModal(true);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Tem certeza que deseja excluir este insumo?')) return;

        // Note: Link check with composicaoItems should ideally be on backend or separate service call
        // For now, simple delete
        try {
            await InsumoService.delete(id);
            fetchInsumos();
        } catch (error) {
            console.error(error);
            alert('Erro ao excluir insumo. Verifique se ele está sendo usado em alguma composição.');
        }
    };

    const handleNew = () => {
        resetForm();
        setEditingInsumo(null);
        setShowModal(true);
    };

    const resetForm = () => {
        setFormData({
            codigo: '',
            descricao: '',
            unidade: 'UN',
            preco: 0,
            tipo: 'material',
            fonte: 'PROPRIO',
            dataReferencia: new Date(),
            isOficial: false,
            isEditavel: true,
        });
    };



    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-blue-700 rounded-2xl flex items-center justify-center shadow-lg">
                        <Package className="text-white" size={28} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-primary">Banco de Insumos</h1>
                        <p className="text-secondary text-sm">Materiais, Mão de Obra, Equipamentos e Serviços Unitários</p>
                    </div>
                </div>

                <button
                    onClick={handleNew}
                    className="bg-accent text-white px-4 py-2 rounded-xl flex items-center gap-2 font-semibold shadow-md hover:bg-accent/90"
                >
                    <Plus size={18} />
                    Novo Insumo
                </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                    <p className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Total</p>
                    <p className="text-2xl font-bold text-primary">{totalInsumos || 0}</p>
                </div>
                {Object.entries(TIPO_LABELS).map(([key, label]) => (
                    <div key={key} className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                        <p className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">{label}</p>
                        <p className="text-2xl font-bold text-primary">
                            {insumos?.filter(i => i.tipo === key).length || 0}
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
                        className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:border-accent outline-none text-sm"
                    />
                </div>
                <select
                    value={filterTipo}
                    onChange={(e) => setFilterTipo(e.target.value)}
                    className="px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 min-w-[160px]"
                >
                    <option value="">Todos os Tipos</option>
                    {Object.entries(TIPO_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                    ))}
                </select>
                <select
                    value={filterFonte}
                    onChange={(e) => setFilterFonte(e.target.value)}
                    className="px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 min-w-[140px]"
                >
                    <option value="">Todas as Fontes</option>
                    {Object.entries(FONTE_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                    ))}
                </select>
            </div>

            {/* Table */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-[10px] uppercase text-slate-500 font-bold tracking-wider">
                            <tr>
                                <th className="p-4">Código</th>
                                <th className="p-4">Descrição</th>
                                <th className="p-4 text-center">Tipo</th>
                                <th className="p-4 text-center">Unid.</th>
                                <th className="p-4 text-right">Preço</th>
                                <th className="p-4 text-center">Fonte</th>
                                <th className="p-4 text-center">Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            {insumos?.map((insumo) => (
                                <tr key={insumo.id} className="border-t border-slate-100 hover:bg-slate-50 transition-colors">
                                    <td className="p-4 font-mono text-xs text-slate-600">{insumo.codigo}</td>
                                    <td className="p-4 text-slate-700 max-w-[300px] truncate">{insumo.descricao}</td>
                                    <td className="p-4 text-center">
                                        <span className={clsx(
                                            "text-[10px] font-bold px-2 py-1 rounded uppercase",
                                            insumo.tipo === 'material' && "bg-blue-50 text-blue-600",
                                            insumo.tipo === 'maoDeObra' && "bg-orange-50 text-orange-600",
                                            insumo.tipo === 'equipamento' && "bg-purple-50 text-purple-600",
                                            insumo.tipo === 'servicoUnitario' && "bg-green-50 text-green-600",
                                        )}>
                                            {TIPO_LABELS[insumo.tipo]}
                                        </span>
                                    </td>
                                    <td className="p-4 text-center text-slate-500">{insumo.unidade}</td>
                                    <td className="p-4 text-right font-mono font-bold text-slate-700">
                                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(insumo.preco)}
                                    </td>
                                    <td className="p-4 text-center">
                                        <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded">
                                            {insumo.fonte}
                                        </span>
                                    </td>
                                    <td className="p-4 text-center">
                                        <div className="flex items-center justify-center gap-1">
                                            <button
                                                onClick={() => handleEdit(insumo)}
                                                className="p-2 text-slate-400 hover:text-blue-600 hover:bg-slate-100 rounded-lg transition-colors"
                                                title="Editar"
                                            >
                                                <Edit3 size={14} />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(insumo.id!)}
                                                className="p-2 text-slate-400 hover:text-red-600 hover:bg-slate-100 rounded-lg transition-colors"
                                                title="Excluir"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {insumos?.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="p-12 text-center text-slate-400">
                                        <Database size={32} className="mx-auto mb-3 opacity-30" />
                                        <p className="font-medium">Nenhum insumo encontrado</p>
                                        <p className="text-xs mt-1">Importe uma base oficial ou cadastre manualmente</p>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Modal de Edição/Criação */}
            {
                showModal && (
                    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
                            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                                <h3 className="text-xl font-bold text-primary">
                                    {editingInsumo ? 'Editar Insumo' : 'Novo Insumo'}
                                </h3>
                                <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600">
                                    <X size={24} />
                                </button>
                            </div>

                            <div className="p-6 space-y-4">
                                {!formData.isEditavel && formData.isOficial && (
                                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                                        <AlertTriangle size={20} className="text-amber-500 shrink-0 mt-0.5" />
                                        <div>
                                            <p className="font-bold text-amber-700">Insumo de Base Oficial</p>
                                            <p className="text-sm text-amber-600">A edição de preços em insumos oficiais pode comprometer a conformidade. Edições são de responsabilidade do usuário.</p>
                                        </div>
                                    </div>
                                )}

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Código *</label>
                                        <input
                                            type="text"
                                            value={formData.codigo}
                                            onChange={(e) => setFormData({ ...formData, codigo: e.target.value })}
                                            className="w-full p-3 border border-slate-200 rounded-xl text-sm"
                                            placeholder="Ex: 00000001"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Unidade *</label>
                                        <input
                                            type="text"
                                            value={formData.unidade}
                                            onChange={(e) => setFormData({ ...formData, unidade: e.target.value.toUpperCase() })}
                                            className="w-full p-3 border border-slate-200 rounded-xl text-sm"
                                            placeholder="UN, M, M2, KG, H..."
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Descrição *</label>
                                    <textarea
                                        value={formData.descricao}
                                        onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
                                        className="w-full p-3 border border-slate-200 rounded-xl text-sm"
                                        rows={2}
                                        placeholder="Descrição completa do insumo..."
                                    />
                                </div>

                                <div className="grid grid-cols-3 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tipo</label>
                                        <select
                                            value={formData.tipo}
                                            onChange={(e) => setFormData({ ...formData, tipo: e.target.value as any })}
                                            className="w-full p-3 border border-slate-200 rounded-xl text-sm"
                                        >
                                            {Object.entries(TIPO_LABELS).map(([key, label]) => (
                                                <option key={key} value={key}>{label}</option>
                                            ))}
                                        </select>
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
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Preço Unitário</label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={formData.preco}
                                            onChange={(e) => setFormData({ ...formData, preco: parseFloat(e.target.value) || 0 })}
                                            className="w-full p-3 border border-slate-200 rounded-xl text-sm text-right font-mono"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Observações</label>
                                    <textarea
                                        value={formData.observacoes || ''}
                                        onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
                                        className="w-full p-3 border border-slate-200 rounded-xl text-sm"
                                        rows={2}
                                        placeholder="Notas internas (opcional)..."
                                    />
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
                                    className="bg-accent text-white px-8 py-3 rounded-xl font-bold hover:bg-accent/90 shadow-md"
                                >
                                    Salvar Insumo
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
};

export default BancoInsumos;
