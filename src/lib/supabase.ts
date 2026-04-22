import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase client configuration
 * Environment variables should be set in .env.local for local development
 * and in Vercel Environment Variables for production
 */

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || '';
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '⚠️  Supabase credentials not found. The app will run in offline-only mode.\n' +
    'To enable sync, add REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY to .env.local'
  );
}

/**
 * Supabase client instance
 * Used for authentication, database queries, and storage
 * Only created if credentials are available
 */
// Istanza reale del client Supabase; null in modalità offline.
// Il cast unknown→SupabaseClient (senza Database generic) rimuove `null as any`
// mantenendo il medesimo comportamento a runtime. Il Database generic non viene
// propagato nella variabile esportata perché il tipo `Database` di questo progetto
// omette il campo `Relationships` richiesto dall'SDK v2 per l'inferenza degli Insert,
// il che causerebbe errori `never` sulle tabelle con Insert parziali.
export const supabase = ((supabaseUrl && supabaseAnonKey)
  ? createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: {
        // Store session in localStorage for persistence
        storage: window.localStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      }
    })
  : null) as unknown as SupabaseClient;

/**
 * Check if Supabase is configured
 */
export function isSupabaseConfigured(): boolean {
  return !!(supabaseUrl && supabaseAnonKey);
}

/**
 * Database types for TypeScript support
 * These should match the Supabase schema
 */
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          username: string;
          role: 'admin' | 'user';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          username: string;
          role?: 'admin' | 'user';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          username?: string;
          role?: 'admin' | 'user';
          created_at?: string;
          updated_at?: string;
        };
      };
      projects: {
        Row: {
          id: string;
          title: string;
          client: string;
          address: string;
          notes: string;
          floors: any; // JSONB
          plans: any; // JSONB
          use_room_numbering: boolean;
          use_intervention_numbering: boolean;
          typologies: any; // JSONB
          owner_id: string;
          accessible_users: any; // JSONB
          archived: boolean;
          version: number;
          last_modified: number;
          created_at: string;
          updated_at: string;
          synced: boolean;
        };
        Insert: {
          id?: string;
          title: string;
          client?: string;
          address?: string;
          notes?: string;
          floors?: any;
          plans?: any;
          use_room_numbering?: boolean;
          use_intervention_numbering?: boolean;
          typologies?: any;
          owner_id: string;
          accessible_users?: any;
          archived?: boolean;
          version?: number;
          last_modified?: number;
          created_at?: string;
          updated_at?: string;
          synced?: boolean;
        };
        Update: {
          id?: string;
          title?: string;
          client?: string;
          address?: string;
          notes?: string;
          floors?: any;
          plans?: any;
          use_room_numbering?: boolean;
          use_intervention_numbering?: boolean;
          typologies?: any;
          owner_id?: string;
          accessible_users?: any;
          archived?: boolean;
          version?: number;
          last_modified?: number;
          created_at?: string;
          updated_at?: string;
          synced?: boolean;
        };
      };
      mapping_entries: {
        Row: {
          id: string;
          project_id: string;
          floor: string;
          room: string | null;
          intervention: string | null;
          crossings: any; // JSONB
          to_complete: boolean;
          timestamp: number;
          last_modified: number;
          version: number;
          created_by: string;
          modified_by: string;
          photos: any; // JSONB
          synced: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          floor: string;
          room?: string | null;
          intervention?: string | null;
          crossings?: any;
          to_complete?: boolean;
          timestamp: number;
          last_modified: number;
          version?: number;
          created_by: string;
          modified_by: string;
          photos?: any;
          synced?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          floor?: string;
          room?: string | null;
          intervention?: string | null;
          crossings?: any;
          to_complete?: boolean;
          timestamp?: number;
          last_modified?: number;
          version?: number;
          created_by?: string;
          modified_by?: string;
          photos?: any;
          synced?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      floor_plan_points: {
        Row: {
          id: string;
          floor_plan_id: string;
          mapping_entry_id: string;
          point_type: 'parete' | 'solaio' | 'perimetro' | 'generico';
          point_x: number;
          point_y: number;
          label_x: number;
          label_y: number;
          perimeter_points: any;
          custom_text: string | null;
          ei_rating: number | null;
          metadata: any;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          floor_plan_id: string;
          mapping_entry_id: string;
          point_type: 'parete' | 'solaio' | 'perimetro' | 'generico';
          point_x: number;
          point_y: number;
          label_x: number;
          label_y: number;
          perimeter_points?: any;
          custom_text?: string | null;
          ei_rating?: number | null;
          metadata?: any;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          floor_plan_id?: string;
          mapping_entry_id?: string;
          point_type?: 'parete' | 'solaio' | 'perimetro' | 'generico';
          point_x?: number;
          point_y?: number;
          label_x?: number;
          label_y?: number;
          perimeter_points?: any;
          custom_text?: string | null;
          ei_rating?: number | null;
          metadata?: any;
          updated_at?: string;
        };
      };
      photos: {
        Row: {
          id: string;
          mapping_entry_id: string;
          storage_path: string | null;
          thumbnail_storage_path: string | null;
          url: string | null;
          thumbnail_url: string | null;
          metadata: any; // JSONB
          uploaded: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          mapping_entry_id: string;
          storage_path?: string | null;
          thumbnail_storage_path?: string | null;
          url?: string | null;
          thumbnail_url?: string | null;
          metadata?: any;
          uploaded?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          mapping_entry_id?: string;
          storage_path?: string | null;
          thumbnail_storage_path?: string | null;
          url?: string | null;
          thumbnail_url?: string | null;
          metadata?: any;
          uploaded?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      floor_plans: {
        Row: {
          id: string;
          project_id: string;
          floor: string;
          image_url: string | null;
          thumbnail_url: string | null;
          pdf_url: string | null;
          original_filename: string;
          original_format: string;
          width: number;
          height: number;
          metadata: any;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          floor: string;
          image_url?: string | null;
          thumbnail_url?: string | null;
          pdf_url?: string | null;
          original_filename: string;
          original_format: string;
          width: number;
          height: number;
          metadata?: any;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          project_id?: string;
          floor?: string;
          image_url?: string | null;
          thumbnail_url?: string | null;
          pdf_url?: string | null;
          original_filename?: string;
          original_format?: string;
          width?: number;
          height?: number;
          metadata?: any;
          updated_at?: string;
        };
      };
      dropdown_options: {
        Row: {
          id: string;
          category: string;
          value: string;
          label: string;
          sort_order: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          category: string;
          value: string;
          label: string;
          sort_order?: number;
          is_active?: boolean;
        };
        Update: {
          category?: string;
          value?: string;
          label?: string;
          sort_order?: number;
          is_active?: boolean;
        };
      };
      products: {
        Row: {
          id: string;
          brand: string;
          name: string;
          sort_order: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          brand: string;
          name: string;
          sort_order?: number;
          is_active?: boolean;
        };
        Update: {
          brand?: string;
          name?: string;
          sort_order?: number;
          is_active?: boolean;
        };
      };
      sals: {
        Row: {
          id: string;
          project_id: string;
          number: number;
          name: string | null;
          date: number;
          notes: string | null;
          created_at: string;
          synced: boolean;
        };
        Insert: {
          id?: string;
          project_id: string;
          number: number;
          name?: string | null;
          date: number;
          notes?: string | null;
          created_at?: string;
          synced?: boolean;
        };
        Update: {
          project_id?: string;
          number?: number;
          name?: string | null;
          date?: number;
          notes?: string | null;
          synced?: boolean;
        };
      };
      typology_prices: {
        Row: {
          id: string;
          project_id: string;
          attraversamento: string;
          tipologico_id: string | null;
          price_per_unit: number;
          unit: 'piece' | 'sqm';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          attraversamento: string;
          tipologico_id?: string | null;
          price_per_unit: number;
          unit: 'piece' | 'sqm';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          project_id?: string;
          attraversamento?: string;
          tipologico_id?: string | null;
          price_per_unit?: number;
          unit?: 'piece' | 'sqm';
          updated_at?: string;
        };
      };
      standalone_maps: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          description: string | null;
          image_url: string | null;
          thumbnail_url: string | null;
          original_filename: string;
          width: number;
          height: number;
          points: any; // JSONB array
          grid_enabled: boolean;
          grid_config: any; // JSONB
          metadata: any | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          description?: string | null;
          image_url?: string | null;
          thumbnail_url?: string | null;
          original_filename?: string;
          width?: number;
          height?: number;
          points?: any;
          grid_enabled?: boolean;
          grid_config?: any;
          metadata?: any | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          name?: string;
          description?: string | null;
          image_url?: string | null;
          thumbnail_url?: string | null;
          original_filename?: string;
          width?: number;
          height?: number;
          points?: any;
          grid_enabled?: boolean;
          grid_config?: any;
          metadata?: any | null;
          updated_at?: string;
        };
      };
    };
  };
}
