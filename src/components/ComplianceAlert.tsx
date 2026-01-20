
import React from 'react';
import { AlertTriangle, Info, ShieldAlert, X } from 'lucide-react';

interface ComplianceAlertProps {
    type: 'warning' | 'info' | 'legal';
    title: string;
    message: string;
    recommendation?: string;
    points?: string[];
    dismissable?: boolean;
    onDismiss?: () => void;
    compact?: boolean;
}

const ComplianceAlert: React.FC<ComplianceAlertProps> = ({
    type,
    title,
    message,
    recommendation,
    points,
    dismissable = false,
    onDismiss,
    compact = false
}) => {
    const styles = {
        warning: {
            bg: 'bg-amber-50',
            border: 'border-amber-200',
            text: 'text-amber-800',
            iconBg: 'bg-amber-100',
            icon: <AlertTriangle className="text-amber-600" size={compact ? 16 : 20} />
        },
        info: {
            bg: 'bg-blue-50',
            border: 'border-blue-200',
            text: 'text-blue-800',
            iconBg: 'bg-blue-100',
            icon: <Info className="text-blue-600" size={compact ? 16 : 20} />
        },
        legal: {
            bg: 'bg-red-50',
            border: 'border-red-200',
            text: 'text-red-800',
            iconBg: 'bg-red-100',
            icon: <ShieldAlert className="text-red-600" size={compact ? 16 : 20} />
        }
    };

    const s = styles[type];

    if (compact) {
        return (
            <div className={`${s.bg} ${s.border} border rounded-lg p-3 flex items-start gap-3 text-sm`}>
                <div className={`${s.iconBg} p-1.5 rounded-full shrink-0`}>
                    {s.icon}
                </div>
                <div className={`${s.text} flex-1`}>
                    <span className="font-semibold">{title}:</span> {message}
                </div>
                {dismissable && onDismiss && (
                    <button onClick={onDismiss} className="text-slate-400 hover:text-slate-600">
                        <X size={16} />
                    </button>
                )}
            </div>
        );
    }

    return (
        <div className={`${s.bg} ${s.border} border rounded-xl p-4 ${s.text}`}>
            <div className="flex items-start gap-4">
                <div className={`${s.iconBg} p-2 rounded-full shrink-0`}>
                    {s.icon}
                </div>
                <div className="flex-1">
                    <div className="flex justify-between items-start">
                        <h4 className="font-bold">{title}</h4>
                        {dismissable && onDismiss && (
                            <button onClick={onDismiss} className="text-slate-400 hover:text-slate-600">
                                <X size={18} />
                            </button>
                        )}
                    </div>
                    <p className="mt-1 text-sm opacity-90">{message}</p>

                    {points && points.length > 0 && (
                        <ul className="mt-3 space-y-1 text-sm">
                            {points.map((point, idx) => (
                                <li key={idx} className="flex items-start gap-2">
                                    <span className="text-xs mt-1">•</span>
                                    <span>{point}</span>
                                </li>
                            ))}
                        </ul>
                    )}

                    {recommendation && (
                        <div className="mt-3 pt-3 border-t border-current/10">
                            <p className="text-sm font-medium">
                                📋 Recomendação: <span className="font-normal">{recommendation}</span>
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

/**
 * Componente para exibir footer de disclaimer em relatórios
 */
export const ComplianceFooter: React.FC<{ compact?: boolean }> = ({ compact = false }) => (
    <div className={`text-center ${compact ? 'text-[10px]' : 'text-xs'} text-slate-400 border-t border-slate-200 pt-4 mt-6`}>
        <p>Este documento foi gerado automaticamente pelo sistema NaboOrça.</p>
        <p className="mt-1">
            Os resultados não substituem análise técnica ou validação profissional.
            Consulte o responsável técnico para validação oficial.
        </p>
    </div>
);

/**
 * Banner de uso profissional
 */
export const ProfessionalUseBanner: React.FC = () => (
    <div className="bg-slate-800 text-white text-xs text-center py-2 px-4">
        <span className="opacity-70">🛡️ Ferramenta de apoio técnico à elaboração de orçamentos.</span>
        <span className="ml-2 opacity-50">|</span>
        <span className="ml-2 opacity-70">Valide sempre com profissional habilitado.</span>
    </div>
);

export default ComplianceAlert;
