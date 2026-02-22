
import { z } from "https://esm.sh/zod@3.23.8";

// ------------------------------------------------------------------
// STAGE B SCHEMA: Strict Grounding & Structured Output
// ------------------------------------------------------------------

// 1. Evidence Schema (Grounding)
// Every extracted field MUST point back to a candidate and specific lines.
export const StageBEvidenceSchema = z.object({
    candidate_id: z.string().nullable().optional(), // Can be null if not found in candidates list
    evidence_lines: z.array(z.object({
        lineNo: z.number().optional().nullable(),
        text: z.string()
    })).min(1, "Must have at least one line of evidence")
});

export type StageBEvidence = z.infer<typeof StageBEvidenceSchema>;

// 2. Item Schema
// No inference. Null if not found in text.
export const StageBItemSchema = z.object({
    kind: z.enum(["synthetic_item", "analytic_line", "composition"]),
    code: z.string().nullable().optional(),
    description: z.string().min(1, "Description is mandatory"),
    unit: z.string().nullable().optional(),
    quantity: z.string().nullable().optional(),
    unit_price: z.string().nullable().optional(),
    total_price: z.string().nullable().optional(),
    item_path: z.string().nullable().optional(),
    raw_numbers: z.array(z.string()).default([]),
    evidence: StageBEvidenceSchema,
    warnings: z.array(z.string()).default([]),
    confidence_score: z.number().min(0).max(1)
});

export type StageBItem = z.infer<typeof StageBItemSchema>;

// 3. Batch Output Schema (LLM Response)
export const StageBBatchResponseSchema = z.object({
    items: z.array(StageBItemSchema),
    warnings: z.array(z.string()).optional()
});

// 4. Persistence Output Schema (Metadata)
export interface StageBOutput {
    version: "v1";
    generated_at: string;
    model: string;
    request_id?: string;

    // Results
    items: StageBItem[];
    item_count: number;
    total_batches?: number;
    debug?: any; // Detailed debug info (input sample, raw output, parser stats)

    // Diagnostics
    batches: {
        batch_index: number;
        candidates_in: number;
        items_out: number;
        error?: string;
    }[];

    warnings: string[];

    stats: {
        candidates_total: number;
        candidates_used: number;
        batches_processed: number;
        llm_tokens_used?: number;
    };
}
