export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          account_group: string
          archived_at: string | null
          business_id: string
          code: string
          contra_of: string | null
          created_at: string
          id: string
          name: string
          system_key: string | null
          type: string | null
        }
        Insert: {
          account_group: string
          archived_at?: string | null
          business_id: string
          code: string
          contra_of?: string | null
          created_at?: string
          id?: string
          name: string
          system_key?: string | null
          type?: string | null
        }
        Update: {
          account_group?: string
          archived_at?: string | null
          business_id?: string
          code?: string
          contra_of?: string | null
          created_at?: string
          id?: string
          name?: string
          system_key?: string | null
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_business_id_contra_of_fkey"
            columns: ["business_id", "contra_of"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "accounts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      adjustment_lines: {
        Row: {
          business_id: string
          expected_qty: number | null
          id: number
          quantity: number
          request_id: string
          stock_item_id: string
        }
        Insert: {
          business_id: string
          expected_qty?: number | null
          id?: never
          quantity: number
          request_id: string
          stock_item_id: string
        }
        Update: {
          business_id?: string
          expected_qty?: number | null
          id?: never
          quantity?: number
          request_id?: string
          stock_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "adjustment_lines_business_id_request_id_fkey"
            columns: ["business_id", "request_id"]
            isOneToOne: false
            referencedRelation: "adjustment_requests"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "adjustment_lines_business_id_stock_item_id_fkey"
            columns: ["business_id", "stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_availability"
            referencedColumns: ["business_id", "stock_item_id"]
          },
          {
            foreignKeyName: "adjustment_lines_business_id_stock_item_id_fkey"
            columns: ["business_id", "stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      adjustment_requests: {
        Row: {
          business_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          document_id: string | null
          effective_date: string
          id: string
          idempotency_key: string | null
          kind: string
          location_id: string
          reason: string
          reference: string
          requested_by: string
          status: string
        }
        Insert: {
          business_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          document_id?: string | null
          effective_date: string
          id?: string
          idempotency_key?: string | null
          kind: string
          location_id: string
          reason: string
          reference: string
          requested_by: string
          status?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          document_id?: string | null
          effective_date?: string
          id?: string
          idempotency_key?: string | null
          kind?: string
          location_id?: string
          reason?: string
          reference?: string
          requested_by?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "adjustment_requests_business_id_document_id_fkey"
            columns: ["business_id", "document_id"]
            isOneToOne: false
            referencedRelation: "stock_documents"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "adjustment_requests_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adjustment_requests_business_id_location_id_fkey"
            columns: ["business_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      annual_accounts: {
        Row: {
          approved_by: string | null
          approved_on: string | null
          approved_year_closed_at: string | null
          business_id: string
          company_name: string | null
          directors: string | null
          events_after: string | null
          fiscal_year_id: string
          going_concern: string | null
          id: string
          other_notes: string | null
          policies: string | null
          principal_activity: string | null
          rc_number: string | null
          registered_office: string | null
          related_parties: string | null
          share_capital_note: string | null
          signed_off_at: string | null
          signed_off_by: string | null
          signed_off_name: string | null
          signed_off_note: string | null
          signed_off_on: string | null
          signed_off_qualification: string | null
          signed_off_year_closed_at: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approved_by?: string | null
          approved_on?: string | null
          approved_year_closed_at?: string | null
          business_id: string
          company_name?: string | null
          directors?: string | null
          events_after?: string | null
          fiscal_year_id: string
          going_concern?: string | null
          id?: string
          other_notes?: string | null
          policies?: string | null
          principal_activity?: string | null
          rc_number?: string | null
          registered_office?: string | null
          related_parties?: string | null
          share_capital_note?: string | null
          signed_off_at?: string | null
          signed_off_by?: string | null
          signed_off_name?: string | null
          signed_off_note?: string | null
          signed_off_on?: string | null
          signed_off_qualification?: string | null
          signed_off_year_closed_at?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approved_by?: string | null
          approved_on?: string | null
          approved_year_closed_at?: string | null
          business_id?: string
          company_name?: string | null
          directors?: string | null
          events_after?: string | null
          fiscal_year_id?: string
          going_concern?: string | null
          id?: string
          other_notes?: string | null
          policies?: string | null
          principal_activity?: string | null
          rc_number?: string | null
          registered_office?: string | null
          related_parties?: string | null
          share_capital_note?: string | null
          signed_off_at?: string | null
          signed_off_by?: string | null
          signed_off_name?: string | null
          signed_off_note?: string | null
          signed_off_on?: string | null
          signed_off_qualification?: string | null
          signed_off_year_closed_at?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "annual_accounts_business_id_fiscal_year_id_fkey"
            columns: ["business_id", "fiscal_year_id"]
            isOneToOne: true
            referencedRelation: "fiscal_years"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "annual_accounts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor: string | null
          business_id: string
          changed_at: string
          id: number
          new_data: Json | null
          old_data: Json | null
          record_id: string
          table_name: string
        }
        Insert: {
          action: string
          actor?: string | null
          business_id: string
          changed_at?: string
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          record_id: string
          table_name: string
        }
        Update: {
          action?: string
          actor?: string | null
          business_id?: string
          changed_at?: string
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string
          table_name?: string
        }
        Relationships: []
      }
      bank_accounts: {
        Row: {
          account_id: string
          archived_at: string | null
          business_id: string
          column_map: Json | null
          created_at: string
          id: string
          kind: string
          name: string
        }
        Insert: {
          account_id: string
          archived_at?: string | null
          business_id: string
          column_map?: Json | null
          created_at?: string
          id?: string
          kind: string
          name: string
        }
        Update: {
          account_id?: string
          archived_at?: string | null
          business_id?: string
          column_map?: Json | null
          created_at?: string
          id?: string
          kind?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_business_id_account_id_fkey"
            columns: ["business_id", "account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "bank_accounts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_reconciliations: {
        Row: {
          bank_account_id: string
          book_balance_minor: number
          business_id: string
          id: string
          reconciled_at: string
          reconciled_by: string
          statement_balance_minor: number
          through_date: string
        }
        Insert: {
          bank_account_id: string
          book_balance_minor: number
          business_id: string
          id?: string
          reconciled_at?: string
          reconciled_by?: string
          statement_balance_minor: number
          through_date: string
        }
        Update: {
          bank_account_id?: string
          book_balance_minor?: number
          business_id?: string
          id?: string
          reconciled_at?: string
          reconciled_by?: string
          statement_balance_minor?: number
          through_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_reconciliations_business_id_bank_account_id_fkey"
            columns: ["business_id", "bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      bank_statement_imports: {
        Row: {
          bank_account_id: string
          business_id: string
          file_name: string | null
          id: string
          idempotency_key: string
          imported_at: string
          imported_by: string
          line_count: number
          skipped_count: number
        }
        Insert: {
          bank_account_id: string
          business_id: string
          file_name?: string | null
          id?: string
          idempotency_key: string
          imported_at?: string
          imported_by?: string
          line_count?: number
          skipped_count?: number
        }
        Update: {
          bank_account_id?: string
          business_id?: string
          file_name?: string | null
          id?: string
          idempotency_key?: string
          imported_at?: string
          imported_by?: string
          line_count?: number
          skipped_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "bank_statement_imports_business_id_bank_account_id_fkey"
            columns: ["business_id", "bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      bank_statement_lines: {
        Row: {
          amount_minor: number
          balance_minor: number | null
          bank_account_id: string
          business_id: string
          decided_at: string | null
          decided_by: string | null
          description: string
          fingerprint: string
          id: string
          ignore_reason: string | null
          import_id: string
          journal_line_id: string | null
          line_date: string
          reference: string | null
          status: string
        }
        Insert: {
          amount_minor: number
          balance_minor?: number | null
          bank_account_id: string
          business_id: string
          decided_at?: string | null
          decided_by?: string | null
          description: string
          fingerprint: string
          id?: string
          ignore_reason?: string | null
          import_id: string
          journal_line_id?: string | null
          line_date: string
          reference?: string | null
          status?: string
        }
        Update: {
          amount_minor?: number
          balance_minor?: number | null
          bank_account_id?: string
          business_id?: string
          decided_at?: string | null
          decided_by?: string | null
          description?: string
          fingerprint?: string
          id?: string
          ignore_reason?: string | null
          import_id?: string
          journal_line_id?: string | null
          line_date?: string
          reference?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_statement_lines_business_id_bank_account_id_fkey"
            columns: ["business_id", "bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "bank_statement_lines_business_id_import_id_fkey"
            columns: ["business_id", "import_id"]
            isOneToOne: false
            referencedRelation: "bank_statement_imports"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "bank_statement_lines_journal_line_id_fkey"
            columns: ["journal_line_id"]
            isOneToOne: false
            referencedRelation: "journal_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      bom_lines: {
        Row: {
          bom_id: string
          business_id: string
          id: string
          line_no: number
          notes: string | null
          qty: number
          qty_base: number
          stock_item_id: string
          unit: string
          variant_id: string | null
          wastage_pct: number
        }
        Insert: {
          bom_id: string
          business_id: string
          id?: string
          line_no: number
          notes?: string | null
          qty: number
          qty_base: number
          stock_item_id: string
          unit: string
          variant_id?: string | null
          wastage_pct?: number
        }
        Update: {
          bom_id?: string
          business_id?: string
          id?: string
          line_no?: number
          notes?: string | null
          qty?: number
          qty_base?: number
          stock_item_id?: string
          unit?: string
          variant_id?: string | null
          wastage_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "bom_lines_business_id_bom_id_fkey"
            columns: ["business_id", "bom_id"]
            isOneToOne: false
            referencedRelation: "boms"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "bom_lines_business_id_stock_item_id_fkey"
            columns: ["business_id", "stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_availability"
            referencedColumns: ["business_id", "stock_item_id"]
          },
          {
            foreignKeyName: "bom_lines_business_id_stock_item_id_fkey"
            columns: ["business_id", "stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "bom_lines_business_id_variant_id_fkey"
            columns: ["business_id", "variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      boms: {
        Row: {
          business_id: string
          created_at: string
          created_by: string
          id: string
          instructions: string | null
          is_one_off: boolean
          labour_cost: number
          name: string
          other_cost: number
          product_id: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by: string
          id?: string
          instructions?: string | null
          is_one_off?: boolean
          labour_cost?: number
          name: string
          other_cost?: number
          product_id: string
          status?: string
          updated_at?: string
          version: number
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string
          id?: string
          instructions?: string | null
          is_one_off?: boolean
          labour_cost?: number
          name?: string
          other_cost?: number
          product_id?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "boms_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boms_business_id_product_id_fkey"
            columns: ["business_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      books_payment_accounts: {
        Row: {
          account_id: string
          business_id: string
          method: Database["public"]["Enums"]["payment_method"]
        }
        Insert: {
          account_id: string
          business_id: string
          method: Database["public"]["Enums"]["payment_method"]
        }
        Update: {
          account_id?: string
          business_id?: string
          method?: Database["public"]["Enums"]["payment_method"]
        }
        Relationships: [
          {
            foreignKeyName: "books_payment_accounts_business_id_account_id_fkey"
            columns: ["business_id", "account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "books_payment_accounts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      books_posting_problems: {
        Row: {
          business_id: string
          first_seen_at: string
          last_tried_at: string
          message: string
          source_id: string
          source_type: string
        }
        Insert: {
          business_id: string
          first_seen_at?: string
          last_tried_at?: string
          message: string
          source_id: string
          source_type: string
        }
        Update: {
          business_id?: string
          first_seen_at?: string
          last_tried_at?: string
          message?: string
          source_id?: string
          source_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "books_posting_problems_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      books_settings: {
        Row: {
          business_id: string
          first_year_start: string
          incorporation_date: string | null
          locked_through: string | null
          next_journal_number: number
          next_numbers: Json
          set_up_at: string
          set_up_by: string
          vat_charged_from: string | null
          vat_rate: number | null
          vat_registered: boolean
        }
        Insert: {
          business_id: string
          first_year_start: string
          incorporation_date?: string | null
          locked_through?: string | null
          next_journal_number?: number
          next_numbers?: Json
          set_up_at?: string
          set_up_by?: string
          vat_charged_from?: string | null
          vat_rate?: number | null
          vat_registered?: boolean
        }
        Update: {
          business_id?: string
          first_year_start?: string
          incorporation_date?: string | null
          locked_through?: string | null
          next_journal_number?: number
          next_numbers?: Json
          set_up_at?: string
          set_up_by?: string
          vat_charged_from?: string | null
          vat_rate?: number | null
          vat_registered?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "books_settings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_subscriptions: {
        Row: {
          business_id: string
          current_period_end: string | null
          managed_manually: boolean
          notes: string | null
          plan_id: string | null
          status: Database["public"]["Enums"]["subscription_status"]
          trial_ends_at: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          business_id: string
          current_period_end?: string | null
          managed_manually?: boolean
          notes?: string | null
          plan_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          trial_ends_at?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          business_id?: string
          current_period_end?: string | null
          managed_manually?: boolean
          notes?: string | null
          plan_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          trial_ends_at?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_subscriptions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          currency: string
          cutover_date: string | null
          id: string
          is_demo: boolean
          logo_path: string | null
          name: string
          next_batch_number: number
          next_dispatch_number: number
          next_expense_number: number
          next_job_number: number
          next_order_number: number
          next_po_number: number
          next_qc_number: number
          next_receipt_number: number
          next_repair_number: number
          next_return_number: number
          next_stock_doc_number: number
          next_supplier_return_number: number
          order_prefix: string
          payment_details: string | null
          slug: string
          stage_labels: Json
          stock_closed_through: string | null
          tax_id: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          cutover_date?: string | null
          id?: string
          is_demo?: boolean
          logo_path?: string | null
          name: string
          next_batch_number?: number
          next_dispatch_number?: number
          next_expense_number?: number
          next_job_number?: number
          next_order_number?: number
          next_po_number?: number
          next_qc_number?: number
          next_receipt_number?: number
          next_repair_number?: number
          next_return_number?: number
          next_stock_doc_number?: number
          next_supplier_return_number?: number
          order_prefix?: string
          payment_details?: string | null
          slug: string
          stage_labels?: Json
          stock_closed_through?: string | null
          tax_id?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          cutover_date?: string | null
          id?: string
          is_demo?: boolean
          logo_path?: string | null
          name?: string
          next_batch_number?: number
          next_dispatch_number?: number
          next_expense_number?: number
          next_job_number?: number
          next_order_number?: number
          next_po_number?: number
          next_qc_number?: number
          next_receipt_number?: number
          next_repair_number?: number
          next_return_number?: number
          next_stock_doc_number?: number
          next_supplier_return_number?: number
          order_prefix?: string
          payment_details?: string | null
          slug?: string
          stage_labels?: Json
          stock_closed_through?: string | null
          tax_id?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          address_line: string | null
          archived_at: string | null
          assigned_to: string | null
          business_id: string
          bust: number | null
          city: string | null
          clothing_size: string | null
          contact_preferences: string[]
          country: string
          created_at: string
          created_by: string | null
          email: string | null
          email_normalized: string | null
          external_id: string | null
          fit_notes: string | null
          full_name: string
          hip: number | null
          id: string
          marketing_consent: boolean
          marketing_consent_at: string | null
          measured_on: string | null
          measurement_unit:
            | Database["public"]["Enums"]["measurement_unit"]
            | null
          notes: string | null
          phone: string | null
          phone_normalized: string | null
          preferred_colours: string | null
          preferred_products: string | null
          shoe_size: string | null
          source: Database["public"]["Enums"]["contact_source"] | null
          state: string | null
          tags: string[]
          updated_at: string
          waist: number | null
          whatsapp: string | null
          whatsapp_normalized: string | null
        }
        Insert: {
          address_line?: string | null
          archived_at?: string | null
          assigned_to?: string | null
          business_id: string
          bust?: number | null
          city?: string | null
          clothing_size?: string | null
          contact_preferences?: string[]
          country?: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          email_normalized?: string | null
          external_id?: string | null
          fit_notes?: string | null
          full_name: string
          hip?: number | null
          id?: string
          marketing_consent?: boolean
          marketing_consent_at?: string | null
          measured_on?: string | null
          measurement_unit?:
            | Database["public"]["Enums"]["measurement_unit"]
            | null
          notes?: string | null
          phone?: string | null
          phone_normalized?: string | null
          preferred_colours?: string | null
          preferred_products?: string | null
          shoe_size?: string | null
          source?: Database["public"]["Enums"]["contact_source"] | null
          state?: string | null
          tags?: string[]
          updated_at?: string
          waist?: number | null
          whatsapp?: string | null
          whatsapp_normalized?: string | null
        }
        Update: {
          address_line?: string | null
          archived_at?: string | null
          assigned_to?: string | null
          business_id?: string
          bust?: number | null
          city?: string | null
          clothing_size?: string | null
          contact_preferences?: string[]
          country?: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          email_normalized?: string | null
          external_id?: string | null
          fit_notes?: string | null
          full_name?: string
          hip?: number | null
          id?: string
          marketing_consent?: boolean
          marketing_consent_at?: string | null
          measured_on?: string | null
          measurement_unit?:
            | Database["public"]["Enums"]["measurement_unit"]
            | null
          notes?: string | null
          phone?: string | null
          phone_normalized?: string | null
          preferred_colours?: string | null
          preferred_products?: string | null
          shoe_size?: string | null
          source?: Database["public"]["Enums"]["contact_source"] | null
          state?: string | null
          tags?: string[]
          updated_at?: string
          waist?: number | null
          whatsapp?: string | null
          whatsapp_normalized?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_business_id_assigned_to_fkey"
            columns: ["business_id", "assigned_to"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["business_id", "user_id"]
          },
          {
            foreignKeyName: "customers_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      depreciation_lines: {
        Row: {
          amount_minor: number
          asset_id: string
          business_id: string
          from_date: string
          run_id: string
          to_date: string
        }
        Insert: {
          amount_minor: number
          asset_id: string
          business_id: string
          from_date: string
          run_id: string
          to_date: string
        }
        Update: {
          amount_minor?: number
          asset_id?: string
          business_id?: string
          from_date?: string
          run_id?: string
          to_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "depreciation_lines_business_id_asset_id_fkey"
            columns: ["business_id", "asset_id"]
            isOneToOne: false
            referencedRelation: "fixed_assets"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "depreciation_lines_business_id_run_id_fkey"
            columns: ["business_id", "run_id"]
            isOneToOne: false
            referencedRelation: "depreciation_runs"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      depreciation_runs: {
        Row: {
          business_id: string
          created_at: string
          created_by: string
          id: string
          idempotency_key: string
          through_date: string
          total_minor: number
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string
          id?: string
          idempotency_key: string
          through_date: string
          total_minor: number
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string
          id?: string
          idempotency_key?: string
          through_date?: string
          total_minor?: number
        }
        Relationships: [
          {
            foreignKeyName: "depreciation_runs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      enquiries: {
        Row: {
          archived_at: string | null
          assigned_to: string | null
          business_id: string
          created_at: string
          created_by: string | null
          customer_id: string
          follow_up_at: string | null
          id: string
          lost_reason: string | null
          next_action: string | null
          notes: string | null
          position: number
          product_id: string | null
          product_interest: string | null
          source: Database["public"]["Enums"]["contact_source"] | null
          stage: Database["public"]["Enums"]["enquiry_stage"]
          stage_changed_at: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          assigned_to?: string | null
          business_id: string
          created_at?: string
          created_by?: string | null
          customer_id: string
          follow_up_at?: string | null
          id?: string
          lost_reason?: string | null
          next_action?: string | null
          notes?: string | null
          position?: number
          product_id?: string | null
          product_interest?: string | null
          source?: Database["public"]["Enums"]["contact_source"] | null
          stage?: Database["public"]["Enums"]["enquiry_stage"]
          stage_changed_at?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          assigned_to?: string | null
          business_id?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string
          follow_up_at?: string | null
          id?: string
          lost_reason?: string | null
          next_action?: string | null
          notes?: string | null
          position?: number
          product_id?: string | null
          product_interest?: string | null
          source?: Database["public"]["Enums"]["contact_source"] | null
          stage?: Database["public"]["Enums"]["enquiry_stage"]
          stage_changed_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "enquiries_business_id_assigned_to_fkey"
            columns: ["business_id", "assigned_to"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["business_id", "user_id"]
          },
          {
            foreignKeyName: "enquiries_business_id_customer_id_fkey"
            columns: ["business_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "enquiries_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enquiries_business_id_product_id_fkey"
            columns: ["business_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      equity_movements: {
        Row: {
          amount_minor: number
          bank_account_id: string
          business_id: string
          created_at: string
          created_by: string
          director_key: string | null
          id: string
          idempotency_key: string
          kind: string
          moved_on: string
          note: string | null
          status: string
          void_reason: string | null
        }
        Insert: {
          amount_minor: number
          bank_account_id: string
          business_id: string
          created_at?: string
          created_by?: string
          director_key?: string | null
          id?: string
          idempotency_key: string
          kind: string
          moved_on: string
          note?: string | null
          status?: string
          void_reason?: string | null
        }
        Update: {
          amount_minor?: number
          bank_account_id?: string
          business_id?: string
          created_at?: string
          created_by?: string
          director_key?: string | null
          id?: string
          idempotency_key?: string
          kind?: string
          moved_on?: string
          note?: string | null
          status?: string
          void_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equity_movements_business_id_bank_account_id_fkey"
            columns: ["business_id", "bank_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "equity_movements_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          account_id: string
          amount_minor: number
          business_id: string
          decided_at: string | null
          decided_by: string | null
          description: string
          id: string
          idempotency_key: string
          number: string
          paid_from_account_id: string | null
          paid_on: string | null
          paid_when_recorded: boolean
          payee: string
          receipt_path: string | null
          reject_reason: string | null
          spent_on: string
          status: string
          submitted_at: string
          submitted_by: string
          vat_minor: number
          void_reason: string | null
        }
        Insert: {
          account_id: string
          amount_minor: number
          business_id: string
          decided_at?: string | null
          decided_by?: string | null
          description: string
          id: string
          idempotency_key: string
          number: string
          paid_from_account_id?: string | null
          paid_on?: string | null
          paid_when_recorded?: boolean
          payee: string
          receipt_path?: string | null
          reject_reason?: string | null
          spent_on: string
          status?: string
          submitted_at?: string
          submitted_by?: string
          vat_minor?: number
          void_reason?: string | null
        }
        Update: {
          account_id?: string
          amount_minor?: number
          business_id?: string
          decided_at?: string | null
          decided_by?: string | null
          description?: string
          id?: string
          idempotency_key?: string
          number?: string
          paid_from_account_id?: string | null
          paid_on?: string | null
          paid_when_recorded?: boolean
          payee?: string
          receipt_path?: string | null
          reject_reason?: string | null
          spent_on?: string
          status?: string
          submitted_at?: string
          submitted_by?: string
          vat_minor?: number
          void_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_business_id_account_id_fkey"
            columns: ["business_id", "account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "expenses_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_business_id_paid_from_account_id_fkey"
            columns: ["business_id", "paid_from_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      fiscal_years: {
        Row: {
          business_id: string
          closed_at: string | null
          closed_by: string | null
          closing_journal_id: string | null
          created_at: string
          end_date: string
          id: string
          kind: string
          start_date: string
          status: string
        }
        Insert: {
          business_id: string
          closed_at?: string | null
          closed_by?: string | null
          closing_journal_id?: string | null
          created_at?: string
          end_date: string
          id?: string
          kind: string
          start_date: string
          status?: string
        }
        Update: {
          business_id?: string
          closed_at?: string | null
          closed_by?: string | null
          closing_journal_id?: string | null
          created_at?: string
          end_date?: string
          id?: string
          kind?: string
          start_date?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_years_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_years_closing_journal_fk"
            columns: ["business_id", "closing_journal_id"]
            isOneToOne: false
            referencedRelation: "journals"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      fixed_assets: {
        Row: {
          accumulated_minor: number
          acquired_on: string
          asset_key: string
          business_id: string
          cost_minor: number
          created_at: string
          created_by: string
          depreciated_through: string
          disposed_on: string | null
          funding_account_id: string | null
          id: string
          idempotency_key: string
          life_years: number
          name: string
          number: string
          proceeds_account_id: string | null
          proceeds_minor: number | null
          residual_minor: number
          status: string
        }
        Insert: {
          accumulated_minor?: number
          acquired_on: string
          asset_key: string
          business_id: string
          cost_minor: number
          created_at?: string
          created_by?: string
          depreciated_through: string
          disposed_on?: string | null
          funding_account_id?: string | null
          id?: string
          idempotency_key: string
          life_years: number
          name: string
          number: string
          proceeds_account_id?: string | null
          proceeds_minor?: number | null
          residual_minor?: number
          status?: string
        }
        Update: {
          accumulated_minor?: number
          acquired_on?: string
          asset_key?: string
          business_id?: string
          cost_minor?: number
          created_at?: string
          created_by?: string
          depreciated_through?: string
          disposed_on?: string | null
          funding_account_id?: string | null
          id?: string
          idempotency_key?: string
          life_years?: number
          name?: string
          number?: string
          proceeds_account_id?: string | null
          proceeds_minor?: number | null
          residual_minor?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixed_assets_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_business_id_funding_account_id_fkey"
            columns: ["business_id", "funding_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "fixed_assets_business_id_proceeds_account_id_fkey"
            columns: ["business_id", "proceeds_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      goods_receipt_lines: {
        Row: {
          business_id: string
          id: string
          po_line_id: string | null
          qty_accepted_base: number
          qty_rejected_base: number
          qty_returned_base: number
          receipt_id: string
          reject_reason: string | null
          stock_item_id: string
          unit_cost: number
          unit_price: number
        }
        Insert: {
          business_id: string
          id?: string
          po_line_id?: string | null
          qty_accepted_base?: number
          qty_rejected_base?: number
          qty_returned_base?: number
          receipt_id: string
          reject_reason?: string | null
          stock_item_id: string
          unit_cost?: number
          unit_price?: number
        }
        Update: {
          business_id?: string
          id?: string
          po_line_id?: string | null
          qty_accepted_base?: number
          qty_rejected_base?: number
          qty_returned_base?: number
          receipt_id?: string
          reject_reason?: string | null
          stock_item_id?: string
          unit_cost?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipt_lines_business_id_po_line_id_fkey"
            columns: ["business_id", "po_line_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_lines"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "goods_receipt_lines_business_id_receipt_id_fkey"
            columns: ["business_id", "receipt_id"]
            isOneToOne: false
            referencedRelation: "goods_receipts"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "goods_receipt_lines_business_id_stock_item_id_fkey"
            columns: ["business_id", "stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_availability"
            referencedColumns: ["business_id", "stock_item_id"]
          },
          {
            foreignKeyName: "goods_receipt_lines_business_id_stock_item_id_fkey"
            columns: ["business_id", "stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      goods_receipts: {
        Row: {
          business_id: string
          created_at: string
          document_id: string | null
          effective_date: string
          id: string
          idempotency_key: string
          landed_cost: number
          location_id: string
          notes: string | null
          number: string
          po_id: string | null
          posted_by: string
          reversal_reason: string | null
          status: string
          supplier_id: string | null
          supplier_ref: string | null
        }
        Insert: {
          business_id: string
          created_at?: string
          document_id?: string | null
          effective_date: string
          id?: string
          idempotency_key: string
          landed_cost?: number
          location_id: string
          notes?: string | null
          number: string
          po_id?: string | null
          posted_by: string
          reversal_reason?: string | null
          status?: string
          supplier_id?: string | null
          supplier_ref?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string
          document_id?: string | null
          effective_date?: string
          id?: string
          idempotency_key?: string
          landed_cost?: number
          location_id?: string
          notes?: string | null
          number?: string
          po_id?: string | null
          posted_by?: string
          reversal_reason?: string | null
          status?: string
          supplier_id?: string | null
          supplier_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipts_business_id_document_id_fkey"
            columns: ["business_id", "document_id"]
            isOneToOne: false
            referencedRelation: "stock_documents"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "goods_receipts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_business_id_location_id_fkey"
            columns: ["business_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "goods_receipts_business_id_po_id_fkey"
            columns: ["business_id", "po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "goods_receipts_business_id_supplier_id_fkey"
            columns: ["business_id", "supplier_id"]
            isOneToOne: false
            referencedRelation: "supplier_balances"
            referencedColumns: ["business_id", "supplier_id"]
          },
          {
            foreignKeyName: "goods_receipts_business_id_supplier_id_fkey"
            columns: ["business_id", "supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          business_id: string
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["member_role"]
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          business_id: string
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          revoked_at?: string | null
          role: Database["public"]["Enums"]["member_role"]
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          business_id?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["member_role"]
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      job_materials: {
        Row: {
          business_id: string
          id: string
          issued_qty_base: number
          job_id: string
          planned_qty_base: number
          returned_qty_base: number
          source: string
          stock_item_id: string
        }
        Insert: {
          business_id: string
          id?: string
          issued_qty_base?: number
          job_id: string
          planned_qty_base?: number
          returned_qty_base?: number
          source?: string
          stock_item_id: string
        }
        Update: {
          business_id?: string
          id?: string
          issued_qty_base?: number
          job_id?: string
          planned_qty_base?: number
          returned_qty_base?: number
          source?: string
          stock_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_materials_business_id_job_id_fkey"
            columns: ["business_id", "job_id"]
            isOneToOne: false
            referencedRelation: "production_jobs"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "job_materials_business_id_stock_item_id_fkey"
            columns: ["business_id", "stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_availability"
            referencedColumns: ["business_id", "stock_item_id"]
          },
          {
            foreignKeyName: "job_materials_business_id_stock_item_id_fkey"
            columns: ["business_id", "stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      journal_lines: {
        Row: {
          account_id: string
          business_id: string
          credit_minor: number
          debit_minor: number
          description: string | null
          id: string
          journal_id: string
          line_no: number
        }
        Insert: {
          account_id: string
          business_id: string
          credit_minor?: number
          debit_minor?: number
          description?: string | null
          id?: string
          journal_id: string
          line_no: number
        }
        Update: {
          account_id?: string
          business_id?: string
          credit_minor?: number
          debit_minor?: number
          description?: string | null
          id?: string
          journal_id?: string
          line_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "journal_lines_business_id_account_id_fkey"
            columns: ["business_id", "account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "journal_lines_business_id_journal_id_fkey"
            columns: ["business_id", "journal_id"]
            isOneToOne: false
            referencedRelation: "journals"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      journals: {
        Row: {
          adjustment_type: string | null
          business_id: string
          created_at: string
          created_by: string
          effective_date: string
          fiscal_year_id: string
          id: string
          idempotency_key: string
          kind: string
          narration: string
          number: string
          ref_id: string | null
          ref_type: string | null
          reversed_by_id: string | null
          reverses_id: string | null
          source_id: string | null
          source_part: string | null
          source_type: string | null
        }
        Insert: {
          adjustment_type?: string | null
          business_id: string
          created_at?: string
          created_by?: string
          effective_date: string
          fiscal_year_id: string
          id?: string
          idempotency_key: string
          kind: string
          narration: string
          number: string
          ref_id?: string | null
          ref_type?: string | null
          reversed_by_id?: string | null
          reverses_id?: string | null
          source_id?: string | null
          source_part?: string | null
          source_type?: string | null
        }
        Update: {
          adjustment_type?: string | null
          business_id?: string
          created_at?: string
          created_by?: string
          effective_date?: string
          fiscal_year_id?: string
          id?: string
          idempotency_key?: string
          kind?: string
          narration?: string
          number?: string
          ref_id?: string | null
          ref_type?: string | null
          reversed_by_id?: string | null
          reverses_id?: string | null
          source_id?: string | null
          source_part?: string | null
          source_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journals_business_id_fiscal_year_id_fkey"
            columns: ["business_id", "fiscal_year_id"]
            isOneToOne: false
            referencedRelation: "fiscal_years"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "journals_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journals_business_id_reversed_by_id_fkey"
            columns: ["business_id", "reversed_by_id"]
            isOneToOne: false
            referencedRelation: "journals"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "journals_business_id_reverses_id_fkey"
            columns: ["business_id", "reverses_id"]
            isOneToOne: false
            referencedRelation: "journals"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      loan_repayments: {
        Row: {
          business_id: string
          created_at: string
          created_by: string
          id: string
          idempotency_key: string
          interest_minor: number
          loan_id: string
          paid_from_account_id: string
          paid_on: string
          principal_minor: number
          status: string
          void_reason: string | null
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string
          id?: string
          idempotency_key: string
          interest_minor?: number
          loan_id: string
          paid_from_account_id: string
          paid_on: string
          principal_minor?: number
          status?: string
          void_reason?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string
          id?: string
          idempotency_key?: string
          interest_minor?: number
          loan_id?: string
          paid_from_account_id?: string
          paid_on?: string
          principal_minor?: number
          status?: string
          void_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loan_repayments_business_id_loan_id_fkey"
            columns: ["business_id", "loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "loan_repayments_business_id_paid_from_account_id_fkey"
            columns: ["business_id", "paid_from_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      loans: {
        Row: {
          business_id: string
          created_at: string
          created_by: string
          id: string
          idempotency_key: string
          interest_note: string | null
          lender: string
          number: string
          principal_minor: number
          received_into_account_id: string | null
          received_on: string
          status: string
          term: string
          void_reason: string | null
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string
          id?: string
          idempotency_key: string
          interest_note?: string | null
          lender: string
          number: string
          principal_minor: number
          received_into_account_id?: string | null
          received_on: string
          status?: string
          term: string
          void_reason?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string
          id?: string
          idempotency_key?: string
          interest_note?: string | null
          lender?: string
          number?: string
          principal_minor?: number
          received_into_account_id?: string | null
          received_on?: string
          status?: string
          term?: string
          void_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loans_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loans_business_id_received_into_account_id_fkey"
            columns: ["business_id", "received_into_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      locations: {
        Row: {
          archived_at: string | null
          business_id: string
          created_at: string
          id: string
          kind: string
          maker_id: string | null
          name: string
        }
        Insert: {
          archived_at?: string | null
          business_id: string
          created_at?: string
          id?: string
          kind: string
          maker_id?: string | null
          name: string
        }
        Update: {
          archived_at?: string | null
          business_id?: string
          created_at?: string
          id?: string
          kind?: string
          maker_id?: string | null
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locations_business_id_maker_id_fkey"
            columns: ["business_id", "maker_id"]
            isOneToOne: false
            referencedRelation: "makers"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      maker_payments: {
        Row: {
          amount: number
          business_id: string
          created_at: string
          created_by: string
          id: string
          job_id: string | null
          maker_id: string
          method: Database["public"]["Enums"]["payment_method"]
          paid_on: string
          reference: string | null
          verification: Database["public"]["Enums"]["payment_verification"]
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          amount: number
          business_id: string
          created_at?: string
          created_by: string
          id?: string
          job_id?: string | null
          maker_id: string
          method: Database["public"]["Enums"]["payment_method"]
          paid_on: string
          reference?: string | null
          verification?: Database["public"]["Enums"]["payment_verification"]
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          amount?: number
          business_id?: string
          created_at?: string
          created_by?: string
          id?: string
          job_id?: string | null
          maker_id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          paid_on?: string
          reference?: string | null
          verification?: Database["public"]["Enums"]["payment_verification"]
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maker_payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maker_payments_business_id_job_id_fkey"
            columns: ["business_id", "job_id"]
            isOneToOne: false
            referencedRelation: "production_jobs"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "maker_payments_business_id_maker_id_fkey"
            columns: ["business_id", "maker_id"]
            isOneToOne: false
            referencedRelation: "makers"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      makers: {
        Row: {
          archived_at: string | null
          business_id: string
          created_at: string
          id: string
          is_external: boolean
          name: string
          notes: string | null
          phone: string | null
          trade: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          business_id: string
          created_at?: string
          id?: string
          is_external?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          trade?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          business_id?: string
          created_at?: string
          id?: string
          is_external?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          trade?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "makers_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          business_id: string
          can_view_costs: boolean
          created_at: string
          deactivated_at: string | null
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["member_role"]
          status: Database["public"]["Enums"]["member_status"]
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          business_id: string
          can_view_costs?: boolean
          created_at?: string
          deactivated_at?: string | null
          id?: string
          invited_by?: string | null
          role: Database["public"]["Enums"]["member_role"]
          status?: Database["public"]["Enums"]["member_status"]
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          business_id?: string
          can_view_costs?: boolean
          created_at?: string
          deactivated_at?: string | null
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["member_role"]
          status?: Database["public"]["Enums"]["member_status"]
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          body: string
          business_id: string
          id: string
          key: string
          title: string
          updated_at: string
        }
        Insert: {
          body: string
          business_id: string
          id?: string
          key: string
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          business_id?: string
          id?: string
          key?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      opening_batch_lines: {
        Row: {
          batch_id: string
          business_id: string
          cost_base: number | null
          id: number
          line_no: number
          location_id: string
          new_item: Json | null
          qty_base: number
          quantity: number
          stock_item_id: string | null
          unit: string
          unit_cost: number | null
        }
        Insert: {
          batch_id: string
          business_id: string
          cost_base?: number | null
          id?: never
          line_no: number
          location_id: string
          new_item?: Json | null
          qty_base: number
          quantity: number
          stock_item_id?: string | null
          unit: string
          unit_cost?: number | null
        }
        Update: {
          batch_id?: string
          business_id?: string
          cost_base?: number | null
          id?: never
          line_no?: number
          location_id?: string
          new_item?: Json | null
          qty_base?: number
          quantity?: number
          stock_item_id?: string | null
          unit?: string
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "opening_batch_lines_business_id_batch_id_fkey"
            columns: ["business_id", "batch_id"]
            isOneToOne: false
            referencedRelation: "opening_batches"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "opening_batch_lines_business_id_location_id_fkey"
            columns: ["business_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "opening_batch_lines_business_id_stock_item_id_fkey"
            columns: ["business_id", "stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_availability"
            referencedColumns: ["business_id", "stock_item_id"]
          },
          {
            foreignKeyName: "opening_batch_lines_business_id_stock_item_id_fkey"
            columns: ["business_id", "stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "opening_batch_lines_unit_fkey"
            columns: ["unit"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["code"]
          },
        ]
      }
      opening_batches: {
        Row: {
          business_id: string
          created_at: string
          created_by: string
          document_id: string | null
          effective_date: string
          file_name: string | null
          id: string
          notes: string | null
          posted_at: string | null
          posted_by: string | null
          reference: string
          reversal_reason: string | null
          status: string
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by: string
          document_id?: string | null
          effective_date: string
          file_name?: string | null
          id?: string
          notes?: string | null
          posted_at?: string | null
          posted_by?: string | null
          reference: string
          reversal_reason?: string | null
          status?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string
          document_id?: string | null
          effective_date?: string
          file_name?: string | null
          id?: string
          notes?: string | null
          posted_at?: string | null
          posted_by?: string | null
          reference?: string
          reversal_reason?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "opening_batches_business_id_document_id_fkey"
            columns: ["business_id", "document_id"]
            isOneToOne: false
            referencedRelation: "stock_documents"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "opening_batches_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      order_dispatch_lines: {
        Row: {
          business_id: string
          dispatch_id: string
          id: string
          order_item_id: string
          quantity: number
        }
        Insert: {
          business_id: string
          dispatch_id: string
          id?: string
          order_item_id: string
          quantity: number
        }
        Update: {
          business_id?: string
          dispatch_id?: string
          id?: string
          order_item_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_dispatch_lines_business_id_dispatch_id_fkey"
            columns: ["business_id", "dispatch_id"]
            isOneToOne: false
            referencedRelation: "order_dispatches"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "order_dispatch_lines_business_id_order_item_id_fkey"
            columns: ["business_id", "order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      order_dispatches: {
        Row: {
          business_id: string
          courier_name: string | null
          created_at: string
          dispatched_by: string
          dispatched_on: string
          document_id: string | null
          id: string
          idempotency_key: string
          location_id: string
          number: string
          order_id: string
          tracking_reference: string | null
        }
        Insert: {
          business_id: string
          courier_name?: string | null
          created_at?: string
          dispatched_by: string
          dispatched_on: string
          document_id?: string | null
          id?: string
          idempotency_key: string
          location_id: string
          number: string
          order_id: string
          tracking_reference?: string | null
        }
        Update: {
          business_id?: string
          courier_name?: string | null
          created_at?: string
          dispatched_by?: string
          dispatched_on?: string
          document_id?: string | null
          id?: string
          idempotency_key?: string
          location_id?: string
          number?: string
          order_id?: string
          tracking_reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_dispatches_business_id_document_id_fkey"
            columns: ["business_id", "document_id"]
            isOneToOne: false
            referencedRelation: "stock_documents"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "order_dispatches_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_dispatches_business_id_location_id_fkey"
            columns: ["business_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "order_dispatches_business_id_order_id_fkey"
            columns: ["business_id", "order_id"]
            isOneToOne: false
            referencedRelation: "order_summaries"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "order_dispatches_business_id_order_id_fkey"
            columns: ["business_id", "order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      order_items: {
        Row: {
          business_id: string
          colour: string | null
          created_at: string
          description: string
          dispatched_at: string | null
          dispatched_quantity: number
          id: string
          item_type: Database["public"]["Enums"]["item_type"]
          order_id: string
          product_id: string | null
          quantity: number
          size: string | null
          unit_price_minor: number
          updated_at: string
          variant_id: string | null
        }
        Insert: {
          business_id: string
          colour?: string | null
          created_at?: string
          description: string
          dispatched_at?: string | null
          dispatched_quantity?: number
          id?: string
          item_type?: Database["public"]["Enums"]["item_type"]
          order_id: string
          product_id?: string | null
          quantity: number
          size?: string | null
          unit_price_minor: number
          updated_at?: string
          variant_id?: string | null
        }
        Update: {
          business_id?: string
          colour?: string | null
          created_at?: string
          description?: string
          dispatched_at?: string | null
          dispatched_quantity?: number
          id?: string
          item_type?: Database["public"]["Enums"]["item_type"]
          order_id?: string
          product_id?: string | null
          quantity?: number
          size?: string | null
          unit_price_minor?: number
          updated_at?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_business_id_order_id_fkey"
            columns: ["business_id", "order_id"]
            isOneToOne: false
            referencedRelation: "order_summaries"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "order_items_business_id_order_id_fkey"
            columns: ["business_id", "order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "order_items_business_id_product_id_fkey"
            columns: ["business_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "order_items_business_id_variant_id_fkey"
            columns: ["business_id", "variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      order_return_lines: {
        Row: {
          business_id: string
          condition: string | null
          decided_at: string | null
          decided_by: string | null
          decision: string | null
          decision_document_id: string | null
          id: string
          order_item_id: string
          quantity: number
          return_id: string
        }
        Insert: {
          business_id: string
          condition?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          decision_document_id?: string | null
          id?: string
          order_item_id: string
          quantity: number
          return_id: string
        }
        Update: {
          business_id?: string
          condition?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          decision_document_id?: string | null
          id?: string
          order_item_id?: string
          quantity?: number
          return_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_return_lines_business_id_decision_document_id_fkey"
            columns: ["business_id", "decision_document_id"]
            isOneToOne: false
            referencedRelation: "stock_documents"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "order_return_lines_business_id_order_item_id_fkey"
            columns: ["business_id", "order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "order_return_lines_business_id_return_id_fkey"
            columns: ["business_id", "return_id"]
            isOneToOne: false
            referencedRelation: "order_returns"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      order_returns: {
        Row: {
          business_id: string
          created_at: string
          created_by: string
          document_id: string | null
          id: string
          idempotency_key: string | null
          kind: Database["public"]["Enums"]["return_kind"]
          location_id: string | null
          number: string | null
          order_id: string
          reason: string
          received_on: string | null
          replacement_order_id: string | null
          resolution_notes: string | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["return_status"]
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string
          document_id?: string | null
          id?: string
          idempotency_key?: string | null
          kind: Database["public"]["Enums"]["return_kind"]
          location_id?: string | null
          number?: string | null
          order_id: string
          reason: string
          received_on?: string | null
          replacement_order_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["return_status"]
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string
          document_id?: string | null
          id?: string
          idempotency_key?: string | null
          kind?: Database["public"]["Enums"]["return_kind"]
          location_id?: string | null
          number?: string | null
          order_id?: string
          reason?: string
          received_on?: string | null
          replacement_order_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["return_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_returns_business_id_order_id_fkey"
            columns: ["business_id", "order_id"]
            isOneToOne: false
            referencedRelation: "order_summaries"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "order_returns_business_id_order_id_fkey"
            columns: ["business_id", "order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "order_returns_document_fk"
            columns: ["business_id", "document_id"]
            isOneToOne: false
            referencedRelation: "stock_documents"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "order_returns_location_fk"
            columns: ["business_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "order_returns_replacement_fk"
            columns: ["business_id", "replacement_order_id"]
            isOneToOne: false
            referencedRelation: "order_summaries"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "order_returns_replacement_fk"
            columns: ["business_id", "replacement_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      orders: {
        Row: {
          archived_at: string | null
          assigned_to: string | null
          business_id: string
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          channel: Database["public"]["Enums"]["contact_source"] | null
          confirmed_at: string | null
          confirmed_by: string | null
          courier_name: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          delivered_at: string | null
          delivery_address: string | null
          delivery_city: string | null
          delivery_fee_minor: number
          delivery_instructions: string | null
          delivery_method: Database["public"]["Enums"]["delivery_method"] | null
          delivery_state: string | null
          discount_minor: number
          dispatched_at: string | null
          enquiry_id: string | null
          fulfilment_stage: Database["public"]["Enums"]["fulfilment_stage"]
          id: string
          idempotency_key: string | null
          internal_notes: string | null
          order_date: string
          order_number: string
          pickup_location: string | null
          promised_date: string | null
          status: Database["public"]["Enums"]["order_status"]
          tracking_reference: string | null
          unpaid_dispatch_approved_at: string | null
          unpaid_dispatch_approved_by: string | null
          unpaid_dispatch_reason: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          assigned_to?: string | null
          business_id: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          channel?: Database["public"]["Enums"]["contact_source"] | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          courier_name?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          delivered_at?: string | null
          delivery_address?: string | null
          delivery_city?: string | null
          delivery_fee_minor?: number
          delivery_instructions?: string | null
          delivery_method?:
            | Database["public"]["Enums"]["delivery_method"]
            | null
          delivery_state?: string | null
          discount_minor?: number
          dispatched_at?: string | null
          enquiry_id?: string | null
          fulfilment_stage?: Database["public"]["Enums"]["fulfilment_stage"]
          id?: string
          idempotency_key?: string | null
          internal_notes?: string | null
          order_date?: string
          order_number: string
          pickup_location?: string | null
          promised_date?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          tracking_reference?: string | null
          unpaid_dispatch_approved_at?: string | null
          unpaid_dispatch_approved_by?: string | null
          unpaid_dispatch_reason?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          assigned_to?: string | null
          business_id?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          channel?: Database["public"]["Enums"]["contact_source"] | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          courier_name?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          delivered_at?: string | null
          delivery_address?: string | null
          delivery_city?: string | null
          delivery_fee_minor?: number
          delivery_instructions?: string | null
          delivery_method?:
            | Database["public"]["Enums"]["delivery_method"]
            | null
          delivery_state?: string | null
          discount_minor?: number
          dispatched_at?: string | null
          enquiry_id?: string | null
          fulfilment_stage?: Database["public"]["Enums"]["fulfilment_stage"]
          id?: string
          idempotency_key?: string | null
          internal_notes?: string | null
          order_date?: string
          order_number?: string
          pickup_location?: string | null
          promised_date?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          tracking_reference?: string | null
          unpaid_dispatch_approved_at?: string | null
          unpaid_dispatch_approved_by?: string | null
          unpaid_dispatch_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_business_id_assigned_to_fkey"
            columns: ["business_id", "assigned_to"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["business_id", "user_id"]
          },
          {
            foreignKeyName: "orders_business_id_customer_id_fkey"
            columns: ["business_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "orders_business_id_enquiry_id_fkey"
            columns: ["business_id", "enquiry_id"]
            isOneToOne: false
            referencedRelation: "enquiries"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "orders_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_minor: number
          business_id: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["payment_kind"]
          method: Database["public"]["Enums"]["payment_method"]
          notes: string | null
          order_id: string
          paid_on: string
          recorded_by: string
          reference: string | null
          verification: Database["public"]["Enums"]["payment_verification"]
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount_minor: number
          business_id: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["payment_kind"]
          method: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          order_id: string
          paid_on?: string
          recorded_by?: string
          reference?: string | null
          verification?: Database["public"]["Enums"]["payment_verification"]
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount_minor?: number
          business_id?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["payment_kind"]
          method?: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          order_id?: string
          paid_on?: string
          recorded_by?: string
          reference?: string | null
          verification?: Database["public"]["Enums"]["payment_verification"]
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_business_id_order_id_fkey"
            columns: ["business_id", "order_id"]
            isOneToOne: false
            referencedRelation: "order_summaries"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "payments_business_id_order_id_fkey"
            columns: ["business_id", "order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      payroll_lines: {
        Row: {
          business_id: string
          gross_minor: number
          id: string
          net_minor: number | null
          paye_minor: number
          pension_employee_minor: number
          pension_employer_minor: number
          person_id: string
          run_id: string
          wht_minor: number
        }
        Insert: {
          business_id: string
          gross_minor: number
          id?: string
          net_minor?: number | null
          paye_minor?: number
          pension_employee_minor?: number
          pension_employer_minor?: number
          person_id: string
          run_id: string
          wht_minor?: number
        }
        Update: {
          business_id?: string
          gross_minor?: number
          id?: string
          net_minor?: number | null
          paye_minor?: number
          pension_employee_minor?: number
          pension_employer_minor?: number
          person_id?: string
          run_id?: string
          wht_minor?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_lines_business_id_person_id_fkey"
            columns: ["business_id", "person_id"]
            isOneToOne: false
            referencedRelation: "payroll_people"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "payroll_lines_business_id_run_id_fkey"
            columns: ["business_id", "run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      payroll_people: {
        Row: {
          archived_at: string | null
          business_id: string
          created_at: string
          id: string
          kind: string
          name: string
          role_title: string | null
        }
        Insert: {
          archived_at?: string | null
          business_id: string
          created_at?: string
          id?: string
          kind: string
          name: string
          role_title?: string | null
        }
        Update: {
          archived_at?: string | null
          business_id?: string
          created_at?: string
          id?: string
          kind?: string
          name?: string
          role_title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_people_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_runs: {
        Row: {
          business_id: string
          created_at: string
          created_by: string
          id: string
          idempotency_key: string
          number: string
          paid_from_account_id: string
          pay_date: string
          period_month: string
          status: string
          void_reason: string | null
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string
          id?: string
          idempotency_key: string
          number: string
          paid_from_account_id: string
          pay_date: string
          period_month: string
          status?: string
          void_reason?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string
          id?: string
          idempotency_key?: string
          number?: string
          paid_from_account_id?: string
          pay_date?: string
          period_month?: string
          status?: string
          void_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_runs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_business_id_paid_from_account_id_fkey"
            columns: ["business_id", "paid_from_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      plans: {
        Row: {
          code: string
          created_at: string
          currency: string
          id: string
          is_active: boolean
          limits: Json
          monthly_price_minor: number
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          limits?: Json
          monthly_price_minor?: number
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          limits?: Json
          monthly_price_minor?: number
          name?: string
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      product_costs: {
        Row: {
          business_id: string
          cost_minor: number
          id: string
          product_id: string
          updated_at: string
          updated_by: string | null
          variant_id: string | null
        }
        Insert: {
          business_id: string
          cost_minor: number
          id?: string
          product_id: string
          updated_at?: string
          updated_by?: string | null
          variant_id?: string | null
        }
        Update: {
          business_id?: string
          cost_minor?: number
          id?: string
          product_id?: string
          updated_at?: string
          updated_by?: string | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_costs_business_id_product_id_fkey"
            columns: ["business_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "product_costs_business_id_variant_id_fkey"
            columns: ["business_id", "variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      product_variants: {
        Row: {
          archived_at: string | null
          business_id: string
          colour: string | null
          created_at: string
          external_id: string | null
          id: string
          length: string | null
          options: Json
          price_minor: number | null
          product_id: string
          size: string | null
          sku: string | null
        }
        Insert: {
          archived_at?: string | null
          business_id: string
          colour?: string | null
          created_at?: string
          external_id?: string | null
          id?: string
          length?: string | null
          options?: Json
          price_minor?: number | null
          product_id: string
          size?: string | null
          sku?: string | null
        }
        Update: {
          archived_at?: string | null
          business_id?: string
          colour?: string | null
          created_at?: string
          external_id?: string | null
          id?: string
          length?: string | null
          options?: Json
          price_minor?: number | null
          product_id?: string
          size?: string | null
          sku?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_business_id_product_id_fkey"
            columns: ["business_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      production_jobs: {
        Row: {
          assigned_to: string | null
          bom_id: string | null
          bom_version: number | null
          business_id: string
          cancelled_reason: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          due_date: string | null
          fee_approved: number | null
          fee_approved_at: string | null
          fee_approved_by: string | null
          finished_item_id: string | null
          id: string
          idempotency_key: string | null
          instructions: string | null
          kind: string
          labour_cost: number
          maker_id: string | null
          notes: string | null
          number: string | null
          order_item_id: string | null
          other_cost: number
          planned_qty: number
          product_id: string | null
          qty_passed: number
          qty_rejected: number
          start_date: string | null
          status: string
          updated_at: string
          variant_id: string | null
        }
        Insert: {
          assigned_to?: string | null
          bom_id?: string | null
          bom_version?: number | null
          business_id: string
          cancelled_reason?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          fee_approved?: number | null
          fee_approved_at?: string | null
          fee_approved_by?: string | null
          finished_item_id?: string | null
          id?: string
          idempotency_key?: string | null
          instructions?: string | null
          kind?: string
          labour_cost?: number
          maker_id?: string | null
          notes?: string | null
          number?: string | null
          order_item_id?: string | null
          other_cost?: number
          planned_qty?: number
          product_id?: string | null
          qty_passed?: number
          qty_rejected?: number
          start_date?: string | null
          status?: string
          updated_at?: string
          variant_id?: string | null
        }
        Update: {
          assigned_to?: string | null
          bom_id?: string | null
          bom_version?: number | null
          business_id?: string
          cancelled_reason?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          fee_approved?: number | null
          fee_approved_at?: string | null
          fee_approved_by?: string | null
          finished_item_id?: string | null
          id?: string
          idempotency_key?: string | null
          instructions?: string | null
          kind?: string
          labour_cost?: number
          maker_id?: string | null
          notes?: string | null
          number?: string | null
          order_item_id?: string | null
          other_cost?: number
          planned_qty?: number
          product_id?: string | null
          qty_passed?: number
          qty_rejected?: number
          start_date?: string | null
          status?: string
          updated_at?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_jobs_bom_fk"
            columns: ["business_id", "bom_id"]
            isOneToOne: false
            referencedRelation: "boms"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "production_jobs_business_id_assigned_to_fkey"
            columns: ["business_id", "assigned_to"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["business_id", "user_id"]
          },
          {
            foreignKeyName: "production_jobs_business_id_order_item_id_fkey"
            columns: ["business_id", "order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "production_jobs_item_fk"
            columns: ["business_id", "finished_item_id"]
            isOneToOne: false
            referencedRelation: "stock_availability"
            referencedColumns: ["business_id", "stock_item_id"]
          },
          {
            foreignKeyName: "production_jobs_item_fk"
            columns: ["business_id", "finished_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "production_jobs_maker_fk"
            columns: ["business_id", "maker_id"]
            isOneToOne: false
            referencedRelation: "makers"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "production_jobs_product_fk"
            columns: ["business_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "production_jobs_variant_fk"
            columns: ["business_id", "variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      products: {
        Row: {
          archived_at: string | null
          base_price_minor: number
          business_id: string
          category: Database["public"]["Enums"]["product_category"]
          created_at: string
          default_item_type: Database["public"]["Enums"]["item_type"]
          description: string | null
          external_id: string | null
          id: string
          name: string
          sku: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          base_price_minor?: number
          business_id: string
          category?: Database["public"]["Enums"]["product_category"]
          created_at?: string
          default_item_type?: Database["public"]["Enums"]["item_type"]
          description?: string | null
          external_id?: string | null
          id?: string
          name: string
          sku?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          base_price_minor?: number
          business_id?: string
          category?: Database["public"]["Enums"]["product_category"]
          created_at?: string
          default_item_type?: Database["public"]["Enums"]["item_type"]
          description?: string | null
          external_id?: string | null
          id?: string
          name?: string
          sku?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      purchase_order_lines: {
        Row: {
          business_id: string
          factor: number
          id: string
          line_no: number
          po_id: string
          qty: number
          qty_base: number
          qty_received_base: number
          qty_rejected_base: number
          stock_item_id: string
          unit: string
          unit_price: number | null
        }
        Insert: {
          business_id: string
          factor: number
          id?: string
          line_no: number
          po_id: string
          qty: number
          qty_base: number
          qty_received_base?: number
          qty_rejected_base?: number
          stock_item_id: string
          unit: string
          unit_price?: number | null
        }
        Update: {
          business_id?: string
          factor?: number
          id?: string
          line_no?: number
          po_id?: string
          qty?: number
          qty_base?: number
          qty_received_base?: number
          qty_rejected_base?: number
          stock_item_id?: string
          unit?: string
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_lines_business_id_po_id_fkey"
            columns: ["business_id", "po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "purchase_order_lines_business_id_stock_item_id_fkey"
            columns: ["business_id", "stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_availability"
            referencedColumns: ["business_id", "stock_item_id"]
          },
          {
            foreignKeyName: "purchase_order_lines_business_id_stock_item_id_fkey"
            columns: ["business_id", "stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          business_id: string
          closed_reason: string | null
          created_at: string
          created_by: string
          expected_date: string | null
          id: string
          notes: string | null
          number: string
          status: string
          supplier_id: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          business_id: string
          closed_reason?: string | null
          created_at?: string
          created_by: string
          expected_date?: string | null
          id?: string
          notes?: string | null
          number: string
          status?: string
          supplier_id: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          business_id?: string
          closed_reason?: string | null
          created_at?: string
          created_by?: string
          expected_date?: string | null
          id?: string
          notes?: string | null
          number?: string
          status?: string
          supplier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_business_id_supplier_id_fkey"
            columns: ["business_id", "supplier_id"]
            isOneToOne: false
            referencedRelation: "supplier_balances"
            referencedColumns: ["business_id", "supplier_id"]
          },
          {
            foreignKeyName: "purchase_orders_business_id_supplier_id_fkey"
            columns: ["business_id", "supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      qc_checklists: {
        Row: {
          business_id: string
          category: Database["public"]["Enums"]["product_category"]
          id: string
          items: string[]
          updated_at: string
        }
        Insert: {
          business_id: string
          category: Database["public"]["Enums"]["product_category"]
          id?: string
          items: string[]
          updated_at?: string
        }
        Update: {
          business_id?: string
          category?: Database["public"]["Enums"]["product_category"]
          id?: string
          items?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qc_checklists_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      qc_inspections: {
        Row: {
          business_id: string
          created_at: string
          defects: string | null
          document_id: string | null
          id: string
          idempotency_key: string
          inspected_on: string
          inspector: string
          instructions: string | null
          job_id: string
          number: string
          qty_inspected: number
          qty_passed: number
          qty_rejected: number
          qty_rework: number
          results: Json
        }
        Insert: {
          business_id: string
          created_at?: string
          defects?: string | null
          document_id?: string | null
          id?: string
          idempotency_key: string
          inspected_on: string
          inspector: string
          instructions?: string | null
          job_id: string
          number: string
          qty_inspected: number
          qty_passed?: number
          qty_rejected?: number
          qty_rework?: number
          results?: Json
        }
        Update: {
          business_id?: string
          created_at?: string
          defects?: string | null
          document_id?: string | null
          id?: string
          idempotency_key?: string
          inspected_on?: string
          inspector?: string
          instructions?: string | null
          job_id?: string
          number?: string
          qty_inspected?: number
          qty_passed?: number
          qty_rejected?: number
          qty_rework?: number
          results?: Json
        }
        Relationships: [
          {
            foreignKeyName: "qc_inspections_business_id_document_id_fkey"
            columns: ["business_id", "document_id"]
            isOneToOne: false
            referencedRelation: "stock_documents"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "qc_inspections_business_id_job_id_fkey"
            columns: ["business_id", "job_id"]
            isOneToOne: false
            referencedRelation: "production_jobs"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      repair_payments: {
        Row: {
          amount_minor: number
          business_id: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["payment_kind"]
          method: Database["public"]["Enums"]["payment_method"]
          paid_on: string
          recorded_by: string
          reference: string | null
          repair_id: string
          verification: Database["public"]["Enums"]["payment_verification"]
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount_minor: number
          business_id: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["payment_kind"]
          method: Database["public"]["Enums"]["payment_method"]
          paid_on: string
          recorded_by?: string
          reference?: string | null
          repair_id: string
          verification?: Database["public"]["Enums"]["payment_verification"]
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount_minor?: number
          business_id?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["payment_kind"]
          method?: Database["public"]["Enums"]["payment_method"]
          paid_on?: string
          recorded_by?: string
          reference?: string | null
          repair_id?: string
          verification?: Database["public"]["Enums"]["payment_verification"]
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "repair_payments_business_id_repair_id_fkey"
            columns: ["business_id", "repair_id"]
            isOneToOne: false
            referencedRelation: "repair_summaries"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "repair_payments_business_id_repair_id_fkey"
            columns: ["business_id", "repair_id"]
            isOneToOne: false
            referencedRelation: "repairs"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      repairs: {
        Row: {
          business_id: string
          cancel_reason: string | null
          cancelled_at: string | null
          charge_minor: number
          collected_at: string | null
          created_at: string
          created_by: string
          customer_id: string
          id: string
          item: string
          maker_id: string | null
          notes: string | null
          number: string
          problem: string
          promised_date: string | null
          ready_at: string | null
          received_on: string
          status: string
          updated_at: string
        }
        Insert: {
          business_id: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          charge_minor?: number
          collected_at?: string | null
          created_at?: string
          created_by?: string
          customer_id: string
          id?: string
          item: string
          maker_id?: string | null
          notes?: string | null
          number: string
          problem: string
          promised_date?: string | null
          ready_at?: string | null
          received_on: string
          status?: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          charge_minor?: number
          collected_at?: string | null
          created_at?: string
          created_by?: string
          customer_id?: string
          id?: string
          item?: string
          maker_id?: string | null
          notes?: string | null
          number?: string
          problem?: string
          promised_date?: string | null
          ready_at?: string | null
          received_on?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "repairs_business_id_customer_id_fkey"
            columns: ["business_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "repairs_business_id_maker_id_fkey"
            columns: ["business_id", "maker_id"]
            isOneToOne: false
            referencedRelation: "makers"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      stock_documents: {
        Row: {
          business_id: string
          created_at: string
          doc_type: string
          effective_date: string
          id: string
          idempotency_key: string
          number: string
          posted_by: string
          reason: string | null
          reversed_by_id: string | null
          reverses_id: string | null
          source_id: string | null
          source_type: string | null
        }
        Insert: {
          business_id: string
          created_at?: string
          doc_type: string
          effective_date: string
          id?: string
          idempotency_key: string
          number: string
          posted_by: string
          reason?: string | null
          reversed_by_id?: string | null
          reverses_id?: string | null
          source_id?: string | null
          source_type?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string
          doc_type?: string
          effective_date?: string
          id?: string
          idempotency_key?: string
          number?: string
          posted_by?: string
          reason?: string | null
          reversed_by_id?: string | null
          reverses_id?: string | null
          source_id?: string | null
          source_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_documents_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_documents_business_id_reversed_by_id_fkey"
            columns: ["business_id", "reversed_by_id"]
            isOneToOne: false
            referencedRelation: "stock_documents"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "stock_documents_business_id_reverses_id_fkey"
            columns: ["business_id", "reverses_id"]
            isOneToOne: false
            referencedRelation: "stock_documents"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      stock_items: {
        Row: {
          archived_at: string | null
          avg_cost: number
          base_unit: string
          business_id: string
          category: string | null
          code: string
          colour: string | null
          cost_missing: boolean
          created_at: string
          default_location_id: string | null
          default_supplier_id: string | null
          external_id: string | null
          id: string
          kind: string
          name: string
          purchase_factor: number | null
          purchase_unit: string | null
          reorder_level: number | null
          specs: string | null
          updated_at: string
          variant_id: string | null
        }
        Insert: {
          archived_at?: string | null
          avg_cost?: number
          base_unit: string
          business_id: string
          category?: string | null
          code: string
          colour?: string | null
          cost_missing?: boolean
          created_at?: string
          default_location_id?: string | null
          default_supplier_id?: string | null
          external_id?: string | null
          id?: string
          kind: string
          name: string
          purchase_factor?: number | null
          purchase_unit?: string | null
          reorder_level?: number | null
          specs?: string | null
          updated_at?: string
          variant_id?: string | null
        }
        Update: {
          archived_at?: string | null
          avg_cost?: number
          base_unit?: string
          business_id?: string
          category?: string | null
          code?: string
          colour?: string | null
          cost_missing?: boolean
          created_at?: string
          default_location_id?: string | null
          default_supplier_id?: string | null
          external_id?: string | null
          id?: string
          kind?: string
          name?: string
          purchase_factor?: number | null
          purchase_unit?: string | null
          reorder_level?: number | null
          specs?: string | null
          updated_at?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_items_base_unit_fkey"
            columns: ["base_unit"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "stock_items_business_id_default_location_id_fkey"
            columns: ["business_id", "default_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "stock_items_business_id_default_supplier_id_fkey"
            columns: ["business_id", "default_supplier_id"]
            isOneToOne: false
            referencedRelation: "supplier_balances"
            referencedColumns: ["business_id", "supplier_id"]
          },
          {
            foreignKeyName: "stock_items_business_id_default_supplier_id_fkey"
            columns: ["business_id", "default_supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "stock_items_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_items_business_id_variant_id_fkey"
            columns: ["business_id", "variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          business_id: string
          created_at: string
          document_id: string
          effective_date: string
          id: number
          location_id: string
          quantity: number
          stock_item_id: string
          unit_cost: number
        }
        Insert: {
          business_id: string
          created_at?: string
          document_id: string
          effective_date: string
          id?: never
          location_id: string
          quantity: number
          stock_item_id: string
          unit_cost?: number
        }
        Update: {
          business_id?: string
          created_at?: string
          document_id?: string
          effective_date?: string
          id?: never
          location_id?: string
          quantity?: number
          stock_item_id?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_business_id_document_id_fkey"
            columns: ["business_id", "document_id"]
            isOneToOne: false
            referencedRelation: "stock_documents"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "stock_movements_business_id_location_id_fkey"
            columns: ["business_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "stock_movements_business_id_stock_item_id_fkey"
            columns: ["business_id", "stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_availability"
            referencedColumns: ["business_id", "stock_item_id"]
          },
          {
            foreignKeyName: "stock_movements_business_id_stock_item_id_fkey"
            columns: ["business_id", "stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      stock_reservations: {
        Row: {
          business_id: string
          closed_at: string | null
          created_at: string
          created_by: string
          id: string
          qty_base: number
          source_id: string
          source_type: string
          status: string
          stock_item_id: string
        }
        Insert: {
          business_id: string
          closed_at?: string | null
          created_at?: string
          created_by: string
          id?: string
          qty_base: number
          source_id: string
          source_type: string
          status?: string
          stock_item_id: string
        }
        Update: {
          business_id?: string
          closed_at?: string | null
          created_at?: string
          created_by?: string
          id?: string
          qty_base?: number
          source_id?: string
          source_type?: string
          status?: string
          stock_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_reservations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_reservations_business_id_stock_item_id_fkey"
            columns: ["business_id", "stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_availability"
            referencedColumns: ["business_id", "stock_item_id"]
          },
          {
            foreignKeyName: "stock_reservations_business_id_stock_item_id_fkey"
            columns: ["business_id", "stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      supplier_bills: {
        Row: {
          amount: number
          bill_date: string
          bill_ref: string | null
          business_id: string
          created_at: string
          created_by: string
          id: string
          notes: string | null
          po_id: string | null
          receipt_id: string | null
          supplier_id: string
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          amount: number
          bill_date: string
          bill_ref?: string | null
          business_id: string
          created_at?: string
          created_by: string
          id?: string
          notes?: string | null
          po_id?: string | null
          receipt_id?: string | null
          supplier_id: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          amount?: number
          bill_date?: string
          bill_ref?: string | null
          business_id?: string
          created_at?: string
          created_by?: string
          id?: string
          notes?: string | null
          po_id?: string | null
          receipt_id?: string | null
          supplier_id?: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_bills_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_bills_business_id_po_id_fkey"
            columns: ["business_id", "po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "supplier_bills_business_id_receipt_id_fkey"
            columns: ["business_id", "receipt_id"]
            isOneToOne: false
            referencedRelation: "goods_receipts"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "supplier_bills_business_id_supplier_id_fkey"
            columns: ["business_id", "supplier_id"]
            isOneToOne: false
            referencedRelation: "supplier_balances"
            referencedColumns: ["business_id", "supplier_id"]
          },
          {
            foreignKeyName: "supplier_bills_business_id_supplier_id_fkey"
            columns: ["business_id", "supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      supplier_payments: {
        Row: {
          amount: number
          bill_id: string | null
          business_id: string
          created_at: string
          created_by: string
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          paid_on: string
          reference: string | null
          supplier_id: string
          verification: Database["public"]["Enums"]["payment_verification"]
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          amount: number
          bill_id?: string | null
          business_id: string
          created_at?: string
          created_by: string
          id?: string
          method: Database["public"]["Enums"]["payment_method"]
          paid_on: string
          reference?: string | null
          supplier_id: string
          verification?: Database["public"]["Enums"]["payment_verification"]
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          amount?: number
          bill_id?: string | null
          business_id?: string
          created_at?: string
          created_by?: string
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          paid_on?: string
          reference?: string | null
          supplier_id?: string
          verification?: Database["public"]["Enums"]["payment_verification"]
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_payments_business_id_bill_id_fkey"
            columns: ["business_id", "bill_id"]
            isOneToOne: false
            referencedRelation: "supplier_bills"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "supplier_payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payments_business_id_supplier_id_fkey"
            columns: ["business_id", "supplier_id"]
            isOneToOne: false
            referencedRelation: "supplier_balances"
            referencedColumns: ["business_id", "supplier_id"]
          },
          {
            foreignKeyName: "supplier_payments_business_id_supplier_id_fkey"
            columns: ["business_id", "supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      supplier_return_lines: {
        Row: {
          business_id: string
          id: string
          qty_base: number
          receipt_line_id: string
          return_id: string
        }
        Insert: {
          business_id: string
          id?: string
          qty_base: number
          receipt_line_id: string
          return_id: string
        }
        Update: {
          business_id?: string
          id?: string
          qty_base?: number
          receipt_line_id?: string
          return_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_return_lines_business_id_receipt_line_id_fkey"
            columns: ["business_id", "receipt_line_id"]
            isOneToOne: false
            referencedRelation: "goods_receipt_lines"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "supplier_return_lines_business_id_return_id_fkey"
            columns: ["business_id", "return_id"]
            isOneToOne: false
            referencedRelation: "supplier_returns"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      supplier_returns: {
        Row: {
          business_id: string
          created_at: string
          document_id: string
          effective_date: string
          id: string
          idempotency_key: string
          location_id: string
          number: string
          posted_by: string
          reason: string
          receipt_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          document_id: string
          effective_date: string
          id?: string
          idempotency_key: string
          location_id: string
          number: string
          posted_by: string
          reason: string
          receipt_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          document_id?: string
          effective_date?: string
          id?: string
          idempotency_key?: string
          location_id?: string
          number?: string
          posted_by?: string
          reason?: string
          receipt_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_returns_business_id_document_id_fkey"
            columns: ["business_id", "document_id"]
            isOneToOne: false
            referencedRelation: "stock_documents"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "supplier_returns_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_returns_business_id_location_id_fkey"
            columns: ["business_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "supplier_returns_business_id_receipt_id_fkey"
            columns: ["business_id", "receipt_id"]
            isOneToOne: false
            referencedRelation: "goods_receipts"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          archived_at: string | null
          business_id: string
          contact_name: string | null
          created_at: string
          email: string | null
          external_id: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          archived_at?: string | null
          business_id: string
          contact_name?: string | null
          created_at?: string
          email?: string | null
          external_id?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          archived_at?: string | null
          business_id?: string
          contact_name?: string | null
          created_at?: string
          email?: string | null
          external_id?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_to: string | null
          business_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          due_at: string | null
          enquiry_id: string | null
          id: string
          kind: Database["public"]["Enums"]["task_kind"]
          notes: string | null
          order_id: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          business_id: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          due_at?: string | null
          enquiry_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["task_kind"]
          notes?: string | null
          order_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          business_id?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          due_at?: string | null
          enquiry_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["task_kind"]
          notes?: string | null
          order_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_business_id_assigned_to_fkey"
            columns: ["business_id", "assigned_to"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["business_id", "user_id"]
          },
          {
            foreignKeyName: "tasks_business_id_customer_id_fkey"
            columns: ["business_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tasks_business_id_enquiry_id_fkey"
            columns: ["business_id", "enquiry_id"]
            isOneToOne: false
            referencedRelation: "enquiries"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tasks_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_business_id_order_id_fkey"
            columns: ["business_id", "order_id"]
            isOneToOne: false
            referencedRelation: "order_summaries"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tasks_business_id_order_id_fkey"
            columns: ["business_id", "order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      tax_payments: {
        Row: {
          amount_minor: number
          business_id: string
          created_at: string
          created_by: string
          id: string
          idempotency_key: string
          paid_from_account_id: string
          paid_on: string
          reference: string | null
          status: string
          tax: string
          void_reason: string | null
        }
        Insert: {
          amount_minor: number
          business_id: string
          created_at?: string
          created_by?: string
          id?: string
          idempotency_key: string
          paid_from_account_id: string
          paid_on: string
          reference?: string | null
          status?: string
          tax: string
          void_reason?: string | null
        }
        Update: {
          amount_minor?: number
          business_id?: string
          created_at?: string
          created_by?: string
          id?: string
          idempotency_key?: string
          paid_from_account_id?: string
          paid_on?: string
          reference?: string | null
          status?: string
          tax?: string
          void_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tax_payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_payments_business_id_paid_from_account_id_fkey"
            columns: ["business_id", "paid_from_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      units: {
        Row: {
          code: string
          dimension: string
          name: string
          to_base: number
        }
        Insert: {
          code: string
          dimension: string
          name: string
          to_base: number
        }
        Update: {
          code?: string
          dimension?: string
          name?: string
          to_base?: number
        }
        Relationships: []
      }
      vat_returns: {
        Row: {
          business_id: string
          created_at: string
          created_by: string
          id: string
          idempotency_key: string
          input_minor: number
          net_minor: number
          output_minor: number
          paid_from_account_id: string | null
          paid_on: string | null
          period_from: string
          period_to: string
          reference: string | null
          status: string
          void_reason: string | null
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string
          id?: string
          idempotency_key: string
          input_minor: number
          net_minor: number
          output_minor: number
          paid_from_account_id?: string | null
          paid_on?: string | null
          period_from: string
          period_to: string
          reference?: string | null
          status?: string
          void_reason?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string
          id?: string
          idempotency_key?: string
          input_minor?: number
          net_minor?: number
          output_minor?: number
          paid_from_account_id?: string | null
          paid_on?: string | null
          period_from?: string
          period_to?: string
          reference?: string | null
          status?: string
          void_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vat_returns_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vat_returns_business_id_paid_from_account_id_fkey"
            columns: ["business_id", "paid_from_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
    }
    Views: {
      order_summaries: {
        Row: {
          amount_due_minor: number | null
          archived_at: string | null
          assigned_to: string | null
          balance_minor: number | null
          business_id: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          channel: Database["public"]["Enums"]["contact_source"] | null
          confirmed_at: string | null
          confirmed_by: string | null
          courier_name: string | null
          created_at: string | null
          created_by: string | null
          customer_id: string | null
          delivered_at: string | null
          delivery_address: string | null
          delivery_city: string | null
          delivery_fee_minor: number | null
          delivery_instructions: string | null
          delivery_method: Database["public"]["Enums"]["delivery_method"] | null
          delivery_state: string | null
          discount_minor: number | null
          dispatched_at: string | null
          enquiry_id: string | null
          fulfilment_stage:
            | Database["public"]["Enums"]["fulfilment_stage"]
            | null
          has_made_to_order: boolean | null
          id: string | null
          idempotency_key: string | null
          internal_notes: string | null
          item_count: number | null
          last_paid_on: string | null
          net_paid_minor: number | null
          order_date: string | null
          order_number: string | null
          paid_minor: number | null
          payment_status: string | null
          pickup_location: string | null
          promised_date: string | null
          refunded_minor: number | null
          status: Database["public"]["Enums"]["order_status"] | null
          subtotal_minor: number | null
          total_minor: number | null
          tracking_reference: string | null
          unpaid_dispatch_approved_at: string | null
          unpaid_dispatch_approved_by: string | null
          unpaid_dispatch_reason: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_business_id_assigned_to_fkey"
            columns: ["business_id", "assigned_to"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["business_id", "user_id"]
          },
          {
            foreignKeyName: "orders_business_id_customer_id_fkey"
            columns: ["business_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "orders_business_id_enquiry_id_fkey"
            columns: ["business_id", "enquiry_id"]
            isOneToOne: false
            referencedRelation: "enquiries"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "orders_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_summaries: {
        Row: {
          balance_minor: number | null
          business_id: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          charge_minor: number | null
          collected_at: string | null
          created_at: string | null
          created_by: string | null
          customer_id: string | null
          id: string | null
          item: string | null
          maker_id: string | null
          net_paid_minor: number | null
          notes: string | null
          number: string | null
          problem: string | null
          promised_date: string | null
          ready_at: string | null
          received_on: string | null
          status: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "repairs_business_id_customer_id_fkey"
            columns: ["business_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "repairs_business_id_maker_id_fkey"
            columns: ["business_id", "maker_id"]
            isOneToOne: false
            referencedRelation: "makers"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      stock_availability: {
        Row: {
          available: number | null
          business_id: string | null
          on_hand: number | null
          reserved: number | null
          stock_item_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_items_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_balances: {
        Row: {
          business_id: string | null
          location_id: string | null
          on_hand: number | null
          stock_item_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_business_id_location_id_fkey"
            columns: ["business_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "stock_movements_business_id_stock_item_id_fkey"
            columns: ["business_id", "stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_availability"
            referencedColumns: ["business_id", "stock_item_id"]
          },
          {
            foreignKeyName: "stock_movements_business_id_stock_item_id_fkey"
            columns: ["business_id", "stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      supplier_balances: {
        Row: {
          balance: number | null
          billed: number | null
          business_id: string | null
          paid: number | null
          supplier_id: string | null
        }
        Insert: {
          balance?: never
          billed?: never
          business_id?: string | null
          paid?: never
          supplier_id?: string | null
        }
        Update: {
          balance?: never
          billed?: never
          business_id?: string | null
          paid?: never
          supplier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_invitation: { Args: { p_token: string }; Returns: string }
      account_ledger: {
        Args: { p_account_id: string; p_from: string; p_to: string }
        Returns: {
          balance_minor: number
          credit_minor: number
          debit_minor: number
          description: string
          effective_date: string
          journal_id: string
          kind: string
          narration: string
          number: string
        }[]
      }
      account_movements: {
        Args: { p_business_id: string; p_from: string; p_to: string }
        Returns: {
          account_id: string
          closing_minor: number
          credit_minor: number
          debit_minor: number
          opening_minor: number
        }[]
      }
      activate_bom: { Args: { p_bom_id: string }; Returns: undefined }
      add_bank_account: {
        Args: {
          p_account_id: string
          p_business_id: string
          p_kind: string
          p_name: string
        }
        Returns: string
      }
      add_fixed_asset: {
        Args: {
          p_accumulated_minor: number
          p_acquired_on: string
          p_asset_key: string
          p_business_id: string
          p_cost_minor: number
          p_depreciated_through: string
          p_funding_account_id: string
          p_idempotency_key: string
          p_life_years: number
          p_name: string
          p_residual_minor: number
        }
        Returns: string
      }
      add_loan: {
        Args: {
          p_business_id: string
          p_idempotency_key: string
          p_interest_note: string
          p_lender: string
          p_principal_minor: number
          p_received_into_account_id: string
          p_received_on: string
          p_term: string
        }
        Returns: string
      }
      aged_balances: {
        Args: { p_as_at: string; p_business_id: string; p_kind: string }
        Returns: {
          current_minor: number
          d31_60_minor: number
          d61_90_minor: number
          oldest_date: string
          over_90_minor: number
          party: string
          ref_id: string
          ref_type: string
          reference: string
          total_minor: number
        }[]
      }
      allocate_job_materials: { Args: { p_job: string }; Returns: undefined }
      approve_maker_fee: {
        Args: { p_amount: number; p_job: string }
        Returns: undefined
      }
      approve_purchase_order: { Args: { p_po_id: string }; Returns: undefined }
      approve_unpaid_dispatch: {
        Args: { p_order: string; p_reason: string }
        Returns: undefined
      }
      assign_job_maker: {
        Args: { p_due_date: string; p_job: string; p_maker_id: string }
        Returns: undefined
      }
      assign_repair_maker: {
        Args: { p_maker_id: string; p_repair: string }
        Returns: undefined
      }
      bank_auto_match: { Args: { p_bank_account: string }; Returns: number }
      bank_line_suggestions: {
        Args: { p_line: string }
        Returns: {
          days_apart: number
          effective_date: string
          journal_id: string
          journal_line_id: string
          narration: string
          number: string
        }[]
      }
      bank_reconciliation_status: {
        Args: { p_bank_account: string; p_through: string }
        Returns: {
          book_balance_minor: number
          difference_minor: number
          open_lines: number
          set_aside_minor: number
          statement_balance_minor: number
          uncleared_books_minor: number
          unposted_statement_minor: number
        }[]
      }
      bom_costs: {
        Args: { p_bom: string }
        Returns: {
          labour_cost: number
          other_cost: number
        }[]
      }
      books_checks: {
        Args: { p_as_of: string; p_business_id: string }
        Returns: {
          books_minor: number
          check_key: string
          difference_minor: number
          label: string
          note: string
          records_minor: number
        }[]
      }
      books_match_stock: {
        Args: {
          p_business_id: string
          p_date: string
          p_idempotency_key: string
        }
        Returns: string
      }
      books_post_existing: {
        Args: {
          p_after_created?: string
          p_after_date?: string
          p_after_id?: string
          p_business_id: string
          p_limit?: number
        }
        Returns: {
          next_created: string
          next_date: string
          next_id: string
          posted: number
          problems: number
        }[]
      }
      cancel_order: {
        Args: { p_order: string; p_reason: string }
        Returns: string
      }
      cancel_production_job: {
        Args: { p_job: string; p_reason: string }
        Returns: undefined
      }
      close_fiscal_year: {
        Args: {
          p_business_id: string
          p_idempotency_key: string
          p_year_id: string
        }
        Returns: string
      }
      close_purchase_order: {
        Args: { p_po_id: string; p_reason: string }
        Returns: string
      }
      confirm_order: { Args: { p_order: string }; Returns: number }
      copy_bom: { Args: { p_bom_id: string }; Returns: string }
      create_account: {
        Args: {
          p_business_id: string
          p_code: string
          p_contra_of: string
          p_group: string
          p_name: string
        }
        Returns: string
      }
      create_business: {
        Args: {
          p_currency?: string
          p_is_demo?: boolean
          p_name: string
          p_order_prefix?: string
          p_slug: string
          p_timezone?: string
        }
        Returns: string
      }
      create_demo_workspace: { Args: never; Returns: string }
      create_enquiry_with_customer: {
        Args: {
          p_business_id: string
          p_customer_name: string
          p_customer_phone: string
          p_customer_whatsapp: string
          p_enquiry: Json
        }
        Returns: string
      }
      create_invitation: {
        Args: {
          p_business_id: string
          p_email: string
          p_role: Database["public"]["Enums"]["member_role"]
        }
        Returns: string
      }
      create_order: {
        Args: {
          p_assigned_to?: string
          p_business_id: string
          p_channel?: Database["public"]["Enums"]["contact_source"]
          p_customer_id: string
          p_delivery_address?: string
          p_delivery_city?: string
          p_delivery_fee_minor?: number
          p_delivery_instructions?: string
          p_delivery_method?: Database["public"]["Enums"]["delivery_method"]
          p_delivery_state?: string
          p_discount_minor?: number
          p_enquiry_id?: string
          p_idempotency_key: string
          p_internal_notes?: string
          p_items: Json
          p_pickup_location?: string
          p_promised_date?: string
        }
        Returns: string
      }
      create_production_job: {
        Args: {
          p_bom_id: string
          p_business_id: string
          p_due_date: string
          p_idempotency_key: string
          p_maker_id: string
          p_notes: string
          p_qty: number
          p_variant_id: string
        }
        Returns: string
      }
      create_repair: {
        Args: {
          p_business_id: string
          p_charge_minor: number
          p_customer_id: string
          p_item: string
          p_maker_id: string
          p_notes: string
          p_problem: string
          p_promised_date: string
          p_received_on: string
        }
        Returns: string
      }
      decide_adjustment: {
        Args: {
          p_approve: boolean
          p_idempotency_key: string
          p_note: string
          p_request_id: string
        }
        Returns: string
      }
      decide_expense: {
        Args: { p_approve: boolean; p_expense_id: string; p_reason: string }
        Returns: undefined
      }
      decide_return_line: {
        Args: {
          p_decision: string
          p_idempotency_key: string
          p_line: string
          p_to: string
        }
        Returns: undefined
      }
      discard_opening_batch: {
        Args: { p_batch_id: string }
        Returns: undefined
      }
      dispatch_order: {
        Args: {
          p_courier: string
          p_effective_date: string
          p_idempotency_key: string
          p_lines: Json
          p_location: string
          p_order: string
          p_tracking: string
        }
        Returns: string
      }
      dispose_fixed_asset: {
        Args: {
          p_asset_id: string
          p_disposed_on: string
          p_proceeds_account_id: string
          p_proceeds_minor: number
          p_reason: string
        }
        Returns: undefined
      }
      expense_options: {
        Args: { p_business_id: string }
        Returns: {
          account_group: string
          code: string
          id: string
          name: string
          option_kind: string
        }[]
      }
      goods_receipt_costs: {
        Args: { p_receipt_id: string }
        Returns: {
          landed_cost: number
          line_id: string
          unit_cost: number
          unit_price: number
        }[]
      }
      ignore_bank_line: {
        Args: { p_line: string; p_reason: string }
        Returns: undefined
      }
      import_bank_statement: {
        Args: {
          p_bank_account: string
          p_column_map: Json
          p_file_name: string
          p_idempotency_key: string
          p_lines: Json
        }
        Returns: {
          imported: number
          skipped: number
        }[]
      }
      import_customers: {
        Args: { p_business_id: string; p_dry_run: boolean; p_rows: Json }
        Returns: {
          action: string
          line: number
          message: string
        }[]
      }
      import_products: {
        Args: { p_business_id: string; p_dry_run: boolean; p_rows: Json }
        Returns: {
          action: string
          line: number
          message: string
        }[]
      }
      invitation_preview: {
        Args: { p_token: string }
        Returns: {
          business_name: string
          email: string
          expired: boolean
          role: Database["public"]["Enums"]["member_role"]
        }[]
      }
      invoice_vat_rate: {
        Args: { p_business_id: string; p_date: string }
        Returns: number
      }
      issue_job_materials: {
        Args: {
          p_effective_date: string
          p_from: string
          p_idempotency_key: string
          p_job: string
          p_lines: Json
        }
        Returns: string
      }
      job_costs: {
        Args: { p_job: string }
        Returns: {
          completed_value: number
          fee_approved: number
          labour_cost: number
          material_value: number
          other_cost: number
          paid: number
          wip_value: number
        }[]
      }
      link_exchange_replacement: {
        Args: { p_order: string; p_return: string }
        Returns: undefined
      }
      maker_location: { Args: { p_maker_id: string }; Returns: string }
      mark_order_delivered: { Args: { p_order: string }; Returns: undefined }
      match_bank_line: {
        Args: { p_journal_line: string; p_line: string }
        Returns: undefined
      }
      move_job_materials: {
        Args: {
          p_effective_date: string
          p_from: string
          p_idempotency_key: string
          p_job: string
          p_lines: Json
          p_to: string
        }
        Returns: string
      }
      my_notifications: {
        Args: { p_business_id: string }
        Returns: {
          detail: string
          kind: string
          ref_id: string
          ref_type: string
          severity: string
          title: string
        }[]
      }
      my_production_jobs: {
        Args: { p_business_id: string }
        Returns: {
          bust: number
          colour: string
          customer_first_name: string
          due_date: string
          fit_notes: string
          hip: number
          item_description: string
          item_type: Database["public"]["Enums"]["item_type"]
          job_id: string
          job_notes: string
          job_status: string
          measurement_unit: Database["public"]["Enums"]["measurement_unit"]
          order_number: string
          quantity: number
          size: string
          waist: number
        }[]
      }
      opening_batch_costs: {
        Args: { p_batch_id: string }
        Returns: {
          cost_base: number
          line_no: number
          unit_cost: number
        }[]
      }
      order_profit: {
        Args: { p_order: string }
        Returns: {
          cogs: number
          cost_complete: boolean
          fulfilled_value: number
          gross_profit: number
        }[]
      }
      owner_overview: {
        Args: { p_business_id: string; p_from: string; p_to: string }
        Returns: {
          cash_received: number
          confirmed_value: number
          fulfilled_sales: number
          gross_profit: number
          open_jobs: number
          overdue_jobs: number
          owed_by_customers: number
          owed_to_suppliers: number
          profit_complete: boolean
          shortages: number
          stock_value: number
          wip_value: number
        }[]
      }
      pay_expense: {
        Args: {
          p_expense_id: string
          p_paid_from_account_id: string
          p_paid_on: string
        }
        Returns: undefined
      }
      pay_tax: {
        Args: {
          p_amount_minor: number
          p_business_id: string
          p_idempotency_key: string
          p_paid_from_account_id: string
          p_paid_on: string
          p_reference: string
          p_tax: string
        }
        Returns: string
      }
      post_bank_line: {
        Args: {
          p_account_id: string
          p_idempotency_key: string
          p_line: string
          p_narration: string
          p_vat_minor: number
        }
        Returns: string
      }
      post_manual_journal: {
        Args: {
          p_adjustment_type: string
          p_business_id: string
          p_date: string
          p_idempotency_key: string
          p_kind: string
          p_lines: Json
          p_narration: string
        }
        Returns: string
      }
      post_opening_batch: {
        Args: { p_batch_id: string; p_idempotency_key: string }
        Returns: string
      }
      post_payroll_run: {
        Args: {
          p_business_id: string
          p_idempotency_key: string
          p_lines: Json
          p_paid_from_account_id: string
          p_pay_date: string
          p_period_month: string
        }
        Returns: string
      }
      post_transfer: {
        Args: {
          p_business_id: string
          p_effective_date: string
          p_from: string
          p_idempotency_key: string
          p_item: string
          p_note: string
          p_qty: number
          p_to: string
        }
        Returns: string
      }
      production_repairs: {
        Args: { p_business_id: string }
        Returns: {
          id: string
          item: string
          maker: string
          maker_id: string
          number: string
          problem: string
          promised_date: string
          received_on: string
          status: string
        }[]
      }
      purchase_order_prices: {
        Args: { p_po_id: string }
        Returns: {
          line_id: string
          unit_price: number
        }[]
      }
      receive_customer_return: {
        Args: {
          p_effective_date: string
          p_idempotency_key: string
          p_kind: Database["public"]["Enums"]["return_kind"]
          p_lines: Json
          p_order: string
          p_reason: string
        }
        Returns: string
      }
      receive_goods: {
        Args: {
          p_business_id: string
          p_effective_date: string
          p_idempotency_key: string
          p_landed_cost: number
          p_lines: Json
          p_location: string
          p_po_id: string
          p_record_bill: boolean
          p_supplier_id: string
          p_supplier_ref: string
        }
        Returns: string
      }
      reconcile_bank: {
        Args: {
          p_bank_account: string
          p_statement_balance_minor: number
          p_through: string
        }
        Returns: undefined
      }
      record_equity_movement: {
        Args: {
          p_amount_minor: number
          p_bank_account_id: string
          p_business_id: string
          p_director_key: string
          p_idempotency_key: string
          p_kind: string
          p_moved_on: string
          p_note: string
        }
        Returns: string
      }
      record_expense: {
        Args: {
          p_account_id: string
          p_amount_minor: number
          p_business_id: string
          p_description: string
          p_id: string
          p_idempotency_key: string
          p_paid_from_account_id: string
          p_payee: string
          p_receipt_path: string
          p_spent_on: string
          p_vat_minor: number
        }
        Returns: string
      }
      record_loan_repayment: {
        Args: {
          p_idempotency_key: string
          p_interest_minor: number
          p_loan_id: string
          p_paid_from_account_id: string
          p_paid_on: string
          p_principal_minor: number
        }
        Returns: string
      }
      record_maker_payment: {
        Args: {
          p_amount: number
          p_business_id: string
          p_job: string
          p_maker_id: string
          p_method: Database["public"]["Enums"]["payment_method"]
          p_paid_on: string
          p_reference: string
        }
        Returns: string
      }
      record_qc_inspection: {
        Args: {
          p_defects: string
          p_effective_date: string
          p_idempotency_key: string
          p_instructions: string
          p_job: string
          p_passed: number
          p_rejected: number
          p_results: Json
          p_rework: number
          p_to: string
        }
        Returns: string
      }
      record_repair_payment: {
        Args: {
          p_amount_minor: number
          p_kind: Database["public"]["Enums"]["payment_kind"]
          p_method: Database["public"]["Enums"]["payment_method"]
          p_paid_on: string
          p_reference: string
          p_repair: string
        }
        Returns: string
      }
      record_supplier_bill: {
        Args: {
          p_amount: number
          p_bill_date: string
          p_bill_ref: string
          p_business_id: string
          p_notes: string
          p_po_id: string
          p_receipt_id: string
          p_supplier_id: string
        }
        Returns: string
      }
      record_supplier_payment: {
        Args: {
          p_amount: number
          p_bill_id: string
          p_business_id: string
          p_method: Database["public"]["Enums"]["payment_method"]
          p_paid_on: string
          p_reference: string
          p_supplier_id: string
        }
        Returns: string
      }
      record_vat_return: {
        Args: {
          p_business_id: string
          p_from: string
          p_idempotency_key: string
          p_paid_from_account_id: string
          p_paid_on: string
          p_reference: string
          p_to: string
        }
        Returns: string
      }
      release_job_materials: { Args: { p_job: string }; Returns: undefined }
      reopen_bank_line: { Args: { p_line: string }; Returns: undefined }
      reopen_fiscal_year: {
        Args: {
          p_business_id: string
          p_idempotency_key: string
          p_reason: string
          p_year_id: string
        }
        Returns: undefined
      }
      report_availability: {
        Args: { p_business_id: string }
        Returns: {
          available: number
          code: string
          in_quarantine: number
          item: string
          kind: string
          on_hand: number
          reserved: number
          unit: string
        }[]
      }
      report_balances: {
        Args: { p_business_id: string }
        Returns: {
          customer: string
          order_number: string
          order_value: number
          ordered: string
          owed: number
          progress: string
          received: number
        }[]
      }
      report_cash: {
        Args: { p_business_id: string; p_from: string; p_to: string }
        Returns: {
          method: string
          net: number
          payments: number
          received: number
          refunded: number
        }[]
      }
      report_gross_profit: {
        Args: { p_business_id: string; p_from: string; p_to: string }
        Returns: {
          cogs: number
          cost_complete: boolean
          customer: string
          fulfilled_sales: number
          gross_profit: number
          margin_pct: number
          order_number: string
        }[]
      }
      report_makers: {
        Args: { p_business_id: string; p_from: string; p_to: string }
        Returns: {
          external: boolean
          maker: string
          open_jobs: number
          overdue_jobs: number
          units_completed: number
        }[]
      }
      report_material_variance: {
        Args: { p_business_id: string; p_from: string; p_to: string }
        Returns: {
          item: string
          job: string
          material: string
          planned: number
          unit: string
          used: number
          variance: number
          variance_pct: number
        }[]
      }
      report_movements: {
        Args: { p_business_id: string; p_from: string; p_to: string }
        Returns: {
          document: string
          effective: string
          item: string
          location: string
          quantity: number
          reason: string
          type: string
          unit: string
          unit_cost: number
        }[]
      }
      report_orders_attention: {
        Args: { p_business_id: string }
        Returns: {
          customer: string
          needs: string
          order_number: string
          owed: number
          progress: string
          promised: string
        }[]
      }
      report_qc: {
        Args: { p_business_id: string; p_from: string; p_to: string }
        Returns: {
          failure_pct: number
          inspected: number
          item: string
          passed: number
          rejected: number
          rework: number
        }[]
      }
      report_sales_by_channel: {
        Args: { p_business_id: string; p_from: string; p_to: string }
        Returns: {
          channel: string
          order_value: number
          orders: number
          received: number
        }[]
      }
      report_sales_by_period: {
        Args: {
          p_business_id: string
          p_from: string
          p_grain: string
          p_to: string
        }
        Returns: {
          cash_received: number
          confirmed_value: number
          fulfilled_sales: number
          period: string
        }[]
      }
      report_sales_by_product: {
        Args: { p_business_id: string; p_from: string; p_to: string }
        Returns: {
          cogs: number
          cost_complete: boolean
          gross_profit: number
          product: string
          sales: number
          units: number
        }[]
      }
      report_shortages: {
        Args: { p_business_id: string }
        Returns: {
          available: number
          code: string
          item: string
          needed_by_jobs: number
          reorder_level: number
          short_by: number
          unit: string
        }[]
      }
      report_stock_by_location: {
        Args: { p_business_id: string }
        Returns: {
          code: string
          item: string
          kind: string
          location: string
          on_hand: number
          unit: string
          value: number
        }[]
      }
      report_supplier_balances: {
        Args: { p_business_id: string }
        Returns: {
          billed: number
          owed: number
          paid: number
          supplier: string
        }[]
      }
      report_valuation: {
        Args: { p_business_id: string }
        Returns: {
          items: number
          items_missing_cost: number
          kind: string
          value: number
        }[]
      }
      report_wip: {
        Args: { p_business_id: string }
        Returns: {
          age_days: number
          due: string
          item: string
          job: string
          maker: string
          started: string
          status: string
          units_left: number
          wip_value: number
        }[]
      }
      request_adjustment: {
        Args: {
          p_business_id: string
          p_effective_date: string
          p_idempotency_key?: string
          p_kind: string
          p_lines: Json
          p_location: string
          p_reason: string
        }
        Returns: string
      }
      reserve_order_stock: { Args: { p_order: string }; Returns: number }
      reset_demo_workspace: { Args: never; Returns: string }
      return_job_materials: {
        Args: {
          p_effective_date: string
          p_idempotency_key: string
          p_job: string
          p_lines: Json
          p_to: string
        }
        Returns: string
      }
      return_to_supplier: {
        Args: {
          p_effective_date: string
          p_idempotency_key: string
          p_lines: Json
          p_reason: string
          p_receipt_id: string
        }
        Returns: string
      }
      returns_to_inspect: {
        Args: { p_business_id: string }
        Returns: {
          condition: string
          item: string
          kind: string
          line_id: string
          order_number: string
          quantity: number
          reason: string
          received_on: string
          return_number: string
        }[]
      }
      reverse_goods_receipt: {
        Args: {
          p_idempotency_key: string
          p_reason: string
          p_receipt_id: string
        }
        Returns: undefined
      }
      reverse_journal: {
        Args: {
          p_date: string
          p_idempotency_key: string
          p_journal_id: string
          p_reason: string
        }
        Returns: string
      }
      reverse_opening_batch: {
        Args: {
          p_batch_id: string
          p_idempotency_key: string
          p_reason: string
        }
        Returns: string
      }
      reverse_stock_document: {
        Args: { p_doc_id: string; p_idempotency_key: string; p_reason: string }
        Returns: string
      }
      run_depreciation: {
        Args: {
          p_business_id: string
          p_idempotency_key: string
          p_through: string
        }
        Returns: {
          run_id: string
          total_minor: number
        }[]
      }
      save_annual_accounts: {
        Args: { p_business_id: string; p_fields: Json; p_year_id: string }
        Returns: undefined
      }
      save_bom: {
        Args: {
          p_bom_id: string
          p_business_id: string
          p_instructions: string
          p_is_one_off: boolean
          p_labour_cost: number
          p_lines: Json
          p_name: string
          p_other_cost: number
          p_product_id: string
        }
        Returns: string
      }
      save_opening_batch: {
        Args: {
          p_business_id: string
          p_file_name: string
          p_lines: Json
          p_notes: string
        }
        Returns: string
      }
      save_payroll_person: {
        Args: {
          p_archived: boolean
          p_business_id: string
          p_id: string
          p_kind: string
          p_name: string
          p_role_title: string
        }
        Returns: string
      }
      save_purchase_order: {
        Args: {
          p_business_id: string
          p_expected_date: string
          p_lines: Json
          p_notes: string
          p_po_id: string
          p_supplier_id: string
        }
        Returns: string
      }
      search_everything: {
        Args: { p_business_id: string; p_query: string }
        Returns: {
          kind: string
          ref_id: string
          subtitle: string
          title: string
        }[]
      }
      set_account_archived: {
        Args: { p_account_id: string; p_archived: boolean }
        Returns: undefined
      }
      set_books_lock: {
        Args: { p_business_id: string; p_locked_through: string }
        Returns: undefined
      }
      set_books_payment_account: {
        Args: {
          p_account_id: string
          p_business_id: string
          p_method: Database["public"]["Enums"]["payment_method"]
        }
        Returns: undefined
      }
      set_job_costs: {
        Args: { p_job: string; p_labour_cost: number; p_other_cost: number }
        Returns: undefined
      }
      set_job_material: {
        Args: { p_item: string; p_job: string; p_qty: number; p_unit: string }
        Returns: undefined
      }
      set_product_cost: {
        Args: { p_cost_minor: number; p_product: string; p_variant: string }
        Returns: undefined
      }
      set_repair_status: {
        Args: { p_reason: string; p_repair: string; p_status: string }
        Returns: undefined
      }
      setup_books: {
        Args: {
          p_business_id: string
          p_chart?: Json
          p_first_year_imported: boolean
          p_first_year_start: string
          p_incorporation_date: string
          p_vat_rate: number
          p_vat_registered: boolean
        }
        Returns: undefined
      }
      sign_off_annual_accounts: {
        Args: {
          p_business_id: string
          p_name: string
          p_note: string
          p_qualification: string
          p_signed_on: string
          p_year_id: string
        }
        Returns: undefined
      }
      stock_valuation: {
        Args: { p_business_id: string }
        Returns: {
          avg_cost: number
          location_id: string
          on_hand: number
          stock_item_id: string
          value_kobo: number
        }[]
      }
      submit_job_for_qc: { Args: { p_job: string }; Returns: undefined }
      trial_balance: {
        Args: { p_business_id: string; p_from: string; p_to: string }
        Returns: {
          account_group: string
          account_id: string
          account_type: string
          adjustments_minor: number
          archived: boolean
          closing_minor: number
          code: string
          imported_minor: number
          name: string
          opening_minor: number
          other_minor: number
          system_key: string
        }[]
      }
      update_account: {
        Args: { p_account_id: string; p_code: string; p_name: string }
        Returns: undefined
      }
      update_books_settings: {
        Args: {
          p_business_id: string
          p_incorporation_date: string
          p_vat_charged_from?: string
          p_vat_rate: number
          p_vat_registered: boolean
        }
        Returns: undefined
      }
      update_member: {
        Args: {
          p_active?: boolean
          p_can_view_costs?: boolean
          p_membership_id: string
          p_role?: Database["public"]["Enums"]["member_role"]
          p_title?: string
        }
        Returns: undefined
      }
      update_repair: {
        Args: {
          p_charge_minor: number
          p_item: string
          p_maker_id: string
          p_notes: string
          p_problem: string
          p_promised_date: string
          p_repair: string
        }
        Returns: undefined
      }
      validate_opening_lines: {
        Args: { p_business_id: string; p_lines: Json }
        Returns: {
          base_unit: string
          cost_base: number
          creates_item: boolean
          line: number
          message: string
          ok: boolean
          qty_base: number
          stock_item_id: string
        }[]
      }
      vat_documents: {
        Args: { p_business_id: string; p_from: string; p_to: string }
        Returns: {
          effective_date: string
          input_minor: number
          journal_id: string
          narration: string
          number: string
          output_minor: number
        }[]
      }
      vat_summary: {
        Args: { p_business_id: string; p_from: string; p_to: string }
        Returns: {
          input_minor: number
          net_minor: number
          output_minor: number
        }[]
      }
      void_books_record: {
        Args: { p_id: string; p_kind: string; p_reason: string }
        Returns: undefined
      }
      void_expense: {
        Args: { p_expense_id: string; p_reason: string }
        Returns: undefined
      }
      void_repair_payment: {
        Args: { p_payment: string; p_reason: string }
        Returns: undefined
      }
      void_supplier_record: {
        Args: { p_id: string; p_kind: string; p_reason: string }
        Returns: undefined
      }
      withdraw_annual_accounts_sign_off: {
        Args: { p_business_id: string; p_year_id: string }
        Returns: undefined
      }
    }
    Enums: {
      contact_source:
        | "instagram"
        | "whatsapp"
        | "website"
        | "walk_in"
        | "referral"
        | "other"
      delivery_method: "home_delivery" | "station_pickup" | "store_pickup"
      enquiry_stage:
        | "new"
        | "contacted"
        | "choosing"
        | "awaiting_payment"
        | "won"
        | "lost"
      fulfilment_stage:
        | "confirmed"
        | "in_production"
        | "quality_check"
        | "ready_for_dispatch"
        | "dispatched"
        | "delivered"
      item_type: "ready_made" | "made_to_order"
      measurement_unit: "cm" | "in"
      member_role: "owner" | "front_office" | "sales" | "production_manager"
      member_status: "active" | "deactivated"
      order_status: "open" | "cancelled"
      payment_kind: "payment" | "refund"
      payment_method: "bank_transfer" | "cash" | "pos" | "online" | "other"
      payment_verification: "recorded_manually"
      product_category: "clothing" | "shoes" | "bags" | "other"
      return_kind: "return" | "exchange"
      return_status: "open" | "resolved" | "rejected"
      subscription_status: "trial" | "active" | "past_due" | "cancelled"
      task_kind:
        | "follow_up"
        | "unpaid_order"
        | "delivery_confirmation"
        | "fit_check"
        | "complaint"
        | "alteration"
        | "return"
        | "exchange"
        | "other"
      task_status: "open" | "done" | "cancelled"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      contact_source: [
        "instagram",
        "whatsapp",
        "website",
        "walk_in",
        "referral",
        "other",
      ],
      delivery_method: ["home_delivery", "station_pickup", "store_pickup"],
      enquiry_stage: [
        "new",
        "contacted",
        "choosing",
        "awaiting_payment",
        "won",
        "lost",
      ],
      fulfilment_stage: [
        "confirmed",
        "in_production",
        "quality_check",
        "ready_for_dispatch",
        "dispatched",
        "delivered",
      ],
      item_type: ["ready_made", "made_to_order"],
      measurement_unit: ["cm", "in"],
      member_role: ["owner", "front_office", "sales", "production_manager"],
      member_status: ["active", "deactivated"],
      order_status: ["open", "cancelled"],
      payment_kind: ["payment", "refund"],
      payment_method: ["bank_transfer", "cash", "pos", "online", "other"],
      payment_verification: ["recorded_manually"],
      product_category: ["clothing", "shoes", "bags", "other"],
      return_kind: ["return", "exchange"],
      return_status: ["open", "resolved", "rejected"],
      subscription_status: ["trial", "active", "past_due", "cancelled"],
      task_kind: [
        "follow_up",
        "unpaid_order",
        "delivery_confirmation",
        "fit_check",
        "complaint",
        "alteration",
        "return",
        "exchange",
        "other",
      ],
      task_status: ["open", "done", "cancelled"],
    },
  },
} as const
