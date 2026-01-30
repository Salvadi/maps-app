/**
 * Browser Console Script to mark mapping entries without photos as "to_complete = true"
 *
 * HOW TO USE:
 * 1. Open your app in the browser
 * 2. Open browser console (F12)
 * 3. Copy and paste this entire script
 * 4. Press Enter
 * 5. The script will run automatically
 *
 * This updates both local IndexedDB and Supabase database
 */

(async function() {
  console.log('🔍 Starting script to mark entries without photos...');

  // Import dependencies
  const { supabase } = await import('./src/lib/supabase.js');
  const { db } = await import('./src/db/database.js');

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
    console.log('\n✅ Script completed successfully!');

    alert(`Script completed!\n\nTotal checked: ${allEntries.length}\nLocal updated: ${localUpdated}\nSupabase updated: ${supabaseUpdated}\nErrors: ${errors}`);

  } catch (err) {
    console.error('❌ Script failed:', err);
    alert('Script failed! Check console for details.');
  }
})();
