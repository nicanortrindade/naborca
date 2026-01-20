import React from 'react';
import { Zap, TrendingUp, Shield, X } from 'lucide-react';
import { PLAN_INFO, type PlanTier } from '../config/plans';

interface UpgradePromptProps {
    /** Recurso que atingiu o limite */
    resource: string;
    /** Limite atual */
    currentLimit: number;
    /** Plano atual do usuário */
    currentPlan?: PlanTier;
    /** Callback ao fechar */
    onClose?: () => void;
    /** Modo de exibição */
    variant?: 'modal' | 'banner' | 'inline';
}

/**
 * Componente de Upgrade Prompt
 * 
 * Exibe mensagem quando usuário atinge limite do plano.
 * 
 * IMPORTANTE: Atualmente apenas informativo.
 * Quando ativar comercialização, adicionar link para página de upgrade.
 * 
 * @example
 * ```tsx
 * // Verificar limite antes de criar orçamento
 * const limitCheck = useResourceLimit('maxBudgets', budgets.length);
 * 
 * if (!limitCheck.allowed) {
 *     return (
 *         <UpgradePrompt
 *             resource="orçamentos"
 *             currentLimit={limitCheck.limit}
 *             currentPlan="free"
 *         />
 *     );
 * }
 * ```
 */
const UpgradePrompt: React.FC<UpgradePromptProps> = ({
    resource,
    currentLimit,
    currentPlan = 'free',
    onClose,
    variant = 'banner'
}) => {
    // Determinar próximo plano sugerido
    const suggestedPlan: PlanTier = currentPlan === 'free' ? 'pro' : 'enterprise';
    const planInfo = PLAN_INFO[suggestedPlan];

    if (variant === 'modal') {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
                <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-in zoom-in-95 duration-200">
                    {/* Header */}
                    <div className="bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Zap className="text-yellow-300" size={28} />
                            <h2 className="text-xl font-bold text-white">
                                Limite Atingido
                            </h2>
                        </div>
                        {onClose && (
                            <button
                                onClick={onClose}
                                className="text-white/80 hover:text-white transition-colors p-1 hover:bg-white/10 rounded-lg"
                            >
                                <X size={24} />
                            </button>
                        )}
                    </div>

                    {/* Content */}
                    <div className="p-6 space-y-6">
                        <div className="text-center">
                            <p className="text-slate-700 text-lg mb-2">
                                Você atingiu o limite de <strong>{currentLimit} {resource}</strong> do plano {PLAN_INFO[currentPlan].name}.
                            </p>
                            <p className="text-slate-500 text-sm">
                                Faça upgrade para continuar criando e aproveitar recursos avançados!
                            </p>
                        </div>

                        {/* Plano Sugerido */}
                        <div className="bg-gradient-to-br from-blue-50 to-purple-50 border-2 border-blue-200 rounded-xl p-6">
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <h3 className="text-2xl font-black text-slate-800">
                                        {planInfo.name}
                                    </h3>
                                    <p className="text-slate-600 text-sm">{planInfo.description}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-3xl font-black text-blue-600">{planInfo.price}</p>
                                    {planInfo.priceMonthly && (
                                        <p className="text-xs text-slate-500">por mês</p>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-2">
                                {planInfo.features.slice(0, 5).map((feature, idx) => (
                                    <div key={idx} className="flex items-center gap-2 text-sm text-slate-700">
                                        <Shield size={16} className="text-green-600 shrink-0" />
                                        <span>{feature}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* CTA */}
                        <div className="flex gap-3">
                            <button
                                onClick={onClose}
                                className="flex-1 px-6 py-3 border-2 border-slate-300 text-slate-700 font-bold rounded-xl hover:bg-slate-50 transition-all"
                            >
                                Agora Não
                            </button>
                            <button
                                onClick={() => {
                                    // TODO: Quando ativar comercialização, redirecionar para página de upgrade
                                    alert('Página de upgrade em breve! Por enquanto, todas as features estão liberadas.');
                                    onClose?.();
                                }}
                                className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold rounded-xl hover:shadow-lg transition-all flex items-center justify-center gap-2"
                            >
                                <TrendingUp size={18} />
                                Fazer Upgrade
                            </button>
                        </div>

                        {/* Nota */}
                        <p className="text-xs text-center text-slate-400">
                            💡 Atualmente todas as funcionalidades estão liberadas para uso pessoal.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    if (variant === 'banner') {
        return (
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl p-4 shadow-lg">
                <div className="flex items-start gap-4">
                    <Zap className="text-yellow-300 shrink-0 mt-1" size={24} />
                    <div className="flex-1">
                        <h3 className="font-bold text-lg mb-1">
                            Limite Atingido: {currentLimit} {resource}
                        </h3>
                        <p className="text-white/90 text-sm mb-3">
                            Você está no plano {PLAN_INFO[currentPlan].name}.
                            Faça upgrade para {planInfo.name} e tenha acesso ilimitado!
                        </p>
                        <button
                            onClick={() => {
                                alert('Página de upgrade em breve! Por enquanto, todas as features estão liberadas.');
                            }}
                            className="bg-white text-blue-600 px-4 py-2 rounded-lg font-bold text-sm hover:bg-blue-50 transition-all flex items-center gap-2"
                        >
                            <TrendingUp size={16} />
                            Ver Planos
                        </button>
                    </div>
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="text-white/80 hover:text-white transition-colors p-1 hover:bg-white/10 rounded-lg shrink-0"
                        >
                            <X size={20} />
                        </button>
                    )}
                </div>
            </div>
        );
    }

    // Inline variant
    return (
        <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4">
            <div className="flex items-start gap-3">
                <Zap className="text-blue-600 shrink-0 mt-0.5" size={20} />
                <div className="flex-1">
                    <p className="text-blue-900 font-bold text-sm mb-1">
                        Limite de {currentLimit} {resource} atingido
                    </p>
                    <p className="text-blue-700 text-xs mb-2">
                        Faça upgrade para {planInfo.name} e continue criando sem limites.
                    </p>
                    <button
                        onClick={() => {
                            alert('Página de upgrade em breve!');
                        }}
                        className="text-blue-600 hover:text-blue-700 font-bold text-xs underline"
                    >
                        Ver Planos →
                    </button>
                </div>
            </div>
        </div>
    );
};

export default UpgradePrompt;
