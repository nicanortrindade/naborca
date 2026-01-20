
import React, { useState, useEffect } from 'react';
// import { db, type CompanySettings } from '../sdk/database/orm/db'; // Removed Dexie
import { CompanyService } from '../lib/supabase-services/CompanyService';
import { type CompanySettings } from '../types/domain';
import { Save, Upload, Building2, User, Phone, MapPin, Mail, Hash, FileText } from 'lucide-react';

const Settings: React.FC = () => {
    const [settings, setSettings] = useState<Partial<CompanySettings>>({
        name: '',
        cnpj: '',
        address: '',
        email: '',
        phone: '',
        responsibleName: '',
        responsibleCpf: '',
        responsibleCrea: '',
        logo: '',
        proposalCover: '',
        proposalTerms: ''
    });
    const [loading, setLoading] = useState(true);
    const [saved, setSaved] = useState(false);
    const [isDragging, setIsDragging] = useState(false);

    async function loadSettings() {
        try {
            const data = await CompanyService.get();
            if (data) {
                setSettings(data);
            }
        } catch (error: any) {
            console.error("Error loading settings", error);
            if (error.message && (error.message.includes('authenticated') || error.message.includes('Auth'))) {
                alert("Sua sessão expirou. Por favor, faça login novamente para visualizar seus dados.");
                // Optional: Redirect logic if needed, but alert is critical first step
            }
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadSettings();
    }, []);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            // Upsert handles both create and update
            const updated = await CompanyService.upsert(settings);
            setSettings(updated);
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch (error: any) {
            console.error("Error saving settings", error);
            alert(`Erro ao salvar configurações: ${error.message || JSON.stringify(error)}`);
        } finally {
            setLoading(false);
        }
    };

    const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            processImageFile(file);
        }
    };

    const resizeImage = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;
                    const MAX_WIDTH = 250;
                    const MAX_HEIGHT = 150;

                    if (width > height) {
                        if (width > MAX_WIDTH) {
                            height *= MAX_WIDTH / width;
                            width = MAX_WIDTH;
                        }
                    } else {
                        if (height > MAX_HEIGHT) {
                            width *= MAX_HEIGHT / height;
                            height = MAX_HEIGHT;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        ctx.drawImage(img, 0, 0, width, height);
                        resolve(canvas.toDataURL(file.type, 0.8)); // 80% quality
                    } else {
                        reject(new Error("Failed to get canvas context"));
                    }
                };
                img.src = e.target?.result as string;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    };

    const processImageFile = async (file: File) => {
        if (!file.type.startsWith('image/')) {
            alert('Por favor, selecione um arquivo de imagem.');
            return;
        }

        try {
            const resized = await resizeImage(file);
            setSettings({ ...settings, logo: resized });
        } catch (e) {
            console.error(e);
            alert("Erro ao processar imagem.");
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) {
            processImageFile(file);
        }
    };

    if (loading && !settings.name) {
        return <div className="p-8 text-center">Carregando configurações...</div>;
    }

    return (
        <div className="p-6 max-w-4xl mx-auto">
            <header className="mb-8">
                <h1 className="text-3xl font-bold text-slate-800">Minha Empresa</h1>
                <p className="text-slate-500">Personalize os dados que aparecerão nos relatórios e orçamentos.</p>
            </header>

            <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                    <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                        <Upload className="w-5 h-5 text-blue-600" /> Logo da Empresa
                    </h2>
                    <div className="flex items-center gap-6">
                        <div
                            className={`w-32 h-32 bg-slate-100 rounded-lg flex items-center justify-center border-2 border-dashed overflow-hidden cursor-pointer transition-all ${isDragging
                                ? 'border-blue-500 bg-blue-50 scale-105'
                                : 'border-slate-300 hover:border-blue-400 hover:bg-blue-50'
                                }`}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                            onClick={() => document.getElementById('logo-upload')?.click()}
                        >
                            {settings.logo ? (
                                <img src={settings.logo} alt="Logo" className="w-full h-full object-contain" />
                            ) : (
                                <div className="text-center p-2">
                                    <Upload className="w-8 h-8 text-slate-300 mx-auto mb-1" />
                                    <p className="text-[10px] text-slate-400">Arraste ou clique</p>
                                </div>
                            )}
                        </div>
                        <div>
                            <input
                                type="file"
                                id="logo-upload"
                                accept="image/*"
                                className="hidden"
                                onChange={handleLogoUpload}
                            />
                            <label
                                htmlFor="logo-upload"
                                className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer transition-all inline-block"
                            >
                                Alterar Logo
                            </label>
                            <p className="text-xs text-slate-400 mt-2">Recomendado: PNG ou JPG, fundo transparente.</p>
                            <p className="text-xs text-blue-500 mt-1">💡 Você pode arrastar a imagem diretamente!</p>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                    <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                        <Building2 className="w-5 h-5 text-blue-600" /> Dados Jurídicos
                    </h2>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Nome da Empresa</label>
                            <div className="relative">
                                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <input
                                    type="text"
                                    className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                    value={settings.name || ''}
                                    onChange={e => setSettings({ ...settings, name: e.target.value })}
                                    placeholder="Ex: Minha Construtora LTDA"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">CNPJ</label>
                            <div className="relative">
                                <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <input
                                    type="text"
                                    className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                    value={settings.cnpj || ''}
                                    onChange={e => setSettings({ ...settings, cnpj: e.target.value })}
                                    placeholder="00.000.000/0001-00"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Endereço Completo</label>
                            <div className="relative">
                                <MapPin className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                                <textarea
                                    className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none h-20"
                                    value={settings.address || ''}
                                    onChange={e => setSettings({ ...settings, address: e.target.value })}
                                    placeholder="Rua, Número, Bairro, Cidade - UF"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                    <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                        <User className="w-5 h-5 text-blue-600" /> Responsável Técnico
                    </h2>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Nome do Responsável</label>
                            <div className="relative">
                                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <input
                                    type="text"
                                    className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                    value={settings.responsibleName || ''}
                                    onChange={e => setSettings({ ...settings, responsibleName: e.target.value })}
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">CPF</label>
                                <input
                                    type="text"
                                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                    value={settings.responsibleCpf || ''}
                                    onChange={e => setSettings({ ...settings, responsibleCpf: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">CREA/CAU</label>
                                <input
                                    type="text"
                                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                    value={settings.responsibleCrea || ''}
                                    onChange={e => setSettings({ ...settings, responsibleCrea: e.target.value })}
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">E-mail de Contato</label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <input
                                    type="email"
                                    className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                    value={settings.email || ''}
                                    onChange={e => setSettings({ ...settings, email: e.target.value })}
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Telefone</label>
                            <div className="relative">
                                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <input
                                    type="text"
                                    className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                    value={settings.phone || ''}
                                    onChange={e => setSettings({ ...settings, phone: e.target.value })}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="md:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                    <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                        <FileText className="w-5 h-5 text-blue-600" /> Personalização da Proposta (PDF)
                    </h2>
                    <div className="space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Texto da Capa</label>
                            <p className="text-xs text-slate-400 mb-2">Este texto aparecerá centralizado na primeira página da proposta.</p>
                            <textarea
                                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none h-32"
                                value={settings.proposalCover || ''}
                                onChange={e => setSettings({ ...settings, proposalCover: e.target.value })}
                                placeholder="Ex: Proposta Técnica e Comercial para Execução de Obras de Reforma..."
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Termos e Condições (Rodapé/Final)</label>
                            <p className="text-xs text-slate-400 mb-2">Validade da proposta, prazos de pagamento, garantias, etc.</p>
                            <textarea
                                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none h-32"
                                value={settings.proposalTerms || ''}
                                onChange={e => setSettings({ ...settings, proposalTerms: e.target.value })}
                                placeholder="1. Validade: 30 dias. 2. Prazo: 90 dias após início. 3. Pagamento: Conforme medição mensal..."
                            />
                        </div>
                    </div>
                </div>

                <div className="md:col-span-2 flex justify-end gap-3 pt-4">
                    <button
                        type="submit"
                        disabled={loading}
                        className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-all disabled:opacity-50"
                    >
                        {loading ? 'Salvando...' : <><Save className="w-4 h-4" /> Salvar Configurações</>}
                    </button>
                </div>
            </form>

            {saved && (
                <div className="fixed bottom-6 right-6 bg-green-600 text-white px-6 py-3 rounded-xl shadow-lg flex items-center gap-3 animate-bounce">
                    <div className="w-5 h-5 bg-white text-green-600 rounded-full flex items-center justify-center font-bold">✓</div>
                    Configurações salvas com sucesso!
                </div>
            )}
        </div>
    );
};

export default Settings;
