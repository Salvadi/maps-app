/**
 * Script to mark mapping entries without photos as "to_complete = true"
 *
 * This script can be run once to update existing entries.
 * It updates both:
 * 1. Local IndexedDB entries
 * 2. Supabase database entries
 *
 * Usage:
 * - Open the browser console on the app
 * - Copy and paste this script
 * - Run: await markEntriesWithoutPhotos()
 */

import { supabase } from '../src/lib/supabase';
import { db } from '../src/db/database';

export async function markEntriesWithoutPhotos() {
  console.log('🔍 Starting script to mark entries without photos...');

  let localUpdated = 0;
  let supabaseUpdated = 0;
  let errors = 0;

  try {
    // Get all mapping entries from local database
    const allEntries = await db.mappingEntries.toArray();
    console.log(`📊 Found ${allEntries.length} total mapping entries in local database`);

    for (const entry of allEntries) {
      try {
        // Check if entry has photos
        const hasPhotos = entry.photos && entry.photos.length > 0;

        if (!hasPhotos && !entry.toComplete) {
          // Update local IndexedDB
          await db.mappingEntries.update(entry.id, {
            toComplete: true,
            lastModified: Date.now(),
            version: entry.version + 1
          });
          localUpdated++;
          console.log(`✅ Local: Marked entry ${entry.id} as toComplete (floor: ${entry.floor}, room: ${entry.room || 'N/A'})`);

          // Update Supabase (if configured)
          if (supabase) {
            const { error } = await supabase
              .from('mapping_entries')
              .update({
                to_complete: true,
                version: entry.version + 1,
                last_modified: Date.now(),
                updated_at: new Date().toISOString()
              })
              .eq('id', entry.id);

            if (error) {
              console.error(`❌ Supabase: Failed to update entry ${entry.id}:`, error.message);
              errors++;
            } else {
              supabaseUpdated++;
              console.log(`✅ Supabase: Updated entry ${entry.id}`);
            }
          }
        }
      } catch (err) {
        console.error(`❌ Error processing entry ${entry.id}:`, err);
        errors++;
      }
    }

    console.log('\n📊 Summary:');
    console.log(`   - Total entries checked: ${allEntries.length}`);
    console.log(`   - Local IndexedDB updated: ${localUpdated}`);
    console.log(`   - Supabase updated: ${supabaseUpdated}`);
    console.log(`   - Errors: ${errors}`);
    console.log('\n✅ Script completed!');

    return {
      totalChecked: allEntries.length,
      localUpdated,
      supabaseUpdated,
      errors
    };
  } catch (err) {
    console.error('❌ Script failed:', err);
    throw err;
  }
}

// Export for console usage
(window as any).markEntriesWithoutPhotos = markEntriesWithoutPhotos;

console.log('✅ Script loaded! Run: markEntriesWithoutPhotos()');
