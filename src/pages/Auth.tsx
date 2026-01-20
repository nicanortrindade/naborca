import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { LogIn, UserPlus, Mail, Lock, Loader2, AlertCircle } from 'lucide-react';


const Auth = () => {
    const navigate = useNavigate();
    const [isLogin, setIsLogin] = useState(true);
    const [loading, setLoading] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setMessage(null);

        try {
            if (isLogin) {
                const { error } = await supabase.auth.signInWithPassword({
                    email,
                    password,
                });
                if (error) throw error;
                navigate('/');
            } else {
                const { error } = await supabase.auth.signUp({
                    email,
                    password,
                });
                if (error) throw error;
                setMessage('Cadastro realizado! Verifique seu e-mail para confirmar a conta.');
            }
        } catch (err: any) {
            setError(err.message || 'Ocorreu um erro ao processar sua solicitação.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
            <div className="max-w-md w-full animate-in fade-in zoom-in duration-300">
                <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
                    <div className="p-8 bg-blue-600 text-white text-center">
                        <h1 className="text-3xl font-black italic tracking-tighter">NABO<span className="text-blue-200">ORÇA</span></h1>
                        <p className="text-blue-100 mt-2 text-sm font-medium">
                            {isLogin ? 'Bem-vindo de volta! Entre na sua conta.' : 'Crie sua conta e comece a orçar agora.'}
                        </p>
                    </div>

                    <div className="p-8">
                        {error && (
                            <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600 text-sm animate-in slide-in-from-top-2">
                                <AlertCircle size={18} />
                                <span className="font-medium">{error}</span>
                            </div>
                        )}

                        {message && (
                            <div className="mb-6 p-4 bg-green-50 border border-green-100 rounded-2xl flex items-center gap-3 text-green-600 text-sm animate-in slide-in-from-top-2">
                                <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center text-white">✓</div>
                                <span className="font-medium">{message}</span>
                            </div>
                        )}

                        <form onSubmit={handleAuth} className="space-y-4">
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 ml-1">E-mail</label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                    <input
                                        type="email"
                                        required
                                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-3 pl-10 outline-none focus:ring-2 ring-blue-500 transition-all font-medium"
                                        placeholder="seu@email.com"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 ml-1">Senha</label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                    <input
                                        type="password"
                                        required
                                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-3 pl-10 outline-none focus:ring-2 ring-blue-500 transition-all font-medium"
                                        placeholder="••••••••"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                    />
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full bg-blue-600 text-white rounded-2xl p-4 font-black flex items-center justify-center gap-2 hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all disabled:opacity-50"
                            >
                                {loading ? (
                                    <Loader2 className="animate-spin" size={20} />
                                ) : isLogin ? (
                                    <><LogIn size={20} /> ENTRAR NO SISTEMA</>
                                ) : (
                                    <><UserPlus size={20} /> CRIAR MINHA CONTA</>
                                )}
                            </button>
                        </form>

                        <div className="mt-8 pt-6 border-t border-slate-100 text-center">
                            <p className="text-slate-500 text-sm">
                                {isLogin ? 'Não tem uma conta?' : 'Já possui uma conta?'}
                                <button
                                    onClick={() => setIsLogin(!isLogin)}
                                    className="ml-2 text-blue-600 font-bold hover:underline"
                                >
                                    {isLogin ? 'Cadastre-se' : 'Fazer Login'}
                                </button>
                            </p>
                        </div>
                    </div>
                </div>

                <p className="mt-8 text-center text-slate-500 text-[10px] font-bold uppercase tracking-[0.2em]">
                    NaboOrça &copy; 2026 • Tecnologia para Engenharia
                </p>
            </div>
        </div>
    );
};

export default Auth;
