// ============================================================
// LEGACY MIGRATION SERVICE - NO LONGER USED
// ============================================================
// This service was used to migrate data from local IndexedDB (Dexie.js)
// to Supabase cloud database. The migration has been completed and
// all data is now stored exclusively in Supabase.
//
// This file is kept for reference purposes only.
// DO NOT USE - ALL DATA OPERATIONS SHOULD USE SUPABASE SERVICES:
// - BudgetService
// - BudgetItemService
// - InsumoService
// - CompositionService
// - ClientService
// - CompanyService
// - ProposalService
// - ChangeLogService
// - BudgetScheduleService
// ============================================================

export const MigrationService = {
    // Migration completed - service deprecated
    async migrateAll(_userId: string, onProgress: (msg: string) => void) {
        onProgress('Migração não necessária - dados já estão no Supabase.');
        return { success: true, message: 'Dados já migrados para o Supabase.' };
    }
};
