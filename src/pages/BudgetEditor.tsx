
import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { BudgetService } from '../lib/supabase-services/BudgetService';
import { BudgetItemService } from '../lib/supabase-services/BudgetItemService'; // Removed prepareItemsForDisplay
import { calculateBudget, repairHierarchy, generateItemNumbers } from '../utils/calculationEngine';
import { BudgetItemCompositionService } from '../lib/supabase-services/BudgetItemCompositionService';
import GlobalAdjustmentModal from '../components/budgets/GlobalAdjustmentModal';
import { InsumoService } from '../lib/supabase-services/InsumoService';
import { CompositionService } from '../lib/supabase-services/CompositionService';
import { SinapiService } from '../lib/supabase-services/SinapiService';
import { CompanyService } from '../lib/supabase-services/CompanyService';
import { ArrowLeft, Box, Plus, Trash2, Search, X, Download, FileText, FileSpreadsheet, BarChart, Calculator, Percent, Lock, Unlock, Copy, RefreshCcw, AlertTriangle, TrendingUp, Save, Database, Calendar, Activity, Eye, ChevronDown, ChevronUp, AlertOctagon, Edit2, ListOrdered, GripVertical, Loader, Package, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { SupabaseClient } from "@supabase/supabase-js";

import { clsx } from "clsx";
import { AnalyticResolutionModal } from '../features/importer/components/AnalyticResolutionModal';
import { generateBDIReport, generateEncargosReport, generateEncargosFullReport } from '../sdk/reports/ProposalGenerator';
import { useIsMobile } from '../App';
import { ENCARGOS_SOCIAIS_BASES, calcularTotalBase } from '../data/encargosSociais';
import { BudgetImporter } from '../features/importer';
import {
    calculateAdjustmentFactors,
    getAdjustedItemValues,
    classifyItem,
    getAdjustedBudgetTotals
} from '../utils/globalAdjustment';
import { BudgetCompletenessBadge } from '../components/budgets/BudgetCompletenessBadge';
import { ImportPendencyPanel } from '../components/budgets/ImportPendencyPanel';
import { FEATURES } from '../config/features';
import type {
    GlobalAdjustmentMode,
    GlobalAdjustmentType,
    AdjustmentContext
} from '../utils/globalAdjustment';
import type { ImportJob } from '../features/importer/types';

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

interface EncargosSubitem {
    label: string;
    horista: number;
    mensalista: number;
    enabled?: boolean;
    tooltip?: string;
    readonly?: boolean;
}

interface EncargosGrupoA {
    a1_inss: EncargosSubitem;
    a2_sesi: EncargosSubitem;
    a3_senai: EncargosSubitem;
    a4_incra: EncargosSubitem;
    a5_sebrae: EncargosSubitem;
    a6_salario_educacao: EncargosSubitem;
    a7_seguro_acidente: EncargosSubitem;
    a8_fgts: EncargosSubitem;
    a9_seconci: EncargosSubitem;
}

interface EncargosGrupoB {
    b1_repouso_semanal: EncargosSubitem;
    b2_feriados: EncargosSubitem;
    b3_auxilio_enfermidade: EncargosSubitem;
    b4_decimo_terceiro: EncargosSubitem;
    b5_licenca_paternidade: EncargosSubitem;
    b6_faltas_justificadas: EncargosSubitem;
    b7_dias_chuva: EncargosSubitem;
    b8_auxilio_acidente: EncargosSubitem;
    b9_ferias_gozadas: EncargosSubitem;
    b10_salario_maternidade: EncargosSubitem;
}

interface EncargosGrupoC {
    c1_aviso_previo_indenizado: EncargosSubitem;
    c2_aviso_previo_trabalhado: EncargosSubitem;
    c3_ferias_indenizadas: EncargosSubitem;
    c4_deposito_rescisao: EncargosSubitem;
    c5_indenizacao_adicional: EncargosSubitem;
}

interface EncargosBaseDetalhada {
    id: string;
    nome: string;
    fonte: string;
    referencia: string;
    regime: 'desonerado' | 'nao_desonerado';
    grupo_a: EncargosGrupoA;
    grupo_b: EncargosGrupoB;
    grupo_c: EncargosGrupoC;
}

const ENCARGOS_BASES_DETALHADAS: EncargosBaseDetalhada[] = [
    {
        id: 'sinapi_nao_desonerado',
        nome: 'SINAPI Federal (Não Desonerado)',
        fonte: 'SINAPI/IBGE',
        referencia: 'JAN/2025',
        regime: 'nao_desonerado',
        grupo_a: {
            a1_inss: { label: 'INSS', horista: 20.00, mensalista: 20.00 },
            a2_sesi: { label: 'SESI', horista: 1.50, mensalista: 1.50 },
            a3_senai: { label: 'SENAI', horista: 1.00, mensalista: 1.00 },
            a4_incra: { label: 'INCRA', horista: 0.20, mensalista: 0.20 },
            a5_sebrae: { label: 'SEBRAE', horista: 0.60, mensalista: 0.60 },
            a6_salario_educacao: { label: 'Salário Educação', horista: 2.50, mensalista: 2.50 },
            a7_seguro_acidente: { label: 'Seguro Contra Acidentes (SAT)', horista: 3.00, mensalista: 3.00 },
            a8_fgts: { label: 'FGTS', horista: 8.00, mensalista: 8.00 },
            a9_seconci: {
                label: 'SECONCI', horista: 0.00, mensalista: 0.00,
                enabled: false,
                tooltip: 'Remover em casos onde a cidade não possuir ambulatório SECONCI'
            }
        },
        grupo_b: {
            b1_repouso_semanal: { label: 'Repouso Semanal Remunerado', horista: 17.88, mensalista: 0.00 },
            b2_feriados: { label: 'Feriados', horista: 3.95, mensalista: 0.00 },
            b3_auxilio_enfermidade: { label: 'Auxílio-Enfermidade', horista: 0.92, mensalista: 0.71 },
            b4_decimo_terceiro: { label: '13º Salário', horista: 10.81, mensalista: 8.33 },
            b5_licenca_paternidade: { label: 'Licença Paternidade', horista: 0.07, mensalista: 0.06 },
            b6_faltas_justificadas: { label: 'Faltas Justificadas', horista: 0.72, mensalista: 0.56 },
            b7_dias_chuva: { label: 'Dias de Chuva', horista: 1.48, mensalista: 0.00 },
            b8_auxilio_acidente: { label: 'Auxílio Acidente de Trabalho', horista: 0.11, mensalista: 0.09 },
            b9_ferias_gozadas: { label: 'Férias Gozadas', horista: 8.61, mensalista: 6.63 },
            b10_salario_maternidade: { label: 'Salário Maternidade', horista: 0.03, mensalista: 0.02 }
        },
        grupo_c: {
            c1_aviso_previo_indenizado: { label: 'Aviso Prévio Indenizado', horista: 5.42, mensalista: 4.18 },
            c2_aviso_previo_trabalhado: { label: 'Aviso Prévio Trabalhado', horista: 0.13, mensalista: 0.10 },
            c3_ferias_indenizadas: { label: 'Férias Indenizadas+1/3', horista: 4.87, mensalista: 3.75 },
            c4_deposito_rescisao: { label: 'Depósito Rescisão Sem Justa Causa', horista: 4.95, mensalista: 3.82 },
            c5_indenizacao_adicional: { label: 'Indenização Adicional', horista: 0.46, mensalista: 0.35 }
        }
    },
    {
        id: 'sinapi_desonerado',
        nome: 'SINAPI Federal (Desonerado)',
        fonte: 'SINAPI/IBGE',
        referencia: 'JAN/2025',
        regime: 'desonerado',
        grupo_a: {
            a1_inss: { label: 'INSS', horista: 0.00, mensalista: 0.00 },
            a2_sesi: { label: 'SESI', horista: 1.50, mensalista: 1.50 },
            a3_senai: { label: 'SENAI', horista: 1.00, mensalista: 1.00 },
            a4_incra: { label: 'INCRA', horista: 0.20, mensalista: 0.20 },
            a5_sebrae: { label: 'SEBRAE', horista: 0.60, mensalista: 0.60 },
            a6_salario_educacao: { label: 'Salário Educação', horista: 2.50, mensalista: 2.50 },
            a7_seguro_acidente: { label: 'Seguro Contra Acidentes (SAT)', horista: 3.00, mensalista: 3.00 },
            a8_fgts: { label: 'FGTS', horista: 8.00, mensalista: 8.00 },
            a9_seconci: {
                label: 'SECONCI', horista: 0.00, mensalista: 0.00,
                enabled: false,
                tooltip: 'Remover em casos onde a cidade não possuir ambulatório SECONCI'
            }
        },
        grupo_b: {
            b1_repouso_semanal: { label: 'Repouso Semanal Remunerado', horista: 17.88, mensalista: 0.00 },
            b2_feriados: { label: 'Feriados', horista: 3.95, mensalista: 0.00 },
            b3_auxilio_enfermidade: { label: 'Auxílio-Enfermidade', horista: 0.92, mensalista: 0.71 },
            b4_decimo_terceiro: { label: '13º Salário', horista: 10.81, mensalista: 8.33 },
            b5_licenca_paternidade: { label: 'Licença Paternidade', horista: 0.07, mensalista: 0.06 },
            b6_faltas_justificadas: { label: 'Faltas Justificadas', horista: 0.72, mensalista: 0.56 },
            b7_dias_chuva: { label: 'Dias de Chuva', horista: 1.48, mensalista: 0.00 },
            b8_auxilio_acidente: { label: 'Auxílio Acidente de Trabalho', horista: 0.11, mensalista: 0.09 },
            b9_ferias_gozadas: { label: 'Férias Gozadas', horista: 8.61, mensalista: 6.63 },
            b10_salario_maternidade: { label: 'Salário Maternidade', horista: 0.03, mensalista: 0.02 }
        },
        grupo_c: {
            c1_aviso_previo_indenizado: { label: 'Aviso Prévio Indenizado', horista: 5.42, mensalista: 4.18 },
            c2_aviso_previo_trabalhado: { label: 'Aviso Prévio Trabalhado', horista: 0.13, mensalista: 0.10 },
            c3_ferias_indenizadas: { label: 'Férias Indenizadas+1/3', horista: 4.87, mensalista: 3.75 },
            c4_deposito_rescisao: { label: 'Depósito Rescisão Sem Justa Causa', horista: 4.95, mensalista: 3.82 },
            c5_indenizacao_adicional: { label: 'Indenização Adicional', horista: 0.46, mensalista: 0.35 }
        }
    },
    {
        id: 'seinfra_ce',
        nome: 'SEINFRA CE (Não Desonerado)',
        fonte: 'SEINFRA/CE',
        referencia: 'JAN/2025',
        regime: 'nao_desonerado',
        grupo_a: {
            a1_inss: { label: 'INSS', horista: 20.00, mensalista: 20.00 },
            a2_sesi: { label: 'SESI', horista: 1.50, mensalista: 1.50 },
            a3_senai: { label: 'SENAI', horista: 1.00, mensalista: 1.00 },
            a4_incra: { label: 'INCRA', horista: 0.20, mensalista: 0.20 },
            a5_sebrae: { label: 'SEBRAE', horista: 0.60, mensalista: 0.60 },
            a6_salario_educacao: { label: 'Salário Educação', horista: 2.50, mensalista: 2.50 },
            a7_seguro_acidente: { label: 'Seguro Contra Acidentes (SAT)', horista: 3.00, mensalista: 3.00 },
            a8_fgts: { label: 'FGTS', horista: 8.00, mensalista: 8.00 },
            a9_seconci: {
                label: 'SECONCI', horista: 0.00, mensalista: 0.00,
                enabled: false,
                tooltip: 'Remover em casos onde a cidade não possuir ambulatório SECONCI'
            }
        },
        grupo_b: {
            b1_repouso_semanal: { label: 'Repouso Semanal Remunerado', horista: 17.88, mensalista: 0.00 },
            b2_feriados: { label: 'Feriados', horista: 3.95, mensalista: 0.00 },
            b3_auxilio_enfermidade: { label: 'Auxílio-Enfermidade', horista: 0.92, mensalista: 0.71 },
            b4_decimo_terceiro: { label: '13º Salário', horista: 10.81, mensalista: 8.33 },
            b5_licenca_paternidade: { label: 'Licença Paternidade', horista: 0.07, mensalista: 0.06 },
            b6_faltas_justificadas: { label: 'Faltas Justificadas', horista: 0.72, mensalista: 0.56 },
            b7_dias_chuva: { label: 'Dias de Chuva', horista: 1.48, mensalista: 0.00 },
            b8_auxilio_acidente: { label: 'Auxílio Acidente de Trabalho', horista: 0.11, mensalista: 0.09 },
            b9_ferias_gozadas: { label: 'Férias Gozadas', horista: 8.61, mensalista: 6.63 },
            b10_salario_maternidade: { label: 'Salário Maternidade', horista: 0.03, mensalista: 0.02 }
        },
        grupo_c: {
            c1_aviso_previo_indenizado: { label: 'Aviso Prévio Indenizado', horista: 5.42, mensalista: 4.18 },
            c2_aviso_previo_trabalhado: { label: 'Aviso Prévio Trabalhado', horista: 0.13, mensalista: 0.10 },
            c3_ferias_indenizadas: { label: 'Férias Indenizadas+1/3', horista: 4.87, mensalista: 3.75 },
            c4_deposito_rescisao: { label: 'Depósito Rescisão Sem Justa Causa', horista: 4.95, mensalista: 3.82 },
            c5_indenizacao_adicional: { label: 'Indenização Adicional', horista: 0.46, mensalista: 0.35 }
        }
    },
    {
        id: 'orse_se',
        nome: 'ORSE SE (Não Desonerado)',
        fonte: 'ORSE/SE',
        referencia: 'JAN/2025',
        regime: 'nao_desonerado',
        grupo_a: {
            a1_inss: { label: 'INSS', horista: 20.00, mensalista: 20.00 },
            a2_sesi: { label: 'SESI', horista: 1.50, mensalista: 1.50 },
            a3_senai: { label: 'SENAI', horista: 1.00, mensalista: 1.00 },
            a4_incra: { label: 'INCRA', horista: 0.20, mensalista: 0.20 },
            a5_sebrae: { label: 'SEBRAE', horista: 0.60, mensalista: 0.60 },
            a6_salario_educacao: { label: 'Salário Educação', horista: 2.50, mensalista: 2.50 },
            a7_seguro_acidente: { label: 'Seguro Contra Acidentes (SAT)', horista: 3.00, mensalista: 3.00 },
            a8_fgts: { label: 'FGTS', horista: 8.00, mensalista: 8.00 },
            a9_seconci: {
                label: 'SECONCI', horista: 0.00, mensalista: 0.00,
                enabled: false,
                tooltip: 'Remover em casos onde a cidade não possuir ambulatório SECONCI'
            }
        },
        grupo_b: {
            b1_repouso_semanal: { label: 'Repouso Semanal Remunerado', horista: 17.88, mensalista: 0.00 },
            b2_feriados: { label: 'Feriados', horista: 3.95, mensalista: 0.00 },
            b3_auxilio_enfermidade: { label: 'Auxílio-Enfermidade', horista: 0.92, mensalista: 0.71 },
            b4_decimo_terceiro: { label: '13º Salário', horista: 10.81, mensalista: 8.33 },
            b5_licenca_paternidade: { label: 'Licença Paternidade', horista: 0.07, mensalista: 0.06 },
            b6_faltas_justificadas: { label: 'Faltas Justificadas', horista: 0.72, mensalista: 0.56 },
            b7_dias_chuva: { label: 'Dias de Chuva', horista: 1.48, mensalista: 0.00 },
            b8_auxilio_acidente: { label: 'Auxílio Acidente de Trabalho', horista: 0.11, mensalista: 0.09 },
            b9_ferias_gozadas: { label: 'Férias Gozadas', horista: 8.61, mensalista: 6.63 },
            b10_salario_maternidade: { label: 'Salário Maternidade', horista: 0.03, mensalista: 0.02 }
        },
        grupo_c: {
            c1_aviso_previo_indenizado: { label: 'Aviso Prévio Indenizado', horista: 5.42, mensalista: 4.18 },
            c2_aviso_previo_trabalhado: { label: 'Aviso Prévio Trabalhado', horista: 0.13, mensalista: 0.10 },
            c3_ferias_indenizadas: { label: 'Férias Indenizadas+1/3', horista: 4.87, mensalista: 3.75 },
            c4_deposito_rescisao: { label: 'Depósito Rescisão Sem Justa Causa', horista: 4.95, mensalista: 3.82 },
            c5_indenizacao_adicional: { label: 'Indenização Adicional', horista: 0.46, mensalista: 0.35 }
        }
    }
];

function calcTotalGrupo(
    grupo: Record<string, EncargosSubitem>,
    tipo: 'horista' | 'mensalista'
): number {
    return Object.values(grupo).reduce((acc, item) => {
        if (item.enabled === false) return acc;
        return acc + (item[tipo] ?? 0);
    }, 0);
}

function calcGrupoD(base: EncargosBaseDetalhada, tipo: 'horista' | 'mensalista') {
    const A = calcTotalGrupo(base.grupo_a as any, tipo);
    const B = calcTotalGrupo(base.grupo_b as any, tipo);
    const C1 = base.grupo_c.c1_aviso_previo_indenizado[tipo] ?? 0;
    const C2 = base.grupo_c.c2_aviso_previo_trabalhado[tipo] ?? 0;
    const A8 = base.grupo_a.a8_fgts[tipo] ?? 0;

    const D1 = (A / 100) * B;
    const D2 = (A / 100) * C2 + (A8 / 100) * C1;
    return {
        d1: parseFloat(D1.toFixed(2)),
        d2: parseFloat(D2.toFixed(2)),
        total: parseFloat((D1 + D2).toFixed(2))
    };
}

function calcTotalGeral(base: EncargosBaseDetalhada, tipo: 'horista' | 'mensalista'): number {
    const A = calcTotalGrupo(base.grupo_a as any, tipo);
    const B = calcTotalGrupo(base.grupo_b as any, tipo);
    const C = calcTotalGrupo(base.grupo_c as any, tipo);
    const D = calcGrupoD(base, tipo).total;
    return parseFloat((A + B + C + D).toFixed(2));
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

    // UX Improvements: Partial Extraction Banner
    const [sourceJob, setSourceJob] = useState<ImportJob | null>(null);
    const [showPartialBanner, setShowPartialBanner] = useState(false);

    // Binding Logic (Missing Composition)
    const [bindingItem, setBindingItem] = useState<any | null>(null);

    useEffect(() => {
        if (!budgetId) return;

        const checkJobLink = async () => {
            // A. Try strong link via result_budget_id (Primary)
            const { data: jobByLink } = await supabase.from('import_jobs' as any)
                .select('id, status, last_error, document_context, result_budget_id')
                .eq('result_budget_id', budgetId)
                .maybeSingle();

            if (jobByLink) {
                setSourceJob(jobByLink);
                // checkPartialStatus will be called by the Effect dependent on [sourceJob, items]
                return;
            }

            // B. Fallback: Try regex on name (Legacy/Weak link)
            if (budget?.name) {
                const match = budget.name.match(/Importação IA - ([0-9a-fA-F-]{36})/);
                if (match && match[1]) {
                    const jobId = match[1];
                    const { data: jobByName } = await supabase.from('import_jobs' as any)
                        .select('id, status, last_error, document_context, result_budget_id')
                        .eq('id', jobId)
                        .maybeSingle();

                    if (jobByName) {
                        setSourceJob(jobByName);
                    }
                }
            }
        };

        checkJobLink();
    }, [budgetId, budget?.name]);

    // Re-evaluate Banner when Job OR Items change
    useEffect(() => {
        if (sourceJob) {
            checkPartialStatus(sourceJob, items);
        }
    }, [sourceJob, items]);

    const checkPartialStatus = (job: any, currentItems: any[] = []) => {
        // Verifica se usuário já dispensou este aviso
        const dismissKey = job.id
            ? `naborca_dismiss_partial_${job.id}`
            : `naborca_dismiss_partial_budget_${budgetId}`;

        const dismissed = localStorage.getItem(dismissKey);
        if (dismissed) {
            if (showPartialBanner) setShowPartialBanner(false);
            return;
        }

        // Lógica ROBUSTA de "Looks Incomplete"

        // 1. Status explícitos de falha parcial ou espera
        const partialStatuses = [
            'waiting_user_extraction_failed',
            'waiting_user_rate_limited',
            'failed'
        ];
        const isPartialStatus = partialStatuses.includes(job.status);

        // 2. Erros explícitos
        const hasError = !!job.last_error;

        // 3. Razões internas de incompleteza (document_context)
        const reason = job.document_context?.debug_info?.reason;
        const incompleteReasons = ['no_items_after_tasks_done', 'timeout', 'worker_limit', 'low_completeness'];
        const hasReason = reason && incompleteReasons.includes(reason);

        // 4. HEURÍSTICA DE ITENS (Para Jobs DONE mas parciais)
        let looksIncompleteByHeuristic = false;

        if (currentItems && currentItems.length > 0) {
            // Filter "AI Items" (source AI or [VINCULAR])
            const aiItems = currentItems.filter(i => {
                const desc = (i.description || i.descricao || "").toUpperCase();
                const src = (i.source || i.bank || "").toUpperCase();
                return (src === 'AI_EXTRACTION' || src === 'AI') || desc.includes('[VINCULAR]');
            });

            // Filter "Pending Link" (no code or [VINCULAR])
            const pendingLink = aiItems.filter(i => {
                const desc = (i.description || i.descricao || "").toUpperCase();
                const code = (i.code || i.codigo || "").trim();
                const invalidCode = !code || code === '?' || code === '-';
                return invalidCode || desc.includes('[VINCULAR]');
            });

            // Ratio
            if (aiItems.length >= 10) {
                const ratio = pendingLink.length / aiItems.length;
                // Threshold 15% pending
                if (ratio >= 0.15) {
                    looksIncompleteByHeuristic = true;
                    // Optional Dev Log
                    if (import.meta.env.DEV) {
                        console.info("[PartialHeuristic] Triggered:", { total: aiItems.length, pending: pendingLink.length, ratio });
                    }
                }
            }
        }

        // Se parece incompleto, ativamos o banner
        const shouldShow = (isPartialStatus || hasError || hasReason || looksIncompleteByHeuristic) && currentItems.length > 0;
        if (shouldShow !== showPartialBanner) {
            setShowPartialBanner(shouldShow);
        }
    };

    const handleDismissPartialBanner = () => {
        if (sourceJob?.id) {
            localStorage.setItem(`naborca_dismiss_partial_${sourceJob.id}`, 'true');
        } else {
            localStorage.setItem(`naborca_dismiss_partial_budget_${budgetId}`, 'true');
        }
        setShowPartialBanner(false);
    };

    useEffect(() => {
        if (!budgetId) return;
        loadBudget();
        loadSettings();
    }, [budgetId]);

    // REGRA 1: Valores vêm PRONTOS do backend
    // O frontend NÃO recalcula valores, apenas calcula peso (%) dinamicamente

    const loadBudget = async (silent = false) => {
        try {
            if (!silent) setLoading(true);
            const b = await BudgetService.getById(budgetId);
            setBudget(b);

            // Fetch items with pagination to prevent 502 on large budgets
            const viewItems = await BudgetItemService.getByBudgetId(budgetId, {
                pageSize: 1000,
                onProgress: (loaded, total) => {
                    if (import.meta.env.DEV) {
                        console.debug(`[BudgetEditor] Loaded ${loaded}/${total} items...`);
                    }
                }
            });

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
    const [addItemTab, setAddItemTab] = useState<'INS' | 'CPU'>('CPU'); // Alterado para CPU como padrão
    const [isReordering, setIsReordering] = useState(false);
    const [insertContext, setInsertContext] = useState<{ parentId?: string | null, afterIndex?: number } | null>(null);
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
    // Inline Edit State
    const [editingInlineId, setEditingInlineId] = useState<string | null>(null);
    const [editingInlineText, setEditingInlineText] = useState("");

    // Inline Insert State for contextual N1/N2 creation
    const [inlineInsert, setInlineInsert] = useState<{
        type: 'etapa' | 'subetapa';
        afterIndex: number;
        parentId: string | null;
        provisionalNumber: string;
    } | null>(null);
    const [inlineInsertText, setInlineInsertText] = useState("");
    const inlineInsertRef = useRef<HTMLInputElement>(null);
    const [showBaseSelector, setShowBaseSelector] = useState(false);

    // Inline resource search (Composição/Insumo)
    const [inlineSearch, setInlineSearch] = useState<{
        afterIndex: number;
        parentId: string | null;
        type: 'CPU' | 'INS';
    } | null>(null);
    const [inlineSearchTerm, setInlineSearchTerm] = useState('');
    const [inlineSearchResults, setInlineSearchResults] = useState<any[]>([]);
    const [inlineSearchLoading, setInlineSearchLoading] = useState(false);
    const inlineSearchRef = useRef<HTMLInputElement>(null);
    const [editingQuantity, setEditingQuantity] = useState<{ itemId: string; value: string } | null>(null);

    // Estados de Busca e Filtros Multi-Base
    const [selectedBases, setSelectedBases] = useState<string[]>(() => {
        const saved = localStorage.getItem('naborca_search_bases');
        return saved ? JSON.parse(saved) : ['SINAPI'];
    });
    const AVAILABLE_BASES = ['SINAPI', 'ORSE', 'EMBASA', 'OWN'];

    useEffect(() => {
        localStorage.setItem('naborca_search_bases', JSON.stringify(selectedBases));
    }, [selectedBases]);

    // Inline search debounce — direct search without reusing shared state
    useEffect(() => {
        if (!inlineSearch || inlineSearchTerm.length < 3) {
            setInlineSearchResults([]);
            return;
        }
        setInlineSearchLoading(true);
        const timer = setTimeout(async () => {
            try {
                const bases = budget?.settings?.bases_selecionadas || selectedBases;
                const priceContext = budget?.settings?.bases_refs
                    ? { competence: Object.values(budget.settings.bases_refs)[0] }
                    : undefined;
                const safeQuery = inlineSearchTerm.trim();
                let results: any[] = [];
                if (inlineSearch.type === 'INS') {
                    const [userResults, publicResults] = await Promise.all([
                        InsumoService.search(safeQuery),
                        SinapiService.searchInputs(safeQuery, {
                            sources: bases.filter((b: string) => b !== 'OWN'),
                            ...priceContext
                        })
                    ]);
                    const normUser = (userResults || []).map((i: any) => normalizeResource(i, 'insumo'));
                    const normPublic = (publicResults || []).map((i: any) => normalizeResource(i, 'insumo'));
                    results = [...normUser, ...normPublic];
                } else {
                    const [userResults, publicResults] = await Promise.all([
                        CompositionService.search(safeQuery),
                        SinapiService.searchCompositions(safeQuery, {
                            sources: bases.filter((b: string) => b !== 'OWN'),
                            ...priceContext
                        })
                    ]);
                    const normUser = (userResults || []).map((i: any) => normalizeResource(i, 'composition'));
                    const normPublic = (publicResults || []).map((c: any) => normalizeResource(c, 'composition'));
                    results = [...normUser, ...normPublic];
                }
                setInlineSearchResults(results);
            } catch (e) {
                console.error('[inlineSearch] error:', e);
                setInlineSearchResults([]);
            } finally {
                setInlineSearchLoading(false);
            }
        }, 400);
        return () => clearTimeout(timer);
    }, [inlineSearchTerm, inlineSearch]);

    // Estados de Loading para Exportações e Ferramentas
    const [isExportingAnalytic, setIsExportingAnalytic] = useState(false);
    const [isImporterOpen, setIsImporterOpen] = useState(false);
    const [isExportingZip, setIsExportingZip] = useState(false);
    const [exportProgress, setExportProgress] = useState({ current: 0, total: 0, message: '' });

    // Analytic Blocking State
    const [showAnalyticModal, setShowAnalyticModal] = useState(false);
    const [pendingAnalytics, setPendingAnalytics] = useState<any[]>([]);

    // Phase 3 Pendency Panel
    const [showPendencyPanel, setShowPendencyPanel] = useState(false);

    // Drag and Drop States
    const [draggedItemIndex, setDraggedItemIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const [searchParams] = useSearchParams();
    const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);

    // BDI Calculator States
    const [showBDICalculator, setShowBDICalculator] = useState(false);
    const [localBDI, setLocalBDI] = useState<string>(budget?.bdi?.toString() || '0');
    const [localBdiEquip, setLocalBdiEquip] = useState<string>(budget?.settings?.bdiEquipamento?.toString() || '');
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

    const [bdiEquipCalc, setBdiEquipCalc] = useState({
        ac: 0.56,
        sg: 0.56,
        r: 0.56,
        df: 0.59,
        l: 5.49,
        i_pis: 0.65,
        i_cofins: 3.00,
        i_iss: 0.00,
        i_cprb: 0.0
    });

    const [showEquipCalc, setShowEquipCalc] = useState(false);
    const [selectedPresetKey, setSelectedPresetKey] = useState<string | null>(null);

    const BDI_PRESETS = {
        edificios: {
            label: 'Construção de Edifícios',
            obras: { ac: 4.00, sg: 0.80, r: 1.27, df: 1.23, l: 7.40, pis: 0.65, cofins: 3.00, iss: 0.00, cprb: 0 },
            equipamentos: { ac: 0.56, sg: 0.56, r: 0.56, df: 0.59, l: 5.49, pis: 0.65, cofins: 3.00, iss: 0.00, cprb: 0 },
            faixa: { min: 20.34, max: 25.00 },
            faixaEquip: { min: 11.10, max: 14.02 }
        },
        rodovias: {
            label: 'Construção de Rodovias e Ferrovias',
            obras: { ac: 3.87, sg: 0.80, r: 1.27, df: 1.23, l: 7.03, pis: 0.65, cofins: 3.00, iss: 0.00, cprb: 0 },
            equipamentos: { ac: 0.56, sg: 0.56, r: 0.56, df: 0.59, l: 5.01, pis: 0.65, cofins: 3.00, iss: 0.00, cprb: 0 },
            faixa: { min: 19.60, max: 24.23 },
            faixaEquip: { min: 10.62, max: 13.65 }
        },
        saneamento: {
            label: 'Redes de Água, Esgoto e Correlatas',
            obras: { ac: 4.00, sg: 0.80, r: 1.27, df: 1.23, l: 7.40, pis: 0.65, cofins: 3.00, iss: 0.00, cprb: 0 },
            equipamentos: { ac: 0.56, sg: 0.56, r: 0.56, df: 0.59, l: 5.49, pis: 0.65, cofins: 3.00, iss: 0.00, cprb: 0 },
            faixa: { min: 20.34, max: 25.00 },
            faixaEquip: { min: 11.10, max: 14.02 }
        },
        energia: {
            label: 'Estações e Redes de Energia Elétrica',
            obras: { ac: 3.87, sg: 0.80, r: 1.27, df: 1.23, l: 7.03, pis: 0.65, cofins: 3.00, iss: 0.00, cprb: 0 },
            equipamentos: { ac: 0.56, sg: 0.56, r: 0.56, df: 0.59, l: 5.01, pis: 0.65, cofins: 3.00, iss: 0.00, cprb: 0 },
            faixa: { min: 19.60, max: 24.23 },
            faixaEquip: { min: 10.62, max: 13.65 }
        },
        portuarias: {
            label: 'Obras Portuárias, Marítimas e Fluviais',
            obras: { ac: 4.00, sg: 0.80, r: 1.27, df: 1.23, l: 7.40, pis: 0.65, cofins: 3.00, iss: 0.00, cprb: 0 },
            equipamentos: { ac: 0.56, sg: 0.56, r: 0.56, df: 0.59, l: 5.49, pis: 0.65, cofins: 3.00, iss: 0.00, cprb: 0 },
            faixa: { min: 20.69, max: 25.49 },
            faixaEquip: { min: 11.10, max: 14.02 }
        },
        fornecimento: {
            label: 'Fornecimento de Materiais e Equipamentos',
            obras: null,
            equipamentos: { ac: 0.56, sg: 0.56, r: 0.56, df: 0.59, l: 5.49, pis: 0.65, cofins: 3.00, iss: 0.00, cprb: 0 },
            faixa: null,
            faixaEquip: { min: 11.10, max: 14.02 }
        }
    } as const;

    type PresetKey = keyof typeof BDI_PRESETS;

    // Encargos Sociais Modal States
    const [showEncargosModal, setShowEncargosModal] = useState(false);
    const [tipoEncargo, setTipoEncargo] = useState<'horista' | 'mensalista'>('horista');
    const [encargosEditado, setEncargosEditado] = useState<EncargosBaseDetalhada | null>(null);
    const [gruposExpandidos, setGruposExpandidos] = useState<Record<string, boolean>>({});
    const [todosExpandidos, setTodosExpandidos] = useState(false);

    const handleSelecionarBase = (base: EncargosBaseDetalhada) => {
        setEncargosEditado(JSON.parse(JSON.stringify(base)));
        setGruposExpandidos({});
        setTodosExpandidos(false);
    };

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

        // 0. Pre-process: Virtual Parenting for Imported Items (Fix Orphans)
        // Percorre NA ORDEM ATUAL (já correta do serviço) para rastrear o último pai visto
        let lastL1: any = null;
        let lastL2: any = null;

        const fixedItems = [...allItems].map(item => {
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

        // 1. Recursive depth-first traversal (handles all levels: N1/N2/N3/N4+)
        // Groups siblings by parentId, sorts each sibling group by order, then visits recursively.
        // This eliminates orphans by visiting ALL children of ANY parent, not just 2 levels deep.
        const byParent = new Map<string | null, any[]>();
        fixedItems.forEach(item => {
            const key = item.parentId ?? null;
            if (!byParent.has(key)) byParent.set(key, []);
            byParent.get(key)!.push(item);
        });

        // Sort each sibling group by order (domain field = order_index from DB)
        byParent.forEach(children => children.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));

        const flatList: any[] = [];
        const visit = (parentId: string | null) => {
            const children = byParent.get(parentId) ?? [];
            children.forEach(item => {
                flatList.push({
                    ...item,
                    calculatedTotal: item.finalPrice || 0
                });
                visit(item.id); // Recurse into children of any level
            });
        };
        visit(null);

        // SAFETY NET: detect any items missed by the traversal (true orphans with broken parent_id)
        const visibleIds = new Set(flatList.map(i => i.id));
        const orphans = fixedItems.filter(i => i.id && !visibleIds.has(i.id));

        if (orphans.length > 0) {
            console.warn('[organizeHierarchy] True orphans (broken parent_id):', orphans.length, orphans.map(o => o.description));
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

        // REGRA 3: Total global = totalFinal ajustado (SSOT)
        const currentTotalGlobal = totalFinal;

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
            await loadBudget(true);
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
            await loadBudget(true);
        } catch (e: any) {
            console.error("Falha ao criar Sub-etapa:", e);
            alert(`Erro ao salvar no banco: ${e.message || "Verifique sua conexão"}`);
        }
    };

    // ===== INSERÇÃO POSICIONAL INLINE: Etapa/Sub-etapa no menu de contexto =====
    const handleStartInlineInsert = (type: 'etapa' | 'subetapa', afterIndex: number, parentId: string | null) => {
        const clickedRow = visibleRows?.[afterIndex];
        if (!clickedRow) return;
        const clickedLevel = clickedRow.level || 1;
        let insertAfterIndex = afterIndex;
        let newLevel: number;
        let newParentId: string | null;

        if (type === 'etapa') {
            // ETAPA = create SIBLING (same level, same parent)
            newLevel = clickedLevel;
            newParentId = clickedRow.parentId || null;

            // Advance past all children of clicked item
            for (let i = afterIndex + 1; i < (visibleRows?.length || 0); i++) {
                if (visibleRows[i].level <= clickedLevel) break;
                insertAfterIndex = i;
            }
            // Then advance past all siblings and their children at same level
            for (let i = insertAfterIndex + 1; i < (visibleRows?.length || 0); i++) {
                if (newParentId === null) {
                    // For N1: go to end of entire list
                    insertAfterIndex = i;
                } else {
                    // For N2+: stop when we hit a level <= parent level
                    const parentLevel = clickedLevel - 1;
                    if (visibleRows[i].level <= parentLevel) break;
                    insertAfterIndex = i;
                }
            }
            // Handle N1 at end of list
            if (newParentId === null) {
                insertAfterIndex = (visibleRows?.length || 1) - 1;
            }
        } else {
            // SUBETAPA: sempre cria FILHO do item clicado (nível + 1)
            newLevel = clickedLevel + 1;
            newParentId = clickedRow.id || null;

            // Avança past todos os descendentes do item clicado
            for (let i = afterIndex + 1; i < (visibleRows?.length || 0); i++) {
                if (visibleRows[i].level <= clickedLevel) break;
                insertAfterIndex = i;
            }
        }

        // Calculate provisional number
        let provisionalNumber = '';
        if (type === 'etapa') {
            // Count existing siblings at same level under same parent
            const clickedNum = clickedRow.itemNumber || '';
            const numParts = clickedNum.split('.');
            // Find the last sibling number at this level
            let maxSiblingNum = 0;
            for (let i = 0; i < items.length; i++) {
                if (items[i].level === clickedLevel && items[i].parentId === (newParentId || null)) {
                    const parts = (items[i].itemNumber || '').split('.');
                    const lastNum = parseInt(parts[parts.length - 1] || '0', 10);
                    if (lastNum > maxSiblingNum) maxSiblingNum = lastNum;
                }
            }
            if (numParts.length === 1) {
                provisionalNumber = `${maxSiblingNum + 1}`;
            } else {
                numParts[numParts.length - 1] = `${maxSiblingNum + 1}`;
                provisionalNumber = numParts.join('.');
            }
        } else {
            // SUBETAPA: conta filhos diretos existentes do item clicado
            const clickedId = clickedRow?.id;
            let childCount = 0;
            for (let i = 0; i < items.length; i++) {
                if (items[i].parentId === clickedId && items[i].level === clickedLevel + 1) childCount++;
            }
            const clickedNum = clickedRow?.itemNumber || '?';
            provisionalNumber = `${clickedNum}.${childCount + 1}`;
        }

        parentId = newParentId;
        setInlineInsert({ type, afterIndex: insertAfterIndex, parentId, provisionalNumber });
        setInlineInsertText('');
        setTimeout(() => inlineInsertRef.current?.focus(), 50);
    };

    const handleConfirmInlineInsert = async () => {
        if (!inlineInsert || !inlineInsertText.trim()) {
            setInlineInsert(null);
            return;
        }
        const { type, afterIndex, parentId } = inlineInsert;
        const description = inlineInsertText.trim().toUpperCase();
        try {
            setInlineInsert(null);
            // Determine level from provisional number (count dots + 1)
            const dots = (inlineInsert.provisionalNumber || '').split('.').length - 1;
            const level = dots + 1;
            const itemParentId = level === 1 ? null : parentId;
            const newItem = await BudgetItemService.create({
                budgetId: budgetId,
                order: getNextOrder(),
                level,
                parentId: itemParentId,
                itemNumber: "",
                code: "",
                description,
                unit: "",
                quantity: 1,
                unitPrice: 0,
                totalPrice: 0,
                type: 'group',
                source: "",
            });
            if (items) {
                const newItems = [...items];
                newItems.splice(afterIndex + 1, 0, newItem);
                newItems.forEach((it, idx) => { it.order = idx + 1; });
                const repairedItems = repairHierarchy(newItems);
                const numberMap = generateItemNumbers(repairedItems);
                const payload = repairedItems.map((item, idx) => {
                    const itemNumberStr = numberMap.get(item.id!) || `${idx + 1}`;
                    const finalParentId = item.parentId && String(item.parentId).trim() !== "" && String(item.parentId).trim().toLowerCase() !== "null" ? String(item.parentId) : null;
                    return { id: item.id!, order: item.order, parentId: finalParentId, itemNumber: itemNumberStr };
                });
                try {
                    await (supabase as SupabaseClient<any>).rpc("reorder_budget_items", { items: payload });
                } catch (e) {
                    console.error("Contextual Reorder Error (inline insert):", e);
                }
            }
            await loadBudget(true);
            setInlineInsert(null);
            setInlineInsertText('');
        } catch (e: any) {
            console.error("Falha ao criar grupo posicional:", e);
            alert(`Erro ao salvar: ${e.message || "Verifique sua conexão"}`);
        } finally {
            setLoading(false);
        }
    };

    const handleCancelInlineInsert = () => {
        setInlineInsert(null);
        setInlineInsertText('');
    };

    const handleBindComposition = async (targetItem: any, resource: NormalizedResource) => {
        try {
            console.log("[handleBindComposition]", { targetId: targetItem.id, resourceCode: resource.code });

            // 1. Encontrar a pendência (Issue) associada
            const issue = await BudgetItemService.getHydrationIssue(String(targetItem.id));

            if (!issue) {
                console.error("Pendência não encontrada na tabela import_hydration_issues.");
                // Fallback: Se não achar issue, tenta atualizar manualmente (mas avisa)
                // OU, prioriza segurança e barra. Vamos barrar pois o user exigiu paridade.
                alert("Não foi possível localizar a pendência original deste item. Tente recarregar a página ou contate suporte.");
                return;
            }

            // 2. Chamar RPC Oficial de Resolução (Paridade Backend)
            await BudgetItemService.resolveHydrationIssue(issue.id, {
                source_type: 'internal_db',
                code: resource.code
            });

            // 3. Recarregar e Limpar Estado
            await loadBudget(true);
            setIsAddingItem(false);
            setBindingItem(null);
            setSelectedResource(null);
            setQuantity(1);
            setSearchTerm('');

        } catch (e: any) {
            console.error("Erro ao vincular (RPC):", e);
            alert(`Erro ao vincular composição: ${e.message || "Verifique sua conexão"}`);
        } finally {
            setLoading(false);
        }
    };

    const handleAddItem = async () => {
        // REGRA: Items DEVE ser um array (mesmo que vazio)
        if (!selectedResource || !items) {
            console.error("[handleAddItem] Aborting: selectedResource or items missing", { selectedResource, itemsNull: !items });
            return;
        }

        try {
            console.log("[handleAddItem] Starting...", {
                budgetId,
                resource: selectedResource.code,
                tab: addItemTab,
                itemsCount: items.length
            });

            // 1. Verificar se existe pelo menos uma ETAPA (Nível 1)
            const lastEtapa = [...items].reverse().find(i => i.level === 1);

            let targetParentId: string | undefined | null = insertContext?.parentId ?? undefined;

            if (!insertContext && lastEtapa) {
                const lastSubEtapa = [...items].reverse().find(i => i.level === 2 && i.parentId === lastEtapa.id);
                if (lastSubEtapa && lastSubEtapa.id) {
                    targetParentId = lastSubEtapa.id;
                }
            }

            // 3. Criar o Item na Subetapa ou Etapa Alvo
            const itemData: any = {
                budgetId: budgetId,
                order: getNextOrder(), // Será reordenado abaixo se for inserção contextual
                level: 3,
                parentId: targetParentId,
                itemNumber: "",
                code: selectedResource.code,
                description: selectedResource.description,
                unit: selectedResource.unit,
                quantity: Number(quantity),
                unitPrice: selectedResource.price,
                type: selectedResource.originalType || (addItemTab === 'CPU' ? 'service' : 'material'),
                source: selectedResource.source,
                itemType: addItemTab === 'CPU' ? 'composicao' : 'insumo',
                compositionId: addItemTab === 'CPU' ? (selectedResource.id || selectedResource.raw?.id) : null,
                insumoId: addItemTab === 'INS' ? (selectedResource.id || selectedResource.raw?.id) : null,
            };

            // SE ESTIVER EM MODO DE VINCULAÇÃO (FIX PENDING)
            if (bindingItem) {
                await handleBindComposition(bindingItem, selectedResource);
                setInsertContext(null);
                return;
            }

            console.log("[handleAddItem] Calling BudgetItemService.create with:", itemData);
            const newItem = await BudgetItemService.create(itemData);
            console.log("[handleAddItem] Created successfully:", newItem.id);

            // 4. Inserção Contextual (Reordenação Imediata)
            if (insertContext && insertContext.afterIndex !== undefined && items) {
                const newItems = [...items];
                // Insere imediatamente após o índice do contexto (pode ser o próprio grupo ou o item atual)
                newItems.splice(insertContext.afterIndex + 1, 0, newItem);

                newItems.forEach((it, idx) => {
                    it.order = idx + 1;
                });

                const repairedItems = repairHierarchy(newItems);

                const numberMap = generateItemNumbers(repairedItems);
                const payload = repairedItems.map((item, idx) => {
                    const itemNumberStr = numberMap.get(item.id!) || `${idx + 1}`;
                    const finalParentId = item.parentId && String(item.parentId).trim() !== "" && String(item.parentId).trim().toLowerCase() !== "null" ? String(item.parentId) : null;
                    return { id: item.id!, order: item.order, parentId: finalParentId, itemNumber: itemNumberStr };
                });

                try {
                    await (supabase as SupabaseClient<any>).rpc("reorder_budget_items", { items: payload });
                } catch (e) {
                    console.error("Contextual Reorder Error:", e);
                }
            }

            await loadBudget(true);
            setIsAddingItem(false);
            setSelectedResource(null);
            setInsertContext(null);
            setQuantity(1);
            setSearchTerm('');
        } catch (e: any) {
            console.error("Erro ao adicionar item:", e);
            alert(`Erro ao Adicionar Item: ${e.message || "Falha técnica"}`);
        } finally {
            setLoading(false);
        }
    };

    const handleInlineEditSave = async (itemId: string, newText: string) => {
        if (!newText.trim()) {
            setEditingInlineId(null);
            return;
        }
        try {
            await BudgetItemService.update(itemId, { description: newText.trim() });
            setItems(prevItems => prevItems.map(it => it.id === itemId ? { ...it, description: newText.trim() } : it));
        } catch (e: any) {
            console.error("Erro ao atualizar descrição:", e);
            alert(`Erro ao atualizar nome: ${e.message}`);
        } finally {
            setEditingInlineId(null);
        }
    };

    const handleDeleteItem = async (itemId: string) => {
        if (!window.confirm("Remover este item?")) return;
        try {
            await BudgetItemService.delete(itemId);

            // Reload to get updated items list
            const viewItems = await BudgetItemService.getByBudgetId(budgetId, { pageSize: 1000 });
            const repairedItems = repairHierarchy(viewItems || []);

            // Renumber all items
            const numberMap = generateItemNumbers(repairedItems);
            const payload = repairedItems.map((item: any, idx: number) => {
                const num = numberMap.get(item.id!) || `${idx + 1}`;
                const pid = item.parentId && String(item.parentId).trim() !== '' && String(item.parentId).trim().toLowerCase() !== 'null' ? String(item.parentId) : null;
                return { id: item.id!, order: item.order, parentId: pid, itemNumber: num };
            });

            try {
                await (supabase as any).rpc('reorder_budget_items', { items: payload });
            } catch (e) {
                console.error('Reorder after delete error:', e);
            }

            await loadBudget(true);
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

    // Sincroniza estado local do BDI quando o orçamento carregar ou atualizar pelo server
    useEffect(() => {
        if (budget?.bdi !== undefined) {
            setLocalBDI(budget.bdi.toString());
        }
        if (budget?.settings?.bdiEquipamento !== undefined) {
            setLocalBdiEquip(budget.settings.bdiEquipamento.toString());
        }
    }, [budget?.bdi, budget?.settings?.bdiEquipamento]);

    // Debounce para BDI
    useEffect(() => {
        const handler = setTimeout(() => {
            const val = parseFloat(localBDI);
            if (!isNaN(val) && val !== budget?.bdi && localBDI !== '' && budget != null) {
                handleUpdateBDI(val);
            }
        }, 800);
        return () => clearTimeout(handler);
    }, [localBDI, budget?.bdi]);

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

    // Fórmula multiplicativa TCU (Acórdão 2622/2013)
    const calcBDIFromState = (state: { ac: number; r: number; sg: number; df: number; l: number; i_pis: number; i_cofins: number; i_iss: number; i_cprb: number }) => {
        // AC + S + R são somados antes de virar fator (fórmula TCU)
        const acsr = (state.ac + state.sg + state.r) / 100;
        const DF = state.df / 100;
        const L = state.l / 100;
        const I = (state.i_pis + state.i_cofins + state.i_iss + (state.i_cprb ?? 0)) / 100;

        const numerador = (1 + acsr) * (1 + DF) * (1 + L);
        const denominador = (1 - I);

        const bdi = (numerador / denominador) - 1;
        return Math.round(bdi * 10000) / 100;
    };

    const calculateBDI = () => calcBDIFromState(bdiCalc);
    const calculateBDIEquip = () => calcBDIFromState(bdiEquipCalc);

    const getFaixaStatus = (bdi: number, faixa: { min: number; max: number } | null) => {
        if (!faixa) return null;
        if (bdi < faixa.min) return { label: 'Abaixo da faixa TCU', color: 'text-slate-400' };
        if (bdi > faixa.max) return { label: 'Acima da faixa TCU — justificativa necessária', color: 'text-orange-500' };
        return { label: 'Dentro da faixa TCU ✓', color: 'text-green-600' };
    };

    const handleApplyPreset = (key: PresetKey) => {
        const preset = BDI_PRESETS[key];
        setSelectedPresetKey(key);
        if (preset.obras) {
            setBdiCalc({
                ...bdiCalc,
                ac: preset.obras.ac,
                sg: preset.obras.sg,
                r: preset.obras.r,
                df: preset.obras.df,
                l: preset.obras.l,
                i_pis: preset.obras.pis,
                i_cofins: preset.obras.cofins,
                i_iss: preset.obras.iss,
                i_cprb: preset.obras.cprb
            });
        }
        setBdiEquipCalc({
            ...bdiEquipCalc,
            ac: preset.equipamentos.ac,
            sg: preset.equipamentos.sg,
            r: preset.equipamentos.r,
            df: preset.equipamentos.df,
            l: preset.equipamentos.l,
            i_pis: preset.equipamentos.pis,
            i_cofins: preset.equipamentos.cofins,
            i_iss: preset.equipamentos.iss,
            i_cprb: preset.equipamentos.cprb
        });
    };

    const handleApplyBDI = async () => {
        const val = calculateBDI();
        if (!budget) return;
        await BudgetService.update(budgetId, { bdi: Number(val.toFixed(2)) });
        setShowBDICalculator(false);
        loadBudget();
    };

    const handleApplyBDIEquip = async () => {
        const val = calculateBDIEquip();
        if (!budget) return;
        const newSettings = { ...(budget?.settings || {}), bdiEquipamento: Number(val.toFixed(2)) };
        await BudgetService.update(budgetId, { settings: newSettings });
        setBudget((prev: any) => ({ ...prev, settings: newSettings }));
        setLocalBdiEquip(val.toFixed(2));
    };

    const handleReorderItems = async () => {
        if (!items) return;
        setLoading(true);
        try {
            const sortedItems = [...items].sort((a, b) => (a.order || 0) - (b.order || 0));
            const repairedItems = repairHierarchy(sortedItems);
            const numberMap = generateItemNumbers(repairedItems);

            const payload = repairedItems.map((item, idx) => {
                const itemNumberStr = numberMap.get(item.id!) || `${idx + 1}`;
                const pid = item.parentId && String(item.parentId).trim() !== '' && String(item.parentId).trim().toLowerCase() !== 'null'
                    ? String(item.parentId)
                    : null;
                return {
                    id: item.id!,
                    order: idx + 1,
                    parentId: pid,
                    itemNumber: itemNumberStr,
                };
            });

            // Enviar em batches de 200 para evitar timeout
            const BATCH_SIZE = 200;
            for (let i = 0; i < payload.length; i += BATCH_SIZE) {
                const batch = payload.slice(i, i + BATCH_SIZE);
                const { error } = await (supabase as SupabaseClient<any>).rpc('reorder_budget_items', { items: batch });
                if (error) {
                    console.error(`Erro no batch ${Math.floor(i / BATCH_SIZE) + 1}:`, error);
                    throw error;
                }
            }

            await loadBudget();
            alert("Numeração e Ordem recalculadas com sucesso!");
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


    // ===========================================
    // DRAG AND DROP HANDLERS
    // ===========================================

    type ReorderRPCItem = {
        id: string;
        order: number;          // mapeia para budget_items.order_index no RPC
        parentId: string | null; // mapeia para budget_items.parent_id no RPC
        itemNumber: string;     // mapeia para budget_items.item_number no RPC
    };

    const handleDrop = async (e: React.DragEvent, dropIndex: number) => {
        e.preventDefault();
        if (isReordering) return;

        if (draggedItemIndex === null || draggedItemIndex === dropIndex || !items) {
            setDraggedItemIndex(null);
            setDragOverIndex(null);
            return;
        }

        // 1. Reordenar Array (Visual)
        const newItems = [...items];
        const [draggedItem] = newItems.splice(draggedItemIndex, 1);
        newItems.splice(dropIndex, 0, draggedItem);

        // 2. Reatribuir Order (Sequencial)
        newItems.forEach((item, index) => {
            item.order = index + 1;
        });

        // 3. Reparar Hierarquia (Corrigir Parent IDs baseado na nova ordem)
        // Isso garante que se moveu um item para dentro de outra etapa, ele assuma o pai correto
        const repairedItems = repairHierarchy(newItems);

        // 3.1 Validar invariantes de hierarquia (evita "ghost items")
        const invalid = repairedItems.find((it) => {
            // Level 1: MUST NOT have parent
            if (it.level === 1) return it.parentId != null;
            // Level >= 2: MUST HAVE parent
            if (it.level >= 2) return it.parentId == null;
            return false;
        });

        if (invalid) {
            console.warn("Drop inválido: item ficou sem pai após repairHierarchy", invalid);
            alert("Movimento inválido: um item ficou sem pai ou estrutura inconsistente.\n\nTente soltar dentro de uma etapa/sub-etapa válida.");

            // Recarrega SSOT para não deixar UI em estado estranho
            await loadBudget();
            setDraggedItemIndex(null);
            setDragOverIndex(null);
            return;
        }

        // 4. Renumerar (suporte a N níveis via generateItemNumbers)
        const numberMap = generateItemNumbers(repairedItems);

        // Preparar Payload para RPC
        const payload: ReorderRPCItem[] = repairedItems.map((item, idx) => {
            const itemNumberStr = numberMap.get(item.id!) || `${idx + 1}`;

            // Sanitize parentId to strict UUID or null
            const parentId =
                item.parentId && String(item.parentId).trim() !== "" && String(item.parentId).trim().toLowerCase() !== "null"
                    ? String(item.parentId)
                    : null;

            return {
                id: item.id!,
                order: item.order,
                parentId: parentId,
                itemNumber: itemNumberStr
            };
        });

        // 5. Persistência via RPC (Batch Optimization)
        try {
            setIsReordering(true);
            const { error } = await (supabase as SupabaseClient<any>).rpc("reorder_budget_items", {
                items: payload,
            });

            if (error) {
                console.error("RPC Error:", error);
                throw error;
            }

            // Reload garante SSOT do backend (cálculos, etc)
            await loadBudget();
        } catch (e) {
            console.error("Erro ao salvar ordem reorganizada:", e);
            alert("Erro ao salvar a nova ordem (RPC Failed).");
        } finally {
            setIsReordering(false);
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
                totalGlobalBase: totalBase,
                totalGlobalFinal: totalFinal
            };

            // BUG A FIX: Log de prova OBRIGATÓRIO
            console.log("[EXPORT TOTALS]", {
                base: totalBase,
                bdi: totalFinal - totalBase,
                total: totalFinal
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
                totalGlobalBase: totalBase,
                totalGlobalFinal: totalFinal
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

            await loadBudget(true);
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

        // Post-pass: Callculate rollup totals for groups (Sections N1, Groups N2)
        for (let i = adjustedItems.length - 1; i >= 0; i--) {
            const item = adjustedItems[i];
            const isGroup = item.type === 'group' || item.level === 1 || item.level === 2;

            if (isGroup) {
                let gTotalBase = 0;
                let gTotalFinal = 0;
                const myLevel = item.level;

                for (let j = i + 1; j < adjustedItems.length; j++) {
                    const child = adjustedItems[j];
                    if (child.level <= myLevel) break; // Reached next sibling or upper level

                    // Sum only leaves to avoid recursive double-counting
                    const childIsGroup = child.type === 'group' || child.level === 1 || child.level === 2;
                    if (!childIsGroup) {
                        gTotalBase += (child._amounts.totalPrice || 0);
                        gTotalFinal += (child._amounts.totalFinal || 0);
                    }
                }
                item._amounts.totalPrice = gTotalBase;
                item._amounts.totalFinal = gTotalFinal;
            }
        }

        return adjustedItems.map((item, idx) => {
            const isGroup = item.type === 'group' || item.level === 1 || item.level === 2;
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
                totalPrice: totalPrice,         // Group rollup works natively now
                finalPrice: itemTotalFinal,     // Group rollup works natively now

                total: itemTotalFinal, // Alias para legacy grids
                pesoRaw: pesoRaw
            };
        });
    }, [items, budget, adjustmentFactors]);

    // Totais Globais atualizados para Header (Baseados no visibleRows)
    // Totais Globais atualizados para Header (Baseados no visibleRows)
    const { totalBase, totalFinal } = useMemo(() => {
        // Use SSOT Utility
        const result = getAdjustedBudgetTotals(
            items, // Pass all items (utility filters leaves)
            budget?.settings?.global_adjustment_v2,
            budget?.bdi || 0
        );
        return { totalBase: result.totalBase, totalFinal: result.totalFinal };
    }, [items, budget?.bdi, JSON.stringify(budget?.settings?.global_adjustment_v2)]);


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
            if (!budget) return;

            // Busca itens frescos direto do banco
            const freshRawItems = await BudgetItemService.getByBudgetId(budgetId, { pageSize: 1000 });
            const freshOrganized = organizeHierarchy(freshRawItems);

            // Aplica os mesmos cálculos do visibleRows (adjustmentFactors + BDI)
            const { materialFactor, laborFactor, bdiFactor } = adjustmentFactors;
            let totalFinalAdj = 0;
            const freshAdjusted = freshOrganized.map(item => {
                const isGroup = item.type === 'group';
                const adjusted = getAdjustedItemValues(
                    { unitPrice: item.unitPrice || 0, description: item.description, type: item.type },
                    { materialFactor, laborFactor, bdiFactor },
                    budget.bdi || 0
                );
                const quantity = item.quantity || 0;
                const finalPrice = quantity * adjusted.finalPrice;
                if (!isGroup && item.level >= 3) totalFinalAdj += finalPrice;
                return { ...item, _adjusted: adjusted, _amounts: { unitPrice: adjusted.unitPrice, finalPrice: adjusted.finalPrice, totalPrice: quantity * adjusted.unitPrice, totalFinal: finalPrice } };
            });
            const freshRows = freshAdjusted.map((item, idx) => {
                const isGroup = item.type === 'group';
                const { unitPrice, finalPrice, totalPrice, totalFinal } = item._amounts;
                return {
                    ...item,
                    kind: isGroup ? 'GROUP' : 'ITEM',
                    itemNumber: item.hydrationDetails?.pathKey || item.itemNumber || getItemNumber(idx),
                    code: isGroup ? '' : (item.code || ''),
                    source: isGroup ? '' : (item.source || ''),
                    unit: isGroup ? '' : (item.unit || ''),
                    quantity: isGroup ? undefined : item.quantity,
                    unitPrice: isGroup ? undefined : unitPrice,
                    unitPriceWithBDI: isGroup ? undefined : finalPrice,
                    totalPrice: isGroup ? 0 : totalPrice,
                    finalPrice: isGroup ? 0 : totalFinal,
                    total: totalFinal,
                    pesoRaw: totalFinalAdj > 0 ? (totalFinal / totalFinalAdj) : 0
                };
            });

            // Importar funções de exportação
            const { exportPDFSynthetic, exportPDFAnalytic } = await import('../utils/budgetExport');

            // Flatten rows for export using freshRows (dados frescos, não visibleRows)
            const exportItems = await Promise.all(freshRows.map(async (row) => {
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
                totalGlobalBase: totalBase,
                totalGlobalFinal: totalFinal,
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
                totalGlobalBase: totalBase,
                totalGlobalFinal: totalFinal,
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
                totalGlobalBase: totalBase,
                totalGlobalFinal: totalFinal
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

            {/* Warning de Extração Parcial (UX Importação) */}
            {showPartialBanner && items && items.length > 0 && (
                <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-3 shrink-0 animate-in slide-in-from-top-2 relative z-30">
                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 max-w-7xl mx-auto">
                        <div className="flex items-start gap-3">
                            <div className="p-2 bg-yellow-100 rounded-lg text-yellow-700 shrink-0 mt-0.5 md:mt-0">
                                <AlertTriangle size={18} />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-yellow-800">Extração parcial do documento</h3>
                                <p className="text-xs text-yellow-700 mt-0.5 leading-relaxed max-w-2xl">
                                    Este orçamento foi gerado automaticamente, mas nem todos os itens do arquivo foram identificados com 100% de precisão.
                                    Os valores podem estar subestimados.
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 w-full md:w-auto pl-11 md:pl-0">
                            <button
                                onClick={handleDismissPartialBanner}
                                className="px-3 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 hover:bg-yellow-100/50 rounded-lg transition-colors"
                            >
                                Revisar manualmente
                            </button>
                            {sourceJob?.id && (
                                <Link
                                    to={`/importacoes/${sourceJob.id}`}
                                    className="px-4 py-2 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 text-xs font-black rounded-lg transition-colors shadow-sm flex items-center gap-2 whitespace-nowrap"
                                >
                                    Melhorar extração (OCR)
                                </Link>
                            )}
                        </div>
                    </div>
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
                                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalFinal)}
                                    </p>
                                    <span className="text-[10px] font-bold text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded">
                                        + {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalFinal - totalBase)} (BDI)
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
                                {FEATURES.excelExport && (
                                    <button
                                        onClick={() => handleExportExcel('synthetic')}
                                        className="w-10 h-10 flex items-center justify-center bg-green-600 text-white rounded-lg shadow-sm active:scale-95 transition-transform"
                                        title="Excel Sintético"
                                    >
                                        <FileSpreadsheet size={18} />
                                    </button>
                                )}
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
                                            value={localBDI}
                                            onChange={(e) => setLocalBDI(e.target.value)}
                                            onBlur={(e) => {
                                                const val = parseFloat(localBDI);
                                                if (!isNaN(val) && val !== budget?.bdi && localBDI !== '') {
                                                    handleUpdateBDI(val);
                                                }
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    const val = parseFloat(localBDI);
                                                    if (!isNaN(val) && val !== budget?.bdi && localBDI !== '') {
                                                        handleUpdateBDI(val);
                                                    }
                                                    (e.target as HTMLInputElement).blur();
                                                }
                                            }}
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
                                <div className="text-center px-2 border-r border-slate-200">
                                    <label className="text-[9px] text-orange-500 font-bold uppercase block">BDI Equip.</label>
                                    <div className="flex items-center justify-center gap-0.5 whitespace-nowrap">
                                        <input
                                            type="number"
                                            value={localBdiEquip}
                                            onChange={(e) => setLocalBdiEquip(e.target.value)}
                                            onBlur={(e) => {
                                                const val = parseFloat(localBdiEquip);
                                                if (!isNaN(val) && val !== budget?.settings?.bdiEquipamento && localBdiEquip !== '') {
                                                    const newSettings = { ...(budget?.settings || {}), bdiEquipamento: val };
                                                    BudgetService.update(budgetId, { settings: newSettings }).then(() => {
                                                        setBudget((prev: any) => ({ ...prev, settings: newSettings }));
                                                    });
                                                }
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    const val = parseFloat(localBdiEquip);
                                                    if (!isNaN(val) && val !== budget?.settings?.bdiEquipamento && localBdiEquip !== '') {
                                                        const newSettings = { ...(budget?.settings || {}), bdiEquipamento: val };
                                                        BudgetService.update(budgetId, { settings: newSettings }).then(() => {
                                                            setBudget((prev: any) => ({ ...prev, settings: newSettings }));
                                                        });
                                                    }
                                                    (e.target as HTMLInputElement).blur();
                                                }
                                            }}
                                            placeholder="Auto"
                                            className="w-14 text-center text-sm font-bold text-slate-700 bg-transparent outline-none focus:ring-1 focus:ring-orange-400 rounded transition-all placeholder-slate-300"
                                        />
                                        <span className="text-xs text-slate-400 font-bold">%</span>
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



                            {/* Seção Direita: Totais Corrigidos + Badge de Hidratação */}
                            <div className="flex flex-col gap-2 shrink-0">
                                <div className="grid grid-cols-3 gap-0 bg-gradient-to-r from-slate-50 to-blue-50/50 rounded-lg border border-slate-200 overflow-hidden shadow-sm">
                                    <div className="text-right border-r border-slate-200 p-2 min-w-[90px]">
                                        <span className="text-[9px] text-slate-400 uppercase block font-black leading-none mb-1">Custo Total</span>
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
                                        <span className="text-[9px] text-accent uppercase block font-black leading-none mb-1">Total Geral</span>
                                        <span className="text-sm font-black text-primary block">
                                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalFinal)}
                                        </span>
                                    </div>
                                </div>

                                {/* Badge de Completude (Phase 3) */}
                                <button onClick={() => setShowPendencyPanel(true)} className="hover:opacity-80 transition-opacity text-left">
                                    <BudgetCompletenessBadge budgetId={budgetId} />
                                </button>

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
                                        {FEATURES.excelExport && (
                                            <>
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
                                            </>
                                        )}
                                        <button onClick={() => setShowABC(true)} className="w-full text-left px-4 py-2 text-xs text-slate-600 hover:bg-slate-50 hover:text-orange-600 flex items-center gap-2">
                                            <BarChart size={14} /> Curva ABC
                                        </button>
                                        <div className="h-px bg-slate-100 my-1"></div>
                                        {FEATURES.excelExport && (
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
                                        )}
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
                                                try {
                                                    const ids = Array.from(selectedItemIds);
                                                    // Delete items
                                                    await BudgetItemService.batchDelete(ids);
                                                    // Delete related compositions (best effort, ideally DB cascade)
                                                    for (const itId of ids) {
                                                        await BudgetItemCompositionService.deleteByBudgetItemId(itId);
                                                    }
                                                    // Reload data
                                                    await loadBudget(true);
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
                                onClick={() => { setInsertContext(null); setIsAddingItem(true); }}
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
                        <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">Bases:</span>
                            {(budget?.settings?.bases_selecionadas || ['SINAPI']).map((base: string) => (
                                <span
                                    key={base}
                                    className="bg-blue-100 text-blue-700 text-[10px] font-bold px-2 py-0.5 rounded-full"
                                >
                                    {base}
                                    {budget?.settings?.bases_refs?.[base] && (
                                        <span className="ml-1 text-blue-500 font-normal">
                                            {budget.settings.bases_refs[base]}
                                        </span>
                                    )}
                                </span>
                            ))}
                            <div className="relative">
                                <button
                                    onClick={() => setShowBaseSelector(!showBaseSelector)}
                                    className="text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-full p-0.5 transition-colors"
                                    title="Adicionar ou remover bases"
                                >
                                    <Plus size={14} />
                                </button>
                                {showBaseSelector && (
                                    <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl p-3 z-[100] min-w-[260px]">
                                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Selecionar Bases</p>
                                        {['SINAPI', 'SICRO', 'ORSE', 'EMBASA', 'COELBA', 'SUDEB', 'SEINFRA-BA', 'SEINFRA-CE', 'CPOS', 'FDE', 'EMOP', 'SUDECAP', 'SETOP', 'IOPES'].map(base => {
                                            const isActive = (budget?.settings?.bases_selecionadas || ['SINAPI']).includes(base);
                                            const isSeinfra = base.startsWith('SEINFRA');
                                            const currentRef = budget?.settings?.bases_refs?.[base] || (isSeinfra ? '028' : '2025-01');
                                            return (
                                                <div key={base} className="flex items-center gap-2 py-1 px-1 rounded hover:bg-slate-50">
                                                    <label className="flex items-center gap-2 cursor-pointer flex-1">
                                                        <input
                                                            type="checkbox"
                                                            checked={isActive}
                                                            onChange={async () => {
                                                                const currentBases: string[] = budget?.settings?.bases_selecionadas || ['SINAPI'];
                                                                const currentRefs = budget?.settings?.bases_refs || {};
                                                                let newBases: string[];
                                                                let newRefs = { ...currentRefs };
                                                                if (isActive) {
                                                                    newBases = currentBases.filter((b: string) => b !== base);
                                                                    delete newRefs[base];
                                                                } else {
                                                                    newBases = [...currentBases, base];
                                                                    newRefs[base] = currentRef;
                                                                }
                                                                const newSettings = {
                                                                    ...budget.settings,
                                                                    bases_selecionadas: newBases,
                                                                    bases_refs: newRefs
                                                                };
                                                                await BudgetService.update(budget.id, { settings: newSettings });
                                                                await loadBudget(true);
                                                            }}
                                                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                                        />
                                                        <span className={clsx("text-xs font-medium", isActive ? "text-blue-700" : "text-slate-600")}>{base}</span>
                                                    </label>
                                                    {isActive && (
                                                        isSeinfra ? (
                                                            <select
                                                                value={currentRef}
                                                                onChange={async (e) => {
                                                                    const newRefs = { ...budget?.settings?.bases_refs, [base]: e.target.value };
                                                                    const newSettings = { ...budget.settings, bases_refs: newRefs };
                                                                    await BudgetService.update(budget.id, { settings: newSettings });
                                                                    await loadBudget(true);
                                                                }}
                                                                className="text-[10px] border border-slate-200 rounded px-1 py-0.5 bg-white text-slate-600 w-16"
                                                            >
                                                                {['028', '027', '026', '025', '024'].map(v => (
                                                                    <option key={v} value={v}>{v}</option>
                                                                ))}
                                                            </select>
                                                        ) : (
                                                            <input
                                                                type="month"
                                                                value={currentRef}
                                                                onChange={async (e) => {
                                                                    const newRefs = { ...budget?.settings?.bases_refs, [base]: e.target.value };
                                                                    const newSettings = { ...budget.settings, bases_refs: newRefs };
                                                                    await BudgetService.update(budget.id, { settings: newSettings });
                                                                    await loadBudget(true);
                                                                }}
                                                                className="text-[10px] border border-slate-200 rounded px-1 py-0.5 bg-white text-slate-600 w-24"
                                                            />
                                                        )
                                                    )}
                                                </div>
                                            );
                                        })}
                                        <button
                                            onClick={() => setShowBaseSelector(false)}
                                            className="mt-2 w-full text-center text-[10px] text-slate-400 hover:text-slate-600 py-1 border-t border-slate-100 pt-2"
                                        >
                                            Fechar
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => {
                                    const summary = getExecutiveSummary();
                                    const text = summary.map((s: any) => `${s.name}: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(s.value)}`).join('\n');
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
                                            <div className="flex items-center gap-2 w-full pr-2">
                                                <span className="text-xs font-mono text-slate-400 shrink-0">{hierarchicalNumber}</span>
                                                {editingInlineId === item.id ? (
                                                    <input
                                                        autoFocus
                                                        className="font-bold uppercase text-sm bg-transparent border-b border-blue-400 outline-none w-full min-w-0"
                                                        value={editingInlineText}
                                                        onChange={e => setEditingInlineText(e.target.value)}
                                                        onBlur={() => handleInlineEditSave(item.id!, editingInlineText)}
                                                        onKeyDown={e => {
                                                            if (e.key === 'Enter') handleInlineEditSave(item.id!, editingInlineText);
                                                            if (e.key === 'Escape') setEditingInlineId(null);
                                                        }}
                                                        onFocus={e => e.target.select()}
                                                    />
                                                ) : (
                                                    <span
                                                        className="font-bold uppercase text-sm truncate cursor-text hover:bg-black/5 rounded transition-colors px-1 w-full relative group/inline"
                                                        onDoubleClick={() => {
                                                            setEditingInlineText(item.description);
                                                            setEditingInlineId(item.id!);
                                                        }}
                                                        title="Duplo clique para editar"
                                                    >
                                                        {item.description}
                                                        <span className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover/inline:opacity-100 text-slate-400 pointer-events-none transition-opacity">
                                                            <Edit2 size={12} />
                                                        </span>
                                                    </span>
                                                )}
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
                    <table className="w-full text-left border-collapse table-auto border border-slate-400">
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
                                <th className="p-1 w-[70px] min-w-[70px] text-center border-r border-slate-300">Código</th>
                                <th className="p-1 w-auto text-center border-r border-slate-300">Descrição</th>
                                <th className="p-1 w-[90px] min-w-[90px] max-w-[90px] text-center border-r border-slate-300">Quant.</th>
                                <th className="p-1 w-[80px] min-w-[80px] max-w-[80px] text-center border-r border-slate-300">Und</th>
                                <th className="p-1 w-[80px] text-center border-r border-slate-300">V. Unit</th>
                                <th className="p-1 w-[80px] text-center border-r border-slate-300 bg-slate-50 font-bold">V. Unit (BDI)</th>
                                <th className="p-1 w-[120px] text-center border-r border-slate-300 font-black">Total</th>
                                <th className="p-1 w-[50px] text-center border-r border-slate-300">Peso</th>
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
                                const isNivel3Group = item.level === 3 && item.type === 'group'; // Subgrupo dentro de subgrupo
                                const isItem = item.rowType === 'item' || (!isNivel1 && !isNivel2 && !isNivel3Group);

                                // Aplicar cores de fundo
                                const rowBg = isNivel1
                                    ? "bg-[#1e3a8a] text-white"        // Azul Escuro (N1)
                                    : isNivel2
                                        ? "bg-[#dbeafe] text-blue-900" // Azul Claro (N2)
                                        : isNivel3Group
                                            ? "bg-[#eff6ff] text-blue-800" // Azul muito claro (N3 grupo)
                                            : "bg-white hover:bg-slate-50"; // Branco (Item)

                                // Estilo do texto da descrição
                                const textStyle = isNivel1
                                    ? "font-black uppercase tracking-wide text-[12px]"  // N1
                                    : isNivel2
                                        ? "font-bold uppercase text-[11px]"             // N2
                                        : isNivel3Group
                                            ? "font-semibold text-[11px] pl-4"         // N3 grupo — indentado
                                            : "font-normal text-slate-700";            // Item real

                                return (
                                    <Fragment key={item.id}>
                                        <tr
                                            id={`item-${item.id}`}
                                            onDragOver={(e) => handleDragOver(e, index)}
                                            onDrop={(e) => handleDrop(e, index)}
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

                                            {/* Drag Handle */}
                                            <td className="p-0 text-center border-r border-slate-300">
                                                <div
                                                    className="flex items-center justify-center h-full w-full cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600"
                                                    draggable={!isMobile}
                                                    onDragStart={(e) => handleDragStart(e, index)}
                                                    onDragEnd={() => setDragOverIndex(null)}
                                                >
                                                    <GripVertical size={14} className="opacity-50 group-hover:opacity-100 transition-opacity" />
                                                </div>
                                            </td>

                                            {/* Item Number */}
                                            <td
                                                className={clsx(
                                                    "p-1 px-2 text-center border-r border-slate-300 font-mono font-bold whitespace-nowrap cursor-grab active:cursor-grabbing",
                                                    isNivel1 ? "text-white border-r-blue-700" : isNivel2 ? "text-blue-900" : "text-slate-700"
                                                )}
                                            >
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
                                                        {item.source === 'AI_EXTRACTED_CODE' ? 'IA'
                                                            : item.source === 'IMPORTADO' ? 'IMP'
                                                                : item.source === 'OWN' ? 'Próprio'
                                                                    : item.source || '-'}
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
                                            <td className="p-1 border-r border-slate-300 relative group/desc w-auto align-top">
                                                <div className={clsx(
                                                    "w-full min-h-[1.75rem] py-1",
                                                    item.hydrationStatus === 'pending_review' && "pr-[90px]" // Espaço para o botão Vincular absoluto
                                                )}>
                                                    {!isGroup && !item.isLocked ? (
                                                        <span
                                                            className={clsx(
                                                                "cursor-pointer hover:underline whitespace-normal break-words block w-full leading-snug",
                                                                textStyle,
                                                                isNivel2 && "pl-6", // Indent Level 2
                                                                isItem && "pl-10"   // Indent Level 3
                                                            )}
                                                            style={{ whiteSpace: 'normal', overflowWrap: 'break-word', wordBreak: 'break-word' }}
                                                            onClick={() => handleStartEdit(item)}
                                                        >
                                                            {item.description}
                                                        </span>
                                                    ) : editingInlineId === item.id ? (
                                                        <input
                                                            autoFocus
                                                            className={clsx(
                                                                "bg-transparent border-b border-blue-400 outline-none w-full text-slate-900",
                                                                textStyle,
                                                                isNivel2 && "ml-6",
                                                                isItem && "ml-10"
                                                            )}
                                                            value={editingInlineText}
                                                            onChange={e => setEditingInlineText(e.target.value)}
                                                            onBlur={() => handleInlineEditSave(item.id!, editingInlineText)}
                                                            onKeyDown={e => {
                                                                if (e.key === 'Enter') handleInlineEditSave(item.id!, editingInlineText);
                                                                if (e.key === 'Escape') setEditingInlineId(null);
                                                            }}
                                                            onFocus={e => e.target.select()}
                                                        />
                                                    ) : (
                                                        <span className={clsx(
                                                            "whitespace-normal break-words block w-full transition-colors relative group/inline leading-snug",
                                                            (isGroup || item.level === 1 || item.level === 2)
                                                                ? "cursor-text hover:bg-black/10 rounded"
                                                                : "",
                                                            textStyle,
                                                            isNivel2 && "pl-6",
                                                            isItem && "pl-10"
                                                        )}
                                                            style={{ whiteSpace: 'normal', overflowWrap: 'break-word', wordBreak: 'break-word' }}
                                                            onDoubleClick={() => {
                                                                if (isGroup || item.level === 1 || item.level === 2) {
                                                                    setEditingInlineText(item.description);
                                                                    setEditingInlineId(item.id!);
                                                                }
                                                            }}
                                                            title={(isGroup || item.level === 1 || item.level === 2) ? "Duplo clique para editar" : ""}
                                                        >
                                                            {item.description}
                                                            {(isGroup || item.level === 1 || item.level === 2) && (
                                                                <span className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover/inline:opacity-100 text-blue-400 pointer-events-none transition-opacity">
                                                                    <Edit2 size={12} />
                                                                </span>
                                                            )}
                                                        </span>
                                                    )}


                                                    {/* CTA: Vincular Composição (Quando Pendente) */}
                                                    {item.hydrationStatus === 'pending_review' && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setBindingItem(item);
                                                                setAddItemTab('CPU');
                                                                setSearchTerm(item.code || '');
                                                                setIsAddingItem(true);
                                                            }}
                                                            className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 bg-amber-100 hover:bg-amber-200 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded border border-amber-300 transition-colors animate-pulse z-20"
                                                            title="Este item foi importado mas não possui composição vinculada. Clique para selecionar uma composição."
                                                        >
                                                            <AlertTriangle size={10} /> Vincular
                                                        </button>
                                                    )}
                                                </div>

                                                {validatePriceRange(item) !== 'normal' && !isGroup && (
                                                    <div className="absolute right-1 top-1 text-orange-500">
                                                        <AlertOctagon size={10} />
                                                    </div>
                                                )}

                                                {/* Menu Flutuante de Ações */}
                                                <div className="absolute right-0 top-1/2 -translate-y-1/2 bg-white shadow-xl border border-slate-200 rounded flex items-center py-1 px-1 gap-0.5 opacity-0 group-hover:opacity-100 transition-all z-50 whitespace-nowrap text-slate-600 hidden group-hover:flex">
                                                    {/* Inserção Estrutural: Etapa e Sub-etapa */}
                                                    {(!item.code && item.type === 'group') && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleStartInlineInsert('etapa', index, item.parentId || null);
                                                            }}
                                                            className="flex flex-col items-center justify-center px-1.5 hover:bg-indigo-50 rounded py-1 min-w-[50px] text-indigo-600"
                                                        >
                                                            <ListOrdered size={13} className="mb-0.5" />
                                                            <span className="text-[9px] font-bold">Etapa</span>
                                                        </button>
                                                    )}
                                                    {(!item.code && item.type === 'group') && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleStartInlineInsert('subetapa', index, item.id || null);
                                                            }}
                                                            className="flex flex-col items-center justify-center px-1.5 hover:bg-sky-50 rounded py-1 min-w-[50px] text-sky-600"
                                                        >
                                                            <ChevronDown size={13} className="mb-0.5" />
                                                            <span className="text-[9px] font-bold">Subetapa</span>
                                                        </button>
                                                    )}
                                                    {(isNivel1 || isNivel2) && (
                                                        <div className="w-[1px] h-6 bg-slate-200 mx-0.5"></div>
                                                    )}
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setInlineSearch({
                                                                afterIndex: index,
                                                                parentId: isGroup ? item.id : item.parentId,
                                                                type: 'CPU'
                                                            });
                                                            setInlineSearchTerm('');
                                                            setInlineSearchResults([]);
                                                            setTimeout(() => inlineSearchRef.current?.focus(), 100);
                                                        }}
                                                        className="flex flex-col items-center justify-center px-1.5 hover:bg-slate-100 rounded py-1 min-w-[50px]"
                                                    >
                                                        <Database size={13} className="text-slate-700 mb-0.5" />
                                                        <span className="text-[9px] font-bold">Composição</span>
                                                    </button>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setInlineSearch({
                                                                afterIndex: index,
                                                                parentId: isGroup ? item.id : item.parentId,
                                                                type: 'INS'
                                                            });
                                                            setInlineSearchTerm('');
                                                            setInlineSearchResults([]);
                                                            setTimeout(() => inlineSearchRef.current?.focus(), 100);
                                                        }}
                                                        className="flex flex-col items-center justify-center px-1.5 hover:bg-slate-100 rounded py-1 min-w-[50px]"
                                                    >
                                                        <Box size={13} className="text-slate-700 mb-0.5" />
                                                        <span className="text-[9px] font-bold">Insumo</span>
                                                    </button>

                                                    <div className="w-[1px] h-6 bg-slate-200 mx-0.5"></div>

                                                    {!isGroup && !item.isLocked && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleStartEdit(item); }}
                                                            className="flex flex-col items-center justify-center px-1.5 hover:bg-slate-100 rounded py-1 min-w-[50px] text-slate-500 hover:text-green-600"
                                                        >
                                                            <Edit2 size={13} className="mb-0.5" />
                                                            <span className="text-[9px] font-bold">Editar</span>
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleToggleLock(item); }}
                                                        className={clsx("flex flex-col items-center justify-center px-1.5 hover:bg-slate-100 rounded py-1 min-w-[50px]", item.isLocked ? "text-amber-500" : "text-slate-500")}
                                                    >
                                                        {item.isLocked ? <Lock size={13} className="mb-0.5" /> : <Unlock size={13} className="mb-0.5" />}
                                                        <span className="text-[9px] font-bold">{item.isLocked ? "Desbloq." : "Bloquear"}</span>
                                                    </button>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleDuplicateItem(item); }}
                                                        className="flex flex-col items-center justify-center px-1.5 hover:bg-slate-100 rounded py-1 min-w-[50px] text-slate-500 hover:text-blue-600"
                                                    >
                                                        <Copy size={13} className="mb-0.5" />
                                                        <span className="text-[9px] font-bold">Duplicar</span>
                                                    </button>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleDeleteItem(item.id!); }}
                                                        className="flex flex-col items-center justify-center px-1.5 hover:bg-red-50 rounded py-1 text-slate-500 hover:text-red-500 min-w-[50px]"
                                                    >
                                                        <Trash2 size={13} className="mb-0.5" />
                                                        <span className="text-[9px] font-bold">Excluir</span>
                                                    </button>
                                                </div>
                                            </td>

                                            {/* Quantidade — duplo clique para editar */}
                                            <td
                                                className={clsx(
                                                    "p-1 text-right border-r border-slate-300 font-mono px-2 w-[90px] min-w-[90px] max-w-[90px]",
                                                    isNivel1 ? "text-white" : "text-slate-700",
                                                    !isGroup && !item.isLocked && "cursor-pointer hover:bg-blue-50"
                                                )}
                                                onDoubleClick={() => {
                                                    if (!isGroup && !item.isLocked) {
                                                        setEditingQuantity({
                                                            itemId: item.id!,
                                                            value: String(item.quantity ?? 0)
                                                        });
                                                    }
                                                }}
                                            >
                                                {!isGroup ? (
                                                    editingQuantity && editingQuantity.itemId === item.id ? (
                                                        <input
                                                            type="text"
                                                            autoFocus
                                                            value={editingQuantity.value}
                                                            onChange={(e) => setEditingQuantity({ ...editingQuantity, value: e.target.value })}
                                                            onBlur={async () => {
                                                                const newQty = parseFloat(editingQuantity.value.replace(',', '.'));
                                                                if (!isNaN(newQty) && newQty !== item.quantity) {
                                                                    await BudgetItemService.update(item.id!, { quantity: newQty });
                                                                    await loadBudget(true);
                                                                }
                                                                setEditingQuantity(null);
                                                            }}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') {
                                                                    (e.target as HTMLInputElement).blur();
                                                                }
                                                                if (e.key === 'Escape') {
                                                                    setEditingQuantity(null);
                                                                }
                                                            }}
                                                            className="w-full text-right text-xs font-mono border border-blue-400 rounded px-1 py-0.5 focus:ring-2 focus:ring-blue-400 focus:outline-none bg-white"
                                                        />
                                                    ) : (
                                                        new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(item.quantity)
                                                    )
                                                ) : ''}
                                            </td>

                                            {/* Unidade */}
                                            <td className={clsx(
                                                "p-1 text-center border-r border-slate-300 w-[80px] min-w-[80px] max-w-[80px]",
                                                isNivel1 ? "text-white/70" : "text-slate-500"
                                            )}>
                                                <div className="truncate w-full px-1" title={!isGroup ? (item.unit || '') : ''}>
                                                    {!isGroup && (item.unit || '-')}
                                                </div>
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
                                                "p-1 text-right border-r border-slate-300 font-mono font-bold px-2 relative",
                                                isNivel1 ? "text-white bg-white/10" : "text-indigo-600 bg-indigo-50/30"
                                            )}>
                                                <div className="flex items-center justify-end gap-1">
                                                    {!isGroup && item.customBDI != null && item.customBDI > 0 && item.customBDI !== budget?.bdi ? (
                                                        <span className="text-[8px] bg-orange-100 text-orange-700 px-1 rounded whitespace-nowrap border border-orange-200" title="BDI Diferenciado">
                                                            {item.customBDI.toFixed(2)}%
                                                        </span>
                                                    ) : null}
                                                    {!isGroup ? new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(unitPriceWithBDI) : ''}
                                                </div>
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
                                        </tr>
                                        {inlineInsert && inlineInsert.afterIndex === index && (
                                            <tr className="border-b border-blue-300 bg-blue-50">
                                                <td className="p-1 text-center border-r border-blue-200"></td>
                                                <td className="p-1 text-center border-r border-blue-200"></td>
                                                <td className="p-1 text-center border-r border-blue-200 font-mono text-blue-600 font-bold text-[11px]">
                                                    {inlineInsert.provisionalNumber}
                                                </td>
                                                <td className="p-1 border-r border-blue-200"></td>
                                                <td className="p-1 border-r border-blue-200"></td>
                                                <td className="p-1 border-r border-blue-200">
                                                    <div className="flex items-center gap-2">
                                                        <div className="text-[10px] text-blue-500 font-medium text-center w-6">
                                                            {inlineInsert.type === 'etapa' ? 'N1' : 'N2'}
                                                        </div>
                                                        <input
                                                            ref={inlineInsertRef}
                                                            type="text"
                                                            value={inlineInsertText}
                                                            onChange={(e) => setInlineInsertText(e.target.value)}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') {
                                                                    e.preventDefault();
                                                                    handleConfirmInlineInsert();
                                                                } else if (e.key === 'Escape') {
                                                                    e.preventDefault();
                                                                    handleCancelInlineInsert();
                                                                }
                                                            }}
                                                            placeholder="Descrição..."
                                                            className="flex-1 bg-white border border-blue-300 rounded px-2 py-1 text-[11px] font-bold uppercase focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                                                            autoFocus
                                                        />
                                                        <button
                                                            onClick={handleConfirmInlineInsert}
                                                            className="p-1 rounded hover:bg-green-100 text-green-600 transition-colors"
                                                            title="Confirmar (Enter)"
                                                        >
                                                            <Check size={16} />
                                                        </button>
                                                        <button
                                                            onClick={handleCancelInlineInsert}
                                                            className="p-1 rounded hover:bg-red-100 text-red-500 transition-colors"
                                                            title="Cancelar (Esc)"
                                                        >
                                                            <X size={16} />
                                                        </button>
                                                    </div>
                                                </td>
                                                <td className="p-1 border-r border-blue-200 text-center text-blue-400 text-[10px]">—</td>
                                                <td className="p-1 border-r border-blue-200 text-center text-blue-400 text-[10px]">—</td>
                                                <td className="p-1 border-r border-blue-200 text-center text-blue-400 text-[10px]">—</td>
                                                <td className="p-1 border-r border-blue-200 text-center text-blue-400 text-[10px]">—</td>
                                                <td className="p-1 border-r border-blue-200 text-center text-blue-400 text-[10px]">—</td>
                                                <td className="p-1 border-r border-blue-200 text-center text-blue-400 text-[10px]">—</td>
                                            </tr>
                                        )}
                                        {inlineSearch && inlineSearch.afterIndex === index && (
                                            <tr className="bg-amber-50/80 border-b border-amber-200 animate-in fade-in slide-in-from-top-1">
                                                <td colSpan={2} className="px-2 py-2">
                                                    <span className={clsx(
                                                        "text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full",
                                                        inlineSearch.type === 'CPU'
                                                            ? "bg-amber-100 text-amber-700"
                                                            : "bg-blue-100 text-blue-700"
                                                    )}>
                                                        {inlineSearch.type === 'CPU' ? 'Composição' : 'Insumo'}
                                                    </span>
                                                </td>
                                                <td colSpan={8} className="px-2 py-2">
                                                    <div className="relative">
                                                        <input
                                                            ref={inlineSearchRef}
                                                            type="text"
                                                            value={inlineSearchTerm}
                                                            onChange={(e) => setInlineSearchTerm(e.target.value)}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Escape') {
                                                                    setInlineSearch(null);
                                                                    setInlineSearchTerm('');
                                                                    setInlineSearchResults([]);
                                                                }
                                                            }}
                                                            placeholder="Digite código ou descrição (min. 3 caracteres)..."
                                                            className="w-full text-xs border border-amber-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-amber-400 focus:border-amber-400 bg-white"
                                                        />
                                                        {inlineSearchLoading && (
                                                            <div className="absolute right-2 top-1/2 -translate-y-1/2">
                                                                <div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin"></div>
                                                            </div>
                                                        )}
                                                        {inlineSearchResults.length > 0 && (
                                                            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-[200] max-h-[240px] overflow-y-auto">
                                                                {inlineSearchResults.map((res: any, i: number) => (
                                                                    <button
                                                                        key={res.code + '-' + i}
                                                                        onClick={async () => {
                                                                            try {
                                                                                const targetParentId = inlineSearch.parentId;
                                                                                const itemData: any = {
                                                                                    budgetId: budgetId,
                                                                                    order: getNextOrder(),
                                                                                    level: 3,
                                                                                    parentId: targetParentId,
                                                                                    itemNumber: '',
                                                                                    code: res.code || '',
                                                                                    description: res.description || '',
                                                                                    unit: res.unit || 'UN',
                                                                                    quantity: 1,
                                                                                    unitPrice: res.price ?? 0,
                                                                                    type: res.originalType || (inlineSearch.type === 'CPU' ? 'service' : 'material'),
                                                                                    source: res.source || 'SINAPI',
                                                                                    itemType: inlineSearch.type === 'CPU' ? 'composicao' : 'insumo',
                                                                                    compositionId: inlineSearch.type === 'CPU' ? (res.id || res.raw?.id) : null,
                                                                                    insumoId: inlineSearch.type === 'INS' ? (res.id || res.raw?.id) : null,
                                                                                };
                                                                                const newItem = await BudgetItemService.create(itemData);
                                                                                if (newItem && items) {
                                                                                    const newItems = [...items];
                                                                                    newItems.splice(inlineSearch.afterIndex + 1, 0, newItem);
                                                                                    newItems.forEach((it, idx) => { it.order = idx + 1; });
                                                                                    const repairedItems = repairHierarchy(newItems);
                                                                                    const numberMap = generateItemNumbers(repairedItems);
                                                                                    const payload = repairedItems.map((item: any, idx: number) => {
                                                                                        const num = numberMap.get(item.id!) || `${idx + 1}`;
                                                                                        const pid = item.parentId && String(item.parentId).trim() !== '' && String(item.parentId).trim().toLowerCase() !== 'null' ? String(item.parentId) : null;
                                                                                        return { id: item.id!, order: item.order, parentId: pid, itemNumber: num };
                                                                                    });
                                                                                    await (supabase as any).rpc('reorder_budget_items', { items: payload });
                                                                                }
                                                                                await loadBudget(true);
                                                                            } catch (e: any) {
                                                                                console.error('[inlineSearch] add error:', e);
                                                                                alert('Erro ao adicionar item: ' + (e.message || ''));
                                                                            } finally {
                                                                                setLoading(false);
                                                                                setInlineSearch(null);
                                                                                setInlineSearchTerm('');
                                                                                setInlineSearchResults([]);
                                                                            }
                                                                        }}
                                                                        className="w-full text-left px-3 py-2 hover:bg-amber-50 border-b border-slate-100 last:border-0 flex items-center gap-3 transition-colors"
                                                                    >
                                                                        <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded shrink-0">
                                                                            {res.code}
                                                                        </span>
                                                                        <span className="text-xs text-slate-700 line-clamp-1 flex-1">
                                                                            {res.description}
                                                                        </span>
                                                                        {res.price != null && (
                                                                            <span className="text-xs font-bold text-green-700 shrink-0">
                                                                                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(res.price)}
                                                                            </span>
                                                                        )}
                                                                        <span className="text-[8px] text-slate-400 uppercase shrink-0">
                                                                            {res.source || res.base}
                                                                        </span>
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        )}
                                                        {inlineSearchTerm.length >= 3 && !inlineSearchLoading && inlineSearchResults.length === 0 && (
                                                            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-[200] p-3 text-center">
                                                                <p className="text-xs text-slate-400">Nenhum resultado encontrado</p>
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                                <td colSpan={2} className="px-2 py-2 text-right">
                                                    <div className="flex items-center gap-1 justify-end">
                                                        <button
                                                            onClick={() => {
                                                                setInsertContext({
                                                                    parentId: inlineSearch.parentId,
                                                                    afterIndex: inlineSearch.afterIndex
                                                                });
                                                                setAddItemTab(inlineSearch.type);
                                                                setSearchTerm('');
                                                                setIsAddingItem(true);
                                                                setInlineSearch(null);
                                                                setInlineSearchTerm('');
                                                                setInlineSearchResults([]);
                                                            }}
                                                            className="text-[9px] text-slate-400 hover:text-blue-600 px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                                                            title="Abrir busca avançada"
                                                        >
                                                            Avançada
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                setInlineSearch(null);
                                                                setInlineSearchTerm('');
                                                                setInlineSearchResults([]);
                                                            }}
                                                            className="text-slate-400 hover:text-red-500 p-1 rounded hover:bg-red-50 transition-colors"
                                                            title="Cancelar"
                                                        >
                                                            <X size={14} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </Fragment>
                                );
                            })}
                            {items?.length === 0 && (
                                <tr>
                                    <td colSpan={12} className="py-20 text-center text-slate-400 bg-slate-50/30">
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
                                <td colSpan={12} className="p-0">
                                    <div className="flex justify-end p-6 bg-slate-50">
                                        <div className="w-full max-w-[420px] space-y-3">
                                            {/* Custo Total */}
                                            <div className="flex justify-between items-center text-slate-500 font-bold uppercase tracking-widest text-[11px]">
                                                <span>Custo Total:</span>
                                                <span className="font-mono text-sm text-slate-700">
                                                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalBase)}
                                                </span>
                                            </div>

                                            {/* Valor BDI */}
                                            <div className="flex justify-between items-center text-indigo-600 font-bold uppercase tracking-widest text-[11px] py-2 border-y border-indigo-100/50">
                                                <span>BDI ({budget.bdi || 0}%):</span>
                                                <span className="font-mono text-sm text-indigo-700">
                                                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalFinal - totalBase)}
                                                </span>
                                            </div>

                                            {/* TOTAL GLOBAL */}
                                            <div className="flex justify-between items-center bg-blue-600 text-white p-4 rounded-xl shadow-lg border-2 border-blue-500 mt-2">
                                                <span className="font-black tracking-[0.1em] text-xs uppercase">TOTAL GLOBAL:</span>
                                                <span className="font-mono text-2xl font-black whitespace-nowrap">
                                                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalFinal)}
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
                                <button onClick={() => { setIsAddingItem(false); setInsertContext(null); }} className="text-slate-400 hover:text-slate-600"><ArrowLeft size={24} /></button>
                            </div>

                            <div className="flex-1 min-h-0 flex flex-col">
                                {/* TABS Toggle */}
                                <div className="px-6 pt-4 pb-2 flex items-center justify-center gap-4">
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
                                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Tipo de Obra — Acórdão TCU 2622/2013:</label>
                                    <div className="grid grid-cols-2 gap-2">
                                        {(Object.entries(BDI_PRESETS) as [PresetKey, typeof BDI_PRESETS[PresetKey]][]).map(([key, p]) => (
                                            <button
                                                key={key}
                                                onClick={() => handleApplyPreset(key)}
                                                className={clsx(
                                                    "text-left p-3 rounded-xl border-2 transition-all group",
                                                    selectedPresetKey === key
                                                        ? "border-blue-500 bg-blue-50"
                                                        : "border-slate-100 hover:border-blue-300 hover:bg-blue-50/50"
                                                )}
                                            >
                                                <p className={clsx("font-bold text-xs leading-tight", selectedPresetKey === key ? "text-blue-700" : "text-slate-700 group-hover:text-blue-700")}>{p.label}</p>
                                                {p.faixa && (
                                                    <p className="text-[9px] text-slate-400 mt-0.5">{p.faixa.min.toFixed(2)}% – {p.faixa.max.toFixed(2)}%</p>
                                                )}
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

                                {/* Resultado Principal */}
                                <div className="mt-8 p-6 bg-blue-50 rounded-2xl border border-blue-100">
                                    <div className="flex justify-between items-center">
                                        <div>
                                            <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">Resultado Final</p>
                                            <p className="text-4xl font-black text-blue-700">{calculateBDI().toFixed(2)}%</p>
                                            {selectedPresetKey && (() => {
                                                const status = getFaixaStatus(calculateBDI(), BDI_PRESETS[selectedPresetKey as PresetKey].faixa);
                                                return status ? (
                                                    <p className={`text-xs font-bold mt-1 ${status.color}`}>{status.label}</p>
                                                ) : null;
                                            })()}
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

                                {/* BDI Equipamentos — seção colapsável */}
                                <div className="mt-6 border border-orange-200 rounded-2xl overflow-hidden">
                                    <button
                                        onClick={() => setShowEquipCalc(v => !v)}
                                        className="w-full p-4 flex justify-between items-center bg-orange-50 hover:bg-orange-100 transition-colors"
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-black text-orange-700 uppercase tracking-widest">BDI Equipamentos (Faixa Diferenciada)</span>
                                            {selectedPresetKey && (() => {
                                                const p = BDI_PRESETS[selectedPresetKey as PresetKey];
                                                return p.faixaEquip ? (
                                                    <span className="text-[10px] text-orange-400">{p.faixaEquip.min.toFixed(2)}% – {p.faixaEquip.max.toFixed(2)}%</span>
                                                ) : null;
                                            })()}
                                        </div>
                                        <span className="text-orange-500 text-lg">{showEquipCalc ? '▲' : '▼'}</span>
                                    </button>
                                    {showEquipCalc && (
                                        <div className="p-6 bg-white space-y-6">
                                            <div className="grid grid-cols-2 gap-4">
                                                {[
                                                    { label: 'Adm. Central (AC)', key: 'ac' },
                                                    { label: 'Seguro + Garantia (S+G)', key: 'sg' },
                                                    { label: 'Taxa de Risco (R)', key: 'r' },
                                                    { label: 'Desp. Financeiras (DF)', key: 'df' },
                                                    { label: 'Taxa de Lucro (L)', key: 'l' },
                                                ].map((field) => (
                                                    <div key={field.key}>
                                                        <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">{field.label}</label>
                                                        <div className="relative">
                                                            <input
                                                                type="number"
                                                                step="0.01"
                                                                className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-xl outline-none focus:border-orange-400 transition-all font-bold text-slate-800 text-sm"
                                                                value={(bdiEquipCalc as any)[field.key]}
                                                                onChange={e => setBdiEquipCalc({ ...bdiEquipCalc, [field.key]: Number(e.target.value) })}
                                                            />
                                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 font-black text-slate-300 text-xs">%</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="grid grid-cols-4 gap-3">
                                                {[
                                                    { label: 'PIS', key: 'i_pis' },
                                                    { label: 'COFINS', key: 'i_cofins' },
                                                    { label: 'ISS', key: 'i_iss' },
                                                    { label: 'CPRB', key: 'i_cprb' },
                                                ].map((field) => (
                                                    <div key={field.key}>
                                                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{field.label}</label>
                                                        <div className="relative">
                                                            <input
                                                                type="number"
                                                                step="0.01"
                                                                className="w-full p-2 bg-slate-50 border-2 border-slate-100 rounded-lg outline-none focus:border-orange-400 transition-all text-xs font-bold"
                                                                value={(bdiEquipCalc as any)[field.key]}
                                                                onChange={e => setBdiEquipCalc({ ...bdiEquipCalc, [field.key]: Number(e.target.value) })}
                                                            />
                                                            <span className="absolute right-2 top-1/2 -translate-y-1/2 font-black text-slate-300 text-[10px]">%</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="p-4 bg-orange-50 rounded-xl border border-orange-100 flex justify-between items-center">
                                                <div>
                                                    <p className="text-[10px] font-black text-orange-600 uppercase tracking-widest">BDI Equipamentos</p>
                                                    <p className="text-3xl font-black text-orange-700">{calculateBDIEquip().toFixed(2)}%</p>
                                                    {selectedPresetKey && (() => {
                                                        const status = getFaixaStatus(calculateBDIEquip(), BDI_PRESETS[selectedPresetKey as PresetKey].faixaEquip);
                                                        return status ? (
                                                            <p className={`text-xs font-bold mt-1 ${status.color}`}>{status.label}</p>
                                                        ) : null;
                                                    })()}
                                                </div>
                                                <button
                                                    onClick={handleApplyBDIEquip}
                                                    className="bg-orange-500 text-white px-5 py-3 rounded-xl font-black text-xs hover:bg-orange-600 shadow-lg shadow-orange-100 transition-all active:scale-95"
                                                >
                                                    APLICAR COMO BDI EQUIPAMENTO
                                                </button>
                                            </div>
                                        </div>
                                    )}
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
                            <div className="p-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-4">
                                <div className="flex items-center gap-4">
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
                                {encargosEditado && (
                                    <button
                                        onClick={() => {
                                            const novoEstado = !todosExpandidos;
                                            setTodosExpandidos(novoEstado);
                                            setGruposExpandidos({ a: novoEstado, b: novoEstado, c: novoEstado, d: novoEstado });
                                        }}
                                        className="text-xs text-slate-500 underline"
                                    >
                                        {todosExpandidos ? 'Recolher Todos' : 'Expandir Todos'}
                                    </button>
                                )}
                            </div>

                            <div className="px-6 py-4 bg-white border-b border-slate-100">
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Selecione uma Base de Referência:</label>
                                <div className="flex gap-2 overflow-x-auto pb-2">
                                    {ENCARGOS_BASES_DETALHADAS.map(base => (
                                        <button
                                            key={base.id}
                                            onClick={() => handleSelecionarBase(base)}
                                            className={clsx(
                                                "px-4 py-2 text-xs font-bold rounded-xl border-2 whitespace-nowrap transition-all text-left",
                                                encargosEditado?.id === base.id ? "border-orange-500 bg-orange-50 text-orange-700" : "border-slate-100 text-slate-500 hover:border-orange-200 hover:bg-slate-50"
                                            )}
                                        >
                                            <div className="font-bold">{base.nome}</div>
                                            <div className="text-[9px] uppercase tracking-wider opacity-70 mt-0.5">{base.fonte} • Ref: {base.referencia}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="p-6 overflow-auto space-y-4 flex-1 bg-slate-50">
                                {!encargosEditado ? (
                                    <div className="text-center text-slate-400 py-10 font-bold">
                                        Selecione uma base acima para visualizar e editar os subitens.
                                    </div>
                                ) : (
                                    <>
                                        {/* 5d - Grupos A, B, C */}
                                        {(['a', 'b', 'c'] as const).map(g => {
                                            const grupoKey = `grupo_${g}` as keyof EncargosBaseDetalhada;
                                            const grupo = encargosEditado[grupoKey] as Record<string, EncargosSubitem>;
                                            if (!grupo) return null;
                                            const totalH = calcTotalGrupo(grupo, 'horista');
                                            const totalM = calcTotalGrupo(grupo, 'mensalista');
                                            const expandido = gruposExpandidos[g] ?? false;

                                            return (
                                                <div key={g} className="border border-slate-200 rounded-lg overflow-hidden mb-2 bg-white">
                                                    <button
                                                        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100"
                                                        onClick={() => setGruposExpandidos(prev => ({ ...prev, [g]: !prev[g] }))}
                                                    >
                                                        <span className="font-bold text-slate-700 uppercase">Grupo {g.toUpperCase()}</span>
                                                        <div className="flex gap-6 text-sm">
                                                            <span className="text-slate-600 bg-white px-2 rounded font-mono">Horista: <strong>{totalH.toFixed(2)}%</strong></span>
                                                            <span className="text-slate-600 bg-white px-2 rounded font-mono">Mensalista: <strong>{totalM.toFixed(2)}%</strong></span>
                                                            <span className="text-slate-400">{expandido ? '▲' : '▼'}</span>
                                                        </div>
                                                    </button>

                                                    {expandido && (
                                                        <table className="w-full text-sm">
                                                            <thead>
                                                                <tr className="bg-slate-100 border-y border-slate-200">
                                                                    <th className="text-left px-4 py-2 font-black text-slate-500 uppercase text-[10px] tracking-wider">Subitem</th>
                                                                    <th className="text-center px-3 py-2 w-28 font-black text-slate-500 uppercase text-[10px] tracking-wider">Horista (%)</th>
                                                                    <th className="text-center px-3 py-2 w-28 font-black text-slate-500 uppercase text-[10px] tracking-wider">Mensalista (%)</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {Object.entries(grupo).map(([key, item]) => (
                                                                    <tr key={key} className="border-b border-slate-50 hover:bg-slate-50/50">
                                                                        <td className="px-4 py-2 flex items-center gap-2">
                                                                            <span className="font-bold text-slate-600 text-xs">{item.label}</span>
                                                                            {item.tooltip && (
                                                                                <span title={item.tooltip} className="text-slate-400 cursor-help text-xs">ℹ</span>
                                                                            )}
                                                                            {key === 'a9_seconci' && (
                                                                                <button
                                                                                    onClick={() => setEncargosEditado(prev => {
                                                                                        if (!prev) return prev;
                                                                                        const novo = JSON.parse(JSON.stringify(prev)) as EncargosBaseDetalhada;
                                                                                        novo.grupo_a.a9_seconci.enabled = !novo.grupo_a.a9_seconci.enabled;
                                                                                        return novo;
                                                                                    })}
                                                                                    className={clsx(
                                                                                        "ml-2 text-[10px] font-black px-2 py-0.5 rounded-full border",
                                                                                        item.enabled !== false
                                                                                            ? "bg-green-100 text-green-700 border-green-300"
                                                                                            : "bg-slate-100 text-slate-400 border-slate-300"
                                                                                    )}
                                                                                >
                                                                                    {item.enabled !== false ? 'ON' : 'OFF'}
                                                                                </button>
                                                                            )}
                                                                        </td>
                                                                        <td className="px-3 py-2 text-center">
                                                                            <input
                                                                                type="number"
                                                                                step="0.01"
                                                                                value={item.horista}
                                                                                disabled={item.enabled === false}
                                                                                onChange={(e) => setEncargosEditado(prev => {
                                                                                    if (!prev) return prev;
                                                                                    const novo = JSON.parse(JSON.stringify(prev)) as EncargosBaseDetalhada;
                                                                                    (novo[grupoKey] as any)[key].horista = parseFloat(e.target.value) || 0;
                                                                                    return novo;
                                                                                })}
                                                                                className="w-16 text-center border border-slate-200 rounded px-1 py-1 font-mono text-xs disabled:opacity-40 focus:border-orange-400 outline-none"
                                                                            />
                                                                        </td>
                                                                        <td className="px-3 py-2 text-center">
                                                                            <input
                                                                                type="number"
                                                                                step="0.01"
                                                                                value={item.mensalista}
                                                                                disabled={item.enabled === false}
                                                                                onChange={(e) => setEncargosEditado(prev => {
                                                                                    if (!prev) return prev;
                                                                                    const novo = JSON.parse(JSON.stringify(prev)) as EncargosBaseDetalhada;
                                                                                    (novo[grupoKey] as any)[key].mensalista = parseFloat(e.target.value) || 0;
                                                                                    return novo;
                                                                                })}
                                                                                className="w-16 text-center border border-slate-200 rounded px-1 py-1 font-mono text-xs disabled:opacity-40 focus:border-orange-400 outline-none"
                                                                            />
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                                <tr className="bg-slate-50 border-t border-slate-200 text-slate-700">
                                                                    <td className="px-4 py-2 font-black text-xs uppercase tracking-widest text-right">Total Grupo {g.toUpperCase()}</td>
                                                                    <td className="px-3 py-2 text-center font-black font-mono">{totalH.toFixed(2)}%</td>
                                                                    <td className="px-3 py-2 text-center font-black font-mono">{totalM.toFixed(2)}%</td>
                                                                </tr>
                                                            </tbody>
                                                        </table>
                                                    )}
                                                </div>
                                            );
                                        })}

                                        {/* 5e - Grupo D (Calculado) */}
                                        {(() => {
                                            const dH = calcGrupoD(encargosEditado, 'horista');
                                            const dM = calcGrupoD(encargosEditado, 'mensalista');
                                            const expandido = gruposExpandidos['d'] ?? false;

                                            return (
                                                <div className="border border-slate-200 rounded-lg overflow-hidden mb-2 bg-white">
                                                    <button
                                                        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100"
                                                        onClick={() => setGruposExpandidos(prev => ({ ...prev, d: !prev['d'] }))}
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-bold text-slate-700 uppercase">Grupo D</span>
                                                            <span className="text-[9px] font-bold bg-slate-200 text-slate-500 px-2 py-0.5 rounded-full uppercase tracking-wider">
                                                                Calculado Automático
                                                            </span>
                                                        </div>
                                                        <div className="flex gap-6 text-sm">
                                                            <span className="text-slate-600 bg-white px-2 rounded font-mono">Horista: <strong>{dH.total.toFixed(2)}%</strong></span>
                                                            <span className="text-slate-600 bg-white px-2 rounded font-mono">Mensalista: <strong>{dM.total.toFixed(2)}%</strong></span>
                                                            <span className="text-slate-400">{expandido ? '▲' : '▼'}</span>
                                                        </div>
                                                    </button>

                                                    {expandido && (
                                                        <table className="w-full text-sm">
                                                            <thead>
                                                                <tr className="bg-slate-100 border-y border-slate-200">
                                                                    <th className="text-left px-4 py-2 font-black text-slate-500 uppercase text-[10px] tracking-wider">Subitem</th>
                                                                    <th className="text-center px-3 py-2 w-28 font-black text-slate-500 uppercase text-[10px] tracking-wider">Horista (%)</th>
                                                                    <th className="text-center px-3 py-2 w-28 font-black text-slate-500 uppercase text-[10px] tracking-wider">Mensalista (%)</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                <tr className="border-b border-slate-50">
                                                                    <td className="px-4 py-2 font-bold text-slate-500 text-xs">D1 — Reincidência de A sobre B</td>
                                                                    <td className="px-3 py-2 text-center text-slate-500 font-mono text-xs">{dH.d1.toFixed(2)}%</td>
                                                                    <td className="px-3 py-2 text-center text-slate-500 font-mono text-xs">{dM.d1.toFixed(2)}%</td>
                                                                </tr>
                                                                <tr className="border-b border-slate-50">
                                                                    <td className="px-4 py-2 font-bold text-slate-500 text-xs">D2 — Reincidência composta (A×C2 + FGTS×C1)</td>
                                                                    <td className="px-3 py-2 text-center text-slate-500 font-mono text-xs">{dH.d2.toFixed(2)}%</td>
                                                                    <td className="px-3 py-2 text-center text-slate-500 font-mono text-xs">{dM.d2.toFixed(2)}%</td>
                                                                </tr>
                                                                <tr className="bg-slate-50 border-t border-slate-200 text-slate-700">
                                                                    <td className="px-4 py-2 font-black text-xs uppercase tracking-widest text-right">Total Grupo D</td>
                                                                    <td className="px-3 py-2 text-center font-black font-mono">{dH.total.toFixed(2)}%</td>
                                                                    <td className="px-3 py-2 text-center font-black font-mono">{dM.total.toFixed(2)}%</td>
                                                                </tr>
                                                            </tbody>
                                                        </table>
                                                    )}
                                                </div>
                                            );
                                        })()}
                                    </>
                                )}
                            </div>

                            {/* 5f - Total Geral Fixo */}
                            {encargosEditado && (
                                <div className="bg-white border-t-2 border-slate-200 px-6 py-4 flex justify-between items-center z-10 shrink-0">
                                    <div className="flex gap-4 items-center">
                                        <span className="font-black text-slate-800 uppercase tracking-widest text-sm">TOTAL GERAL</span>
                                        <div className="flex gap-4">
                                            <div className="bg-orange-50 px-3 py-1 rounded-lg border border-orange-100 flex flex-col items-center">
                                                <span className="text-[10px] text-orange-600 font-bold uppercase tracking-widest">Horista</span>
                                                <strong className="text-slate-800 text-xl font-mono">{calcTotalGeral(encargosEditado, 'horista').toFixed(2)}%</strong>
                                            </div>
                                            <div className="bg-blue-50 px-3 py-1 rounded-lg border border-blue-100 flex flex-col items-center">
                                                <span className="text-[10px] text-blue-600 font-bold uppercase tracking-widest">Mensalista</span>
                                                <strong className="text-slate-800 text-xl font-mono">{calcTotalGeral(encargosEditado, 'mensalista').toFixed(2)}%</strong>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => {
                                                const totalMode = calcTotalGeral(encargosEditado, tipoEncargo);
                                                handleUpdateEncargos(totalMode, { desonerado: encargosEditado.regime === 'desonerado', id: encargosEditado.id });
                                                setShowEncargosModal(false);
                                            }}
                                            className="bg-orange-600 text-white px-6 py-3 rounded-xl font-black text-sm hover:bg-orange-700 shadow-lg shadow-orange-100 transition-all active:scale-95 flex items-center gap-2"
                                        >
                                            <Percent size={16} /> APLICAR {calcTotalGeral(encargosEditado, tipoEncargo).toFixed(2)}% ({tipoEncargo.toUpperCase()})
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )
            }
            {
                isImporterOpen && (
                    <BudgetImporter
                        onClose={() => setIsImporterOpen(false)}
                        onImport={handleImportItems}
                    />
                )
            }

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

            {/* Phase 3: Pendency Panel */}
            <ImportPendencyPanel
                budgetId={budgetId}
                isOpen={showPendencyPanel}
                onClose={() => setShowPendencyPanel(false)}
            />
        </div >
    );
};

export default BudgetEditor;
