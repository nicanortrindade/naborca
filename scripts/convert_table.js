
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const fs = require('fs');

const inputFile = process.argv[2];
const sourceName = process.argv[3] || 'SINAPI';
const outputFile = process.argv[4] || 'output.json';

const workbook = XLSX.readFile(inputFile);
const worksheet = workbook.Sheets[workbook.SheetNames[0]];

// Use simple sheet_to_json to let it handle headers automatically if possible
const data = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

console.log("Starting simple conversion...");

const results = [];
for (const row of data) {
    // Look for values in the row that look like code and price
    const values = Object.values(row);
    const code = values.find(v => /^\d{2,}$/.test(String(v).trim()));

    // Find price (usually a number or a string with comma)
    let price = 0;
    const rawPrice = values.find(v => {
        if (typeof v === 'number' && v > 0 && v < 1000000) return true;
        if (typeof v === 'string' && /^\d+,\d{2}$/.test(v.trim())) return true;
        return false;
    });

    if (!code || !rawPrice) continue;

    if (typeof rawPrice === 'number') price = rawPrice;
    else price = parseFloat(rawPrice.replace(',', '.'));

    // Try to find description and unit based on known SINAPI keys or position
    const description = values.find(v => typeof v === 'string' && v.length > 20) || "Sem descrição";
    const unit = values.find(v => typeof v === 'string' && v.trim().length <= 4 && v.trim().length > 0 && !/^\d+/.test(v)) || "UN";

    results.push({
        code: String(code),
        description: description.trim().replace(/\s+/g, ' '),
        unit: unit.trim(),
        price,
        source: sourceName,
        type: String(code).length > 6 ? 'service' : 'material',
        updatedAt: new Date()
    });
}

fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
console.log(`Successfully converted ${results.length} items to ${outputFile}`);
