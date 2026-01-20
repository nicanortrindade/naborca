import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Budget, BudgetItem, BudgetSchedule } from '../types/domain';
import { BudgetService } from '../lib/supabase-services/BudgetService';
import { BudgetItemService } from '../lib/supabase-services/BudgetItemService'; // prepareItemsForDisplay removido
import { calculateBudget, repairHierarchy, type BudgetCalculationResult } from '../utils/calculationEngine';
import { BudgetScheduleService } from '../lib/supabase-services/BudgetScheduleService';
import { CompanyService } from '../lib/supabase-services/CompanyService';
import { LayoutDashboard, Save, ChevronLeft, DollarSign, Calculator, Download, Plus, Minus, Info, FileSpreadsheet, ChevronDown, ChevronRight, AlertTriangle, Check } from 'lucide-react';
import { COMPLIANCE_DISCLAIMERS } from '../config/compliance';
import { clsx } from 'clsx';

const BudgetSchedulePage: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const budgetId = id!;

    const [budget, setBudget] = useState<Budget | null>(null);
    const [items, setItems] = useState<BudgetItem[]>([]);
    const [existingSchedule, setExistingSchedule] = useState<BudgetSchedule[]>([]);
    const [settings, setSettings] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [calculations, setCalculations] = useState<BudgetCalculationResult | null>(null);

    // ANTI-NaN Helper


    // ANTI-NaN Helper
    const safeNumber = (val: any) => {
        if (val === null || val === undefined) return 0;
        if (typeof val === 'number') return isNaN(val) ? 0 : val;
        if (typeof val === 'string') {
            const clean = val.replace(/\./g, '').replace(',', '.');
            const num = parseFloat(clean);
            return isNaN(num) ? 0 : num;
        }
        return 0;
    };


    // HIERARCHY HELPER (Same logic as BudgetEditor)
    // HIERARCHY HELPER (Robust Version - Autosync with Editor)
    const organizeHierarchy = (allItems: any[]) => {
        if (!allItems) return [];
        const sorter = (a: any, b: any) => (a.order || 0) - (b.order || 0);

        // 0. Virtual Parenting (Fix Orphans from Import)
        let lastL1: any = null;
        let lastL2: any = null;

        const fixedItems = [...allItems].sort(sorter).map(item => {
            const newItem = { ...item };
            if (newItem.level === 1) {
                lastL1 = newItem;
                lastL2 = null;
            } else if (newItem.level === 2) {
                lastL2 = newItem;
                if (!newItem.parentId && lastL1) newItem.parentId = lastL1.id;
            } else if (newItem.level >= 3) {
                if (!newItem.parentId && lastL2) newItem.parentId = lastL2.id;
            }
            return newItem;
        });

        // 1. Get Etapas (Level 1)
        const etapas = fixedItems.filter(i => i.level === 1);
        const flatList: any[] = [];

        etapas.forEach(etapa => {
            // 2. Subetapas (Level 2)
            const subetapas = fixedItems.filter(i => i.level === 2 && i.parentId === etapa.id);
            flatList.push(etapa);

            subetapas.forEach(sub => {
                flatList.push(sub);
                // 3. Items (Level 3+)
                const subItems = fixedItems.filter(i => i.level >= 3 && i.parentId === sub.id);
                subItems.forEach(item => flatList.push(item));
            });
        });

        // 3. Rescue Orphans (Safety Net)
        const visibleIds = new Set(flatList.map(i => i.id));
        const orphans = fixedItems.filter(i => i.id && !visibleIds.has(i.id));

        if (orphans.length > 0) {
            orphans.forEach(item => {
                flatList.push({
                    ...item,
                    description: (item.description && typeof item.description === 'string' && item.description.startsWith('['))
                        ? item.description
                        : `[⚠️ VINCULAR] ${item.description || 'Item sem descrição'}`,
                    isOrphan: true
                });
            });
        }

        return flatList;
    };

    const fetchData = async () => {
        if (!budgetId) return;
        setLoading(true);
        try {
            const [budgetData, itemsData, scheduleData, companySettings] = await Promise.all([
                BudgetService.getById(budgetId),
                BudgetItemService.getByBudgetId(budgetId),
                BudgetScheduleService.getByBudgetId(budgetId),
                CompanyService.get()
            ]);
            setBudget(budgetData);

            // 1. REPARAR HIERARQUIA (Crucial para cronograma funcionar com itens importados)
            const repairedItems = repairHierarchy(itemsData || []);

            // 2. ENGINE DE CÁLCULO PURO
            const calcResult = calculateBudget(repairedItems, budgetData.bdi || 0);
            setCalculations(calcResult); // Persist engine result for direct access verification

            // 3. HIDRATAR (Para o cronograma usar item.finalPrice)
            const hydratedItems = repairedItems.map(item => {
                const calculated = calcResult.itemMap.get(item.id!);

                // LOG DE DIAGNÓSTICO OBRIGATÓRIO
                if (item.level === 1) {
                    console.log(`[SCHEDULE FETCH DIAGNOSTIC] Etapa ${item.description}: EngineTotal=${calculated?.finalTotal}`);
                }

                return {
                    ...item,
                    totalPrice: calculated?.baseTotal || 0,
                    finalPrice: calculated?.finalTotal || 0,
                    unitPrice: item.unitPrice || 0
                };
            });

            // LOGS REAIS SOLICITADOS (SCHEDULE)
            console.log("========== [SCHEDULE PIPELINE START] ==========");
            console.log("[SCHEDULE] budgetId=", budgetId);
            console.log("[SCHEDULE] raw.items.length=", itemsData?.length);
            console.log("[SCHEDULE] raw.sample10=", itemsData?.slice(0, 10).map(i => ({
                id: i.id, level: i.level, desc: i.description, parentId: i.parentId
            })));

            console.log("[SCHEDULE] afterRepair.items.length=", repairedItems?.length);
            console.log("[SCHEDULE] afterRepair.sample10=", repairedItems?.slice(0, 10).map(i => ({
                id: i.id, level: i.level, desc: i.description, parentId: i.parentId
            })));

            console.log("[SCHEDULE] computed.totalGlobal=", calcResult.totalGlobalFinal);

            console.log("[SCHEDULE] hydrated.sample10=", hydratedItems?.slice(0, 10).map(i => ({
                id: i.id, level: i.level, desc: i.description, parentId: i.parentId, finalPrice: i.finalPrice
            })));
            console.log("========== [SCHEDULE PIPELINE END] ==========");

            // 4. Organize items strictly by hierarchy
            const organized = organizeHierarchy(hydratedItems);
            setItems(organized);

            setExistingSchedule(scheduleData);
            setSettings(companySettings);
        } catch (error) {
            console.error('Error fetching schedule data:', error);
            alert("Erro ao carregar dados do cronograma. Verifique sua conexão.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [budgetId]);

    const [periods, setPeriods] = useState<number[]>([1, 2, 3, 4]);
    const [distributions, setDistributions] = useState<Record<string, Record<number, number>>>({});
    const [interval, setIntervalDays] = useState<number>(30);
    const [labels, setLabels] = useState<Record<number, string>>({});

    // Estado de colapso persistido no localStorage
    const storageKey = `schedule_collapsed_${budgetId}`;
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
        // Restaurar estado do localStorage na inicialização
        try {
            const saved = localStorage.getItem(storageKey);
            if (saved) {
                const parsed = JSON.parse(saved);
                return new Set(parsed);
            }
        } catch (e) {
            console.warn('Erro ao restaurar estado de colapso:', e);
        }
        return new Set();
    });

    // Persistir estado de colapso quando mudar
    useEffect(() => {
        try {
            const arr = Array.from(collapsedGroups);
            localStorage.setItem(storageKey, JSON.stringify(arr));
        } catch (e) {
            console.warn('Erro ao salvar estado de colapso:', e);
        }
    }, [collapsedGroups, storageKey]);

    // REGRA 6: CRONOGRAMA usa EXATAMENTE os mesmos valores do orçamento
    // Usar finalPrice que já inclui BDI (consistente com o que é mostrado no editor)

    // Helper: Calcula total de um grupo somando suas folhas (L3) recursivamente
    // Isso garante valor correto mesmo se o Engine falhar na agregação de pais
    // Otimização: Índice de filhos por pai para recursão rápida
    const itemsByParent = useMemo(() => {
        const map = new Map<string, any[]>();
        if (!items) return map;
        items.forEach(item => {
            if (item.parentId) {
                if (!map.has(item.parentId)) map.set(item.parentId, []);
                map.get(item.parentId)!.push(item);
            }
        });
        return map;
    }, [items]);

    // Helper Recursivo: Calcula total de um grupo somando filhos usando o índice
    const getRecursiveTotal = (itemId: string): number => {
        const children = itemsByParent.get(itemId);
        if (!children || children.length === 0) return 0;

        return children.reduce((sum, child) => {
            // Se for folha (L3+), soma valor direto. Se for subgrupo, desce mais um nível.
            if (child.level >= 3) {
                return sum + (safeNumber(child.finalPrice) || 0);
            } else {
                return sum + getRecursiveTotal(child.id);
            }
        }, 0);
    };

    // Get value for an item (finalPrice WITH BDI - same as budget display)
    const getItemCost = (item: any): number => {
        // 1. Tentar valor direto (vem do engine hidratado)
        let val = safeNumber(item.finalPrice);

        // 2. Se for 0 e for grupo (L1/L2), usar recursão indexada robusta
        if (val === 0 && (item.level === 1 || item.level === 2)) {
            const derivedTotal = getRecursiveTotal(item.id!);
            if (derivedTotal > 0) {
                val = derivedTotal;
            }
        }

        return Math.round(val * 100) / 100;
    };

    // REGRA 6: Calculate total from ITEMS using finalPrice (WITH BDI)
    // Mesmos valores exibidos no editor do orçamento
    const calculateTotalFromItems = () => {
        if (!items || items.length === 0) return 0;
        return Math.round(
            items
                .filter(i => i.level >= 3 && i.type !== 'group') // Only real items (not groups)
                .reduce((acc, item) => acc + getItemCost(item), 0) * 100
        ) / 100;
    };

    const totalBudgetFromItems = calculateTotalFromItems();
    // Use calculated total
    const totalBudget = totalBudgetFromItems > 0 ? totalBudgetFromItems : (budget?.totalValue || 0);


    const getItemNumber = (item: any) => {
        return item.itemNumber || '';
    };


    useEffect(() => {
        if (budget) {
            if (budget.scheduleInterval) setIntervalDays(budget.scheduleInterval);
            if (budget.periodLabels) {
                const labelMap: Record<number, string> = {};
                budget.periodLabels.forEach((l, i) => {
                    labelMap[i + 1] = l;
                });
                setLabels(labelMap);
            }
        }
    }, [budget]);

    useEffect(() => {
        if (existingSchedule && existingSchedule.length > 0) {
            const newDist: Record<string, Record<number, number>> = {};
            existingSchedule.forEach(s => {
                if (!newDist[s.itemId]) newDist[s.itemId] = {};
                newDist[s.itemId][s.period] = s.percentage;
            });
            setDistributions(newDist);

            const maxPeriod = Math.max(...existingSchedule.map(s => s.period));
            if (maxPeriod > 4) {
                const newPeriods = Array.from({ length: maxPeriod }, (_, i) => i + 1);
                setPeriods(newPeriods);
            }
        }
    }, [existingSchedule]);

    // Helper to get all descendant IDs recursively
    const getAllDescendantIds = (parentId: string): string[] => {
        if (!items) return [];
        const children = items.filter(i => i.parentId === parentId);
        let ids = children.map(c => c.id!);
        children.forEach(child => {
            ids = [...ids, ...getAllDescendantIds(child.id!)];
        });
        return ids;
    };

    const handleDistributionChange = (itemId: string, period: number, value: string) => {
        const percentage = Math.round((parseFloat(value) || 0) * 100) / 100; // Round to 2 decimals

        // Encontrar item para ver se é grupo
        const item = items.find(i => i.id === itemId);
        // Considerar propagação se for level < 3 (Etapa/Subetapa)
        const isGroup = item && (item.level < 3 || (item.type as any) === 'etapa' || (item.type as any) === 'subetapa' || item.type === 'group');

        const descendants = isGroup ? getAllDescendantIds(itemId) : [];

        setDistributions(prev => {
            const next = { ...prev };

            // Set for target item
            if (!next[itemId]) next[itemId] = {};
            next[itemId][period] = percentage;

            // Set for all descendants (Propagate)
            descendants.forEach(descId => {
                if (!next[descId]) next[descId] = {};
                next[descId][period] = percentage;
            });

            return next;
        });
    };

    const handleSave = async () => {
        if (!items || !budget) return;

        const scheduleData: Omit<BudgetSchedule, 'id'>[] = [];
        Object.entries(distributions).forEach(([itemId, perPeriod]) => {
            Object.entries(perPeriod).forEach(([period, percentage]) => {
                const item = items.find(i => i.id === itemId);
                if (item && percentage > 0) {
                    const finalPrice = getItemCost(item);
                    scheduleData.push({
                        budgetId,
                        itemId: itemId,
                        period: Number(period),
                        percentage,
                        value: Math.round(finalPrice * (percentage / 100) * 100) / 100
                    });
                }
            });
        });

        const periodLabelsArray = periods.map(p => labels[p] || `${p * interval} DIAS`);

        try {
            // Save everything in one batch (delete old, insert new)
            await BudgetScheduleService.saveBatch(budgetId, scheduleData);

            // Update budget meta
            await BudgetService.update(budgetId, {
                scheduleInterval: interval,
                periodLabels: periodLabelsArray,
                updatedAt: new Date()
            });

            alert("Cronograma salvo com sucesso!");
        } catch (error: any) {
            console.error('Error saving schedule:', error);
            alert(`Erro ao salvar cronograma: ${error.message || 'Erro desconhecido'}`);
        }
    };

    // Get visible items based on collapsed state (for export)
    const getVisibleItems = () => {
        if (!items) return [];
        return items.filter((item) => {
            if (item.level <= 1) return true;

            // Check if any parent is collapsed using the parentId chain
            let currentParentId = item.parentId;
            while (currentParentId) {
                if (collapsedGroups.has(currentParentId)) return false;
                const parent = items.find(i => i.id === currentParentId);
                currentParentId = parent?.parentId;
            }
            return true;
        });
    };

    const handleExportExcel = async () => {
        if (!items || !budget) return;

        try {
            const { exportScheduleExcel } = await import('../utils/budgetExport');

            const visibleItems = getVisibleItems();
            const months = periods.map(p => labels[p] || `${p * interval} DIAS`);
            const scheduleItems = visibleItems.map((item) => ({
                itemNumber: item.itemNumber || getItemNumber(item).trim(),
                description: item.description || '',
                totalValue: getItemCost(item),
                level: item.level,
                months: periods.reduce((acc, p) => {
                    const label = labels[p] || `${p * interval} DIAS`;
                    const monetaryValue = getItemPeriodValue(item, p);
                    const itemTotal = getItemCost(item);
                    acc[label] = itemTotal > 0 ? (monetaryValue / itemTotal) * 100 : 0;
                    return acc;
                }, {} as Record<string, number>)
            }));

            await exportScheduleExcel({
                budgetName: budget.name,
                clientName: budget.client,
                date: new Date(),
                bdi: budget.bdi || 0,
                encargos: budget.encargosSociais || 0,
                items: visibleItems as any,
                companySettings: settings,
                constructionSchedule: {
                    months,
                    items: scheduleItems
                }
            });
        } catch (error) {
            console.error('Error exporting schedule to Excel:', error);
            alert("Erro ao exportar Excel.");
        }
    };

    const handleExportPDF = async () => {
        if (!budget || !items) return;

        try {
            const { exportSchedulePDF } = await import('../utils/budgetExport');

            const visibleItems = getVisibleItems();
            const months = periods.map(p => labels[p] || `${p * interval} DIAS`);
            const scheduleItems = visibleItems.map((item) => ({
                itemNumber: item.itemNumber || getItemNumber(item).trim(),
                description: item.description || '',
                totalValue: getItemCost(item),
                level: item.level,
                months: periods.reduce((acc, p) => {
                    const label = labels[p] || `${p * interval} DIAS`;
                    const monetaryValue = getItemPeriodValue(item, p);
                    const itemTotal = getItemCost(item);
                    acc[label] = itemTotal > 0 ? (monetaryValue / itemTotal) * 100 : 0;
                    return acc;
                }, {} as Record<string, number>)
            }));

            await exportSchedulePDF({
                budgetName: budget.name,
                clientName: budget.client,
                date: new Date(),
                bdi: budget.bdi || 0,
                encargos: budget.encargosSociais || 0,
                items: visibleItems as any,
                companySettings: settings,
                constructionSchedule: {
                    months,
                    items: scheduleItems
                }
            });
        } catch (error) {
            console.error('Error exporting schedule to PDF:', error);
            alert("Erro ao exportar PDF.");
        }
    };

    const addPeriod = () => setPeriods(prev => [...prev, prev.length + 1]);
    const removePeriod = () => {
        if (periods.length > 1) {
            setPeriods(prev => prev.slice(0, -1));
        }
    };

    const formatCurrency = (val: number) =>
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);



    // Recursive helper to get the monetary value of an item (or group) in a specific period
    const getItemPeriodValue = (item: any, period: number): number => {
        const itemTotal = getItemCost(item);
        if (itemTotal === 0) return 0;

        // REGRA HIERÁRQUICA DE PRECEDÊNCIA:
        // 1. Se o item (seja Item, Subetapa ou Etapa) tiver distribuição manual definida (soma > 0),
        //    respeita ESTRITAMENTE o percentual definido manualmente para este período.
        const hasManualDist = periods.some(p => (distributions[item.id!]?.[p] || 0) > 0);

        if (hasManualDist) {
            const directPerc = distributions[item.id!]?.[period] || 0;
            return (itemTotal * (directPerc / 100));
        }

        // 2. Se for Grupo e NÃO tiver distribuição manual, soma o valor calculado dos filhos
        //    (que por sua vez podem ser manuais ou soma dos netos)
        if (item.level < 3) {
            const children = items?.filter(i => i.parentId === item.id) || [];
            if (children.length > 0) {
                return children.reduce((acc, child) => acc + getItemPeriodValue(child, period), 0);
            }
        }

        // 3. Item folha sem distribuição = 0
        return 0;
    };

    // Recursive helper to get the total percentage distributed for an item
    const getItemTotalPercentage = (item: any): number => {
        const directTotal = periods.reduce((acc, p) => acc + (distributions[item.id!]?.[p] || 0), 0);
        if (directTotal > 0) return directTotal;

        // If group with no direct distribution, calculate weighted average percentage from children
        if (item.level < 3) {
            const itemTotal = getItemCost(item);
            if (itemTotal === 0) return 0;

            const totalValueDistributed = periods.reduce((acc, p) => acc + getItemPeriodValue(item, p), 0);
            return (totalValueDistributed / itemTotal) * 100;
        }

        return 0;
    };

    // Calculate totals per period using top-level stages (Level 1)
    const periodTotals = periods.map(p => {
        if (!items) return 0;
        // The total of a period is the sum of all Stage Level 1 items
        // Since getItemPeriodValue handles roll-up, this works even if items are scheduled deep in the hierarchy
        return Math.round(
            items
                .filter(i => i.level === 1)
                .reduce((acc, stage) => acc + getItemPeriodValue(stage, p), 0) * 100
        ) / 100;
    });

    // Calculate GLOBAL percentage distributed
    const totalDistributed = periodTotals.reduce((a, b) => a + b, 0);
    const globalPercentage = totalBudget > 0 ? Math.round((totalDistributed / totalBudget) * 10000) / 100 : 0;
    const isGlobalOverLimit = globalPercentage > 100.01;
    const isGlobalComplete = Math.abs(globalPercentage - 100) < 0.01;

    // Loading State
    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px]">
                <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
                <p className="text-slate-500 font-medium">Carregando cronograma...</p>
            </div>
        );
    }


    if (!budget) return (
        <div className="p-8 flex flex-col items-center justify-center">
            <p className="text-red-500 font-bold mb-4">Não foi possível carregar o orçamento.</p>
            <button
                onClick={() => navigate('/budgets')}
                className="px-4 py-2 bg-slate-200 rounded hover:bg-slate-300 text-slate-700"
            >
                Voltar para Lista
            </button>
        </div>
    );

    return (
        <div className="p-6">
            <header className="flex justify-between items-center mb-8">
                <div>
                    <button
                        onClick={() => navigate(`/budgets/${budgetId}`)}
                        className="flex items-center gap-2 text-slate-500 hover:text-slate-800 mb-2 transition-colors"
                    >
                        <ChevronLeft size={16} /> Voltar ao Orçamento
                    </button>
                    <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-2">
                        Cronograma Físico-Financeiro
                        <div className="group relative">
                            <Info size={18} className="text-slate-400 hover:text-blue-500 cursor-help" />
                            <div className="absolute left-0 top-6 w-80 p-3 bg-slate-800 text-white text-xs rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                                <p className="font-bold mb-1">{COMPLIANCE_DISCLAIMERS.LEGAL_COMPLIANCE.title}</p>
                                <p>{COMPLIANCE_DISCLAIMERS.LEGAL_COMPLIANCE.message}</p>
                            </div>
                        </div>
                    </h1>
                    <p className="text-slate-500">{budget.name} - {budget.client}</p>
                </div>
                <div className="flex items-center gap-6">
                    <div className="text-right">
                        <div className="flex flex-col items-end">
                            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mb-1">Custo Total (Sem BDI)</p>
                            <div className="bg-white px-3 py-1.5 rounded-xl border border-slate-200 flex items-center gap-4 shadow-sm">
                                <div className="text-right">
                                    <span className="text-[9px] text-indigo-600 uppercase block leading-none font-bold mb-1">Custo da Obra</span>
                                    <span className="text-xl font-black text-indigo-700 tracking-tight">
                                        {formatCurrency(totalBudget)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>


                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
                            <button
                                onClick={removePeriod}
                                className="p-1.5 text-slate-500 hover:text-red-500 hover:bg-white rounded transition-all"
                                title="Remover última etapa"
                            >
                                <Minus size={14} />
                            </button>
                            <button
                                onClick={addPeriod}
                                className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-white rounded transition-all"
                                title="Adicionar etapa"
                            >
                                <Plus size={14} />
                            </button>
                        </div>

                        <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-lg border border-slate-200">
                            <span className="text-[10px] font-bold text-slate-500 uppercase px-1">Salto</span>
                            <input
                                type="number"
                                value={interval}
                                onChange={(e) => setIntervalDays(Number(e.target.value) || 1)}
                                className="w-12 h-7 text-center bg-white border border-slate-200 rounded text-xs font-bold text-blue-600 focus:outline-none"
                            />
                        </div>

                        <button
                            onClick={handleExportPDF}
                            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg font-medium text-slate-700 hover:bg-slate-50 transition-all text-sm"
                        >
                            <Download className="w-4 h-4" /> PDF
                        </button>

                        <button
                            onClick={handleExportExcel}
                            className="flex items-center gap-2 px-4 py-2 bg-green-50 text-green-700 border border-green-200 rounded-lg font-medium hover:bg-green-100 transition-all text-sm"
                        >
                            <FileSpreadsheet className="w-4 h-4" /> Excel
                        </button>

                        <button
                            onClick={handleSave}
                            className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-all shadow-md active:scale-95 text-sm"
                        >
                            <Save className="w-4 h-4" /> Salvar
                        </button>
                    </div>
                </div>
            </header>

            {/* Banners de Status Global */}
            {isGlobalOverLimit && (
                <div className="mb-4 bg-red-100 border-l-4 border-red-500 p-4 rounded-r shadow-sm flex items-center gap-3">
                    <AlertTriangle className="text-red-600" size={24} />
                    <div>
                        <h4 className="font-bold text-red-800 text-sm">Cronograma Excedido ({globalPercentage.toFixed(2)}%)</h4>
                        <p className="text-xs text-red-700">A distribuição total ultrapassou 100%. Ajuste os percentuais para totalizar exatamente 100%.</p>
                    </div>
                </div>
            )}

            {isGlobalComplete && (
                <div className="mb-4 bg-green-100 border-l-4 border-green-500 p-4 rounded-r shadow-sm flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center shrink-0">
                        <Check size={16} className="text-white" />
                    </div>
                    <div>
                        <h4 className="font-bold text-green-800 text-sm">Cronograma Completo</h4>
                        <p className="text-xs text-green-700">O planejamento financeiro está perfeito (100%).</p>
                    </div>
                </div>
            )}

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-200">
                                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider sticky left-0 bg-slate-50">Item/Descrição</th>
                                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Total do Item</th>
                                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider w-24">Perc.</th>
                                {periods.map(p => {
                                    const defaultLabel = `${p * interval} DIAS`;
                                    const currentLabel = labels[p] || defaultLabel;
                                    return (
                                        <th key={p} className="px-4 py-1 text-center border-l border-slate-200 min-w-[120px]">
                                            <input
                                                type="text"
                                                className="w-full text-center bg-transparent border-none text-[10px] font-bold text-slate-500 tracking-wider uppercase focus:ring-0 focus:bg-white focus:outline-none rounded"
                                                value={currentLabel}
                                                onChange={(e) => setLabels(prev => ({ ...prev, [p]: e.target.value }))}
                                                placeholder={defaultLabel}
                                            />
                                        </th>
                                    );
                                })}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                            {items?.map((item) => {
                                const itemTotal = getItemCost(item);
                                if (item.level === 1) console.log(`[SCHEDULE RENDER] id=${item.id} level=${item.level} desc=${item.description} parentId=${item.parentId} TotalRenderizado=${itemTotal} FinalPriceProp=${item.finalPrice}`);

                                // Check if item should be hidden (parent is collapsed)
                                const isHidden = (() => {
                                    if (item.level <= 1) return false;
                                    let currentParentId = item.parentId;
                                    while (currentParentId) {
                                        if (collapsedGroups.has(currentParentId)) return true;
                                        const parent = items.find(i => i.id === currentParentId);
                                        currentParentId = parent?.parentId;
                                    }
                                    return false;
                                })();

                                if (isHidden) return null;

                                const rowBg = item.level === 0 ? "bg-slate-800 text-white" : (item.level === 1 ? "bg-blue-50/50" : "bg-white");
                                const textColor = item.level === 0 ? "text-white" : (item.level === 1 ? "text-blue-900 font-bold" : (item.level === 2 ? "text-slate-800 font-semibold" : "text-slate-600"));

                                const isCollapsible = item.level <= 2;
                                const hasChildren = items.some(i => i.parentId === item.id);
                                const isCollapsed = collapsedGroups.has(item.id!);

                                const toggleCollapse = () => {
                                    if (!isCollapsible || !hasChildren) return;
                                    setCollapsedGroups(prev => {
                                        const next = new Set(prev);
                                        if (next.has(item.id!)) next.delete(item.id!);
                                        else next.add(item.id!);
                                        return next;
                                    });
                                };

                                const currentTotalPerc = getItemTotalPercentage(item);
                                const isOver = currentTotalPerc > 100.01;
                                const isComplete = Math.abs(currentTotalPerc - 100) < 0.01;
                                const itemsPercStyle = isOver ? "text-red-600 font-black bg-red-50" : (isComplete ? "text-green-600 font-bold" : "text-yellow-600 font-bold");
                                const displayPerc = itemTotal > 0 ? `${currentTotalPerc.toFixed(1)}%` : '-';

                                return (
                                    <tr key={item.id} className={`${rowBg} border-b border-slate-100 hover:bg-blue-50/30 transition-colors`}>
                                        <td className={`px-4 py-3 sticky left-0 z-10 ${rowBg}`}>
                                            <div
                                                className={`flex items-center gap-2 ${isCollapsible && hasChildren ? 'cursor-pointer' : ''}`}
                                                onClick={toggleCollapse}
                                            >
                                                <div className="flex items-center" style={{ paddingLeft: `${(item.level - 1) * 20}px` }}>
                                                    {isCollapsible && hasChildren ? (
                                                        <span className="text-slate-400 mr-1">
                                                            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                                        </span>
                                                    ) : (
                                                        <span className="w-4 mr-1"></span>
                                                    )}
                                                    <div className="flex flex-col">
                                                        <span className="text-[9px] font-mono text-slate-400 leading-none mb-1">
                                                            {getItemNumber(item)}
                                                        </span>
                                                        <span className={`text-xs uppercase line-clamp-2 ${textColor}`}>
                                                            {item.description}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className={`px-4 py-3 text-right text-xs font-mono font-bold ${textColor}`}>
                                            {formatCurrency(itemTotal)}
                                        </td>
                                        <td className={`px-4 py-3 text-center text-xs ${itemsPercStyle}`}>
                                            {displayPerc}
                                            {isOver && <span className="block text-[8px] uppercase font-black">EXCEDEU</span>}
                                        </td>
                                        {periods.map(p => {
                                            const itemIdKey = item.id!;
                                            // For Level 3 (Items) OR any group that has no children being displayed, allow input?
                                            // Decisions: Allow input in STAGES (Level 1 and 2). Level 3 is automatic or manually filled?
                                            // The user image shows input in Level 1 stages. Let's allow input in Level 1 & 2.

                                            // Simplified: Always allow input if it's not a group, 
                                            // or if it's a group where the user wants to set a macro percentage.

                                            const isLeaf = item.level === 3 || !hasChildren;
                                            const canEdit = item.level === 1 || item.level === 2 || item.level === 3;

                                            const percValueData = distributions[itemIdKey]?.[p];
                                            const percValue = percValueData !== undefined ? String(percValueData) : '';

                                            const monetaryValue = getItemPeriodValue(item, p);
                                            const itemPeriodPerc = itemTotal > 0 ? (monetaryValue / itemTotal) * 100 : 0;

                                            return (
                                                <td key={p} className="px-4 py-3 border-l border-slate-100 min-w-[120px]">
                                                    <div className="flex flex-col gap-1 items-center">
                                                        <div className="flex items-center gap-1 group">
                                                            <input
                                                                type="number"
                                                                className={clsx(
                                                                    "w-16 h-8 text-center text-xs border rounded outline-none transition-all",
                                                                    percValue !== ''
                                                                        ? (isOver ? "bg-red-50 border-red-400 text-red-700 font-black" : (item.level === 0 ? "bg-white/20 border-white/30 text-white" : "bg-blue-50 border-blue-200 font-bold text-blue-700"))
                                                                        : (isOver ? "bg-red-50/30 border-red-200" : (item.level === 0 ? "bg-white/5 border-white/10 text-white/50" : "bg-white border-slate-100 text-slate-400 focus:border-blue-300"))
                                                                )}
                                                                placeholder="0"
                                                                value={percValue}
                                                                onChange={e => {
                                                                    const v = e.target.value;
                                                                    console.log(`[SCHEDULE INPUT] id=${item.id} Period=${p} NewPerc=${v} ItemTotal=${itemTotal} ItemFinalPrice=${item.finalPrice}`);
                                                                    handleDistributionChange(item.id!, p, v);
                                                                }}
                                                            />
                                                            <span className={clsx("text-[10px]", item.level === 0 ? "text-white/40" : "text-slate-400")}>%</span>
                                                        </div>
                                                        {monetaryValue > 0 && (
                                                            <div className="flex flex-col items-center">
                                                                <span className={clsx("text-[9px] font-bold", item.level === 0 ? "text-white" : "text-blue-500")}>{itemPeriodPerc.toFixed(1)}%</span>
                                                                <span className={clsx("text-[10px] font-medium", item.level === 0 ? "text-white/80" : "text-slate-700")}>
                                                                    {formatCurrency(monetaryValue)}
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })
                            }
                        </tbody>
                        <tfoot>
                            <tr className="bg-slate-900 text-white divide-x divide-slate-800">
                                <td colSpan={3} className="px-4 py-4 font-bold text-right uppercase tracking-wider">
                                    Resumo Financeiro por Período
                                </td>
                                {periodTotals.map((total, idx) => (
                                    <td key={idx} className="px-4 py-4 text-center">
                                        <div className="flex flex-col">
                                            <span className="text-xs text-slate-400 uppercase">Custo Etapa</span>
                                            <span className="font-bold">{formatCurrency(total)}</span>
                                            <span className="text-[10px] text-blue-300">
                                                {totalBudget > 0 ? ((total / totalBudget) * 100).toFixed(2) : 0}%
                                            </span>
                                        </div>
                                    </td>
                                ))}
                            </tr>
                            <tr className="bg-slate-800 text-white divide-x divide-slate-700">
                                <td colSpan={3} className="px-4 py-4 font-bold text-right uppercase tracking-wider text-sm">
                                    Custo Acumulado
                                </td>
                                {periodTotals.map((_, idx) => {
                                    const accumulated = periodTotals.slice(0, idx + 1).reduce((a, b) => a + b, 0);
                                    return (
                                        <td key={idx} className="px-4 py-4 text-center">
                                            <div className="flex flex-col">
                                                <span className="font-bold text-lg">{formatCurrency(accumulated)}</span>
                                                <span className="text-xs font-black text-green-400">
                                                    TOT: {totalBudget > 0 ? ((accumulated / totalBudget) * 100).toFixed(2) : 0}%
                                                </span>
                                            </div>
                                        </td>
                                    );
                                })}
                            </tr>
                            <tr className="bg-slate-50 text-slate-400 divide-x divide-slate-200 border-t border-slate-200">
                                <td colSpan={3} className="px-4 py-2 font-bold text-right uppercase tracking-wider text-xs">
                                    Saldo a Realizar
                                </td>
                                {periodTotals.map((_, idx) => {
                                    const accumulated = periodTotals.slice(0, idx + 1).reduce((a, b) => a + b, 0);
                                    const saldo = totalBudget - accumulated;
                                    const isNegative = saldo < -0.01;
                                    return (
                                        <td key={idx} className="px-4 py-2 text-center text-xs">
                                            <span className={clsx("font-bold", isNegative ? "text-red-500" : "text-slate-500")}>
                                                {formatCurrency(saldo < 0 ? 0 : saldo)}
                                            </span>
                                            {isNegative && <span className="block text-[9px] text-red-400 font-black">EXCEDIDO</span>}
                                        </td>
                                    );
                                })}
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>

            {/* Alert if over 100% */}
            {isGlobalOverLimit && (
                <div className="mt-4 bg-red-50 border-2 border-red-300 p-4 rounded-xl flex items-center gap-4">
                    <div className="w-12 h-12 bg-red-600 text-white rounded-full flex items-center justify-center font-bold animate-pulse">
                        ⚠️
                    </div>
                    <div>
                        <p className="text-sm text-red-700 font-bold uppercase">Cronograma Excede 100%</p>
                        <p className="text-red-600 text-xs">O total distribuído ({globalPercentage.toFixed(2)}%) é maior que o orçamento. Revise as porcentagens.</p>
                    </div>
                </div>
            )}

            {/* Complete indicator */}
            {isGlobalComplete && (
                <div className="mt-4 bg-green-50 border-2 border-green-300 p-4 rounded-xl flex items-center gap-4">
                    <div className="w-12 h-12 bg-green-600 text-white rounded-full flex items-center justify-center font-bold">
                        ✓
                    </div>
                    <div>
                        <p className="text-sm text-green-700 font-bold uppercase">Cronograma Completo</p>
                        <p className="text-green-600 text-xs">100% do orçamento foi distribuído nos períodos.</p>
                    </div>
                </div>
            )}

            <div className="mt-8 grid grid-cols-1 md:grid-cols-4 gap-6">
                {/* Dynamic Totalization - Accumulated Percentage */}
                <div className={`p-4 rounded-xl flex items-center gap-4 ${isGlobalOverLimit ? 'bg-red-50 border-2 border-red-200' : isGlobalComplete ? 'bg-green-50 border-2 border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-white ${isGlobalOverLimit ? 'bg-red-600' : isGlobalComplete ? 'bg-green-600' : 'bg-yellow-500'}`}>
                        %
                    </div>
                    <div>
                        <p className={`text-xs uppercase font-bold tracking-wider ${isGlobalOverLimit ? 'text-red-600' : isGlobalComplete ? 'text-green-600' : 'text-yellow-600'}`}>
                            Percentual Distribuído
                        </p>
                        <p className={`text-2xl font-black ${isGlobalOverLimit ? 'text-red-700' : isGlobalComplete ? 'text-green-700' : 'text-yellow-700'}`}>
                            {globalPercentage.toFixed(2)}%
                        </p>
                    </div>
                </div>

                {/* Financial Value Distributed */}
                <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl flex items-center gap-4">
                    <div className="w-12 h-12 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">
                        <DollarSign />
                    </div>
                    <div>
                        <p className="text-xs text-blue-600 uppercase font-bold tracking-wider">Valor Distribuído</p>
                        <p className="text-xl font-bold text-blue-900">{formatCurrency(totalDistributed)}</p>
                    </div>
                </div>

                {/* Total Budget */}
                <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl flex items-center gap-4">
                    <div className="w-12 h-12 bg-slate-600 text-white rounded-full flex items-center justify-center font-bold">
                        <Calculator />
                    </div>
                    <div>
                        <p className="text-xs text-slate-600 uppercase font-bold tracking-wider">Orçamento Total</p>
                        <p className="text-xl font-bold text-slate-900">{formatCurrency(totalBudget)}</p>
                    </div>
                </div>

                {/* Remaining */}
                <div className="bg-purple-50 border border-purple-100 p-4 rounded-xl flex items-center gap-4">
                    <div className="w-12 h-12 bg-purple-600 text-white rounded-full flex items-center justify-center font-bold">
                        <LayoutDashboard />
                    </div>
                    <div>
                        <p className="text-xs text-purple-600 uppercase font-bold tracking-wider">Saldo Restante</p>
                        <p className="text-xl font-bold text-purple-900">{formatCurrency(totalBudget - totalDistributed)}</p>
                    </div>
                </div>
            </div>

        </div>
    );
};

export default BudgetSchedulePage;
