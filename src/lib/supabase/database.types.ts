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
          id: string
          is_demo: boolean
          logo_path: string | null
          name: string
          next_order_number: number
          order_prefix: string
          slug: string
          stage_labels: Json
          timezone: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          is_demo?: boolean
          logo_path?: string | null
          name: string
          next_order_number?: number
          order_prefix?: string
          slug: string
          stage_labels?: Json
          timezone?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          is_demo?: boolean
          logo_path?: string | null
          name?: string
          next_order_number?: number
          order_prefix?: string
          slug?: string
          stage_labels?: Json
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
      memberships: {
        Row: {
          business_id: string
          created_at: string
          deactivated_at: string | null
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["member_role"]
          status: Database["public"]["Enums"]["member_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          deactivated_at?: string | null
          id?: string
          invited_by?: string | null
          role: Database["public"]["Enums"]["member_role"]
          status?: Database["public"]["Enums"]["member_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          deactivated_at?: string | null
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["member_role"]
          status?: Database["public"]["Enums"]["member_status"]
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
      order_returns: {
        Row: {
          business_id: string
          created_at: string
          created_by: string
          id: string
          kind: Database["public"]["Enums"]["return_kind"]
          order_id: string
          reason: string
          resolution_notes: string | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["return_status"]
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string
          id?: string
          kind: Database["public"]["Enums"]["return_kind"]
          order_id: string
          reason: string
          resolution_notes?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["return_status"]
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string
          id?: string
          kind?: Database["public"]["Enums"]["return_kind"]
          order_id?: string
          reason?: string
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
      product_variants: {
        Row: {
          archived_at: string | null
          business_id: string
          colour: string | null
          created_at: string
          id: string
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
          id?: string
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
          id?: string
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
          business_id: string
          created_at: string
          due_date: string | null
          id: string
          notes: string | null
          order_item_id: string
          status: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          business_id: string
          created_at?: string
          due_date?: string | null
          id?: string
          notes?: string | null
          order_item_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          business_id?: string
          created_at?: string
          due_date?: string | null
          id?: string
          notes?: string | null
          order_item_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
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
    }
    Functions: {
      accept_invitation: { Args: { p_token: string }; Returns: string }
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
      update_member: {
        Args: {
          p_active?: boolean
          p_membership_id: string
          p_role?: Database["public"]["Enums"]["member_role"]
        }
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
      member_role: "owner" | "manager" | "sales" | "production"
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
      member_role: ["owner", "manager", "sales", "production"],
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
