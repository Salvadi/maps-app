import { createClient } from '@supabase/supabase-js';

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
export const supabase = (supabaseUrl && supabaseAnonKey)
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        // Store session in localStorage for persistence
        storage: window.localStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      }
    })
  : null as any; // Fallback to null for offline-only mode or tests

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
          room_or_intervention: string;
          crossings: any; // JSONB
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
          room_or_intervention: string;
          crossings?: any;
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
          room_or_intervention?: string;
          crossings?: any;
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
      photos: {
        Row: {
          id: string;
          mapping_entry_id: string;
          storage_path: string | null;
          url: string | null;
          metadata: any; // JSONB
          uploaded: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          mapping_entry_id: string;
          storage_path?: string | null;
          url?: string | null;
          metadata?: any;
          uploaded?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          mapping_entry_id?: string;
          storage_path?: string | null;
          url?: string | null;
          metadata?: any;
          uploaded?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      sync_queue: {
        Row: {
          id: string;
          operation: 'CREATE' | 'UPDATE' | 'DELETE';
          entity_type: 'project' | 'mapping_entry' | 'photo';
          entity_id: string;
          data: any; // JSONB
          timestamp: number;
          synced: boolean;
          user_id: string;
          created_at: string;
          processed_at: string | null;
        };
        Insert: {
          id?: string;
          operation: 'CREATE' | 'UPDATE' | 'DELETE';
          entity_type: 'project' | 'mapping_entry' | 'photo';
          entity_id: string;
          data?: any;
          timestamp: number;
          synced?: boolean;
          user_id: string;
          created_at?: string;
          processed_at?: string | null;
        };
        Update: {
          id?: string;
          operation?: 'CREATE' | 'UPDATE' | 'DELETE';
          entity_type?: 'project' | 'mapping_entry' | 'photo';
          entity_id?: string;
          data?: any;
          timestamp?: number;
          synced?: boolean;
          user_id?: string;
          created_at?: string;
          processed_at?: string | null;
        };
      };
    };
  };
}
