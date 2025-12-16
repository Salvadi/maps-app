const XLSX = require('xlsx');

// Read the Excel file
const workbook = XLSX.readFile('docs/import bulk data from excel/piani8-6 cavi stanze.xlsx');

// Get all sheet names
console.log('📊 Fogli presenti nel file:');
workbook.SheetNames.forEach((name, idx) => {
  console.log(`   ${idx + 1}. ${name}`);
});

// Process each sheet
workbook.SheetNames.forEach((sheetName) => {
  console.log(`\n\n═══════════════════════════════════════`);
  console.log(`📄 FOGLIO: ${sheetName}`);
  console.log(`═══════════════════════════════════════\n`);

  const worksheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

  // Print first 15 rows
  data.slice(0, 15).forEach((row, idx) => {
    console.log(`Row ${idx}:`, JSON.stringify(row));
  });

  console.log(`\n... (${data.length} righe totali)`);
});
