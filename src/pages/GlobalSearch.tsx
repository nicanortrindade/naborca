
import React, { useState, useEffect } from 'react';
import type { Insumo, Composicao } from '../types/domain';
import { InsumoService } from '../lib/supabase-services/InsumoService';
import { CompositionService } from '../lib/supabase-services/CompositionService';
import { Search, Package, X, TrendingUp, TrendingDown, Minus, ExternalLink } from 'lucide-react';

const GlobalSearch: React.FC = () => {
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedItem, setSelectedItem] = useState<any>(null);

    const [searchResults, setSearchResults] = useState<{
        grouped: Record<string, Insumo[]>;
        userComps: Composicao[];
        total: number;
    } | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const search = async () => {
            if (searchTerm.length < 2) {
                setSearchResults(null);
                return;
            }

            setLoading(true);
            try {
                // Search in insumos (Supabase)
                const insumos = await InsumoService.search(searchTerm);

                // Group by code for comparison
                const grouped: Record<string, Insumo[]> = {};
                insumos.forEach(i => {
                    const key = i.codigo;
                    if (!grouped[key]) grouped[key] = [];
                    grouped[key].push(i);
                });

                // Search in compositions (Supabase)
                const allComps = await CompositionService.getAll();
                const userComps = allComps.filter(c =>
                    c.codigo.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    c.descricao.toLowerCase().includes(searchTerm.toLowerCase())
                );

                setSearchResults({
                    grouped,
                    userComps,
                    total: insumos.length + userComps.length
                });
            } catch (error) {
                console.error('Error during global search:', error);
            } finally {
                setLoading(false);
            }
        };

        const timeoutId = setTimeout(search, 300); // Debounce
        return () => clearTimeout(timeoutId);
    }, [searchTerm]);

    const formatCurrency = (val: number) =>
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

    const getPriceComparison = (items: Insumo[]) => {
        if (items.length < 2) return null;
        const prices = items.map(i => i.preco);
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const diff = ((max - min) / min) * 100;
        return { min, max, diff };
    };

    return (
        <div className="p-6 max-w-6xl mx-auto">
            <header className="mb-8">
                <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-3">
                    <Search className="text-blue-600" />
                    Busca Global de Insumos
                </h1>
                <p className="text-slate-500 mt-2">
                    Pesquise em todas as bases de dados simultaneamente e compare preços entre SINAPI, ORSE, SEINFRA, etc.
                </p>
            </header>

            {/* Search Input */}
            <div className="relative mb-8">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Digite o código ou descrição do insumo..."
                    className="w-full pl-12 pr-12 py-4 bg-white border-2 border-slate-200 rounded-2xl text-lg font-medium focus:border-blue-500 focus:ring-4 focus:ring-blue-100 outline-none transition-all"
                />
                {searchTerm && (
                    <button
                        onClick={() => setSearchTerm('')}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                        <X size={20} />
                    </button>
                )}
            </div>

            {/* Results */}
            {searchTerm.length >= 2 && searchResults && (
                <div className="space-y-6">
                    <p className="text-sm text-slate-500">
                        Encontrados <span className="font-bold text-slate-800">{searchResults.total}</span> resultados
                    </p>

                    {/* Grouped Results */}
                    {Object.entries(searchResults.grouped || {}).map(([code, items]) => {
                        const comparison = getPriceComparison(items as any[]);
                        return (
                            <div key={code} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                                <div className="p-4 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
                                    <div>
                                        <span className="font-mono text-blue-600 font-bold">{code}</span>
                                        <p className="text-sm text-slate-700 font-medium mt-1 line-clamp-1">
                                            {(items as Insumo[])[0]?.descricao}
                                        </p>
                                    </div>
                                    {comparison && comparison.diff > 5 && (
                                        <div className="flex items-center gap-2 bg-amber-100 text-amber-700 px-3 py-1.5 rounded-full text-xs font-bold">
                                            <TrendingUp size={14} />
                                            {comparison.diff.toFixed(1)}% de variação
                                        </div>
                                    )}
                                </div>
                                <div className="divide-y divide-slate-100">
                                    {(items as any[]).map((item, idx) => {
                                        const isMin = comparison && item.price === comparison.min;
                                        const isMax = comparison && item.price === comparison.max;
                                        return (
                                            <div
                                                key={idx}
                                                className={`p-4 flex justify-between items-center hover:bg-slate-50 transition-colors ${isMin ? 'bg-green-50' : isMax ? 'bg-red-50' : ''}`}
                                            >
                                                <div className="flex items-center gap-4">
                                                    <span className={`px-2 py-1 rounded text-xs font-bold uppercase ${item.source === 'SINAPI' ? 'bg-blue-100 text-blue-700' :
                                                        item.source === 'ORSE' ? 'bg-purple-100 text-purple-700' :
                                                            item.source === 'SEINFRA' ? 'bg-orange-100 text-orange-700' :
                                                                item.source === 'EMBASA' ? 'bg-cyan-100 text-cyan-700' :
                                                                    item.source === 'SETOP' ? 'bg-pink-100 text-pink-700' :
                                                                        'bg-slate-100 text-slate-700'
                                                        }`}>
                                                        {item.source}
                                                    </span>
                                                    <span className="text-sm text-slate-500">{item.unidade}</span>
                                                    <span className="text-xs text-slate-400">
                                                        {item.tipo === 'material' ? '📦 Material' :
                                                            item.tipo === 'maoDeObra' ? '👷 Mão de Obra' :
                                                                item.tipo === 'equipamento' ? '🔧 Equipamento' : '📋 Serviço'}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    {isMin && <span className="text-green-600 text-xs font-bold flex items-center gap-1"><TrendingDown size={12} /> Menor</span>}
                                                    {isMax && <span className="text-red-600 text-xs font-bold flex items-center gap-1"><TrendingUp size={12} /> Maior</span>}
                                                    {!isMin && !isMax && comparison && <Minus className="text-slate-300" size={12} />}
                                                    <span className={`font-bold text-lg ${isMin ? 'text-green-600' : isMax ? 'text-red-500' : 'text-slate-800'}`}>
                                                        {formatCurrency(item.preco)}
                                                    </span>
                                                    <button
                                                        onClick={() => setSelectedItem(item)}
                                                        className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                                        title="Ver detalhes"
                                                    >
                                                        <ExternalLink size={16} />
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}

                    {/* User Compositions */}
                    {searchResults.userComps?.length > 0 && (
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                            <div className="p-4 bg-green-50 border-b border-green-100">
                                <span className="font-bold text-green-800">📁 Composições Próprias</span>
                            </div>
                            <div className="divide-y divide-slate-100">
                                {searchResults.userComps.map((comp) => (
                                    <div key={comp.id} className="p-4 flex justify-between items-center hover:bg-slate-50">
                                        <div>
                                            <span className="font-mono text-green-600 font-bold">{comp.codigo}</span>
                                            <p className="text-sm text-slate-700 font-medium mt-1">{comp.descricao}</p>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <span className="text-sm text-slate-500">{comp.unidade}</span>
                                            <span className="font-bold text-lg text-green-700">{formatCurrency(comp.custoTotal)}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Empty State */}
                    {searchResults.total === 0 && (
                        <div className="text-center py-16 text-slate-400">
                            <Package size={48} className="mx-auto mb-4 opacity-50" />
                            <p className="font-medium">Nenhum insumo encontrado</p>
                            <p className="text-sm">Tente outros termos de busca</p>
                        </div>
                    )}
                </div>
            )}

            {/* Initial State */}
            {searchTerm.length < 2 && (
                <div className="text-center py-16 text-slate-400">
                    <Search size={48} className="mx-auto mb-4 opacity-50" />
                    <p className="font-medium">Digite pelo menos 2 caracteres para buscar</p>
                    <p className="text-sm mt-2">A busca inclui SINAPI, ORSE, SEINFRA, EMBASA, SETOP e suas composições próprias</p>
                </div>
            )}

            {/* Detail Modal */}
            {selectedItem && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                            <h3 className="font-bold text-lg text-slate-800">Detalhes do Insumo</h3>
                            <button onClick={() => setSelectedItem(null)} className="p-2 hover:bg-slate-100 rounded-full">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="text-xs text-slate-400 uppercase font-bold">Código</label>
                                <p className="font-mono text-blue-600 font-bold text-lg">{selectedItem.codigo}</p>
                            </div>
                            <div>
                                <label className="text-xs text-slate-400 uppercase font-bold">Descrição</label>
                                <p className="text-slate-800">{selectedItem.descricao}</p>
                            </div>
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="text-xs text-slate-400 uppercase font-bold">Fonte</label>
                                    <p className="font-bold text-slate-700">{selectedItem.fonte}</p>
                                </div>
                                <div>
                                    <label className="text-xs text-slate-400 uppercase font-bold">Unidade</label>
                                    <p className="font-bold text-slate-700">{selectedItem.unidade}</p>
                                </div>
                                <div>
                                    <label className="text-xs text-slate-400 uppercase font-bold">Tipo</label>
                                    <p className="font-bold text-slate-700 capitalize">{selectedItem.tipo}</p>
                                </div>
                            </div>
                            <div className="bg-blue-50 p-4 rounded-xl">
                                <label className="text-xs text-blue-600 uppercase font-bold">Preço Unitário</label>
                                <p className="font-black text-2xl text-blue-700">{formatCurrency(selectedItem.preco)}</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default GlobalSearch;
