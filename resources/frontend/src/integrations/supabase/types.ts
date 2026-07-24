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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      asin_price_history: {
        Row: {
          asin_id: string
          changed_at: string
          id: string
          new_price: number
          old_price: number | null
          user_id: string
        }
        Insert: {
          asin_id: string
          changed_at?: string
          id?: string
          new_price: number
          old_price?: number | null
          user_id: string
        }
        Update: {
          asin_id?: string
          changed_at?: string
          id?: string
          new_price?: number
          old_price?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asin_price_history_asin_id_fkey"
            columns: ["asin_id"]
            isOneToOne: false
            referencedRelation: "asins"
            referencedColumns: ["id"]
          },
        ]
      }
      asins: {
        Row: {
          asin_code: string
          created_at: string | null
          display_price: number | null
          id: string
          image_url: string | null
          marketplace: string | null
          notes: string | null
          product_id: string
          status: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          asin_code: string
          created_at?: string | null
          display_price?: number | null
          id?: string
          image_url?: string | null
          marketplace?: string | null
          notes?: string | null
          product_id: string
          status?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          asin_code?: string
          created_at?: string | null
          display_price?: number | null
          id?: string
          image_url?: string | null
          marketplace?: string | null
          notes?: string | null
          product_id?: string
          status?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asins_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string | null
          id: string
          name: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      channel_profitability: {
        Row: {
          calculated_at: string | null
          channel: Database["public"]["Enums"]["sales_channel"]
          cogs: number | null
          gross_revenue: number | null
          id: string
          net_profit: number | null
          net_revenue: number | null
          period_end: string
          period_start: string
          profit_margin: number | null
          total_fees: number | null
          total_orders: number | null
          total_returns: number | null
          total_units: number | null
          user_id: string
        }
        Insert: {
          calculated_at?: string | null
          channel: Database["public"]["Enums"]["sales_channel"]
          cogs?: number | null
          gross_revenue?: number | null
          id?: string
          net_profit?: number | null
          net_revenue?: number | null
          period_end: string
          period_start: string
          profit_margin?: number | null
          total_fees?: number | null
          total_orders?: number | null
          total_returns?: number | null
          total_units?: number | null
          user_id: string
        }
        Update: {
          calculated_at?: string | null
          channel?: Database["public"]["Enums"]["sales_channel"]
          cogs?: number | null
          gross_revenue?: number | null
          id?: string
          net_profit?: number | null
          net_revenue?: number | null
          period_end?: string
          period_start?: string
          profit_margin?: number | null
          total_fees?: number | null
          total_orders?: number | null
          total_returns?: number | null
          total_units?: number | null
          user_id?: string
        }
        Relationships: []
      }
      erp_suppliers: {
        Row: {
          address: string | null
          balance: number | null
          contact_person: string | null
          created_at: string | null
          email: string | null
          id: string
          is_active: boolean | null
          payment_terms: string | null
          phone: string | null
          supplier_code: string
          supplier_name: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          address?: string | null
          balance?: number | null
          contact_person?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          payment_terms?: string | null
          phone?: string | null
          supplier_code: string
          supplier_name: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          address?: string | null
          balance?: number | null
          contact_person?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          payment_terms?: string | null
          phone?: string | null
          supplier_code?: string
          supplier_name?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          category: string
          created_at: string | null
          description: string | null
          expense_date: string | null
          expense_number: string | null
          id: string
          payment_method: string | null
          updated_at: string | null
          user_id: string
          vendor_name: string | null
          warehouse_id: string | null
        }
        Insert: {
          amount?: number
          category?: string
          created_at?: string | null
          description?: string | null
          expense_date?: string | null
          expense_number?: string | null
          id?: string
          payment_method?: string | null
          updated_at?: string | null
          user_id: string
          vendor_name?: string | null
          warehouse_id?: string | null
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string | null
          description?: string | null
          expense_date?: string | null
          expense_number?: string | null
          id?: string
          payment_method?: string | null
          updated_at?: string | null
          user_id?: string
          vendor_name?: string | null
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      import_batches: {
        Row: {
          channel: Database["public"]["Enums"]["sales_channel"] | null
          completed_at: string | null
          created_at: string | null
          error_log: Json | null
          file_name: string | null
          file_size: number | null
          id: string
          import_type: string
          records_failed: number | null
          records_skipped: number | null
          records_success: number | null
          records_total: number | null
          started_at: string | null
          status: string | null
          user_id: string
        }
        Insert: {
          channel?: Database["public"]["Enums"]["sales_channel"] | null
          completed_at?: string | null
          created_at?: string | null
          error_log?: Json | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          import_type: string
          records_failed?: number | null
          records_skipped?: number | null
          records_success?: number | null
          records_total?: number | null
          started_at?: string | null
          status?: string | null
          user_id: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["sales_channel"] | null
          completed_at?: string | null
          created_at?: string | null
          error_log?: Json | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          import_type?: string
          records_failed?: number | null
          records_skipped?: number | null
          records_success?: number | null
          records_total?: number | null
          started_at?: string | null
          status?: string | null
          user_id?: string
        }
        Relationships: []
      }
      imported_transactions: {
        Row: {
          amazon_fee: number | null
          batch_id: string
          classification_status: string | null
          created_at: string | null
          discount_amount: number | null
          fba_fee: number | null
          gross_amount: number | null
          id: string
          import_status: string | null
          matched_order_id: string | null
          matched_order_type: string | null
          matched_sku_id: string | null
          net_amount: number | null
          order_id: string | null
          other_fees: number | null
          processed_at: string | null
          product_name: string | null
          quantity: number | null
          reason_log: string | null
          sku_external_code: string | null
          transaction_date: string | null
          transaction_type: string | null
          user_id: string
        }
        Insert: {
          amazon_fee?: number | null
          batch_id: string
          classification_status?: string | null
          created_at?: string | null
          discount_amount?: number | null
          fba_fee?: number | null
          gross_amount?: number | null
          id?: string
          import_status?: string | null
          matched_order_id?: string | null
          matched_order_type?: string | null
          matched_sku_id?: string | null
          net_amount?: number | null
          order_id?: string | null
          other_fees?: number | null
          processed_at?: string | null
          product_name?: string | null
          quantity?: number | null
          reason_log?: string | null
          sku_external_code?: string | null
          transaction_date?: string | null
          transaction_type?: string | null
          user_id: string
        }
        Update: {
          amazon_fee?: number | null
          batch_id?: string
          classification_status?: string | null
          created_at?: string | null
          discount_amount?: number | null
          fba_fee?: number | null
          gross_amount?: number | null
          id?: string
          import_status?: string | null
          matched_order_id?: string | null
          matched_order_type?: string | null
          matched_sku_id?: string | null
          net_amount?: number | null
          order_id?: string | null
          other_fees?: number | null
          processed_at?: string | null
          product_name?: string | null
          quantity?: number | null
          reason_log?: string | null
          sku_external_code?: string | null
          transaction_date?: string | null
          transaction_type?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "imported_transactions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_transfers: {
        Row: {
          created_at: string
          from_warehouse_id: string
          id: string
          notes: string | null
          product_id: string
          quantity: number
          reference: string | null
          status: string
          to_warehouse_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          from_warehouse_id: string
          id?: string
          notes?: string | null
          product_id: string
          quantity: number
          reference?: string | null
          status?: string
          to_warehouse_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          from_warehouse_id?: string
          id?: string
          notes?: string | null
          product_id?: string
          quantity?: number
          reference?: string | null
          status?: string
          to_warehouse_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "internal_transfers_from_warehouse_id_fkey"
            columns: ["from_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_transfers_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_transfers_to_warehouse_id_fkey"
            columns: ["to_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory: {
        Row: {
          id: string
          product_id: string
          quantity: number | null
          updated_at: string | null
          user_id: string
          warehouse_id: string
        }
        Insert: {
          id?: string
          product_id: string
          quantity?: number | null
          updated_at?: string | null
          user_id: string
          warehouse_id: string
        }
        Update: {
          id?: string
          product_id?: string
          quantity?: number | null
          updated_at?: string | null
          user_id?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_ledger: {
        Row: {
          available_quantity: number | null
          avg_unit_cost: number | null
          id: string
          last_count_date: string | null
          location_id: string
          quantity: number
          reserved_quantity: number | null
          sku_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          available_quantity?: number | null
          avg_unit_cost?: number | null
          id?: string
          last_count_date?: string | null
          location_id: string
          quantity?: number
          reserved_quantity?: number | null
          sku_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          available_quantity?: number | null
          avg_unit_cost?: number | null
          id?: string
          last_count_date?: string | null
          location_id?: string
          quantity?: number
          reserved_quantity?: number | null
          sku_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_ledger_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_ledger_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_locations: {
        Row: {
          address: string | null
          channel: Database["public"]["Enums"]["sales_channel"] | null
          created_at: string | null
          id: string
          is_active: boolean | null
          is_default: boolean | null
          location_code: string
          location_name: string
          location_type: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          address?: string | null
          channel?: Database["public"]["Enums"]["sales_channel"] | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          location_code: string
          location_name: string
          location_type: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          address?: string | null
          channel?: Database["public"]["Enums"]["sales_channel"] | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          location_code?: string
          location_name?: string
          location_type?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      inventory_transactions: {
        Row: {
          created_at: string | null
          from_location_id: string | null
          id: string
          notes: string | null
          quantity: number
          reference_id: string | null
          reference_type: string | null
          sku_id: string
          to_location_id: string | null
          total_cost: number | null
          transaction_code: string
          transaction_date: string
          transaction_type: Database["public"]["Enums"]["inventory_transaction_type"]
          unit_cost: number | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          from_location_id?: string | null
          id?: string
          notes?: string | null
          quantity: number
          reference_id?: string | null
          reference_type?: string | null
          sku_id: string
          to_location_id?: string | null
          total_cost?: number | null
          transaction_code: string
          transaction_date?: string
          transaction_type: Database["public"]["Enums"]["inventory_transaction_type"]
          unit_cost?: number | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          from_location_id?: string | null
          id?: string
          notes?: string | null
          quantity?: number
          reference_id?: string | null
          reference_type?: string | null
          sku_id?: string
          to_location_id?: string | null
          total_cost?: number | null
          transaction_code?: string
          transaction_date?: string
          transaction_type?: Database["public"]["Enums"]["inventory_transaction_type"]
          unit_cost?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_transactions_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_accounts: {
        Row: {
          account_name: string
          account_type: string
          balance: number
          created_at: string
          id: string
          updated_at: string
          user_id: string
          warehouse_id: string | null
        }
        Insert: {
          account_name: string
          account_type?: string
          balance?: number
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
          warehouse_id?: string | null
        }
        Update: {
          account_name?: string
          account_type?: string
          balance?: number
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ledger_accounts_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_entries: {
        Row: {
          amount: number
          created_at: string
          description: string | null
          entry_date: string
          entry_type: string
          id: string
          ledger_account_id: string
          reference_id: string | null
          reference_type: string | null
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          description?: string | null
          entry_date?: string
          entry_type: string
          id?: string
          ledger_account_id: string
          reference_id?: string | null
          reference_type?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string | null
          entry_date?: string
          entry_type?: string
          id?: string
          ledger_account_id?: string
          reference_id?: string | null
          reference_type?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_ledger_account_id_fkey"
            columns: ["ledger_account_id"]
            isOneToOne: false
            referencedRelation: "ledger_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_orders: {
        Row: {
          buyer_name: string | null
          channel: Database["public"]["Enums"]["sales_channel"]
          cost_of_goods: number | null
          created_at: string | null
          delivery_date: string | null
          fulfillment_type: Database["public"]["Enums"]["fulfillment_type"]
          id: string
          import_batch_id: string | null
          is_business_order: boolean | null
          item_tax: number | null
          order_date: string
          platform_data: Json | null
          platform_order_id: string
          quantity: number
          ship_city: string | null
          ship_country: string | null
          ship_date: string | null
          shipping_price: number | null
          sku_id: string
          status: Database["public"]["Enums"]["order_status"] | null
          total_amount: number
          unit_price: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          buyer_name?: string | null
          channel: Database["public"]["Enums"]["sales_channel"]
          cost_of_goods?: number | null
          created_at?: string | null
          delivery_date?: string | null
          fulfillment_type: Database["public"]["Enums"]["fulfillment_type"]
          id?: string
          import_batch_id?: string | null
          is_business_order?: boolean | null
          item_tax?: number | null
          order_date: string
          platform_data?: Json | null
          platform_order_id: string
          quantity: number
          ship_city?: string | null
          ship_country?: string | null
          ship_date?: string | null
          shipping_price?: number | null
          sku_id: string
          status?: Database["public"]["Enums"]["order_status"] | null
          total_amount: number
          unit_price: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          buyer_name?: string | null
          channel?: Database["public"]["Enums"]["sales_channel"]
          cost_of_goods?: number | null
          created_at?: string | null
          delivery_date?: string | null
          fulfillment_type?: Database["public"]["Enums"]["fulfillment_type"]
          id?: string
          import_batch_id?: string | null
          is_business_order?: boolean | null
          item_tax?: number | null
          order_date?: string
          platform_data?: Json | null
          platform_order_id?: string
          quantity?: number
          ship_city?: string | null
          ship_country?: string | null
          ship_date?: string | null
          shipping_price?: number | null
          sku_id?: string
          status?: Database["public"]["Enums"]["order_status"] | null
          total_amount?: number
          unit_price?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_orders_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
        ]
      }
      markets: {
        Row: {
          code: string
          created_at: string | null
          id: string
          name: string | null
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string | null
          id?: string
          name?: string | null
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string | null
          id?: string
          name?: string | null
          user_id?: string
        }
        Relationships: []
      }
      master_products: {
        Row: {
          brand: string | null
          category: string | null
          created_at: string | null
          id: string
          internal_code: string
          internal_name: string
          is_active: boolean | null
          notes: string | null
          specifications: Json | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          brand?: string | null
          category?: string | null
          created_at?: string | null
          id?: string
          internal_code: string
          internal_name: string
          is_active?: boolean | null
          notes?: string | null
          specifications?: Json | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          brand?: string | null
          category?: string | null
          created_at?: string | null
          id?: string
          internal_code?: string
          internal_name?: string
          is_active?: boolean | null
          notes?: string | null
          specifications?: Json | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      offer_profitability: {
        Row: {
          calculated_at: string | null
          gross_profit: number | null
          gross_revenue: number | null
          id: string
          net_profit: number | null
          net_revenue: number | null
          offer_id: string
          period_end: string
          period_start: string
          profit_margin: number | null
          total_costs: number | null
          total_skus: number | null
          units_returned: number | null
          units_sold: number | null
          user_id: string
        }
        Insert: {
          calculated_at?: string | null
          gross_profit?: number | null
          gross_revenue?: number | null
          id?: string
          net_profit?: number | null
          net_revenue?: number | null
          offer_id: string
          period_end: string
          period_start: string
          profit_margin?: number | null
          total_costs?: number | null
          total_skus?: number | null
          units_returned?: number | null
          units_sold?: number | null
          user_id: string
        }
        Update: {
          calculated_at?: string | null
          gross_profit?: number | null
          gross_revenue?: number | null
          id?: string
          net_profit?: number | null
          net_revenue?: number | null
          offer_id?: string
          period_end?: string
          period_start?: string
          profit_margin?: number | null
          total_costs?: number | null
          total_skus?: number | null
          units_returned?: number | null
          units_sold?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "offer_profitability_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          bundle_details: Json | null
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          is_bundle: boolean | null
          master_product_id: string
          offer_code: string
          offer_name: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          bundle_details?: Json | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_bundle?: boolean | null
          master_product_id: string
          offer_code: string
          offer_name: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          bundle_details?: Json | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_bundle?: boolean | null
          master_product_id?: string
          offer_code?: string
          offer_name?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "offers_master_product_id_fkey"
            columns: ["master_product_id"]
            isOneToOne: false
            referencedRelation: "master_products"
            referencedColumns: ["id"]
          },
        ]
      }
      order_returns: {
        Row: {
          channel: Database["public"]["Enums"]["sales_channel"]
          created_at: string | null
          id: string
          import_batch_id: string | null
          loss_amount: number | null
          notes: string | null
          original_order_id: string
          original_order_type: string
          platform_data: Json | null
          platform_return_id: string | null
          processed_date: string | null
          quantity: number
          reason_code: string | null
          reason_detail: string | null
          received_date: string | null
          refund_amount: number
          restocked_quantity: number | null
          return_condition: Database["public"]["Enums"]["return_condition"]
          return_date: string
          return_number: string
          return_to_location_id: string | null
          sku_id: string
          status: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          channel: Database["public"]["Enums"]["sales_channel"]
          created_at?: string | null
          id?: string
          import_batch_id?: string | null
          loss_amount?: number | null
          notes?: string | null
          original_order_id: string
          original_order_type: string
          platform_data?: Json | null
          platform_return_id?: string | null
          processed_date?: string | null
          quantity: number
          reason_code?: string | null
          reason_detail?: string | null
          received_date?: string | null
          refund_amount: number
          restocked_quantity?: number | null
          return_condition?: Database["public"]["Enums"]["return_condition"]
          return_date: string
          return_number: string
          return_to_location_id?: string | null
          sku_id: string
          status?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["sales_channel"]
          created_at?: string | null
          id?: string
          import_batch_id?: string | null
          loss_amount?: number | null
          notes?: string | null
          original_order_id?: string
          original_order_type?: string
          platform_data?: Json | null
          platform_return_id?: string | null
          processed_date?: string | null
          quantity?: number
          reason_code?: string | null
          reason_detail?: string | null
          received_date?: string | null
          refund_amount?: number
          restocked_quantity?: number | null
          return_condition?: Database["public"]["Enums"]["return_condition"]
          return_date?: string
          return_number?: string
          return_to_location_id?: string | null
          sku_id?: string
          status?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_returns_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_returns_return_to_location_id_fkey"
            columns: ["return_to_location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_returns_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
        ]
      }
      order_status_logs: {
        Row: {
          created_at: string | null
          id: string
          new_status: string
          notes: string | null
          old_status: string | null
          order_id: string | null
          return_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          new_status: string
          notes?: string | null
          old_status?: string | null
          order_id?: string | null
          return_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          new_status?: string
          notes?: string | null
          old_status?: string | null
          order_id?: string | null
          return_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_status_logs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_status_logs_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "returns"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string | null
          description: string | null
          id: string
          invoice_id: string | null
          payment_date: string | null
          payment_method: string | null
          payment_number: string | null
          product_id: string | null
          supplier_id: string | null
          updated_at: string | null
          user_id: string
          warehouse_id: string | null
        }
        Insert: {
          amount?: number
          created_at?: string | null
          description?: string | null
          id?: string
          invoice_id?: string | null
          payment_date?: string | null
          payment_method?: string | null
          payment_number?: string | null
          product_id?: string | null
          supplier_id?: string | null
          updated_at?: string | null
          user_id: string
          warehouse_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          description?: string | null
          id?: string
          invoice_id?: string | null
          payment_date?: string | null
          payment_method?: string | null
          payment_number?: string | null
          product_id?: string | null
          supplier_id?: string | null
          updated_at?: string | null
          user_id?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          avg_purchase_price: number | null
          category_id: string | null
          created_at: string | null
          highest_price: number | null
          id: string
          images: string[] | null
          last_purchase_price: number | null
          lowest_price: number | null
          max_stock: number | null
          min_stock: number | null
          name: string
          selling_price: number | null
          sku: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          avg_purchase_price?: number | null
          category_id?: string | null
          created_at?: string | null
          highest_price?: number | null
          id?: string
          images?: string[] | null
          last_purchase_price?: number | null
          lowest_price?: number | null
          max_stock?: number | null
          min_stock?: number | null
          name: string
          selling_price?: number | null
          sku?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          avg_purchase_price?: number | null
          category_id?: string | null
          created_at?: string | null
          highest_price?: number | null
          id?: string
          images?: string[] | null
          last_purchase_price?: number | null
          lowest_price?: number | null
          max_stock?: number | null
          min_stock?: number | null
          name?: string
          selling_price?: number | null
          sku?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          company_name: string | null
          created_at: string | null
          currency: string | null
          full_name: string | null
          id: string
          updated_at: string | null
        }
        Insert: {
          company_name?: string | null
          created_at?: string | null
          currency?: string | null
          full_name?: string | null
          id: string
          updated_at?: string | null
        }
        Update: {
          company_name?: string | null
          created_at?: string | null
          currency?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      purchase_invoice_items: {
        Row: {
          id: string
          invoice_id: string
          product_id: string | null
          quantity: number
          total_price: number
          unit_price: number
        }
        Insert: {
          id?: string
          invoice_id: string
          product_id?: string | null
          quantity: number
          total_price: number
          unit_price: number
        }
        Update: {
          id?: string
          invoice_id?: string
          product_id?: string | null
          quantity?: number
          total_price?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_invoices: {
        Row: {
          created_at: string | null
          id: string
          invoice_number: string | null
          notes: string | null
          paid_amount: number | null
          status: string | null
          supplier_id: string | null
          total_amount: number
          user_id: string
          warehouse_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          invoice_number?: string | null
          notes?: string | null
          paid_amount?: number | null
          status?: string | null
          supplier_id?: string | null
          total_amount: number
          user_id: string
          warehouse_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          invoice_number?: string | null
          notes?: string | null
          paid_amount?: number | null
          status?: string | null
          supplier_id?: string | null
          total_amount?: number
          user_id?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoices_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_items: {
        Row: {
          created_at: string | null
          id: string
          master_product_id: string
          notes: string | null
          ordered_quantity: number
          purchase_order_id: string
          received_quantity: number | null
          sku_id: string | null
          supplier_sku: string | null
          total_cost: number | null
          unit_cost: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          master_product_id: string
          notes?: string | null
          ordered_quantity: number
          purchase_order_id: string
          received_quantity?: number | null
          sku_id?: string | null
          supplier_sku?: string | null
          total_cost?: number | null
          unit_cost: number
        }
        Update: {
          created_at?: string | null
          id?: string
          master_product_id?: string
          notes?: string | null
          ordered_quantity?: number
          purchase_order_id?: string
          received_quantity?: number | null
          sku_id?: string | null
          supplier_sku?: string | null
          total_cost?: number | null
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_master_product_id_fkey"
            columns: ["master_product_id"]
            isOneToOne: false
            referencedRelation: "master_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          created_at: string | null
          destination_location_id: string
          expected_date: string | null
          id: string
          notes: string | null
          order_date: string
          other_costs: number | null
          paid_amount: number | null
          po_number: string
          received_date: string | null
          shipping_cost: number | null
          status: string | null
          subtotal: number | null
          supplier_id: string
          total_amount: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          destination_location_id: string
          expected_date?: string | null
          id?: string
          notes?: string | null
          order_date?: string
          other_costs?: number | null
          paid_amount?: number | null
          po_number: string
          received_date?: string | null
          shipping_cost?: number | null
          status?: string | null
          subtotal?: number | null
          supplier_id: string
          total_amount?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          destination_location_id?: string
          expected_date?: string | null
          id?: string
          notes?: string | null
          order_date?: string
          other_costs?: number | null
          paid_amount?: number | null
          po_number?: string
          received_date?: string | null
          shipping_cost?: number | null
          status?: string | null
          subtotal?: number | null
          supplier_id?: string
          total_amount?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_destination_location_id_fkey"
            columns: ["destination_location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "erp_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      receipts: {
        Row: {
          amount: number
          created_at: string | null
          customer_name: string | null
          description: string | null
          id: string
          invoice_id: string | null
          payment_method: string | null
          product_id: string | null
          receipt_date: string | null
          receipt_number: string | null
          supplier_id: string | null
          updated_at: string | null
          user_id: string
          warehouse_id: string | null
        }
        Insert: {
          amount?: number
          created_at?: string | null
          customer_name?: string | null
          description?: string | null
          id?: string
          invoice_id?: string | null
          payment_method?: string | null
          product_id?: string | null
          receipt_date?: string | null
          receipt_number?: string | null
          supplier_id?: string | null
          updated_at?: string | null
          user_id: string
          warehouse_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          customer_name?: string | null
          description?: string | null
          id?: string
          invoice_id?: string | null
          payment_method?: string | null
          product_id?: string | null
          receipt_date?: string | null
          receipt_number?: string | null
          supplier_id?: string | null
          updated_at?: string | null
          user_id?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receipts_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      returns: {
        Row: {
          amazon_order_number: string | null
          created_at: string | null
          id: string
          order_id: string | null
          processed_at: string | null
          reason: string | null
          refund_amount: number | null
          return_number: string | null
          return_status: string | null
          return_type: string
          user_id: string
        }
        Insert: {
          amazon_order_number?: string | null
          created_at?: string | null
          id?: string
          order_id?: string | null
          processed_at?: string | null
          reason?: string | null
          refund_amount?: number | null
          return_number?: string | null
          return_status?: string | null
          return_type: string
          user_id: string
        }
        Update: {
          amazon_order_number?: string | null
          created_at?: string | null
          id?: string
          order_id?: string | null
          processed_at?: string | null
          reason?: string | null
          refund_amount?: number | null
          return_number?: string | null
          return_status?: string | null
          return_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "returns_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_order_items: {
        Row: {
          id: string
          order_id: string
          product_id: string | null
          quantity: number
          total_price: number
          unit_price: number
        }
        Insert: {
          id?: string
          order_id: string
          product_id?: string | null
          quantity: number
          total_price: number
          unit_price: number
        }
        Update: {
          id?: string
          order_id?: string
          product_id?: string | null
          quantity?: number
          total_price?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_orders: {
        Row: {
          created_at: string | null
          credit_warehouse_id: string | null
          customer_name: string | null
          delivered_at: string | null
          external_order_number: string | null
          fulfillment_warehouse_id: string | null
          id: string
          marketplace_source: string | null
          order_number: string
          shipped_at: string | null
          status: string | null
          total_amount: number
          updated_at: string | null
          user_id: string
          warehouse_id: string | null
        }
        Insert: {
          created_at?: string | null
          credit_warehouse_id?: string | null
          customer_name?: string | null
          delivered_at?: string | null
          external_order_number?: string | null
          fulfillment_warehouse_id?: string | null
          id?: string
          marketplace_source?: string | null
          order_number: string
          shipped_at?: string | null
          status?: string | null
          total_amount: number
          updated_at?: string | null
          user_id: string
          warehouse_id?: string | null
        }
        Update: {
          created_at?: string | null
          credit_warehouse_id?: string | null
          customer_name?: string | null
          delivered_at?: string | null
          external_order_number?: string | null
          fulfillment_warehouse_id?: string | null
          id?: string
          marketplace_source?: string | null
          order_number?: string
          shipped_at?: string | null
          status?: string | null
          total_amount?: number
          updated_at?: string | null
          user_id?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_orders_credit_warehouse_id_fkey"
            columns: ["credit_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_fulfillment_warehouse_id_fkey"
            columns: ["fulfillment_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      settlement_reports: {
        Row: {
          channel: Database["public"]["Enums"]["sales_channel"]
          created_at: string | null
          currency: string | null
          deposit_date: string | null
          file_reference: string | null
          id: string
          import_date: string | null
          notes: string | null
          reconciled_date: string | null
          settlement_end_date: string
          settlement_id: string
          settlement_start_date: string
          status: Database["public"]["Enums"]["settlement_status"] | null
          total_amount: number
          user_id: string
        }
        Insert: {
          channel: Database["public"]["Enums"]["sales_channel"]
          created_at?: string | null
          currency?: string | null
          deposit_date?: string | null
          file_reference?: string | null
          id?: string
          import_date?: string | null
          notes?: string | null
          reconciled_date?: string | null
          settlement_end_date: string
          settlement_id: string
          settlement_start_date: string
          status?: Database["public"]["Enums"]["settlement_status"] | null
          total_amount: number
          user_id: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["sales_channel"]
          created_at?: string | null
          currency?: string | null
          deposit_date?: string | null
          file_reference?: string | null
          id?: string
          import_date?: string | null
          notes?: string | null
          reconciled_date?: string | null
          settlement_end_date?: string
          settlement_id?: string
          settlement_start_date?: string
          status?: Database["public"]["Enums"]["settlement_status"] | null
          total_amount?: number
          user_id?: string
        }
        Relationships: []
      }
      settlement_transactions: {
        Row: {
          advertising_fees: number | null
          created_at: string | null
          fba_fees: number | null
          fulfillment_fees: number | null
          gross_amount: number | null
          id: string
          is_reconciled: boolean | null
          marketplace_order_id: string | null
          net_amount: number | null
          other_fees: number | null
          platform_data: Json | null
          platform_order_id: string | null
          product_sales: number | null
          promotional_rebates: number | null
          quantity: number | null
          selling_fees: number | null
          settlement_report_id: string
          shipping_credits: number | null
          sku_external_code: string | null
          sku_id: string | null
          storage_fees: number | null
          total_fees: number | null
          transaction_date: string | null
          transaction_type: string
          user_id: string
        }
        Insert: {
          advertising_fees?: number | null
          created_at?: string | null
          fba_fees?: number | null
          fulfillment_fees?: number | null
          gross_amount?: number | null
          id?: string
          is_reconciled?: boolean | null
          marketplace_order_id?: string | null
          net_amount?: number | null
          other_fees?: number | null
          platform_data?: Json | null
          platform_order_id?: string | null
          product_sales?: number | null
          promotional_rebates?: number | null
          quantity?: number | null
          selling_fees?: number | null
          settlement_report_id: string
          shipping_credits?: number | null
          sku_external_code?: string | null
          sku_id?: string | null
          storage_fees?: number | null
          total_fees?: number | null
          transaction_date?: string | null
          transaction_type: string
          user_id: string
        }
        Update: {
          advertising_fees?: number | null
          created_at?: string | null
          fba_fees?: number | null
          fulfillment_fees?: number | null
          gross_amount?: number | null
          id?: string
          is_reconciled?: boolean | null
          marketplace_order_id?: string | null
          net_amount?: number | null
          other_fees?: number | null
          platform_data?: Json | null
          platform_order_id?: string | null
          product_sales?: number | null
          promotional_rebates?: number | null
          quantity?: number | null
          selling_fees?: number | null
          settlement_report_id?: string
          shipping_credits?: number | null
          sku_external_code?: string | null
          sku_id?: string | null
          storage_fees?: number | null
          total_fees?: number | null
          transaction_date?: string | null
          transaction_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlement_transactions_marketplace_order_id_fkey"
            columns: ["marketplace_order_id"]
            isOneToOne: false
            referencedRelation: "marketplace_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_transactions_settlement_report_id_fkey"
            columns: ["settlement_report_id"]
            isOneToOne: false
            referencedRelation: "settlement_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_transactions_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
        ]
      }
      sku_profitability: {
        Row: {
          advertising_costs: number | null
          calculated_at: string | null
          cost_of_goods_sold: number | null
          fulfillment_fees: number | null
          gross_profit: number | null
          gross_revenue: number | null
          id: string
          net_profit: number | null
          net_revenue: number | null
          net_units: number | null
          other_costs: number | null
          period_end: string
          period_start: string
          platform_fees: number | null
          profit_margin: number | null
          refunds: number | null
          return_losses: number | null
          roi: number | null
          sku_id: string
          storage_fees: number | null
          units_returned: number | null
          units_sold: number | null
          user_id: string
        }
        Insert: {
          advertising_costs?: number | null
          calculated_at?: string | null
          cost_of_goods_sold?: number | null
          fulfillment_fees?: number | null
          gross_profit?: number | null
          gross_revenue?: number | null
          id?: string
          net_profit?: number | null
          net_revenue?: number | null
          net_units?: number | null
          other_costs?: number | null
          period_end: string
          period_start: string
          platform_fees?: number | null
          profit_margin?: number | null
          refunds?: number | null
          return_losses?: number | null
          roi?: number | null
          sku_id: string
          storage_fees?: number | null
          units_returned?: number | null
          units_sold?: number | null
          user_id: string
        }
        Update: {
          advertising_costs?: number | null
          calculated_at?: string | null
          cost_of_goods_sold?: number | null
          fulfillment_fees?: number | null
          gross_profit?: number | null
          gross_revenue?: number | null
          id?: string
          net_profit?: number | null
          net_revenue?: number | null
          net_units?: number | null
          other_costs?: number | null
          period_end?: string
          period_start?: string
          platform_fees?: number | null
          profit_margin?: number | null
          refunds?: number | null
          return_losses?: number | null
          roi?: number | null
          sku_id?: string
          storage_fees?: number | null
          units_returned?: number | null
          units_sold?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sku_profitability_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
        ]
      }
      skus: {
        Row: {
          channel: Database["public"]["Enums"]["sales_channel"]
          created_at: string | null
          default_selling_price: number | null
          external_sku_code: string | null
          fulfillment_type: Database["public"]["Enums"]["fulfillment_type"]
          id: string
          is_active: boolean | null
          metadata: Json | null
          offer_id: string
          platform_product_id: string | null
          sku_code: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          channel: Database["public"]["Enums"]["sales_channel"]
          created_at?: string | null
          default_selling_price?: number | null
          external_sku_code?: string | null
          fulfillment_type?: Database["public"]["Enums"]["fulfillment_type"]
          id?: string
          is_active?: boolean | null
          metadata?: Json | null
          offer_id: string
          platform_product_id?: string | null
          sku_code: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["sales_channel"]
          created_at?: string | null
          default_selling_price?: number | null
          external_sku_code?: string | null
          fulfillment_type?: Database["public"]["Enums"]["fulfillment_type"]
          id?: string
          is_active?: boolean | null
          metadata?: Json | null
          offer_id?: string
          platform_product_id?: string | null
          sku_code?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "skus_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          created_at: string | null
          from_warehouse_id: string | null
          id: string
          movement_type: string
          notes: string | null
          product_id: string | null
          quantity: number
          reference_id: string | null
          to_warehouse_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          from_warehouse_id?: string | null
          id?: string
          movement_type: string
          notes?: string | null
          product_id?: string | null
          quantity: number
          reference_id?: string | null
          to_warehouse_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          from_warehouse_id?: string | null
          id?: string
          movement_type?: string
          notes?: string | null
          product_id?: string | null
          quantity?: number
          reference_id?: string | null
          to_warehouse_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_from_warehouse_id_fkey"
            columns: ["from_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_to_warehouse_id_fkey"
            columns: ["to_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      store_sales: {
        Row: {
          channel: Database["public"]["Enums"]["sales_channel"]
          cost_of_goods: number | null
          created_at: string | null
          customer_name: string | null
          customer_phone: string | null
          discount_amount: number | null
          id: string
          location_id: string
          notes: string | null
          order_number: string
          payment_method: string | null
          quantity: number
          sale_date: string
          sku_id: string
          status: Database["public"]["Enums"]["order_status"] | null
          tax_amount: number | null
          total_amount: number
          unit_price: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          channel?: Database["public"]["Enums"]["sales_channel"]
          cost_of_goods?: number | null
          created_at?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          discount_amount?: number | null
          id?: string
          location_id: string
          notes?: string | null
          order_number: string
          payment_method?: string | null
          quantity: number
          sale_date?: string
          sku_id: string
          status?: Database["public"]["Enums"]["order_status"] | null
          tax_amount?: number | null
          total_amount: number
          unit_price: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["sales_channel"]
          cost_of_goods?: number | null
          created_at?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          discount_amount?: number | null
          id?: string
          location_id?: string
          notes?: string | null
          order_number?: string
          payment_method?: string | null
          quantity?: number
          sale_date?: string
          sku_id?: string
          status?: Database["public"]["Enums"]["order_status"] | null
          tax_amount?: number | null
          total_amount?: number
          unit_price?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_sales_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_sales_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          balance: number | null
          created_at: string | null
          email: string | null
          id: string
          name: string
          phone: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          address?: string | null
          balance?: number | null
          created_at?: string | null
          email?: string | null
          id?: string
          name: string
          phone?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          address?: string | null
          balance?: number | null
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      warehouses: {
        Row: {
          created_at: string | null
          id: string
          is_main: boolean | null
          name: string
          type: string
          updated_at: string | null
          user_id: string
          wallet_balance: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_main?: boolean | null
          name: string
          type: string
          updated_at?: string | null
          user_id: string
          wallet_balance?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_main?: boolean | null
          name?: string
          type?: string
          updated_at?: string | null
          user_id?: string
          wallet_balance?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      generate_inv_transaction_code: {
        Args: { p_user_id: string }
        Returns: string
      }
      generate_po_number: { Args: { p_user_id: string }; Returns: string }
      generate_return_number: { Args: { p_user_id: string }; Returns: string }
      generate_store_order_number: {
        Args: { p_user_id: string }
        Returns: string
      }
    }
    Enums: {
      fulfillment_type: "fba" | "fbm" | "platform_fulfilled" | "self_fulfilled"
      inventory_transaction_type:
        | "in_purchase"
        | "transfer"
        | "sale"
        | "return"
        | "adjustment"
        | "damage"
      order_status:
        | "pending"
        | "confirmed"
        | "shipped"
        | "delivered"
        | "cancelled"
        | "returned"
      return_condition:
        | "sellable"
        | "unsellable"
        | "damaged"
        | "pending_inspection"
      sales_channel: "store" | "amazon" | "noon" | "jumia" | "website" | "other"
      settlement_status: "pending" | "processed" | "reconciled" | "disputed"
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
  public: {
    Enums: {
      fulfillment_type: ["fba", "fbm", "platform_fulfilled", "self_fulfilled"],
      inventory_transaction_type: [
        "in_purchase",
        "transfer",
        "sale",
        "return",
        "adjustment",
        "damage",
      ],
      order_status: [
        "pending",
        "confirmed",
        "shipped",
        "delivered",
        "cancelled",
        "returned",
      ],
      return_condition: [
        "sellable",
        "unsellable",
        "damaged",
        "pending_inspection",
      ],
      sales_channel: ["store", "amazon", "noon", "jumia", "website", "other"],
      settlement_status: ["pending", "processed", "reconciled", "disputed"],
    },
  },
} as const
