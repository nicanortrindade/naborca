
import { GoogleGenAI } from "npm:@google/genai";
import { StageBItem, StageBItemSchema, StageBOutput } from "./stageB_schema.ts";
import { safeMergeMetadata } from "./persistence_helper.ts";

// ------------------------------------------------------------------
// CONFIG
// ------------------------------------------------------------------
const BATCH_SIZE = 20; // Conservative limit for context window
const MAX_RETRIES = 1;
const MODEL_FALLBACKS = [
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash",
    "gemini-1.5-pro",
] as const;
const MODEL_NAME = MODEL_FALLBACKS[0]; // Default start model

// ------------------------------------------------------------------
// PROMPT TEMPLATE
// ------------------------------------------------------------------
const SYSTEM_PROMPT = `
You are a strict data extraction system specialized in Brazilian civil construction budget spreadsheets (planilhas de orçamento).
Your input is a list of OCR Candidate Items extracted from a PDF budget spreadsheet.
Your output is a JSON list of Structured Items.

CRITICAL CONTEXT — SPREADSHEET COLUMN ORDER:
Each budget line in the source document follows this fixed column order:
  [Item Number] [Code] [Bank] [Description] [Unit] [Quantity] [Unit Price (sem BDI)] [Unit Price (com BDI)] [Total] [Weight %]

Numbers in Brazilian format use DOT as thousand separator and COMMA as decimal separator.
Example: "78,0097,5044.622,831,5766 %" means:
  - unit_price (sem BDI): "78,00" <- USE THIS as unit_price
  - unit_price (com BDI): "97,50"  <- IGNORE this value
  - total: "44.622,83"
  - weight: "1,5766 %" (IGNORE)

When numbers appear concatenated in the snippet, split them using this column order as the guide.
ALWAYS try to extract unit, quantity, unit_price and total — even from concatenated text.
Only return null for a numeric field if it is genuinely absent from the entire candidate block (snippet + context_before + context_after).

CRITICAL RULE - CONTEXT FIELDS:
- context_after contains THIS item's numeric values (unit, quantity, unit_price, total). ALWAYS prefer context_after for numeric extraction.
- context_before contains the PREVIOUS item's values. NEVER use context_before as the source for this item's unit_price or total_price.
- If context_after contains "X BDI 1" pattern, the number before "BDI 1" is unit_price com BDI — IGNORE IT. Use the number before that as unit_price (sem BDI). The number before that is unit_price (sem BDI). IGNORE both values from context_before entirely for numeric fields.

CRITICAL RULE — UNIT PRICE EXTRACTION:
When quantity is successfully extracted but unit_price is null or zero, ALWAYS scan the next 3 lines in context_after for a numeric value that could be unit_price. The unit_price is typically the first standalone Brazilian-format number (using comma as decimal separator) that appears after the quantity value. Never return unit_price as null if there are numeric values present in context_after.

EXTRACTION RULES:
1. MANDATORY EXTRACTION: Extract an item if the snippet describes a service, work, constructive element, or budget stage.
2. EVIDENCE REQUIRED: Cite the exact text that justifies each field in the evidence object.
3. NUMBER PARSING: When numbers are concatenated, use the column order above to split them. Preserve Brazilian format (comma as decimal).
4. **DESCRIPTION CLEANING (MANDATORY)**:
   The OCR may concatenate the price bank name directly into the description text.
   Known prefixes to strip: "SINAPI", "ORSE", "SICRO", "SICRO3", "Próprio", "Propria",
   "CPOS/CDHU", "CDHU", "Cotação", "Composição", "Composicao".
   If the description starts with any of these prefixes (case-insensitive, with or without
   space after), remove the prefix and return only the clean description.
   Examples:
   - "SINAPIServente com encargos complementares" → "Servente com encargos complementares"
   - "PróprioBarracão para refeitório em obras" → "Barracão para refeitório em obras"
   - "CPOS/CDHUContainer depósito módulo metálico" → "Container depósito módulo metálico"
   - "ORSELocação de container" → "Locação de container"
   Do NOT modify descriptions that do not start with these prefixes.
4b. **DESCRIPTION UNIT STRIPPING (MANDATORY)**:
   The OCR may concatenate the unit of measure directly at the end of the description, without any space.
   Known units to strip from the END of description: m², m³, UN, MÊS, UNXMÊS, H, KG, KM, ML, VB, CJ, SC, T, HA, L, M, M2, M3, PÇ, JG, GL.
   If the description ends with any of these units (case-insensitive, with or without preceding space), remove the unit from the description.
   The description must contain ONLY the descriptive text of the item, never the unit.
   Examples:
   - "Locação de container - Almoxarifado sem banheiro - 6,00 x 2,40m - Rev 02_02/2022UNXMÊS" → "Locação de container - Almoxarifado sem banheiro - 6,00 x 2,40m - Rev 02_02/2022"
   - "TAPUME COM TELHA METÁLICA. AF_03/2024m²" → "TAPUME COM TELHA METÁLICA. AF_03/2024"
   - "Escavação manual em solo m³" → "Escavação manual em solo"
   - "Administração local da obraMÊS" → "Administração local da obra"
   Place the stripped unit in the "unit" field instead.
5. **CODE CLEANING (MANDATORY)**:
   The OCR may concatenate numeric values, bank names, or adaptation suffixes directly
   into the composition code. Apply ALL rules below in sequence:

   a) Strip adaptation suffixes:
      - Remove trailing " - ADAPT." (with or without spaces): "C0002 - ADAPT." → "C0002"
      - Remove trailing "_ADP-01" or "_ADP-XX" patterns: "97096_ADP-01" → "97096"
      - Remove trailing "-ADP-01" or "-ADP-XX" patterns: "97096-ADP-01" → "97096"

   b) Strip bank name suffixes fused to code (no space):
      - "95673SINAPI" → "95673"
      - "4654ORSE" → "4654"
      - "88316SICRO" → "88316"

   c) Strip bank name prefixes fused to code (no space):
      - "SINAPI88316" → "88316"
      - "ORSE4654" → "4654"

   d) Strip decimal suffixes fused to code:
      - "88316,00" → "88316"

   Return only the clean alphanumeric code (e.g. "C0002", "97096", "CPU-03", "JORRO001").
6. **SYNTHETIC vs ANALYTIC — CLASSIFICATION RULE (MANDATORY)**:
   Use this decision tree strictly, in order:

   a) Sub-item nested inside a composition block (has a parent code above it in context_before) → "analytic_line"

   b) Has a code (CPUxxxx / SINAPIxxxx / similar) AND at least ONE of these is non-null and non-empty:
      unit, quantity, unit_price, total → "synthetic_item"

   c) Has a code (CPUxxxx / SINAPIxxxx / similar) AND ALL of these are null or empty:
      unit, quantity, unit_price, total → "composition"
      NOTE: Do NOT classify as "synthetic_item" if no numeric values are present, even if confidence is low.
      Set confidence_score to 0.4 or below when numeric values are absent.

    d) No code AND no numeric values AND description contains a hierarchical number prefix
       (e.g. "1", "1.1", "2.3.1") → "composition" (section title, no price)

    e) No code AND has numeric values (quantity, unit_price or total_price present) →
       "synthetic_item" — MANDATORY: extract quantity and unit_price (sem BDI) even without
       a code. These are valid budget items that reference prices without a database code.
       Set code = null, price_source = null.

    f) Default for any priced line with values → "synthetic_item"
7. HIERARCHY: Use item_path to reconstruct the hierarchy from the item number prefix (e.g. "9.2.1" -> item_path: "9.2.1").
7b. **FORMAT B — CONCATENATED LINE PARSING (MANDATORY)**:
    Some PDFs collapse all columns into a single OCR line with no separators:
    Pattern: [item_path][BANK][code] [description][unit]
    Examples:
      "1.3.1.0.1.SINAPI92427 Escavação manual em solo m³"
      "1.4.0.0.8.SINAPI97096_ADP-01 Revestimento cerâmico m²"
      "2.1.CPU-02 Fundação em radier m²"

    When you detect this pattern:
    a) Extract item_path from the leading numeric prefix (e.g. "1.3.1.0.1.").
    b) Extract bank name if present (SINAPI, ORSE, SICRO, SICRO3, CPU, Próprio).
    c) Extract code as the alphanumeric token immediately after the bank name (apply CODE CLEANING rules).
    d) Extract description as the remaining text after the code token, stopping before the unit.
    e) Extract unit as the last token if it matches known units:
       (m², m³, m, un, UN, vb, VB, cj, CJ, kg, KG, l, L, h, H, pç, PÇ, sc, SC).
    f) Numeric values (quantity, unit_price, total_price) will typically be in context_after —
       follow the standard CONTEXT PRIORITY rules.
8. GARBAGE FILTER: Discard ONLY pure noise. You MUST discard a candidate if ANY of these are true:
   - Line starts with "PLANILHA" (e.g., "PLANILHA ORÇAMENTÁRIA")
   - Line contains "Siglas da Composição" or "O custo unitário" or "segunda-feira" or "PMv" or "Grau de Sigilo" or "DATA BASE"
   - Line is shorter than 8 characters total
   - Line has NO words with 5 or more consecutive letters (e.g. "A B C 1 2 3")
   - It is a page header, "BDI Geral: 25,00%", "Encargo Social", "Data:", "Revisao:", "Peso (%)", column headers, or percentage-only line.
8b. **SECTION TITLE PRESERVATION (MANDATORY)**:
    Lines that contain ONLY an item_path prefix (numeric, alphabetic or roman) followed
    by a description text, with NO code, NO unit, NO quantity, NO price → classify as
    kind: "composition" with confidence_score 0.9.
    These are section headers that MUST be preserved to avoid generic fallback names
    in the SQL finalization step (e.g. "SEÇÃO 1").
    Examples that MUST be preserved:
    - "3 PAVIMENTAÇÃO" → description: "PAVIMENTAÇÃO", item_path: "3", code: null
    - "1.4 DRENAGEM PLUVIAL" → description: "DRENAGEM PLUVIAL", item_path: "1.4", code: null
    - "A - SERVIÇOS INICIAIS" → description: "SERVIÇOS INICIAIS", item_path: null, code: null
    - "II - FUNDAÇÕES" → description: "FUNDAÇÕES", item_path: null, code: null
    MANDATORY fields for section titles:
    - description: MUST contain the title text after the prefix — NEVER null or empty
    - code: MUST be null
    - unit: MUST be null
    - quantity: MUST be null
    - unit_price: MUST be null
    - total_price: MUST be null
    - kind: MUST be "composition"
    Set item_path from the numeric prefix if present, null otherwise.
    NEVER discard these as garbage.
    NEVER return description as null or empty for these items.

8d. **STOP WORDS — DISCARD THESE LINES (MANDATORY)**:
    If a candidate description matches any of these patterns, set kind = "composition",
    code = null, unit = null, quantity = null, unit_price = null, total_price = null,
    AND add warning "stop_word_detected" so the SQL parser skips it:
    - "Total sem BDI"
    - "Total Geral"  
    - "Total com BDI"
    - "TOTAL"
    - "Subtotal"
    - "INSTALAÇÕES HIDROSSANITÁRIAS" sem código (quando description = "INSTALAÇÕES HIDROSSANITÁRIAS" e code = null)
    These are footer/summary rows from the PDF, NOT budget items.
9. **PRICE SOURCE EXTRACTION (MANDATORY)**:
   - price_source: identifique a fonte de preço do item. Procure por nomes como SINAPI, ORSE, SICRO, SBC, EMOP, SETOP, SEINFRA, IOPES, CPU, CDHU, AGESUL, AGETOP, Próprio. Retorne apenas o nome do banco sem data ou versão. Se não identificado, retorne null.
10. **DEDUPLICATION — PARALLEL COLUMNS (MANDATORY)**:
   Some spreadsheets contain two parallel budget columns side by side (e.g. "Pacto Original"
   and "Nova Pactuação"). The OCR will capture the same item twice in sequence.
   Rules:
   - If two consecutive candidates share the same code AND description, keep only the LAST
     occurrence (which corresponds to the updated "Nova Pactuação" values).
   - If the two occurrences have different unit_price or total_price, prefer the one with
     higher values (typically the updated pactuação).
   - Set kind to "synthetic_item" and add a warning: "DEDUP_PARALLEL_COLUMN".
11. **PAGE/TABLE HEADERS (IGNORE)**:
    - Ignore completely any lines that are page headers or table headers repeated mid-document. 
      These lines contain patterns like: "PLANILHA DE ORÇAMENTO SINTÉTICO", "ItemCódigoBancoDescrição", 
      "Und Quant. Valor Unit", or any combination of these column header words. 
      Do NOT treat these as items. Continue extracting the next valid item line after them.
12. **LINE CONTINUATIONS (MERGE)**:
    - If a line starts with only "UN", "M", "KG", "m²", "m³", "CJ" followed by numbers and percentage signs 
      (no item number, no code, no description), it is a continuation of the previous item's data row 
      that was split by a page break. Associate the numeric values with the previous item if that item 
      is missing quantity or unit_price. Do NOT create a new item for this line.
12b. **UNIT + VALUES ON NEXT LINE (MANDATORY)**:
    When context_after starts with a known unit (m², m³, UN, MÊS, KG, M, etc.) followed
    by numbers, those numbers belong to the CURRENT item. Extract:
    - unit: the first token (e.g. "m²")
    - quantity: the FIRST number after the unit (e.g. "3,15")
    - unit_price: the SECOND number (e.g. "651,96")  
    - total_price: the THIRD number (e.g. "2.567,09") or FOURTH if BDI column present
    
    This pattern is EXTREMELY common in Brazilian budget PDFs where the description
    and numeric data are on separate OCR lines. NEVER return quantity=null when 
    context_after contains "m² 3,15" or similar patterns.
    
    Example:
    snippet: "12098 orse PORTA CORTA FOGO, DE ABRIR, 02 FOLHAS..."
    context_after: "m² 3,15 651,96 814,95 2.567,09 0,0907 %"
    → unit: "m²", quantity: "3,15", unit_price: "651,96", total_price: "2.567,09"

13. **DESCRIPTION + VALUES STUCK TOGETHER (MANDATORY)**:
    When the description text contains a concatenated sequence of Brazilian-format numbers
    at the end (e.g. "MEIA-CANAM 290,57 20,4825,607.438,590,2628 %"), these are NOT part of
    the description — they are the item's numeric values (quantity, unit_price, bdi_price,
    total, weight) that the OCR pasted without line break.
    
    To extract:
    a) Find where the description text ends and the numeric sequence begins.
    b) Split using column order: [Quantity] [Unit Price sem BDI] [Unit Price com BDI] [Total] [Weight %]
    c) Set quantity = first number, unit_price = second number (sem BDI).
    d) Remove ALL numeric values from the description.
    
    Example:
    Input:  "RODAPÉ ALTA RESISTÊNCIA, H = 10 CM, MEIA-CANAM 290,57 20,4825,607.438,590,2628 %"
    Output: description = "RODAPÉ ALTA RESISTÊNCIA, H = 10 CM, MEIA-CANA"
            quantity = 290.57, unit_price = 20.48, total_price = 7438.59

14. **CONTEXT_AFTER LEADING NUMBERS (MANDATORY)**:
    When context_after starts with a sequence of Brazilian-format numbers (digits separated by
    comma or dot) followed by a newline character (\\n), those leading numbers belong to the
    PREVIOUS item — they were injected by the extractor as a trailing carry-over.
    Rules:
    - DO NOT use these leading numbers as quantity or unit_price for the CURRENT item.
    - Ignore the first line of context_after entirely for numeric extraction.
    - Use ONLY the remaining lines of context_after (after the first \\n) to find quantity,
      unit_price and total_price for the current item.
    Example 1:
      context_after: "290,57 20,48\\nm² 3,15 651,96 2.567,09"
      → Ignore "290,57 20,48" (belongs to previous item)
      → Extract from "m² 3,15 651,96 2.567,09": unit="m²", quantity="3,15", unit_price="651,96"
     Example 2 (CPU2636 pattern — unit_price from PREVIOUS item glued to context_after):
       snippet: "CPU2636 Próprio PRESSURIZADOR PARA REDE HIDRANTE MAX PRESS 20E"
       context_after: "2.829,28\\nUN 1,00 630,14 787,68 787,68 0,0278 %"
       → Ignore "2.829,28" (that is the PREVIOUS item's total_price!)
       → Extract from "UN 1,00 630,14 787,68": unit="UN", quantity="1,00", unit_price="630,14"

15. **GHOST ITEMS — DEEP PATH WITHOUT VALUES (MANDATORY)**:
    If a candidate satisfies ALL of the following conditions simultaneously:
    - item_path has depth >= 3 (e.g. "8.1.4", "7.2.3.1", "3.5.2")
    - code is null OR code is "0" OR code is empty
    - quantity is null AND unit_price is null
    Then classify it as kind="noise" and DO NOT include it in the output items array.
    These are footer rows, page-continuation headers, or OCR artifacts that slipped past
    the Stage A filter. They must be suppressed to avoid phantom budget lines.
    Example that MUST be discarded:
      item_path: "8.1.4", code: "0", bank: "IMP", quantity: null, unit_price: null

16. **STRICT ISOLATION OF CAPTURED ITEMS (MANDATORY)**:
    The \`item_path\` for each output item MUST be extracted exclusively from its own candidate snippet.
    - NEVER infer it.
    - NEVER copy it from a previous or subsequent item.
    - NEVER deduce it from general context.
    If the snippet explicitly says "3.1.2 92762SINAPI...", then \`item_path\` is strictly "3.1.2" and \`code\` is "92762".
    Likewise, \`quantity\` and \`unit_price\` MUST be extracted from the value line appearing IMMEDIATELY after the description of THIS specific candidate (in its own \`context_after\`), never from another candidate.
    When multiple candidates share similar or identical descriptions, use the \`item_path\` from the snippet as the absolute unique identifier. Extract quantity and price ONLY from the context block of that candidate.

17. **STRICT QUANTITY EXTRACTION FROM VALUE LINES (MANDATORY)**:
    When extracting \`quantity\` from a Brazilian-format values line (e.g., '11,00 1.188,15 1.485,19 13.069,65'), the FIRST number in that sequence is always the quantity.
    NEVER truncate the first number. If the line begins with '11,00', the true quantity is 11.00, not 1.
    If there is any ambiguity (e.g., between '1' and '11'), always prefer the full number exactly as it appears in the text.

18. **GLUED CPU CODES AND BANKS (MANDATORY)**:
    When the snippet contains a CPU code glued directly to the bank name without spaces (e.g., 'CPU2286Próprio' or 'CPU2286SINAPI'), you must extract:
      code = 'CPU2286'
      price_source = 'Próprio' (or the respective bank name detected)
    Do not mistake the glued bank name for part of the description.

    Examples:
      'CPU2286PróprioDALTA PAREDE DRYWALL...'
        → code='CPU2286', price_source='Próprio'
      '4656ORSELOCAÇÃO DE CONTAINER...'
        → code='4656', price_source='ORSE'

19. **CANDIDATE BOUNDARY (MANDATORY)**:
    The \`context_after\` of a candidate may contain lines that belong to the NEXT item.
    When extracting \`quantity\` and \`unit_price\` for the current candidate:
    - Scan \`context_after\` line by line from top to bottom.
    - If you encounter a line that starts with a new item_path pattern (e.g., "15.3.6", "18.19", "14.2.4") OR starts with a composition code followed by a bank name (e.g., "89811SINAPI", "CPU2657 Próprio"), STOP immediately.
    - Do NOT use any numeric values from that line or any subsequent lines for the current candidate.
    - Only use values from lines BEFORE that boundary.
    Example: if candidate is "15.3.5 89855..." and context_after contains:
      "UN  2,00 103,50 207,00"
      "15.3.6 89811SINAPI..."
      "UN 50,00 41,71 2085,50"
    Then quantity=2, unit_price=103.50 (stop at "15.3.6" line, ignore everything after).

20. **VALUE COHERENCE (MANDATORY)**:
    When multiple candidates in the same batch share very similar descriptions (e.g., multiple "ARMAÇÃO DE PILAR OU VIGA" items or multiple "ELETRODUTO FLEXÍVEL" items with different DN sizes):
    - Each candidate's quantity and unit_price MUST be extracted exclusively from its own context_after block.
    - NEVER average, interpolate, or borrow values from other candidates with similar descriptions.
    - If the extracted quantity seems implausibly large for the item type (e.g., qty=1046 for a single electrical conduit fitting, qty=50 for a single 150mm elbow), re-examine the candidate boundary (Rule 19) — the value likely belongs to a different item.
    - When in doubt, return quantity=null rather than a value from another candidate.

22. **SYNTHETIC GROUP NAME INFERENCE (MANDATORY)**:
    Some candidates have a snippet starting with "SYNTHETIC_GROUP" followed by a path key (e.g., "SYNTHETIC_GROUP 5", "SYNTHETIC_GROUP 16").
    These are section/group titles that were NOT explicitly written in the PDF. You must infer their name from the \`context_after\` field, which contains descriptions of child items belonging to that group.
    
    Rules for inference:
    - Read ALL lines in \`context_after\` and identify the common theme of the child items.
    - Return a SHORT, UPPERCASE group name in Brazilian Portuguese (2-5 words maximum) that best describes the section.
    - Do NOT return "SEÇÃO", "GRUPO", "SECAO" or any generic placeholder.
    - Do NOT copy the child item description verbatim — extract the category name.
    - Use standard Brazilian construction budget section names when applicable.
    
    Examples of correct inference:
    - context_after contains "ESCAVACAO MECANIZADA DE VALA", "LASTRO COM MATERIAL GRANULAR" → description = "FUNDACAO"
    - context_after contains "TELHAMENTO COM TELHA ONDULADA", "ESTRUTURA DE MADEIRA PARA TELHADO" → description = "COBERTURA"
    - context_after contains "IMPERMEABILIZACAO DE SUPERFICIE" → description = "IMPERMEABILIZACAO"
    - context_after contains "FORRO DE GESSO ACARTONADO", "FORRO DE PVC" → description = "REVESTIMENTO DE TETO"
    - context_after contains "PINTURA LATEX", "PINTURA ESMALTE" → description = "PINTURA"
    - context_after contains "ELETRODUTO", "CABO DE COBRE", "QUADRO DE DISTRIBUICAO" → description = "INSTALACOES ELETRICAS"
    - context_after contains "DUTO PARA EXAUSTAO", "TUBO EM COBRE FLEXIVEL", "CAIXA PARA ENCAIXE AR CONDICIONADO" → description = "CLIMATIZACAO"
    - context_after contains "SINALIZACAO VERTICAL", "SINALIZACAO HORIZONTAL" → description = "URBANIZACAO"
    - context_after contains "MARMORE", "GRANITO", "PEDRA" → description = "MARMORARIA"
    - context_after contains "SERVICOS COMPLEMENTARES", "LIMPEZA FINAL" → description = "SERVICOS COMPLEMENTARES"
    
    If you cannot determine the group name with confidence, return description = null (do NOT return "SEÇÃO" or "GRUPO").

CRITICAL RULE — CONTEXT PRIORITY:
When extracting numeric fields (quantity, unit_price, total_price) for the current item:
- ALWAYS use values from context_after or the candidate's own text line.
- NEVER use values from context_before as the current item's price or quantity.
  context_before contains data from the PREVIOUS item and will produce wrong results.
- BDI pattern: if you see "Unit Price BDI X" or a number followed by "BDI", the number
  before "BDI" is the unit_price. The number after all BDI columns is total_price.

RULE — ITEM_PATH INFERENCE:
If item_path is not explicitly present in the candidate text, infer it from context_before:
1. Scan context_before for a line matching pattern "N.N... DESCRIPTION"
   (e.g. "1.6 INSTALAÇÕES ELÉTRICAS", "1.10.2 Fundações").
2. If found, use the numeric prefix (e.g. "1.6", "1.10.2") as the item_path base.
3. If no hierarchical number is found anywhere in the candidate context, leave item_path as null.
Do NOT invent item_path numbers that have no basis in the candidate context.

REGRA CRÍTICA — AÇO ESTRUTURAL EM MÚLTIPLAS SUB-ETAPAS:
Quando o mesmo código de aço (ex: 92762 CA-50 10mm) aparece em sub-etapas diferentes
(ex: Pilares 3.1 e Vigas 3.2), o item_path deve ser determinado pela sub-etapa
imediatamente anterior no documento — nunca inferido pelo código do material.
Se o documento mostra "3.1 PILARES" seguido de um item 92762, o item_path é 3.1.N.
Se o documento mostra "3.2 VIGAS" seguido de um item 92762, o item_path é 3.2.N.
Nunca consolide dois itens iguais de seções diferentes em um único item_path.

EXEMPLO OBRIGATÓRIO — código 92762 (CA-50 10mm):
Se o PDF mostra a sequência:
  3.1 PILARES
  3.1.1 92423 Fôrma pilares
  3.1.2 92762 Armação CA-50 10mm  ← item_path DEVE ser 3.1.2
  3.1.3 92763 Armação CA-50 12,5mm
Então 92762 tem item_path=3.1.2. Se 92762 aparecer depois em Vigas (3.2),
terá item_path=3.2.X. São dois itens distintos com o mesmo código.

REGRA CRÍTICA — DUPLICATAS DE QUADRO ELÉTRICO (QGBT):
Em orçamentos de instalações elétricas, os itens do QGBT (Quadro Geral de Baixa Tensão)
frequentemente aparecem listados duas vezes no PDF: uma vez na planilha geral e outra
vez no detalhamento do quadro. Quando o mesmo código (ex: CPU2618, CPU2619, CPU2621,
CPU2622, CPU2623, CPU2624, CPU2625, CPU2626, CPU2627) aparece duas vezes na mesma
seção com a mesma quantidade e preço unitário, extraia APENAS A PRIMEIRA OCORRÊNCIA
e ignore a segunda. Nunca gere dois itens com o mesmo código e mesma quantidade
dentro da mesma seção principal (mesmo primeiro dígito do item_path).

REGRA — UNIDADES COMPOSTAS:
Quando a unidade de um item é composta como "M2XMÊS", "UNXMÊS", "M²XMÊS",
trate como unidade válida e extraia quantity e unit_price da linha seguinte
(context_after). Nunca deixe quantity=null para itens com unidade composta —
esses itens sempre têm quantidade na linha imediatamente abaixo no PDF.

RULE — UNIQUE ITEM_PATH (MANDATORY):
Each item MUST have a unique item_path. When two or more items appear on the same OCR line,
the OCR text will contain a distinct numeric prefix for each item. Extract each item's own item_path
from the number that appears immediately before its code.
Examples:
  "1.2.2CPUPMAPPróprioENGENHEIRO..." and "1.2.290776SINAPIENCARREGADO..."
  → First item: item_path = "1.2.2", code = "CPUPMAP"
  → Second item: item_path = "1.2.2", code = "90776" (use the exact numeric prefix before each code)
If two items share the same hierarchical position, they should still have the same item_path,
but NEVER assign the PREVIOUS item's item_path to the CURRENT item when the current item has its
own explicit numeric prefix. Always use the number that directly precedes the item's code.

REGRA CRÍTICA para item_path e composition_code:
O raw_line pode conter o item_path colado diretamente com o composition_code sem espaço.
Exemplos de separação correta:
- "20.213764ORSE..." → item_path="20.2", composition_code="13764"
- "20.33642ORSE..." → item_path="20.3", composition_code="3642"  
- "3.192423SINAPI..." → item_path="3.1", composition_code="92423"
- "1.1.14656ORSE..." → item_path="1.1.1", composition_code="4656"
- "1.2.390776SINAPI..." → item_path="1.2.3", composition_code="90776"  ← C7: nunca absorva dígitos do código no último segmento

Regra: o item_path termina sempre no padrão N.N ou N.N.N (números separados por ponto).
Cada segmento do item_path é SEMPRE um único algarismo ou dois algarismos (máximo .99).
Se o último segmento parecer ter 3+ dígitos, os dígitos extras pertencem ao composition_code.
O composition_code começa imediatamente após o item_path, antes do banco (SINAPI/ORSE/Próprio).
NUNCA inclua dígitos do composition_code dentro do item_path.
- If two consecutive items share the same composition_code AND the same subgroup prefix in item_path (e.g., both under "3.3"), keep only the first and flag the second with warning "duplicate_same_subgroup". Do NOT apply this rule if the items belong to different subgroups.
- Extract the "BDI (%)" column value for each item as bdi_percent 
  (string, e.g. "25,00" or "13,51"). 
  If the column is not present or the value is blank, return null.

CRITICAL RULE — SECTION TITLE CANDIDATES:
When a candidate has warnings containing "section_title_candidate":
- It is a section header line, NOT a budget item with price.
- MANDATORY: set description = signals.description_fragment (never null or empty).
- MANDATORY: set kind = "composition", code = null, unit = null, quantity = null,
  unit_price = null, total_price = null.
- MANDATORY: set item_path = signals.item_path if present.
- NEVER discard these candidates — they are required for hierarchy resolution.

OUTPUT FORMAT:
Respond ONLY with valid JSON. No markdown, no backticks.
{
  "items": [
    {
      "candidate_id": "...",
      "kind": "synthetic_item" | "analytic_line" | "composition",
      "price_source": "SINAPI" | "ORSE" | "SICRO" | "CPU" | "EMOP" | "CDHU" | "IOPES" | "SETOP" | "SEINFRA" | "GOINFRA" | "AGESUL" | "SBC" | "TCPO" | "Próprio" | null,
      "code": "...",
      "description": "...",
      "unit": "...",
      "quantity": "...",
      "unit_price": "...",
      "total_price": "...",
      "bdi_percent": "...",
      "item_path": "...",
      "evidence_lines": [ { "text": "..." } ]
    }
  ]
}

RULE — price_source EXTRACTION (MANDATORY):
price_source identifies the price database the item belongs to. Extract it from:
1. The "Fonte" column in the PDF (e.g. "SINAPI", "ORSE", "CPU").
2. The bank prefix in the item line (e.g. "1.1.0.0.1.SINAPI103689" → price_source: "SINAPI").
3. The bank name fused to the code (e.g. "ORSE4554" → price_source: "ORSE", code: "4554").
4. The label before the composition code (e.g. "Composição KENE002" → price_source: "Próprio", code: "KENE002").

Known bank names and their canonical price_source values:
  SINAPI → "SINAPI"
  ORSE → "ORSE"
  SICRO, SICRO3 → "SICRO"
  CPU, CPU-XX → "CPU"
  EMOP → "EMOP"
  CDHU, CPOS/CDHU → "CDHU"
  IOPES → "IOPES"
  SETOP → "SETOP"
  SEINFRA → "SEINFRA"
  GOINFRA, AGETOP CIVIL → "GOINFRA"
  AGESUL → "AGESUL"
  SBC → "SBC"
  TCPO → "TCPO"
  Composição, Composicao, Próprio, Propria → "Próprio"
  Unknown / not found → null

CRITICAL: When bank name is fused to code (e.g. "SINAPI103689", "ORSE4554"):
- Set price_source to the bank name ("SINAPI", "ORSE")
- Set code to ONLY the numeric/alphanumeric part ("103689", "4554")
- Do NOT include the bank name in the code field
`;

// ------------------------------------------------------------------
// TYPES
// ------------------------------------------------------------------
interface RejectedItem {
    batch_index: number;
    index?: number;
    candidate_id: string | null;
    reason: string;
    error_message: string | null;
    raw_output_excerpt: string; // First 500 chars of raw LLM output or specific item JSON
    candidate_excerpt: string | null;
}

export type PersistenceOpts = {
    supabase: any; // SupabaseClient
    fileId: string;
    jobId: string;
    onSaveMeta?: (meta: any) => Promise<void>;
    buildSig?: string;
};

// ------------------------------------------------------------------
// HELPER: Atomic Metadata Persistence (Stage B)
// ------------------------------------------------------------------
async function persistStageBMetaAtomic(
    opts: PersistenceOpts,
    patchFn: (stageB: any) => void
): Promise<void> {
    const { supabase, fileId, jobId } = opts;
    try {
        // 1. Fetch CURRENT metadata (Critical for concurrency)
        const { data: current, error: fetchErr } = await supabase
            .from('import_files')
            .select('metadata')
            .eq('id', fileId)
            .single();

        if (fetchErr || !current) {
            console.warn(`[STAGE-B-ATOMIC] Failed to fetch metadata for file ${fileId}: ${fetchErr?.message}`);
            return;
        }

        // 2. Deep Merge atómico
        const nextMetadata = safeMergeMetadata(current.metadata || {}, {});

        // Ensure stageB exists even if safeMergeMetadata didn't have updates for it yet
        nextMetadata.stageB = nextMetadata.stageB || {};
        nextMetadata.stageB.debug = nextMetadata.stageB.debug || {};

        // 3. Apply Patch via transformation
        patchFn(nextMetadata.stageB);

        // 4. Build Signature (Auto-update if not present)
        if (opts.buildSig) {
            nextMetadata.stageB.build_sig = opts.buildSig;
        }

        // 6. Atomic Update
        const { error: updateErr } = await supabase
            .from('import_files')
            .update({ metadata: nextMetadata })
            .eq('id', fileId);

        if (updateErr) {
            console.warn(`[STAGE-B-ATOMIC] Update failed for file ${fileId}: ${updateErr.message}`);
        } else {
            // Checkpoint log enabled for debugging
            console.log(`[STAGE-B-ATOMIC] Persisted update for ${fileId}`);
        }

    } catch (e: any) {
        console.error(`[STAGE-B-ATOMIC] CRITICAL EXCEPTION: ${e.message}`, e);
        // Do NOT throw, to avoid breaking the extraction flow
    }
}

// ------------------------------------------------------------------
// HELPER: Dedupe Key Generation
// ------------------------------------------------------------------
function generateStageBDedupKey(item: StageBItem): string {
    const clean = (s: string | null | undefined) => (s || '').trim().toUpperCase();
    const fullPath = (item.item_path || '');

    // Quando não há código (títulos de seção/grupo), usa a descrição como discriminador
    // para evitar que títulos colidam com itens normais na dedup
    if (!item.code) {
        const descKey = clean(item.description as string).slice(0, 40);
        return `${fullPath}|NULL|${descKey}`;
    }

    // Para itens normais, mantém a key original baseada em código+quantidade+preço
    return `${fullPath}|${clean(item.code)}|${clean(item.unit)}|${String(item.quantity ?? '')}|${String(item.unit_price ?? '')}`;
}

// ------------------------------------------------------------------
// HELPER: Normalize Code (P4 — strip OCR noise from CPU codes)
// ------------------------------------------------------------------
function normalizeCode(raw: string | null | undefined): string | null {
    if (!raw) return null;
    let c = raw.trim().toUpperCase();
    // Remove trailing OCR noise "P" from CPU codes: CPUXXXP → CPUXXX
    c = c.replace(/^(CPU[A-Z0-9]+[A-Z0-9])P$/, '$1');
    return c;
}

// ------------------------------------------------------------------
// HELPER: Price Coherence Validation (P5)
// ------------------------------------------------------------------
function validatePriceCoherence(item: StageBItem): StageBItem {
    const qty = parseFloat(String(item.quantity ?? '0').replace(',', '.'));
    const up = parseFloat(String(item.unit_price ?? '0').replace(',', '.'));
    const tp = parseFloat(String(item.total_price ?? '0').replace(',', '.'));
    // If total_price ≈ unit_price (within 1%) and qty > 1, unit_price is likely wrong
    if (qty > 1 && tp > 0 && up > 0 && Math.abs(up - tp) / tp < 0.01) {
        item.warnings = [...(item.warnings || []), 'price_coherence_warning_up_equals_tp'];
    }
    return item;
}

// ------------------------------------------------------------------
// HELPER: Robust Text Extraction
// ------------------------------------------------------------------
async function getResponseText(result: any): Promise<string> {
    if (!result) return "";
    try {
        if (typeof result.text === 'function') {
            return await result.text();
        } else if (typeof result.text === 'string') {
            return result.text;
        } else if (result.response && typeof result.response.text === 'function') {
            return result.response.text();
        } else {
            return JSON.stringify(result).slice(0, 2000);
        }
    } catch (e) {
        console.warn("[STAGE-B] Failed to extract text from response", e);
        return "";
    }
}


// ------------------------------------------------------------------
// HELPER: Model Fallback Executive
// ------------------------------------------------------------------
async function generateWithModelFallback(
    client: GoogleGenAI,
    contents: any,
    debugObj: any,
    persistenceOpts?: PersistenceOpts
): Promise<{ text: string; model: string }> {
    const modelsToTry = [...new Set(MODEL_FALLBACKS)];
    const attempts: Array<{ model: string, kind: 'success' | 'failure' | 'skipped' | 'retry', error_message?: string, ts?: string }> = [];
    let lastError: any = null;

    // Load existing attempts if any (from debugObj, which might be populated from previous runs?)
    // Actually, executedStageB runs once per file usually.

    for (const modelName of modelsToTry) {
        // Retry loop for 429/503
        for (let retry = 0; retry <= 2; retry++) {
            try {
                if (retry > 0) {
                    // Backoff: 400ms, 900ms
                    await new Promise(r => setTimeout(r, 400 + (retry * 500)));
                    const retryAttempt = { model: modelName, kind: 'retry' as const, error_message: `Retry ${retry} after transient error`, ts: new Date().toISOString() };
                    attempts.push(retryAttempt);
                    // Persist Reuse
                    if (persistenceOpts) {
                        await persistStageBMetaAtomic(persistenceOpts, (stageB) => {
                            stageB.llm_model_attempts = stageB.llm_model_attempts || [];
                            stageB.llm_model_attempts.push(retryAttempt);
                        });
                    }
                }

                console.info(`[STAGE-B] Attempting model: ${modelName} (retry ${retry})`);

                // New SDK Call
                const result = await client.models.generateContent({
                    model: modelName,
                    contents: contents,
                    config: {
                        maxOutputTokens: 16384,
                        temperature: 0.1,
                        topP: 0.95
                    }
                });

                // Robust Text Extraction
                const text = await getResponseText(result);

                // Treat empty text as "success" here (caller handles validation)
                // But logging it might be useful
                if (!text) {
                    console.warn(`[STAGE-B] Model ${modelName} returned empty text.`);
                }

                // Success
                const successAttempt = { model: modelName, kind: 'success' as const, ts: new Date().toISOString() };
                attempts.push(successAttempt);
                debugObj.llm_model_actual = modelName;
                debugObj.llm_model_attempts = attempts;

                if (persistenceOpts) {
                    await persistStageBMetaAtomic(persistenceOpts, (stageB) => {
                        stageB.llm_model_attempts = stageB.llm_model_attempts || [];
                        stageB.llm_model_attempts.push(successAttempt);
                        stageB.llm_model_actual = modelName;
                        stageB.llm_succeeded_at = new Date().toISOString();
                    });
                }

                return { text, model: modelName };

            } catch (e: any) {
                const msg = String(e?.message || e);
                const msgLower = msg.toLowerCase();
                const isNotFound = msgLower.includes("404") || msgLower.includes("not found") || msgLower.includes("not supported");
                const isTransient = msgLower.includes("429") || msgLower.includes("503") || msgLower.includes("service unavailable") || msgLower.includes("resource exhausted");

                if (isNotFound) {
                    console.warn(`[STAGE-B] Model fallback: ${modelName} -> NEXT (reason: 404/Not Supported)`);
                    const skipAttempt = { model: modelName, kind: 'skipped' as const, error_message: msg.substring(0, 200), ts: new Date().toISOString() };
                    attempts.push(skipAttempt);
                    if (persistenceOpts) {
                        await persistStageBMetaAtomic(persistenceOpts, (stageB) => {
                            stageB.llm_model_attempts = stageB.llm_model_attempts || [];
                            stageB.llm_model_attempts.push(skipAttempt);
                        });
                    }
                    lastError = e;
                    break; // Break retry loop, move to next model
                } else if (isTransient) {
                    console.warn(`[STAGE-B] Model ${modelName} transient error: ${msg}. Retry ${retry}/2`);
                    if (retry === 2) {
                        const failAttempt = { model: modelName, kind: 'failure' as const, error_message: `Max retries (3) exhausted. ${msg.substring(0, 200)}`, ts: new Date().toISOString() };
                        attempts.push(failAttempt);
                        if (persistenceOpts) {
                            await persistStageBMetaAtomic(persistenceOpts, (stageB) => {
                                stageB.llm_model_attempts = stageB.llm_model_attempts || [];
                                stageB.llm_model_attempts.push(failAttempt);
                            });
                        }
                        lastError = e;
                        // Continue to next model? Yes, maybe another model works.
                    } else {
                        continue; // Retry same model
                    }
                } else {
                    // Other fatal errors (Auth, BadRequest)
                    console.error(`[STAGE-B] Fatal error with ${modelName}:`, e);
                    const fatalAttempt = { model: modelName, kind: 'failure' as const, error_message: msg.substring(0, 200), ts: new Date().toISOString() };
                    attempts.push(fatalAttempt);
                    if (persistenceOpts) {
                        await persistStageBMetaAtomic(persistenceOpts, (stageB) => {
                            stageB.llm_model_attempts = stageB.llm_model_attempts || [];
                            stageB.llm_model_attempts.push(fatalAttempt);
                            stageB.debug.llm_last_error = msg.substring(0, 255);
                        });
                    }
                    debugObj.llm_model_attempts = attempts;
                    throw e; // Fail fast
                }
            }
        }
    }

    // If we exhausted all models
    debugObj.llm_model_attempts = attempts;
    const finalErrorMsg = lastError?.message || "All models failed";

    if (persistenceOpts) {
        await persistStageBMetaAtomic(persistenceOpts, (stageB) => {
            stageB.debug.llm_last_error = finalErrorMsg.substring(0, 255);
            stageB.llm_failed_at = new Date().toISOString();
        });
    }

    throw new Error(`All models failed: ${modelsToTry.join(', ')}. Last error: ${finalErrorMsg}`);
}

// ------------------------------------------------------------------
// HELPER: Normalize Description (Robust)
// ------------------------------------------------------------------
function normalizeDescription(raw: any, evidenceLines: any[]): string | null {
    if (typeof raw?.description === "string") {
        const d = raw.description.trim();
        if (d.length > 0) return d;
    }

    const first = evidenceLines?.[0]?.text;
    if (typeof first === "string") {
        let t = first.trim();
        if (!t) return null;

        // Remove código inicial se existir
        if (typeof raw?.code === "string" && raw.code.trim()) {
            const code = raw.code.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            t = t.replace(new RegExp("^" + code + "\\s+"), "");
        } else {
            t = t.replace(/^[0-9]+(?:\.[0-9]+)+\s+/, "");
        }

        // Remove unidade no final
        if (typeof raw?.unit === "string" && raw.unit.trim()) {
            const unit = raw.unit.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            t = t.replace(new RegExp("\\s+" + unit + "\\b"), " ");
        }

        // Remove blocos numéricos finais (quantidade/preço)
        t = t.replace(/\s+[-–]?\s*(\d{1,3}(\.\d{3})*(,\d+)?|\d+(,\d+)?)\s*.*$/u, "").trim();

        return t.length > 0 ? t : null;
    }

    return null;
}

// ------------------------------------------------------------------
// CORE: Process Batch
// ------------------------------------------------------------------
async function processCandidatesBatch(
    apiKey: string,
    candidates: any[],
    batchIndex: number,
    persistenceOpts?: PersistenceOpts
): Promise<{ items: StageBItem[]; error?: string; debug?: any }> {
    if (!candidates.length) return { items: [] };

    // Instantiate Client (Scope: Batch)
    const client = new GoogleGenAI({ apiKey });

    // --- PATCH B: ST Bypass (Section Title Bypass) ---
    const bypassedItems: StageBItem[] = [];
    const candidatesForLLM: any[] = [];

    for (const c of candidates) {
        if (c.warnings?.includes("section_title_candidate")) {
            bypassedItems.push({
                kind: "composition",
                code: null,
                description: c.extracted_signals?.description_fragment || "SEÇÃO",
                unit: null,
                quantity: null,
                unit_price: null,
                total_price: null,
                item_path: c.extracted_signals?.item_path || null,
                raw_numbers: [],
                warnings: ["st_bypass_applied"],
                confidence_score: 0.85,
                evidence: {
                    candidate_id: c.id,
                    evidence_lines: c.evidence_lines || []
                }
            });
        } else {
            candidatesForLLM.push(c);
        }
    }

    // LOG TEMPORÁRIO — remover após debug
    console.log('[PATCH-B-RESULT]', JSON.stringify({
        total_candidates: candidates.length,
        bypassed: bypassedItems.length,
        forLLM: candidatesForLLM.length,
        first_5_warnings: candidates.slice(0, 5).map((c: any) => ({
            id: c.id,
            warnings: c.warnings,
            warnings_type: typeof c.warnings,
            is_array: Array.isArray(c.warnings),
            has_section: Array.isArray(c.warnings) && c.warnings.includes('section_title_candidate')
        })),
        section_candidates: candidates.filter((c: any) =>
            Array.isArray(c.warnings) && c.warnings.includes('section_title_candidate')
        ).map((c: any) => ({ id: c.id, item_path: c.extracted_signals?.item_path, desc: c.extracted_signals?.description_fragment }))
    }));

    // Se todos os candidatos do batch foram bypassed, retorna imediatamente
    if (candidatesForLLM.length === 0) {
        console.log(`[STAGE-B] Batch ${batchIndex}: All ${bypassedItems.length} candidates were bypassed as ST.`);
        return {
            items: bypassedItems,
            debug: { batch_index: batchIndex, items_bypassed: bypassedItems.length, llm_skipped: true }
        };
    }

    // Construct Context ONLY for candidates going to the LLM
    const candidatesContext = candidatesForLLM.map((c: any) => ({
        id: c.id,
        stage_a_kind: c.kind,
        snippet: c.snippet || c.evidence, // PRIMARY GROUNDING
        context_before: c.context_before,
        context_after: c.context_after,
        signals: c.extracted_signals, // Hints from Stage A
        evidence_lines: c.evidence_lines || [],
        warnings: c.warnings || []
    }));

    const userPrompt = `
BATCH #${batchIndex}
PROCESS THESE CANDIDATES:
${JSON.stringify(candidatesContext, null, 2)}
`;

    // DEBUG: Lifecycle Tracking & Storage
    const lifecycle: string[] = [`batch:${batchIndex}:start`];
    let rawOutputTruncated = "";

    // Debug info container
    const stepDebug: any = {
        llm_sdk: "@google/genai",
        llm_model_configured: MODEL_NAME,
        llm_model_actual: "pending",
        llm_model_attempts: []
    };

    async function callGemini(
        candidatesSub: any[],
        contextUserPrompt: string
    ): Promise<string> {
        const promptText = SYSTEM_PROMPT + "\n" + contextUserPrompt;
        const contents = [
            { role: "user", parts: [{ text: promptText }] }
        ];

        lifecycle.push('before_generateWithModelFallback');
        const result = await generateWithModelFallback(
            client,
            contents,
            stepDebug,
            persistenceOpts
        );
        lifecycle.push('after_generateWithModelFallback');

        if (!result?.text || result.text.trim().length === 0) {
            throw new Error("LLM returned empty text response");
        }

        return (result.text || "").trim();
    }

    async function callLLMWithRetry(
        candidatesSub: any[],
        contextUserPrompt: string,
        depth: number = 0
    ): Promise<any[]> {
        const MAX_DEPTH = 3;
        const text = await callGemini(candidatesSub, contextUserPrompt);

        let parsed: any;
        let jsonParseError: string | null = null;
        try {
            parsed = JSON.parse(text);
        } catch (e: any) {
            try {
                const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
                parsed = JSON.parse(cleaned);
            } catch (e2: any) {
                jsonParseError = e2.message;
            }
        }

        if (jsonParseError || !parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) {
            if (depth >= MAX_DEPTH || candidatesSub.length <= 1) {
                console.warn(
                    `[stageB] JSON_PARSE_ERROR – max retry depth reached` +
                    ` (${candidatesSub.length} items lost at depth ${depth})`
                );
                return [];
            }
            const mid = Math.ceil(candidatesSub.length / 2);
            const half1 = candidatesSub.slice(0, mid);
            const half2 = candidatesSub.slice(mid);
            console.warn(
                `[stageB] JSON_PARSE_ERROR – retrying with half batch` +
                ` (size: ${mid}), depth: ${depth + 1}`
            );

            const prompt1 = `BATCH #${batchIndex} (Split 1, depth ${depth + 1})\nPROCESS THESE CANDIDATES:\n${JSON.stringify(half1, null, 2)}`;
            const prompt2 = `BATCH #${batchIndex} (Split 2, depth ${depth + 1})\nPROCESS THESE CANDIDATES:\n${JSON.stringify(half2, null, 2)}`;

            // SEQUENCIAL — não usar Promise.all (respeitar rate limit do Gemini)
            const r1 = await callLLMWithRetry(half1, prompt1, depth + 1);
            const r2 = await callLLMWithRetry(half2, prompt2, depth + 1);
            return [...r1, ...r2];
        }
        return parsed.items;
    }

    try {
        const parsedItems = await callLLMWithRetry(candidatesContext, userPrompt);
        rawOutputTruncated = "Output returned via recursive retry";

        // C1: Detectar itens adjacentes com códigos sequenciais e valores idênticos
        if (parsedItems && Array.isArray(parsedItems)) {
            for (let i = 1; i < parsedItems.length; i++) {
                const prev = parsedItems[i - 1];
                const curr = parsedItems[i];
                if (
                    prev.code && curr.code &&
                    !isNaN(Number(prev.code)) &&
                    !isNaN(Number(curr.code)) &&
                    Math.abs(Number(curr.code) - Number(prev.code)) === 1 &&
                    prev.quantity === curr.quantity &&
                    prev.unit_price === curr.unit_price
                ) {
                    curr.warnings = [...(curr.warnings || []), 'possible_duplication_from_adjacent_item'];
                    curr.price_source = 'NEEDS_REVIEW';
                }
            }
        }

        // C8: Detectar item fantasma — raw_line idêntica ao item anterior mas código diferente.
        // Indica que o LLM leu a mesma linha duas vezes e gerou dois itens com códigos distintos.
        if (parsedItems && Array.isArray(parsedItems)) {
            for (let i = 1; i < parsedItems.length; i++) {
                const prev = parsedItems[i - 1];
                const curr = parsedItems[i];
                if (
                    prev.raw_line && curr.raw_line &&
                    typeof prev.raw_line === 'string' &&
                    typeof curr.raw_line === 'string' &&
                    prev.raw_line.trim() === curr.raw_line.trim() &&
                    prev.code !== curr.code
                ) {
                    curr.warnings = [...(curr.warnings || []), 'duplicate_raw_line'];
                    curr.price_source = 'NEEDS_REVIEW';
                }
            }
        }

        // C9: deduplicação por composition_code idêntico dentro do mesmo subgrupo
        if (parsedItems && Array.isArray(parsedItems)) {
            for (let i = 1; i < parsedItems.length; i++) {
                const current = parsedItems[i];
                const prev = parsedItems[i - 1];

                if (
                    !current.composition_code ||
                    !prev.composition_code ||
                    current.composition_code !== prev.composition_code
                ) continue;

                // extrai prefixo do subgrupo (ex: "3.3.5" → "3.3", "15.2.7" → "15.2")
                const getSubgroupPrefix = (path: string): string => {
                    const parts = path?.split('.') ?? [];
                    return parts.length >= 2 ? parts.slice(0, 2).join('.') : path;
                };

                const currentPrefix = getSubgroupPrefix(current.item_path ?? '');
                const prevPrefix = getSubgroupPrefix(prev.item_path ?? '');

                if (currentPrefix === prevPrefix && currentPrefix !== '') {
                    current.warnings = [
                        ...(current.warnings || []),
                        'duplicate_same_subgroup',
                    ];
                }
            }
        }

        // C7: Sanitizar item_path — último segmento 3+ dígitos indica código SINAPI/ORSE colado pelo OCR.
        // Ex: "1.2.290776" → LLM errou e retornou item_path="1.2.290"; corrigir para "1.2.3".
        // Threshold conservador: só atua se último segmento >= 100 (3+ dígitos).
        // Nunca afeta paths de segmento único nem casos legítimos de 2 dígitos (1.x.10-99).
        if (parsedItems && Array.isArray(parsedItems)) {
            for (const item of parsedItems) {
                if (!item.item_path || typeof item.item_path !== 'string') continue;
                const parts = (item.item_path as string).split('.');
                const lastPart = parts[parts.length - 1];
                if (parts.length >= 2 && /^\d{3,}$/.test(lastPart)) {
                    const originalPath = item.item_path;
                    // Mantém apenas o 1º dígito do último segmento (o número real do item)
                    parts[parts.length - 1] = lastPart[0];
                    item.item_path = parts.join('.');
                    item.warnings = [...(item.warnings || []), 'item_path_sanitized'];
                    item.warnings = [...item.warnings, `item_path_was:${originalPath}`];
                }
            }
        }

        const validatedItems: StageBItem[] = [];
        let rejectedCount = 0;
        const rejectedItems: RejectedItem[] = [];

        // GUARD: EMPTY ITEMS FROM LLM RETRY
        if (!parsedItems || parsedItems.length === 0) {
            rejectedCount++;
            rejectedItems.push({
                batch_index: batchIndex,
                candidate_id: null,
                reason: 'JSON_PARSE_ERROR_RETRY_EXHAUSTED',
                error_message: 'Max retry exhausted or empty response during evaluation.',
                candidate_excerpt: '',
                raw_output_excerpt: ''
            });
        } else {
            // SUCCESS - ITERATE ITEMS
            let idx = 0;
            for (const raw of parsedItems) {
                idx++;
                // Start with base object matching schema

                const evidence_lines = Array.isArray(raw.evidence_lines) ? raw.evidence_lines : (raw.evidence?.evidence_lines || []);
                const description = normalizeDescription(raw, evidence_lines);

                const item: any = {
                    kind: raw.kind ?? "synthetic_item",
                    price_source: raw.price_source ?? null,
                    code: normalizeCode(raw.code),
                    description,
                    unit: raw.unit ?? null,
                    quantity: raw.quantity != null ? String(raw.quantity) : null,
                    unit_price: raw.unit_price != null ? String(raw.unit_price) : null,
                    total_price: raw.total_price != null ? String(raw.total_price) : null,
                    item_path: raw.item_path ?? (candidates.find((c: any) => c.id === (raw.candidate_id ?? raw.evidence?.candidate_id))?.extracted_signals?.item_path) ?? null,
                    raw_numbers: [], // Filled by default or logic
                    warnings: [],
                    confidence_score: 0.8, // Baseline for LLM
                    evidence: {
                        candidate_id: raw.candidate_id ?? raw.evidence?.candidate_id ?? "unknown", // Must link back
                        evidence_lines
                    }
                };

                // PROTECAO ANTES DO ZOD
                if (!item.description) {
                    console.warn(`[STAGE-B] Dropped item: missing description after normalization`, JSON.stringify({ candidate_id: item.evidence?.candidate_id, code: item.code, first_line: evidence_lines?.[0]?.text }));
                    continue; // Skip
                }

                // Strict Zod Check
                const safe = StageBItemSchema.safeParse(item);
                if (safe.success) {
                    // FIX B: rejeita fragmentos de linha — unidades soltas ou continuações de descrição
                    const FRAGMENT_PATTERN = /^(M|KG|UN|M²|M³|M2|M3|MÊS|MES|UNXMÊS|UNXMES|H|ML)$/i;
                    const isFragment = !safe.data.code &&
                        (!safe.data.description ||
                            FRAGMENT_PATTERN.test(safe.data.description.trim()));
                    if (isFragment) {
                        rejectedCount++;
                        rejectedItems.push({
                            batch_index: batchIndex,
                            index: idx,
                            candidate_id: safe.data.evidence?.candidate_id ?? null,
                            reason: 'FRAGMENT_REJECTED',
                            error_message: 'Fragment line: bare unit or short description without code',
                            candidate_excerpt: safe.data.description?.substring(0, 50) || 'NO_DESC',
                            raw_output_excerpt: JSON.stringify(raw).substring(0, 300)
                        });
                        continue;
                    }
                    validatedItems.push(validatePriceCoherence(safe.data));
                } else {
                    rejectedCount++;
                    const reason = safe.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
                    rejectedItems.push({
                        batch_index: batchIndex,
                        index: idx,
                        candidate_id: item.evidence?.candidate_id,
                        reason: 'SCHEMA_VALIDATION_ERROR',
                        error_message: reason,
                        candidate_excerpt: item.description?.substring(0, 50) || "NO_DESC",
                        raw_output_excerpt: JSON.stringify(raw).substring(0, 300)
                    });
                    console.warn(`[STAGE-B] Batch ${batchIndex} Item Invalid:`, reason);
                }
            }
        }

        // ANTI-ZERO CHECK (Invariant 1)
        if (validatedItems.length === 0 && rejectedItems.length === 0) {
            rejectedCount++;
            rejectedItems.push({
                batch_index: batchIndex,
                candidate_id: null,
                reason: 'EMPTY_AFTER_PARSE',
                error_message: 'LLM returned valid JSON but empty items array, and no candidates were processed.',
                candidate_excerpt: null,
                raw_output_excerpt: rawOutputTruncated.substring(0, 800)
            });
        }

        // [STAGE-B-LOG-2] POST-VALIDATION SUMMARY
        console.log("[STAGE-B-ZOD-RESULT]", {
            success: validatedItems.length > 0 || rejectedCount === 0,
            parsedItemsCount: validatedItems.length,
            rejected: rejectedCount,
        });

        if (validatedItems.length === 0 && rejectedCount > 0) {
            console.error("[STAGE-B-ZOD-ERROR] All items rejected. Preserving debug (no throw).");
            // NÃO lançar exceção — preservar debug com rejected_items para diagnóstico
        }

        // Construct Debug Object for this batch
        const batchDebug = {
            batch_index: batchIndex,
            input_sample_count: candidatesContext.length,
            raw_output_len: 0, // text is scoped inside callLLMWithRetry
            raw_output_truncated: rawOutputTruncated,
            parse: {
                accepted_count: validatedItems.length,
                rejected_count: rejectedCount,
                rejected_items: rejectedItems // Detailed rejection info
            },
            ...stepDebug
        };

        return { items: [...bypassedItems, ...validatedItems], debug: batchDebug, error: undefined };

    } catch (e: any) {
        console.error(`[STAGE-B] Batch ${batchIndex} Fatal Failed:`, e.message);

        const batchDebug = {
            batch_index: batchIndex,
            error_message: e.message,
            ...stepDebug
        };

        return { items: [...bypassedItems], error: `Execution failed: ${e.message}`, debug: batchDebug };
    }
}

// ------------------------------------------------------------------
// MAIN: Execute Stage B
// ------------------------------------------------------------------
export async function executeStageB(
    apiKey: string,
    requestId: string,
    candidates: any[],
    persistenceOpts?: PersistenceOpts,
    resumeOpts?: {
        startBatchIndex?: number;
        maxBatches?: number;
        onBatchResult?: (result: { batchIndex: number; candidateCount: number; items: StageBItem[]; totalBatches: number }) => Promise<void>;
    }
): Promise<StageBOutput> {
    console.log(`[STAGE-B-EXEC] Starting executeStageB. Valid Candidates: ${candidates.length}, ResumeBatch: ${resumeOpts?.startBatchIndex || 0}`);
    const batches: StageBOutput['batches'] = [];
    const allItems: StageBItem[] = [];
    const stats = {
        candidates_total: candidates.length,
        candidates_used: 0,
        batches_processed: 0,
        duplicates_removed: 0,
        llm_tokens_used: 0
    };
    const warnings: string[] = [];

    // ACCUMULATORS FOR DEBUG
    const allAccepted: StageBItem[] = [];
    const allRejected: RejectedItem[] = [];
    let rawOutputTruncatedGlobal: string | null = null;
    let lastDebugWithModelInfo: any = null;

    // Filter relevant candidates
    const validCandidates = candidates;
    stats.candidates_total = validCandidates.length;

    // Compute total_batches NOW, from the true candidate count,
    // before any timeout could cut the execution short.
    // NEVER overwrite an existing value — a retry must keep the original count.
    const totalBatchesCalculated = Math.max(1, Math.ceil(validCandidates.length / BATCH_SIZE));
    console.log(`[STAGE-B-EXEC] totalBatchesCalculated=${totalBatchesCalculated} (candidates=${validCandidates.length}, BATCH_SIZE=${BATCH_SIZE})`);

    // 1. ATOMIC START MARKER — persists total_batches so finalization can read it
    // even when a timeout interrupts processing mid-way.
    console.log(`[STAGE-B-EXEC] Total batches to process: ${totalBatchesCalculated}`);
    if (persistenceOpts) {
        await persistStageBMetaAtomic(persistenceOpts, (stageB) => {
            stageB.llm_sdk = "@google/genai";
            stageB.llm_started_at = stageB.llm_started_at || new Date().toISOString();
            stageB.llm_models_configured = MODEL_FALLBACKS;
            // Persist total_batches so the finalization check can read it
            // even when timeout interrupts processing mid-way.
            // NEVER overwrite an existing value — a retry must keep the original count.
            stageB.total_batches = stageB.total_batches || totalBatchesCalculated;
            stageB.llm_model_attempts = stageB.llm_model_attempts || [];
            // Preserve existing debug.index_gate!
            stageB.debug = stageB.debug || {};
        });
    }

    // [BATCHING] Chunked execution loop
    const startBatch = resumeOpts?.startBatchIndex || 0;
    const startIndex = startBatch * BATCH_SIZE;
    const maxBatches = resumeOpts?.maxBatches || Infinity;
    let bCount = 0;

    for (let i = startIndex; i < candidates.length; i += BATCH_SIZE) {
        if (bCount >= maxBatches) {
            console.log(`[STAGE-B-EXEC] Stopping early. Reached max batches limit: ${maxBatches}`);
            break;
        }
        bCount++;

        const batchStartAt = Date.now();
        const batchCandidates = candidates.slice(i, i + BATCH_SIZE);
        const batchIndex = Math.floor(i / BATCH_SIZE);

        // Execute Batch
        const result = await processCandidatesBatch(apiKey, batchCandidates, batchIndex, persistenceOpts);

        // Record Batch Stats
        batches.push({
            batch_index: batchIndex,
            candidates_in: batchCandidates.length,
            items_out: result.items.length,
            error: result.error
        });

        // ACCUMULATE RESULTS
        if (result.items.length > 0) {
            allItems.push(...result.items);
            allAccepted.push(...result.items);
            stats.candidates_used += batchCandidates.length;
        }

        if (result.debug?.parse?.rejected_items) {
            allRejected.push(...result.debug.parse.rejected_items);
        }

        if (!rawOutputTruncatedGlobal && result.debug?.raw_output_truncated) {
            rawOutputTruncatedGlobal = result.debug.raw_output_truncated;
        }

        if (result.debug?.llm_model_actual) {
            lastDebugWithModelInfo = result.debug;
        }

        stats.batches_processed++;

        const batchEndAt = Date.now();
        console.log("[STAGE-B-TIMING]", {
            batchIndex,
            startedAt: new Date(batchStartAt).toISOString(),
            endedAt: new Date(batchEndAt).toISOString(),
            elapsedMs: batchEndAt - batchStartAt,
            itemsFound: result.items.length
        });

        // INCREMENTAL PERSISTENCE CALLBACK
        if (resumeOpts?.onBatchResult) {
            try {
                await resumeOpts.onBatchResult({
                    batchIndex,
                    items: result.items,
                    candidateCount: i + BATCH_SIZE,
                    totalBatches: totalBatchesCalculated
                });
            } catch (cbErr: any) {
                console.error(`[STAGE-B] onBatchResult Callback Failed (Batch ${batchIndex}):`, cbErr);
            }
        }
    }

    // [STAGE-B-LOG-3] BEFORE DEDUP
    console.log("[STAGE-B-BEFORE-DEDUP]", {
        allItemsCount: allItems.length
    });

    // Deduplication
    const seenKeys = new Set<string>();
    const uniqueItems: StageBItem[] = [];

    for (const item of allItems) {
        const key = generateStageBDedupKey(item);
        if (seenKeys.has(key)) {
            stats.duplicates_removed++;
        } else {
            seenKeys.add(key);
            uniqueItems.push(item);
        }
    }

    // [STAGE-B-LOG-4] AFTER DEDUP
    console.log("[STAGE-B-AFTER-DEDUP]", {
        uniqueItemsCount: uniqueItems.length,
        duplicatesRemoved: stats.duplicates_removed
    });

    // GLOBAL ANTI-ZERO GUARD
    if (rawOutputTruncatedGlobal && allAccepted.length === 0 && allRejected.length === 0) {
        allRejected.push({
            batch_index: -1, // Global
            candidate_id: null,
            reason: 'EMPTY_AFTER_PARSE_GLOBAL',
            error_message: 'LLM returned valid output but no items were extracted or rejected across all batches.',
            candidate_excerpt: null,
            raw_output_excerpt: (rawOutputTruncatedGlobal || '').substring(0, 800)
        });
        warnings.push("EMPTY_AFTER_PARSE_GLOBAL");
    }

    // Warnings for zero items (Invariant 1)
    if (uniqueItems.length === 0 && candidates.length > 0) {
        warnings.push("NO_ITEMS_EXTRACTED_FROM_CANDIDATES");
    }

    // CONSTRUCT FINAL DEBUG OBJECT
    const globalDebug: any = {
        llm_model: MODEL_NAME,
        system_prompt_version: "v2_relaxed_mandatory",
        input: {
            candidates_sample: candidates.slice(0, 30).map((c: any) => ({
                id: c.id,
                snippet: c.snippet || c.evidence,
                before: c.context_before,
                after: c.context_after
            })),
            candidates_sample_truncated: candidates.length > 30,
            counts: {
                stageA_candidate_count: candidates.length,
                sent_to_llm_count: validCandidates.length
            }
        },
        raw_output_truncated: rawOutputTruncatedGlobal || "",
        parse: {
            // Persist ALL results
            accepted_items: allAccepted,
            rejected_items: allRejected,
            stats: {
                accepted_count: allAccepted.length,
                rejected_count: allRejected.length
            },
            // Persist LLM info from last batch (representative)
            llm_model_actual: lastDebugWithModelInfo?.llm_model_actual,
            llm_model_attempts: lastDebugWithModelInfo?.llm_model_attempts,
            llm_sdk: lastDebugWithModelInfo?.llm_sdk
        }
    };

    // MERGE RULE: para mesmo pathPrefix+code, manter o item com quantity/unit_price preenchidos
    const mergeMap = new Map<string, StageBItem>();
    const allItems_merged: StageBItem[] = [];
    for (const item of allItems) {
        const key = `${(item.item_path || '')}|${(item.code || '').trim().toUpperCase()}`;
        if (!item.code) {
            allItems_merged.push(item);
            continue;
        }
        const existing = mergeMap.get(key);
        if (!existing) {
            mergeMap.set(key, item);
        } else {
            const currentHasData = item.quantity != null && item.unit_price != null;
            const existingHasData = existing.quantity != null && existing.unit_price != null;
            if (currentHasData && !existingHasData) {
                mergeMap.set(key, item);
            } else if (currentHasData && existingHasData) {
                // ambos têm dados — prefere o com descrição mais longa (mais completa)
                const currentDescLen = (item.description || '').length;
                const existingDescLen = (existing.description || '').length;
                if (currentDescLen > existingDescLen) {
                    mergeMap.set(key, item);
                }
            }
        }
    }

    // Atualizar uniqueItems com o resultado do merge
    const mergedResults = [...allItems_merged, ...Array.from(mergeMap.values())];

    // DEDUP QGBT: remove segunda ocorrência de mesmo code+quantity+unit_price na mesma seção
    const qgbtSeen = new Set<string>();
    const deduped: StageBItem[] = [];
    for (const item of mergedResults) {
        const key = `${(item.item_path || '')}|${(item.code || '').trim().toUpperCase()}|${item.quantity}|${item.unit_price}`;
        if (item.code && qgbtSeen.has(key)) continue;
        if (item.code) qgbtSeen.add(key);
        deduped.push(item);
    }
    mergedResults.length = 0;
    mergedResults.push(...deduped);

    // Agora o item_count e os items do resultado usarão a lista mergeada
    const result: StageBOutput = {
        version: "v1",
        generated_at: new Date().toISOString(),
        model: MODEL_NAME,
        request_id: requestId,
        items: mergedResults,
        item_count: mergedResults.length,
        total_batches: totalBatchesCalculated,
        batches: batches,
        warnings: warnings,
        stats: {
            candidates_total: candidates.length,
            candidates_used: stats.candidates_used,
            batches_processed: batches.length,
            llm_tokens_used: 0
        },
        debug: {
            ...globalDebug,
            batch_count: batches.length
        }
    };

    return result;
}
