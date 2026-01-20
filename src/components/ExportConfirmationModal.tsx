import React from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';

interface ExportConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
    checklistItems: string[];
    warningText: string;
    confirmButtonText: string;
    cancelButtonText: string;
}

/**
 * Modal de Confirmação para Exportação de Documentos Oficiais
 * 
 * IMPORTANTE: Este modal exibe avisos APENAS na interface.
 * Os documentos exportados (PDF/Excel) NÃO conterão estes avisos.
 */
const ExportConfirmationModal: React.FC<ExportConfirmationModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    checklistItems,
    warningText,
    confirmButtonText,
    cancelButtonText
}) => {
    const [checkedItems, setCheckedItems] = React.useState<Set<number>>(new Set());

    React.useEffect(() => {
        if (isOpen) {
            setCheckedItems(new Set());
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const allChecked = checkedItems.size === checklistItems.length;

    const toggleItem = (index: number) => {
        setCheckedItems(prev => {
            const next = new Set(prev);
            if (next.has(index)) {
                next.delete(index);
            } else {
                next.add(index);
            }
            return next;
        });
    };

    const handleConfirm = () => {
        if (allChecked) {
            onConfirm();
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 flex items-center justify-between">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <AlertTriangle size={24} />
                        {title}
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-white/80 hover:text-white transition-colors p-1 hover:bg-white/10 rounded-lg"
                    >
                        <X size={24} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(90vh-180px)]">
                    {/* Message */}
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                        <p className="text-blue-900 font-medium">{message}</p>
                    </div>

                    {/* Checklist */}
                    <div>
                        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-3 flex items-center gap-2">
                            <CheckCircle2 size={16} className="text-blue-600" />
                            Checklist de Verificação
                        </h3>
                        <div className="space-y-2">
                            {checklistItems.map((item, index) => (
                                <label
                                    key={index}
                                    className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${checkedItems.has(index)
                                            ? 'bg-green-50 border-green-300'
                                            : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                                        }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={checkedItems.has(index)}
                                        onChange={() => toggleItem(index)}
                                        className="mt-0.5 w-5 h-5 rounded border-slate-300 text-green-600 focus:ring-green-500 cursor-pointer"
                                    />
                                    <span className={`text-sm font-medium flex-1 ${checkedItems.has(index) ? 'text-green-900' : 'text-slate-700'
                                        }`}>
                                        {item}
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Warning */}
                    <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4 flex gap-3 items-start">
                        <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
                        <div>
                            <p className="text-xs font-bold text-amber-900 uppercase tracking-wider mb-1">
                                Atenção Importante
                            </p>
                            <p className="text-sm text-amber-800 font-medium">
                                {warningText}
                            </p>
                        </div>
                    </div>

                    {/* Clean Document Notice */}
                    <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                        <p className="text-xs font-bold text-green-900 uppercase tracking-wider mb-1 flex items-center gap-2">
                            <CheckCircle2 size={14} />
                            Documento Limpo para Licitação
                        </p>
                        <p className="text-sm text-green-800">
                            O documento exportado <strong>NÃO conterá</strong> este aviso nem qualquer
                            texto explicativo do sistema. Será um arquivo limpo e profissional,
                            pronto para envio ao órgão público.
                        </p>
                    </div>
                </div>

                {/* Footer */}
                <div className="bg-slate-50 px-6 py-4 flex items-center justify-between gap-4 border-t border-slate-200">
                    <div className="text-sm text-slate-600">
                        {allChecked ? (
                            <span className="text-green-600 font-bold flex items-center gap-1">
                                <CheckCircle2 size={16} />
                                Pronto para exportar
                            </span>
                        ) : (
                            <span className="text-amber-600 font-medium">
                                Marque todos os itens para continuar
                            </span>
                        )}
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="px-6 py-2.5 border-2 border-slate-300 text-slate-700 font-bold rounded-xl hover:bg-slate-100 transition-all active:scale-95"
                        >
                            {cancelButtonText}
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={!allChecked}
                            className={`px-6 py-2.5 font-bold rounded-xl transition-all active:scale-95 ${allChecked
                                    ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-200'
                                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                }`}
                        >
                            {confirmButtonText}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ExportConfirmationModal;
