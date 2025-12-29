const XLSX = require('xlsx');
const fs = require('fs');

// Read the Excel file
const workbook = XLSX.readFile('piani8-5.xlsx');

const allMappings = [];

// Floor mapping from sheet name to floor value
const floorMapping = {
  'piano 8': '8',
  'piano 7': '7',
  'piano 6': '6',
  'piano 5': '5'
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
  let emptyCount = 0;

  rows.forEach((row) => {
    const stanza = row[0];

    // Skip if no stanza
    if (!stanza) return;

    const hasCaviCorrugati = row[1] === 1;
    const tuboCombustibileQty = row[2];
    const tuboCombustibileDim = row[3];
    const tuboMultistrattoQty = row[4];
    const tuboMultistrattoDim = row[5];
    const asolaQty = row[6];
    const asolaDim = row[7];

    const crossings = [];

    // Check if row has data (not an empty room)
    const hasData = tuboCombustibileQty || tuboMultistrattoQty || asolaQty;

    if (hasData) {
      let crossingIndex = 0;

      // 1. Cavi/Corrugati (only if value is 1)
      if (hasCaviCorrugati) {
        crossings.push({
          id: `${Date.now()}-${crossingIndex++}`,
          notes: "",
          quantita: 1,
          supporto: "Parete",
          tipoSupporto: "Cartongesso",
          tipologicoId: "1764835535259",
          attraversamento: "Cavi/Corrugati"
        });
      }

      // 2. Tubo combustibile (only if present)
      if (tuboCombustibileQty) {
        crossings.push({
          id: `${Date.now()}-${crossingIndex++}`,
          notes: "",
          diametro: tuboCombustibileDim || "32mm; 40mm",
          quantita: tuboCombustibileQty,
          supporto: "Parete",
          tipoSupporto: "Cartongesso",
          tipologicoId: "1764835575358",
          attraversamento: "Tubo combustibile"
        });
      }

      // 3. Tubo multistrato (only if present)
      if (tuboMultistrattoQty) {
        crossings.push({
          id: `${Date.now()}-${crossingIndex++}`,
          notes: "",
          diametro: tuboMultistrattoDim || "4x 16mm",
          quantita: tuboMultistrattoQty,
          supporto: "Parete",
          tipoSupporto: "Cartongesso",
          tipologicoId: "1764835054458",
          attraversamento: "Tubo multistrato"
        });
      }

      // 4. Asola (only if present)
      if (asolaQty) {
        crossings.push({
          id: `${Date.now()}-${crossingIndex++}`,
          notes: "asole in sovrapposizione",
          quantita: asolaQty,
          supporto: "Parete",
          dimensioni: asolaDim || "",
          tipoSupporto: "Cartongesso",
          attraversamento: "Asola"
        });
      }

      entriesCount++;
    } else {
      emptyCount++;
    }

    allMappings.push({
      floor: floor,
      room: stanza.toString(),
      intervention: "1",
      crossings: crossings
    });
  });

  console.log(`   ✅ ${entriesCount} stanze con crossings`);
  console.log(`   ⚪ ${emptyCount} stanze vuote`);
});

// Save to JSON file
fs.writeFileSync('mappings-piani8-5.json', JSON.stringify(allMappings, null, 2));

console.log(`\n✅ Conversione completata! Create ${allMappings.length} mapping entries`);
console.log(`📄 File salvato: mappings-piani8-5.json`);

// Print summary
const withCrossings = allMappings.filter(e => e.crossings.length > 0).length;
const withoutCrossings = allMappings.filter(e => e.crossings.length === 0).length;
console.log(`\n📊 Riepilogo totale:`);
console.log(`   - Stanze con crossings: ${withCrossings}`);
console.log(`   - Stanze vuote: ${withoutCrossings}`);
console.log(`   - Totale: ${allMappings.length}`);
