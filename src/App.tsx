
import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, FileSpreadsheet, Database, Settings, Users, FileText, Layers, Search, GitCompare, HardDrive, Menu, X, Package, Calculator, LogOut } from 'lucide-react';
import { supabase } from './lib/supabase';
import { clsx } from 'clsx';
// Import pages
import Dashboard from './pages/Dashboard';
import Budgets from './pages/Budgets';
import BudgetEditor from './pages/BudgetEditor';
import Resources from './pages/Resources';
import SettingsPage from './pages/Settings';
import BudgetSchedule from './pages/BudgetSchedule';
import CustomCompositions from './pages/CustomCompositions';
import BackupRestore from './pages/BackupRestore';
import GlobalSearch from './pages/GlobalSearch';
import BudgetComparison from './pages/BudgetComparison';
import ChangeHistory from './pages/ChangeHistory';
import ProposalReview from './pages/ProposalReview';
import ScenarioSimulator from './pages/ScenarioSimulator';
import BancoInsumos from './pages/BancoInsumos';
import BancoComposicoes from './pages/BancoComposicoes';
import Clients from './pages/Clients';
import Proposals from './pages/Proposals';
import MigrationTool from './pages/MigrationTool';
import SinapiImporter from './pages/SinapiImporter';
import ImportStatus from './pages/ImportStatus';

// Hook para detectar mobile
const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return isMobile;
};

// Exportar para uso em outros componentes
export { useIsMobile };

const SidebarItem = ({ icon: Icon, label, path, onClick }: { icon: any, label: string, path: string, onClick?: () => void }) => {
  const location = useLocation();
  const isActive = location.pathname === path || location.pathname.startsWith(path + '/');

  return (
    <Link
      to={path}
      onClick={onClick}
      className={clsx(
        "flex items-center gap-3 px-3 py-3 md:py-2 rounded-md transition-all duration-200 mb-0.5 text-base md:text-sm group",
        isActive
          ? "bg-accent/10 text-accent font-medium border-l-2 border-accent"
          : "text-slate-400 hover:text-slate-100 hover:bg-white/5 border-l-2 border-transparent"
      )}
    >
      <Icon size={20} className={clsx("transition-colors md:w-[18px] md:h-[18px]", isActive ? "text-accent" : "text-slate-500 group-hover:text-slate-300")} />
      <span>{label}</span>
    </Link>
  );
};

const Layout = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Fecha sidebar ao mudar de rota no mobile
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [location.pathname, isMobile]);

  // Verifica se é a página de edição de orçamento
  const isBudgetEditor = /^\/budgets\/\d+$/.test(location.pathname);

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Mobile Header */}
      {isMobile && (
        <header className="fixed top-0 left-0 right-0 h-14 bg-primary border-b border-slate-800 z-30 flex items-center justify-between px-4">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            aria-label="Abrir menu"
          >
            <Menu size={24} />
          </button>
          <div
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => navigate('/')}
          >
            <Calculator className="text-accent" size={20} />
            <span className="text-sm font-bold text-slate-100">NaboOrça</span>
          </div>
          <div className="w-10" /> {/* Spacer for balance */}
        </header>
      )}

      {/* Overlay for mobile */}
      {isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 animate-in fade-in duration-200"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={clsx(
        "bg-primary text-slate-300 flex flex-col h-full border-r border-slate-800 shadow-xl z-50 transition-transform duration-300",
        isMobile
          ? clsx("fixed w-72", sidebarOpen ? "translate-x-0" : "-translate-x-full")
          : "w-64 fixed"
      )}>
        <div className="flex items-center justify-between gap-3 px-4 md:px-6 h-16 border-b border-slate-800/50 bg-primary/50 backdrop-blur-sm shrink-0">
          <div
            className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => navigate('/')}
          >
            <div className="bg-accent/10 p-1.5 rounded-lg border border-accent/20">
              <Calculator className="text-accent" size={20} />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-100 leading-none tracking-tight">NaboOrça</h1>
              <p className="text-[10px] text-slate-500 font-mono mt-0.5">Engenharia de Custos</p>
            </div>
          </div>
          {isMobile && (
            <button
              onClick={() => setSidebarOpen(false)}
              className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              aria-label="Fechar menu"
            >
              <X size={20} />
            </button>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5 custom-scrollbar">
          <p className="text-[10px] uppercase text-slate-500 font-bold tracking-wider px-3 mb-2 mt-1">Visão Geral</p>
          <SidebarItem icon={LayoutDashboard} label="Dashboard" path="/" onClick={() => isMobile && setSidebarOpen(false)} />
          <SidebarItem icon={FileSpreadsheet} label="Orçamentos" path="/budgets" onClick={() => isMobile && setSidebarOpen(false)} />
          <SidebarItem icon={FileText} label="Propostas" path="/proposals" onClick={() => isMobile && setSidebarOpen(false)} />

          <p className="text-[10px] uppercase text-slate-500 font-bold tracking-wider px-3 mb-2 mt-6">Bases de Dados</p>
          <SidebarItem icon={Package} label="Banco de Insumos" path="/insumos" onClick={() => isMobile && setSidebarOpen(false)} />
          <SidebarItem icon={Layers} label="Banco de CPUs" path="/composicoes" onClick={() => isMobile && setSidebarOpen(false)} />
          <SidebarItem icon={Database} label="SINAPI Importador" path="/sinapi" onClick={() => isMobile && setSidebarOpen(false)} />

          <p className="text-[10px] uppercase text-slate-500 font-bold tracking-wider px-3 mb-2 mt-6">Ferramentas</p>
          <SidebarItem icon={GitCompare} label="Comparar" path="/compare" onClick={() => isMobile && setSidebarOpen(false)} />
          <SidebarItem icon={Search} label="Busca Global" path="/search" onClick={() => isMobile && setSidebarOpen(false)} />
          <SidebarItem icon={Users} label="Clientes" path="/clients" onClick={() => isMobile && setSidebarOpen(false)} />

          <p className="text-[10px] uppercase text-slate-500 font-bold tracking-wider px-3 mb-2 mt-6">Sistema</p>
          <SidebarItem icon={HardDrive} label="Backup" path="/backup" onClick={() => isMobile && setSidebarOpen(false)} />
          <SidebarItem icon={Settings} label="Configurações" path="/settings" onClick={() => isMobile && setSidebarOpen(false)} />
        </nav>

        <div className="p-4 border-t border-slate-800 bg-slate-900/50 shrink-0">
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              navigate('/auth');
            }}
            className="flex items-center gap-2 w-full text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 p-2 rounded-lg font-bold mb-3 transition-colors"
          >
            <LogOut size={14} /> Sair do Sistema
          </button>

          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-success shadow-[0_0_8px_rgba(16,185,129,0.4)]"></div>
            <p className="text-[10px] text-slate-500 font-mono">
              v1.2.0 <span className="text-slate-700">|</span> PROD
            </p>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className={clsx(
        "flex-1 min-w-0 bg-background transition-all duration-300",
        isMobile ? "ml-0 pt-14" : "ml-64",
        isBudgetEditor
          ? isMobile ? "h-[calc(100vh-56px)] overflow-hidden flex flex-col" : "h-screen overflow-hidden flex flex-col"
          : "min-h-screen overflow-y-auto"
      )}>
        {isBudgetEditor ? (
          children
        ) : (
          <div className="w-full p-4 md:p-8 animate-fade-in">
            {children}
          </div>
        )}
      </main>
    </div>
  );
};


import { AuthProvider } from './context/AuthContext';
import Auth from './pages/Auth';
import ProtectedRoute from './components/layout/ProtectedRoute';


import { Outlet } from 'react-router-dom';

// Wrapper component to access useAuth context inside Layout
const LayoutWrapper = () => {
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

import { enforceCanonicalDomain } from './utils/domainGuard';

function App() {
  // GUARDIAN: Ensure we are on the correct domain immediately
  useEffect(() => {
    enforceCanonicalDomain();
  }, []);

  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/auth" element={<Auth />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<LayoutWrapper />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/budgets" element={<Budgets />} />
              <Route path="/budgets/:id" element={<BudgetEditor />} />
              <Route path="/budgets/:id/schedule" element={<BudgetSchedule />} />
              <Route path="/budgets/:id/history" element={<ChangeHistory />} />
              <Route path="/budgets/:id/review" element={<ProposalReview />} />
              <Route path="/budgets/:id/scenarios" element={<ScenarioSimulator />} />
              <Route path="/compare" element={<BudgetComparison />} />
              <Route path="/search" element={<GlobalSearch />} />
              <Route path="/insumos" element={<BancoInsumos />} />
              <Route path="/composicoes" element={<BancoComposicoes />} />
              <Route path="/resources" element={<Resources />} />
              <Route path="/compositions" element={<CustomCompositions />} />
              <Route path="/backup" element={<BackupRestore />} />
              <Route path="/clients" element={<Clients />} />
              <Route path="/proposals" element={<Proposals />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/sinapi" element={<SinapiImporter />} />
              <Route path="/migrate" element={<MigrationTool />} />
              <Route path="/importacoes/:id" element={<ImportStatus />} />
              <Route path="*" element={<div className="text-center mt-20">Em desenvolvimento...</div>} />
            </Route>
          </Route>
        </Routes>
      </Router>
    </AuthProvider>
  );
}


export default App;

