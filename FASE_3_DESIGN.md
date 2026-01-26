# PROJETO NABOORÇA - FASE 3: FINALIZAÇÃO E HIDRATAÇÃO (DESIGN TÉCNICO)

## 1. Visão Geral
A Fase 3 é responsável por transformar os dados brutos extraídos (Fase 2) em um Orçamento Operacional (Tabela `budgets` e satélites), garantindo:
1.  **Paridade com Manual**: O orçamento gerado deve ser indistinguível de um criado manualmente.
2.  **Hidratação Inteligente**: Enriquecimento dos itens sintéticos com composições analíticas provenientes de Múltiplas Fontes (Base Interna, PDF Analítico, Manual).
3.  **Idempotência**: O processo pode ser re-executado para o mesmo Job sem duplicar orçamentos (update ou replace).

---

## 2. Diagrama de Fluxo de Dados (Textual)

```mermaid
graph TD
    A[User Setup] -->|Job ID + Params (UF, Month, BDI, Resume)| B(API: finalize_budget)
    B --> C{Validação}
    C -->|Falha| D[Retorno Erro]
    C -->|OK| E[Job Processor (RPC)]
    
    E --> F[1. Criação/Update Header Orçamento]
    F -->|Salva Params| G[(Tabela: budgets)]
    
    E --> H[2. Leitura Itens Fase 2]
    H -->|Source: Synthetic File| I[Lista Plana de Itens]
    
    I --> J[Loop de Processamento de Itens]
    
    J --> K{3. Estratégia de Hidratação}
    K -->|Path A| L[Base Interna (SINAPI/Própria)]
    K -->|Path B| M[PDF Analítico (Extraído)]
    K -->|Path C| N[Pendente / Manual]
    
    L -->|Achou Composição?| O[Insert budget_item_compositions]
    M -->|Achou no PDF?| O
    N --> P[Mark Status: Pending]
    
    O --> Q[Update Item Status: Complete]
    
    Q --> R[4. Finalização]
    P --> R
    
    R --> S[Cálculo de Totais & Indicadores]
    S --> T[Update Job Status: FINALIZED]
```

---

## 3. Entidades e Schema Afetado

### 3.1. Tabelas Principais
| Tabela | Responsabilidade Atualizada | Colunas Chave/Novas |
| :--- | :--- | :--- |
| `import_jobs` | Controle do Processo | `stage='finalization'`, `result_budget_id` |
| `import_files` | Fonte de Dados | `role` (enum: 'synthetic', 'analytic') |
| `budgets` | Header do Orçamento | `sinapi_uf`, `sinapi_competence`, `sinapi_regime`, `settings` (JSONB para BDI/Encargos) |
| `budget_items` | Itens Sintéticos (L1-L3) | `source_id` (Link p/ import_item), `hydration_status` |
| `budget_item_compositions` | Composições Analíticas (L4) | (Populado massivamente nesta fase) |

### 3.2. Mapeamento de Arquivos
O Job deve suportar múltiplos arquivos com papéis definidos:
1.  **Synthetic File** (Obrigatório): Fonte da estrutura da planilha (Etapas, Subetapas, Itens).
2.  **Analytic File** (Opcional): Fonte auxiliar para hidratação de composições não encontradas na base interna (ex: composições próprias ou cotadas).

---

## 4. Regras de Negócio Detalhadas

### 4.1. Inicialização de Parâmetros
Ao disparar a finalização, o usuário deve fornecer (o sistema valida):
-   **Referência**: UF, Ano, Mês (ex: BA/2025/07). *Deve bater com bancos disponíveis.*
-   **Regime**: Desonerado / Não Desonerado.
-   **BDI Inicial**: Valor percentual ou Configuração de BDI (Simples/Detalhado).
-   **Encargos**: Definição base (Horista/Mensalista).

**Regra**: Se os parâmetros diferirem da base extraída (ex: PDF diz 2024, user seleciona 2025), o sistema deve alertar mas permitir (Overrule), priorizando a escolha do usuário para a busca na base.

### 4.2. Lógica de Hidratação (Prioridade Cascata)
Para cada item (Nível 3) importado do Sintético:

1.  **Tentativa 1: Base Interna (High Confidence)**
    *   Busca Código na tabela `sinapi_compositions` (usando UF/Ref do budget).
    *   **Sucesso**: Copia fielmente os filhos (`sinapi_composition_items`) para `budget_item_compositions`.
    *   **Custo**: Recalcula baseado na base interna (garante precisão matemática).

2.  **Tentativa 2: PDF Analítico (Fallback 1)**
    *   *Apenas se houver arquivo analítico no job.*
    *   Busca o Código nos itens extraídos do arquivo Analítico.
    *   **Sucesso**: Usa os filhos extraídos (Insumos do PDF) para criar `budget_item_compositions`.
    *   **Tag**: Marca item como `source='imported_analytic'`.

3.  **Tentativa 3: Pendência (Fallback Final)**
    *   Se não achou em lugar nenhum.
    *   Item permanece no orçamento, mas marcado visualmente (ex: ícone de alerta).
    *   Não cria filhos fictícios. Usuário deve resolver manualmente (Busca manual ou composição própria).

### 4.3. Indicadores de Completude
No final do processo, gerar estatísticas para o Frontend:
*   **Total Itens**: N
*   **Hidratados via Base**: X (Qualidade Máxima)
*   **Hidratados via PDF**: Y (Qualidade Média - depende do OCR)
*   **Pendentes**: Z (Atenção do Usuário)
*   *Display*: "Importação Concluída: 85% Automático (40% Base Oficial, 45% PDF), 15% Pendente".

---

## 5. Estados do Processo e Observabilidade

### Estados do Orçamento (`budgets.status`)
*   `draft`: Estado inicial pós-criação.
*   `optimizing`: (Opcional) Se houver pós-processamento pesado.

### Estados do Job (`import_jobs.status`)
*   `completed`: Finalização total com sucesso.
*   `completed_partial`: Finalização concluída, mas com itens pendentes de hidratação > X%.
*   `failed`: Erro técnico na RPC.

### Logs
*   Gravar logs granulares em tabela de auditoria (`import_logs` ou array no JSON do job):
    *   "Item 1.2.3 (CIVIL-01): Hidratado via SINAPI".
    *   "Item 1.4.5 (PINT-02): Não encontrado na base, tentando analítico... Sucesso".
    *   "Item 2.1.1 (SPECIAL-99): Sem correspondência. Pendente."
