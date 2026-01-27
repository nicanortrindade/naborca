-- Adicionar coluna level para hierarquia de itens (1=Etapa, 2=Subetapa, 3=Item)
ALTER TABLE public.import_ai_items ADD COLUMN IF NOT EXISTS level int DEFAULT 3;
