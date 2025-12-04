const XLSX = require('xlsx');
const fs = require('fs');

// Read the Excel file
const workbook = XLSX.readFile('piano9.xlsx');
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];
const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

// Skip header row
const rows = data.slice(1);

const mappingEntries = [];

rows.forEach((row, idx) => {
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

    // 2. Tubo combustibile
    if (tuboCombustibileQty) {
      crossings.push({
        id: `${Date.now()}-${crossingIndex++}`,
        notes: "",
        diametro: tuboCombustibileDim || "32mm, 40mm",
        quantita: tuboCombustibileQty,
        supporto: "Parete",
        tipoSupporto: "Cartongesso",
        tipologicoId: "1764835575358",
        attraversamento: "Tubo combustibile"
      });
    }

    // 3. Tubo multistrato
    if (tuboMultistrattoQty) {
      crossings.push({
        id: `${Date.now()}-${crossingIndex++}`,
        notes: "",
        diametro: tuboMultistrattoDim || "4x 16mm; 4x 40mm",
        quantita: tuboMultistrattoQty,
        supporto: "Parete",
        tipoSupporto: "Cartongesso",
        tipologicoId: "1764835054458",
        attraversamento: "Tubo multistrato"
      });
    }

    // 4. Asola
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
  }

  mappingEntries.push({
    floor: "9",
    room: stanza.toString(),
    intervention: "1",
    crossings: crossings
  });
});

// Save to JSON file
fs.writeFileSync('mappings-piano9.json', JSON.stringify(mappingEntries, null, 2));

console.log(`✅ Conversione completata! Create ${mappingEntries.length} mapping entries`);
console.log(`📄 File salvato: mappings-piano9.json`);

// Print summary
const withCrossings = mappingEntries.filter(e => e.crossings.length > 0).length;
const withoutCrossings = mappingEntries.filter(e => e.crossings.length === 0).length;
console.log(`\n📊 Riepilogo:`);
console.log(`   - Stanze con crossings: ${withCrossings}`);
console.log(`   - Stanze vuote: ${withoutCrossings}`);
console.log(`   - Totale: ${mappingEntries.length}`);
