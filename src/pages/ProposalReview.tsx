import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Budget, BudgetItem } from '../types/domain';
import { BudgetService } from '../lib/supabase-services/BudgetService';
import { BudgetItemService } from '../lib/supabase-services/BudgetItemService';
import {
    generateProposalReview,
    checkObraChecklist,
    OBRA_CHECKLISTS,
    type ReviewReport,
    type AlertSeverity,
    type ReviewAlert
} from '../sdk/validation/ProposalReview';
import {
    ChevronLeft,
    AlertTriangle,
    CheckCircle2,
    Info,
    FileSearch,
    ClipboardCheck,
    RefreshCcw,
    Shield,
    Building2,
    XCircle,
    ChevronDown,
    ChevronRight
} from 'lucide-react';
import ComplianceAlert from '../components/ComplianceAlert';
import { COMPLIANCE_DISCLAIMERS } from '../config/compliance';

const severityConfig: Record<AlertSeverity, { icon: any; color: string; bg: string; label: string }> = {
    critical: {
        icon: XCircle,
        color: 'text-red-600',
        bg: 'bg-red-50 border-red-200',
        label: 'Crítico'
    },
    warning: {
        icon: AlertTriangle,
        color: 'text-amber-600',
        bg: 'bg-amber-50 border-amber-200',
        label: 'Atenção'
    },
    info: {
        icon: Info,
        color: 'text-blue-600',
        bg: 'bg-blue-50 border-blue-200',
        label: 'Informativo'
    }
};

const ProposalReviewPage = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const budgetId = id!;
    const [budget, setBudget] = useState<Budget | null>(null);
    const [items, setItems] = useState<BudgetItem[]>([]);

    useEffect(() => {
        if (budgetId) {
            BudgetService.getById(budgetId).then(setBudget);
            BudgetItemService.getByBudgetId(budgetId).then(setItems);
        }
    }, [budgetId]);

    const [report, setReport] = useState<ReviewReport | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedObraType, setSelectedObraType] = useState<string>('predial');
    const [checklist, setChecklist] = useState<{ present: string[]; missing: string[] } | null>(null);
    const [expandedAlerts, setExpandedAlerts] = useState<Set<string>>(new Set());

    const runReview = async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await generateProposalReview(budgetId);
            setReport(result);
        } catch (err: any) {
            setError(err.message || 'Erro ao executar revisão');
        } finally {
            setLoading(false);
        }
    };

    const runChecklist = () => {
        if (!items) return;
        const result = checkObraChecklist(
            selectedObraType as keyof typeof OBRA_CHECKLISTS,
            items
        );
        setChecklist(result);
    };

    useEffect(() => {
        if (budget?.obraType) {
            setSelectedObraType(budget.obraType);
        }
    }, [budget]);

    const toggleAlert = (alertId: string) => {
        setExpandedAlerts(prev => {
            const next = new Set(prev);
            if (next.has(alertId)) {
                next.delete(alertId);
            } else {
                next.add(alertId);
            }
            return next;
        });
    };

    const handleFixAlert = async (alert: ReviewAlert) => {
        if (!budget) return;

        switch (alert.category) {
            case 'bdi_issue':
                // Take to budget editor and highlight BDI (we can use state or alert for now, but navigation is better)
                navigate(`/budgets/${budgetId}?action=edit-bdi`);
                break;

            case 'cost_center':
                // Auto fix: Assign a default cost center or open prompt
                const newCostCenter = window.prompt(`Defina o Centro de Custo para: ${alert.itemDescription}`, 'GERAL');
                if (newCostCenter !== null) {
                    await BudgetItemService.update(alert.itemId!, {
                        costCenter: newCostCenter,
                        updatedAt: new Date()
                    });
                    runReview(); // Refresh
                }
                break;

            case 'missing_composition':
                // Take to item in editor
                navigate(`/budgets/${budgetId}?highlightItem=${alert.itemId}&action=add-composition`);
                break;

            case 'unit_incompatibility':
                // Take to item
                navigate(`/budgets/${budgetId}?highlightItem=${alert.itemId}`);
                break;

            case 'price_range':
                // Take to item
                navigate(`/budgets/${budgetId}?highlightItem=${alert.itemId}&action=check-price`);
                break;

            default:
                navigate(`/budgets/${budgetId}?highlightItem=${alert.itemId || ''}`);
                break;
        }
    };

    if (!budget) {
        return <div className="p-8 text-center text-slate-500">Carregando orçamento...</div>;
    }

    return (
        <div className="max-w-6xl mx-auto p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <button
                        onClick={() => navigate(`/budgets/${budgetId}`)}
                        className="flex items-center gap-2 text-slate-500 hover:text-slate-800 mb-2 transition-colors text-sm"
                    >
                        <ChevronLeft size={16} /> Voltar ao Orçamento
                    </button>
                    <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-3">
                        <Shield className="text-blue-600" />
                        Revisão Final de Proposta
                    </h1>
                    <p className="text-slate-500 mt-1">{budget.name}</p>
                </div>

                <div className="flex gap-3">
                    <button
                        onClick={runReview}
                        disabled={loading}
                        className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 active:scale-95 disabled:opacity-50"
                    >
                        {loading ? (
                            <RefreshCcw className="animate-spin" size={18} />
                        ) : (
                            <FileSearch size={18} />
                        )}
                        {loading ? 'Analisando...' : 'Executar Revisão'}
                    </button>
                </div>
            </div>

            {/* Compliance Alert */}
            <div className="space-y-3">
                <ComplianceAlert
                    type="info"
                    title={COMPLIANCE_DISCLAIMERS.LEGAL_COMPLIANCE.title}
                    message="Esta análise é auxiliar e automatizada. Não substitui verificação técnica profissional, parecer jurídico ou contábil. Os alertas são indícios técnicos para orientação."
                    compact
                />

                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3 items-start">
                    <Shield size={20} className="text-amber-600 shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-800 leading-relaxed">
                        <p className="font-bold mb-1 uppercase tracking-wider">Aviso de Isenção de Responsabilidade (Auto-Correção)</p>
                        <p>
                            As funcionalidades de "Correção Dirigida" são ferramentas de produtividade. O sistema tenta identificar e sugerir caminhos para conformidade, porém <strong>não garante 100% de precisão técnica ou jurídica</strong>. Todas as correções automáticas ou sugeridas <strong>DEVEM</strong> ser revisadas e validadas por um responsável técnico habilitado antes da submissão da proposta. O uso desta ferramenta não constitui consultoria profissional.
                        </p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Painel Principal - Resultados */}
                <div className="lg:col-span-2 space-y-6">
                    {error && (
                        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700">
                            {error}
                        </div>
                    )}

                    {report && (
                        <>
                            {/* Resumo */}
                            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                                <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                                    <ClipboardCheck size={20} className="text-blue-600" />
                                    Resumo da Análise
                                </h2>

                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                                    <div className="text-center p-4 bg-slate-50 rounded-xl">
                                        <p className="text-3xl font-black text-slate-800">{report.totalItems}</p>
                                        <p className="text-xs text-slate-500 uppercase font-bold">Itens Analisados</p>
                                    </div>
                                    <div className="text-center p-4 bg-red-50 rounded-xl">
                                        <p className="text-3xl font-black text-red-600">{report.alertsBySeverity.critical}</p>
                                        <p className="text-xs text-red-600 uppercase font-bold">Críticos</p>
                                    </div>
                                    <div className="text-center p-4 bg-amber-50 rounded-xl">
                                        <p className="text-3xl font-black text-amber-600">{report.alertsBySeverity.warning}</p>
                                        <p className="text-xs text-amber-600 uppercase font-bold">Atenção</p>
                                    </div>
                                    <div className="text-center p-4 bg-blue-50 rounded-xl">
                                        <p className="text-3xl font-black text-blue-600">{report.alertsBySeverity.info}</p>
                                        <p className="text-xs text-blue-600 uppercase font-bold">Informativos</p>
                                    </div>
                                </div>

                                {report.totalAlerts === 0 ? (
                                    <div className="text-center py-8 bg-green-50 rounded-xl border border-green-100">
                                        <CheckCircle2 size={48} className="mx-auto text-green-500 mb-3" />
                                        <p className="text-green-700 font-bold">Nenhuma pendência identificada!</p>
                                        <p className="text-green-600 text-sm mt-1">
                                            O orçamento passou na verificação básica.
                                        </p>
                                    </div>
                                ) : (
                                    <p className="text-sm text-slate-500 text-center">
                                        Foram identificados <strong>{report.totalAlerts}</strong> pontos de atenção.
                                        Revise cada item conforme necessidade.
                                    </p>
                                )}
                            </div>

                            {/* Lista de Alertas */}
                            {report.alerts.length > 0 && (
                                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                                    <h2 className="text-lg font-bold text-slate-800 mb-4">
                                        Pendências Identificadas
                                    </h2>

                                    <div className="space-y-3">
                                        {report.alerts.map(alert => {
                                            const config = severityConfig[alert.severity];
                                            const Icon = config.icon;
                                            const isExpanded = expandedAlerts.has(alert.id);

                                            return (
                                                <div
                                                    key={alert.id}
                                                    className={`border rounded-xl overflow-hidden ${config.bg}`}
                                                >
                                                    <button
                                                        onClick={() => toggleAlert(alert.id)}
                                                        className="w-full p-4 flex items-start gap-3 text-left hover:bg-white/50 transition-colors"
                                                    >
                                                        <Icon size={20} className={`${config.color} flex-shrink-0 mt-0.5`} />
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2 mb-1">
                                                                <span className={`text-[10px] font-black uppercase ${config.color}`}>
                                                                    {config.label}
                                                                </span>
                                                                {alert.itemCode && (
                                                                    <span className="text-[10px] font-mono bg-white/50 px-2 py-0.5 rounded">
                                                                        {alert.itemCode}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <p className="font-bold text-slate-800 text-sm">{alert.title}</p>
                                                            <p className="text-slate-600 text-sm line-clamp-2">{alert.message}</p>
                                                        </div>
                                                        {isExpanded ? (
                                                            <ChevronDown size={16} className="text-slate-400 flex-shrink-0" />
                                                        ) : (
                                                            <ChevronRight size={16} className="text-slate-400 flex-shrink-0" />
                                                        )}
                                                    </button>

                                                    {isExpanded && (
                                                        <div className="px-4 pb-4 pt-0 border-t border-white/50">
                                                            {alert.technicalNote && (
                                                                <div className="mt-3 p-3 bg-white/70 rounded-lg">
                                                                    <p className="text-xs font-bold text-slate-500 uppercase mb-1">Observação Técnica:</p>
                                                                    <p className="text-sm text-slate-700">{alert.technicalNote}</p>
                                                                </div>
                                                            )}
                                                            {alert.recommendation && (
                                                                <div className="mt-3 p-3 bg-white/70 rounded-lg">
                                                                    <p className="text-xs font-bold text-slate-500 uppercase mb-1">Recomendação:</p>
                                                                    <p className="text-sm text-slate-700">{alert.recommendation}</p>
                                                                </div>
                                                            )}
                                                            {alert.itemDescription && (
                                                                <p className="mt-3 text-xs text-slate-500">
                                                                    <strong>Item:</strong> {alert.itemDescription}
                                                                </p>
                                                            )}

                                                            <div className="mt-4 flex justify-end">
                                                                <button
                                                                    onClick={() => handleFixAlert(alert)}
                                                                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-all active:scale-95 ${alert.severity === 'critical'
                                                                        ? 'bg-red-600 text-white hover:bg-red-700 shadow-md shadow-red-100'
                                                                        : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm'
                                                                        }`}
                                                                >
                                                                    {alert.category === 'cost_center' ? (
                                                                        <>Corrigir Agora</>
                                                                    ) : (
                                                                        <>Ir para Correção <ChevronRight size={14} /></>
                                                                    )}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {!report && !loading && (
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
                            <FileSearch size={64} className="mx-auto text-slate-200 mb-4" />
                            <h3 className="text-xl font-bold text-slate-600 mb-2">Pronto para Revisão</h3>
                            <p className="text-slate-400 max-w-md mx-auto">
                                Clique em "Executar Revisão" para analisar o orçamento e identificar possíveis pendências técnicas.
                            </p>
                        </div>
                    )}
                </div>

                {/* Painel Lateral - Checklist */}
                <div className="space-y-6">
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                        <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                            <Building2 size={20} className="text-purple-600" />
                            Checklist por Tipo de Obra
                        </h2>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                                    Tipo de Obra
                                </label>
                                <select
                                    value={selectedObraType}
                                    onChange={(e) => setSelectedObraType(e.target.value)}
                                    className="w-full p-3 border border-slate-200 rounded-xl focus:border-blue-500 outline-none font-medium"
                                >
                                    {Object.entries(OBRA_CHECKLISTS).map(([key, value]) => (
                                        <option key={key} value={key}>{value.name}</option>
                                    ))}
                                </select>
                            </div>

                            <button
                                onClick={runChecklist}
                                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 text-white rounded-xl font-bold hover:bg-purple-700 transition-all"
                            >
                                <ClipboardCheck size={18} />
                                Verificar Checklist
                            </button>
                        </div>

                        {checklist && (
                            <div className="mt-6 space-y-4">
                                {checklist.missing.length === 0 ? (
                                    <div className="p-4 bg-green-50 rounded-xl text-center">
                                        <CheckCircle2 size={24} className="mx-auto text-green-500 mb-2" />
                                        <p className="text-green-700 font-bold text-sm">
                                            Todos os itens essenciais identificados!
                                        </p>
                                    </div>
                                ) : (
                                    <>
                                        <div>
                                            <p className="text-xs font-bold text-red-600 uppercase mb-2 flex items-center gap-1">
                                                <AlertTriangle size={12} />
                                                Possivelmente Ausentes ({checklist.missing.length})
                                            </p>
                                            <div className="space-y-1">
                                                {checklist.missing.slice(0, 10).map((item, idx) => (
                                                    <div key={idx} className="text-sm text-red-700 bg-red-50 px-3 py-2 rounded-lg">
                                                        {item}
                                                    </div>
                                                ))}
                                                {checklist.missing.length > 10 && (
                                                    <p className="text-xs text-red-500 text-center pt-2">
                                                        +{checklist.missing.length - 10} itens...
                                                    </p>
                                                )}
                                            </div>
                                        </div>

                                        <div>
                                            <p className="text-xs font-bold text-green-600 uppercase mb-2 flex items-center gap-1">
                                                <CheckCircle2 size={12} />
                                                Presentes ({checklist.present.length})
                                            </p>
                                            <div className="space-y-1 max-h-40 overflow-auto">
                                                {checklist.present.map((item, idx) => (
                                                    <div key={idx} className="text-sm text-green-700 bg-green-50 px-3 py-2 rounded-lg">
                                                        {item}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </>
                                )}

                                <p className="text-[10px] text-slate-400 text-center pt-2">
                                    Esta verificação é baseada em padrões típicos.
                                    A ausência de itens pode ser intencional conforme escopo.
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Info sobre Versão */}
                    {budget && (
                        <div className="bg-slate-50 rounded-xl border border-slate-200 p-4">
                            <h3 className="text-xs font-bold text-slate-500 uppercase mb-3">Informações do Orçamento</h3>
                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-slate-500">Versão:</span>
                                    <span className="font-bold text-slate-700">{budget.version || 'v1.0'}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500">Revisão:</span>
                                    <span className="font-bold text-slate-700">#{budget.revision || 1}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500">Status:</span>
                                    <span className={`font-bold ${budget.isFrozen ? 'text-blue-600' : 'text-green-600'}`}>
                                        {budget.isFrozen ? '🔒 Congelado' : '✏️ Editável'}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500">BDI:</span>
                                    <span className="font-bold text-slate-700">{budget.bdi || 0}%</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ProposalReviewPage;
