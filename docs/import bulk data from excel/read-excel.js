const XLSX = require('xlsx');

// Read the Excel file
const workbook = XLSX.readFile('piano9.xlsx');

// Get the first sheet
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];

// Convert to JSON
const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

// Print the data
console.log('Sheet name:', sheetName);
console.log('\nData:');
data.forEach((row, idx) => {
  console.log(`Row ${idx}:`, JSON.stringify(row));
});
