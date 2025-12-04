const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Read the JSON file
const mappings = JSON.parse(fs.readFileSync('mappings-piani8-5.json', 'utf8'));

// Configuration
const projectId = '6c213df8-29d7-437e-95e0-ae38fe2d3ba8';
const userId = 'f3b3e205-dd16-4ced-b1a9-2795f7c1246b';
const timestamp = Date.now();

// Generate SQL
let sql = `-- Import mapping entries for Piani 8, 7, 6, 5
-- Project ID: ${projectId}
-- User ID: ${userId}
-- Total entries: ${mappings.length}
-- Generated at: ${new Date().toISOString()}

`;

// Group by floor for better organization
const byFloor = {};
mappings.forEach(m => {
  if (!byFloor[m.floor]) byFloor[m.floor] = [];
  byFloor[m.floor].push(m);
});

let entryNumber = 1;

// Process each floor
Object.keys(byFloor).sort().reverse().forEach(floor => {
  const floorMappings = byFloor[floor];

  sql += `-- ═══════════════════════════════════════════════════════════
-- PIANO ${floor} (${floorMappings.length} entries)
-- ═══════════════════════════════════════════════════════════

`;

  floorMappings.forEach((mapping) => {
    const id = uuidv4();
    const floorValue = mapping.floor;
    const room = mapping.room;
    const intervention = mapping.intervention;
    const crossings = JSON.stringify(mapping.crossings);
    const photos = '[]';

    sql += `-- Entry ${entryNumber}: Floor ${floorValue}, Room ${room}, Intervention ${intervention}
INSERT INTO public.mapping_entries (
  id,
  project_id,
  floor,
  room,
  intervention,
  crossings,
  timestamp,
  last_modified,
  version,
  created_by,
  modified_by,
  photos,
  synced,
  created_at,
  updated_at
) VALUES (
  '${id}',
  '${projectId}',
  '${floorValue}',
  '${room}',
  '${intervention}',
  '${crossings}'::jsonb,
  ${timestamp},
  ${timestamp},
  1,
  '${userId}',
  '${userId}',
  '${photos}'::jsonb,
  true,
  NOW(),
  NOW()
);

`;
    entryNumber++;
  });
});

// Write to file
fs.writeFileSync('import-piani8-5.sql', sql);

console.log('✅ SQL generato con successo!');
console.log(`📄 File: import-piani8-5.sql`);
console.log(`📊 ${mappings.length} INSERT statements generati`);
console.log('\n📋 Breakdown per piano:');
Object.keys(byFloor).sort().reverse().forEach(floor => {
  const count = byFloor[floor].length;
  const withCrossings = byFloor[floor].filter(m => m.crossings.length > 0).length;
  const empty = count - withCrossings;
  console.log(`   Piano ${floor}: ${count} entries (${withCrossings} con crossings, ${empty} vuote)`);
});
console.log('\n🚀 Prossimi passi:');
console.log('   1. Apri il file import-piani8-5.sql');
console.log('   2. Esegui lo script SQL su Supabase');
console.log('   3. Verifica che tutte le entries siano state importate');
