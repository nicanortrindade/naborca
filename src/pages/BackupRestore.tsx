
import React from 'react';
import { Download, Upload, Database, CheckCircle, Cloud, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { BudgetService } from '../lib/supabase-services/BudgetService';
import { BudgetItemService } from '../lib/supabase-services/BudgetItemService';
import { InsumoService } from '../lib/supabase-services/InsumoService';
import { CompositionService } from '../lib/supabase-services/CompositionService';
import { ClientService } from '../lib/supabase-services/ClientService';
import { CompanyService } from '../lib/supabase-services/CompanyService';
import { BudgetItemCompositionService } from '../lib/supabase-services/BudgetItemCompositionService';

const BackupRestore: React.FC = () => {
    const [isExporting, setIsExporting] = React.useState(false);
    const [isImporting, setIsImporting] = React.useState(false);

    const handleExportData = async () => {
        try {
            setIsExporting(true);

            // Fetch all data
            const [budgets, insumos, compositions, clients, company] = await Promise.all([
                BudgetService.getAll(),
                InsumoService.getAll(),
                CompositionService.getAll(),
                ClientService.getAll(),
                CompanyService.get()
            ]);

            // Fetch nested data for budgets
            const fullBudgets = await Promise.all(budgets.map(async (b) => {
                const items = await BudgetItemService.getByBudgetId(b.id!);
                const itemsWithComps = await Promise.all(items.map(async (item) => {
                    const comps = await BudgetItemCompositionService.getByBudgetItemId(item.id as string);
                    return { ...item, compositions: comps };
                }));
                return { ...b, items: itemsWithComps };
            }));

            // Fetch nested data for compositions
            const fullCompositions = await Promise.all(compositions.map(async (c) => {
                const items = await CompositionService.getItems(c.id!);
                return { ...c, items };
            }));

            const backupData = {
                version: '1.0',
                exportedAt: new Date().toISOString(),
                data: {
                    budgets: fullBudgets,
                    insumos,
                    compositions: fullCompositions,
                    clients,
                    company
                }
            };

            const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `backup-naboorca-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            alert("Exportação concluída com sucesso!");
        } catch (error) {
            console.error("Erro ao exportar dados:", error);
            alert("Erro ao exportar dados. Verifique o console.");
        } finally {
            setIsExporting(false);
        }
    };

    const handleImportData = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        if (!window.confirm("Atenção: A importação irá adicionar os dados do arquivo ao seu banco atual. Deseja continuar?")) {
            return;
        }

        try {
            setIsImporting(true);
            const text = await file.text();
            const backup = JSON.parse(text);

            if (!backup.data) throw new Error("Arquivo de backup inválido");

            const { budgets, insumos, compositions, clients, company } = backup.data;

            // 1. Import Company info skip or merge? Let's skip for now or alert
            if (company) {
                // await CompanyService.upsert(company);
            }

            // 2. Import Clients
            if (clients && clients.length > 0) {
                console.log("Importando clientes...");
                for (const client of clients) {
                    await ClientService.create(client);
                }
            }

            // 3. Import Insumos
            if (insumos && insumos.length > 0) {
                console.log("Importando insumos...");
                // Batch upsert insumos
                await InsumoService.batchUpsert(insumos);
            }

            // 4. Import Compositions
            if (compositions && compositions.length > 0) {
                console.log("Importando composições...");
                for (const comp of compositions) {
                    await CompositionService.create(comp, comp.items || []);
                }
            }

            // 5. Import Budgets (Deep import)
            if (budgets && budgets.length > 0) {
                console.log("Importando orçamentos...");
                for (const b of budgets) {
                    const newBudget = await BudgetService.create(b);
                    if (b.items && b.items.length > 0) {
                        for (const item of b.items) {
                            const newItem = await BudgetItemService.create({
                                ...item,
                                budgetId: newBudget.id
                            });
                            if (item.compositions && item.compositions.length > 0) {
                                await BudgetItemCompositionService.batchCreate(
                                    item.compositions.map((c: any) => ({
                                        ...c,
                                        budgetItemId: newItem.id
                                    }))
                                );
                            }
                        }
                    }
                }
            }

            alert("Importação concluída com sucesso!");
            window.location.reload();
        } catch (error) {
            console.error("Erro ao importar dados:", error);
            alert("Erro ao importar dados. Verifique o console.");
        } finally {
            setIsImporting(false);
            if (event.target) event.target.value = '';
        }
    };

    return (
        <div className="p-6 max-w-2xl mx-auto">
            <header className="mb-8">
                <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-3">
                    <Database className="text-blue-600" />
                    Backup e Restauração
                </h1>
                <p className="text-slate-500 mt-2">
                    Informações sobre armazenamento e segurança dos seus dados.
                </p>
            </header>

            <div className="grid gap-6">
                {/* Cloud Info Section */}
                <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg p-6 text-white">
                    <div className="flex items-start gap-4">
                        <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                            <Cloud size={24} />
                        </div>
                        <div className="flex-1">
                            <h2 className="text-lg font-bold">Seus Dados Estão na Nuvem</h2>
                            <p className="text-blue-100 text-sm mt-1">
                                Todos os seus orçamentos, insumos, composições e configurações são armazenados de forma segura
                                no <strong>Supabase</strong>, uma plataforma de banco de dados em nuvem com backups automáticos.
                            </p>
                            <div className="mt-4 space-y-2 text-sm">
                                <div className="flex items-center gap-2">
                                    <CheckCircle size={16} />
                                    <span>Backup automático diário</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <CheckCircle size={16} />
                                    <span>Dados criptografados em trânsito e repouso</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <CheckCircle size={16} />
                                    <span>Sincronização em tempo real</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <CheckCircle size={16} />
                                    <span>Acesse de qualquer dispositivo</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className={clsx("bg-white rounded-xl shadow-sm border border-slate-200 p-6", isExporting && "opacity-60")}>
                    <div className="flex items-start gap-4">
                        <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center">
                            <Download size={24} />
                        </div>
                        <div className="flex-1">
                            <h2 className="text-lg font-bold text-slate-800">Exportar Dados</h2>
                            <p className="text-slate-500 text-sm mt-1">
                                Gere um arquivo JSON com todos os seus orçamentos, insumos e clientes para backup local.
                            </p>
                            <button
                                onClick={handleExportData}
                                disabled={isExporting}
                                className="mt-4 flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:bg-slate-300"
                            >
                                {isExporting ? (
                                    <>
                                        <Loader2 size={18} className="animate-spin" />
                                        Exportando...
                                    </>
                                ) : (
                                    <>
                                        <Download size={18} />
                                        Exportar Agora (JSON)
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>

                <div className={clsx("bg-white rounded-xl shadow-sm border border-slate-200 p-6", isImporting && "opacity-60")}>
                    <div className="flex items-start gap-4">
                        <div className="w-12 h-12 bg-orange-50 text-orange-600 rounded-xl flex items-center justify-center">
                            <Upload size={24} />
                        </div>
                        <div className="flex-1">
                            <h2 className="text-lg font-bold text-slate-800">Importar Dados</h2>
                            <p className="text-slate-500 text-sm mt-1">
                                Selecione um arquivo de backup (.json) para restaurar seus dados no sistema.
                            </p>
                            <label className={clsx(
                                "mt-4 inline-flex items-center gap-2 px-6 py-2.5 bg-orange-600 text-white rounded-lg font-semibold hover:bg-orange-700 transition-colors cursor-pointer",
                                isImporting && "bg-slate-300 pointer-events-none"
                            )}>
                                {isImporting ? (
                                    <>
                                        <Loader2 size={18} className="animate-spin" />
                                        Importando...
                                    </>
                                ) : (
                                    <>
                                        <Upload size={18} />
                                        Importar Arquivo
                                    </>
                                )}
                                <input
                                    type="file"
                                    accept=".json"
                                    onChange={handleImportData}
                                    className="hidden"
                                />
                            </label>
                            <p className="text-[10px] text-slate-400 mt-2 uppercase font-bold">Apenas arquivos .json gerados pelo sistema</p>
                        </div>
                    </div>
                </div>

                {/* Info Box */}
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex gap-3">
                    <CheckCircle className="text-green-600 shrink-0" size={20} />
                    <div className="text-sm text-green-800">
                        <p className="font-semibold">Você não precisa se preocupar com backups manuais!</p>
                        <p className="mt-1">
                            Seus dados são automaticamente salvos e sincronizados na nuvem sempre que você faz uma alteração.
                            Você pode acessar suas informações de qualquer lugar, a qualquer momento.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BackupRestore;
