/**
 * AUDIT LOG SYSTEM
 * 
 * Sistema de auditoria para rastreamento de ações críticas.
 * Preparado para compliance, segurança e análise de uso.
 */

import { supabase } from '../lib/supabase';

export type AuditAction =
    // Orçamentos
    | 'budget.create'
    | 'budget.update'
    | 'budget.delete'
    | 'budget.export.pdf'
    | 'budget.export.excel'
    | 'budget.freeze'
    | 'budget.unfreeze'

    // Propostas
    | 'proposal.create'
    | 'proposal.update'
    | 'proposal.delete'
    | 'proposal.status_change'
    | 'proposal.export'

    // Clientes
    | 'client.create'
    | 'client.update'
    | 'client.delete'

    // Autenticação
    | 'auth.login'
    | 'auth.logout'
    | 'auth.password_change'
    | 'auth.email_change'

    // Dados
    | 'data.import'
    | 'data.export'
    | 'data.backup'
    | 'data.restore'

    // Sistema
    | 'system.settings_change'
    | 'system.plan_upgrade'
    | 'system.plan_downgrade'

    // Segurança
    | 'security.unauthorized_access'
    | 'security.suspicious_activity'
    | 'security.data_breach_attempt';

export type AuditSeverity = 'info' | 'warning' | 'critical';

export interface AuditLogEntry {
    id?: string;
    user_id: string;
    action: AuditAction;
    severity: AuditSeverity;
    resource_type?: string; // 'budget', 'proposal', 'client', etc.
    resource_id?: string;
    details?: Record<string, any>;
    ip_address?: string;
    user_agent?: string;
    created_at?: string;
}

/**
 * Registrar ação no log de auditoria
 */
export async function logAudit(entry: Omit<AuditLogEntry, 'id' | 'created_at' | 'user_id'>): Promise<void> {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            console.warn('Audit log: User not authenticated');
            return;
        }

        // TODO: Quando criar tabela 'audit_logs' no Supabase, descomentar:
        /*
        await supabase.from('audit_logs').insert({
            user_id: user.id,
            action: entry.action,
            severity: entry.severity,
            resource_type: entry.resource_type,
            resource_id: entry.resource_id,
            details: entry.details,
            ip_address: entry.ip_address,
            user_agent: entry.user_agent,
            created_at: new Date().toISOString()
        });
        */

        // Por enquanto, apenas log no console (desenvolvimento)
        if (process.env.NODE_ENV === 'development') {
            console.log('[AUDIT]', {
                user_id: user.id,
                timestamp: new Date().toISOString(),
                ...entry
            });
        }
    } catch (error) {
        console.error('Failed to log audit entry:', error);
        // Não lançar erro para não quebrar fluxo da aplicação
    }
}

/**
 * Helpers para ações comuns
 */
export const AuditLogger = {
    // Orçamentos
    budgetCreated: (budgetId: string, budgetName: string) =>
        logAudit({
            action: 'budget.create',
            severity: 'info',
            resource_type: 'budget',
            resource_id: budgetId,
            details: { name: budgetName }
        }),

    budgetUpdated: (budgetId: string, changes: Record<string, any>) =>
        logAudit({
            action: 'budget.update',
            severity: 'info',
            resource_type: 'budget',
            resource_id: budgetId,
            details: { changes }
        }),

    budgetDeleted: (budgetId: string, budgetName: string) =>
        logAudit({
            action: 'budget.delete',
            severity: 'warning',
            resource_type: 'budget',
            resource_id: budgetId,
            details: { name: budgetName }
        }),

    budgetExportedPDF: (budgetId: string, budgetName: string) =>
        logAudit({
            action: 'budget.export.pdf',
            severity: 'info',
            resource_type: 'budget',
            resource_id: budgetId,
            details: { name: budgetName, format: 'pdf' }
        }),

    budgetExportedExcel: (budgetId: string, budgetName: string, type: 'synthetic' | 'analytic') =>
        logAudit({
            action: 'budget.export.excel',
            severity: 'info',
            resource_type: 'budget',
            resource_id: budgetId,
            details: { name: budgetName, format: 'excel', type }
        }),

    // Propostas
    proposalCreated: (proposalId: string, proposalName: string) =>
        logAudit({
            action: 'proposal.create',
            severity: 'info',
            resource_type: 'proposal',
            resource_id: proposalId,
            details: { name: proposalName }
        }),

    proposalStatusChanged: (proposalId: string, oldStatus: string, newStatus: string) =>
        logAudit({
            action: 'proposal.status_change',
            severity: 'info',
            resource_type: 'proposal',
            resource_id: proposalId,
            details: { old_status: oldStatus, new_status: newStatus }
        }),

    // Clientes
    clientCreated: (clientId: string, clientName: string) =>
        logAudit({
            action: 'client.create',
            severity: 'info',
            resource_type: 'client',
            resource_id: clientId,
            details: { name: clientName }
        }),

    clientDeleted: (clientId: string, clientName: string) =>
        logAudit({
            action: 'client.delete',
            severity: 'warning',
            resource_type: 'client',
            resource_id: clientId,
            details: { name: clientName }
        }),

    // Dados
    dataImported: (type: string, count: number) =>
        logAudit({
            action: 'data.import',
            severity: 'info',
            details: { type, count }
        }),

    dataExported: (type: string, count: number) =>
        logAudit({
            action: 'data.export',
            severity: 'info',
            details: { type, count }
        }),

    // Segurança
    unauthorizedAccess: (resource: string, attemptedAction: string) =>
        logAudit({
            action: 'security.unauthorized_access',
            severity: 'critical',
            details: { resource, attempted_action: attemptedAction }
        }),

    suspiciousActivity: (description: string, details?: Record<string, any>) =>
        logAudit({
            action: 'security.suspicious_activity',
            severity: 'critical',
            details: { description, ...details }
        })
};

/**
 * Obter logs de auditoria (para admin/dashboard futuro)
 */
export async function getAuditLogs(filters?: {
    userId?: string;
    action?: AuditAction;
    resourceType?: string;
    resourceId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
}): Promise<AuditLogEntry[]> {
    // TODO: Implementar quando criar tabela 'audit_logs'
    /*
    let query = supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false });

    if (filters?.userId) query = query.eq('user_id', filters.userId);
    if (filters?.action) query = query.eq('action', filters.action);
    if (filters?.resourceType) query = query.eq('resource_type', filters.resourceType);
    if (filters?.resourceId) query = query.eq('resource_id', filters.resourceId);
    if (filters?.startDate) query = query.gte('created_at', filters.startDate.toISOString());
    if (filters?.endDate) query = query.lte('created_at', filters.endDate.toISOString());
    if (filters?.limit) query = query.limit(filters.limit);

    const { data, error } = await query;
    if (error) throw error;
    return data;
    */

    return [];
}

/**
 * Obter estatísticas de uso (para analytics futuro)
 */
export async function getUsageStats(userId: string, period: 'day' | 'week' | 'month' | 'year'): Promise<{
    budgetsCreated: number;
    proposalsGenerated: number;
    exportsPerformed: number;
    clientsAdded: number;
    mostUsedFeatures: { feature: string; count: number }[];
}> {
    // TODO: Implementar agregação de logs
    return {
        budgetsCreated: 0,
        proposalsGenerated: 0,
        exportsPerformed: 0,
        clientsAdded: 0,
        mostUsedFeatures: []
    };
}
