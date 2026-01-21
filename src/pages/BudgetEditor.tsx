
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { BudgetService } from '../lib/supabase-services/BudgetService';
import { BudgetItemService } from '../lib/supabase-services/BudgetItemService'; // Removed prepareItemsForDisplay
import { calculateBudget, repairHierarchy } from '../utils/calculationEngine';
import { BudgetItemCompositionService } from '../lib/supabase-services/BudgetItemCompositionService';
import GlobalAdjustmentModal from '../components/budgets/GlobalAdjustmentModal';
import { InsumoService } from '../lib/supabase-services/InsumoService';
import { CompositionService } from '../lib/supabase-services/CompositionService';
import { SinapiService } from '../lib/supabase-services/SinapiService';
import { CompanyService } from '../lib/supabase-services/CompanyService';
import { ArrowLeft, Plus, Trash2, Search, X, Download, FileText, FileSpreadsheet, BarChart, Calculator, Percent, Lock, Unlock, Copy, RefreshCcw, AlertTriangle, TrendingUp, Save, Database, Calendar, Activity, Eye, ChevronDown, ChevronUp, AlertOctagon, Edit2, ListOrdered, Loader, Package } from 'lucide-react';

import { clsx } from "clsx";
import { AnalyticResolutionModal } from '../features/importer/components/AnalyticResolutionModal';
import { generateBDIReport, generateEncargosReport, generateEncargosFullReport } from '../sdk/reports/ProposalGenerator';
import { useIsMobile } from '../App';
import { ENCARGOS_SOCIAIS_BASES, calcularTotalBase } from '../data/encargosSociais';
import { BudgetImporter } from '../features/importer';
import {
    calculateAdjustmentFactors,
    getAdjustedItemValues,
    classifyItem
} from '../utils/globalAdjustment';
import type {
    GlobalAdjustmentMode,
    GlobalAdjustmentType,
    AdjustmentContext
} from '../utils/globalAdjustment';

/**
 * Normalizador único de recursos (insumos e composições)
 * Garante tipos consistentes INPUT/COMPOSITION e fallbacks seguros
 */
type ResourceKind = 'insumo' | 'composition';
type NormalizedResource = {
    id?: string;
    type: 'INPUT' | 'COMPOSITION';
    code: string;
    description: string;
    level: number;
    peso?: number;
    unit: string;
    price: number | undefined; // Allow undefined to signal "missing price" for UI
    source: string;
    originalType?: string; // e.g. material, labor
    raw?: any; // Objeto original para debug
};

function normalizeResource(res: any, kind: ResourceKind): NormalizedResource {
    if (!res) {
        console.warn('[normalizeResource] Recebeu objeto vazio/null');
        return {
            type: kind === 'insumo' ? 'INPUT' : 'COMPOSITION',
            code: '',
            description: 'Recurso inválido',
            level: 0,
            unit: '',
            price: 0,
            source: '',
            raw: res
        };
    }

    // INSTRUMENTATION: Log first of each source
    if (!(globalThis as any)._loggedSources) (globalThis as any)._loggedSources = new Set();
    const sourceKey = `${res.fonte || res.source || 'UNKNOWN'}-${kind}`;
    if (!(globalThis as any)._loggedSources.has(sourceKey)) {
        console.log(`[DEBUG_PRICE] Raw ${sourceKey}:`, res);
        (globalThis as any)._loggedSources.add(sourceKey);
    }

    // Determinar tipo baseado no kind OBRIGATORIAMENTE para o Badge
    const type = kind === 'insumo' ? 'INPUT' : 'COMPOSITION';

    // Extrair code com fallbacks (codigo, code, id)
    const code = res.codigo || res.code || res.id || '';

    // Extrair description com fallbacks (descricao, description, nome, name)
    const description = res.descricao || res.description || res.nome || res.name || 'Sem descrição';

    // Extrair unit com fallbacks (unidade, unit, un)
    const unit = res.unidade || res.unit || res.un || 'UN';

    // Extrair price com fallbacks (preco, price, valor, custoTotal, total_cost)
    // Extrair price com fallbacks (preco, price, valor, custoTotal, total_cost)
    // If explicit undefined/null, keep it to show "Sem preço"
    const priceRaw = res.preco ?? res.price ?? res.valor ?? res.custoTotal ?? res.total_cost ?? res.price_unit;
    const price = (priceRaw !== undefined && priceRaw !== null)
        ? (typeof priceRaw === 'number' ? priceRaw : parseFloat(priceRaw) || 0)
        : undefined;

    // Extrair source com fallback
    const source = res.fonte || res.source || (kind === 'insumo' ? 'SINAPI' : 'PROPRIO');

    // Mapear tipo de recurso original (material, labor, etc)
    const originalType = res.tipo || res.type || res.item_type || (kind === 'insumo' ? 'material' : 'service');

    return {
        id: res.id,
        type,
        code,
        description,
        level: res.level || 3, // Default for items
        peso: res.peso,
        unit,
        price,
        source: source.toUpperCase(),
        originalType,
        raw: res
    };
}

const BudgetEditor = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const budgetId = id || '';
    const isMobile = useIsMobile();

    const [budget, setBudget] = useState<any>(null);
    const [items, setItems] = useState<any[]>([]);
    const [calcResult, setCalcResult] = useState<any>(null); // Armazena resultado do engine

    // Global Adjustment Factors (Source of Truth for Display)
    const adjustmentFactors = useMemo(() => {
        const ctx: AdjustmentContext = {
            totalBase: calcResult?.totalGlobalBase || 0,
            totalFinal: calcResult?.totalGlobalFinal || 0,
            totalMaterialBase: 0 // Will calculate if needed
        };

        // Pre-calc material total if needed for 'materials_only' mode context
        if (budget?.settings?.global_adjustment_v2?.mode === 'materials_only') {
            ctx.totalMaterialBase = items?.reduce((acc, item) => {
                // Basic heuristic scan for context
                const desc = item.description || '';
                const type = item.type || '';
                // Import from same utility (check circular dep? No, util is independent)
                if (classifyItem(desc, type) === 'material' && item.level >= 3 && item.type !== 'group') {
                    return acc + (item.totalPrice || 0);
                }
                return acc;
            }, 0) || 0;
        }

        // V2 Settings take precedence, fallback to legacy if V2 missing
        let adjData = budget?.settings?.global_adjustment_v2;
        if (!adjData && (budget?.metadata?.global_adjustment || budget?.settings?.global_adjustment)) {
            // Migrar legacy visualmente
            const legacy = budget?.settings?.global_adjustment || budget?.metadata?.global_adjustment;
            adjData = {
                mode: 'global_all',
                kind: legacy.type === 'percentage' ? 'percentage' : 'fixed',
                value: legacy.value
            };
        }

        return calculateAdjustmentFactors(adjData, ctx);
    }, [budget, calcResult, items]);

    const [settings, setSettings] = useState<any>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!budgetId) return;
        loadBudget();
        loadSettings();
    }, [budgetId]);

    // REGRA 1: Valores vêm PRONTOS do backend
    // O frontend NÃO recalcula valores, apenas calcula peso (%) dinamicamente

    const loadBudget = async () => {
        try {
            setLoading(true);
            const b = await BudgetService.getById(budgetId);
            setBudget(b);
            const viewItems = await BudgetItemService.getByBudgetId(budgetId);

            // 1. REPARAR HIERARQUIA (Garante parentIds corretos para agregação)
            const repairedItems = repairHierarchy(viewItems || []);

            // 2. ENGINE DE CÁLCULO PURO
            const result = calculateBudget(repairedItems, b.bdi || 0);
            setCalcResult(result);

            // 3. HIDRATAR (Unifica dados raw + calculados)
            const hydratedItems = repairedItems.map(item => {
                const calculated = result.itemMap.get(item.id!);
                return {
                    ...item,
                    totalPrice: calculated?.baseTotal || 0,
                    finalPrice: calculated?.finalTotal || 0,
                    peso: calculated?.weight || 0,
                    unitPrice: item.unitPrice || 0
                };
            });

            setItems(hydratedItems);

            // 4. ORGANIZAR (Apenas visual, agora que parentIds já foram corrigidos no passo 1)
            const organized = organizeHierarchy(hydratedItems);
            setItems(organized);
        } catch (error) {
            console.error("Erro ao carregar orçamento:", error);
        } finally {
            setLoading(false);
        }
    };

    const loadSettings = async () => {
        try {
            const s = await CompanyService.get();
            setSettings(s);
        } catch (e) {
            console.error("Erro ao carregar configurações:", e);
        }
    };

    const [isAddingItem, setIsAddingItem] = useState(false);
    // NEW: Toggle State for Add Item Modal
    const [addItemTab, setAddItemTab] = useState<'INS' | 'CPU'>('INS');

    const [searchTerm, setSearchTerm] = useState('');
    const [selectedResource, setSelectedResource] = useState<any>(null);
    const [quantity, setQuantity] = useState(1);
    const [editingItem, setEditingItem] = useState<any>(null);
    const [itemComposition, setItemComposition] = useState<any[]>([]);
    const [compositionSearchTerm, setCompositionSearchTerm] = useState('');
    const [showCompositionSearch, setShowCompositionSearch] = useState(false);
    const [showABC, setShowABC] = useState(false);
    const [abcType, setAbcType] = useState<'insumos' | 'servicos'>('servicos');
    const [abcData, setAbcData] = useState<any[]>([]);
    const [showImpact, setShowImpact] = useState(false);
    const [originalTotal, setOriginalTotal] = useState(0);
    const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
    const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

    // Estados de Busca e Filtros Multi-Base
    const [selectedBases, setSelectedBases] = useState<string[]>(() => {
        const saved = localStorage.getItem('naborca_search_bases');
        return saved ? JSON.parse(saved) : ['SINAPI'];
    });
    const AVAILABLE_BASES = ['SINAPI', 'ORSE', 'EMBASA', 'OWN'];

    useEffect(() => {
        localStorage.setItem('naborca_search_bases', JSON.stringify(selectedBases));
    }, [selectedBases]);

    // Estados de Loading para Exportações e Ferramentas
    const [isExportingAnalytic, setIsExportingAnalytic] = useState(false);
    const [isImporterOpen, setIsImporterOpen] = useState(false);
    const [isExportingZip, setIsExportingZip] = useState(false);
    const [exportProgress, setExportProgress] = useState({ current: 0, total: 0, message: '' });

    // Analytic Blocking State
    const [showAnalyticModal, setShowAnalyticModal] = useState(false);
    const [pendingAnalytics, setPendingAnalytics] = useState<any[]>([]);

    // Drag and Drop States
    const [draggedItemIndex, setDraggedItemIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const [searchParams] = useSearchParams();
    const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);

    // BDI Calculator States
    const [showBDICalculator, setShowBDICalculator] = useState(false);
    const [bdiCalc, setBdiCalc] = useState({
        ac: 3.5,
        r: 0.97,
        sg: 0.8, // Seguro + Garantia
        df: 1.23,
        l: 7.2,
        i_pis: 0.17,
        i_cofins: 0.8,
        i_iss: 0.8,
        i_cprb: 0.0
    });

    const BDI_PRESETS = [
        {
            name: "Construção de Rodovias e Ferrovias",
            description: "(também para Recapeamento, Pavimentação e Praças)",
            ac: 4.67, sg: 0.74, r: 0.97, df: 1.21, l: 8.69
        },
        {
            name: "Construção de Edifícios",
            description: "(também para Reformas)",
            ac: 5.31, sg: 0.90, r: 1.10, df: 1.10, l: 8.96
        },
        {
            name: "Fornecimento de Materiais e Equipamentos",
            description: "",
            ac: 3.45, sg: 0.48, r: 0.56, df: 0.85, l: 5.11
        }
    ];

    // Encargos Sociais Modal States
    const [showEncargosModal, setShowEncargosModal] = useState(false);
    const [tipoEncargo, setTipoEncargo] = useState<'horista' | 'mensalista'>('horista');

    const [filteredResources, setFilteredResources] = useState<any[]>([]);

    // Global Adjustment
    const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
    const [divergentItems, setDivergentItems] = useState<any[]>([]);

    const handleGlobalAdjustment = async (mode: GlobalAdjustmentMode, type: GlobalAdjustmentType, value: number, applyToAnalytic: boolean) => {
        if (!items || items.length === 0) return;
        setLoading(true);

        try {
            console.log("[GlobalAdjust] Starting...", { mode, type, value, applyToAnalytic });

            let finalValue = safeNumber(value);
            let finalKind: GlobalAdjustmentType = type;

            if (type === 'fixed') {
                // Modal sends Target Total as 'value'. 
                // We save it as 'fixed_target_total' to be explicit.
                finalKind = 'fixed_target_total';
            }

            const currentSettings = budget.settings || {};

            const newSettings = {
                ...currentSettings,
                global_adjustment_v2: {
                    mode: mode,
                    kind: finalKind,
                    value: finalValue
                },
                // Clean legacy
                global_adjustment: null
            };

            // Single update call
            await BudgetService.update(budget.id, {
                settings: newSettings
            });

            await loadBudget();
            setShowAdjustmentModal(false);

        } catch (error: any) {
            console.error("Global Adjustment Failed", error);
            alert(`Erro ao aplicar ajuste global: ${error.message || 'Erro desconhecido'}`);
        } finally {
            setLoading(false);
        }
    };

    // Removed duplicate normalizeResource function


    const fetchResources = useCallback(async (query: string, typeFilter: string, bases: string[], priceContext?: any) => {
        const safeQuery = query?.trim();

        if (!safeQuery || safeQuery.length < 3) {
            console.log('[EDITOR] tiny query → skip fetch');
            setFilteredResources([]);
            return;
        }

        try {
            console.log(`[fetchResources] Query="${safeQuery}" Tab=${typeFilter} Bases=`, bases);
            let results: NormalizedResource[] = [];

            if (typeFilter === 'INS') {
                // PARALLEL SEARCH: User Insumos + Public Bases
                const [userResults, publicResults] = await Promise.all([
                    InsumoService.search(safeQuery),
                    SinapiService.searchInputs(safeQuery, {
                        sources: bases.length > 0 ? bases.filter(b => b !== 'OWN') : undefined,
                        ...priceContext
                    })
                ]);

                const normUser = (userResults || []).map(i => normalizeResource(i, 'insumo'));
                const normPublic = (publicResults || []).map(i => normalizeResource(i, 'insumo'));

                results = [...normUser, ...normPublic];
            } else {
                // PARALLEL SEARCH: User Compositions + Public Bases
                const [userResults, publicResults] = await Promise.all([
                    CompositionService.search(safeQuery),
                    SinapiService.searchCompositions(safeQuery, {
                        sources: bases.length > 0 ? bases.filter(b => b !== 'OWN') : undefined,
                        ...priceContext
                    })
                ]);

                const normUser = (userResults || []).map(i => normalizeResource(i, 'composition'));
                const normPublic = (publicResults || []).map(c => normalizeResource(c, 'composition'));

                results = [...normUser, ...normPublic];
            }

            // Deduplicação básica por código e fonte se necessário
            const seen = new Set();
            const uniqueResults = results.filter(r => {
                const key = `${r.source}-${r.code}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });

            setFilteredResources(uniqueResults);

        } catch (error) {
            console.error("[fetchResources] Erro ao buscar recursos:", error);
            setFilteredResources([]);
        }
    }, []);

    // Hook sugerido: Disparar busca assim que o modal abrir ou a tab mudar ou bases mudarem
    useEffect(() => {
        if (isAddingItem) {
            console.log(`[MODAL] isAddingItem=true Tab=${addItemTab} Bases=${selectedBases} → trigger fetchResources`);
            const priceContext = budget ? {
                uf: budget.sinapiUf || 'BA',
                competence: budget.sinapiCompetence,
                regime: budget.sinapiRegime // 'DESONERADO' | 'NAO_DESONERADO'
            } : undefined;
            fetchResources(searchTerm ?? '', addItemTab, selectedBases, priceContext);
        } else {
            setFilteredResources([]);
        }
    }, [isAddingItem, addItemTab, selectedBases, fetchResources]);

    // Debounce para busca enquanto o modal está aberto, considerando a TAB e Bases
    useEffect(() => {
        if (!isAddingItem || !searchTerm) return;

        const timeout = setTimeout(() => {
            const priceContext = budget ? {
                uf: budget.sinapiUf || 'BA',
                competence: budget.sinapiCompetence,
                regime: budget.sinapiRegime
            } : undefined;
            fetchResources(searchTerm, addItemTab, selectedBases, priceContext);
        }, 300);

        return () => clearTimeout(timeout);
    }, [searchTerm, isAddingItem, addItemTab, selectedBases, fetchResources]);

    const [compositionFilteredResources, setCompositionFilteredResources] = useState<any[]>([]);

    const fetchCompResources = useCallback(async (query: string = '') => {
        const safeQuery = query?.trim();

        if (!safeQuery) {
            console.log('[EDITOR] empty query (comp) → skip fetch');
            setCompositionFilteredResources([]);
            return;
        }

        try {
            const [insumos, compositions] = await Promise.all([
                InsumoService.search(safeQuery),
                CompositionService.search(safeQuery)
            ]);

            // Usar normalizador único (mesmo fluxo do modal principal)
            const normalizedInsumos = (insumos || []).map(i => normalizeResource(i, 'insumo'));
            const normalizedCompositions = (compositions || []).map(c => normalizeResource(c, 'composition'));

            // Composições primeiro, depois insumos
            setCompositionFilteredResources([...normalizedCompositions, ...normalizedInsumos]);

        } catch (e) {
            console.error("[fetchCompResources] Erro ao buscar recursos para composição:", e);
            setCompositionFilteredResources([]);
        }
    }, []);

    // Hook para disparar busca assim que o modal de composição abrir
    useEffect(() => {
        if (showCompositionSearch) {
            fetchCompResources(compositionSearchTerm ?? '');
        } else {
            setCompositionFilteredResources([]);
        }
    }, [showCompositionSearch, fetchCompResources]);

    // Debounce para busca na composição
    useEffect(() => {
        if (!showCompositionSearch || !compositionSearchTerm) return;

        const timeout = setTimeout(() => {
            fetchCompResources(compositionSearchTerm);
        }, 300);

        return () => clearTimeout(timeout);
    }, [compositionSearchTerm, showCompositionSearch, fetchCompResources]);

    useEffect(() => {
        if (showABC) {
            getABCData().then(setAbcData);
        }
    }, [showABC, items]);

    // Lógica de Destaque e Ação Automática (Vindo da Revisão)
    useEffect(() => {
        const itemToHighlight = searchParams.get('highlightItem');
        const action = searchParams.get('action');

        if (itemToHighlight) {
            const id = itemToHighlight; // UUID string
            setHighlightedItemId(id);

            // Scroll to item
            setTimeout(() => {
                const element = document.getElementById(`item - ${id} `);
                if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    // Adicionar classe temporária para piscar
                    element.classList.add('ring-yellow-400', 'ring-4', 'bg-yellow-50');
                    setTimeout(() => {
                        element.classList.remove('ring-yellow-400', 'ring-4', 'bg-yellow-50');
                    }, 3000);
                }
            }, 800);
        }

        if (action === 'edit-bdi') {
            setShowBDICalculator(true);
        }

        if (action === 'add-composition' && itemToHighlight) {
            const item = items?.find(i => i.id === itemToHighlight);
            if (item) handleStartEdit(item);
        }
    }, [searchParams, items]);


    const handleUpdateCompositionItem = (index: number, field: string, value: any) => {
        setItemComposition(prev => prev.map((item, i) => {
            if (i === index) {
                const updated = { ...item, [field]: value };
                updated.totalPrice = updated.coefficient * updated.unitPrice;
                return updated;
            }
            return item;
        }));
    };

    const handleAddResToComposition = (res: any) => {
        const newItem = {
            budgetItemId: editingItem.id,
            code: res.code,
            description: res.description,
            unit: res.unit,
            coefficient: 1,
            unitPrice: res.price,
            totalPrice: res.price,
            source: res.source
        };
        setItemComposition(prev => [...prev, newItem]);
        setShowCompositionSearch(false);
        setCompositionSearchTerm('');
    };

    // ANTI-NaN Helper (Robust)
    const safeNumber = (val: any) => {
        if (val === null || val === undefined) return 0;
        if (typeof val === 'number') return isNaN(val) ? 0 : val;
        if (typeof val === 'string') {
            if (!val.trim()) return 0;
            // Remove currency, spaces, dots, then fix comma to dot
            const clean = val.replace(/[R$\s.]/g, '').replace(',', '.');
            const num = parseFloat(clean);
            return isNaN(num) ? 0 : num;
        }
        return 0;
    };

    // REGRA 1: organizeHierarchy APENAS organiza a exibição hierárquica
    // Os valores (finalPrice, totalPrice, peso, calculatedTotal) já vêm calculados do recalculateItemHierarchy
    const organizeHierarchy = (allItems: any[]) => {
        if (!allItems) return [];

        const sorter = (a: any, b: any) => (a.order || 0) - (b.order || 0);

        // 0. Pre-process: Virtual Parenting for Imported Items (Fix Orphans)
        let lastL1: any = null;
        let lastL2: any = null;

        const fixedItems = [...allItems].sort(sorter).map(item => {
            const newItem = { ...item };

            // Track parents based on visual order
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
            // Find subetapas (Level 2)
            const subetapas = fixedItems.filter(i => i.level === 2 && i.parentId === etapa.id);

            // REGRA 3: Os valores já estão calculados - usar finalPrice do item diretamente
            // calculatedTotal já foi definido no recalculateItemHierarchy
            flatList.push({
                ...etapa,
                calculatedTotal: etapa.finalPrice || 0
            });

            // Add Subetapas and their Items
            subetapas.forEach(sub => {
                const subItems = fixedItems.filter(i => i.level >= 3 && i.parentId === sub.id);

                // Subetapa com total já calculado
                flatList.push({
                    ...sub,
                    calculatedTotal: sub.finalPrice || 0,
                    _children: subItems
                });

                // Adicionar itens (valores já calculados)
                subItems.forEach((item: any) => {
                    flatList.push(item);
                });
            });
        });

        // SAFETY NET: Show Orphans instead of hiding them
        const visibleIds = new Set(flatList.map(i => i.id));
        const orphans = fixedItems.filter(i => i.id && !visibleIds.has(i.id));

        if (orphans.length > 0) {
            console.warn("Orphans detected:", orphans.length);
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

    // REGRA 3: Calculate Global Total (Only Level 3+ Items using finalPrice)
    // finalPrice já inclui: quantity * unitPrice * (1 + BDI)
    // Totais já calculados no useMemo do visibleRows
    // Removido lógica redundante de totalBaseRaw/applyAdjustment


    // Sync Total Global if needed
    useEffect(() => {
        if (!budget || !items) return;

        // REGRA 3: Total global = soma dos finalPrice de itens level >= 3
        const currentTotalGlobal = items.reduce((acc, item) => {
            if (item.level >= 3 && item.type !== 'group') {
                return acc + safeNumber(item.finalPrice);
            }
            return acc;
        }, 0);

        const dbTotal = safeNumber(budget.totalValue);

        // Sync if diff > 1 cent
        if (Math.abs(dbTotal - currentTotalGlobal) > 0.01) {
            const timer = setTimeout(() => {
                console.log("Syncing Budget Total...", currentTotalGlobal);
                // Optimistic update local
                setBudget((prev: any) => prev ? { ...prev, totalValue: currentTotalGlobal } : null);

                BudgetService.update(budget.id!, { totalValue: currentTotalGlobal })
                    .catch(e => console.error("Error syncing total:", e));
            }, 1000);
            return () => clearTimeout(timer);
        }
    }, [items, budget?.id]); // Removed budget.totalValue/bdi from dependency to avoid loop

    // A função getItemSubtotal foi removida pois os totais de grupo (finalPrice)
    // agora são calculados diretamente na função prepareItemsForDisplay no carregamento.

    // Calcular números hierárquicos (1, 1.1, 1.1.1, 2, 2.1...)
    const getItemNumber = (index: number): string => {
        if (!items) return "";
        const item = items[index];

        // Se já tiver uma numeração explícita (vinda do banco), retorna ela
        if (item.itemNumber) return String(item.itemNumber).trim();

        // Fallback: cálculo dinâmico baseado no level (1-2-3)
        if (item.level === 1) {
            let count = 0;
            for (let i = 0; i <= index; i++) if (items[i].level === 1) count++;
            return `${count}`;
        }

        if (item.level > 1) {
            const parent = items.find(i => i.id === item.parentId);
            if (!parent) return "?";

            const parentIndex = items.findIndex(i => i.id === parent.id);
            const parentNum = getItemNumber(parentIndex);

            let siblingCount = 0;
            for (let i = parentIndex + 1; i <= index; i++) {
                if (items[i].parentId === item.parentId) siblingCount++;
            }
            return `${parentNum}.${siblingCount}`;
        }

        return "";
    };

    const getNextOrder = () => (items?.length || 0) + 1;

    const handleAddTitle = async () => {
        const title = window.prompt("Digite o nome da ETAPA (Nível 1)");
        if (!title) return;

        try {
            await BudgetItemService.create({
                budgetId: budgetId,
                order: getNextOrder(),
                level: 1,
                parentId: null,
                itemNumber: "",
                code: "",
                description: title.toUpperCase(),
                unit: "",
                quantity: 1,
                unitPrice: 0,
                totalPrice: 0,
                type: 'group',
                source: "",
            });
            await loadBudget();
        } catch (e) {
            console.error(e);
        }
    };

    const handleAddSubTitle = async (targetLevel: number = 2) => {
        // Encontrar a última etapa (Nível 1) para ser o pai padrão
        // Logica: Add to last Level 1 found.
        const lastEtapa = [...items].reverse().find(i => i.level === 1);

        if (!lastEtapa) {
            alert("Operação Bloqueada: Nenhuma ETAPA (Nível 1) encontrada. Adicione uma Etapa primeiro para conter esta Sub-etapa.");
            return;
        }

        if (!lastEtapa.id) {
            alert("Erro de Integridade: A Etapa pai não possui ID válido. Recarregue a página.");
            return;
        }

        const title = window.prompt(`Nova SUBETAPA (Nível ${targetLevel}) em "${lastEtapa.description}":`);
        if (!title) return;

        try {
            await BudgetItemService.create({
                budgetId: budgetId,
                order: getNextOrder(),
                level: 2, // USER RULE: Subetapa = 2
                parentId: lastEtapa.id,
                itemNumber: "",
                code: "",
                description: title.toUpperCase(),
                unit: "",
                quantity: 1,
                unitPrice: 0,
                totalPrice: 0,
                type: 'group',
                source: "",
            });
            await loadBudget();
        } catch (e: any) {
            console.error("Falha ao criar Sub-etapa:", e);
            alert(`Erro ao salvar no banco: ${e.message || "Verifique sua conexão"}`);
        }
    };

    const handleAddItem = async () => {
        // REGRA: Items DEVE ser um array (mesmo que vazio)
        if (!selectedResource || !items) {
            console.error("[handleAddItem] Aborting: selectedResource or items missing", { selectedResource, itemsNull: !items });
            return;
        }

        try {
            setLoading(true);
            console.log("[handleAddItem] Starting...", {
                budgetId,
                resource: selectedResource.code,
                tab: addItemTab,
                itemsCount: items.length
            });

            // 1. Verificar se existe pelo menos uma ETAPA (Nível 1)
            const lastEtapa = [...items].reverse().find(i => i.level === 1);

            // 2. Definir o Pai: Prioridade para a última SUBETAPA (L2) DESTA etapa, senão usa a própria ETAPA (L1)
            let targetParentId: string | undefined = lastEtapa?.id;

            // Busca a última subetapa que pertença a esta etapa específica
            if (lastEtapa) {
                const lastSubEtapa = [...items].reverse().find(i => i.level === 2 && i.parentId === lastEtapa.id);
                if (lastSubEtapa && lastSubEtapa.id) {
                    targetParentId = lastSubEtapa.id;
                }
            }

            // 3. Criar o Item na Subetapa ou Etapa Alvo
            const itemData: any = {
                budgetId: budgetId,
                order: getNextOrder(),
                level: 3,
                parentId: targetParentId,
                itemNumber: "",
                code: selectedResource.code,
                description: selectedResource.description,
                unit: selectedResource.unit,
                quantity: Number(quantity),
                unitPrice: selectedResource.price,
                // IMPORTANTE: Restaurar tipo original (material, labor, etc)
                type: selectedResource.originalType || (addItemTab === 'CPU' ? 'service' : 'material'),
                source: selectedResource.source,
                itemType: addItemTab === 'CPU' ? 'composicao' : 'insumo',
                // Linkage UUIDs - Priorizar ID do objeto se disponível
                compositionId: addItemTab === 'CPU' ? (selectedResource.id || selectedResource.raw?.id) : null,
                insumoId: addItemTab === 'INS' ? (selectedResource.id || selectedResource.raw?.id) : null,
            };

            console.log("[handleAddItem] Calling BudgetItemService.create with:", itemData);
            const newItem = await BudgetItemService.create(itemData);
            console.log("[handleAddItem] Created successfully:", newItem.id);

            await loadBudget();
            setIsAddingItem(false);
            setSelectedResource(null);
            setQuantity(1);
            setSearchTerm('');
        } catch (e: any) {
            console.error("Erro ao adicionar item:", e);
            alert(`Erro ao Adicionar Item: ${e.message || "Falha técnica"}`);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteItem = async (itemId: string) => {
        if (!window.confirm("Remover este item?")) return;
        try {
            await BudgetItemService.delete(itemId);

            await loadBudget();
        } catch (e) {
            console.error(e);
        }
    };

    const handleUpdateBDI = async (val: number) => {
        // 1. Atualizar BDI no Orçamento
        // O Backend recalcula automaticamente todos os preços finais dos itens
        await BudgetService.update(budgetId, { bdi: val });
        loadBudget();
    };

    const handleUpdateEncargos = async (val: number, baseInfo?: { desonerado: boolean; id: string }) => {
        if (!budget) return;

        // Determinar regime SINAPI a partir da base de encargos selecionada
        const sinapiRegime = baseInfo?.desonerado ? 'DESONERADO' : 'NAO_DESONERADO';
        const sinapiContractType = tipoEncargo === 'horista' ? 'HORISTA' : 'MENSALISTA';

        // LOG OBRIGATÓRIO: [ENCARGOS APPLY]
        console.log('[ENCARGOS APPLY]', {
            budgetId,
            uf: budget.sinapiUf || 'BA',
            competence: budget.sinapiCompetence || '2025-01',
            regime: sinapiRegime,
            contractType: sinapiContractType,
            encargosPercentage: val,
            baseId: baseInfo?.id
        });

        await BudgetService.update(budgetId, {
            encargosSociais: val,
            sinapiRegime: sinapiRegime as 'DESONERADO' | 'NAO_DESONERADO',
            sinapiContractType: sinapiContractType as 'HORISTA' | 'MENSALISTA'
        });
        loadBudget();
    };

    const calculateBDI = () => {
        const { ac, r, sg, df, l, i_pis, i_cofins, i_iss, i_cprb } = bdiCalc;
        const totalI = (i_pis + i_cofins + i_iss + i_cprb) / 100;
        const numerator = (1 + (ac / 100) + (r / 100) + (sg / 100)) * (1 + (df / 100)) * (1 + (l / 100));
        const denominator = 1 - totalI;
        const result = (numerator / denominator - 1) * 100;
        return result;
    };

    const handleApplyPreset = (preset: any) => {
        setBdiCalc({
            ...bdiCalc,
            ac: preset.ac,
            sg: preset.sg,
            r: preset.r,
            df: preset.df,
            l: preset.l
        });
    };

    const handleApplyBDI = async () => {
        const val = calculateBDI();
        if (!budget) return;
        await BudgetService.update(budgetId, { bdi: Number(val.toFixed(2)) });
        setShowBDICalculator(false);
        loadBudget();
    };

    const handleReorderItems = async () => {
        if (!items) return;
        setLoading(true);
        try {
            const sortedItems = [...items].sort((a, b) => (a.order || 0) - (b.order || 0));

            let c1 = 0; // Etapa (L1)
            let c2 = 0; // Sub-etapa (L2)
            let c3 = 0; // Item (L3)

            const updates = sortedItems.map((item, i) => {
                if (item.level === 1) {
                    c1++;
                    c2 = 0;
                    c3 = 0;
                } else if (item.level === 2) {
                    c2++;
                    c3 = 0;
                } else if (item.level >= 3) {
                    c3++;
                }

                let itemNumberStr = "";
                if (item.level === 1) itemNumberStr = `${c1}`;
                else if (item.level === 2) itemNumberStr = `${c1}.${c2}`;
                else itemNumberStr = `${c1}.${c2}.${c3}`;

                const currentOrder = i + 1;

                if (item.order !== currentOrder || item.itemNumber !== itemNumberStr) {
                    return BudgetItemService.update(item.id!, {
                        order: currentOrder,
                        itemNumber: itemNumberStr
                    }).catch(err => {
                        console.error(`Falha ao atualizar item ${item.id}: `, err);
                        return { error: true, itemId: item.id };
                    });
                }
                return Promise.resolve({ success: true });
            });

            const results = await Promise.all(updates);
            const failures = results.filter((r: any) => r?.error);

            if (failures.length > 0) {
                alert(`Atenção: ${failures.length} itens não puderam ser atualizados.`);
            } else {
                await loadBudget();
                alert("Numeração e Ordem recalculadas com sucesso!");
            }
        } catch (error) {
            console.error("Erro geral ao reordenar:", error);
            alert("Erro ao recalcular numeração.");
        } finally {
            setLoading(false);
        }
    };


    const handleDragStart = (e: React.DragEvent, index: number) => {
        setDraggedItemIndex(index);
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", index.toString());
        }
    };

    const handleDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        if (draggedItemIndex !== index) {
            setDragOverIndex(index);
        }
    };

    const handleDrop = async (e: React.DragEvent, dropIndex: number) => {
        e.preventDefault();
        if (draggedItemIndex === null || draggedItemIndex === dropIndex || !items) {
            setDraggedItemIndex(null);
            setDragOverIndex(null);
            return;
        }

        const newItems = [...items];
        const [draggedItem] = newItems.splice(draggedItemIndex, 1);
        newItems.splice(dropIndex, 0, draggedItem);

        // Update orders in DB
        try {
            const updates = newItems.map((item, i) => {
                if (item.order !== i) {
                    return BudgetItemService.update(item.id, { order: i });
                }
                return Promise.resolve();
            });
            await Promise.all(updates);
            loadBudget();
        } catch (e) {
            console.error(e);
        }

        setDraggedItemIndex(null);
        setDragOverIndex(null);
    };

    const getExecutiveSummary = () => {
        if (!items) return [];
        const summary: { [key: string]: number } = {};
        items.forEach(item => {
            const cc = item.costCenter || "Sem Centro de Custo";
            summary[cc] = (summary[cc] || 0) + item.totalPrice;
        });
        return Object.entries(summary).map(([name, value]) => ({ name, value }));
    };

    const validatePriceRange = (item: any) => {
        // Mock validation: High prices (> 1000) or Low prices (< 1)
        if (item.unitPrice > 1000) return 'high';
        if (item.unitPrice < 0.1 && item.unitPrice > 0) return 'low';
        return 'normal';
    };

    const handleUpdateStatus = async (status: string) => {
        await BudgetService.update(budgetId, { status: status as any });
        loadBudget();
    };

    const handleUpdateName = async (newName: string) => {
        if (!budget) return;
        await BudgetService.update(budgetId, { name: newName });
        loadBudget();
    };

    const handleUpdateClient = async (newClient: string) => {
        if (!budget) return;
        await BudgetService.update(budgetId, { client: newClient });
        loadBudget();
    };

    const handleToggleLock = async (item: any) => {
        try {
            await BudgetItemService.update(item.id, { isLocked: !item.isLocked });
            loadBudget();
        } catch (e) {
            console.error(e);
        }
    };

    const handleDuplicateItem = async (item: any) => {
        try {
            const { id, updatedAt, ...cleanItem } = item;
            await BudgetItemService.create({
                ...cleanItem,
                budgetId: budgetId,
                order: (item.order || 0) + 1,
                itemNumber: (item.itemNumber || '') + " (Cópia)"
            });
            // Recalculate Total
            const itemTotal = (item.type === 'group' ? 0 : item.totalPrice);
            const newTotal = (budget.totalValue || 0) + itemTotal;
            await BudgetService.update(budgetId, { totalValue: newTotal });

            loadBudget();
        } catch (e) {
            console.error(e);
        }
    };

    const handleSwitchBase = async (item: any, targetSource: string) => {
        try {
            await BudgetItemService.update(item.id, { source: targetSource as any });
            loadBudget();
        } catch (e) {
            console.error(e);
        }
    };



    const handleBulkSwitchBase = async (targetSource: string) => {
        if (selectedItemIds.size === 0) return;
        setLoading(true);
        try {
            for (const id of Array.from(selectedItemIds)) {
                await BudgetItemService.update(id, { source: targetSource as any });
            }
            loadBudget();
            setSelectedItemIds(new Set());
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const validateItemUnit = (item: any, comps: any[]) => {
        if (!item || comps.length === 0) return false;
        // Simple logic: if item is M3 but has components in M2 only, or vice versa
        // This is a placeholder for more advanced unit compatibility matrix
        const itemUnit = item.unit?.toUpperCase();
        const compUnits = comps.map(c => c.unit?.toUpperCase());

        if (itemUnit === 'M3' && compUnits.includes('M2') && !compUnits.includes('M3')) return true;
        return false;
    };

    const getImpact = () => {
        if (!budget || !originalTotal) return { value: 0, percent: 0 };
        const diff = budget.totalValue - originalTotal;
        const percent = originalTotal > 0 ? (diff / originalTotal) * 100 : 0;
        return { value: diff, percent };
    };

    useEffect(() => {
        if (budget && originalTotal === 0 && budget.totalValue > 0) {
            setOriginalTotal(budget.totalValue);
        }
    }, [budget, originalTotal]);

    const getABCData = async () => {
        if (!items) return [];

        let consolidated: any[] = [];
        let grandTotal = 0;

        if (abcType === 'insumos') {
            const tempConsolidated: Record<string, {
                code: string,
                description: string,
                unit: string,
                quantity: number,
                unitPrice: number,
                total: number,
                source: string
            }> = {};

            for (const item of items) {
                if (item.type === 'group') continue;

                const compositions = await BudgetItemCompositionService.getByBudgetItemId(item.id!);

                if (compositions.length > 0) {
                    for (const comp of compositions) {
                        const c = comp as any;
                        const key = `${c.source || 'OWN'} -${c.code || c.description} `;
                        if (!tempConsolidated[key]) {
                            tempConsolidated[key] = {
                                code: c.code || '',
                                description: c.description,
                                unit: c.unit,
                                quantity: 0,
                                unitPrice: c.unitPrice,
                                total: 0,
                                source: c.source || 'OWN'
                            };
                        }
                        const totalItemQty = c.quantity * item.quantity;
                        tempConsolidated[key].quantity += totalItemQty;
                        tempConsolidated[key].total += c.totalPrice * item.quantity;
                        grandTotal += c.totalPrice * item.quantity;
                    }
                } else {
                    const key = `${item.source} -${item.code} `;
                    if (!tempConsolidated[key]) {
                        tempConsolidated[key] = {
                            code: item.code || '',
                            description: item.description || '',
                            unit: item.unit || '',
                            quantity: 0,
                            unitPrice: item.unitPrice,
                            total: 0,
                            source: item.source || ''
                        };
                    }
                    tempConsolidated[key].quantity += item.quantity;
                    tempConsolidated[key].total += item.totalPrice;
                    grandTotal += item.totalPrice;
                }
            }
            consolidated = Object.values(tempConsolidated);
        } else {
            // Serviços - Lista os itens diretos da planilha
            for (const item of items) {
                if (item.type === 'group') continue;
                consolidated.push({
                    itemNumber: getItemNumber(items.indexOf(item)),
                    code: item.code,
                    description: item.description,
                    unit: item.unit,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    total: item.totalPrice,
                    source: item.source
                });
                grandTotal += item.totalPrice;
            }
        }

        // Ordenar por valor decrescente
        const sorted = consolidated.sort((a, b) => b.total - a.total);
        let runningTotal = 0;

        return sorted.map(item => {
            runningTotal += item.total;
            const weight = grandTotal ? (item.total / grandTotal) * 100 : 0;
            const accumulatedWeight = grandTotal ? (runningTotal / grandTotal) * 100 : 0;

            let group = 'C';
            if (accumulatedWeight <= 80.01) group = 'A';
            else if (accumulatedWeight <= 95.01) group = 'B';

            return { ...item, weight, accumulatedWeight, group };
        });
    };

    useEffect(() => {
        if (showABC) {
            getABCData().then(setAbcData);
        }
    }, [showABC, items, abcType]);

    const handleExportABCPDF = async () => {
        try {
            if (!budget || !items) return;

            const { exportABCServicos, exportABCInsumos } = await import('../utils/budgetExport');

            // BUG B FIX: Hidratar composition para ABC Insumos
            const itemsWithNumbers = await Promise.all(items.map(async (item, idx) => {
                const composition = (abcType === 'insumos' && item.level >= 3 && item.type !== 'group')
                    ? await BudgetItemCompositionService.getByBudgetItemId(item.id!)
                    : [];
                return {
                    ...item,
                    itemNumber: getItemNumber(idx),
                    composition
                };
            }));

            const exportData = {
                budgetName: budget.name,
                clientName: budget.client,
                date: budget.date,
                bdi: budget.bdi || 0,
                encargos: budget.encargosSociais || 0,
                items: itemsWithNumbers,
                companySettings: settings,
                totalGlobalBase: calcResult?.totalGlobalBase,
                totalGlobalFinal: calcResult?.totalGlobalFinal
            };

            // BUG A FIX: Log de prova OBRIGATÓRIO
            console.log("[EXPORT TOTALS]", {
                base: calcResult?.totalGlobalBase,
                bdi: (calcResult?.totalGlobalFinal || 0) - (calcResult?.totalGlobalBase || 0),
                total: calcResult?.totalGlobalFinal
            });

            if (abcType === 'servicos') {
                await exportABCServicos(exportData);
            } else {
                await exportABCInsumos(exportData);
            }
        } catch (err) {
            console.error("Erro ao gerar Curva ABC PDF:", err);
            alert("Erro ao gerar o arquivo PDF da Curva ABC.");
        }
    };

    const handleExportABCExcel = async () => {
        try {
            if (!budget || !items) return;

            const { exportABCServicosExcel, exportABCInsumosExcel } = await import('../utils/budgetExport');

            // BUG B FIX: Hidratar composition para ABC Insumos
            const itemsWithNumbers = await Promise.all(items.map(async (item, idx) => {
                const composition = (abcType === 'insumos' && item.level >= 3 && item.type !== 'group')
                    ? await BudgetItemCompositionService.getByBudgetItemId(item.id!)
                    : [];
                return {
                    ...item,
                    itemNumber: getItemNumber(idx),
                    composition
                };
            }));

            const exportData = {
                budgetName: budget.name,
                clientName: budget.client,
                date: budget.date,
                bdi: budget.bdi || 0,
                encargos: budget.encargosSociais || 0,
                items: itemsWithNumbers,
                companySettings: settings,
                totalGlobalBase: calcResult?.totalGlobalBase,
                totalGlobalFinal: calcResult?.totalGlobalFinal
            };

            // Logs removidos para produção

            if (abcType === 'servicos') {
                await exportABCServicosExcel(exportData);
            } else {
                await exportABCInsumosExcel(exportData);
            }
        } catch (err) {
            console.error("Erro ao gerar Curva ABC Excel:", err);
            alert("Erro ao gerar o arquivo Excel da Curva ABC.");
        }
    };

    const handleStartEdit = async (item: any) => {
        setEditingItem(item);
        let comp = await BudgetItemCompositionService.getByBudgetItemId(item.id!);

        if (comp.length === 0 && item.compositionId) {
            const globalCompItems = await CompositionService.getItems(item.compositionId);
            if (globalCompItems.length > 0) {
                const newComp = globalCompItems.map(gc => ({
                    budgetItemId: item.id!,
                    description: gc.descricaoInsumo,
                    unit: gc.unidadeInsumo,
                    quantity: gc.coeficiente,
                    unitPrice: gc.precoUnitario,
                    totalPrice: gc.custoTotal,
                    type: 'material' as any // Default mapping
                }));
                await BudgetItemCompositionService.batchCreate(newComp);
                comp = await BudgetItemCompositionService.getByBudgetItemId(item.id!);
            }
        }
        setItemComposition(comp);
    };

    const evaluateCalculation = (formula: string): number => {
        try {
            // Limpa espaços e substitui vírgula por ponto
            const clean = formula.replace(/\s+/g, '').replace(/,/g, '.');
            // Apenas permite números e operadores básicos para segurança básica
            if (/[^0-9+\-*/().]/.test(clean)) return 0;
            // eslint-disable-next-line no-new-func
            return new Function(`return ${clean} `)() || 0;
        } catch {
            return 0;
        }
    };

    const handleUpdateItem = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingItem) return;

        // Se houver memória de cálculo, recalcular a quantidade
        let finalQuantity = editingItem.quantity;
        if (editingItem.calculationMemory) {
            finalQuantity = evaluateCalculation(editingItem.calculationMemory);
        }

        // Se tiver composição, o preço unitário é a soma da composição
        let finalUnitPrice = editingItem.unitPrice;
        if (itemComposition.length > 0) {
            finalUnitPrice = itemComposition.reduce((acc, c) => acc + c.totalPrice, 0);
        }

        // const newTotal = finalQuantity * finalUnitPrice;

        try {
            await BudgetItemService.update(editingItem.id, {
                description: editingItem.description,
                unit: editingItem.unit,
                quantity: finalQuantity,
                calculationMemory: editingItem.calculationMemory,
                customBDI: editingItem.customBDI,
                unitPrice: finalUnitPrice,
                // totalPrice calculado pelo backend
                costCenter: editingItem.costCenter,
                updatedAt: new Date()
            });

            await BudgetService.update(budgetId, { updatedAt: new Date() });

            // Salvar composição
            await BudgetItemCompositionService.deleteByBudgetItemId(editingItem.id);
            if (itemComposition.length > 0) {
                await BudgetItemCompositionService.batchCreate(itemComposition.map(c => {
                    const { id, ...rest } = c;
                    return { ...rest, budgetItemId: editingItem.id };
                }));
            }

            await loadBudget();
        } catch (error) {
            console.error("Error updating item:", error);
            alert("Erro ao atualizar item.");
        }

        setEditingItem(null);
        setItemComposition([]);
    };

    // =========================================================================================
    // DATASET OFICIAL (Source of Truth) para GRID e EXPORTS
    // =========================================================================================
    const visibleRows = useMemo(() => {
        if (!items || !budget) {
            return [];
        }

        // V2: Use factors obj
        const { materialFactor, laborFactor, bdiFactor } = adjustmentFactors;

        // BDI Budget (Display)
        // If mode=bdi_only, bdi is effectively changed on items finalPrice, but global BDI % remains same on budget settings.
        // Or should we fake the budget BDI? No. Keep it clean. Items have final Price.

        // Recalculate totals for Weight distribution
        let totalFinalAdj = 0;

        // First Pass: Calculate Adjusted Values & Total
        const adjustedItems = items.map(item => {
            const isGroup = item.type === 'group';

            // Calc adjusted parts using V2 Util
            const adjusted = getAdjustedItemValues(
                {
                    unitPrice: item.unitPrice || 0,
                    description: item.description,
                    type: item.type
                },
                { materialFactor, laborFactor, bdiFactor },
                budget.bdi || 0
            );

            // Totals
            const quantity = item.quantity || 0;
            const totalPrice = quantity * adjusted.unitPrice; // Total Base
            const finalPrice = quantity * adjusted.finalPrice; // Total Final

            if (!isGroup && item.level >= 3) {
                totalFinalAdj += finalPrice;
            }

            return {
                ...item,
                _adjusted: adjusted,
                _amounts: {
                    unitPrice: adjusted.unitPrice,
                    finalPrice: adjusted.finalPrice, // unit final
                    totalPrice: totalPrice, // total base
                    totalFinal: finalPrice, // total final
                }
            };
        });

        return adjustedItems.map((item, idx) => {
            const isGroup = item.type === 'group';
            const itemNumber = getItemNumber(idx);

            // Values to display
            const { unitPrice, finalPrice, totalPrice, totalFinal } = item._amounts;

            const itemTotalFinal = totalFinal;
            const pesoRaw = totalFinalAdj > 0 ? (itemTotalFinal / totalFinalAdj) : 0;

            // Flattened Row (SSOT)
            return {
                ...item, // Base (raw properties)

                // Metadados
                kind: isGroup ? 'GROUP' : 'ITEM',
                itemNumber,
                origin: item._adjusted.origin, // Info extra para debug/UI se quiser

                // Dados Higienizados
                code: isGroup ? '' : (item.code || ''),
                source: isGroup ? '' : (item.source || ''),
                unit: isGroup ? '' : (item.unit || ''),

                // Valores Numéricos AJUSTADOS (Source of Truth)
                quantity: isGroup ? undefined : item.quantity,
                unitPrice: isGroup ? undefined : unitPrice,        // Unit Base
                unitPriceWithBDI: isGroup ? undefined : finalPrice, // Unit Final (com BDI + Ajuste)

                // Totais
                totalPrice: isGroup ? 0 : totalPrice,   // Total Base
                finalPrice: isGroup ? 0 : itemTotalFinal, // Total Final (Novo conceito: finalPrice agora é TOTAL final, não unit) 
                // Wait. In legacy code, finalPrice was TOTAL final?
                // Legacy: `finalPrice = totalPriceAdj * bdiFactor`. Yes, it was TOTAL.
                // My util `getAdjustedItemValues` returns `finalPrice` as UNIT FINAL.
                // So I multiplied by Quantity above. Correct.

                total: itemTotalFinal, // Alias para legacy grids
                pesoRaw: pesoRaw
            };
        });
    }, [items, budget, adjustmentFactors]);

    // Totais Globais atualizados para Header (Baseados no visibleRows)
    const { totalBase, totalFinal } = useMemo(() => {
        return visibleRows.reduce((acc, row) => {
            if (row.kind === 'ITEM' && row.level >= 3) {
                return {
                    totalBase: acc.totalBase + (row.totalPrice || 0),
                    totalFinal: acc.totalFinal + (row.finalPrice || 0)
                };
            }
            return acc;
            return visibleRows.reduce((acc, row) => {
                if (row.kind === 'ITEM' && row.level >= 3) {
                    return {
                        totalBase: acc.totalBase + (row.totalPrice || 0),
                        totalFinal: acc.totalFinal + (row.finalPrice || 0)
                    };
                }
                return acc;
            }, { totalBase: 0, totalFinal: 0 });
        }, [visibleRows]);

        // Alias para compatibilidade
        const totalBudget = totalBase;


        const validateAnalytics = async (): Promise<boolean> => {
            // Bloqueio por Divergência de Preços (Anti-Desclassificação)
            if (budget?.metadata?.has_pricing_divergence) {
                alert("⚠️ BLOQUEIO DE SEGURANÇA (LICITAÇÃO)\n\nO orçamento possui divergências entre valores sintéticos e analíticos (provavelmente devido a um ajuste global parcial).\n\nPara corrigir:\n1. Reutilize o Ajuste Global com a opção 'Aplicar também na analítica'.\n2. Ou ajuste os itens manualmente.\n\nEssa medida evita a desclassificação da proposta.");
                return false;
            }

            if (!items) return true;
            setLoading(true);
            try {
                const missing: any[] = [];
                const divergent: any[] = [];

                // Check visible items that should have composition
                // FIX: Usar APENAS compositionId como sinal de CPU (Definitivo)
                const candidates = visibleRows.filter(r =>
                    r.kind === 'ITEM' && r.compositionId && r.compositionId.length > 0
                );

                await Promise.all(candidates.map(async (item) => {
                    const children = await BudgetItemCompositionService.getByBudgetItemId(item.id!);

                    // 1. Check Missing
                    if (!children || children.length === 0) {
                        missing.push(item);
                    } else {
                        // 2. Check Divergence (Deep Check)
                        const synthUnit = item.unitPrice || 0; // Já ajustado em visibleRows (Base Unit)

                        // Recalcular soma analítica ajustada
                        const { materialFactor, laborFactor, bdiFactor } = adjustmentFactors;

                        const analyticSum = children.reduce((acc, c) => {
                            const adj = getAdjustedItemValues(
                                { unitPrice: c.unitPrice, description: c.description, type: c.type },
                                { materialFactor, laborFactor, bdiFactor },
                                budget.bdi || 0
                            );
                            // Soma dos unitários base * quantidade
                            return acc + (adj.unitPrice * c.quantity);
                        }, 0);

                        if (Math.abs(synthUnit - analyticSum) > 0.01) {
                            // Divergência detectada
                            // analyticSum aqui é BASE. expected também é BASE.
                            divergent.push({ ...item, analyticSum, expected: synthUnit });
                        }
                    }
                }));

                setPendingAnalytics(missing);
                setDivergentItems(divergent);

                if (missing.length > 0) {
                    setShowAnalyticModal(true);
                    return false;
                }

                if (divergent.length > 0) {
                    alert(`IMPOSSÍVEL EXPORTAR (Proteção de Licitação):\n\nIdentificamos ${divergent.length} composições com divergência de preço.\nTotal Sintético não bate com a soma Analítica.\n\nUse o botão "CORRIGIR AGORA" no alerta vermelho para resolver.`);
                    return false;
                }

                return true;
            } catch (err) {
                console.error("Analytic validation failed", err);
                return false;
            } finally {
                setLoading(false);
            }
        };

        const handleExportPDF = async (type: 'synthetic' | 'analytic') => {
            if (type === 'analytic') {
                const isValid = await validateAnalytics();
                if (!isValid) return;
            }

            try {
                if (!budget || !items) return;

                // Importar funções de exportação
                const { exportPDFSynthetic, exportPDFAnalytic } = await import('../utils/budgetExport');

                // Flatten rows for export using visibleRows (SSOT)
                // Como visibleRows já é flat, apenas carregamos composição se necessário
                const exportItems = await Promise.all(visibleRows.map(async (row) => {
                    // Fetch composition RAW
                    const compositionRaw = type === 'analytic'
                        ? await BudgetItemCompositionService.getByBudgetItemId(row.id!)
                        : [];

                    // Apply Adjustment to Composition
                    const { materialFactor, laborFactor, bdiFactor } = adjustmentFactors;
                    const composition = compositionRaw.map(c => {
                        const adj = getAdjustedItemValues(
                            { unitPrice: c.unitPrice, description: c.description, type: c.type },
                            { materialFactor, laborFactor, bdiFactor },
                            budget.bdi || 0
                        );
                        return {
                            ...c,
                            unitPrice: adj.unitPrice, // Export base unit
                            finalPrice: adj.finalPrice,
                            totalPrice: adj.unitPrice * c.quantity // Total Base
                        };
                    });

                    return {
                        ...row,
                        composition
                    };
                }));

                const exportData = {
                    budgetName: budget.name,
                    clientName: budget.client,
                    date: budget.date,
                    bdi: budget.bdi || 0,
                    encargos: budget.encargosSociais || 0,
                    items: exportItems,
                    companySettings: settings,
                    totalGlobalBase: calcResult?.totalGlobalBase,
                    totalGlobalFinal: calcResult?.totalGlobalFinal,
                    adjustmentSettings: budget.settings?.global_adjustment_v2
                };

                // Logs removidos para produção


                if (type === 'synthetic') {
                    await exportPDFSynthetic(exportData);
                } else {
                    await exportPDFAnalytic(exportData);
                }
            } catch (err) {
                console.error("Erro ao gerar PDF:", err);
                alert("Erro ao gerar o arquivo PDF. Verifique o console para mais detalhes.");
            }
        };

        const handleExportExcel = async (type: 'synthetic' | 'analytic' = 'synthetic') => {
            if (type === 'analytic') {
                const isValid = await validateAnalytics();
                if (!isValid) return;
            }

            try {
                if (!budget || !items) return;

                const { exportExcelSynthetic, exportExcelAnalytic } = await import('../utils/budgetExport');

                // Flatten rows for export using visibleRows (SSOT)
                // Reusing logic from handleExportPDF to ensure consistency
                const exportItems = await Promise.all(visibleRows.map(async (row) => {
                    // Fetch composition RAW for analytic
                    const compositionRaw = type === 'analytic'
                        ? await BudgetItemCompositionService.getByBudgetItemId(row.id!)
                        : [];

                    // Apply Adjustment to Composition
                    const { materialFactor, laborFactor, bdiFactor } = adjustmentFactors;
                    const composition = compositionRaw.map(c => {
                        const adj = getAdjustedItemValues(
                            { unitPrice: c.unitPrice, description: c.description, type: c.type },
                            { materialFactor, laborFactor, bdiFactor },
                            budget.bdi || 0
                        );
                        return {
                            ...c,
                            unitPrice: adj.unitPrice,
                            finalPrice: adj.finalPrice,
                            totalPrice: adj.unitPrice * c.quantity
                        };
                    });

                    return {
                        ...row,
                        composition
                    };
                }));

                // Logs removidos para produção

                const exportData = {
                    budgetName: budget.name,
                    clientName: budget.client,
                    date: budget.date,
                    bdi: budget.bdi || 0,
                    encargos: budget.encargosSociais || 0,
                    items: exportItems,
                    companySettings: settings,
                    totalGlobalBase: calcResult?.totalGlobalBase,
                    totalGlobalFinal: calcResult?.totalGlobalFinal,
                    adjustmentSettings: budget.settings?.global_adjustment_v2
                };

                if (type === 'synthetic') {
                    await exportExcelSynthetic(exportData);
                } else {
                    await exportExcelAnalytic(exportData);
                }

            } catch (err) {
                console.error("Erro ao gerar Excel:", err);
                alert("Erro ao exportar para Excel. Verifique o console.");
            }
        };

        const handleImportItems = async (importedItems: any[]) => {
            if (!budget) return;
            setLoading(true);
            try {
                // Batch insertion
                // Note: Simplistic sequential insert. For large files, use RPC or Batch Insert service if available.
                for (const item of importedItems) {
                    await BudgetItemService.create({
                        budgetId: budget.id,
                        type: item.type,
                        code: item.code,
                        description: item.description,
                        unit: item.unit,
                        quantity: item.quantity,
                        unitPrice: item.unitPrice,
                        level: item.level || 1, // Ensure level
                        source: item.source,
                        // Linkage
                        insumoId: item.resourceType === 'INPUT' ? item.budgetItemId : null,
                        compositionId: item.resourceType === 'COMPOSITION' ? item.budgetItemId : null,
                    });
                }

                await loadBudget();
                alert("Importação concluída com sucesso!");
            } catch (error) {
                console.error("Import error:", error);
                alert("Erro ao salvar itens importados.");
            } finally {
                setLoading(false);
            }
        };



        const handleExportCompleteZip = async () => {
            const isValid = await validateAnalytics();
            if (!isValid) return;

            setIsExportingZip(true);
            setExportProgress({ current: 0, total: 6, message: 'Iniciando...' });

            try {
                if (!budget || !items) {
                    alert('Não há dados para exportar');
                    return;
                }

                const { exportCompleteProject } = await import('../utils/budgetExport');

                // Preparar itens com numeração e composições (Items RAW -> Adjusted)
                const { materialFactor, laborFactor, bdiFactor } = adjustmentFactors;

                const itemsWithNumbers = await Promise.all(items.map(async (item, idx) => {
                    const compositionRaw = item.type !== 'group'
                        ? await BudgetItemCompositionService.getByBudgetItemId(item.id!).catch(() => [])
                        : [];

                    const composition = compositionRaw.map(c => {
                        const adj = getAdjustedItemValues(
                            { unitPrice: c.unitPrice, description: c.description, type: c.type },
                            { materialFactor, laborFactor, bdiFactor },
                            budget.bdi || 0
                        );
                        return {
                            ...c,
                            unitPrice: adj.unitPrice,
                            finalPrice: adj.finalPrice,
                            totalPrice: adj.unitPrice * c.quantity
                        };
                    });

                    // Apply adjustment to item itself (since 'items' is RAW)
                    const itemAdj = getAdjustedItemValues(
                        { unitPrice: item.unitPrice || 0, description: item.description, type: item.type },
                        { materialFactor, laborFactor, bdiFactor },
                        budget.bdi || 0
                    );

                    const unitPriceAdj = itemAdj.unitPrice;
                    const totalPriceAdj = (item.quantity || 0) * unitPriceAdj;
                    const finalPriceAdj = itemAdj.finalPrice * (item.quantity || 0);

                    return {
                        ...item,
                        unitPrice: unitPriceAdj,
                        totalPrice: totalPriceAdj,
                        finalPrice: finalPriceAdj,
                        itemNumber: getItemNumber(idx),
                        composition
                    };
                }));



                await exportCompleteProject({
                    budgetName: budget.name,
                    clientName: budget.client,
                    date: budget.date,
                    bdi: budget.bdi || 0,
                    encargos: budget.encargosSociais || 0,
                    items: itemsWithNumbers,
                    companySettings: settings,
                    totalGlobalBase: calcResult?.totalGlobalBase,
                    totalGlobalFinal: calcResult?.totalGlobalFinal
                }, (current, total, message) => {
                    setExportProgress({ current, total, message });
                });

            } catch (error) {
                console.error("Erro ao gerar ZIP completo:", error);
                alert("Erro ao exportar projeto completo. Verifique o console.");
            } finally {
                setIsExportingZip(false);
                setExportProgress({ current: 0, total: 0, message: '' });
            }
        };

        if (loading) {
            return (
                <div className="flex flex-col items-center justify-center h-screen bg-slate-50 gap-4">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
                    <p className="text-slate-500 font-medium animate-pulse">Carregando orçamento...</p>
                </div>
            );
        }

        if (!budget) {
            return (
                <div className="flex flex-col items-center justify-center h-screen bg-slate-50 gap-4">
                    <AlertTriangle size={48} className="text-red-400" />
                    <h2 className="text-xl font-bold text-slate-700">Orçamento não encontrado</h2>
                    <p className="text-slate-500 max-w-md text-center">
                        Não foi possível carregar os dados deste orçamento. Verifique se o link está correto ou se você tem permissão para acessá-lo.
                    </p>
                    <div className="flex gap-4 mt-4">
                        <button
                            onClick={() => navigate('/budgets')}
                            className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors font-medium"
                        >
                            Voltar para Lista
                        </button>
                        <button
                            onClick={() => window.location.reload()}
                            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors font-medium"
                        >
                            Tentar Novamente
                        </button>
                    </div>
                </div>
            );
        }



        // CÁLCULO DE TOTAIS VISUAIS - REGRA 4 e 5
        // totalBase: Soma de totalPrice (que já é Base de Custo Direto)

        // Totais calculados anteriormente (acima)

        return (
            <div className="flex flex-col h-full overflow-hidden bg-background">
                {/* Aviso Mobile - Modo Visualização */}
                {isMobile && (
                    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center gap-2 shrink-0">
                        <Eye size={14} className="text-amber-600" />
                        <p className="text-xs text-amber-700">
                            <span className="font-semibold">Modo visualização.</span> Para edição completa, utilize um dispositivo maior.
                        </p>
                    </div>
                )}

                {/* Warning de Divergência */}
                {(budget?.metadata?.has_pricing_divergence || divergentItems.length > 0) && (
                    <div className="bg-red-50 border-b border-red-200 px-4 py-3 flex items-center justify-between gap-4 shrink-0 animate-in slide-in-from-top-2">
                        <div className="flex items-center gap-3">
                            <AlertOctagon size={20} className="text-red-600" />
                            <div>
                                <p className="text-sm font-black text-red-700 uppercase tracking-wide">
                                    {divergentItems.length > 0 ? `${divergentItems.length} COMPOSIÇÕES DIVERGENTES` : "DIVERGÊNCIA CRÍTICA DETECTADA"}
                                </p>
                                <p className="text-xs text-red-600">
                                    {divergentItems.length > 0
                                        ? "A soma analítica dos itens não bate com o valor sintético. Risco de desclassificação."
                                        : "Valores analíticos desatualizados. Execute a validação para ver detalhes."}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={() => setShowAdjustmentModal(true)}
                            className="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-bold rounded-lg transition-colors border border-red-200"
                        >
                            CORRIGIR AGORA
                        </button>
                    </div>
                )}

                {/* Header Responsivo */}
                {/* Header Responsivo */}
                <header className={clsx(
                    "bg-white border-b border-border shrink-0 z-20 shadow-sm/50",
                    isMobile ? "px-4 py-3" : "px-6 py-4"
                )}>
                    {/* Mobile Header */}
                    {isMobile ? (
                        <div className="space-y-3">
                            {/* Linha 1: Voltar + Nome + Status */}
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => navigate('/budgets')}
                                    className="w-10 h-10 flex items-center justify-center rounded-lg bg-slate-100 text-slate-500"
                                >
                                    <ArrowLeft size={20} />
                                </button>
                                <div className="flex-1 min-w-0 flex items-center justify-between gap-3">
                                    <div className="flex-1 min-w-0">
                                        <input
                                            type="text"
                                            defaultValue={budget.name}
                                            onBlur={(e) => handleUpdateName(e.target.value)}
                                            className="w-full font-black text-slate-800 bg-transparent border-none p-0 focus:ring-0 text-base"
                                        />
                                        <input
                                            type="text"
                                            defaultValue={budget.client || ''}
                                            placeholder="Nome do cliente..."
                                            onBlur={(e) => handleUpdateClient(e.target.value)}
                                            className="w-full text-[10px] text-slate-400 font-bold uppercase tracking-wider bg-transparent border-none p-0 focus:ring-0"
                                        />
                                    </div>
                                    <span className={clsx(
                                        "text-[10px] font-bold px-2 py-1 rounded uppercase shrink-0",
                                        budget.status === 'draft' ? "bg-slate-100 text-slate-500" :
                                            budget.status === 'pending' ? "bg-blue-50 text-blue-600" :
                                                "bg-green-50 text-green-600"
                                    )}>
                                        {budget.status === 'draft' ? 'Rascunho' : budget.status === 'pending' ? 'Pendente' : 'Aprovado'}
                                    </span>
                                </div>
                            </div>

                            {/* Linha 2: Total + Ações Prioritárias (Download) */}
                            <div className="flex items-center justify-between bg-slate-50 rounded-lg p-3">
                                <div className="flex flex-col">
                                    <p className="text-[10px] text-slate-400 font-semibold uppercase">Total Global (C/ BDI)</p>
                                    <div className="flex items-baseline gap-2">
                                        <p className="text-xl font-bold text-primary">
                                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalBudget * (1 + (budget.bdi || 0) / 100))}
                                        </p>
                                        <span className="text-[10px] font-bold text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded">
                                            + {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalBudget * ((budget.bdi || 0) / 100))} (BDI)
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => handleExportPDF('synthetic')}
                                        className="w-10 h-10 flex items-center justify-center bg-blue-600 text-white rounded-lg shadow-sm active:scale-95 transition-transform"
                                        title="PDF Sintético"
                                    >
                                        <FileText size={18} />
                                    </button>
                                    <button
                                        onClick={() => handleExportExcel('synthetic')}
                                        className="w-10 h-10 flex items-center justify-center bg-green-600 text-white rounded-lg shadow-sm active:scale-95 transition-transform"
                                        title="Excel Sintético"
                                    >
                                        <FileSpreadsheet size={18} />
                                    </button>
                                </div>
                            </div>

                            {/* Linha 3: Indicadores BDI/Encargos (Compactos) */}
                            <div className="flex gap-4 text-center">
                                <div className="flex-1 bg-slate-50 rounded-lg p-2">
                                    <p className="text-[10px] text-slate-400 font-semibold uppercase">BDI</p>
                                    <p className="text-sm font-bold text-accent">{budget.bdi?.toFixed(2)}%</p>
                                </div>
                                <div className="flex-1 bg-slate-50 rounded-lg p-2">
                                    <p className="text-[10px] text-slate-400 font-semibold uppercase">Encargos</p>
                                    <p className="text-sm font-bold text-slate-600">{budget.encargosSociais?.toFixed(2)}%</p>
                                </div>
                                <div className="flex-1 bg-slate-50 rounded-lg p-2">
                                    <p className="text-[10px] text-slate-400 font-semibold uppercase">Itens</p>
                                    <p className="text-sm font-bold text-slate-600">{items?.filter(i => i.type !== 'group').length || 0}</p>
                                </div>
                            </div>
                        </div>
                    ) : (
                        /* Desktop Header - Reorganizado */
                        /* Desktop Header - Reorganizado */
                        <div className="flex items-center justify-between gap-0">
                            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide flex-1 min-w-0 pr-2">
                                {/* Seção Esquerda: Voltar + Info do Orçamento */}
                                <div className="flex items-center gap-2 shrink-0">
                                    <button
                                        onClick={() => navigate('/budgets')}
                                        className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 transition-colors"
                                        title="Voltar"
                                    >
                                        <ArrowLeft size={18} />
                                    </button>
                                    <div className="min-w-0">
                                        <input
                                            type="text"
                                            defaultValue={budget.name}
                                            onBlur={(e) => handleUpdateName(e.target.value)}
                                            className="text-lg font-black text-primary leading-tight truncate max-w-[200px] xl:max-w-[300px] bg-transparent border-b border-transparent hover:border-slate-300 focus:border-accent outline-none transition-all"
                                            title="Clique para editar o nome"
                                        />
                                        <div className="flex items-center gap-2 mt-0.5">
                                            <select
                                                value={budget.status}
                                                onChange={(e) => handleUpdateStatus(e.target.value)}
                                                className={clsx(
                                                    "text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider border outline-none cursor-pointer",
                                                    budget.status === 'draft' ? "bg-slate-100 text-slate-500 border-slate-200" :
                                                        budget.status === 'pending' ? "bg-blue-50 text-blue-600 border-blue-100" :
                                                            "bg-green-50 text-green-600 border-green-100"
                                                )}
                                            >
                                                <option value="draft">Rascunho</option>
                                                <option value="pending">Pendente</option>
                                                <option value="approved">Aprovado</option>
                                            </select>
                                            <input
                                                type="text"
                                                defaultValue={budget.client}
                                                onBlur={(e) => handleUpdateClient(e.target.value)}
                                                placeholder="Cliente..."
                                                className="text-xs text-slate-500 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-accent px-1 py-0.5 transition-all outline-none max-w-[120px]"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Seção Central: BDI + Encargos */}
                                <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 shrink-0 min-w-[140px]">
                                    <div className="text-center px-2 border-r border-slate-200">
                                        <label className="text-[9px] text-slate-400 font-bold uppercase block">BDI</label>
                                        <div className="flex items-center justify-center gap-0.5 whitespace-nowrap">
                                            <input
                                                type="number"
                                                value={budget.bdi || 0}
                                                onChange={(e) => handleUpdateBDI(Number(e.target.value))}
                                                className="w-14 text-center text-sm font-bold text-slate-700 bg-transparent outline-none focus:ring-1 focus:ring-blue-400 rounded transition-all"
                                            />
                                            <span className="text-xs text-slate-400 font-bold">%</span>
                                            <button
                                                onClick={() => setShowBDICalculator(true)}
                                                className="ml-1 p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                                title="Calculadora de BDI"
                                            >
                                                <Calculator size={14} />
                                            </button>
                                        </div>
                                    </div>
                                    <div className="text-center px-1">
                                        <label className="text-[9px] text-slate-400 font-bold uppercase block">Encargos</label>
                                        <button
                                            onClick={() => setShowEncargosModal(true)}
                                            className="text-sm font-bold text-slate-700 hover:text-orange-600 transition-colors whitespace-nowrap px-1"
                                        >
                                            {budget.encargosSociais?.toFixed(2)}%
                                        </button>
                                    </div>
                                </div>


                                {/* Seção Direita: Totais Corrigidos (Em Esquadro) */}
                                <div className="grid grid-cols-3 gap-0 bg-gradient-to-r from-slate-50 to-blue-50/50 rounded-lg border border-slate-200 shrink-0 overflow-hidden">
                                    <div className="text-right border-r border-slate-200 p-2 min-w-[90px]">
                                        <span className="text-[9px] text-slate-400 uppercase block font-black leading-none mb-1">Custo Base</span>
                                        <span className="text-xs font-bold text-slate-600 block">
                                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalBase)}
                                        </span>
                                    </div>
                                    <div className="text-right border-r border-slate-200 p-2 min-w-[90px]">
                                        <span className="text-[9px] text-slate-400 uppercase block font-black leading-none mb-1">BDI ({budget.bdi || 0}%)</span>
                                        <span className="text-xs font-bold text-indigo-500 block">
                                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalFinal - totalBase)}
                                        </span>
                                    </div>
                                    <div className="text-right p-2 min-w-[110px] bg-blue-100/30">
                                        <span className="text-[9px] text-accent uppercase block font-black leading-none mb-1">Total Global</span>
                                        <span className="text-sm font-black text-primary block">
                                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalFinal)}
                                        </span>
                                    </div>
                                </div>

                            </div>
                            <div className="flex items-center gap-1 shrink-0 pl-1 relative z-50">
                                <button onClick={handleReorderItems} className="p-2 text-slate-400 hover:text-green-600 hover:bg-slate-100 rounded-lg transition-colors" title="Recalcular Numeração e Ordem">
                                    <ListOrdered size={18} />
                                </button>
                                <button onClick={() => setShowAdjustmentModal(true)} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-slate-100 rounded-lg transition-colors" title="Ajuste Global">
                                    <Calculator size={18} />
                                </button>
                                <div className="relative group">
                                    <button className="flex items-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-lg text-xs font-bold transition-colors">
                                        <Download size={14} />
                                        Exportar
                                        <ChevronDown size={12} />
                                    </button>
                                    {/* Dropdown com pt-1 invisível para criar "ponte" de hover */}
                                    <div className="absolute right-0 top-full pt-1 hidden group-hover:block z-50">
                                        <div className="bg-white border border-slate-200 rounded-lg shadow-xl w-48 py-1 animate-in fade-in slide-in-from-top-2">
                                            <button onClick={() => handleExportPDF('synthetic')} className="w-full text-left px-4 py-2 text-xs text-slate-600 hover:bg-slate-50 hover:text-blue-600 flex items-center gap-2">

                                                <FileText size={14} /> PDF Sintético
                                            </button>
                                            <button onClick={() => handleExportPDF('analytic')} className="w-full text-left px-4 py-2 text-xs text-slate-600 hover:bg-slate-50 hover:text-blue-600 flex items-center gap-2">
                                                <FileText size={14} /> PDF Analítico (CPU)
                                            </button>
                                            <div className="h-px bg-slate-100 my-1"></div>
                                            <button onClick={() => handleExportExcel('synthetic')} className="w-full text-left px-4 py-2 text-xs text-slate-600 hover:bg-slate-50 hover:text-green-600 flex items-center gap-2">
                                                <FileSpreadsheet size={14} /> Excel Sintético
                                            </button>
                                            <button onClick={() => handleExportExcel('analytic')} disabled={isExportingAnalytic} className="w-full text-left px-4 py-2 text-xs text-slate-600 hover:bg-slate-50 hover:text-green-600 flex items-center justify-between gap-2">
                                                <div className="flex items-center gap-2">
                                                    <FileSpreadsheet size={14} /> Excel Analítico
                                                </div>
                                                {isExportingAnalytic && <Loader size={12} className="animate-spin text-green-600" />}
                                            </button>
                                            <div className="h-px bg-slate-100 my-1"></div>
                                            <button onClick={() => setShowABC(true)} className="w-full text-left px-4 py-2 text-xs text-slate-600 hover:bg-slate-50 hover:text-orange-600 flex items-center gap-2">
                                                <BarChart size={14} /> Curva ABC
                                            </button>
                                            <div className="h-px bg-slate-100 my-1"></div>
                                            <button
                                                onClick={handleExportCompleteZip}
                                                disabled={isExportingZip}
                                                className={clsx(
                                                    "w-full text-left px-4 py-3 text-xs flex flex-col gap-2 transition-all",
                                                    isExportingZip ? "bg-purple-50" : "hover:bg-purple-50 hover:text-purple-700 text-purple-600 font-bold"
                                                )}
                                            >
                                                <div className="flex items-center gap-2">
                                                    {isExportingZip ? <Loader size={12} className="animate-spin text-purple-600" /> : <Package size={14} />}
                                                    <span>PROJETO COMPLETO (.ZIP)</span>
                                                </div>
                                                {isExportingZip && (
                                                    <div className="mt-1 space-y-1">
                                                        <div className="w-full bg-slate-200 rounded-full h-1 overflow-hidden">
                                                            <div
                                                                className="bg-purple-600 h-full transition-all duration-300"
                                                                style={{ width: `${(exportProgress.current / exportProgress.total) * 100}% ` }}
                                                            />
                                                        </div>
                                                        <p className="text-[9px] text-purple-500 font-medium truncate">
                                                            {exportProgress.message}
                                                        </p>
                                                    </div>
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <div className="w-px h-6 bg-slate-200 mx-1"></div>
                                <button onClick={() => navigate(`/budgets/${budgetId}/schedule`)} className="p-2 text-slate-400 hover:text-indigo-500 hover:bg-slate-100 rounded-lg transition-colors" title="Cronograma" >
                                    <Calendar size={18} />
                                </button >
                                <button onClick={() => navigate(`/budgets/${budgetId}/review`)} className="p-2 text-slate-400 hover:text-purple-600 hover:bg-slate-100 rounded-lg transition-colors" title="Revisão Final">
                                    <AlertTriangle size={18} />
                                </button>
                                <button onClick={() => navigate(`/budgets/${budgetId}/scenarios`)} className="p-2 text-slate-400 hover:text-cyan-600 hover:bg-slate-100 rounded-lg transition-colors" title="Cenários">
                                    <TrendingUp size={18} />
                                </button>
                            </div >
                        </div >
                    )}
                </header >

                {/* Sub-header Contextual */}
                {
                    items && items.length > 0 && !isMobile && (
                        <div className="bg-slate-50 border-b border-slate-200 px-6 py-2 shrink-0 flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2 border-r border-slate-200 pr-4">
                                    <input
                                        type="checkbox"
                                        className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                        checked={selectedItemIds.size === items.filter(i => i.type !== 'group').length && items.filter(i => i.type !== 'group').length > 0}
                                        onChange={(e) => {
                                            if (e.target.checked) {
                                                setSelectedItemIds(new Set(items.filter(i => i.type !== 'group').map(i => i.id!)));
                                            } else {
                                                setSelectedItemIds(new Set());
                                            }
                                        }}
                                    />
                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                                        {selectedItemIds.size > 0 ? `${selectedItemIds.size} Selecionados` : 'Todos'}
                                    </span>
                                </div>

                                {selectedItemIds.size > 0 && (
                                    <div className="flex items-center gap-3 animate-in fade-in slide-in-from-left-2">
                                        <div className="flex items-center gap-2">
                                            <RefreshCcw size={14} className="text-indigo-600" />
                                            <select
                                                className="text-[10px] font-bold uppercase bg-white border border-slate-200 rounded px-2 py-1 focus:ring-1 focus:ring-indigo-500 outline-none"
                                                onChange={(e) => {
                                                    if (e.target.value) {
                                                        handleBulkSwitchBase(e.target.value);
                                                        e.target.value = "";
                                                    }
                                                }}
                                            >
                                                <option value="">Trocar Base (Lote)...</option>
                                                <option value="SINAPI">SINAPI</option>
                                                <option value="ORSE">ORSE</option>
                                                <option value="SBC">SBC</option>
                                                <option value="SEINFRA">SEINFRA</option>
                                                <option value="EMBASA">EMBASA</option>
                                            </select>
                                        </div>
                                        <button
                                            onClick={async () => {
                                                if (window.confirm(`Remover ${selectedItemIds.size} itens selecionados?`)) {
                                                    setLoading(true);
                                                    try {
                                                        const ids = Array.from(selectedItemIds);
                                                        // Delete items
                                                        await BudgetItemService.batchDelete(ids);
                                                        // Delete related compositions (best effort, ideally DB cascade)
                                                        for (const itId of ids) {
                                                            await BudgetItemCompositionService.deleteByBudgetItemId(itId);
                                                        }
                                                        // Reload data
                                                        await loadBudget();
                                                        setSelectedItemIds(new Set());
                                                    } catch (e) {
                                                        console.error(e);
                                                        alert("Erro ao excluir itens");
                                                    } finally {
                                                        setLoading(false);
                                                    }
                                                }
                                            }}
                                            className="text-[10px] font-bold text-red-600 hover:bg-red-50 px-2 py-1 rounded transition-colors uppercase flex items-center gap-1"
                                        >
                                            <Trash2 size={12} /> Excluir Lote
                                        </button>
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setIsAddingItem(true)}
                                    className="bg-accent hover:bg-accent/90 text-white text-xs font-semibold px-3 py-1.5 rounded-md shadow-sm transition-all flex items-center gap-1.5"
                                >
                                    <Plus size={14} /> NOVO ITEM
                                </button>
                                <div className="w-px h-4 bg-slate-300 mx-2"></div>
                                <button onClick={() => handleAddTitle()} className="text-secondary hover:text-primary hover:bg-white px-3 py-1.5 rounded text-xs font-medium transition-colors border border-transparent hover:border-border">
                                    + Etapa (N1)
                                </button>
                                <button onClick={() => handleAddSubTitle(1)} className="text-secondary hover:text-primary hover:bg-white px-3 py-1.5 rounded text-xs font-medium transition-colors border border-transparent hover:border-border">
                                    + Sub-etapa (N2)
                                </button>
                            </div>
                        </div>
                    )
                }

                {/* Toolbar - Desktop Only */}
                {
                    !isMobile && (
                        <div className="px-6 py-2 bg-slate-50/50 border-b border-border flex items-center justify-between shrink-0">
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setIsAddingItem(true)}
                                    className="bg-accent hover:bg-accent/90 text-white text-xs font-semibold px-3 py-1.5 rounded-md shadow-sm transition-all flex items-center gap-1.5"
                                >
                                    <Plus size={14} /> NOVO ITEM
                                </button>
                                <div className="w-px h-4 bg-slate-300 mx-2"></div>
                                <button onClick={() => handleAddTitle()} className="text-secondary hover:text-primary hover:bg-white px-3 py-1.5 rounded text-xs font-medium transition-colors border border-transparent hover:border-border">
                                    + Etapa (N1)
                                </button>
                                <button onClick={() => handleAddSubTitle(1)} className="text-secondary hover:text-primary hover:bg-white px-3 py-1.5 rounded text-xs font-medium transition-colors border border-transparent hover:border-border">
                                    + Sub-etapa (N2)
                                </button>
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => {
                                        const summary = getExecutiveSummary();
                                        const text = summary.map(s => `${s.name}: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(s.value)}`).join('\n');
                                        alert("Resumo Executivo (por Centro de Custo):\n\n" + text);
                                    }}
                                    className="text-xs text-slate-500 hover:text-green-600 font-medium px-2 py-1 flex items-center gap-1 transition-colors"
                                    title="Resumo Executivo"
                                >
                                    <FileText size={12} /> Resumo
                                </button>
                                <button
                                    onClick={handleReorderItems}
                                    disabled={loading}
                                    className="text-xs text-slate-500 hover:text-accent font-medium px-2 py-1 flex items-center gap-1 transition-colors"
                                    title="Renumerar itens"
                                >
                                    <Activity size={12} className={clsx(loading && "animate-spin")} /> Renumerar
                                </button>
                                <button
                                    onClick={() => setShowImpact(!showImpact)}
                                    className={clsx(
                                        "text-xs font-medium px-2 py-1 flex items-center gap-1 transition-colors rounded",
                                        showImpact ? "bg-indigo-50 text-indigo-600" : "text-slate-500 hover:text-slate-800"
                                    )}
                                >
                                    <TrendingUp size={12} /> Impacto
                                </button>
                            </div>
                        </div>
                    )
                }

                {
                    showImpact && (
                        <div className="bg-indigo-50 border-b border-indigo-100 px-6 py-3 shrink-0 flex items-center justify-between animate-in slide-in-from-top-2">
                            <div className="flex items-center gap-3">
                                <div className="bg-indigo-100 p-1.5 rounded-full text-indigo-600">
                                    <TrendingUp size={16} />
                                </div>
                                <div>
                                    <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest leading-none">Impacto Financeiro</p>
                                    <p className="text-xs text-indigo-800 font-medium">Original vs Atual</p>
                                </div>
                            </div>
                            <div className="flex gap-6">
                                <div className="text-right">
                                    <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest leading-none mb-0.5">Diferença</p>
                                    <p className={clsx("text-lg font-black leading-none", getImpact().value >= 0 ? "text-red-500" : "text-green-600")}>
                                        {getImpact().value >= 0 ? "+" : ""}{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(getImpact().value)}
                                    </p>
                                </div>
                                <div className="text-right border-l border-indigo-200 pl-6">
                                    <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest leading-none mb-0.5">Variação</p>
                                    <p className={clsx("text-lg font-black leading-none", getImpact().percent >= 0 ? "text-red-500" : "text-green-600")}>
                                        {getImpact().percent >= 0 ? "+" : ""}{getImpact().percent.toFixed(2)}%
                                    </p>
                                </div>
                            </div>
                        </div>
                    )
                }

                {/* Grid/Table - Desktop ou Cards - Mobile */}
                <div className="flex-1 overflow-auto bg-white relative custom-scrollbar">
                    {isMobile ? (
                        /* Mobile: Cards View */
                        <div className="p-4 space-y-3">
                            {items?.map((item, index) => {
                                const isGroup = item.type === 'group';
                                const hierarchicalNumber = getItemNumber(index);
                                const isExpanded = expandedCards.has(item.id!);

                                if (isGroup) {
                                    return (
                                        <div
                                            key={item.id}
                                            className={clsx(
                                                "rounded-lg p-3 border-l-4",
                                                item.level === 0
                                                    ? "bg-slate-100 border-slate-400 text-slate-800"
                                                    : "bg-blue-50 border-blue-300 text-blue-800"
                                            )}
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs font-mono text-slate-400">{hierarchicalNumber}</span>
                                                    <span className="font-bold uppercase text-sm">{item.description}</span>
                                                </div>
                                                <span className="text-sm font-bold">
                                                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.totalPrice * (1 + (budget.bdi || 0) / 100))}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                }

                                return (
                                    <div
                                        key={item.id}
                                        id={`item-${item.id}`}
                                        className={clsx(
                                            "bg-white border rounded-lg shadow-sm overflow-hidden transition-all",
                                            highlightedItemId === item.id ? "border-yellow-400 ring-2 ring-yellow-100 shadow-md" : "border-slate-200"
                                        )}
                                    >
                                        {/* Card Header - Always Visible */}
                                        <button
                                            onClick={() => {
                                                const newSet = new Set(expandedCards);
                                                if (isExpanded) newSet.delete(item.id!);
                                                else newSet.add(item.id!);
                                                setExpandedCards(newSet);
                                            }}
                                            className="w-full p-3 text-left flex items-start justify-between gap-3"
                                        >
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="text-[10px] font-mono text-slate-400">{hierarchicalNumber}</span>
                                                    {item.source && (
                                                        <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-1 rounded">
                                                            {item.source}
                                                        </span>
                                                    )}
                                                    {validatePriceRange(item) !== 'normal' && (
                                                        <AlertTriangle size={12} className={validatePriceRange(item) === 'high' ? "text-red-400" : "text-yellow-400"} />
                                                    )}
                                                    {item.isLocked && <Lock size={12} className="text-orange-400" />}
                                                </div>
                                                <p className="text-sm text-slate-700 leading-snug">{item.description}</p>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className="text-lg font-bold text-primary">
                                                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.totalPrice * (1 + (budget.bdi || 0) / 100))}
                                                </p>
                                                {isExpanded ? <ChevronUp size={16} className="text-slate-400 mt-1 ml-auto" /> : <ChevronDown size={16} className="text-slate-400 mt-1 ml-auto" />}
                                            </div>
                                        </button>

                                        {/* Card Details - Expandable */}
                                        {isExpanded && (
                                            <div className="px-3 pb-3 pt-0 border-t border-slate-100 bg-slate-50/50 animate-in slide-in-from-top-2">
                                                <div className="grid grid-cols-3 gap-3 text-xs py-2">
                                                    <div
                                                        className={clsx("transition-transform active:scale-95", !item.isLocked && "cursor-pointer")}
                                                        onClick={() => !item.isLocked && handleStartEdit(item)}
                                                    >
                                                        <p className="text-[10px] text-slate-400 uppercase">Qtd</p>
                                                        <p className={clsx("font-bold font-mono", !item.isLocked && "text-blue-600")}>{item.quantity} {item.unit}</p>
                                                    </div>
                                                    <div
                                                        className={clsx("transition-transform active:scale-95", !item.isLocked && "cursor-pointer")}
                                                        onClick={() => !item.isLocked && handleStartEdit(item)}
                                                    >
                                                        <p className="text-[10px] text-slate-400 uppercase">Unit.</p>
                                                        <p className={clsx("font-bold font-mono", !item.isLocked && "text-blue-600")}>
                                                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.unitPrice)}
                                                        </p>
                                                    </div>
                                                    <div>
                                                        <p className="text-[10px] text-slate-400 uppercase">Total</p>
                                                        <p className="font-bold font-mono">
                                                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.totalPrice)}
                                                        </p>
                                                    </div>
                                                </div>
                                                {item.code && (
                                                    <p className="text-[10px] text-slate-400 font-mono">Código: {item.code}</p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            {items?.length === 0 && (
                                <div className="py-16 text-center">
                                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                        <Search size={24} className="text-slate-300" />
                                    </div>
                                    <p className="font-medium text-slate-600">Orçamento Vazio</p>
                                    <p className="text-xs text-slate-400 mt-1">Adicione itens no desktop para começar</p>
                                </div>
                            )}
                        </div>
                    ) : (
                        /* Desktop: Table View */
                        /* Desktop: Table Engineering View */
                        <table className="w-full text-left border-collapse table-fixed border border-slate-400">
                            <thead className="sticky top-0 z-10 bg-slate-100 border-b-2 border-slate-400 shadow-sm">
                                <tr className="text-[10px] uppercase tracking-wider font-bold text-slate-700">
                                    <th className="p-1 w-[30px] text-center border-r border-slate-300 bg-slate-200">
                                        <input
                                            type="checkbox"
                                            className="rounded border-slate-400 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                            disabled={!items || items.length === 0}
                                            checked={!!items && items.length > 0 && selectedItemIds.size === items.filter(i => i.type !== 'group').length}
                                            onChange={(e) => {
                                                if (items && e.target.checked) {
                                                    setSelectedItemIds(new Set(items.filter(i => i.type !== 'group').map(i => i.id!)));
                                                } else {
                                                    setSelectedItemIds(new Set());
                                                }
                                            }}
                                        />
                                    </th>
                                    <th className="p-1 w-[20px] text-center border-r border-slate-300 bg-slate-200">#</th>
                                    <th className="p-1 w-[65px] text-center border-r border-slate-300">Item</th>
                                    <th className="p-1 w-[60px] text-center border-r border-slate-300">Banco</th>
                                    <th className="p-1 w-[70px] text-center border-r border-slate-300">Código</th>
                                    <th className="p-1 text-center border-r border-slate-300">Descrição</th>
                                    <th className="p-1 w-[35px] text-center border-r border-slate-300">Und</th>
                                    <th className="p-1 w-[55px] text-center border-r border-slate-300">Quant.</th>
                                    <th className="p-1 w-[80px] text-center border-r border-slate-300">V. Unit</th>
                                    <th className="p-1 w-[80px] text-center border-r border-slate-300 bg-slate-50 font-bold">V. Unit (BDI)</th>
                                    <th className="p-1 w-[120px] text-center border-r border-slate-300 font-black">Total</th>
                                    <th className="p-1 w-[50px] text-center border-r border-slate-300">Peso</th>
                                    <th className="p-1 w-[65px] text-center bg-slate-200">Ações</th>
                                </tr>
                            </thead>
                            <tbody className="text-[11px] leading-tight">
                                {visibleRows?.map((row, index) => {
                                    const item = row;
                                    // Dados flat na raiz (SSOT)

                                    if (item.level === 1) console.log(`[EDITOR RENDER] Etapa ${item.description}: Total=${item.total}`);
                                    const isGroup = item.kind === 'GROUP'; // ou item.type === 'group'

                                    // Leitura via campos canônicos
                                    const displayTotal = item.total || 0;
                                    const peso = (item.pesoRaw || 0) * 100; // Converte para % visual da UI

                                    // Para exibição apenas do unitário com BDI (informativo)
                                    const rawUnitPrice = item.unitPrice || 0;
                                    const unitPriceWithBDI = item.unitPriceWithBDI || 0;

                                    const hierarchicalNumber = item.itemNumber;

                                    // ===================================================================
                                    // HIERARQUIA VISUAL BASEADA NO ITEM.ROWTYPE (View)
                                    // ===================================================================
                                    // Etapa: Azul Escuro, Branco
                                    // Subetapa: Azul Claro, Texto Escuro
                                    // Item: Branco, Texto Padrão

                                    const isNivel1 = item.rowType === 'etapa' || item.level === 1; // Fallback to level if rowType missing
                                    const isNivel2 = item.rowType === 'subetapa' || item.level === 2;
                                    const isItem = item.rowType === 'item' || (item.level !== 1 && item.level !== 2);

                                    // Aplicar cores de fundo
                                    const rowBg = isNivel1
                                        ? "bg-[#1e3a8a] text-white" // Azul Escuro (Etapa)
                                        : isNivel2
                                            ? "bg-[#dbeafe] text-blue-900" // Azul Claro (Subetapa)
                                            : "bg-white hover:bg-slate-50"; // Branco (Item)

                                    // Estilo do texto da descrição
                                    const textStyle = isNivel1
                                        ? "font-black uppercase tracking-wide text-[12px]" // Mais destaque nível 1
                                        : isNivel2
                                            ? "font-bold uppercase text-[11px]" // Destaque nível 2
                                            : "font-normal text-slate-700"; // Normal nível 3

                                    return (
                                        <tr
                                            key={item.id}
                                            id={`item-${item.id}`}
                                            draggable={!isMobile}
                                            onDragStart={(e) => handleDragStart(e, index)}
                                            onDragOver={(e) => handleDragOver(e, index)}
                                            onDrop={(e) => handleDrop(e, index)}
                                            onDragEnd={() => setDragOverIndex(null)}
                                            className={clsx(
                                                "border-b border-slate-300 transition-colors group",
                                                rowBg,
                                                dragOverIndex === index && "border-t-2 border-t-blue-500",
                                                highlightedItemId === item.id && "bg-yellow-100 ring-2 ring-inset ring-yellow-400 z-10",
                                                selectedItemIds.has(item.id!) && !isGroup && "bg-indigo-50" // Realce de seleção
                                            )}
                                            onClick={(e) => {
                                                // Seleção com CTRL/Click na linha
                                                if ((e.ctrlKey || e.metaKey) && !isGroup) {
                                                    const newSelected = new Set(selectedItemIds);
                                                    if (newSelected.has(item.id!)) newSelected.delete(item.id!);
                                                    else newSelected.add(item.id!);
                                                    setSelectedItemIds(newSelected);
                                                }
                                            }}
                                        >
                                            {/* Checkbox Column */}
                                            <td className={clsx(
                                                "p-1 text-center border-r border-slate-300",
                                                isNivel1 ? "border-r-blue-700" : ""
                                            )}>
                                                {!isGroup && (
                                                    <input
                                                        type="checkbox"
                                                        className="rounded border-slate-400 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                                        checked={selectedItemIds.has(item.id!)}
                                                        onChange={(e) => {
                                                            const newSelected = new Set(selectedItemIds);
                                                            if (e.target.checked) newSelected.add(item.id!);
                                                            else newSelected.delete(item.id!);
                                                            setSelectedItemIds(newSelected);
                                                        }}
                                                        onClick={(e) => e.stopPropagation()}
                                                    />
                                                )}
                                            </td>

                                            {/* Drag Handle (Restaurado para alinhar com coluna #) */}
                                            <td className="p-0 text-center border-r border-slate-300 cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600">
                                                <div className="flex items-center justify-center h-full w-full">
                                                    <ListOrdered size={12} />
                                                </div>
                                            </td>

                                            {/* Item Number */}
                                            <td className={clsx(
                                                "p-1 px-2 text-center border-r border-slate-300 font-mono font-bold whitespace-nowrap cursor-grab active:cursor-grabbing",
                                                isNivel1 ? "text-white border-r-blue-700" : isNivel2 ? "text-blue-900" : "text-slate-700"
                                            )}>
                                                {hierarchicalNumber}
                                            </td>

                                            {/* Banco (Fonte) */}
                                            <td className="p-1 px-1 text-center border-r border-slate-300">
                                                {item.level >= 3 && (
                                                    <span className={clsx(
                                                        "text-[9px] px-1 py-0.5 rounded font-bold uppercase",
                                                        item.source === 'SINAPI' ? "bg-blue-100 text-blue-700" :
                                                            item.source === 'SICRO' ? "bg-orange-100 text-orange-700" :
                                                                item.source === 'ORSE' ? "bg-green-100 text-green-700" :
                                                                    item.source === 'SEINFRA' ? "bg-purple-100 text-purple-700" :
                                                                        item.source === 'SETOP' ? "bg-cyan-100 text-cyan-700" :
                                                                            item.source === 'EMBASA' ? "bg-teal-100 text-teal-700" :
                                                                                item.source === 'SBC' ? "bg-amber-100 text-amber-700" :
                                                                                    item.source ? "bg-slate-100 text-slate-600" : "bg-gray-50 text-gray-400"
                                                    )}>
                                                        {item.source || 'IMPORT'}
                                                    </span>
                                                )}
                                            </td>

                                            {/* Código */}
                                            <td className={clsx(
                                                "p-1 px-1 text-center border-r border-slate-300 font-mono text-[10px]",
                                                isNivel1 ? "text-white/80 border-r-blue-700" : "text-slate-500"
                                            )} title={item.code || ''}>
                                                {item.level >= 3 && (item.code || '-')}
                                            </td>

                                            {/* Descrição */}
                                            <td className="p-1 border-r border-slate-300 relative group/desc">
                                                <div className="flex items-center w-full min-h-[1.5rem]">
                                                    {!isGroup && !item.isLocked ? (
                                                        <span
                                                            className={clsx(
                                                                "cursor-pointer hover:underline truncate block w-full",
                                                                textStyle,
                                                                isNivel2 && "pl-6", // Indent Level 2
                                                                isItem && "pl-10"   // Indent Level 3
                                                            )}
                                                            onClick={() => handleStartEdit(item)}
                                                        >
                                                            {item.description}
                                                        </span>
                                                    ) : (
                                                        <span className={clsx(
                                                            "truncate block w-full",
                                                            textStyle,
                                                            isNivel2 && "pl-6",
                                                            isItem && "pl-10"
                                                        )}>
                                                            {item.description}
                                                        </span>
                                                    )}

                                                    {/* Tooltip Rico na Descrição */}
                                                    <div className="hidden group-hover/desc:block absolute top-0 left-full ml-1 w-64 bg-slate-800 text-white text-xs p-3 rounded-lg shadow-xl z-50 pointer-events-none">
                                                        <p className="font-bold mb-1">{item.description}</p>
                                                        {item.notes && <p className="text-slate-300 italic text-[10px]">Nota: {item.notes}</p>}
                                                    </div>
                                                </div>

                                                {validatePriceRange(item) !== 'normal' && !isGroup && (
                                                    <div className="absolute right-1 top-1 text-orange-500">
                                                        <AlertOctagon size={10} />
                                                    </div>
                                                )}
                                            </td>

                                            {/* Unidade */}
                                            <td className={clsx(
                                                "p-1 text-center border-r border-slate-300",
                                                isNivel1 ? "text-white/70" : "text-slate-500"
                                            )}>
                                                {!isGroup && item.unit}
                                            </td>

                                            {/* Quantidade */}
                                            <td className={clsx(
                                                "p-1 text-right border-r border-slate-300 font-mono px-2",
                                                isNivel1 ? "text-white" : "text-slate-700"
                                            )}>
                                                {!isGroup ? new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(item.quantity) : ''}
                                            </td>

                                            {/* Valor Unitário (Sem BDI) */}
                                            <td className={clsx(
                                                "p-1 text-right border-r border-slate-300 font-mono px-2",
                                                isNivel1 ? "text-white" : "text-slate-600"
                                            )}>
                                                {!isGroup ? (
                                                    item.type === 'service' || item.type === 'composition' ? (
                                                        <div className="flex items-center justify-end gap-1 group/calc cursor-help">
                                                            <span>{new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(rawUnitPrice)}</span>
                                                            <Calculator size={8} className={isNivel1 ? "text-white/50" : "text-slate-300 opacity-0 group-hover/calc:opacity-100"} />
                                                        </div>
                                                    ) : new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(rawUnitPrice)
                                                ) : ''}
                                            </td>

                                            {/* Valor Unitário (Com BDI) - REQUISITADO */}
                                            <td className={clsx(
                                                "p-1 text-right border-r border-slate-300 font-mono font-bold px-2",
                                                isNivel1 ? "text-white bg-white/10" : "text-indigo-600 bg-indigo-50/30"
                                            )}>
                                                {!isGroup ? new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(unitPriceWithBDI) : ''}
                                            </td>

                                            {/* Total - Usa finalPrice que já inclui BDI */}
                                            {/* Total */}
                                            <td className={clsx(
                                                "p-1 text-right border-r border-slate-300 font-mono font-bold px-2 whitespace-nowrap min-w-[110px]",
                                                isNivel1 ? "text-white border-r-blue-700" : isNivel2 ? "text-[#1e3a8a] border-r-blue-200" : "text-slate-800"
                                            )}>
                                                {/* Use finalPrice direto - já calculado pelo frontend */}
                                                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
                                                    displayTotal
                                                )}
                                            </td>

                                            {/* Peso */}
                                            <td className={clsx(
                                                "p-1 text-center border-r border-slate-300 text-[9px]",
                                                isNivel1 ? "text-white/70 border-r-blue-700" : "text-slate-400"
                                            )}>
                                                {peso.toFixed(2)}%
                                            </td>

                                            {/* Ações */}
                                            <td className="p-1 text-center">
                                                <div className="grid grid-cols-2 gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity w-fit mx-auto">
                                                    {!isGroup && !item.isLocked && (
                                                        <button
                                                            onClick={() => handleStartEdit(item)}
                                                            className="p-1 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded"
                                                            title="Editar item"
                                                        >
                                                            <Edit2 size={12} />
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => handleToggleLock(item)}
                                                        className={clsx("p-1 rounded hover:bg-slate-200", item.isLocked ? "text-amber-500" : "text-slate-400")}
                                                        title={item.isLocked ? "Desbloquear" : "Bloquear edição"}
                                                    >
                                                        {item.isLocked ? <Lock size={12} /> : <Unlock size={12} />}
                                                    </button>
                                                    <button
                                                        onClick={() => handleDuplicateItem(item)}
                                                        className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                                                        title="Duplicar"
                                                    >
                                                        <Copy size={12} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteItem(item.id!)}
                                                        className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"
                                                        title="Excluir"
                                                    >
                                                        <Trash2 size={12} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {items?.length === 0 && (
                                    <tr>
                                        <td colSpan={13} className="py-20 text-center text-slate-400 bg-slate-50/30">
                                            <div className="flex flex-col items-center gap-3">
                                                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center">
                                                    <Search size={24} className="text-slate-300" />
                                                </div>
                                                <div>
                                                    <p className="font-medium text-slate-600">Planilha Vazia</p>
                                                    <p className="text-xs text-slate-400 mt-1">Adicione o primeiro capítulo para começar</p>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                            {/* Footer com Totais (Em Esquadro e Alinhado) */}
                            <tfoot className="bg-slate-50 border-t-2 border-slate-400 font-bold text-[11px]">
                                <tr className="bg-slate-50 border-t border-slate-300">
                                    <td colSpan={13} className="p-0">
                                        <div className="flex justify-end p-6 bg-slate-50">
                                            <div className="w-full max-w-[420px] space-y-3">
                                                {/* Custo Total */}
                                                <div className="flex justify-between items-center text-slate-500 font-bold uppercase tracking-widest text-[11px]">
                                                    <span>Custo Total:</span>
                                                    <span className="font-mono text-sm text-slate-700">
                                                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(calcResult?.totalGlobalBase || 0)}
                                                    </span>
                                                </div>

                                                {/* Valor BDI */}
                                                <div className="flex justify-between items-center text-indigo-600 font-bold uppercase tracking-widest text-[11px] py-2 border-y border-indigo-100/50">
                                                    <span>BDI ({budget.bdi || 0}%):</span>
                                                    <span className="font-mono text-sm text-indigo-700">
                                                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((calcResult?.totalGlobalFinal || 0) - (calcResult?.totalGlobalBase || 0))}
                                                    </span>
                                                </div>

                                                {/* TOTAL GLOBAL */}
                                                <div className="flex justify-between items-center bg-blue-600 text-white p-4 rounded-xl shadow-lg border-2 border-blue-500 mt-2">
                                                    <span className="font-black tracking-[0.1em] text-xs uppercase">TOTAL GLOBAL:</span>
                                                    <span className="font-mono text-2xl font-black whitespace-nowrap">
                                                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(calcResult?.totalGlobalFinal || 0)}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    )}
                </div >

                {/* Modal de Busca (Resources) */}
                {
                    isAddingItem && (
                        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in zoom-in">
                            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
                                <div className="p-6 border-b flex justify-between items-center bg-slate-50">
                                    <div>
                                        <h3 className="text-xl font-bold text-slate-800">Localizar Insumo</h3>
                                        <p className="text-slate-500 text-sm">Pesquise no seu banco de dados (SINAPI, ORSE, etc)</p>
                                    </div>
                                    <button onClick={() => setIsAddingItem(false)} className="text-slate-400 hover:text-slate-600"><ArrowLeft size={24} /></button>
                                </div>

                                <div className="flex-1 min-h-0 flex flex-col">
                                    {/* TABS Toggle */}
                                    <div className="px-6 pt-4 pb-2 flex items-center justify-center gap-4">
                                        <button
                                            onClick={() => { setAddItemTab('INS'); setSearchTerm(''); setFilteredResources([]); setSelectedResource(null); }}
                                            className={clsx(
                                                "px-4 py-2 text-xs font-bold rounded-lg border transition-all",
                                                addItemTab === 'INS'
                                                    ? "bg-blue-600 text-white border-blue-600 shadow-md"
                                                    : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
                                            )}
                                        >
                                            [INS] Insumos
                                        </button>
                                        <button
                                            onClick={() => { setAddItemTab('CPU'); setSearchTerm(''); setFilteredResources([]); setSelectedResource(null); }}
                                            className={clsx(
                                                "px-4 py-2 text-xs font-bold rounded-lg border transition-all",
                                                addItemTab === 'CPU'
                                                    ? "bg-amber-600 text-white border-amber-600 shadow-md"
                                                    : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
                                            )}
                                        >
                                            [CPU] Composições
                                        </button>
                                    </div>

                                    {/* BASE Filters Chips */}
                                    <div className="px-6 py-2 flex flex-wrap gap-2 justify-center border-b border-slate-50 bg-slate-50/50">
                                        {AVAILABLE_BASES.map(base => {
                                            const isActive = selectedBases.includes(base);
                                            return (
                                                <button
                                                    key={base}
                                                    onClick={() => {
                                                        const newBases = isActive
                                                            ? selectedBases.filter(b => b !== base)
                                                            : [...selectedBases, base];
                                                        setSelectedBases(newBases);
                                                    }}
                                                    className={clsx(
                                                        "px-3 py-1 text-[10px] font-bold rounded-full border transition-all flex items-center gap-1.5",
                                                        isActive
                                                            ? "bg-slate-800 text-white border-slate-800 shadow-sm"
                                                            : "bg-white text-slate-400 border-slate-200 hover:border-slate-300 hover:text-slate-600"
                                                    )}
                                                >
                                                    <div className={clsx("w-1.5 h-1.5 rounded-full", isActive ? "bg-green-400" : "bg-slate-300")} />
                                                    {base}
                                                </button>
                                            );
                                        })}
                                    </div>

                                    <div className="relative px-6 py-4 border-b border-slate-100 shrink-0">
                                        <Search className="absolute left-10 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                                        <input
                                            autoFocus
                                            className={clsx(
                                                "w-full pl-12 pr-6 py-4 border-2 rounded-xl outline-none transition-all text-lg shadow-sm font-bold",
                                                addItemTab === 'CPU'
                                                    ? "border-amber-100 focus:border-amber-500 bg-amber-50/30"
                                                    : "border-slate-100 focus:border-blue-500"
                                            )}
                                            placeholder={addItemTab === 'CPU' ? "Buscar Composição (CPU)..." : "Buscar Insumo (INS)..."}
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm(e.target.value)}
                                        />
                                    </div>
                                    <div className="flex-1 overflow-y-auto p-6 space-y-2">
                                        {filteredResources.length === 0 && (
                                            <div className="text-center text-slate-400 py-10">
                                                <p className="text-sm">
                                                    {searchTerm.length < 3
                                                        ? "Digite pelo menos 3 caracteres..."
                                                        : `Nenhum resultado em ${selectedBases.join(', ')}`}
                                                </p>
                                            </div>
                                        )}

                                        {filteredResources && filteredResources.length > 0 && filteredResources.map(res => {
                                            if (!res) return null;
                                            return (
                                                <div
                                                    key={`${res.source}-${res.code}-${res.id || Math.random()}`}
                                                    onClick={() => setSelectedResource(res)}
                                                    className={clsx(
                                                        "p-4 border rounded-xl cursor-pointer transition-all hover:scale-[1.005] active:scale-[0.995]",
                                                        selectedResource?.code === res.code && selectedResource?.source === res.source
                                                            ? (addItemTab === 'CPU' ? "border-amber-500 bg-amber-50 ring-2 ring-amber-200" : "border-blue-500 bg-blue-50 ring-2 ring-blue-200")
                                                            : "border-slate-100 hover:border-blue-300 hover:bg-white hover:shadow-md bg-white"
                                                    )}
                                                >
                                                    <div className="flex justify-between items-start gap-4">
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center flex-wrap gap-2 mb-1.5">
                                                                <span className={clsx(
                                                                    "text-[9px] font-black px-1.5 py-0.5 rounded tracking-tighter",
                                                                    addItemTab === 'CPU' ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"
                                                                )}>
                                                                    {addItemTab === 'CPU' ? 'CPU' : 'INS'}
                                                                </span>
                                                                <span className="text-[10px] font-mono font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                                                    {res.code}
                                                                </span>
                                                                <span className={clsx(
                                                                    "text-[9px] uppercase font-black px-1.5 py-0.5 rounded",
                                                                    res.source === 'SINAPI' ? "bg-blue-600 text-white" :
                                                                        res.source === 'ORSE' ? "bg-green-600 text-white" :
                                                                            res.source === 'EMBASA' ? "bg-teal-600 text-white" :
                                                                                "bg-slate-400 text-white"
                                                                )}>
                                                                    {res.source}
                                                                </span>
                                                                {res.originalType && (
                                                                    <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest bg-slate-50 px-1 border border-slate-100 rounded">
                                                                        {res.originalType}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <p className="font-bold text-slate-700 leading-snug line-clamp-2" title={res.description}>{res.description || 'Sem descrição'}</p>
                                                        </div>
                                                        <div className="text-right shrink-0 bg-slate-50 p-2 rounded-lg">
                                                            <p className="text-[10px] text-slate-400 uppercase font-black">Preço Ref.</p>
                                                            <p className="font-black text-lg text-slate-800">
                                                                {(res.price !== undefined && res.price !== null)
                                                                    ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(res.price)
                                                                    : <span className="text-sm text-slate-400 font-bold uppercase">Sem Preço</span>}
                                                            </p>
                                                            <p className="text-[10px] text-slate-500 lowercase font-medium text-right mt-1">
                                                                / {res.unit || 'UN'}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                                {selectedResource && (
                                    <div className="p-4 md:p-6 bg-slate-50 border-t flex flex-col md:flex-row items-center gap-4 md:gap-6">
                                        <div className="flex-1 min-w-0 w-full">
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Item Selecionado</p>
                                            <p className="text-sm font-bold text-slate-700 truncate" title={selectedResource.description || ''}>
                                                {selectedResource.description || 'Sem descrição'}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-4 w-full md:w-auto">
                                            <div className="w-24 md:w-32">
                                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 text-center md:text-left">Quantidade</label>
                                                <input
                                                    type="number"
                                                    value={quantity}
                                                    onChange={(e) => setQuantity(Number(e.target.value))}
                                                    className="w-full border-2 border-slate-200 p-2.5 rounded-lg font-bold text-center focus:border-accent transition-all bg-white"
                                                    min="0.001"
                                                    step="0.001"
                                                />
                                            </div>
                                            <button
                                                onClick={handleAddItem}
                                                className="flex-1 md:flex-initial bg-green-600 text-white px-8 py-3.5 rounded-xl font-black hover:bg-green-700 shadow-lg shadow-green-200 active:scale-95 transition-all text-sm uppercase whitespace-nowrap"
                                            >
                                                Adicionar
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )
                }

                {/* Modal de Edição de Item */}
                {
                    editingItem && (
                        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                            <div className={`bg-white rounded-2xl shadow-2xl w-full relative ${itemComposition.length > 0 ? 'max-w-4xl' : 'max-w-2xl'} overflow-hidden flex flex-col max-h-[90vh]`}>
                                <div className="p-6 border-b flex justify-between items-center bg-slate-50">
                                    <div>
                                        <h3 className="text-xl font-bold text-slate-800">Editar Item</h3>
                                        <p className="text-[10px] text-slate-500 font-mono tracking-widest uppercase mt-1">{editingItem.code}</p>
                                    </div>
                                    <button onClick={() => { setEditingItem(null); setItemComposition([]); }} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
                                </div>

                                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                                    <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 space-y-4">
                                        {validateItemUnit(editingItem, itemComposition) && (
                                            <div className="bg-orange-100 text-orange-700 p-3 rounded-lg flex items-center gap-2 text-xs font-bold border border-orange-200">
                                                <AlertTriangle size={16} />
                                                Unidade incompatível com a composição vinculada!
                                            </div>
                                        )}
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Descrição</label>
                                                <textarea
                                                    className="w-full border border-slate-300 p-2.5 rounded-lg outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all text-sm h-20 font-medium resize-none"
                                                    value={editingItem.description}
                                                    onChange={e => setEditingItem({ ...editingItem, description: e.target.value })}
                                                />
                                            </div>
                                            <div className="grid grid-cols-3 gap-4">
                                                <div>
                                                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Unidade</label>
                                                    <input
                                                        className="w-full border border-slate-300 p-2.5 rounded-lg outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all text-sm font-medium"
                                                        value={editingItem.unit}
                                                        onChange={e => setEditingItem({ ...editingItem, unit: e.target.value })}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Quantidade {editingItem.calculationMemory && <span className="text-blue-600 ml-1">(= {evaluateCalculation(editingItem.calculationMemory)})</span>}</label>
                                                    <input
                                                        type="number"
                                                        step="0.001"
                                                        className={`w-full border border-slate-300 p-2.5 rounded-lg outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all text-sm font-medium ${editingItem.calculationMemory ? 'bg-slate-50 text-slate-400' : ''}`}
                                                        value={editingItem.calculationMemory ? evaluateCalculation(editingItem.calculationMemory) : editingItem.quantity}
                                                        onChange={e => setEditingItem({ ...editingItem, quantity: Number(e.target.value) })}
                                                        readOnly={!!editingItem.calculationMemory}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Preço Unitário</label>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        className={`w-full border border-slate-300 p-2.5 rounded-lg outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all text-sm font-medium ${itemComposition.length > 0 ? 'bg-slate-50 text-slate-400' : 'text-blue-600'}`}
                                                        value={itemComposition.length > 0 ? itemComposition.reduce((acc, c) => acc + c.totalPrice, 0) : editingItem.unitPrice}
                                                        readOnly={itemComposition.length > 0}
                                                        onChange={e => setEditingItem({ ...editingItem, unitPrice: Number(e.target.value) })}
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        <form id="edit-form" onSubmit={handleUpdateItem} className="space-y-4">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-2">
                                                        <Calculator size={14} className="text-blue-500" /> Memória de Cálculo
                                                    </label>
                                                    <input
                                                        type="text"
                                                        placeholder="Ex: (2.5*4)+1.2"
                                                        className="w-full border-2 border-slate-100 p-3 rounded-xl outline-none focus:border-blue-500 transition-all text-sm font-mono"
                                                        value={editingItem.calculationMemory || ''}
                                                        onChange={e => setEditingItem({ ...editingItem, calculationMemory: e.target.value })}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-2">
                                                        <Percent size={14} className="text-orange-500" /> BDI Diferenciado (%)
                                                    </label>
                                                    <input
                                                        type="number"
                                                        className="w-full border-2 border-slate-100 p-3 rounded-xl outline-none focus:border-blue-500 transition-all text-sm font-bold"
                                                        value={editingItem.customBDI || ''}
                                                        onChange={e => setEditingItem({ ...editingItem, customBDI: Number(e.target.value) })}
                                                    />
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-2">
                                                        <RefreshCcw size={14} /> Trocar Base (Origem)
                                                    </label>
                                                    <select
                                                        className="w-full border-2 border-slate-100 p-3 rounded-xl outline-none focus:border-blue-500 transition-all text-sm font-bold"
                                                        value={editingItem.source}
                                                        onChange={(e) => handleSwitchBase(editingItem, e.target.value)}
                                                    >
                                                        <option value="SINAPI">SINAPI</option>
                                                        <option value="ORSE">ORSE</option>
                                                        <option value="SBC">SBC</option>
                                                        <option value="COMPOSIÇÃO">PRÓPRIA (CPU)</option>
                                                        <option value="PROPRIO">PRÓPRIO (INSUMO)</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Centro de Custo</label>
                                                    <input
                                                        className="w-full border-2 border-slate-100 p-3 rounded-xl outline-none focus:border-blue-500 transition-all text-sm font-bold"
                                                        value={editingItem.costCenter || ''}
                                                        onChange={e => setEditingItem({ ...editingItem, costCenter: e.target.value })}
                                                        placeholder="Ex: 01.01.01"
                                                    />
                                                </div>
                                            </div>
                                        </form>

                                        {/* Composition Section */}
                                        <div className="pt-6 border-t font-bold">
                                            <div className="flex justify-between items-center mb-4">
                                                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
                                                    Análise da Composição (CPU)
                                                    {itemComposition.length > 0 && <span className="bg-blue-100 text-blue-700 text-[10px] px-2 py-0.5 rounded-full">{itemComposition.length} itens</span>}
                                                </h4>
                                                <div className="flex gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            // TODO: Migrar para CompositionService do Supabase
                                                            alert("Funcionalidade em migração para o novo banco de dados!");
                                                        }}
                                                        className="text-[10px] bg-green-50 hover:bg-green-100 text-green-600 px-3 py-1.5 rounded-lg flex items-center gap-2 transition-all font-black"
                                                    >
                                                        <Save size={14} /> SALVAR MODELO
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowCompositionSearch(true)}
                                                        className="text-[10px] bg-blue-50 hover:bg-blue-100 text-blue-600 px-3 py-1.5 rounded-lg flex items-center gap-2 transition-all font-black"
                                                    >
                                                        <Plus size={14} /> ADICIONAR INSUMO
                                                    </button>
                                                </div>
                                            </div>

                                            {itemComposition.length > 0 ? (
                                                <div className="border border-slate-100 rounded-xl overflow-hidden">
                                                    <table className="w-full text-xs">
                                                        <thead className="bg-slate-800 text-white font-bold">
                                                            <tr>
                                                                <th className="p-2 text-left">Código</th>
                                                                <th className="p-2 text-left">Descrição</th>
                                                                <th className="p-2 text-center">Unid.</th>
                                                                <th className="p-2 text-right">Coef.</th>
                                                                <th className="p-2 text-right">Unitário</th>
                                                                <th className="p-2 text-right">Total</th>
                                                                <th className="p-2 w-10"></th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-slate-100">
                                                            {itemComposition.map((comp, idx) => (
                                                                <tr key={idx} className="hover:bg-slate-50">
                                                                    <td className="p-2 font-mono text-slate-400">{comp.code}</td>
                                                                    <td className="p-2 font-medium text-slate-700">{comp.description}</td>
                                                                    <td className="p-2 text-center text-slate-500 italic">{comp.unit}</td>
                                                                    <td className="p-2">
                                                                        <input
                                                                            type="number"
                                                                            className="w-full text-right bg-white border border-slate-200 rounded px-2 py-1 font-bold text-blue-600 focus:border-blue-400 outline-none"
                                                                            value={comp.coefficient}
                                                                            onChange={e => handleUpdateCompositionItem(idx, 'coefficient', Number(e.target.value))}
                                                                        />
                                                                    </td>
                                                                    <td className="p-2 text-right text-slate-600 font-mono">
                                                                        {new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(comp.unitPrice)}
                                                                    </td>
                                                                    <td className="p-2 text-right font-black text-slate-800">
                                                                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(comp.totalPrice)}
                                                                    </td>
                                                                    <td className="p-2 text-center">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => setItemComposition(prev => prev.filter((_, i) => i !== idx))}
                                                                            className="text-slate-300 hover:text-red-500"
                                                                        >
                                                                            <Trash2 size={14} />
                                                                        </button>
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                        <tfoot className="bg-slate-50 font-black border-t">
                                                            <tr>
                                                                <td colSpan={5} className="p-2 text-right uppercase text-[10px] text-slate-400">Total CPU:</td>
                                                                <td className="p-2 text-right text-blue-700">
                                                                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(itemComposition.reduce((acc, c) => acc + c.totalPrice, 0))}
                                                                </td>
                                                                <td></td>
                                                            </tr>
                                                        </tfoot>
                                                    </table>
                                                </div>
                                            ) : (
                                                <div className="text-center py-10 border-2 border-dashed border-slate-100 rounded-2xl bg-slate-50/30">
                                                    <Database size={32} className="mx-auto text-slate-200 mb-3" />
                                                    <p className="text-slate-400 text-sm">Este item não possui composição detalhada.</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                </div>

                                {/* Search Overlay for Composition */}
                                {showCompositionSearch && (
                                    <div className="absolute inset-0 bg-white/95 backdrop-blur-sm z-[60] flex flex-col p-6 animate-in slide-in-from-bottom-4">
                                        <div className="flex justify-between items-center mb-6">
                                            <h4 className="text-lg font-bold text-slate-800">Localizar Insumo para CPU</h4>
                                            <button onClick={() => setShowCompositionSearch(false)} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
                                        </div>
                                        <div className="relative mb-6">
                                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                                            <input
                                                autoFocus
                                                className="w-full pl-12 pr-6 py-4 border-2 border-slate-100 rounded-xl outline-none focus:border-blue-500 transition-all text-lg shadow-sm font-bold"
                                                placeholder="Buscar no banco de dados..."
                                                value={compositionSearchTerm}
                                                onChange={(e) => setCompositionSearchTerm(e.target.value)}
                                            />
                                        </div>
                                        <div className="flex-1 overflow-auto divide-y divide-slate-50">
                                            {compositionFilteredResources?.map(res => (
                                                <div
                                                    key={res.id}
                                                    onClick={() => handleAddResToComposition(res)}
                                                    className="p-4 flex justify-between items-center cursor-pointer hover:bg-blue-50 transition-colors rounded-xl"
                                                >
                                                    <div>
                                                        <div className="flex items-center gap-2 mb-1">
                                                            {/* Indicador de Tipo: [INS] ou [CPU] */}
                                                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${res.type === 'COMPOSITION'
                                                                ? 'bg-purple-100 text-purple-700'
                                                                : 'bg-blue-100 text-blue-700'
                                                                }`}>
                                                                {res.type === 'COMPOSITION' ? '[CPU]' : '[INS]'}
                                                            </span>
                                                            <span className="bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded text-[10px] font-bold">{res.source}</span>
                                                            <span className="text-xs font-mono text-slate-400">{res.code}</span>
                                                        </div>
                                                        <div className="font-semibold text-slate-800">{res.description}</div>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="text-xs text-slate-400">{res.unit}</div>
                                                        <div className="text-sm font-black text-slate-700">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(res.price)}</div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div className="p-6 bg-slate-50 border-t flex justify-end gap-3">
                                    <button type="button" onClick={() => { setEditingItem(null); setItemComposition([]); }} className="px-6 py-2.5 text-slate-500 font-bold hover:bg-slate-100 rounded-xl transition-all">Cancelar</button>
                                    <button form="edit-form" type="submit" className="px-8 py-3 bg-blue-600 text-white font-black rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-200 active:scale-95 transition-all">Salvar Alterações</button>
                                </div>
                            </div>
                        </div>
                    )
                }

                {/* Modal Curva ABC */}
                {
                    showABC && (
                        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[100] flex items-center justify-center p-4">
                            <div className="bg-white w-full max-w-5xl rounded-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
                                <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-orange-500 to-orange-600 text-white">
                                    <div>
                                        <h3 className="text-2xl font-black flex items-center gap-3">
                                            <BarChart size={28} /> Curva ABC de {abcType === 'insumos' ? 'Insumos' : 'Serviços'}
                                        </h3>
                                        <p className="text-orange-100 text-xs mt-1 uppercase tracking-widest font-bold">Consolidação e impacto financeiro por {abcType === 'insumos' ? 'recurso' : 'serviço'}</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="bg-orange-700/50 p-1 rounded-lg flex mr-4">
                                            <button
                                                onClick={() => setAbcType('insumos')}
                                                className={clsx("px-3 py-1 rounded-md text-sm font-bold transition-all", abcType === 'insumos' ? "bg-white text-orange-600 shadow-sm" : "text-white hover:bg-white/10")}
                                            >
                                                INSUMOS
                                            </button>
                                            <button
                                                onClick={() => setAbcType('servicos')}
                                                className={clsx("px-3 py-1 rounded-md text-sm font-bold transition-all", abcType === 'servicos' ? "bg-white text-orange-600 shadow-sm" : "text-white hover:bg-white/10")}
                                            >
                                                SERVIÇOS
                                            </button>
                                        </div>

                                        <button onClick={handleExportABCPDF} className="p-2 hover:bg-white/20 rounded-lg transition-colors flex items-center gap-2 text-xs font-bold bg-white/10" title="Baixar PDF">
                                            <FileText size={16} /> PDF
                                        </button>
                                        <button onClick={handleExportABCExcel} className="p-2 hover:bg-white/20 rounded-lg transition-colors flex items-center gap-2 text-xs font-bold bg-white/10" title="Baixar Excel">
                                            <FileSpreadsheet size={16} /> EXCEL
                                        </button>
                                        <div className="w-px h-6 bg-white/20 mx-2"></div>
                                        <button onClick={() => setShowABC(false)} className="p-2 hover:bg-white/20 rounded-full transition-colors">
                                            <X size={24} />
                                        </button>
                                    </div>
                                </div>
                                <div className="flex-1 overflow-auto p-8">
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                                        <div className="bg-green-50 p-6 rounded-2xl border border-green-100">
                                            <p className="text-[10px] font-black text-green-600 uppercase tracking-widest mb-1">Classe A (80%)</p>
                                            <div className="flex justify-between items-end">
                                                <p className="text-2xl font-black text-green-700">
                                                    {abcData.filter(i => i.group === 'A').length} <span className="text-xs font-normal">ITENS</span>
                                                </p>
                                                <p className="text-sm font-bold text-green-600">
                                                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(abcData.filter(i => i.group === 'A').reduce((acc, i) => acc + i.total, 0))}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="bg-orange-50 p-6 rounded-2xl border border-orange-100">
                                            <p className="text-[10px] font-black text-orange-600 uppercase tracking-widest mb-1">Classe B (15%)</p>
                                            <div className="flex justify-between items-end">
                                                <p className="text-2xl font-black text-orange-700">
                                                    {abcData.filter(i => i.group === 'B').length} <span className="text-xs font-normal">ITENS</span>
                                                </p>
                                                <p className="text-sm font-bold text-orange-600">
                                                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(abcData.filter(i => i.group === 'B').reduce((acc, i) => acc + i.total, 0))}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                                            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Classe C (5%)</p>
                                            <div className="flex justify-between items-end">
                                                <p className="text-2xl font-black text-slate-700">
                                                    {abcData.filter(i => i.group === 'C').length} <span className="text-xs font-normal">ITENS</span>
                                                </p>
                                                <p className="text-sm font-bold text-slate-500">
                                                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(abcData.filter(i => i.group === 'C').reduce((acc, i) => acc + i.total, 0))}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                    <table className="w-full text-sm">
                                        <thead className="bg-slate-50 text-[10px] uppercase font-black text-slate-400 tracking-wider">
                                            <tr>
                                                <th className="p-4 text-left">Class.</th>
                                                <th className="p-4 text-left">Código</th>
                                                <th className="p-4 text-left">{abcType === 'insumos' ? 'Insumo' : 'Serviço'}</th>
                                                <th className="p-4 text-center">Unid.</th>
                                                <th className="p-4 text-right">Qtde.</th>
                                                <th className="p-4 text-right">Unitário</th>
                                                <th className="p-4 text-right">Valor Total</th>
                                                <th className="p-4 text-right">Peso (%)</th>
                                                <th className="p-4 text-right">Acum. (%)</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {abcData.map((item, idx) => (
                                                <tr key={idx} className="hover:bg-slate-50 transition-colors">
                                                    <td className="p-4">
                                                        <span className={`px-2 py-1 rounded text-[10px] font-black ${item.group === 'A' ? 'bg-green-100 text-green-700' :
                                                            item.group === 'B' ? 'bg-orange-100 text-orange-700' :
                                                                'bg-slate-100 text-slate-500'
                                                            }`}>
                                                            CLASSE {item.group}
                                                        </span>
                                                    </td>
                                                    <td className="p-4 font-mono text-[10px] text-slate-400">
                                                        {abcType === 'servicos' && item.itemNumber && <span className="block text-slate-300 font-bold mb-0.5">{item.itemNumber}</span>}
                                                        {item.code}
                                                    </td>
                                                    <td className="p-4 font-bold text-slate-700">{item.description}</td>
                                                    <td className="p-4 text-center text-slate-400">{item.unit}</td>
                                                    <td className="p-4 text-right font-mono text-slate-600">{item.quantity.toFixed(2)}</td>
                                                    <td className="p-4 text-right font-mono text-slate-600">
                                                        {new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 }).format(item.unitPrice)}
                                                    </td>
                                                    <td className="p-4 text-right font-black text-slate-900 border-x border-slate-50">
                                                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.total)}
                                                    </td>
                                                    <td className="p-4 text-right font-bold text-slate-700 bg-slate-50/50">{item.weight.toFixed(2)}%</td>
                                                    <td className="p-4 text-right text-slate-400">{item.accumulatedWeight.toFixed(2)}%</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )
                }

                {/* Modal Calculadora BDI */}
                {
                    showBDICalculator && (
                        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[100] flex items-center justify-center p-4">
                            <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
                                <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-blue-600 text-white">
                                    <div>
                                        <h3 className="text-2xl font-black flex items-center gap-3">
                                            <Calculator size={28} /> Calculadora de BDI (TCU)
                                        </h3>
                                        <p className="text-blue-100 text-xs mt-1 uppercase tracking-widest font-bold">Fórmula oficial para obras e serviços</p>
                                    </div>
                                    <button onClick={() => setShowBDICalculator(false)} className="p-2 hover:bg-white/20 rounded-full transition-colors">
                                        <X size={24} />
                                    </button>
                                </div>
                                <div className="p-8 overflow-auto">

                                    {/* BDI Presets */}
                                    <div className="mb-8 space-y-3">
                                        <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Escolha o Tipo de Obra (Pre-set Acórdão 2622/2013):</label>
                                        <div className="grid grid-cols-1 gap-3">
                                            {BDI_PRESETS.map((p, idx) => (
                                                <button
                                                    key={idx}
                                                    onClick={() => handleApplyPreset(p)}
                                                    className="text-left p-4 rounded-2xl border-2 border-slate-100 hover:border-blue-500 hover:bg-blue-50 transition-all group"
                                                >
                                                    <p className="font-black text-slate-800 group-hover:text-blue-700">{p.name}</p>
                                                    <p className="text-[10px] text-slate-400 uppercase tracking-widest mt-1">{p.description}</p>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-6">
                                        {[
                                            { label: 'Adm. Central (AC)', key: 'ac' },
                                            { label: 'Seguro + Garantia (S+G)', key: 'sg' },
                                            { label: 'Taxa de Risco (R)', key: 'r' },
                                            { label: 'Desp. Financeiras (DF)', key: 'df' },
                                            { label: 'Taxa de Lucro (L)', key: 'l' },
                                        ].map((field) => (
                                            <div key={field.key}>
                                                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
                                                    {field.label}
                                                </label>
                                                <div className="relative">
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none focus:border-blue-500 transition-all font-bold text-slate-800"
                                                        value={(bdiCalc as any)[field.key]}
                                                        onChange={e => setBdiCalc({ ...bdiCalc, [field.key]: Number(e.target.value) })}
                                                    />
                                                    <span className="absolute right-4 top-1/2 -translate-y-1/2 font-black text-slate-300">%</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="mt-8 pt-8 border-t border-slate-100">
                                        <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-6">Taxa de Tributos (Impostos):</label>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                            {[
                                                { label: 'PIS', key: 'i_pis' },
                                                { label: 'COFINS', key: 'i_cofins' },
                                                { label: 'ISS', key: 'i_iss' },
                                                { label: 'CPRB (INSS)', key: 'i_cprb' },
                                            ].map((field) => (
                                                <div key={field.key}>
                                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                                                        {field.label}
                                                    </label>
                                                    <div className="relative">
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-xl outline-none focus:border-blue-500 transition-all text-sm font-bold"
                                                            value={(bdiCalc as any)[field.key]}
                                                            onChange={e => setBdiCalc({ ...bdiCalc, [field.key]: Number(e.target.value) })}
                                                        />
                                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 font-black text-slate-300 text-xs">%</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="mt-8 p-6 bg-blue-50 rounded-2xl border border-blue-100 flex justify-between items-center">
                                        <div>
                                            <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">Resultado Final</p>
                                            <p className="text-4xl font-black text-blue-700">{calculateBDI().toFixed(2)}%</p>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => generateBDIReport(settings, bdiCalc, calculateBDI())}
                                                className="bg-white text-blue-600 px-4 py-3 rounded-xl font-black text-xs border border-blue-200 hover:bg-blue-100 transition-all flex items-center gap-2"
                                            >
                                                <Download size={16} /> DOWNLOAD PDF
                                            </button>
                                            <button
                                                onClick={handleApplyBDI}
                                                className="bg-blue-600 text-white px-6 py-3 rounded-xl font-black text-xs hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all active:scale-95"
                                            >
                                                APLICAR AO ORÇAMENTO
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )
                }

                {/* Modal Encargos Sociais */}
                {
                    showEncargosModal && (
                        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[100] flex items-center justify-center p-4">
                            <div className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
                                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-orange-600 text-white">
                                    <div>
                                        <h3 className="text-xl font-black flex items-center gap-3">
                                            <Database size={24} /> Base de Encargos Sociais (SINAPI/Governo)
                                        </h3>
                                        <p className="text-orange-100 text-xs mt-1 uppercase tracking-widest font-bold">Consulte e aplique bases oficiais</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => {
                                                const baseSem = ENCARGOS_SOCIAIS_BASES.find(b => b.id === 'sinapi-horista-nao-desonerado');
                                                const baseCom = ENCARGOS_SOCIAIS_BASES.find(b => b.id === 'sinapi-horista-desonerado');
                                                if (baseSem && baseCom) {
                                                    generateEncargosFullReport(settings, baseSem, baseCom);
                                                } else {
                                                    alert("Bases SINAPI não encontradas para comparação.");
                                                }
                                            }}
                                            className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl transition-all text-xs font-bold border border-white/20"
                                        >
                                            <FileText size={16} /> QUADRO COMPARATIVO (PDF)
                                        </button>
                                        <button onClick={() => setShowEncargosModal(false)} className="p-2 hover:bg-white/20 rounded-full transition-colors">
                                            <X size={24} />
                                        </button>
                                    </div>
                                </div>

                                {/* Toggle Horista/Mensalista */}
                                <div className="p-4 bg-slate-50 border-b border-slate-100 flex items-center gap-4">
                                    <span className="text-xs font-bold text-slate-500 uppercase">Tipo de Contrato:</span>
                                    <div className="flex bg-slate-200 rounded-lg p-1">
                                        <button
                                            onClick={() => setTipoEncargo('horista')}
                                            className={clsx(
                                                "px-4 py-2 text-sm font-bold rounded-lg transition-all",
                                                tipoEncargo === 'horista' ? "bg-orange-600 text-white shadow" : "text-slate-600 hover:bg-slate-300"
                                            )}
                                        >
                                            Horista
                                        </button>
                                        <button
                                            onClick={() => setTipoEncargo('mensalista')}
                                            className={clsx(
                                                "px-4 py-2 text-sm font-bold rounded-lg transition-all",
                                                tipoEncargo === 'mensalista' ? "bg-orange-600 text-white shadow" : "text-slate-600 hover:bg-slate-300"
                                            )}
                                        >
                                            Mensalista
                                        </button>
                                    </div>
                                </div>

                                <div className="p-6 overflow-auto space-y-4 flex-1">
                                    {ENCARGOS_SOCIAIS_BASES.map((base, idx) => {
                                        const totalBase = calcularTotalBase(base, tipoEncargo);
                                        const grupos = base.grupos.map(g => ({
                                            nome: g.nome,
                                            total: g.itens.reduce((acc, item) => acc + item[tipoEncargo], 0)
                                        }));

                                        return (
                                            <div key={idx} className="p-5 bg-slate-50 border border-slate-100 rounded-2xl hover:bg-orange-50 hover:border-orange-200 transition-all group">
                                                <div className="flex justify-between items-start mb-3">
                                                    <div>
                                                        <h4 className="text-slate-800 font-bold text-base">{base.nome}</h4>
                                                        <p className="text-[10px] text-slate-400 uppercase tracking-widest mt-1">
                                                            {base.fonte} • {base.desonerado ? 'Desonerado' : 'Não Desonerado'} • Ref: {base.dataReferencia}
                                                        </p>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-[10px] text-slate-400 uppercase tracking-widest">Total {tipoEncargo}</p>
                                                        <p className="text-2xl font-black text-orange-600">{totalBase.toFixed(2)}%</p>
                                                    </div>
                                                </div>

                                                {/* Grupos Resumidos */}
                                                <div className="flex gap-3 flex-wrap mb-4">
                                                    {grupos.map((g, i) => (
                                                        <div key={i} className="bg-white px-3 py-2 rounded-lg border border-slate-100 text-center min-w-[80px]">
                                                            <p className="text-[9px] text-slate-400 uppercase font-bold">{g.nome}</p>
                                                            <p className="text-sm font-bold text-slate-700">{g.total.toFixed(2)}%</p>
                                                        </div>
                                                    ))}
                                                </div>

                                                {/* Ações */}
                                                <div className="flex gap-2 justify-end border-t border-slate-100 pt-3">
                                                    <button
                                                        onClick={() => generateEncargosReport(settings, base, tipoEncargo)}
                                                        className="flex items-center gap-2 px-4 py-2 text-slate-500 hover:text-orange-600 hover:bg-white rounded-xl transition-all text-sm font-bold"
                                                        title="Baixar Tabela Detalhada"
                                                    >
                                                        <Download size={16} />
                                                        Baixar Detalhado
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            handleUpdateEncargos(totalBase, { desonerado: base.desonerado, id: base.id });
                                                            setShowEncargosModal(false);
                                                        }}

                                                        className="bg-orange-600 text-white px-5 py-2 rounded-xl font-bold text-sm hover:bg-orange-700 shadow-lg shadow-orange-100 transition-all active:scale-95 flex items-center gap-2"
                                                    >
                                                        <Percent size={14} />
                                                        APLICAR {totalBase.toFixed(2)}%
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                            </div>
                        </div>
                    )
                }
                {isImporterOpen && (
                    <BudgetImporter
                        onClose={() => setIsImporterOpen(false)}
                        onImport={handleImportItems}
                    />
                )}

                {/* Analytic Resolution Modal */}
                <AnalyticResolutionModal
                    isOpen={showAnalyticModal}
                    onClose={() => setShowAnalyticModal(false)}
                    pendingItems={pendingAnalytics}
                    onResolve={async () => {
                        await loadBudget(); // Refresh to clear flags if any
                        // Don't close immediately? Or verify again?
                        // Let user close or re-validate.
                        // For UX, we verify list again or just remove resolved item locally?
                        // validateAnalytics(); // Re-check?
                    }}
                />

                {/* Global Adjustment Modal */}
                {
                    showAdjustmentModal && (
                        <GlobalAdjustmentModal
                            currentTotal={totalFinal}
                            onClose={() => setShowAdjustmentModal(false)}
                            onApply={handleGlobalAdjustment}
                        />
                    )
                }
            </div >
        );
    };

    export default BudgetEditor;
