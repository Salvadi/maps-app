export function apiStorageFrom(bucket: string) {
  return {
    getPublicUrl(path: string): { data: { publicUrl: string } } {
      const canonical = /^(photos|planimetrie)\//.test(path)
        ? path
        : `${bucket}/${path}`;
      return { data: { publicUrl: `/api/storage/${canonical}` } };
    },

    async createSignedUrl(
      path: string,
      ttlSec: number,
    ): Promise<{ data: { signedUrl: string } | null; error: Error | null }> {
      try {
        const res = await fetch('/api/storage/sign-one', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bucket, path, ttl: ttlSec }),
        });
        if (!res.ok) {
          return { data: null, error: new Error(`sign-one ${res.status}`) };
        }
        const { signedUrl } = await res.json();
        if (!signedUrl) return { data: null, error: new Error('sign-one: missing signedUrl in response') };
        return { data: { signedUrl }, error: null };
      } catch (e) {
        return { data: null, error: e instanceof Error ? e : new Error(String(e)) };
      }
    },

    async createSignedUrls(
      paths: string[],
      ttlSec: number,
    ): Promise<{ data: Array<{ path: string; signedUrl: string; error: string | null }> | null; error: Error | null }> {
      try {
        const results = await Promise.all(
          paths.map(async (path) => {
            try {
              const res = await fetch('/api/storage/sign-one', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bucket, path, ttl: ttlSec }),
              });
              if (!res.ok) {
                return { path, signedUrl: '', error: `sign-one ${res.status}` };
              }
              const { signedUrl } = await res.json();
              if (!signedUrl) {
                return { path, signedUrl: '', error: 'sign-one: missing signedUrl in response' };
              }
              return { path, signedUrl, error: null };
            } catch (e) {
              return { path, signedUrl: '', error: e instanceof Error ? e.message : String(e) };
            }
          }),
        );
        const allFailed = results.every(r => r.error !== null);
        if (allFailed && paths.length > 0) {
          return { data: null, error: new Error(results[0].error ?? 'createSignedUrls: all paths failed') };
        }
        return { data: results, error: null };
      } catch (e) {
        return { data: null, error: e instanceof Error ? e : new Error(String(e)) };
      }
    },

    async download(
      path: string,
    ): Promise<{ data: Blob | null; error: Error | null }> {
      // Rimuovi eventuale prefisso bucket/ per evitare doppio prefisso nell'URL
      const cleanPath = path.startsWith(`${bucket}/`) ? path.slice(bucket.length + 1) : path;
      try {
        const res = await fetch(`/api/storage/proxy/${bucket}/${cleanPath}`, {
          credentials: 'include',
        });
        if (res.ok) {
          return { data: await res.blob(), error: null };
        }
        return { data: null, error: new Error(`storage download failed: ${res.status}`) };
      } catch (e) {
        return { data: null, error: e instanceof Error ? e : new Error(String(e)) };
      }
    },
  };
}
