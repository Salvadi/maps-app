/**
 * LEGACY shim di compatibilità tipi — non è un client runtime.
 *
 * Legacy: client runtime rimosso dopo cutover homeserver.
 * Proxy throwing: qualsiasi accesso solleva eccezione esplicita per
 * evitare regressioni future ('supabase=null' silenzioso era un footgun).
 * Solo Database types sotto restano per consumer type-only.
 */
export const supabase: any = new Proxy(
  {},
  {
    get(_target, prop) {
      throw new Error(
        `Supabase client runtime rimosso (cutover homeserver). ` +
          `Accesso a 'supabase.${String(prop)}' non supportato. Usare apiFetch/apiFetchJson da '../lib/homeserver'.`,
      );
    },
  },
);

/**
 * Compat legacy: il client runtime Supabase è disabilitato.
 */
export function isSupabaseConfigured(): boolean {
  return false;
}

/**
 * Database types for TypeScript support
 * Shape legacy compatibile con lo schema Supabase-era usato dai type-only import.
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
      standalone_maps: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          description: string | null;
          image_url: string | null;
          thumbnail_url: string | null;
          pdf_url: string | null;
          original_filename: string;
          original_format: string | null;
          width: number;
          height: number;
          points: any;
          grid_enabled: boolean;
          grid_config: any;
          metadata: any;
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
          pdf_url?: string | null;
          original_filename: string;
          original_format?: string | null;
          width: number;
          height: number;
          points?: any;
          grid_enabled?: boolean;
          grid_config?: any;
          metadata?: any;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          name?: string;
          description?: string | null;
          image_url?: string | null;
          thumbnail_url?: string | null;
          pdf_url?: string | null;
          original_filename?: string;
          original_format?: string | null;
          width?: number;
          height?: number;
          points?: any;
          grid_enabled?: boolean;
          grid_config?: any;
          metadata?: any;
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
    };
  };
}
