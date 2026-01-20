
import { useState } from 'react';
import { InsumoService } from '../../lib/supabase-services/InsumoService';
import { X, Save } from 'lucide-react';

interface Props {
    onClose: () => void;
    onSuccess: () => void;
}

const ResourceForm = ({ onClose, onSuccess }: Props) => {
    const [formData, setFormData] = useState({
        codigo: '',
        descricao: '',
        unidade: 'UN',
        preco: 0,
        fonte: 'OWN',
        tipo: 'material' as 'material' | 'maoDeObra' | 'equipamento' | 'servicoUnitario'
    });
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            await InsumoService.create({
                ...formData,
                isOficial: false,
                isEditavel: true,
                dataReferencia: new Date()
            });
            onSuccess();
        } catch (error) {
            console.error(error);
            alert("Erro ao salvar insumo.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                <div className="p-6 border-b flex justify-between items-center bg-slate-50">
                    <h3 className="text-xl font-bold text-slate-800">Novo Insumo / Composição</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                        <X size={24} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Fonte / Origem</label>
                        <select
                            className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-accent"
                            value={formData.fonte}
                            onChange={(e) => setFormData({ ...formData, fonte: e.target.value })}
                        >
                            <option value="OWN">PRÓPRIO</option>
                            <option value="SINAPI">SINAPI (Manual)</option>
                            <option value="ORSE">ORSE (Manual)</option>
                            <option value="SEINFRA">SEINFRA (Manual)</option>
                        </select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Código</label>
                            <input
                                required
                                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-accent"
                                placeholder="Ex: 001"
                                value={formData.codigo}
                                onChange={(e) => setFormData({ ...formData, codigo: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Unidade</label>
                            <input
                                required
                                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-accent"
                                placeholder="Ex: M2, KG, H"
                                value={formData.unidade}
                                onChange={(e) => setFormData({ ...formData, unidade: e.target.value.toUpperCase() })}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Descrição</label>
                        <textarea
                            required
                            className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-accent h-24"
                            placeholder="Descreva o material ou serviço..."
                            value={formData.descricao}
                            onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Tipo</label>
                            <select
                                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-accent"
                                value={formData.tipo}
                                onChange={(e) => setFormData({ ...formData, tipo: e.target.value as any })}
                            >
                                <option value="material">Material</option>
                                <option value="maoDeObra">Mão de Obra</option>
                                <option value="equipamento">Equipamento</option>
                                <option value="servicoUnitario">Serviço/Comp.</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Preço Unitário</label>
                            <input
                                required
                                type="number"
                                step="0.01"
                                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-accent font-bold"
                                value={formData.preco}
                                onChange={(e) => setFormData({ ...formData, preco: Number(e.target.value) })}
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={saving}
                        className="w-full bg-accent text-white py-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-blue-700 shadow-lg shadow-blue-100 transition-all active:scale-95 disabled:opacity-50"
                    >
                        <Save size={20} />
                        {saving ? 'Salvando...' : 'Salvar no Banco'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default ResourceForm;
