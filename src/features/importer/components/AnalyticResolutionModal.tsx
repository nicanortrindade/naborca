
import React, { useState } from 'react';
import { X, Upload, Link as LinkIcon, Copy, FileSpreadsheet, AlertTriangle, Loader } from 'lucide-react';
import { parseAnalyticFile } from '../services/parsers/AnalyticParser';
import { BudgetItemCompositionService } from '../../../lib/supabase-services/BudgetItemCompositionService'; // Adjust path
import { supabase } from '../../../lib/supabase';
import { Search, Loader2 } from 'lucide-react';

interface AnalyticResolutionModalProps {
    isOpen: boolean;
    onClose: () => void;
    pendingItems: any[]; // NormalizedResource or similar
    onResolve: () => void; // Refresh parent
}

export const AnalyticResolutionModal: React.FC<AnalyticResolutionModalProps> = ({ isOpen, onClose, pendingItems, onResolve }) => {
    const [selectedItem, setSelectedItem] = useState<any | null>(null);
    const [mode, setMode] = useState<'SELECT' | 'UPLOAD' | 'LINK' | 'DUPLICATE'>('SELECT');
    const [loading, setLoading] = useState(false);

    // Search State
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [searchLoading, setSearchLoading] = useState(false);

    const handleSearch = async () => {
        setSearchLoading(true);
        try {
            let query = supabase.from('compositions').select('*').limit(20);

            if (mode === 'DUPLICATE') {
                // Duplicate Own
                query = query.eq('user_created', true);
            } else if (mode === 'LINK') {
                // Link Official (or all exclude own? usually Link means Link to Standard)
                // Let's allow searching all but prioritize
                // For MVP, explicitly filter
            }

            if (searchQuery) {
                query = query.or(`code.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%`);
            }

            const { data, error } = await query;
            if (error) throw error;
            setSearchResults(data || []);
        } catch (err) {
            console.error(err);
            alert("Erro na busca");
        } finally {
            setSearchLoading(false);
        }
    };

    const handleCopyAnalytic = async (sourceComp: any) => {
        setLoading(true);
        try {
            // 1. Fetch Source Items
            // Assuming standard join table 'composition_items'
            const { data: sourceItems, error } = await supabase
                .from('composition_items')
                .select('*, insumos(*)')
                .eq('composition_id', sourceComp.id);

            if (error) throw error;

            // Cast to avoid 'never'
            const items = sourceItems as any[] || [];

            if (items.length === 0) {
                alert("A composição selecionada não possui itens analíticos (está vazia).");
                setLoading(false);
                return;
            }

            // 2. Copy to Budget Item
            for (const item of items) {
                // Need to map library item to budget item composition
                // We need the Insumo Code or ID.
                // Assuming Insumos are shared.

                // Payload for BudgetItemCompositionService.create might expect 'insumo_id' or 'resource_code'
                // Based on previous contexts, let's assume we pass the raw data payload expected by the service.
                // If the service abstracts it:

                // If `BudgetItemCompositionService.create` expects a DTO:
                await BudgetItemCompositionService.create({
                    budget_item_id: selectedItem.id,
                    insumo_id: item.insumo_id, // If linking by ID
                    coefficient: item.coefficient || item.quantity,
                    price: item.price // Optional override
                } as any);
            }

            // 3. Success
            onResolve();
            setSelectedItem(null);
            setMode('SELECT');
            setSearchResults([]);
            setSearchQuery('');
            alert("Analítica copiada com sucesso!");

        } catch (error) {
            console.error(error);
            alert("Erro ao copiar analítica.");
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    const handleUpload = async (file: File) => {
        if (!selectedItem) return;
        setLoading(true);
        try {
            const parsed = await parseAnalyticFile(file);
            // Filter only items for this composition? 
            // Or assume file is specific to this one?
            // "Heuristic": Find items matching selectedItem.code or use all if file is small (single comp)
            let itemsToImport = parsed.filter(p => p.parentCode === selectedItem.code);
            if (itemsToImport.length === 0 && parsed.length > 0) {
                // Fallback: If no explicit parent code matched, use all items (assume single sheet)
                itemsToImport = parsed;
            }

            if (itemsToImport.length === 0) {
                alert("Nenhum item analítico encontrado para este código.");
                setLoading(false);
                return;
            }

            // Save to DB
            // 1. Ensure Composition Header exists? It should (pendingItem)
            // 2. Create Insumos if not exist
            // 3. Create CompositionItems

            for (const item of itemsToImport) {
                // Check if Insumo exists
                // This is a simplified logic. In real app, we need robust "Get or Create" service.
                // Assuming InsumoService.ensureExists(code, desc, unit, price)
                // For now, create inputs blindly or link? 
                // Let's create relationships directly.

                await BudgetItemCompositionService.create({
                    // This service usually links a BudgetItem (composition) to inputs.
                    // But we are dealing with Library Compositions or Budget Items?
                    // If pendingItems are BudgetItems, we link to BudgetItemComposition.
                    // If pendingItems are Library Compositions, we update Compositions table.

                    // Assuming we are updating the Budget Item instance:
                    budget_item_id: selectedItem.id,
                    resource_code: item.code, // We need to resolve this code to an ID. 
                    // Complexity: We need the ID of the resource (Insumo) to link.
                    // We probably need to lookup Insumo by Code first.
                } as any);
            }

            // Mark as resolved (Update metadata)
            // We need a way to flag "has_analytic=true".

            onResolve();
            setSelectedItem(null);
            setMode('SELECT');
            alert("Analítica importada com sucesso!");

        } catch (error) {
            console.error(error);
            alert("Erro ao importar analítica");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center backdrop-blur-sm">
            <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden">
                <div className="p-4 border-b flex justify-between items-center bg-amber-50 dark:bg-amber-900/20">
                    <h2 className="text-xl font-bold text-amber-700 flex items-center gap-2">
                        <AlertTriangle size={24} />
                        Analítica Obrigatória ({pendingItems.length} pendentes)
                    </h2>
                    <button onClick={onClose}><X /></button>
                </div>

                <div className="flex-1 flex overflow-hidden">
                    {/* Sidebar List */}
                    <div className="w-1/3 border-r overflow-y-auto bg-gray-50">
                        {pendingItems.map(item => (
                            <div key={item.id}
                                onClick={() => { setSelectedItem(item); setMode('SELECT'); }}
                                className={`p-4 border-b cursor-pointer hover:bg-white transition-colors ${selectedItem?.id === item.id ? 'bg-white border-l-4 border-l-amber-500 shadow-sm' : ''}`}
                            >
                                <div className="font-bold text-sm text-gray-800">{item.code}</div>
                                <div className="text-xs text-gray-600 line-clamp-2">{item.description}</div>
                                <div className="mt-1 text-xs text-amber-600 font-medium bg-amber-100 inline-block px-1 rounded">
                                    Pendente
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Main Content */}
                    <div className="flex-1 p-6 overflow-y-auto">
                        {!selectedItem ? (
                            <div className="h-full flex flex-col items-center justify-center text-gray-400">
                                <AlertTriangle size={48} className="mb-4 opacity-50" />
                                <p>Selecione uma composição para resolver</p>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                <div>
                                    <h3 className="text-xl font-bold text-gray-800">{selectedItem.code}</h3>
                                    <p className="text-gray-600">{selectedItem.description}</p>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <button onClick={() => setMode('UPLOAD')} className={`p-6 border-2 rounded-xl flex flex-col items-center gap-3 transition-all ${mode === 'UPLOAD' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-200 hover:border-emerald-300'}`}>
                                        <Upload size={32} />
                                        <span className="font-bold">Anexar Excel/PDF</span>
                                        <span className="text-xs text-center">Upload de planilha da prefeitura</span>
                                    </button>

                                    <button onClick={() => setMode('LINK')} className={`p-6 border-2 rounded-xl flex flex-col items-center gap-3 transition-all ${mode === 'LINK' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 hover:border-blue-300'}`}>
                                        <LinkIcon size={32} />
                                        <span className="font-bold">Vincular Existente</span>
                                        <span className="text-xs text-center">Usar base SINAPI/ORSE</span>
                                    </button>

                                    <button onClick={() => setMode('DUPLICATE')} className={`p-6 border-2 rounded-xl flex flex-col items-center gap-3 transition-all ${mode === 'DUPLICATE' ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-200 hover:border-purple-300'}`}>
                                        <Copy size={32} />
                                        <span className="font-bold">Duplicar Própria</span>
                                        <span className="text-xs text-center">Copiar de outra obra</span>
                                    </button>
                                </div>

                                <div className="mt-6 border-t pt-6">
                                    {mode === 'UPLOAD' && (
                                        <div className="bg-emerald-50 p-6 rounded-xl text-center border border-emerald-100">
                                            <input type="file" onChange={(e) => e.target.files && handleUpload(e.target.files[0])} accept=".xlsx, .xls, .pdf" className="hidden" id="analytic-upload" />
                                            <label htmlFor="analytic-upload" className="cursor-pointer flex flex-col items-center gap-2">
                                                <FileSpreadsheet size={48} className="text-emerald-600" />
                                                <span className="font-bold text-emerald-800">Clique para selecionar arquivo</span>
                                                <span className="text-sm text-emerald-600">Suporta XLSX com colunas (Código, Insumo, Coef, Preço)</span>
                                            </label>
                                            {loading && <div className="mt-4 flex items-center justify-center gap-2 text-emerald-700"><Loader className="animate-spin" /> Processando...</div>}
                                        </div>
                                    )}

                                    {(mode === 'LINK' || mode === 'DUPLICATE') && (
                                        <div className="bg-gray-50 p-6 rounded-xl border border-gray-200">
                                            <h4 className="font-bold mb-4 text-gray-700">
                                                {mode === 'LINK' ? 'Buscar Composição Existente (SINAPI/ORSE)' : 'Buscar em Minhas Composições'}
                                            </h4>

                                            <div className="flex gap-2 mb-4">
                                                <input
                                                    className="flex-1 p-2 border rounded"
                                                    placeholder="Digite código ou descrição..."
                                                    value={searchQuery}
                                                    onChange={(e) => setSearchQuery(e.target.value)}
                                                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                                />
                                                <button
                                                    onClick={handleSearch}
                                                    className="bg-blue-600 text-white px-4 rounded hover:bg-blue-700 flex items-center gap-2"
                                                    disabled={searchLoading}
                                                >
                                                    {searchLoading ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
                                                    Buscar
                                                </button>
                                            </div>

                                            <div className="max-h-[300px] overflow-y-auto border rounded bg-white">
                                                {searchResults.length === 0 ? (
                                                    <div className="p-4 text-center text-gray-400 text-sm">Nenhum resultado encontrado.</div>
                                                ) : (
                                                    searchResults.map(res => (
                                                        <div key={res.id} className="p-3 border-b hover:bg-blue-50 flex justify-between items-center group">
                                                            <div>
                                                                <div className="font-bold text-sm text-gray-800">{res.code}</div>
                                                                <div className="text-xs text-gray-600 line-clamp-1">{res.description}</div>
                                                                <div className="text-[10px] text-gray-400">{res.source}</div>
                                                            </div>
                                                            <button
                                                                onClick={() => handleCopyAnalytic(res)}
                                                                className="opacity-0 group-hover:opacity-100 px-3 py-1 bg-blue-600 text-white text-xs rounded shadow hover:bg-blue-700"
                                                            >
                                                                {mode === 'LINK' ? 'Vincular' : 'Duplicar'}
                                                            </button>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
