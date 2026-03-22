import { generateCandidatesStageA } from "./supabase/functions/import-ocr-fallback/stageA_candidates.ts";

import * as fs from 'fs';
const rawText = fs.readFileSync('/tmp/utinga_raw_text.txt', 'utf8');

function mergeWrappedLines(rawText: string): string {
    if (!rawText) return rawText;
    const isNewItemStart = (line: string): boolean => {
        const trimmed = line.trim();
        if (!trimmed) return true;
        if (/^\d/.test(trimmed)) {
            if (/^\d{1,3}\.\d{3}/.test(trimmed)) return false;
            if (/^\d+\.\d+/.test(trimmed)) return true;
            return false;
        }
        if (/^\s*(TOTAL|SUBTOTAL|BDI)\b/i.test(trimmed)) return true;
        return false;
    };
    const lines = rawText.split(/\r?\n/);
    const merged: string[] = [];
    for (const line of lines) {
        if (isNewItemStart(line) || merged.length === 0) merged.push(line);
        else merged[merged.length - 1] += ' ' + line.trim();
    }
    return merged.join('\n');
}

function normalizeColumnSpacing(text: string): string {
    let result = text;
    result = result.replace(/(\d,\d{2})(SINAPI)/gi, '$1 | $2 | ');
    result = result.replace(/(AF_\d{2}\/\d{4})\s*([A-ZÀ-Ú]{2,})/g, '$1 | $2');
    result = result.replace(/([A-ZÀ-Ú]{3,})((?:UN|M2|M3|KG|VB|CJ|PAR|PCT)(?=[\s,.\d]|$))/g, '$1 | $2');
    result = result.replace(/DRYW\s+ALL/gi, 'DRYWALL');
    result = result.replace(/(^|(?<=\s))(UN|M2|M3|KG|H|VB|CJ|L|T|PAR|PCT|M)(?=\d)/gi, '$1$2 | ');
    result = result.replace(/(\d,\d{2})([A-ZÀ-Ú])/g, '$1 | $2');
    result = result.replace(/(\d[,\.]\d+)\s*(Composição)/g, '$1 | $2');
    return result;
}

const mergedText = mergeWrappedLines(rawText);
const normalizedText = normalizeColumnSpacing(mergedText);

const result = generateCandidatesStageA(normalizedText);

console.log("=== STAGE A RESULTS ===");
console.log(`Candidates generated: ${result.candidates.length}`);
console.log(`Batches that would be created (size 20): ${Math.ceil(result.candidates.length / 20)}`);
