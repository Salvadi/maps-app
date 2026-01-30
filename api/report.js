/**
 * Vercel Serverless API Route: /api/report
 *
 * Generates a structured technical report from search results.
 * Returns HTML that can be rendered or exported to PDF client-side.
 */

export const config = {
  maxDuration: 30,
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { query, answer, citations, results } = req.body;

  if (!query || !results) {
    return res.status(400).json({ error: 'Missing query or results' });
  }

  try {
    const reportPrompt = `Genera un report tecnico professionale in italiano basato su questa ricerca di certificazioni antincendio.

QUERY: ${query}

RISPOSTA AI:
${answer}

RISULTATI (${results.length}):
${results.map((r, i) => `[${i + 1}] Certificato: ${r.certName} | Sezione: ${r.section}
Score: ${(r.score * 100).toFixed(0)}%
${r.content}
`).join('\n---\n')}

Genera il report in formato HTML con queste sezioni:
1. Intestazione con query e data
2. Sintesi della risposta
3. Soluzioni trovate (elenco dettagliato)
4. Tabella riepilogativa (se presenti dati tabellari)
5. Fonti e riferimenti

Usa tag HTML semantici. Stile professionale. Includi tutti i dati tecnici esatti.`;

    const llmRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4',
        messages: [
          {
            role: 'system',
            content: 'Sei un generatore di report tecnici per prevenzione incendi. Produci HTML pulito e professionale.',
          },
          { role: 'user', content: reportPrompt },
        ],
        max_tokens: 2048,
        temperature: 0.1,
      }),
    });

    if (!llmRes.ok) {
      throw new Error(`LLM error: ${llmRes.status}`);
    }

    const llmData = await llmRes.json();
    const htmlContent = llmData.choices[0]?.message?.content || '';

    // Wrap in full HTML document
    const fullHtml = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <title>Report - ${query}</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; color: #333; }
    h1 { color: #1a365d; border-bottom: 2px solid #e53e3e; padding-bottom: 10px; }
    h2 { color: #2d3748; margin-top: 30px; }
    h3 { color: #4a5568; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th, td { border: 1px solid #e2e8f0; padding: 8px 12px; text-align: left; }
    th { background: #f7fafc; font-weight: 600; }
    .source { background: #f7fafc; padding: 12px; border-left: 3px solid #4299e1; margin: 8px 0; font-size: 0.9em; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.8em; font-weight: 600; }
    .badge-fire { background: #fed7d7; color: #c53030; }
    .badge-product { background: #c6f6d5; color: #276749; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 0.85em; color: #718096; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>
${htmlContent}
<div class="footer">
  <p>Report generato automaticamente da OPImaPPA - Sistema Ricerca Certificazioni Antincendio</p>
  <p>Data: ${new Date().toLocaleDateString('it-IT', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
</div>
</body>
</html>`;

    return res.status(200).json({ html: fullHtml });
  } catch (error) {
    console.error('Report generation error:', error);
    return res.status(500).json({ error: error.message });
  }
}
