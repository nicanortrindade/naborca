
import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { InsumoService } from '../../lib/supabase-services/InsumoService';
import { Upload, Check, AlertCircle, X } from 'lucide-react';
import { clsx } from 'clsx';

interface ImporterProps {
    onClose: () => void;
    onSuccess: () => void;
}

const ResourceImporter: React.FC<ImporterProps> = ({ onClose, onSuccess }) => {
    const [step, setStep] = useState(1);
    const [file, setFile] = useState<File | null>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [previewData, setPreviewData] = useState<any[][]>([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [headers, setHeaders] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [sourceName, setSourceName] = useState('SINAPI');

    const [mapping, setMapping] = useState({
        code: -1,
        description: -1,
        unit: -1,
        price: -1
    });

    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const uploadedFile = e.target.files?.[0];
        if (!uploadedFile) return;

        setFile(uploadedFile);
        setLoading(true);

        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const bstr = evt.target?.result;
                const wb = XLSX.read(bstr, { type: 'binary' });
                const wsname = wb.SheetNames[0];
                const ws = wb.Sheets[wsname];
                // Read first 20 rows to preview
                const data = XLSX.utils.sheet_to_json(ws, { header: 1, range: 0, defval: "" }) as any[][];

                // Try to find the header row (row with most strings)
                let headerRowIdx = 0;
                let maxStrings = 0;
                data.slice(0, 10).forEach((row, idx) => {
                    const stringCount = row.filter((c: any) => typeof c === 'string' && c.length > 2).length;
                    if (stringCount > maxStrings) {
                        maxStrings = stringCount;
                        headerRowIdx = idx;
                    }
                });

                setHeaders(data[headerRowIdx]);
                setPreviewData(data.slice(headerRowIdx + 1, headerRowIdx + 6)); // Show 5 rows
                setStep(2);
            } catch (error) {
                console.error("Error reading file", error);
                alert("Erro ao ler arquivo. Verifique se é um Excel válido.");
            } finally {
                setLoading(false);
            }
        };
        reader.readAsBinaryString(uploadedFile);
    };

    const handleImport = async () => {
        if (mapping.code === -1 || mapping.price === -1) {
            alert("Por favor, mapeie pelo menos as colunas de Código e Preço.");
            return;
        }

        setLoading(true);
        try {
            const reader = new FileReader();
            reader.onload = async (evt) => {
                try {
                    const bstr = evt.target?.result;
                    const wb = XLSX.read(bstr, { type: 'binary' });
                    const wsname = wb.SheetNames[0];
                    const ws = wb.Sheets[wsname];
                    const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

                    const itemsToAdd = [];
                    let successCount = 0;
                    let errorCount = 0;

                    // Iterate through all rows and filter valid ones
                    for (let i = 0; i < data.length; i++) {
                        const row = data[i];
                        // Validation: Must have code and price
                        if (!row[mapping.code] || !row[mapping.price]) continue;

                        const rawPrice = row[mapping.price];
                        // Parse price: remove 'R$', replace ',' with '.'
                        let price = 0;
                        if (typeof rawPrice === 'number') price = rawPrice;
                        else if (typeof rawPrice === 'string') {
                            price = parseFloat(rawPrice.replace('R$', '').replace(/\./g, '').replace(',', '.').trim());
                        }

                        if (isNaN(price)) continue;

                        itemsToAdd.push({
                            codigo: String(row[mapping.code]).trim(),
                            descricao: mapping.description > -1 ? String(row[mapping.description]).trim() : 'Sem descrição',
                            unidade: mapping.unit > -1 ? String(row[mapping.unit]).trim() : 'UN',
                            preco: price,
                            fonte: sourceName,
                            tipo: (sourceName === 'SINAPI' && String(row[mapping.code]).length > 6 ? 'servicoUnitario' : 'material') as 'material' | 'maoDeObra' | 'equipamento' | 'servicoUnitario',
                            isOficial: true,
                            isEditavel: false
                        });
                    }

                    // Save items to Supabase one by one (or in batches)
                    for (const item of itemsToAdd) {
                        try {
                            await InsumoService.create(item);
                            successCount++;
                        } catch (error) {
                            console.error('Error importing item:', item.codigo, error);
                            errorCount++;
                        }
                    }

                    setLoading(false);

                    if (successCount > 0) {
                        alert(`Importação concluída!\n✅ ${successCount} itens importados\n${errorCount > 0 ? `❌ ${errorCount} itens com erro` : ''}`);
                        onSuccess();
                        onClose();
                    } else {
                        alert('Nenhum item foi importado. Verifique o arquivo e tente novamente.');
                    }
                } catch (error) {
                    console.error('Import error:', error);
                    alert("Erro ao processar arquivo: " + (error as Error).message);
                    setLoading(false);
                }
            };
            reader.readAsBinaryString(file!);
        } catch (error) {
            console.error('File read error:', error);
            alert("Erro ao ler arquivo.");
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                <div className="p-4 border-b border-slate-200 flex justify-between items-center">
                    <h3 className="font-bold text-lg text-slate-800">Importar Tabela de Preços</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X /></button>
                </div>

                <div className="p-6 overflow-y-auto flex-1">
                    {step === 1 && (
                        <div className="text-center space-y-6 py-8">
                            <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto">
                                <Upload size={32} />
                            </div>
                            <div>
                                <h4 className="text-lg font-medium text-slate-900">Selecione o arquivo Excel / CSV</h4>
                                <p className="text-slate-500 mt-1">
                                    Baixe a tabela oficial do SINAPI, SICRO ou ORSE e envie aqui.
                                </p>
                            </div>

                            <div className="max-w-xs mx-auto">
                                <label className="block text-left text-sm font-medium text-slate-700 mb-1">Nome da Fonte</label>
                                <select
                                    className="w-full border p-2 rounded mb-4"
                                    value={sourceName}
                                    onChange={e => setSourceName(e.target.value)}
                                >
                                    <option value="SINAPI">SINAPI (Caixa)</option>
                                    <option value="SICRO">SICRO (DNIT)</option>
                                    <option value="ORSE">ORSE</option>
                                    <option value="SEINFRA">SEINFRA</option>
                                    <option value="OUTRO">Outro / Próprio</option>
                                </select>
                            </div>

                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="bg-accent text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors"
                                disabled={loading}
                            >
                                {loading ? 'Carregando...' : 'Escolher Arquivo no Computador'}
                            </button>
                            <input
                                type="file"
                                ref={fileInputRef}
                                className="hidden"
                                accept=".xlsx,.xls,.csv"
                                onChange={handleFileUpload}
                            />
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-6">
                            <div className="bg-blue-50 p-4 rounded-lg flex gap-3 text-blue-800 text-sm">
                                <AlertCircle size={20} className="shrink-0" />
                                <p>Identificamos as colunas abaixo. Por favor, indique qual coluna corresponde a cada campo do sistema.</p>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                {[
                                    { label: 'Código', key: 'code' },
                                    { label: 'Descrição', key: 'description' },
                                    { label: 'Unidade', key: 'unit' },
                                    { label: 'Preço Unitário', key: 'price' },
                                ].map((field) => (
                                    <div key={field.key}>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{field.label}</label>
                                        <select
                                            // @ts-ignore
                                            value={mapping[field.key]}
                                            // @ts-ignore
                                            onChange={(e) => setMapping(prev => ({ ...prev, [field.key]: Number(e.target.value) }))}
                                            className="w-full border border-slate-300 rounded p-2 text-sm"
                                        >
                                            <option value={-1}>Selecione a coluna...</option>
                                            {headers.map((h, idx) => (
                                                <option key={idx} value={idx}>
                                                    {idx + 1}: {h || `Coluna ${idx + 1}`}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                ))}
                            </div>

                            <div className="border rounded-lg overflow-hidden">
                                <div className="bg-slate-50 p-2 text-xs font-bold text-slate-500 border-b">Pré-visualização (Primeiras 5 linhas)</div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr>
                                                {headers.map((h, i) => (
                                                    <th key={i} className={clsx(
                                                        "p-2 border-r last:border-r-0 font-medium text-slate-600 whitespace-nowrap bg-slate-100",
                                                        Object.values(mapping).includes(i) ? "bg-blue-100 text-blue-700" : ""
                                                    )}>
                                                        {h || `Col ${i + 1}`}
                                                        {Object.entries(mapping).find(([_, v]) => v === i) && (
                                                            <div className="text-[10px] uppercase text-blue-600 font-bold">
                                                                {Object.entries(mapping).find(([_, v]) => v === i)?.[0]}
                                                            </div>
                                                        )}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {previewData.map((row, rIdx) => (
                                                <tr key={rIdx} className="border-b last:border-b-0">
                                                    {row.map((cell: any, cIdx: number) => (
                                                        <td key={cIdx} className="p-2 border-r last:border-r-0 truncate max-w-[150px]">
                                                            {String(cell)}
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
                    {step === 2 && (
                        <button
                            onClick={() => { setStep(1); setFile(null); }}
                            className="text-slate-600 px-4 py-2 font-medium"
                        >
                            Voltar
                        </button>
                    )}
                    {step === 2 && (
                        <button
                            onClick={handleImport}
                            disabled={loading}
                            className="bg-green-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-green-700 flex items-center gap-2"
                        >
                            {loading ? 'Importando...' : (
                                <>
                                    <Check size={18} />
                                    Confirmar Importação
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ResourceImporter;
