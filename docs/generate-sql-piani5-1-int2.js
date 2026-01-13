const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Read the JSON file
const mappings = JSON.parse(fs.readFileSync('mappings-piani5-1-int2.json', 'utf8'));

// Configuration
const projectId = '6c213df8-29d7-437e-95e0-ae38fe2d3ba8'; // CX Place
const userId = 'f3b3e205-dd16-4ced-b1a9-2795f7c1246b'; // Update if needed
const timestamp = Date.now();

console.log('🚀 Generazione SQL per Supabase\n');
console.log(`📋 Project ID: ${projectId}`);
console.log(`👤 User ID: ${userId}`);
console.log(`📊 Entries da importare: ${mappings.length}\n`);

// Generate SQL
let sql = `-- Import mapping entries for Piani 5-1 con Intervento 2
-- Project: CX Place
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

// Process each floor (from 5 to 1)
['5', '4', '3', '2', '1'].forEach(floor => {
  const floorMappings = byFloor[floor];

  if (!floorMappings || floorMappings.length === 0) return;

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
const outputFile = 'import-piani5-1-int2.sql';
fs.writeFileSync(outputFile, sql);

console.log('✅ SQL generato con successo!');
console.log(`📄 File: ${outputFile}`);
console.log(`📊 ${mappings.length} INSERT statements generati\n`);

console.log('📋 Breakdown per piano:');
['5', '4', '3', '2', '1'].forEach(floor => {
  const count = byFloor[floor] ? byFloor[floor].length : 0;
  const withCrossings = byFloor[floor] ? byFloor[floor].filter(m => m.crossings.length > 0).length : 0;
  console.log(`   Piano ${floor}: ${count} entries (${withCrossings} con crossings)`);
});

const totalCrossings = mappings.reduce((sum, m) => sum + m.crossings.length, 0);
console.log(`\n📈 Totale attraversamenti: ${totalCrossings}`);

console.log('\n🚀 Prossimi passi:');
console.log(`   1. Verifica che il tipologico ID sia corretto (attualmente: "${mappings[0].crossings[0].tipologicoId}")`);
console.log('   2. Apri Supabase SQL Editor');
console.log(`   3. Carica ed esegui il file ${outputFile}`);
console.log('   4. Verifica che tutte le entries siano state importate');
