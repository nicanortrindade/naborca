
export type ImportSourceRef = 'SINAPI' | 'ORSE' | 'SICRO' | 'SEINFRA' | 'SBC' | 'SEDOP' | 'PRÓPRIO';

export interface ParsedItem {
    originalIndex: number;
    itemNumber: string;
    level: number;

    code: string;
    description: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;

    // Detected source (e.g., from header or column)
    detectedSource?: string;

    // If analytical
    isComposition?: boolean;
    compositionItems?: ParsedCompositionItem[];
}

export interface ParsedCompositionItem {
    code: string;
    description: string;
    unit: string;
    quantity: number; // Coefficient
    unitPrice: number;
    totalPrice: number;
    type: 'INSUMO' | 'COMPOSICAO';
}

export type ResolutionStatus = 'LINKED' | 'NEW' | 'CONFLICT' | 'SKIPPED';

export type ConflictType = 'DESCRIPTION_MISMATCH' | 'PRICE_MISMATCH' | 'NONE';

export type ResolutionAction = 'USE_EXISTING' | 'OVERWRITE_EXISTING' | 'CREATE_NEW_VERSION' | 'CREATE_NEW_CODE' | 'ABSORB_AS_NEW' | 'IGNORE';

export interface ResolvedItem extends ParsedItem {
    status: ResolutionStatus;

    // Database linkage
    dbId?: string;
    dbType?: 'INPUT' | 'COMPOSITION';

    // If linked, these are the current DB values
    dbDescription?: string;
    dbPrice?: number;

    // Conflict handling
    conflictType: ConflictType;
    selectedAction?: ResolutionAction;

    // Final values to be used (might be DB values or Imported values)
    finalCode: string;
    finalDescription: string;
    finalPrice: number;

    // Metadata for absorption
    origin?: string;
    originalBank?: string;
    originalFile?: string;
    competence?: string; // YYYY-MM

    // Composition Flags
    compositionHasAnalytic?: boolean;
    compositionOrigin?: string;

    // Computed raw weight for SSOT
    pesoRaw?: number;
}

export interface ImportSessionState {
    fileName: string;
    referenceDate: string; // YYYY-MM (String for input type month)
    baseMode: 'MISTA' | 'FIXA';
    fixedBase?: string; // Obrigatório se baseMode=FIXA

    items: ResolvedItem[];

    step: 'UPLOAD' | 'REVIEW' | 'CONFLICTS' | 'FINISH';
    isProcessing: boolean;
}

// === NEW AI IMPORT TYPES ===

export type ImportJobStatus = 'queued' | 'processing' | 'waiting_user' | 'applying' | 'done' | 'failed' | 'waiting_user_extraction_failed' | 'waiting_user_rate_limited';

export interface ImportJob {
    id: string;
    user_id: string;
    status: ImportJobStatus;
    doc_role: 'synthetic' | 'analytical' | 'unknown';
    is_desonerado: boolean | null;
    document_context: Record<string, any> | null;
    progress: number;
    current_step: string | null;
    stage?: string;
    stage_updated_at?: string;
    last_error: string | null;
    heartbeat_at?: string;
    error_message: string | null;

    // Extraction Phase 2 Retry Mechanism
    extraction_attempts?: number;
    extraction_retryable?: boolean;
    extraction_next_retry_at?: string;
    extraction_last_reason?: string;

    created_at: string;
    updated_at: string;
}

export interface ImportFile {
    id: string;
    user_id: string;
    job_id: string;
    file_kind: 'pdf' | 'excel' | 'other';
    doc_role: 'synthetic' | 'analytical' | 'unknown';
    original_filename: string;
    content_type: string;
    storage_bucket: string;
    storage_path: string;
    created_at: string;
}

export interface AiImportItem {
    id: string;
    job_id: string;
    description_normalized: string | null;
    quantity: number | null;
    unit: string | null;
    price_selected: number | null;
    confidence_score: number | null;
    created_at: string;
}
