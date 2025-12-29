// ============================================
// SUPABASE TYPES UPDATE
// Add these types to src/lib/supabase.ts in the Database interface
// ============================================

// Add these three new table types to the Database.public.Tables interface
// Place them after the sync_queue table definition

floor_plans: {
  Row: {
    id: string;
    project_id: string;
    floor: string;
    image_url: string;
    thumbnail_url: string | null;
    original_filename: string;
    original_format: string;
    width: number;
    height: number;
    metadata: any; // JSONB
    created_by: string;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id?: string;
    project_id: string;
    floor: string;
    image_url: string;
    thumbnail_url?: string | null;
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
    id?: string;
    project_id?: string;
    floor?: string;
    image_url?: string;
    thumbnail_url?: string | null;
    original_filename?: string;
    original_format?: string;
    width?: number;
    height?: number;
    metadata?: any;
    created_by?: string;
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
    perimeter_points: any; // JSONB array of {x, y}
    custom_text: string | null;
    metadata: any; // JSONB
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
    metadata?: any;
    created_by: string;
    created_at?: string;
    updated_at?: string;
  };
  Update: {
    id?: string;
    floor_plan_id?: string;
    mapping_entry_id?: string;
    point_type?: 'parete' | 'solaio' | 'perimetro' | 'generico';
    point_x?: number;
    point_y?: number;
    label_x?: number;
    label_y?: number;
    perimeter_points?: any;
    custom_text?: string | null;
    metadata?: any;
    created_by?: string;
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
    image_url: string;
    thumbnail_url: string | null;
    original_filename: string;
    width: number;
    height: number;
    points: any; // JSONB array
    grid_enabled: boolean;
    grid_config: any; // JSONB
    metadata: any; // JSONB
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id?: string;
    user_id: string;
    name: string;
    description?: string | null;
    image_url: string;
    thumbnail_url?: string | null;
    original_filename: string;
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
    id?: string;
    user_id?: string;
    name?: string;
    description?: string | null;
    image_url?: string;
    thumbnail_url?: string | null;
    original_filename?: string;
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
