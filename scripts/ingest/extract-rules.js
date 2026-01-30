/**
 * FPS Rule Extraction Pipeline
 *
 * Reads parsed markdown from ingestion and uses Claude to extract
 * structured fire safety rules (material, diameter, fire class, product, conditions).
 *
 * Uso: node --env-file=.env extract-rules.js
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const PDF_DIR = path.resolve('./pdfs');

const RULE_EXTRACTION_PROMPT = `Sei un esperto di prevenzione incendi. Analizza questo testo da una certificazione antincendio ed estrai tutte le regole tecniche in formato JSON strutturato.

Per ogni regola/soluzione trovata, estrai:
- material: materiale dell'attraversamento (PVC, PE, acciaio, rame, ghisa, multiplo, etc.)
- diameter_min: diametro minimo in mm (null se non specificato)
- diameter_max: diametro massimo in mm (null se non specificato)
- fire_class: classe di resistenza al fuoco (EI30, EI60, EI90, EI120, EI180, EI240)
- element_type: tipo di elemento attraversato (parete, solaio, both)
- product: nome del prodotto certificato
- brand: marca del prodotto
- conditions: array di condizioni di applicabilità (stringhe)
- summary: descrizione breve della soluzione in italiano

Rispondi SOLO con un array JSON valido. Se non trovi regole, rispondi con [].

Esempio output:
[
  {
    "material": "PVC",
    "diameter_min": 32,
    "diameter_max": 160,
    "fire_class": "EI120",
    "element_type": "solaio",
    "product": "AF Collar",
    "brand": "AF Systems",
    "conditions": ["Spessore minimo elemento 150mm", "Distanza minima tra attraversamenti 200mm"],
    "summary": "Collare intumescente per tubi PVC da 32 a 160mm in solaio EI120"
  }
]`;

async function extractRulesFromChunk(content) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-4',
      messages: [
        { role: 'system', content: RULE_EXTRACTION_PROMPT },
        { role: 'user', content },
      ],
      max_tokens: 2048,
      temperature: 0,
    }),
  });

  if (!response.ok) {
    console.error('LLM error:', await response.text());
    return [];
  }

  const data = await response.json();
  const text = data.choices[0]?.message?.content || '[]';

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    console.error('Failed to parse rules JSON:', text.substring(0, 200));
    return [];
  }
}

async function processMarkdownFile(mdPath) {
  const certName = path.basename(mdPath, '.parsed.md');
  console.log(`\n━━━ Extracting rules: ${certName} ━━━`);

  const markdown = fs.readFileSync(mdPath, 'utf-8');

  // Split into sections for processing
  const sections = markdown.split(/(?=^#{1,3}\s)/m).filter(s => s.trim());

  // Process sections that likely contain rules (tables, dimensions, classifications)
  const relevantSections = sections.filter(s =>
    s.includes('|') || // tables
    /\d+\s*mm/i.test(s) || // dimensions
    /EI\s*\d+/i.test(s) || // fire classes
    /diametr/i.test(s) || // diameter mentions
    /tubo|pipe|collar|mastic/i.test(s) // products
  );

  console.log(`  Found ${relevantSections.length} relevant sections out of ${sections.length} total`);

  const allRules = [];

  for (let i = 0; i < relevantSections.length; i++) {
    const section = relevantSections[i];
    console.log(`  Processing section ${i + 1}/${relevantSections.length}...`);

    const rules = await extractRulesFromChunk(section);
    if (rules.length > 0) {
      console.log(`    → ${rules.length} rules extracted`);
      allRules.push(...rules.map(r => ({ ...r, cert_name: certName })));
    }

    // Rate limit: ~1 request per second
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`\n  Total rules extracted: ${allRules.length}`);
  return allRules;
}

async function saveRulesToSupabase(rules) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.log('  Supabase not configured, saving to local JSON instead');
    return;
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl, supabaseKey);

  const rows = rules.map(rule => ({
    id: crypto.randomUUID(),
    cert_id: null, // Will be linked later if needed
    summary: rule.summary,
    conditions: {
      material: rule.material,
      diameter_min: rule.diameter_min,
      diameter_max: rule.diameter_max,
      fire_class: rule.fire_class,
      element_type: rule.element_type,
      product: rule.product,
      brand: rule.brand,
      conditions: rule.conditions,
    },
    result: {
      cert_name: rule.cert_name,
    },
    pages: null,
  }));

  const batchSize = 50;
  for (let i = 0; i < rows.length; i += batchSize) {
    const { error } = await supabase.from('certificate_rules').upsert(rows.slice(i, i + batchSize));
    if (error) console.error('  Supabase insert error:', error.message);
  }

  console.log(`  Saved ${rows.length} rules to Supabase`);
}

async function main() {
  console.log('═══ FPS Rule Extraction Pipeline ═══\n');

  // Find all parsed markdown files
  const mdFiles = fs.readdirSync(PDF_DIR).filter(f => f.endsWith('.parsed.md'));

  if (mdFiles.length === 0) {
    console.error('No parsed markdown files found. Run ingestion first: npm run ingest');
    process.exit(1);
  }

  console.log(`Found ${mdFiles.length} parsed file(s)`);

  const allRules = [];

  for (const file of mdFiles) {
    const rules = await processMarkdownFile(path.join(PDF_DIR, file));
    allRules.push(...rules);
  }

  // Save to JSON file
  const outputPath = path.join(PDF_DIR, '_extracted_rules.json');
  fs.writeFileSync(outputPath, JSON.stringify(allRules, null, 2), 'utf-8');
  console.log(`\nSaved ${allRules.length} rules to ${outputPath}`);

  // Save to Supabase if configured
  if (allRules.length > 0) {
    await saveRulesToSupabase(allRules);
  }

  console.log('\n═══ Rule extraction complete ═══');
}

main();
