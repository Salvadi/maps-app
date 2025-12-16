const XLSX = require('xlsx');
const fs = require('fs');

// Read the Excel file
const workbook = XLSX.readFile('docs/import bulk data from excel/piani8-6 cavi stanze.xlsx');

const allMappings = [];

// Floor mapping from sheet name to floor value
const floorMapping = {
  'piano 8': '8',
  'piano 7': '7',
  'piano 6': '6'
};

// Process each sheet
workbook.SheetNames.forEach((sheetName) => {
  const floor = floorMapping[sheetName];

  if (!floor) {
    console.warn(`⚠️  Foglio "${sheetName}" non riconosciuto, saltato.`);
    return;
  }

  console.log(`\n📄 Processando: ${sheetName} (Piano ${floor})`);

  const worksheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

  // Skip header row
  const rows = data.slice(1);

  let entriesCount = 0;

  rows.forEach((row) => {
    const stanza = row[0];

    // Skip if no stanza
    if (!stanza) return;

    const hasCaviCorrugati = row[1] === 1;
    const hasFascioCavi = row[2] === 1;

    const crossings = [];
    let crossingIndex = 0;

    // 1. Cavi/Corrugati (if value is 1)
    if (hasCaviCorrugati) {
      crossings.push({
        id: `${Date.now()}-${crossingIndex++}`,
        notes: "",
        quantita: 1,
        supporto: "Parete",
        tipoSupporto: "Cartongesso",
        tipologicoId: "1764835598379",
        attraversamento: "Cavi/Corrugati"
      });
    }

    // 2. Fascio di cavi (if value is 1)
    if (hasFascioCavi) {
      crossings.push({
        id: `${Date.now()}-${crossingIndex++}`,
        notes: "",
        quantita: 1,
        supporto: "Parete",
        tipoSupporto: "Cartongesso",
        tipologicoId: "1764835598379",
        attraversamento: "Fascio di cavi"
      });
    }

    entriesCount++;

    allMappings.push({
      floor: floor,
      room: stanza.toString(),
      intervention: "2", // IMPORTANTE: Intervento 2
      crossings: crossings
    });
  });

  console.log(`   ✅ ${entriesCount} stanze processate`);
});

// Save to JSON file
fs.writeFileSync('docs/importazione bulk data/mappings-piani8-6-cavi.json', JSON.stringify(allMappings, null, 2));

console.log(`\n✅ Conversione completata! Create ${allMappings.length} mapping entries (INTERVENTO 2)`);
console.log(`📄 File salvato: mappings-piani8-6-cavi.json`);

// Print summary
const withCrossings = allMappings.filter(e => e.crossings.length > 0).length;
const withoutCrossings = allMappings.filter(e => e.crossings.length === 0).length;
console.log(`\n📊 Riepilogo totale:`);
console.log(`   - Stanze con crossings: ${withCrossings}`);
console.log(`   - Stanze senza crossings: ${withoutCrossings}`);
console.log(`   - Totale: ${allMappings.length}`);
