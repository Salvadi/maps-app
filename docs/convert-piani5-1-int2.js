const XLSX = require('xlsx');
const fs = require('fs');

// Read the Excel file
const workbook = XLSX.readFile('piani 5-1 int 2.xlsx');

const allMappings = [];

// Floor mapping from sheet name to floor value
const floorMapping = {
  'Piano 5': '5',
  'Piano 4': '4',
  'Piano 3': '3',
  'Piano 2': '2',
  'Piano 1': '1'
};

// Tipologico ID for both crossings (Cavi/Corrugati - Hilti CFS-IS)
const TIPOLOGICO_ID = '1764835598379';

console.log('🚀 Inizio conversione Excel → JSON\n');

// Process each sheet
workbook.SheetNames.forEach((sheetName) => {
  const floor = floorMapping[sheetName];

  if (!floor) {
    console.warn(`⚠️  Foglio "${sheetName}" non riconosciuto, saltato.`);
    return;
  }

  console.log(`📄 Processando: ${sheetName} (Piano ${floor})`);

  const worksheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

  // Skip header row
  const rows = data.slice(1);

  let entriesCount = 0;

  rows.forEach((row) => {
    const stanza = row[0];
    const supporto = row[1] || 'Parete';
    const hasCaviCorrugati = row[2] === 1;
    const hasFascioDiCavi = row[3] === 1;

    // Skip if no stanza
    if (!stanza) return;

    const crossings = [];
    let crossingIndex = 0;

    // 1. Cavi/Corrugati (1 cavo)
    if (hasCaviCorrugati) {
      crossings.push({
        id: `${Date.now()}-${crossingIndex++}`,
        supporto: supporto,
        tipoSupporto: "Cartongesso",
        attraversamento: "Cavi/Corrugati",
        quantita: 1,
        tipologicoId: TIPOLOGICO_ID,
        notes: ""
      });
    }

    // 2. Fascio di cavi
    if (hasFascioDiCavi) {
      crossings.push({
        id: `${Date.now()}-${crossingIndex++}`,
        supporto: supporto,
        tipoSupporto: "Cartongesso",
        attraversamento: "Fascio di cavi",
        quantita: 1,
        tipologicoId: TIPOLOGICO_ID,
        notes: ""
      });
    }

    // Add mapping entry with intervention 2
    allMappings.push({
      floor: floor,
      room: stanza.toString(),
      intervention: "2",
      crossings: crossings
    });

    entriesCount++;
  });

  console.log(`   ✅ ${entriesCount} stanze processate`);
});

// Save to JSON file
const outputFile = 'mappings-piani5-1-int2.json';
fs.writeFileSync(outputFile, JSON.stringify(allMappings, null, 2));

console.log(`\n✅ Conversione completata!`);
console.log(`📄 File salvato: ${outputFile}`);
console.log(`📊 Totale entries: ${allMappings.length}`);

// Print summary by floor
console.log(`\n📊 Riepilogo per piano:`);
Object.keys(floorMapping).forEach(sheetName => {
  const floor = floorMapping[sheetName];
  const count = allMappings.filter(m => m.floor === floor).length;
  console.log(`   Piano ${floor}: ${count} stanze`);
});

// Count crossings
const totalCrossings = allMappings.reduce((sum, m) => sum + m.crossings.length, 0);
console.log(`\n📈 Totale attraversamenti: ${totalCrossings}`);
console.log(`   (${totalCrossings / 2} cavi + ${totalCrossings / 2} fasci di cavi)`);
