
import { useState, useEffect } from 'react';
import { InsumoService } from '../lib/supabase-services/InsumoService';
import { Database, Search, Upload, Filter, Trash2, Plus, X, FileText } from 'lucide-react';
import { clsx } from 'clsx';
import ResourceImporter from '../components/database/ResourceImporter';
import ResourceForm from '../components/database/ResourceForm';
import type { Insumo } from '../types/domain';

const Resources = () => {
    const [storedResources, setStoredResources] = useState<Insumo[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [showImporter, setShowImporter] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [selectedComp, setSelectedComp] = useState<any>(null);
    const [compItems, setCompItems] = useState<any[]>([]);

    useEffect(() => {
        loadResources();
    }, []);

    const loadResources = async () => {
        try {
            setLoading(true);
            const resources = await InsumoService.getAll();
            setStoredResources(resources);
        } catch (error) {
            console.error('Erro ao carregar insumos:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSyncBase = async (baseKey: string, baseName: string) => {
        setLoading(true);
        try {
            const response = await fetch(`/data/seed-${baseKey}.json`);
            if (!response.ok) throw new Error('Falha ao carregar arquivo de base');
            const data = await response.json();

            console.log(`Sincronizando ${data.length} itens da base ${baseName}...`);

            // Batch process in chunks of 500
            const CHUNK_SIZE = 500;
            const chunks = [];
            for (let i = 0; i < data.length; i += CHUNK_SIZE) {
                chunks.push(data.slice(i, i + CHUNK_SIZE));
            }

            let successCount = 0;
            let failedCount = 0;

            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                console.log(`Processando lote ${i + 1}/${chunks.length} (${chunk.length} itens)...`);

                try {
                    const itemsToUpsert = chunk.map((r: any) => ({
                        codigo: String(r.code || r.codigo || '').trim(),
                        descricao: String(r.description || r.descricao || '').trim(),
                        unidade: String(r.unit || r.unidade || 'UN').trim(),
                        preco: parseFloat(String(r.price || r.preco || r.precoUnitario || 0)) || 0,
                        tipo: (r.type || r.tipo || 'material') as any,
                        fonte: String(r.source || r.fonte || baseKey.toUpperCase()).trim().toUpperCase(),
                        isOficial: true,
                        isEditavel: false,
                    }));

                    const result = await InsumoService.batchUpsert(itemsToUpsert);
                    successCount += result.success;
                    failedCount += result.failed;

                    // Add a small delay to prevent rate limiting
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (chunkError: any) {
                    console.error(`Erro ao processar lote ${i + 1}:`, chunkError);
                    failedCount += chunk.length;
                }
            }

            await loadResources();
            if (successCount > 0) {
                alert(`Base ${baseName} sincronizada!\n✅ ${successCount} itens inseridos\n⚠️ ${failedCount} ignorados/duplicados`);
            } else if (failedCount > 0) {
                alert(`Sincronização de ${baseName} concluída.\nNenhum item novo inserido.\n${failedCount} itens já existiam no banco.`);
            } else {
                alert(`Base ${baseName} sincronizada, mas nenhum item foi processado. Verifique se o arquivo de dados está correto.`);
            }
        } catch (e: any) {
            console.error('Erro na sincronização:', e);
            alert(`Erro ao sincronizar base ${baseName}: ${e.message}`);
        } finally {
            setLoading(false);
        }
    };


    const handleClearDatabase = async () => {
        if (window.confirm("Isso apagará TODOS os insumos importados. Continuar?")) {
            try {
                // Delete all resources from Supabase
                for (const resource of storedResources) {
                    if (resource.id) {
                        await InsumoService.delete(resource.id);
                    }
                }
                setStoredResources([]);
                alert("Banco de insumos limpo com sucesso!");
            } catch (error) {
                console.error('Erro ao limpar banco:', error);
                alert("Erro ao limpar banco de insumos.");
            }
        }
    };

    const displayData = storedResources || [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filteredData = displayData.filter((r: any) =>
        (r.descricao || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (r.codigo || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleRowClick = async (resource: any) => {
        // Se for um serviço ou composição, tenta carregar o analítico
        if (resource.tipo === 'servicoUnitario' || resource.tipo === 'composition') {
            // For now, we don't have composition items in Supabase yet
            // This would require a separate service for resource compositions
            setCompItems([]);
            setSelectedComp(resource);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
            </div>
        );
    }

    return (
        <div className="space-y-6">

            {showImporter && (
                <ResourceImporter
                    onClose={() => setShowImporter(false)}
                    onSuccess={() => setShowImporter(false)}
                />
            )}

            {showForm && (
                <ResourceForm
                    onClose={() => setShowForm(false)}
                    onSuccess={() => {
                        setShowForm(false);
                        alert("Insumo cadastrado com sucesso!");
                    }}
                />
            )}

            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Banco de Insumos</h2>
                    <p className="text-slate-500 text-sm">Gerencie preços de referência (SINAPI, SICRO, etc)</p>
                </div>
                <div className="flex gap-2 flex-wrap">
                    <button
                        onClick={handleClearDatabase}
                        className="bg-white border border-red-200 text-red-600 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-red-50"
                    >
                        <Trash2 size={18} />
                        Limpar Banco
                    </button>

                    <button onClick={() => setShowForm(true)} className="bg-accent text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 shadow-md">
                        <Plus size={18} />
                        Novo Insumo
                    </button>

                    <button onClick={() => setShowImporter(true)} className="bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-slate-50">
                        <Upload size={18} />
                        Importar Excel
                    </button>

                    <div className="h-10 w-[1px] bg-slate-200 mx-2"></div>

                    <button
                        onClick={() => handleSyncBase('sinapi', 'SINAPI')}
                        className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 transition-all active:scale-95 shadow-md font-bold"
                    >
                        <Database size={18} />
                        Sincronizar SINAPI
                    </button>

                    <button
                        onClick={() => handleSyncBase('orse', 'ORSE (Sergipe)')}
                        className="bg-orange-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-orange-700 transition-all active:scale-95 shadow-md font-bold"
                    >
                        <Database size={18} />
                        Sincronizar ORSE
                    </button>

                    <button
                        onClick={() => handleSyncBase('seinfra', 'SEINFRA (Bahia)')}
                        className="bg-green-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-green-700 transition-all active:scale-95 shadow-md font-bold"
                    >
                        <Database size={18} />
                        Sincronizar SEINFRA
                    </button>

                    <button
                        onClick={() => handleSyncBase('setop', 'SETOP (Minas Gerais)')}
                        className="bg-purple-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-purple-700 transition-all active:scale-95 shadow-md font-bold"
                    >
                        <Database size={18} />
                        Sincronizar SETOP
                    </button>

                    <button
                        onClick={() => handleSyncBase('embasa', 'EMBASA (Bahia)')}
                        className="bg-cyan-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-cyan-700 transition-all active:scale-95 shadow-md font-bold"
                    >
                        <Database size={18} />
                        Sincronizar EMBASA
                    </button>
                </div>
            </div>

            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                <div className="flex gap-4 mb-6">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-3 text-slate-400" size={20} />
                        <input
                            type="text"
                            placeholder="Buscar por código ou descrição..."
                            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg outline-none focus:border-accent"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <button className="px-4 py-2 border border-slate-200 rounded-lg flex items-center gap-2 text-slate-600 hover:bg-slate-50">
                        <Filter size={18} />
                        Filtros
                    </button>
                </div>

                <table className="w-full text-left">
                    <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                            <th className="p-4 font-semibold text-slate-600 w-24">Fonte</th>
                            <th className="p-4 font-semibold text-slate-600 w-24">Código</th>
                            <th className="p-4 font-semibold text-slate-600">Descrição</th>
                            <th className="p-4 font-semibold text-slate-600 w-20">Unid.</th>
                            <th className="p-4 font-semibold text-slate-600 text-right w-32">Preço Unit.</th>
                        </tr>
                    </thead>
                    <tbody>
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {filteredData.map((item: any, idx: number) => (
                            <tr
                                key={idx}
                                onClick={() => handleRowClick(item)}
                                className={clsx(
                                    "border-b border-slate-100 transition-colors",
                                    (item.tipo === 'servicoUnitario' || item.tipo === 'composition') ? "cursor-pointer hover:bg-blue-50" : "hover:bg-slate-50"
                                )}
                            >
                                <td className="p-4">
                                    <span className={`px-2 py-1 rounded text-xs font-bold ${item.fonte === 'SINAPI' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                                        {item.fonte}
                                    </span>
                                </td>
                                <td className="p-4 font-mono text-slate-500">{item.codigo}</td>
                                <td className="p-4 font-medium text-slate-900">
                                    <div className="flex items-center gap-2">
                                        {item.descricao}
                                        {(item.tipo === 'servicoUnitario' || item.tipo === 'composition') && (
                                            <span className="text-[10px] bg-blue-600 text-white px-1.5 py-0.5 rounded font-black uppercase">CPU</span>
                                        )}
                                    </div>
                                </td>
                                <td className="p-4 text-slate-500">{item.unidade}</td>
                                <td className="p-4 text-right font-bold text-slate-700">
                                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.preco)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>

            </div>

            {/* Modal de Visão Analítica (CPU) */}
            {selectedComp && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[100] flex items-center justify-end p-0">
                    <div className="bg-white w-full max-w-2xl h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
                        <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-blue-600 text-white">
                            <div>
                                <h3 className="text-2xl font-black flex items-center gap-3">
                                    <FileText size={28} /> Composição Analítica (CPU)
                                </h3>
                                <p className="text-blue-100 text-xs mt-1 uppercase tracking-widest font-bold">Detalhamento de insumos e coeficientes</p>
                            </div>
                            <button onClick={() => setSelectedComp(null)} className="p-2 hover:bg-white/20 rounded-full transition-colors">
                                <X size={24} />
                            </button>
                        </div>

                        <div className="p-8 flex-1 overflow-auto">
                            <div className="mb-8 bg-slate-50 p-6 rounded-2xl border border-slate-100">
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-1 rounded font-black uppercase mb-2 inline-block">
                                            {selectedComp.fonte}
                                        </span>
                                        <h4 className="text-xl font-black text-slate-800">{selectedComp.descricao}</h4>
                                        <p className="text-slate-500 font-mono text-sm mt-1">{selectedComp.codigo} | Unid: {selectedComp.unidade}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[10px] text-slate-400 uppercase font-black mb-1">Custo Total</p>
                                        <p className="text-2xl font-black text-blue-600">
                                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(selectedComp.preco)}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <h5 className="text-xs font-black text-slate-400 uppercase tracking-widest border-b pb-2">Insumos da Composição</h5>
                                {compItems.length > 0 ? (
                                    <div className="space-y-3">
                                        {compItems.map((item, idx) => (
                                            <div key={idx} className="flex justify-between items-center p-4 bg-white border border-slate-100 rounded-xl hover:shadow-md transition-all">
                                                <div className="flex-1">
                                                    <p className="font-bold text-slate-700">{item.description}</p>
                                                    <div className="flex gap-4 mt-1">
                                                        <span className="text-[10px] text-slate-400 uppercase">Cód: {item.itemCode || item.code}</span>
                                                        <span className="text-[10px] text-slate-400 uppercase">Unid: {item.unit}</span>
                                                        <span className="text-[10px] font-bold text-blue-600 uppercase">Coef: {item.coefficient}</span>
                                                    </div>
                                                </div>
                                                <div className="text-right ml-4">
                                                    <p className="text-xs text-slate-400">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.unitPrice)}</p>
                                                    <p className="font-black text-slate-800">
                                                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.totalPrice || (item.unitPrice * item.coefficient))}
                                                    </p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-center py-20 bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200">
                                        <Database className="mx-auto text-slate-300 mb-4" size={48} />
                                        <p className="text-slate-500 font-medium">Nenhum detalhamento analítico <br />encontrado para esta composição.</p>
                                        <p className="text-[10px] text-slate-400 uppercase mt-2">Os itens podem não ter sido importados na base atual.</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="p-8 border-t bg-slate-50">
                            <button
                                onClick={() => setSelectedComp(null)}
                                className="w-full bg-slate-800 text-white py-4 rounded-xl font-bold hover:bg-slate-900 transition-all"
                            >
                                FECHAR DETALHAMENTO
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Resources;
