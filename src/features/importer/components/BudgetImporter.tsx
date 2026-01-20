
import React, { useState } from 'react';
import { X, Upload, FileSpreadsheet, Check, AlertTriangle, Loader } from 'lucide-react';
import { parseExcelFile } from '../services/parsers/ExcelParser';
import { ImportResolutionService } from '../services/ImportResolutionService';
import { AbsorberService } from '../services/AbsorberService';
import type { ParsedItem, ResolvedItem, ImportSessionState } from '../types';

interface BudgetImporterProps {
    onClose: () => void;
    onImport: (items: any[]) => Promise<void>;
}

import { supabase } from '../../../lib/supabase'; // Import supabase for uniqueness check

export const BudgetImporter: React.FC<BudgetImporterProps> = ({ onClose, onImport }) => {
    const [step, setStep] = useState<'UPLOAD' | 'CONFIG' | 'REVIEW' | 'IMPORTING'>('UPLOAD');

    // Helper to find next suffix
    const generateIncrementalCode = async (baseCode: string): Promise<string> => {
        let suffix = 1;
        let candidate = `${baseCode}-${String(suffix).padStart(2, '0')}`;

        while (true) {
            // Check check against resolvedItems first (local uniqueness)
            const localConflict = resolvedItems.some(i => i.finalCode === candidate);
            if (!localConflict) {
                // Check against DB
                const { data } = await supabase.from('compositions').select('id').eq('code', candidate).single();
                if (!data) break; // Unique!
            }
            suffix++;
            candidate = `${baseCode}-${String(suffix).padStart(2, '0')}`;
            if (suffix > 99) break; // Circuit breaker
        }
        return candidate;
    };


    const handleCreateNewConflict = async (conf: ResolvedItem) => {
        const newCode = await generateIncrementalCode(conf.finalCode);
        const newResolved: ResolvedItem[] = resolvedItems.map(i =>
            i === conf ? { ...i, status: 'NEW' as const, selectedAction: 'CREATE_NEW_CODE' as const, conflictType: 'NONE' as const, finalCode: newCode } : i
        );
        setResolvedItems(newResolved);
        setConflicts(newResolved.filter(i => i.status === 'CONFLICT'));
    };
    const [file, setFile] = useState<File | null>(null);
    const [session, setSession] = useState<ImportSessionState>({
        fileName: '',
        referenceDate: new Date().toISOString().slice(0, 7), // YYYY-MM
        baseMode: 'MISTA',
        items: [],
        step: 'UPLOAD',
        isProcessing: false
    });

    const [resolvedItems, setResolvedItems] = useState<ResolvedItem[]>([]);
    const [conflicts, setConflicts] = useState<ResolvedItem[]>([]);

    const [isDryRun, setIsDryRun] = useState(false);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
            setSession(prev => ({ ...prev, fileName: e.target.files![0].name }));
            setStep('CONFIG');
        }
    };

    const handleParseAndResolve = async () => {
        if (!file) return;
        setStep('IMPORTING'); // Loading state
        try {
            // 1. Parse
            let parsed: ParsedItem[] = [];
            if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
                parsed = await parseExcelFile(file);
            } else if (file.name.endsWith('.pdf')) {
                alert("PDF ainda não suportado neste MVP");
                setStep('CONFIG');
                return;
            } else {
                alert("Formato não suportado");
                setStep('CONFIG');
                return;
            }

            // 2. Resolve
            const resolved = await ImportResolutionService.resolveItems(parsed, session);
            setResolvedItems(resolved);

            // 3. Detect Conflicts
            const conflictItems = resolved.filter(i => i.status === 'CONFLICT');
            setConflicts(conflictItems);

            setStep('REVIEW');
        } catch (error) {
            console.error(error);
            alert("Erro ao processar arquivo");
            setStep('CONFIG');
        }
    };

    const handleFinish = async () => {
        if (resolvedItems.length === 0) return;

        if (isDryRun) {
            console.info("NO WRITES");
            alert(`Simulação Concluída!\n\nRelatório:\n- Total: ${resolvedItems.length}\n- Vinculados: ${resolvedItems.filter(i => i.status === 'LINKED').length}\n- Novos: ${resolvedItems.filter(i => i.status === 'NEW').length}\n\nNenhum dado foi salvo.`);
            onClose();
            return;
        }

        setStep('IMPORTING');
        try {
            // 1. Absorb New Items
            // Filter user selected actions if any
            const absorbed = await AbsorberService.absorbItems(resolvedItems, session.referenceDate);

            // 2. Convert to Budget Items structure
            const budgetItems = absorbed.map((item) => ({
                id: crypto.randomUUID(), // Temp ID
                itemNumber: item.itemNumber,
                type: (item.code === '' || item.description === '') ? 'group' : 'item',
                code: item.finalCode,
                description: item.finalDescription,
                unit: item.unit,
                quantity: item.quantity,
                unitPrice: item.dbPrice || item.unitPrice, // Use DB price if linked
                totalPrice: item.totalPrice, // Or calculate

                // Fields for BudgetEditor
                source: item.detectedSource || 'IMPORT',
                level: item.level,

                // Linkage
                budgetItemId: item.dbId, // If Linked
                resourceType: item.dbType, // INPUT / COMPOSITION

                // SSOT fields
                pesoRaw: 0, // Calculated by Editor
            }));

            // 3. Send to Parent
            await onImport(budgetItems);
            onClose();

        } catch (error) {
            console.error("Critical Error importing", error);
            alert("Erro crítico na importação.");
            setStep('REVIEW');
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center backdrop-blur-sm">
            <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="p-4 border-b border-gray-200 dark:border-zinc-800 flex justify-between items-center">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <Upload size={20} />
                        Importar Orçamento
                    </h2>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {step === 'UPLOAD' && (
                        <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-gray-300 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer relative">
                            <input type="file" onChange={handleFileChange} className="absolute inset-0 opacity-0 cursor-pointer" accept=".xlsx, .xls, .pdf" />
                            <FileSpreadsheet className="w-16 h-16 text-emerald-600 mb-4" />
                            <p className="text-lg font-medium text-gray-700">Arraste sua planilha ou PDF aqui</p>
                            <p className="text-sm text-gray-500 mt-2">Suporta .xlsx, .xls, .pdf (Sintético/Analítico)</p>
                        </div>
                    )}

                    {step === 'CONFIG' && (
                        <div className="space-y-6">
                            <div className="bg-emerald-50 p-4 rounded-lg flex items-center gap-3 text-emerald-800">
                                <Check size={20} />
                                <span className="font-medium">Arquivo selecionado: {session.fileName}</span>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1">Competência de Referência</label>
                                    <input type="month" className="w-full p-2 border rounded"
                                        value={session.referenceDate}
                                        onChange={(e) => setSession({ ...session, referenceDate: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">Modo de Base</label>
                                    <select className="w-full p-2 border rounded"
                                        value={session.baseMode}
                                        onChange={(e) => setSession({ ...session, baseMode: e.target.value as any })}
                                    >
                                        <option value="MISTA">Mista (Detectar)</option>
                                        <option value="FIXA">Fixa (Forçar)</option>
                                    </select>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 mt-4 bg-gray-50 p-3 rounded border border-gray-200">
                                <input
                                    type="checkbox"
                                    id="dryRun"
                                    checked={isDryRun}
                                    onChange={e => setIsDryRun(e.target.checked)}
                                    className="w-4 h-4 text-emerald-600 rounded cursor-pointer"
                                />
                                <label htmlFor="dryRun" className="text-sm font-medium text-gray-700 cursor-pointer select-none">
                                    Simular importação (Validar sem gravar no banco)
                                </label>
                            </div>

                            <div className="flex justify-end gap-2 pt-4">
                                <button className="px-4 py-2 border rounded" onClick={() => setStep('UPLOAD')}>Voltar</button>
                                <button className="px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700"
                                    onClick={handleParseAndResolve}>
                                    Processar Arquivo
                                </button>
                            </div>
                        </div>
                    )}

                    {step === 'IMPORTING' && (
                        <div className="flex flex-col items-center justify-center h-64">
                            <Loader className="w-12 h-12 text-blue-600 animate-spin mb-4" />
                            <p className="text-lg font-medium text-gray-700">Processando Inteligência...</p>
                            <p className="text-sm text-gray-500">Normalizando dados, resolvendo conflitos e absorvendo recursos.</p>
                        </div>
                    )}

                    {step === 'REVIEW' && (
                        <div className="space-y-6">
                            <div className="grid grid-cols-4 gap-4">
                                <div className="bg-blue-50 p-4 rounded text-center">
                                    <div className="text-2xl font-bold text-blue-700">{resolvedItems.length}</div>
                                    <div className="text-xs text-blue-600 font-bold uppercase">Itens Totais</div>
                                </div>
                                <div className="bg-green-50 p-4 rounded text-center">
                                    <div className="text-2xl font-bold text-green-700">{resolvedItems.filter(i => i.status === 'LINKED').length}</div>
                                    <div className="text-xs text-green-600 font-bold uppercase">Linkados</div>
                                </div>
                                <div className="bg-yellow-50 p-4 rounded text-center">
                                    <div className="text-2xl font-bold text-yellow-700">{resolvedItems.filter(i => i.status === 'NEW').length}</div>
                                    <div className="text-xs text-yellow-600 font-bold uppercase">Novos (Absorver)</div>
                                </div>
                                <div className="bg-red-50 p-4 rounded text-center">
                                    <div className="text-2xl font-bold text-red-700">{conflicts.length}</div>
                                    <div className="text-xs text-red-600 font-bold uppercase">Conflitos</div>
                                </div>
                            </div>

                            {conflicts.length > 0 && (
                                <div className="border border-red-200 rounded-lg p-4 bg-red-50">
                                    <h3 className="font-bold text-red-800 flex items-center gap-2 mb-2">
                                        <AlertTriangle size={16} />
                                        Conflitos Detectados ({conflicts.length})
                                    </h3>
                                    <p className="text-sm text-red-700 mb-4">
                                        Existem composições próprias com o mesmo código mas descrição diferente.
                                        Você deve decidir como resolver: <b>Substituir</b>, <b>Criar Nova (com sufixo)</b> ou <b>Ignorar</b>.
                                    </p>

                                    <div className="max-h-48 overflow-y-auto space-y-2">
                                        {conflicts.map((conf, cIdx) => (
                                            <div key={cIdx} className="bg-white p-3 rounded border border-red-100 text-sm shadow-sm">
                                                <div className="font-bold text-gray-800">{conf.finalCode}</div>
                                                <div className="grid grid-cols-2 gap-2 my-1 text-xs">
                                                    <div className="text-red-600">
                                                        <span className="font-bold">Planilha:</span> {conf.description}
                                                    </div>
                                                    <div className="text-gray-600">
                                                        <span className="font-bold">Existente:</span> {conf.dbDescription}
                                                    </div>
                                                </div>
                                                <div className="flex gap-2 mt-2">
                                                    <button
                                                        onClick={() => {
                                                            const newResolved: ResolvedItem[] = resolvedItems.map(i =>
                                                                i === conf ? { ...i, status: 'LINKED' as const, selectedAction: 'OVERWRITE_EXISTING' as const, conflictType: 'NONE' as const } : i
                                                            );
                                                            setResolvedItems(newResolved);
                                                            setConflicts(newResolved.filter(i => i.status === 'CONFLICT'));
                                                        }}
                                                        className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs hover:bg-blue-200"
                                                    >
                                                        Substituir (Atualizar)
                                                    </button>
                                                    <button
                                                        onClick={() => handleCreateNewConflict(conf)}
                                                        className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded text-xs hover:bg-yellow-200"
                                                    >
                                                        Criar Nova {`(${conf.finalCode}-XX)`}
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            const newResolved: ResolvedItem[] = resolvedItems.map(i =>
                                                                i === conf ? { ...i, status: 'SKIPPED' as const, selectedAction: 'IGNORE' as const, conflictType: 'NONE' as const } : i
                                                            );
                                                            setResolvedItems(newResolved);
                                                            setConflicts(newResolved.filter(i => i.status === 'CONFLICT'));
                                                        }}
                                                        className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs hover:bg-gray-200"
                                                    >
                                                        Ignorar
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="max-h-64 overflow-y-auto border rounded text-sm">
                                <table className="w-full text-left">
                                    <thead className="bg-gray-50 sticky top-0">
                                        <tr>
                                            <th className="p-2 border-b">Item</th>
                                            <th className="p-2 border-b">Código</th>
                                            <th className="p-2 border-b">Descrição</th>
                                            <th className="p-2 border-b">Ação</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {resolvedItems.slice(0, 100).map((item, idx) => (
                                            <tr key={idx} className="hover:bg-gray-50">
                                                <td className="p-2 border-b">{item.itemNumber}</td>
                                                <td className="p-2 border-b">{item.finalCode}</td>
                                                <td className="p-2 border-b truncate max-w-xs">{item.finalDescription}</td>
                                                <td className="p-2 border-b">
                                                    <span className={`text-xs px-2 py-1 rounded font-bold ${item.status === 'LINKED' ? 'bg-green-100 text-green-800' :
                                                        item.status === 'NEW' ? 'bg-yellow-100 text-yellow-800' :
                                                            'bg-red-100 text-red-800'
                                                        }`}>
                                                        {item.status}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                        {resolvedItems.length > 100 && (
                                            <tr><td colSpan={4} className="p-2 text-center text-gray-500">... e mais {resolvedItems.length - 100} itens</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            <div className="flex justify-end gap-2 pt-4 border-t">
                                <button className="px-4 py-2 border rounded" onClick={() => setStep('CONFIG')}>Voltar</button>
                                <div className="text-right text-xs text-orange-600 mb-2 font-medium">
                                    {resolvedItems.some(i => i.status === 'NEW' && i.isComposition && !i.compositionHasAnalytic) && (
                                        <span className="flex items-center justify-end gap-1">
                                            <AlertTriangle size={12} /> Atenção: Composições sem analítica serão salvas como &quot;Cruas&quot;.
                                        </span>
                                    )}
                                </div>
                                <button className="px-6 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 shadow-lg font-bold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                    onClick={handleFinish}
                                    disabled={conflicts.length > 0}
                                >
                                    <Check size={18} />
                                    {isDryRun ? "Concluir Simulação" : "Confirmar Importação"}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div >
    );
};
