const XLSX = require('xlsx');

// Read the Excel file
const workbook = XLSX.readFile('piani 5-1 int 2.xlsx');

console.log('📚 File Excel caricato con successo!\n');
console.log('📄 Fogli trovati:', workbook.SheetNames);
console.log('');

// Process each sheet
workbook.SheetNames.forEach((sheetName, index) => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📄 Foglio ${index + 1}: ${sheetName}`);
  console.log('='.repeat(60));

  const worksheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

  // Print headers
  if (data.length > 0) {
    console.log('\n🏷️  Headers (riga 1):');
    data[0].forEach((header, i) => {
      console.log(`   Colonna ${i}: "${header}"`);
    });
  }

  // Print first 5 data rows
  console.log('\n📊 Prime righe di dati:');
  const rowsToPrint = Math.min(5, data.length - 1);
  for (let i = 1; i <= rowsToPrint; i++) {
    console.log(`\n   Riga ${i}:`);
    data[i].forEach((cell, colIndex) => {
      if (cell !== undefined && cell !== '') {
        console.log(`      Col ${colIndex}: ${cell}`);
      }
    });
  }

  console.log(`\n📈 Totale righe nel foglio: ${data.length}`);
  console.log(`   (1 header + ${data.length - 1} righe dati)`);
});

console.log('\n\n✅ Analisi completata!');
