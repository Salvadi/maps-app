# Claude Code worker tools

Questi script implementano il pattern dell'articolo: Claude resta responsabile del ragionamento, mentre un modello economico legge molto contesto o genera boilerplate.

## Setup

1. Installa la dipendenza Python:

   ```powershell
   python -m pip install openai
   ```

2. Imposta le variabili d'ambiente. Consigliato via OpenRouter:

   ```powershell
   $env:WORKER_API_KEY="<LA-TUA-CHIAVE-OPENROUTER>"
   $env:WORKER_BASE_URL="https://openrouter.ai/api/v1"
   $env:WORKER_MODEL="moonshotai/kimi-k2.5"
   ```

   Puoi anche usare `OPENROUTER_API_KEY` al posto di `WORKER_API_KEY`.

   Per renderle persistenti su Windows:

   ```powershell
   [Environment]::SetEnvironmentVariable("WORKER_API_KEY", "...", "User")
   [Environment]::SetEnvironmentVariable("WORKER_BASE_URL", "https://openrouter.ai/api/v1", "User")
   [Environment]::SetEnvironmentVariable("WORKER_MODEL", "moonshotai/kimi-k2.5", "User")
   ```

   Alternativa diretta Moonshot/Kimi:

   ```powershell
   $env:WORKER_API_KEY="..."
   $env:WORKER_BASE_URL="https://api.moonshot.ai/v1"
   $env:WORKER_MODEL="kimi-k2.5"
   ```

   Puoi usare qualsiasi provider compatibile OpenAI cambiando `WORKER_BASE_URL` e `WORKER_MODEL`.
   `WORKER_TEMPERATURE` e opzionale: lascialo vuoto se il provider impone un valore specifico.

## Comandi

```powershell
python scripts/ai-workers/ask-worker.py --paths src/db/onlineFirst.ts src/sync/syncEngine.ts --question "Riassumi le responsabilita dei due file."
```

I path supportano glob Python, per esempio `"src/**/*.ts"`.

```powershell
python scripts/ai-workers/worker-write.py --spec "Crea test Jest per ..." --context src/db/projects.ts --target src/db/projects.worker.test.ts
```

```powershell
python scripts/ai-workers/extract-chat.py "$env:USERPROFILE\.claude\projects\...\session.jsonl" -o tmp-chat.txt
```

`worker-write.py` non sovrascrive file esistenti senza `--force`.
