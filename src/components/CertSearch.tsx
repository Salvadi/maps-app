import React, { FormEvent, useMemo, useState, useTransition } from 'react';
import { AlertTriangle, BookOpen, FileSearch, Filter, Loader2, Search, ShieldCheck } from 'lucide-react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

type SearchResult = {
  chunkId: string;
  documentId: string;
  manufacturer: string;
  manufacturerCode: string;
  sourceType: 'certificate' | 'manual';
  evidenceLevel: 'primary' | 'secondary';
  section: string;
  pageStart: number | null;
  pageEnd: number | null;
  products: string[];
  productFamilies: string[];
  fireClasses: string[];
  hasTable: boolean;
  snippet: string;
  lexicalScore: number;
  vectorScore: number;
  fusedScore: number;
  rerankScore: number;
  score: number;
};

type SearchResponse = {
  answer: string;
  citations: Array<{
    id: string;
    chunkId: string;
    documentId: string;
    manufacturer: string;
    sourceType: 'certificate' | 'manual';
    evidenceLevel: 'primary' | 'secondary';
    section: string;
    pageStart: number | null;
    pageEnd: number | null;
    products: string[];
  }>;
  results: SearchResult[];
  parsedQuery: {
    originalQuery: string;
    expandedQuery: string;
    matchedLexicon: string[];
    rerankerMode: string;
    detectedManufacturer: string | null;
  };
  appliedFilters: {
    manufacturer: string | null;
    product: string[] | null;
    hasTable: boolean | null;
    sourceType: string[] | null;
    primaryOnly: boolean;
  };
  support: {
    secondaryOnly: boolean;
    primaryResultCount: number;
  };
};

const manufacturerOptions = [
  { value: '', label: 'Tutte le marche' },
  { value: 'AF_SYSTEMS', label: 'AF Systems' },
  { value: 'PROMAT', label: 'Promat' },
  { value: 'HILTI', label: 'Hilti' },
  { value: 'GLOBAL_BUILDING', label: 'Global Building' },
];

const sourceTypeOptions = [
  { value: '', label: 'Tutte le fonti' },
  { value: 'certificate', label: 'Solo certificati' },
  { value: 'manual', label: 'Solo manuali' },
];

const CertSearch: React.FC = () => {
  const [query, setQuery] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [product, setProduct] = useState('');
  const [sourceType, setSourceType] = useState('');
  const [hasTable, setHasTable] = useState(false);
  const [primaryOnly, setPrimaryOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<SearchResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, startTransition] = useTransition();

  const canSearch = useMemo(() => {
    return Boolean(query.trim() || manufacturer || product.trim());
  }, [manufacturer, product, query]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSearch) return;

    if (!isSupabaseConfigured() || !supabase) {
      setError('Supabase non configurato: la ricerca certificati richiede le credenziali attive.');
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const { data, error: invokeError } = await supabase.functions.invoke('cert-search-v3', {
        body: {
          query,
          filters: {
            manufacturer: manufacturer || null,
            product: product.trim() ? [product.trim()] : null,
            hasTable: hasTable || null,
            sourceType: sourceType ? [sourceType] : null,
            primaryOnly,
          },
        },
      });

      if (invokeError) {
        setError(invokeError.message || 'Ricerca non riuscita.');
        setIsLoading(false);
        return;
      }

      startTransition(() => {
        setPayload(data as SearchResponse);
        setIsLoading(false);
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Ricerca non riuscita.');
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setQuery('');
    setManufacturer('');
    setProduct('');
    setSourceType('');
    setHasTable(false);
    setPrimaryOnly(false);
    setPayload(null);
    setError(null);
    setIsLoading(false);
  };

  return (
    <div className="flex-1 overflow-auto pb-24 bg-[linear-gradient(180deg,#ede7dc_0%,#f7f3eb_22%,#f5f0e8_100%)]">
      <div className="px-5 pt-6 space-y-5">
        <section className="relative overflow-hidden rounded-[28px] bg-brand-800 text-white shadow-card-hover">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.14),transparent_42%),radial-gradient(circle_at_bottom_right,rgba(0,122,255,0.28),transparent_35%)]" />
          <div className="relative px-5 py-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/12 backdrop-blur">
                <FileSearch size={22} />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-white/60">CertSearch v3</p>
                <h1 className="text-2xl font-bold">Ricerca certificati pulita</h1>
              </div>
            </div>
            <p className="mt-4 max-w-xl text-sm text-white/80">
              La nuova pipeline interroga solo il corpus `rag_*`: certificati come fonte primaria, manuali come supporto secondario.
            </p>
          </div>
        </section>

        <section className="rounded-[28px] bg-white/95 p-4 shadow-card">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="rounded-[24px] border border-brand-200 bg-brand-50/70 px-4 py-4">
              <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-brand-500">
                Query
              </label>
              <div className="mt-3 flex items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm">
                <Search size={18} className="text-brand-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Es. AF Systems EI 120 tubo metallico parete rigida"
                  className="w-full bg-transparent text-sm text-brand-800 outline-none placeholder:text-brand-400"
                />
              </div>
            </div>

            <div className="rounded-[24px] border border-brand-200 bg-white px-4 py-4">
              <div className="flex items-center gap-2 text-brand-600">
                <Filter size={16} />
                <span className="text-xs font-semibold uppercase tracking-[0.18em]">Filtri</span>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-xs font-medium text-brand-500">Marca</span>
                  <select
                    value={manufacturer}
                    onChange={(event) => setManufacturer(event.target.value)}
                    className="w-full rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800 outline-none focus:border-accent"
                  >
                    {manufacturerOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>

                <label className="space-y-2">
                  <span className="text-xs font-medium text-brand-500">Prodotto</span>
                  <input
                    value={product}
                    onChange={(event) => setProduct(event.target.value)}
                    placeholder="Es. AF PIPE COLLAR"
                    className="w-full rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800 outline-none placeholder:text-brand-400 focus:border-accent"
                  />
                </label>

                <label className="space-y-2">
                  <span className="text-xs font-medium text-brand-500">Fonte</span>
                  <select
                    value={sourceType}
                    onChange={(event) => setSourceType(event.target.value)}
                    className="w-full rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800 outline-none focus:border-accent"
                  >
                    {sourceTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="flex items-center gap-2 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-700">
                    <input
                      type="checkbox"
                      checked={hasTable}
                      onChange={(event) => setHasTable(event.target.checked)}
                      className="h-4 w-4 rounded border-brand-300 text-accent"
                    />
                    Con tabella
                  </label>
                  <label className="flex items-center gap-2 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-700">
                    <input
                      type="checkbox"
                      checked={primaryOnly}
                      onChange={(event) => setPrimaryOnly(event.target.checked)}
                      className="h-4 w-4 rounded border-brand-300 text-accent"
                    />
                    Solo primarie
                  </label>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={!canSearch || isLoading || isSubmitting}
                className="flex-1 rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white shadow-card transition-transform active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="flex items-center justify-center gap-2">
                  {isLoading || isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                  Cerca
                </span>
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="rounded-2xl border border-brand-200 bg-white px-4 py-3 text-sm font-semibold text-brand-700"
              >
                Reset
              </button>
            </div>
          </form>
        </section>

        {error && (
          <section className="rounded-[24px] border border-danger/20 bg-danger/10 px-4 py-4 text-sm text-danger">
            {error}
          </section>
        )}

        {payload && (
          <>
            <section className="rounded-[28px] bg-white p-5 shadow-card">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-accent/10 text-accent">
                  <ShieldCheck size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-bold text-brand-800">Risposta</h2>
                    {payload.support.secondaryOnly && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-warning">
                        <AlertTriangle size={12} />
                        solo fonti secondarie
                      </span>
                    )}
                  </div>
                  <p className="mt-3 text-sm leading-6 text-brand-700">{payload.answer}</p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {payload.parsedQuery.detectedManufacturer && (
                      <span className="rounded-full bg-brand-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-600">
                        Marca: {payload.parsedQuery.detectedManufacturer}
                      </span>
                    )}
                    <span className="rounded-full bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">
                      Rerank: {payload.parsedQuery.rerankerMode}
                    </span>
                    {payload.parsedQuery.matchedLexicon.map((term) => (
                      <span key={term} className="rounded-full bg-brand-100 px-3 py-1 text-[11px] font-medium text-brand-600">
                        {term}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-[28px] bg-white p-5 shadow-card">
              <div className="flex items-center gap-2">
                <BookOpen size={18} className="text-brand-500" />
                <h2 className="text-base font-bold text-brand-800">Citazioni</h2>
              </div>
              <div className="mt-4 space-y-3">
                {payload.citations.length === 0 ? (
                  <p className="text-sm text-brand-500">Nessuna citazione disponibile.</p>
                ) : (
                  payload.citations.map((citation) => (
                    <div key={citation.chunkId} className="rounded-2xl border border-brand-200 bg-brand-50/80 px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${
                          citation.sourceType === 'certificate'
                            ? 'bg-success/15 text-success'
                            : 'bg-warning/15 text-warning'
                        }`}>
                          {citation.sourceType === 'certificate' ? 'Certificato' : 'Manuale'}
                        </span>
                        <span className="text-xs font-semibold text-brand-600">{citation.manufacturer}</span>
                        <span className="text-xs text-brand-400">
                          {citation.pageStart
                            ? `p. ${citation.pageStart}${citation.pageEnd && citation.pageEnd !== citation.pageStart ? `-${citation.pageEnd}` : ''}`
                            : 'pagina n/d'}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-medium text-brand-700">{citation.section}</p>
                      {citation.products.length > 0 && (
                        <p className="mt-1 text-xs text-brand-500">Prodotti: {citation.products.join(', ')}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="space-y-3">
              {payload.results.length === 0 ? (
                <article className="rounded-[28px] bg-white p-5 shadow-card">
                  <p className="text-sm text-brand-500">Nessun risultato trovato con i filtri correnti.</p>
                </article>
              ) : payload.results.map((result) => (
                <article key={result.chunkId} className="rounded-[28px] bg-white p-5 shadow-card">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${
                      result.sourceType === 'certificate'
                        ? 'bg-success/15 text-success'
                        : 'bg-warning/15 text-warning'
                    }`}>
                      {result.sourceType === 'certificate' ? 'Certificato' : 'Manuale'}
                    </span>
                    <span className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${
                      result.evidenceLevel === 'primary'
                        ? 'bg-accent/10 text-accent'
                        : 'bg-brand-100 text-brand-600'
                    }`}>
                      {result.evidenceLevel === 'primary' ? 'Fonte primaria' : 'Fonte secondaria'}
                    </span>
                    <span className="rounded-full bg-brand-100 px-3 py-1 text-[11px] font-medium text-brand-600">
                      {result.manufacturer}
                    </span>
                    {result.hasTable && (
                      <span className="rounded-full bg-brand-100 px-3 py-1 text-[11px] font-medium text-brand-600">
                        Tabella
                      </span>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-bold text-brand-800">{result.section}</h3>
                      <p className="mt-1 text-xs uppercase tracking-[0.14em] text-brand-400">
                        {result.pageStart
                          ? `pagine ${result.pageStart}${result.pageEnd && result.pageEnd !== result.pageStart ? `-${result.pageEnd}` : ''}`
                          : 'pagine non rilevate'}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-right text-xs text-brand-500">
                      <div className="rounded-2xl bg-brand-50 px-3 py-2">
                        <div className="font-semibold text-brand-700">Score</div>
                        <div>{result.score.toFixed(3)}</div>
                      </div>
                      <div className="rounded-2xl bg-brand-50 px-3 py-2">
                        <div className="font-semibold text-brand-700">Fused</div>
                        <div>{result.fusedScore.toFixed(3)}</div>
                      </div>
                    </div>
                  </div>

                  <p className="mt-4 text-sm leading-6 text-brand-700">{result.snippet}</p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {result.products.map((item) => (
                      <span key={`${result.chunkId}-${item}`} className="rounded-full bg-accent/10 px-3 py-1 text-[11px] font-medium text-accent">
                        {item}
                      </span>
                    ))}
                    {result.fireClasses.map((item) => (
                      <span key={`${result.chunkId}-${item}`} className="rounded-full bg-brand-100 px-3 py-1 text-[11px] font-medium text-brand-600">
                        {item}
                      </span>
                    ))}
                  </div>
                </article>
              ))}
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default CertSearch;
