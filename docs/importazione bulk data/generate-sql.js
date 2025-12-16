const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Read the JSON file
const mappings = JSON.parse(fs.readFileSync('mappings-piano9.json', 'utf8'));

// Configuration
const projectId = '6c213df8-29d7-437e-95e0-ae38fe2d3ba8';
const userId = 'f3b3e205-dd16-4ced-b1a9-2795f7c1246b';
const timestamp = Date.now();

// Generate SQL
let sql = `-- Import mapping entries for Piano 9
-- Project ID: ${projectId}
-- User ID: ${userId}
-- Total entries: ${mappings.length}
-- Generated at: ${new Date().toISOString()}

`;

mappings.forEach((mapping, index) => {
  const id = uuidv4();
  const floor = mapping.floor;
  const room = mapping.room;
  const intervention = mapping.intervention;
  const crossings = JSON.stringify(mapping.crossings);
  const photos = '[]';

  sql += `-- Entry ${index + 1}: Floor ${floor}, Room ${room}, Intervention ${intervention}
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
  '${floor}',
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
});

// Write to file
fs.writeFileSync('import-piano9.sql', sql);

console.log('✅ SQL generato con successo!');
console.log(`📄 File: import-piano9.sql`);
console.log(`📊 ${mappings.length} INSERT statements generati`);
console.log('\n🚀 Prossimi passi:');
console.log('   1. Apri il file import-piano9.sql');
console.log('   2. Esegui lo script SQL su Supabase');
console.log('   3. Verifica che tutte le entries siano state importate');
