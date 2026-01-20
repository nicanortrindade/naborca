import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { MigrationService } from '../lib/migration/MigrationService';
import { Database, HardDrive, ArrowRight, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';

const MigrationTool = () => {
    const { user } = useAuth();
    const [progress, setProgress] = useState<string[]>([]);
    const [isMigrating, setIsMigrating] = useState(false);
    const [completed, setCompleted] = useState(false);

    const handleMigration = async () => {
        if (!user) return;
        if (!window.confirm("Isso irá copiar seus dados locais para a nuvem. Certifique-se de estar conectado à internet. Continuar?")) return;

        setIsMigrating(true);
        setProgress([]);
        setCompleted(false);

        const addLog = (msg: string) => setProgress(prev => [...prev, `${new Date().toLocaleTimeString()} - ${msg}`]);

        const result = await MigrationService.migrateAll(user.id, addLog);

        setIsMigrating(false);
        if (result.success) {
            setCompleted(true);
        }
    };

    return (
        <div className="max-w-2xl mx-auto py-12 px-4">
            <h1 className="text-3xl font-bold text-slate-800 mb-2">Migração para Nuvem</h1>
            <p className="text-slate-500 mb-8">Transfira seus orçamentos locais para o servidor seguro.</p>

            <div className="bg-white rounded-xl shadow-lg border border-slate-100 overflow-hidden">
                <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 bg-slate-200 rounded-full flex items-center justify-center text-slate-500">
                            <HardDrive size={32} />
                        </div>
                        <ArrowRight className="text-slate-300" />
                        <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center text-blue-600">
                            <Database size={32} />
                        </div>
                    </div>
                </div>

                <div className="p-8">
                    {!completed ? (
                        <>
                            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6 flex gap-3 text-yellow-800 text-sm">
                                <AlertTriangle className="shrink-0" />
                                <p>
                                    Esta operação lerá todos os dados do seu navegador e salvará na sua conta <strong>{user?.email}</strong>.
                                    Os dados locais <strong>NÃO</strong> serão apagados automaticamente.
                                </p>
                            </div>

                            <button
                                onClick={handleMigration}
                                disabled={isMigrating}
                                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition-all"
                            >
                                {isMigrating ? <Loader2 className="animate-spin" /> : <Database size={20} />}
                                {isMigrating ? 'Migrando...' : 'Iniciar Migração Agora'}
                            </button>
                        </>
                    ) : (
                        <div className="text-center py-6">
                            <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4 animate-bounce">
                                <CheckCircle size={32} />
                            </div>
                            <h3 className="text-xl font-bold text-slate-800">Sucesso!</h3>
                            <p className="text-slate-500">Seus dados foram migrados com segurança.</p>
                        </div>
                    )}

                    {progress.length > 0 && (
                        <div className="mt-8 bg-slate-900 rounded-lg p-4 font-mono text-xs text-green-400 max-h-64 overflow-y-auto">
                            {progress.map((log, i) => (
                                <div key={i} className="mb-1 border-b border-slate-800 pb-1 last:border-0">{log}</div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default MigrationTool;
