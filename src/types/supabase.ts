node.exe : Connecting to db 5432
No linha:1 caractere:1
+ & "C:\Program Files\nodejs/node.exe" "C:\Program Files\nodejs/node_mo ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (Connecting to db 5432:String) [], Rem 
   oteException
    + FullyQualifiedErrorId : NativeCommandError
 
v0.96.2: Pulling from supabase/postgres-meta
1cd806dc86be: Pulling fs layer
6159dd270ad5: Pulling fs layer
a90e00cf9f2f: Pulling fs layer
e853745b3e30: Pulling fs layer
4d153bee4c0e: Pulling fs layer
8a3376c45d15: Pulling fs layer
ca99483f3fa4: Pulling fs layer
83619fbf7f91: Pulling fs layer
f2a92724a5c3: Pulling fs layer
bd3cd1da6ce7: Download complete
1cd806dc86be: Download complete
ca99483f3fa4: Download complete
a90e00cf9f2f: Download complete
ca99483f3fa4: Pull complete
83619fbf7f91: Download complete
6159dd270ad5: Download complete
4d153bee4c0e: Download complete
f2a92724a5c3: Download complete
8a3376c45d15: Download complete
e853745b3e30: Download complete
e853745b3e30: Pull complete
1cd806dc86be: Pull complete
4d153bee4c0e: Pull complete
83619fbf7f91: Pull complete
8a3376c45d15: Pull complete
f2a92724a5c3: Pull complete
a90e00cf9f2f: Pull complete
6159dd270ad5: Pull complete
Digest: sha256:4ed8f7c5d3b2e25aa4aa29794605b49799b66da4b36a3c70894cd5241af63f97
Status: Downloaded newer image for public.ecr.aws/supabase/postgres-meta:v0.96.2
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      _backup_functions: {
        Row: {
          created_at: string | null
          definition: string | null
          name: string | null
          oid: number | null
        }
        Insert: {
          created_at?: string | null
          definition?: string | null
          name?: string | null
          oid?: number | null
        }
        Update: {
          created_at?: string | null
          definition?: string | null
          name?: string | null
          oid?: number | null
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string | null
          id: string
          new_data: Json | null
          old_data: Json | null
          record_id: string
          table_name: string
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string | null
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id: string
          table_name: string
          user_id?: string
        }
        Update: {
          action?: string
          created_at?: string | null
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string
          table_name?: string
          user_id?: string
        }
        Relationships: []
      }
      bdi: {
        Row: {
          ac_rate: number | null
          created_at: string | null
          df_rate: number | null
          final_bdi: number | null
          id: string
          l_rate: number | null
          name: string
          r_rate: number | null
          sg_rate: number | null
          taxes_rate: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          ac_rate?: number | null
          created_at?: string | null
          df_rate?: number | null
          final_bdi?: number | null
          id?: string
          l_rate?: number | null
          name: string
          r_rate?: number | null
          sg_rate?: number | null
          taxes_rate?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Update: {
          ac_rate?: number | null
          created_at?: string | null
          df_rate?: number | null
          final_bdi?: number | null
          id?: string
          l_rate?: number | null
          name?: string
          r_rate?: number | null
          sg_rate?: number | null
          taxes_rate?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      budget_item_compositions: {
        Row: {
          budget_item_id: string
          composition_code: string | null
          created_at: string | null
          description: string
          id: string
          metadata: Json
          parent_composition_id: string | null
          quantity: number | null
          total_price: number | null
          unit: string | null
          unit_price: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          budget_item_id: string
          composition_code?: string | null
          created_at?: string | null
          description: string
          id?: string
          metadata?: Json
          parent_composition_id?: string | null
          quantity?: number | null
          total_price?: number | null
          unit?: string | null
          unit_price?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          budget_item_id?: string
          composition_code?: string | null
          created_at?: string | null
          description?: string
          id?: string
          metadata?: Json
          parent_composition_id?: string | null
          quantity?: number | null
          total_price?: number | null
          unit?: string | null
          unit_price?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "budget_item_compositions_budget_item_id_fkey"
            columns: ["budget_item_id"]
            isOneToOne: false
            referencedRelation: "budget_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_item_compositions_budget_item_id_fkey"
            columns: ["budget_item_id"]
            isOneToOne: false
            referencedRelation: "budget_items_with_weight"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_item_compositions_budget_item_id_fkey"
            columns: ["budget_item_id"]
            isOneToOne: false
            referencedRelation: "cronograma_base"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_item_compositions_parent_composition_id_fkey"
            columns: ["parent_composition_id"]
            isOneToOne: false
            referencedRelation: "budget_item_compositions"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_items: {
        Row: {
          bdi: number | null
          budget_id: string | null
          calculation_memory: string | null
          calculation_steps: string[] | null
          code: string | null
          composition_id: string | null
          cost_center: string | null
          created_at: string | null
          custom_bdi: number | null
          description: string
          final_price: number | null
          hydration_details: Json | null
          hydration_status: string | null
          id: string
          insumo_id: string | null
          is_desonerated: boolean | null
          is_locked: boolean | null
          item_number: string | null
          item_type: string | null
          level: number | null
          notes: string | null
          order_index: number
          parent_id: string | null
          path_key: string | null
          peso: number | null
          quantity: number | null
          source: string | null
          source_import_item_id: string | null
          total_price: number | null
          type: string | null
          unit: string | null
          unit_price: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          bdi?: number | null
          budget_id?: string | null
          calculation_memory?: string | null
          calculation_steps?: string[] | null
          code?: string | null
          composition_id?: string | null
          cost_center?: string | null
          created_at?: string | null
          custom_bdi?: number | null
          description: string
          final_price?: number | null
          hydration_details?: Json | null
          hydration_status?: string | null
          id?: string
          insumo_id?: string | null
          is_desonerated?: boolean | null
          is_locked?: boolean | null
          item_number?: string | null
          item_type?: string | null
          level?: number | null
          notes?: string | null
          order_index: number
          parent_id?: string | null
          path_key?: string | null
          peso?: number | null
          quantity?: number | null
          source?: string | null
          source_import_item_id?: string | null
          total_price?: number | null
          type?: string | null
          unit?: string | null
          unit_price?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Update: {
          bdi?: number | null
          budget_id?: string | null
          calculation_memory?: string | null
          calculation_steps?: string[] | null
          code?: string | null
          composition_id?: string | null
          cost_center?: string | null
          created_at?: string | null
          custom_bdi?: number | null
          description?: string
          final_price?: number | null
          hydration_details?: Json | null
          hydration_status?: string | null
          id?: string
          insumo_id?: string | null
          is_desonerated?: boolean | null
          is_locked?: boolean | null
          item_number?: string | null
          item_type?: string | null
          level?: number | null
          notes?: string | null
          order_index?: number
          parent_id?: string | null
          path_key?: string | null
          peso?: number | null
          quantity?: number | null
          source?: string | null
          source_import_item_id?: string | null
          total_price?: number | null
          type?: string | null
          unit?: string | null
          unit_price?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "budget_items_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_items_composition_id_fkey"
            columns: ["composition_id"]
            isOneToOne: false
            referencedRelation: "compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_items_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "insumos_base"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_items_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "budget_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_items_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "budget_items_with_weight"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_items_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "cronograma_base"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_items_source_import_item_id_fkey"
            columns: ["source_import_item_id"]
            isOneToOne: false
            referencedRelation: "import_ai_items"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_schedules: {
        Row: {
          budget_id: string
          created_at: string | null
          id: string
          item_id: string
          percentage: number | null
          period: number
          updated_at: string | null
          user_id: string
          value: number | null
        }
        Insert: {
          budget_id: string
          created_at?: string | null
          id?: string
          item_id: string
          percentage?: number | null
          period: number
          updated_at?: string | null
          user_id: string
          value?: number | null
        }
        Update: {
          budget_id?: string
          created_at?: string | null
          id?: string
          item_id?: string
          percentage?: number | null
          period?: number
          updated_at?: string | null
          user_id?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "budget_schedules_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_schedules_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "budget_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_schedules_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "budget_items_with_weight"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_schedules_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "cronograma_base"
            referencedColumns: ["id"]
          },
        ]
      }
      budgets: {
        Row: {
          bdi: number | null
          bdi_percent: number | null
          bdi_percentage: number | null
          client_name: string | null
          company_id: string | null
          cost_centers: string[] | null
          created_at: string | null
          date: string | null
          desoneracao: number | null
          encargos_percentage: number | null
          frozen_at: string | null
          frozen_by: string | null
          id: string
          is_frozen: boolean | null
          is_scenario: boolean | null
          is_template: boolean | null
          name: string
          obra_type: string | null
          parent_budget_id: string | null
          period_labels: string[] | null
          proposal_cover: string | null
          proposal_terms: string | null
          revision: number | null
          revision_notes: string | null
          scenario_name: string | null
          schedule_interval: number | null
          settings: Json
          sinapi_competence: string | null
          sinapi_contract_type: string | null
          sinapi_regime: string | null
          sinapi_uf: string | null
          status: string | null
          total_value: number | null
          updated_at: string | null
          user_id: string
          version: string | null
        }
        Insert: {
          bdi?: number | null
          bdi_percent?: number | null
          bdi_percentage?: number | null
          client_name?: string | null
          company_id?: string | null
          cost_centers?: string[] | null
          created_at?: string | null
          date?: string | null
          desoneracao?: number | null
          encargos_percentage?: number | null
          frozen_at?: string | null
          frozen_by?: string | null
          id?: string
          is_frozen?: boolean | null
          is_scenario?: boolean | null
          is_template?: boolean | null
          name: string
          obra_type?: string | null
          parent_budget_id?: string | null
          period_labels?: string[] | null
          proposal_cover?: string | null
          proposal_terms?: string | null
          revision?: number | null
          revision_notes?: string | null
          scenario_name?: string | null
          schedule_interval?: number | null
          settings?: Json
          sinapi_competence?: string | null
          sinapi_contract_type?: string | null
          sinapi_regime?: string | null
          sinapi_uf?: string | null
          status?: string | null
          total_value?: number | null
          updated_at?: string | null
          user_id?: string
          version?: string | null
        }
        Update: {
          bdi?: number | null
          bdi_percent?: number | null
          bdi_percentage?: number | null
          client_name?: string | null
          company_id?: string | null
          cost_centers?: string[] | null
          created_at?: string | null
          date?: string | null
          desoneracao?: number | null
          encargos_percentage?: number | null
          frozen_at?: string | null
          frozen_by?: string | null
          id?: string
          is_frozen?: boolean | null
          is_scenario?: boolean | null
          is_template?: boolean | null
          name?: string
          obra_type?: string | null
          parent_budget_id?: string | null
          period_labels?: string[] | null
          proposal_cover?: string | null
          proposal_terms?: string | null
          revision?: number | null
          revision_notes?: string | null
          scenario_name?: string | null
          schedule_interval?: number | null
          settings?: Json
          sinapi_competence?: string | null
          sinapi_contract_type?: string | null
          sinapi_regime?: string | null
          sinapi_uf?: string | null
          status?: string | null
          total_value?: number | null
          updated_at?: string | null
          user_id?: string
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "budgets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_parent_budget_id_fkey"
            columns: ["parent_budget_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          cidade: string | null
          created_at: string | null
          documento: string | null
          email: string | null
          endereco: string | null
          id: string
          is_ativo: boolean | null
          nome: string
          obra_predominante: string | null
          observacoes: string | null
          orgao: string | null
          responsavel: string | null
          telefone: string | null
          tipo_cliente: string | null
          tipo_documento: string | null
          uf: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          cidade?: string | null
          created_at?: string | null
          documento?: string | null
          email?: string | null
          endereco?: string | null
          id?: string
          is_ativo?: boolean | null
          nome: string
          obra_predominante?: string | null
          observacoes?: string | null
          orgao?: string | null
          responsavel?: string | null
          telefone?: string | null
          tipo_cliente?: string | null
          tipo_documento?: string | null
          uf?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          cidade?: string | null
          created_at?: string | null
          documento?: string | null
          email?: string | null
          endereco?: string | null
          id?: string
          is_ativo?: boolean | null
          nome?: string
          obra_predominante?: string | null
          observacoes?: string | null
          orgao?: string | null
          responsavel?: string | null
          telefone?: string | null
          tipo_cliente?: string | null
          tipo_documento?: string | null
          uf?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          address: string | null
          cnpj: string | null
          created_at: string | null
          email: string | null
          id: string
          logo_url: string | null
          name: string
          phone: string | null
          proposal_cover: string | null
          proposal_terms: string | null
          responsible_cpf: string | null
          responsible_crea: string | null
          responsible_name: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          address?: string | null
          cnpj?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          logo_url?: string | null
          name: string
          phone?: string | null
          proposal_cover?: string | null
          proposal_terms?: string | null
          responsible_cpf?: string | null
          responsible_crea?: string | null
          responsible_name?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Update: {
          address?: string | null
          cnpj?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          phone?: string | null
          proposal_cover?: string | null
          proposal_terms?: string | null
          responsible_cpf?: string | null
          responsible_crea?: string | null
          responsible_name?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      composition_inputs: {
        Row: {
          coefficient: number
          created_at: string | null
          id: string
          insumo_id: string | null
          parent_composition_id: string | null
          sub_composition_id: string | null
          unit_price_at_addition: number | null
          user_id: string
        }
        Insert: {
          coefficient: number
          created_at?: string | null
          id?: string
          insumo_id?: string | null
          parent_composition_id?: string | null
          sub_composition_id?: string | null
          unit_price_at_addition?: number | null
          user_id?: string
        }
        Update: {
          coefficient?: number
          created_at?: string | null
          id?: string
          insumo_id?: string | null
          parent_composition_id?: string | null
          sub_composition_id?: string | null
          unit_price_at_addition?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "composition_inputs_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "insumos_base"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "composition_inputs_parent_composition_id_fkey"
            columns: ["parent_composition_id"]
            isOneToOne: false
            referencedRelation: "compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "composition_inputs_sub_composition_id_fkey"
            columns: ["sub_composition_id"]
            isOneToOne: false
            referencedRelation: "compositions"
            referencedColumns: ["id"]
          },
        ]
      }
      compositions: {
        Row: {
          base_id: string | null
          code: string
          created_at: string | null
          data_referencia: string | null
          description: string
          fonte: string | null
          id: string
          is_customizada: boolean | null
          is_oficial: boolean | null
          observacoes: string | null
          total_cost: number | null
          unit: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          base_id?: string | null
          code: string
          created_at?: string | null
          data_referencia?: string | null
          description: string
          fonte?: string | null
          id?: string
          is_customizada?: boolean | null
          is_oficial?: boolean | null
          observacoes?: string | null
          total_cost?: number | null
          unit?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Update: {
          base_id?: string | null
          code?: string
          created_at?: string | null
          data_referencia?: string | null
          description?: string
          fonte?: string | null
          id?: string
          is_customizada?: boolean | null
          is_oficial?: boolean | null
          observacoes?: string | null
          total_cost?: number | null
          unit?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compositions_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "price_bases"
            referencedColumns: ["id"]
          },
        ]
      }
      encargos: {
        Row: {
          base_json: Json | null
          created_at: string | null
          id: string
          name: string
          percentage: number
          type: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          base_json?: Json | null
          created_at?: string | null
          id?: string
          name: string
          percentage: number
          type?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Update: {
          base_json?: Json | null
          created_at?: string | null
          id?: string
          name?: string
          percentage?: number
          type?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      external_price_bases: {
        Row: {
          competence: string | null
          created_at: string | null
          id: string
          name: string
          slug: string
          uf: string | null
          user_id: string
        }
        Insert: {
          competence?: string | null
          created_at?: string | null
          id?: string
          name: string
          slug: string
          uf?: string | null
          user_id: string
        }
        Update: {
          competence?: string | null
          created_at?: string | null
          id?: string
          name?: string
          slug?: string
          uf?: string | null
          user_id?: string
        }
        Relationships: []
      }
      external_price_items: {
        Row: {
          base_id: string
          code: string
          created_at: string | null
          description: string
          id: string
          unit: string | null
          unit_price: number | null
        }
        Insert: {
          base_id: string
          code: string
          created_at?: string | null
          description: string
          id?: string
          unit?: string | null
          unit_price?: number | null
        }
        Update: {
          base_id?: string
          code?: string
          created_at?: string | null
          description?: string
          id?: string
          unit?: string | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "external_price_items_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "external_price_bases"
            referencedColumns: ["id"]
          },
        ]
      }
      import_ai_items: {
        Row: {
          bdi_percent: number | null
          category: string | null
          chunk_index: number | null
          composition_code: string | null
          confidence: number | null
          created_at: string
          dedup_key: string | null
          description: string
          id: string
          idx: number
          import_file_id: string
          item_path: string | null
          job_id: string
          level: number | null
          price_source: string | null
          quantity: number | null
          raw_line: string | null
          source_candidate_id: string | null
          total: number | null
          unit: string | null
          unit_price: number | null
          warnings: Json | null
        }
        Insert: {
          bdi_percent?: number | null
          category?: string | null
          chunk_index?: number | null
          composition_code?: string | null
          confidence?: number | null
          created_at?: string
          dedup_key?: string | null
          description: string
          id?: string
          idx: number
          import_file_id: string
          item_path?: string | null
          job_id: string
          level?: number | null
          price_source?: string | null
          quantity?: number | null
          raw_line?: string | null
          source_candidate_id?: string | null
          total?: number | null
          unit?: string | null
          unit_price?: number | null
          warnings?: Json | null
        }
        Update: {
          bdi_percent?: number | null
          category?: string | null
          chunk_index?: number | null
          composition_code?: string | null
          confidence?: number | null
          created_at?: string
          dedup_key?: string | null
          description?: string
          id?: string
          idx?: number
          import_file_id?: string
          item_path?: string | null
          job_id?: string
          level?: number | null
          price_source?: string | null
          quantity?: number | null
          raw_line?: string | null
          source_candidate_id?: string | null
          total?: number | null
          unit?: string | null
          unit_price?: number | null
          warnings?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "import_ai_items_import_file_id_fkey"
            columns: ["import_file_id"]
            isOneToOne: false
            referencedRelation: "import_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_ai_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_ai_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "view_jobs_ready_for_extraction_retry"
            referencedColumns: ["id"]
          },
        ]
      }
      import_ai_summaries: {
        Row: {
          created_at: string
          header: Json | null
          import_file_id: string
          items_count: number | null
          job_id: string
          notes: string | null
          totals: Json | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          header?: Json | null
          import_file_id: string
          items_count?: number | null
          job_id: string
          notes?: string | null
          totals?: Json | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          header?: Json | null
          import_file_id?: string
          items_count?: number | null
          job_id?: string
          notes?: string | null
          totals?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_ai_summaries_import_file_id_fkey"
            columns: ["import_file_id"]
            isOneToOne: false
            referencedRelation: "import_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_ai_summaries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "import_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_ai_summaries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "view_jobs_ready_for_extraction_retry"
            referencedColumns: ["id"]
          },
        ]
      }
      import_budget_finalizations: {
        Row: {
          budget_id: string
          created_at: string
          id: number
          job_id: string
          user_id: string
        }
        Insert: {
          budget_id: string
          created_at?: string
          id?: number
          job_id: string
          user_id: string
        }
        Update: {
          budget_id?: string
          created_at?: string
          id?: number
          job_id?: string
          user_id?: string
        }
        Relationships: []
      }
      import_files: {
        Row: {
          content_type: string | null
          created_at: string
          doc_role: Database["public"]["Enums"]["import_doc_role"]
          extracted_completed_at: string | null
          extracted_json: Json | null
          extracted_json_schema_version: number | null
          extracted_started_at: string | null
          extracted_text: string | null
          extraction_chunks_done: number | null
          extraction_chunks_total: number | null
          extraction_completed_at: string | null
          extraction_duration_ms: number | null
          extraction_items_inserted: number | null
          extraction_last_error: string | null
          extraction_method: string | null
          extraction_reason: string | null
          extraction_started_at: string | null
          extraction_status: string | null
          extraction_summary_saved: boolean | null
          file_kind: Database["public"]["Enums"]["import_file_kind"]
          file_size_bytes: number | null
          id: string
          job_id: string
          metadata: Json
          original_filename: string | null
          page_count: number | null
          role: string
          sha256: string | null
          storage_bucket: string
          storage_path: string
          storage_url: string | null
          user_id: string
        }
        Insert: {
          content_type?: string | null
          created_at?: string
          doc_role?: Database["public"]["Enums"]["import_doc_role"]
          extracted_completed_at?: string | null
          extracted_json?: Json | null
          extracted_json_schema_version?: number | null
          extracted_started_at?: string | null
          extracted_text?: string | null
          extraction_chunks_done?: number | null
          extraction_chunks_total?: number | null
          extraction_completed_at?: string | null
          extraction_duration_ms?: number | null
          extraction_items_inserted?: number | null
          extraction_last_error?: string | null
          extraction_method?: string | null
          extraction_reason?: string | null
          extraction_started_at?: string | null
          extraction_status?: string | null
          extraction_summary_saved?: boolean | null
          file_kind?: Database["public"]["Enums"]["import_file_kind"]
          file_size_bytes?: number | null
          id?: string
          job_id: string
          metadata?: Json
          original_filename?: string | null
          page_count?: number | null
          role?: string
          sha256?: string | null
          storage_bucket?: string
          storage_path: string
          storage_url?: string | null
          user_id: string
        }
        Update: {
          content_type?: string | null
          created_at?: string
          doc_role?: Database["public"]["Enums"]["import_doc_role"]
          extracted_completed_at?: string | null
          extracted_json?: Json | null
          extracted_json_schema_version?: number | null
          extracted_started_at?: string | null
          extracted_text?: string | null
          extraction_chunks_done?: number | null
          extraction_chunks_total?: number | null
          extraction_completed_at?: string | null
          extraction_duration_ms?: number | null
          extraction_items_inserted?: number | null
          extraction_last_error?: string | null
          extraction_method?: string | null
          extraction_reason?: string | null
          extraction_started_at?: string | null
          extraction_status?: string | null
          extraction_summary_saved?: boolean | null
          file_kind?: Database["public"]["Enums"]["import_file_kind"]
          file_size_bytes?: number | null
          id?: string
          job_id?: string
          metadata?: Json
          original_filename?: string | null
          page_count?: number | null
          role?: string
          sha256?: string | null
          storage_bucket?: string
          storage_path?: string
          storage_url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_files_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_files_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "view_jobs_ready_for_extraction_retry"
            referencedColumns: ["id"]
          },
        ]
      }
      import_finalization_runs: {
        Row: {
          budget_id: string
          created_at: string | null
          hydrated_analytic: number | null
          hydrated_internal: number | null
          id: string
          job_id: string
          params_snapshot: Json
          pending_items: number | null
          total_items: number | null
          user_id: string
        }
        Insert: {
          budget_id: string
          created_at?: string | null
          hydrated_analytic?: number | null
          hydrated_internal?: number | null
          id?: string
          job_id: string
          params_snapshot?: Json
          pending_items?: number | null
          total_items?: number | null
          user_id: string
        }
        Update: {
          budget_id?: string
          created_at?: string | null
          hydrated_analytic?: number | null
          hydrated_internal?: number | null
          id?: string
          job_id?: string
          params_snapshot?: Json
          pending_items?: number | null
          total_items?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_finalization_runs_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_finalization_runs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_finalization_runs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "view_jobs_ready_for_extraction_retry"
            referencedColumns: ["id"]
          },
        ]
      }
      import_hydration_issues: {
        Row: {
          budget_id: string
          budget_item_id: string
          created_at: string | null
          id: string
          issue_type: string
          job_id: string
          original_code: string | null
          original_description: string | null
          severity: string
          status: string
          suggestions: Json | null
          updated_at: string | null
        }
        Insert: {
          budget_id: string
          budget_item_id: string
          created_at?: string | null
          id?: string
          issue_type: string
          job_id: string
          original_code?: string | null
          original_description?: string | null
          severity?: string
          status?: string
          suggestions?: Json | null
          updated_at?: string | null
        }
        Update: {
          budget_id?: string
          budget_item_id?: string
          created_at?: string | null
          id?: string
          issue_type?: string
          job_id?: string
          original_code?: string | null
          original_description?: string | null
          severity?: string
          status?: string
          suggestions?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_hydration_issues_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_hydration_issues_budget_item_id_fkey"
            columns: ["budget_item_id"]
            isOneToOne: false
            referencedRelation: "budget_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_hydration_issues_budget_item_id_fkey"
            columns: ["budget_item_id"]
            isOneToOne: false
            referencedRelation: "budget_items_with_weight"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_hydration_issues_budget_item_id_fkey"
            columns: ["budget_item_id"]
            isOneToOne: false
            referencedRelation: "cronograma_base"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_hydration_issues_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_hydration_issues_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "view_jobs_ready_for_extraction_retry"
            referencedColumns: ["id"]
          },
        ]
      }
      import_items: {
        Row: {
          code: string | null
          code_raw: string | null
          confidence_score: number
          created_at: string
          description: string | null
          description_normalized: string | null
          detected_base: string | null
          external_id: string | null
          file_id: string | null
          id: string
          idx: number | null
          import_file_id: string | null
          is_desonerado: boolean | null
          is_proprio: boolean
          issues: Json
          job_id: string
          normalized_json: Json
          price_desonerado: number | null
          price_nao_desonerado: number | null
          price_selected: number | null
          quantity: number | null
          raw_ai_json: Json
          reference_base_id: string | null
          source_refs: Json
          total_price: number
          unit: string | null
          unit_price: number
          updated_at: string
          user_id: string
          validation_status: string
        }
        Insert: {
          code?: string | null
          code_raw?: string | null
          confidence_score?: number
          created_at?: string
          description?: string | null
          description_normalized?: string | null
          detected_base?: string | null
          external_id?: string | null
          file_id?: string | null
          id?: string
          idx?: number | null
          import_file_id?: string | null
          is_desonerado?: boolean | null
          is_proprio?: boolean
          issues?: Json
          job_id: string
          normalized_json?: Json
          price_desonerado?: number | null
          price_nao_desonerado?: number | null
          price_selected?: number | null
          quantity?: number | null
          raw_ai_json?: Json
          reference_base_id?: string | null
          source_refs?: Json
          total_price?: number
          unit?: string | null
          unit_price?: number
          updated_at?: string
          user_id?: string
          validation_status?: string
        }
        Update: {
          code?: string | null
          code_raw?: string | null
          confidence_score?: number
          created_at?: string
          description?: string | null
          description_normalized?: string | null
          detected_base?: string | null
          external_id?: string | null
          file_id?: string | null
          id?: string
          idx?: number | null
          import_file_id?: string | null
          is_desonerado?: boolean | null
          is_proprio?: boolean
          issues?: Json
          job_id?: string
          normalized_json?: Json
          price_desonerado?: number | null
          price_nao_desonerado?: number | null
          price_selected?: number | null
          quantity?: number | null
          raw_ai_json?: Json
          reference_base_id?: string | null
          source_refs?: Json
          total_price?: number
          unit?: string | null
          unit_price?: number
          updated_at?: string
          user_id?: string
          validation_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_items_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "import_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "view_jobs_ready_for_extraction_retry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_items_reference_base_id_fkey"
            columns: ["reference_base_id"]
            isOneToOne: false
            referencedRelation: "reference_bases"
            referencedColumns: ["id"]
          },
        ]
      }
      import_jobs: {
        Row: {
          artifacts: Json
          created_at: string
          current_step: string | null
          doc_role: Database["public"]["Enums"]["import_doc_role"]
          document_context: Json
          error_message: string | null
          extraction_attempts: number
          extraction_last_reason: string | null
          extraction_next_retry_at: string | null
          extraction_retryable: boolean
          finalization_cursor: number | null
          finalized_at: string | null
          heartbeat_at: string | null
          id: string
          is_desonerado: boolean | null
          last_error: string | null
          progress: number
          result_budget_id: string | null
          stage: string | null
          stage_updated_at: string | null
          status: Database["public"]["Enums"]["import_job_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          artifacts?: Json
          created_at?: string
          current_step?: string | null
          doc_role?: Database["public"]["Enums"]["import_doc_role"]
          document_context?: Json
          error_message?: string | null
          extraction_attempts?: number
          extraction_last_reason?: string | null
          extraction_next_retry_at?: string | null
          extraction_retryable?: boolean
          finalization_cursor?: number | null
          finalized_at?: string | null
          heartbeat_at?: string | null
          id?: string
          is_desonerado?: boolean | null
          last_error?: string | null
          progress?: number
          result_budget_id?: string | null
          stage?: string | null
          stage_updated_at?: string | null
          status?: Database["public"]["Enums"]["import_job_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          artifacts?: Json
          created_at?: string
          current_step?: string | null
          doc_role?: Database["public"]["Enums"]["import_doc_role"]
          document_context?: Json
          error_message?: string | null
          extraction_attempts?: number
          extraction_last_reason?: string | null
          extraction_next_retry_at?: string | null
          extraction_retryable?: boolean
          finalization_cursor?: number | null
          finalized_at?: string | null
          heartbeat_at?: string | null
          id?: string
          is_desonerado?: boolean | null
          last_error?: string | null
          progress?: number
          result_budget_id?: string | null
          stage?: string | null
          stage_updated_at?: string | null
          status?: Database["public"]["Enums"]["import_job_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_jobs_result_budget_id_fkey"
            columns: ["result_budget_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
        ]
      }
      import_ocr_jobs: {
        Row: {
          chunks_processed: number
          completed_at: string | null
          created_at: string | null
          id: string
          import_file_id: string
          job_id: string
          last_error: string | null
          lock_expires_at: string | null
          locked_by: string | null
          max_retries: number | null
          next_chunk_index: number
          priority: number | null
          retry_count: number | null
          scheduled_for: string | null
          started_at: string | null
          status: string
          total_chunks: number | null
          updated_at: string | null
        }
        Insert: {
          chunks_processed?: number
          completed_at?: string | null
          created_at?: string | null
          id?: string
          import_file_id: string
          job_id: string
          last_error?: string | null
          lock_expires_at?: string | null
          locked_by?: string | null
          max_retries?: number | null
          next_chunk_index?: number
          priority?: number | null
          retry_count?: number | null
          scheduled_for?: string | null
          started_at?: string | null
          status?: string
          total_chunks?: number | null
          updated_at?: string | null
        }
        Update: {
          chunks_processed?: number
          completed_at?: string | null
          created_at?: string | null
          id?: string
          import_file_id?: string
          job_id?: string
          last_error?: string | null
          lock_expires_at?: string | null
          locked_by?: string | null
          max_retries?: number | null
          next_chunk_index?: number
          priority?: number | null
          retry_count?: number | null
          scheduled_for?: string | null
          started_at?: string | null
          status?: string
          total_chunks?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_ocr_jobs_import_file_id_fkey"
            columns: ["import_file_id"]
            isOneToOne: false
            referencedRelation: "import_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_ocr_jobs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_ocr_jobs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "view_jobs_ready_for_extraction_retry"
            referencedColumns: ["id"]
          },
        ]
      }
      import_parse_tasks: {
        Row: {
          attempts: number
          created_at: string
          file_id: string
          id: string
          job_id: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          result: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          file_id: string
          id?: string
          job_id: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          result?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          file_id?: string
          id?: string
          job_id?: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          result?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_parse_tasks_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "import_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_parse_tasks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_parse_tasks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "view_jobs_ready_for_extraction_retry"
            referencedColumns: ["id"]
          },
        ]
      }
      import_summaries: {
        Row: {
          created_at: string
          header: Json | null
          import_file_id: string
          items_count: number | null
          job_id: string
          notes: string | null
          totals: Json | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          header?: Json | null
          import_file_id: string
          items_count?: number | null
          job_id: string
          notes?: string | null
          totals?: Json | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          header?: Json | null
          import_file_id?: string
          items_count?: number | null
          job_id?: string
          notes?: string | null
          totals?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_summaries_import_file_id_fkey"
            columns: ["import_file_id"]
            isOneToOne: false
            referencedRelation: "import_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_summaries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "import_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_summaries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "view_jobs_ready_for_extraction_retry"
            referencedColumns: ["id"]
          },
        ]
      }
      insumos_base: {
        Row: {
          base_id: string | null
          code: string
          created_at: string | null
          data_referencia: string | null
          description: string
          fonte: string | null
          id: string
          is_editavel: boolean | null
          is_oficial: boolean | null
          observacoes: string | null
          price: number | null
          type: string | null
          unit: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          base_id?: string | null
          code: string
          created_at?: string | null
          data_referencia?: string | null
          description: string
          fonte?: string | null
          id?: string
          is_editavel?: boolean | null
          is_oficial?: boolean | null
          observacoes?: string | null
          price?: number | null
          type?: string | null
          unit?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Update: {
          base_id?: string | null
          code?: string
          created_at?: string | null
          data_referencia?: string | null
          description?: string
          fonte?: string | null
          id?: string
          is_editavel?: boolean | null
          is_oficial?: boolean | null
          observacoes?: string | null
          price?: number | null
          type?: string | null
          unit?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "insumos_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "price_bases"
            referencedColumns: ["id"]
          },
        ]
      }
      price_base_aliases: {
        Row: {
          alias_code: string
          base_id: string
          canonical_code: string
          id: string
        }
        Insert: {
          alias_code: string
          base_id: string
          canonical_code: string
          id?: string
        }
        Update: {
          alias_code?: string
          base_id?: string
          canonical_code?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_base_aliases_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "external_price_bases"
            referencedColumns: ["id"]
          },
        ]
      }
      price_bases: {
        Row: {
          created_at: string | null
          id: string
          is_official: boolean | null
          name: string
          reference_date: string | null
          region: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_official?: boolean | null
          name: string
          reference_date?: string | null
          region?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_official?: boolean | null
          name?: string
          reference_date?: string | null
          region?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      proposals: {
        Row: {
          aprovada_em: string | null
          budget_id: string | null
          budget_name: string | null
          client_id: string | null
          client_name: string | null
          created_at: string | null
          emitida_em: string | null
          empresa_cnpj: string | null
          empresa_nome: string | null
          gerada_em: string | null
          id: string
          inclui_cronograma: boolean | null
          inclui_curva_abc: boolean | null
          inclui_memorial_calculo: boolean | null
          logo_base64: string | null
          nome: string
          observacoes: string | null
          responsavel_crea: string | null
          responsavel_nome: string | null
          revisada_em: string | null
          status: string | null
          termos_ressalvas: string | null
          tipo_orcamento: string | null
          updated_at: string | null
          user_id: string
          valor_total: number | null
        }
        Insert: {
          aprovada_em?: string | null
          budget_id?: string | null
          budget_name?: string | null
          client_id?: string | null
          client_name?: string | null
          created_at?: string | null
          emitida_em?: string | null
          empresa_cnpj?: string | null
          empresa_nome?: string | null
          gerada_em?: string | null
          id?: string
          inclui_cronograma?: boolean | null
          inclui_curva_abc?: boolean | null
          inclui_memorial_calculo?: boolean | null
          logo_base64?: string | null
          nome: string
          observacoes?: string | null
          responsavel_crea?: string | null
          responsavel_nome?: string | null
          revisada_em?: string | null
          status?: string | null
          termos_ressalvas?: string | null
          tipo_orcamento?: string | null
          updated_at?: string | null
          user_id: string
          valor_total?: number | null
        }
        Update: {
          aprovada_em?: string | null
          budget_id?: string | null
          budget_name?: string | null
          client_id?: string | null
          client_name?: string | null
          created_at?: string | null
          emitida_em?: string | null
          empresa_cnpj?: string | null
          empresa_nome?: string | null
          gerada_em?: string | null
          id?: string
          inclui_cronograma?: boolean | null
          inclui_curva_abc?: boolean | null
          inclui_memorial_calculo?: boolean | null
          logo_base64?: string | null
          nome?: string
          observacoes?: string | null
          responsavel_crea?: string | null
          responsavel_nome?: string | null
          revisada_em?: string | null
          status?: string | null
          termos_ressalvas?: string | null
          tipo_orcamento?: string | null
          updated_at?: string | null
          user_id?: string
          valor_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "proposals_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      reference_bases: {
        Row: {
          created_at: string
          created_by: string
          id: string
          metadata: Json
          name: string
          slug: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          id?: string
          metadata?: Json
          name: string
          slug: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          metadata?: Json
          name?: string
          slug?: string
          user_id?: string
        }
        Relationships: []
      }
      sinapi_composition_items: {
        Row: {
          coefficient: number
          composition_code: string
          created_at: string
          id: string
          item_code: string
          item_type: string
          price_table_id: string
          unit: string | null
        }
        Insert: {
          coefficient: number
          composition_code: string
          created_at?: string
          id?: string
          item_code: string
          item_type: string
          price_table_id: string
          unit?: string | null
        }
        Update: {
          coefficient?: number
          composition_code?: string
          created_at?: string
          id?: string
          item_code?: string
          item_type?: string
          price_table_id?: string
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sinapi_composition_items_price_table_id_fkey"
            columns: ["price_table_id"]
            isOneToOne: false
            referencedRelation: "sinapi_price_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      sinapi_composition_prices: {
        Row: {
          composition_code: string
          created_at: string
          id: string
          price: number
          price_table_id: string
        }
        Insert: {
          composition_code: string
          created_at?: string
          id?: string
          price: number
          price_table_id: string
        }
        Update: {
          composition_code?: string
          created_at?: string
          id?: string
          price?: number
          price_table_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sinapi_composition_prices_price_table_id_fkey"
            columns: ["price_table_id"]
            isOneToOne: false
            referencedRelation: "sinapi_price_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      sinapi_compositions: {
        Row: {
          active: boolean | null
          code: string
          composition_type: string | null
          created_at: string
          description: string
          has_price: boolean | null
          id: string
          source: string
          unit: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean | null
          code: string
          composition_type?: string | null
          created_at?: string
          description: string
          has_price?: boolean | null
          id?: string
          source?: string
          unit?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean | null
          code?: string
          composition_type?: string | null
          created_at?: string
          description?: string
          has_price?: boolean | null
          id?: string
          source?: string
          unit?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      sinapi_import_runs: {
        Row: {
          counts: Json | null
          error_message: string | null
          finished_at: string | null
          id: string
          logs: string | null
          months: number[] | null
          regimes: string[] | null
          started_at: string
          status: string
          uf: string
          user_id: string | null
          year: number
        }
        Insert: {
          counts?: Json | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          logs?: string | null
          months?: number[] | null
          regimes?: string[] | null
          started_at?: string
          status?: string
          uf: string
          user_id?: string | null
          year: number
        }
        Update: {
          counts?: Json | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          logs?: string | null
          months?: number[] | null
          regimes?: string[] | null
          started_at?: string
          status?: string
          uf?: string
          user_id?: string | null
          year?: number
        }
        Relationships: []
      }
      sinapi_input_prices: {
        Row: {
          created_at: string
          id: string
          input_code: string
          price: number
          price_table_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          input_code: string
          price: number
          price_table_id: string
        }
        Update: {
          created_at?: string
          id?: string
          input_code?: string
          price?: number
          price_table_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sinapi_input_prices_price_table_id_fkey"
            columns: ["price_table_id"]
            isOneToOne: false
            referencedRelation: "sinapi_price_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      sinapi_inputs_base: {
        Row: {
          active: boolean | null
          category: string | null
          code: string
          created_at: string
          description: string
          id: string
          source: string
          unit: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean | null
          category?: string | null
          code: string
          created_at?: string
          description: string
          id?: string
          source?: string
          unit?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean | null
          category?: string | null
          code?: string
          created_at?: string
          description?: string
          id?: string
          source?: string
          unit?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      sinapi_price_tables: {
        Row: {
          competence: string
          competencia: string | null
          created_at: string
          file_urls: Json | null
          id: string
          is_mock: boolean | null
          regime: string
          source: string
          source_tag: string | null
          uf: string
        }
        Insert: {
          competence: string
          competencia?: string | null
          created_at?: string
          file_urls?: Json | null
          id?: string
          is_mock?: boolean | null
          regime: string
          source?: string
          source_tag?: string | null
          uf: string
        }
        Update: {
          competence?: string
          competencia?: string | null
          created_at?: string
          file_urls?: Json | null
          id?: string
          is_mock?: boolean | null
          regime?: string
          source?: string
          source_tag?: string | null
          uf?: string
        }
        Relationships: []
      }
      user_learning_memory: {
        Row: {
          confidence_score: number
          created_at: string
          from_base: string | null
          from_text: string
          id: string
          last_used_at: string | null
          to_base: string
          to_code: string
          updated_at: string
          usage_count: number
          user_id: string
        }
        Insert: {
          confidence_score?: number
          created_at?: string
          from_base?: string | null
          from_text: string
          id?: string
          last_used_at?: string | null
          to_base: string
          to_code: string
          updated_at?: string
          usage_count?: number
          user_id: string
        }
        Update: {
          confidence_score?: number
          created_at?: string
          from_base?: string | null
          from_text?: string
          id?: string
          last_used_at?: string | null
          to_base?: string
          to_code?: string
          updated_at?: string
          usage_count?: number
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      budget_items_with_weight: {
        Row: {
          bdi: number | null
          budget_id: string | null
          calculation_memory: string | null
          calculation_steps: string[] | null
          code: string | null
          composition_id: string | null
          cost_center: string | null
          created_at: string | null
          custom_bdi: number | null
          description: string | null
          final_price: number | null
          id: string | null
          insumo_id: string | null
          is_desonerated: boolean | null
          is_locked: boolean | null
          item_number: string | null
          item_type: string | null
          level: number | null
          notes: string | null
          order_index: number | null
          parent_id: string | null
          peso: number | null
          quantity: number | null
          source: string | null
          total_price: number | null
          type: string | null
          unit: string | null
          unit_price: number | null
          updated_at: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "budget_items_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_items_composition_id_fkey"
            columns: ["composition_id"]
            isOneToOne: false
            referencedRelation: "compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_items_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "insumos_base"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_items_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "budget_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_items_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "budget_items_with_weight"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_items_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "cronograma_base"
            referencedColumns: ["id"]
          },
        ]
      }
      cronograma_base: {
        Row: {
          bdi: number | null
          budget_id: string | null
          calculation_memory: string | null
          calculation_steps: string[] | null
          code: string | null
          composition_id: string | null
          cost_center: string | null
          created_at: string | null
          custom_bdi: number | null
          description: string | null
          final_price: number | null
          id: string | null
          insumo_id: string | null
          is_desonerated: boolean | null
          is_locked: boolean | null
          item_number: string | null
          item_type: string | null
          level: number | null
          notes: string | null
          order_index: number | null
          parent_id: string | null
          quantity: number | null
          source: string | null
          total_price: number | null
          type: string | null
          unit: string | null
          unit_price: number | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          bdi?: number | null
          budget_id?: string | null
          calculation_memory?: string | null
          calculation_steps?: string[] | null
          code?: string | null
          composition_id?: string | null
          cost_center?: string | null
          created_at?: string | null
          custom_bdi?: number | null
          description?: string | null
          final_price?: number | null
          id?: string | null
          insumo_id?: string | null
          is_desonerated?: boolean | null
          is_locked?: boolean | null
          item_number?: string | null
          item_type?: string | null
          level?: number | null
          notes?: string | null
          order_index?: number | null
          parent_id?: string | null
          quantity?: number | null
          source?: string | null
          total_price?: number | null
          type?: string | null
          unit?: string | null
          unit_price?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          bdi?: number | null
          budget_id?: string | null
          calculation_memory?: string | null
          calculation_steps?: string[] | null
          code?: string | null
          composition_id?: string | null
          cost_center?: string | null
          created_at?: string | null
          custom_bdi?: number | null
          description?: string | null
          final_price?: number | null
          id?: string | null
          insumo_id?: string | null
          is_desonerated?: boolean | null
          is_locked?: boolean | null
          item_number?: string | null
          item_type?: string | null
          level?: number | null
          notes?: string | null
          order_index?: number | null
          parent_id?: string | null
          quantity?: number | null
          source?: string | null
          total_price?: number | null
          type?: string | null
          unit?: string | null
          unit_price?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "budget_items_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_items_composition_id_fkey"
            columns: ["composition_id"]
            isOneToOne: false
            referencedRelation: "compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_items_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "insumos_base"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_items_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "budget_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_items_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "budget_items_with_weight"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_items_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "cronograma_base"
            referencedColumns: ["id"]
          },
        ]
      }
      debug_worker_status: {
        Row: {
          ai_items_last_10min: number | null
          ai_items_total: number | null
          cron_failures_last_hour: number | null
          dispatched_tasks: number | null
          done_tasks: number | null
          failed_tasks: number | null
          queued_tasks: number | null
          running_tasks: number | null
        }
        Relationships: []
      }
      insumos: {
        Row: {
          category: string | null
          code: string | null
          description: string | null
          fonte: string | null
          type: string | null
          unit: string | null
          user_id: string | null
        }
        Relationships: []
      }
      sinapi_compositions_with_prices: {
        Row: {
          code: string | null
          competence: string | null
          composition_type: string | null
          description: string | null
          id: string | null
          items_count: number | null
          price: number | null
          regime: string | null
          source: string | null
          uf: string | null
          unit: string | null
        }
        Relationships: []
      }
      sinapi_inputs_with_prices: {
        Row: {
          category: string | null
          code: string | null
          competence: string | null
          description: string | null
          id: string | null
          price: number | null
          regime: string | null
          source: string | null
          uf: string | null
          unit: string | null
        }
        Relationships: []
      }
      sinapi_items_search: {
        Row: {
          code: string | null
          description: string | null
          item_type: string | null
          unit: string | null
        }
        Relationships: []
      }
      view_jobs_ready_for_extraction_retry: {
        Row: {
          extraction_attempts: number | null
          extraction_last_reason: string | null
          extraction_next_retry_at: string | null
          id: string | null
        }
        Insert: {
          extraction_attempts?: number | null
          extraction_last_reason?: string | null
          extraction_next_retry_at?: string | null
          id?: string | null
        }
        Update: {
          extraction_attempts?: number | null
          extraction_last_reason?: string | null
          extraction_next_retry_at?: string | null
          id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      __touch_postgrest_cache: { Args: never; Returns: string }
      _app_secret: { Args: { secret_name: string }; Returns: string }
      _get_service_role_key: { Args: never; Returns: string }
      admin_confirm_import_job: { Args: { p_job_id: string }; Returns: Json }
      admin_start_import_job: {
        Args: { job_id: string }
        Returns: {
          artifacts: Json
          created_at: string
          current_step: string | null
          doc_role: Database["public"]["Enums"]["import_doc_role"]
          document_context: Json
          error_message: string | null
          extraction_attempts: number
          extraction_last_reason: string | null
          extraction_next_retry_at: string | null
          extraction_retryable: boolean
          finalization_cursor: number | null
          finalized_at: string | null
          heartbeat_at: string | null
          id: string
          is_desonerado: boolean | null
          last_error: string | null
          progress: number
          result_budget_id: string | null
          stage: string | null
          stage_updated_at: string | null
          status: Database["public"]["Enums"]["import_job_status"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "import_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      atomic_merge_stageb_metadata: {
        Args: { file_id: string; stageb_data: Json }
        Returns: undefined
      }
      auto_finalize_pending_jobs: { Args: never; Returns: undefined }
      claim_next_ocr_job: {
        Args: { p_lock_duration_sec?: number; p_worker_id: string }
        Returns: {
          chunks_processed: number
          completed_at: string | null
          created_at: string | null
          id: string
          import_file_id: string
          job_id: string
          last_error: string | null
          lock_expires_at: string | null
          locked_by: string | null
          max_retries: number | null
          next_chunk_index: number
          priority: number | null
          retry_count: number | null
          scheduled_for: string | null
          started_at: string | null
          status: string
          total_chunks: number | null
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "import_ocr_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      cleanup_stale_ocr_jobs: {
        Args: never
        Returns: {
          failed_count: number
          requeued_count: number
        }[]
      }
      debug_finalize_timing: {
        Args: {
          p_budget_id: string
          p_job_id: string
          p_price_table_id: string
          p_user_id: string
        }
        Returns: {
          etapa: string
          ms: number
          rows_affected: number
        }[]
      }
      dispatch_parse_task: {
        Args: { max_tasks?: number }
        Returns: {
          dispatch_status: string
          file_id: string
          job_id: string
          task_id: string
        }[]
      }
      ensure_sinapi_price_table:
        | { Args: { _row: Json }; Returns: string }
        | {
            Args: {
              _competence: string
              _file_urls?: Json
              _is_mock?: boolean
              _regime: string
              _source: string
              _source_tag?: string
              _uf: string
            }
            Returns: string
          }
      expand_composition_hierarchy: {
        Args: {
          p_budget_id: string
          p_competence?: string
          p_desonerado?: boolean
          p_max_depth?: number
          p_uf?: string
          p_user_id: string
        }
        Returns: number
      }
      fail_stuck_import_jobs: { Args: never; Returns: number }
      finalize_import_job: { Args: { p_job_id: string }; Returns: string }
      finalize_import_to_budget: {
        Args: {
          p_analytic_data?: Json
          p_job_id: string
          p_params?: Json
          p_user_id?: string
        }
        Returns: Json
      }
      finalize_ocr_job: {
        Args: {
          p_id: string
          p_last_error?: string
          p_retry_count?: number
          p_status: string
        }
        Returns: undefined
      }
      finalize_ready_import_jobs:
        | { Args: never; Returns: number }
        | { Args: { p_limit?: number }; Returns: number }
      find_analytic_file_composition: {
        Args: { p_code: string; p_job_id: string }
        Returns: {
          item_code: string
          item_description: string
          item_price: number
          item_quantity: number
          item_type: string
          item_unit: string
        }[]
      }
      find_composition_in_bases: {
        Args: {
          p_code: string
          p_competence?: string
          p_desonerado?: boolean
          p_uf?: string
          p_user_id: string
        }
        Returns: {
          item_description: string
          item_price: number
          item_quantity: number
          item_type: string
          item_unit: string
          source_base: string
        }[]
      }
      find_internal_composition: {
        Args: {
          p_code: string
          p_competence: string
          p_desonerado: boolean
          p_uf: string
        }
        Returns: {
          item_code: string
          item_description: string
          item_price: number
          item_quantity: number
          item_type: string
          item_unit: string
        }[]
      }
      fix_import_parse_worker_cron_headers: { Args: never; Returns: undefined }
      get_db_fingerprint: { Args: never; Returns: Json }
      get_extraction_retries_pending: {
        Args: { p_limit?: number }
        Returns: {
          job_id: string
        }[]
      }
      import_extraction_watchdog: { Args: never; Returns: number }
      import_job_set_checkpoint: {
        Args: {
          p_checkpoint: string
          p_checkpoint_ts?: string
          p_job_id: string
        }
        Returns: undefined
      }
      import_jobs_watchdog: { Args: never; Returns: undefined }
      ingest_sinapi_composition_items: {
        Args: { _rows: Json }
        Returns: undefined
      }
      ingest_sinapi_composition_items_batch: {
        Args: { p_items: Json; p_price_table_id: string }
        Returns: number
      }
      ingest_sinapi_composition_prices: {
        Args: { _rows: Json }
        Returns: undefined
      }
      ingest_sinapi_composition_prices_batch: {
        Args: { p_price_table_id: string; p_prices: Json }
        Returns: number
      }
      ingest_sinapi_compositions: { Args: { _rows: Json }; Returns: undefined }
      ingest_sinapi_compositions_batch: {
        Args: { p_compositions: Json }
        Returns: number
      }
      ingest_sinapi_input_prices: { Args: { _rows: Json }; Returns: undefined }
      ingest_sinapi_input_prices_batch: {
        Args: { p_price_table_id: string; p_prices: Json }
        Returns: number
      }
      ingest_sinapi_inputs: { Args: { _rows: Json }; Returns: undefined }
      ingest_sinapi_inputs_batch: { Args: { p_inputs: Json }; Returns: number }
      ingest_sinapi_price_table: {
        Args: {
          p_competencia: string
          p_is_mock: boolean
          p_regime: string
          p_source: string
          p_uf: string
        }
        Returns: string
      }
      mark_parse_tasks_ready: {
        Args: { max_tasks?: number }
        Returns: string[]
      }
      persist_analytic_data: {
        Args: { p_analytic_data: Json; p_budget_id: string; p_user_id: string }
        Returns: number
      }
      process_hydration_batch: {
        Args: {
          p_batch_size?: number
          p_budget_id: string
          p_competence?: string
          p_desonerado?: boolean
          p_job_id: string
          p_uf?: string
          p_user_id: string
        }
        Returns: Json
      }
      recalc_budget: { Args: { bid: string }; Returns: undefined }
      recalc_budget_hierarchy: {
        Args: { p_budget_id: string }
        Returns: undefined
      }
      recalc_sinapi_composition_prices: {
        Args: { p_price_table_id: string }
        Returns: number
      }
      recover_stale_ocr_locks: { Args: never; Returns: number }
      recover_stuck_parse_tasks: { Args: never; Returns: number }
      reorder_budget_items: { Args: { items: Json }; Returns: boolean }
      reprocess_extraction: { Args: { p_job_id: string }; Returns: Json }
      resolve_import_hydration_issue: {
        Args: { p_issue_id: string; p_selected_composition: Json }
        Returns: Json
      }
      run_finalize_import_jobs: { Args: { p_limit?: number }; Returns: number }
      save_chunk_progress: {
        Args: {
          p_chunk_index: number
          p_is_final: boolean
          p_ocr_job_id: string
          p_total_chunks: number
        }
        Returns: undefined
      }
      search_items: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          code: string
          description: string
          item_type: string
          unit: string
        }[]
      }
      search_sinapi_any_item: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          code: string
          description: string
          item_type: string
          unit: string
        }[]
      }
      search_sinapi_compositions: {
        Args: { p_limit?: number; p_q?: string }
        Returns: {
          code: string
          description: string
          unit: string
        }[]
      }
      search_sinapi_inputs: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          code: string
          description: string
          item_type: string
          unit: string
        }[]
      }
      should_poke_ocr_worker: { Args: { p_cap?: number }; Returns: boolean }
      should_watchdog_fail: {
        Args: { j: Database["public"]["Tables"]["import_jobs"]["Row"] }
        Returns: boolean
      }
      sinapi_import_summary: {
        Args: { p_price_table_id: string }
        Returns: {
          missing: number
          price_table_id: string
          priced: number
          total: number
        }[]
      }
      start_import_job: { Args: { p_job_id: string }; Returns: Json }
      sync_import_job_from_ocr: { Args: { p_job_id: string }; Returns: Json }
      trigger_finalize_import_async: {
        Args: { p_job_id: string }
        Returns: undefined
      }
      update_ocr_job_status: {
        Args: {
          p_id: string
          p_last_error: string
          p_retry_count?: number
          p_status: string
        }
        Returns: undefined
      }
    }
    Enums: {
      import_doc_role: "synthetic" | "analytical" | "unknown"
      import_file_kind: "pdf" | "excel" | "other"
      import_job_status:
        | "queued"
        | "processing"
        | "waiting_user"
        | "applying"
        | "done"
        | "failed"
        | "waiting_user_extraction_failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      import_doc_role: ["synthetic", "analytical", "unknown"],
      import_file_kind: ["pdf", "excel", "other"],
      import_job_status: [
        "queued",
        "processing",
        "waiting_user",
        "applying",
        "done",
        "failed",
        "waiting_user_extraction_failed",
      ],
    },
  },
} as const

