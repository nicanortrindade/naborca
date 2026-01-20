import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Database, Upload, RefreshCcw, CheckCircle, XCircle, Clock, AlertTriangle, FileSpreadsheet, Search, ChevronDown, ChevronUp, Loader, Info } from 'lucide-react';
import { SinapiService } from '../lib/supabase-services/SinapiService';
import type { SinapiPriceTable, SinapiImportRun } from '../lib/supabase-services/SinapiService';
import { ingestSinapiMultipleFiles, validateSinapiFiles, detectSinapiFileType } from '../utils/sinapiIngestion';
import type { IngestionProgress, IngestionResult, SinapiFileType } from '../utils/sinapiIngestion';

const SinapiImporter = () => {
    const navigate = useNavigate();

    // State
    const [loading, setLoading] = useState(false);
    const [showMocks, setShowMocks] = useState(false);
    const [stats, setStats] = useState<{
        price_tables: number;
        inputs: number;
        compositions: number;
        ufs: string[];
        latest_competence: string | null;
        mock_count: number;
    }>({ price_tables: 0, inputs: 0, compositions: 0, ufs: [], latest_competence: null, mock_count: 0 });
    const [priceTables, setPriceTables] = useState<SinapiPriceTable[]>([]);
    const [importRuns, setImportRuns] = useState<SinapiImportRun[]>([]);

    // Import Form State
    const [selectedUf] = useState('BA');
    const [selectedYear] = useState(2025);
    const [selectedMonth, setSelectedMonth] = useState(1);
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [fileValidation, setFileValidation] = useState<{
        valid: boolean;
        missing: SinapiFileType[];
        detected: Array<{ type: SinapiFileType; file: File }>;
    } | null>(null);


    // Import Progress
    const [isImporting, setIsImporting] = useState(false);
    const [importProgress, setImportProgress] = useState<IngestionProgress | null>(null);
    const [importResult, setImportResult] = useState<IngestionResult | null>(null);
    const [importLogs, setImportLogs] = useState<string[]>([]);
    const [showLogs, setShowLogs] = useState(false);

    // Search State
    const [searchQuery, setSearchQuery] = useState('');
    const [searchType, setSearchType] = useState<'inputs' | 'compositions'>('inputs');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [isSearching, setIsSearching] = useState(false);

    // Load initial data
    useEffect(() => {
        loadData();
    }, [showMocks]);

    const loadData = async () => {
        setLoading(true);
        try {
            const [statsData, tablesData, runsData] = await Promise.all([
                SinapiService.getStats(showMocks),
                SinapiService.getPriceTables({ uf: 'BA', includeMock: showMocks }),
                SinapiService.getImportRuns(10)
            ]);
            setStats(statsData);
            setPriceTables(tablesData);
            setImportRuns(runsData);
        } catch (error) {
            console.error('Erro ao carregar dados:', error);
        } finally {
            setLoading(false);
        }
    };
    // Handler para seleção de arquivos múltiplos
    const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
        const fileList = e.target.files;
        if (!fileList) return;

        const files = Array.from(fileList);
        setSelectedFiles(files);

        // Detectar e mapear arquivos
        const detected: Record<SinapiFileType, File | null> = {
            REFERENCIA: null,
            FAMILIAS: null,
            MAO_DE_OBRA: null,
            MANUTENCOES: null
        };

        files.forEach(file => {
            const type = detectSinapiFileType(file.name);
            if (type) {
                if (detected[type]) {
                    console.warn(`[SINAPI FILE] Duplicado detectado: ${type}, mantendo ${file.name}`);
                }
                detected[type] = file;
                console.log(`[SINAPI FILE DETECTED] ${type} → ${file.name}`);
            } else {
                console.warn(`[SINAPI FILE WARNING] Arquivo não reconhecido: ${file.name}`);
            }
        });

        // Calcular validation
        const validation = validateSinapiFiles(files);
        setFileValidation(validation);
    };

    const handleImport = async () => {
        if (!fileValidation?.valid) {
            alert(`Faltam arquivos obrigatórios: ${fileValidation?.missing.join(', ')}`);
            return;
        }

        setIsImporting(true);
        setImportResult(null);
        setImportLogs([]);
        setShowLogs(true);

        const competence = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;

        try {
            // Log info dos arquivos
            fileValidation.detected.forEach(({ type, file }) => {
                setImportLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${type}: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`]);
            });

            // Criar registro de execução
            const run = await SinapiService.createImportRun({
                uf: selectedUf,
                year: selectedYear,
                months: [selectedMonth],
                regimes: ['DESONERADO', 'NAO_DESONERADO'],
                status: 'RUNNING'
            });

            setImportLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] Iniciando importação múltipla ${competence}...`]);
            console.log('[SINAPI IMPORT] INICIANDO ORDEM CONTROLADA');

            // Executar ingestão com arquivos múltiplos
            const result = await ingestSinapiMultipleFiles(
                selectedFiles,
                selectedUf,
                competence,
                (progress) => {
                    setImportProgress(progress);
                    setImportLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${progress.message}`]);
                }
            );

            setImportResult(result);

            // Atualizar registro de execução
            await SinapiService.updateImportRun(run.id, {
                status: result.success ? 'SUCCESS' : 'PARTIAL',
                counts: result.counts,
                logs: result.logs.join('\n'),
                finished_at: new Date().toISOString()
            });

            if (result.errors.length > 0) {
                result.errors.forEach(err => {
                    setImportLogs(prev => [...prev, `[ERRO] ${err}`]);
                });
            }

            setImportLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] Importação concluída!`]);
            setImportLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] Total: ${result.counts.inputs} insumos, ${result.counts.compositions} composições`]);

            alert('Importação concluída com sucesso!');
            await loadData();

        } catch (error: any) {
            console.error('[SINAPI IMPORT] ERRO:', error);

            const isRlsError = error.message?.includes('row-level security') ||
                error.message?.includes('permission denied') ||
                JSON.stringify(error).includes('violates row-level security');

            const msg = isRlsError
                ? 'ERRO DE PERMISSÃO: Execute o script "sinapi_secure_rpc.sql" no SQL Editor do Supabase para habilitar a ingestão segura.'
                : error.message || 'Erro desconhecido';

            setImportLogs(prev => [...prev, `[ERRO FATAL] ${msg}`]);
            alert(`Erro na importação: ${msg}`);
        } finally {
            setIsImporting(false);
            setImportProgress(null);
        }
    };

    const handleSearch = async () => {

        if (!searchQuery.trim()) return;

        setIsSearching(true);
        try {
            const filters = {
                uf: 'BA',
                competence: priceTables[0]?.competence,
                regime: 'DESONERADO' as const
            };

            if (searchType === 'inputs') {
                const results = await SinapiService.searchInputs(searchQuery, filters);
                setSearchResults(results);
            } else {
                const results = await SinapiService.searchCompositions(searchQuery, filters);
                setSearchResults(results);
            }
        } catch (error) {
            console.error('Erro na busca:', error);
        } finally {
            setIsSearching(false);
        }
    };

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'SUCCESS':
                return <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800"><CheckCircle size={12} /> Sucesso</span>;
            case 'RUNNING':
                return <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800"><Loader size={12} className="animate-spin" /> Executando</span>;
            case 'ERROR':
                return <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800"><XCircle size={12} /> Erro</span>;
            case 'PARTIAL':
                return <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800"><AlertTriangle size={12} /> Parcial</span>;
            default:
                return <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800"><Clock size={12} /> Pendente</span>;
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
                <div className="max-w-7xl mx-auto px-4 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <button onClick={() => navigate('/dashboard')} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
                                <ArrowLeft size={20} className="text-slate-600" />
                            </button>
                            <div>
                                <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                                    <Database size={24} className="text-blue-600" />
                                    SINAPI Importador
                                </h1>
                                <p className="text-sm text-slate-500">Gerencie a base de referência SINAPI/CAIXA</p>
                            </div>
                        </div>
                        <button onClick={loadData} className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors">
                            <RefreshCcw size={16} />
                            Atualizar
                        </button>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="flex items-center justify-center p-12">
                    <Loader className="w-8 h-8 text-blue-600 animate-spin" />
                    <span className="ml-2 text-slate-600 font-medium">Carregando dados...</span>
                </div>
            ) : (
                <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">

                    {/* Mock Control Panel */}
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <AlertTriangle size={20} className="text-amber-600" />
                                <div>
                                    <p className="font-semibold text-amber-800">Controle de Bases Mock/Legado</p>
                                    <p className="text-xs text-amber-700">
                                        {stats?.mock_count ? `${stats.mock_count} base(s) marcada(s) como mock` : 'Nenhuma base mock'}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={showMocks}
                                        onChange={(e) => setShowMocks(e.target.checked)}
                                        className="rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                                    />
                                    <span className="text-sm text-amber-800 font-medium">Mostrar bases mock</span>
                                </label>
                                <button
                                    onClick={async () => {
                                        if (confirm('Marcar TODAS as tabelas atuais como MOCK/LEGADO? Use isso antes de importar a base oficial.')) {
                                            const count = await SinapiService.markAllExistingAsMock();
                                            alert(`${count} tabela(s) marcada(s) como legado.`);
                                            loadData();
                                        }
                                    }}
                                    className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 transition-colors"
                                >
                                    Marcar atuais como MOCK
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Stats Cards */}
                    {stats && (
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                                        <FileSpreadsheet size={20} className="text-blue-600" />
                                    </div>
                                    <div>
                                        <p className="text-2xl font-bold text-slate-800">{stats.price_tables}</p>
                                        <p className="text-xs text-slate-500">Tabelas de Preço</p>
                                    </div>
                                </div>
                            </div>
                            <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                                        <Database size={20} className="text-green-600" />
                                    </div>
                                    <div>
                                        <p className="text-2xl font-bold text-slate-800">{stats.inputs.toLocaleString()}</p>
                                        <p className="text-xs text-slate-500">Insumos</p>
                                    </div>
                                </div>
                            </div>
                            <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                                        <Database size={20} className="text-purple-600" />
                                    </div>
                                    <div>
                                        <p className="text-2xl font-bold text-slate-800">{stats.compositions.toLocaleString()}</p>
                                        <p className="text-xs text-slate-500">Composições</p>
                                    </div>
                                </div>
                            </div>
                            <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
                                        <Clock size={20} className="text-amber-600" />
                                    </div>
                                    <div>
                                        <p className="text-lg font-bold text-slate-800">{stats.latest_competence || '-'}</p>
                                        <p className="text-xs text-slate-500">Última Competência</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Import Form */}
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
                            <div className="p-4 border-b border-slate-200">
                                <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                                    <Upload size={18} className="text-blue-600" />
                                    Importar Dados SINAPI
                                </h2>
                            </div>
                            <div className="p-4 space-y-4">
                                <div className="grid grid-cols-3 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">UF</label>
                                        <input
                                            type="text"
                                            value={selectedUf}
                                            disabled
                                            className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-600"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Ano</label>
                                        <input
                                            type="number"
                                            value={selectedYear}
                                            disabled
                                            className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-600"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Mês</label>
                                        <select
                                            value={selectedMonth}
                                            onChange={(e) => setSelectedMonth(Number(e.target.value))}
                                            className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                                        >
                                            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                                                <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-2">⚠️ NOVO FORMATO 2025</label>
                                    <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                                        <div className="flex items-start gap-2">
                                            <Info size={16} className="text-amber-600 mt-0.5 shrink-0" />
                                            <div className="text-xs text-amber-800 space-y-1">
                                                <p className="font-semibold">Arquivo único com múltiplas abas</p>
                                                <p>SINAPI_Referência_2025_01.xlsx contém:</p>
                                                <ul className="list-disc ml-4 mt-1">
                                                    <li>ISD → Insumos Não Desonerados</li>
                                                    <li>ICD → Insumos Desonerados</li>
                                                    <li>CSD → Composições Não Desoneradas</li>
                                                    <li>CCD → Composições Desoneradas</li>
                                                    <li>Analítico → Estrutura das composições (ambos regimes)</li>
                                                </ul>
                                                <p className="mt-2 font-medium">O sistema detecta automaticamente o regime de cada aba!</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-2">
                                        📁 Selecione os 4 Arquivos SINAPI 2025
                                    </label>
                                    <input
                                        type="file"
                                        accept=".xlsx"
                                        multiple
                                        onChange={handleFilesSelected}
                                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                                    />

                                    {/* Status dos arquivos obrigatórios */}
                                    <div className="mt-4 space-y-2">
                                        <p className="text-xs font-medium text-slate-700 mb-2">Arquivos Requeridos:</p>
                                        {(['REFERENCIA', 'FAMILIAS', 'MAO_DE_OBRA', 'MANUTENCOES'] as const).map(type => {
                                            const file = fileValidation?.detected.find(d => d.type === type)?.file;

                                            return (
                                                <div key={type} className={`flex items-center gap-2 text-xs p-2 rounded ${file ? 'bg-green-50' : 'bg-slate-50'}`}>
                                                    {file ? (
                                                        <>
                                                            <CheckCircle className="w-4 h-4 text-green-600" />
                                                            <span className="font-medium text-green-700">{type}:</span>
                                                            <span className="text-slate-600">{file.name}</span>
                                                            <span className="text-slate-400 ml-auto">({(file.size / 1024 / 1024).toFixed(2)} MB)</span>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <XCircle className="w-4 h-4 text-slate-400" />
                                                            <span className="font-medium text-slate-500">{type}:</span>
                                                            <span className="text-slate-400">Faltando</span>
                                                        </>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {fileValidation && !fileValidation.valid && (
                                        <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                                            <p className="text-xs text-amber-800 font-medium">
                                                ⚠️ Faltam arquivos: {fileValidation.missing.join(', ')}
                                            </p>
                                        </div>
                                    )}

                                    <p className="text-xs text-slate-500 mt-3">
                                        Baixe todos os 4 arquivos oficiais do site da CAIXA e selecione de uma vez<br />
                                        ✅ Processamento 100% local - sem upload para servidor externo
                                    </p>
                                </div>

                                <button
                                    onClick={handleImport}
                                    disabled={isImporting || !fileValidation?.valid}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                                >
                                    {isImporting ? (
                                        <>
                                            <Loader size={18} className="animate-spin" />
                                            Importando...
                                        </>
                                    ) : (
                                        <>
                                            <Upload size={18} />
                                            Iniciar Importação
                                        </>
                                    )}
                                </button>

                                {/* Progress */}
                                {importProgress && (
                                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm font-medium text-slate-700">{importProgress.message}</span>
                                            <span className="text-sm text-slate-500">{importProgress.current}/{importProgress.total}</span>
                                        </div>
                                        <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-blue-600 transition-all duration-300"
                                                style={{ width: `${(importProgress.current / importProgress.total) * 100}% ` }}
                                            />
                                        </div>
                                    </div>
                                )}

                                {/* Result */}
                                {importResult && (
                                    <div className={`p - 4 rounded - lg border ${importResult.success ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'} `}>
                                        <div className="flex items-center gap-2 mb-2">
                                            {importResult.success ? (
                                                <CheckCircle size={18} className="text-green-600" />
                                            ) : (
                                                <AlertTriangle size={18} className="text-yellow-600" />
                                            )}
                                            <span className="font-medium text-slate-800">
                                                {importResult.success ? 'Importação concluída!' : 'Importação parcial'}
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2 text-sm">
                                            <div className="text-center p-2 bg-white/50 rounded">
                                                <p className="font-bold text-slate-800">{importResult.counts.inputs}</p>
                                                <p className="text-xs text-slate-500">Insumos</p>
                                            </div>
                                            <div className="text-center p-2 bg-white/50 rounded">
                                                <p className="font-bold text-slate-800">{importResult.counts.compositions}</p>
                                                <p className="text-xs text-slate-500">Composições</p>
                                            </div>
                                            <div className="text-center p-2 bg-white/50 rounded">
                                                <p className="font-bold text-slate-800">{importResult.counts.composition_items}</p>
                                                <p className="text-xs text-slate-500">Itens CPU</p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Logs */}
                                <div>
                                    <button
                                        onClick={() => setShowLogs(!showLogs)}
                                        className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-800"
                                    >
                                        {showLogs ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                        {showLogs ? 'Ocultar' : 'Mostrar'} logs
                                    </button>
                                    {showLogs && importLogs.length > 0 && (
                                        <div className="mt-2 p-3 bg-slate-900 rounded-lg max-h-48 overflow-y-auto">
                                            {importLogs.slice(-50).map((log, i) => (
                                                <p key={i} className={`text - xs font - mono ${log.includes('ERRO') ? 'text-red-400' : 'text-green-400'} `}>
                                                    {log}
                                                </p>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Search & Browse */}
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
                            <div className="p-4 border-b border-slate-200">
                                <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                                    <Search size={18} className="text-green-600" />
                                    Consultar Base SINAPI
                                </h2>
                            </div>
                            <div className="p-4 space-y-4">
                                <div className="flex gap-2">
                                    <select
                                        value={searchType}
                                        onChange={(e) => setSearchType(e.target.value as any)}
                                        className="px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-green-500"
                                    >
                                        <option value="inputs">Insumos</option>
                                        <option value="compositions">Composições</option>
                                    </select>
                                    <div className="flex-1 relative">
                                        <input
                                            type="text"
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                            placeholder="Buscar por código ou descrição..."
                                            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-green-500"
                                        />
                                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    </div>
                                    <button
                                        onClick={handleSearch}
                                        disabled={isSearching}
                                        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                                    >
                                        {isSearching ? <Loader size={16} className="animate-spin" /> : 'Buscar'}
                                    </button>
                                </div>

                                {/* Search Results */}
                                <div className="space-y-2 max-h-[500px] overflow-y-auto">
                                    {searchResults.length === 0 && !isSearching && (
                                        <div className="text-center py-8 text-slate-500">
                                            <Database size={32} className="mx-auto mb-2 opacity-50" />
                                            <p className="text-sm">Faça uma busca para ver resultados</p>
                                        </div>
                                    )}
                                    {searchResults.map((item, idx) => (
                                        <div key={idx} className="p-3 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                                            <div className="flex items-start justify-between gap-4">
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-xs font-mono px-2 py-0.5 bg-slate-100 rounded text-slate-600">{item.code}</span>
                                                        {item.unit && <span className="text-xs text-slate-400">{item.unit}</span>}
                                                    </div>
                                                    <p className="text-sm text-slate-700 mt-1 line-clamp-2">{item.description}</p>
                                                </div>
                                                {item.price !== undefined && item.price !== null && (
                                                    <div className="text-right shrink-0">
                                                        <p className="text-sm font-semibold text-green-700">{formatCurrency(item.price)}</p>
                                                        {item.competence && (
                                                            <p className="text-xs text-slate-400">{item.competence}</p>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Import History */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
                        <div className="p-4 border-b border-slate-200">
                            <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                                <Clock size={18} className="text-amber-600" />
                                Histórico de Importações
                            </h2>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-slate-50">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Data/Hora</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">UF</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Ano</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Meses</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Regimes</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Status</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Contagens</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200">
                                    {importRuns.length === 0 && (
                                        <tr>
                                            <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                                                Nenhuma importação registrada
                                            </td>
                                        </tr>
                                    )}
                                    {importRuns.map((run) => (
                                        <tr key={run.id} className="hover:bg-slate-50">
                                            <td className="px-4 py-3 text-sm text-slate-600">
                                                {new Date(run.started_at).toLocaleString('pt-BR')}
                                            </td>
                                            <td className="px-4 py-3 text-sm font-medium text-slate-800">{run.uf}</td>
                                            <td className="px-4 py-3 text-sm text-slate-600">{run.year}</td>
                                            <td className="px-4 py-3 text-sm text-slate-600">
                                                {run.months?.join(', ') || '-'}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-slate-600">
                                                {run.regimes?.map(r => r === 'DESONERADO' ? 'DES' : 'N-DES').join(', ') || '-'}
                                            </td>
                                            <td className="px-4 py-3">
                                                {getStatusBadge(run.status)}
                                            </td>
                                            <td className="px-4 py-3 text-xs text-slate-500">
                                                {run.counts ? (
                                                    <span>
                                                        {run.counts.inputs || 0} ins / {run.counts.compositions || 0} comp / {run.counts.composition_items || 0} itens
                                                    </span>
                                                ) : '-'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Price Tables */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
                        <div className="p-4 border-b border-slate-200">
                            <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                                <FileSpreadsheet size={18} className="text-blue-600" />
                                Tabelas de Preço Carregadas
                            </h2>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-slate-50">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Fonte</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">UF</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Competência</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Regime</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Criado em</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200">
                                    {priceTables.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                                                Nenhuma tabela de preço carregada
                                            </td>
                                        </tr>
                                    )}
                                    {priceTables.map((table) => (
                                        <tr key={table.id} className="hover:bg-slate-50">
                                            <td className="px-4 py-3 text-sm font-medium text-slate-800">
                                                <div className="flex items-center gap-2">
                                                    {table.source}
                                                    {table.is_mock && (
                                                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
                                                            MOCK
                                                        </span>
                                                    )}
                                                    {table.source_tag && table.source_tag !== 'SINAPI' && (
                                                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                                                            {table.source_tag}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-sm text-slate-600">{table.uf}</td>
                                            <td className="px-4 py-3 text-sm font-mono text-slate-600">{table.competence}</td>
                                            <td className="px-4 py-3">
                                                <span className={`inline - flex px - 2 py - 1 rounded - full text - xs font - medium ${table.regime === 'DESONERADO' ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'
                                                    } `}>
                                                    {table.regime === 'DESONERADO' ? 'Desonerado' : 'Não Desonerado'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-sm text-slate-500">
                                                {new Date(table.created_at).toLocaleDateString('pt-BR')}
                                            </td>
                                        </tr>
                                    ))}

                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SinapiImporter;
