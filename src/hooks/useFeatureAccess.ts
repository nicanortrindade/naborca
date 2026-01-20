/**
 * HOOK: useFeatureAccess
 * 
 * Hook React para verificar acesso a features e limites de plano.
 * Simplifica integração do sistema de planos na UI.
 */

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { getUserFeatures, hasFeature, checkLimit, type PlanFeatures } from '../config/plans';

interface FeatureAccessHook {
    // Features do plano
    features: PlanFeatures | null;
    loading: boolean;

    // Verificação de feature específica
    hasFeature: (feature: keyof PlanFeatures) => boolean;

    // Verificação de limite
    checkLimit: (resource: keyof PlanFeatures, currentCount: number) => {
        allowed: boolean;
        limit: number;
        remaining: number;
    };

    // Informações do plano
    planTier: 'free' | 'pro' | 'enterprise' | null;
    isUnlimited: boolean;
}

/**
 * Hook para verificar acesso a features e limites
 * 
 * @example
 * ```tsx
 * function BudgetList() {
 *     const { hasFeature, checkLimit, features } = useFeatureAccess();
 *     
 *     const canCreateBudget = checkLimit('maxBudgets', currentBudgets.length);
 *     const canUseScenarios = hasFeature('enableScenarios');
 *     
 *     return (
 *         <div>
 *             {canUseScenarios && <ScenarioButton />}
 *             {!canCreateBudget.allowed && (
 *                 <UpgradePrompt limit={canCreateBudget.limit} />
 *             )}
 *         </div>
 *     );
 * }
 * ```
 */
export function useFeatureAccess(): FeatureAccessHook {
    const [features, setFeatures] = useState<PlanFeatures | null>(null);
    const [loading, setLoading] = useState(true);
    const [userId, setUserId] = useState<string | null>(null);

    useEffect(() => {
        async function loadFeatures() {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) {
                    setLoading(false);
                    return;
                }

                setUserId(user.id);
                const userFeatures = await getUserFeatures(user.id);
                setFeatures(userFeatures);
            } catch (error) {
                console.error('Failed to load user features:', error);
            } finally {
                setLoading(false);
            }
        }

        loadFeatures();
    }, []);

    const checkFeature = (feature: keyof PlanFeatures): boolean => {
        if (!features) return false;

        const value = features[feature];

        if (typeof value === 'boolean') {
            return value;
        }

        if (typeof value === 'number') {
            return value > 0;
        }

        return !!value;
    };

    const checkResourceLimit = (
        resource: keyof PlanFeatures,
        currentCount: number
    ): { allowed: boolean; limit: number; remaining: number } => {
        if (!features) {
            return { allowed: false, limit: 0, remaining: 0 };
        }

        const limit = features[resource] as number;

        return {
            allowed: currentCount < limit,
            limit: limit === Infinity ? -1 : limit,
            remaining: limit === Infinity ? -1 : Math.max(0, limit - currentCount)
        };
    };

    // Determinar tier do plano baseado nas features
    const determinePlanTier = (): 'free' | 'pro' | 'enterprise' | null => {
        if (!features) return null;

        // Se tem limites infinitos, é enterprise
        if (features.maxBudgets === Infinity) return 'enterprise';

        // Se tem features avançadas, é pro
        if (features.enableAdvancedReports) return 'pro';

        // Caso contrário, é free
        return 'free';
    };

    return {
        features,
        loading,
        hasFeature: checkFeature,
        checkLimit: checkResourceLimit,
        planTier: determinePlanTier(),
        isUnlimited: features?.maxBudgets === Infinity || false
    };
}

/**
 * Hook simplificado para verificar uma feature específica
 * 
 * @example
 * ```tsx
 * function ScenarioButton() {
 *     const canUseScenarios = useFeature('enableScenarios');
 *     
 *     if (!canUseScenarios) return null;
 *     
 *     return <button>Criar Cenário</button>;
 * }
 * ```
 */
export function useFeature(feature: keyof PlanFeatures): boolean {
    const { hasFeature } = useFeatureAccess();
    return hasFeature(feature);
}

/**
 * Hook para verificar limite de recurso
 * 
 * @example
 * ```tsx
 * function BudgetList({ budgets }) {
 *     const limitCheck = useResourceLimit('maxBudgets', budgets.length);
 *     
 *     return (
 *         <div>
 *             <button disabled={!limitCheck.allowed}>
 *                 Criar Orçamento
 *             </button>
 *             {!limitCheck.allowed && (
 *                 <p>Limite atingido: {limitCheck.limit} orçamentos</p>
 *             )}
 *         </div>
 *     );
 * }
 * ```
 */
export function useResourceLimit(
    resource: keyof PlanFeatures,
    currentCount: number
): { allowed: boolean; limit: number; remaining: number } {
    const { checkLimit } = useFeatureAccess();
    return checkLimit(resource, currentCount);
}
