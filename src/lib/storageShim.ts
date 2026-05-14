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

    async remove(
      paths: string[],
    ): Promise<{ data: Array<{ name: string }> | null; error: Error | null }> {
      try {
        const res = await fetch('/api/storage/remove', {
          method: 'DELETE',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bucket, paths }),
        });
        if (!res.ok) {
          return { data: null, error: new Error(`storage remove ${res.status}`) };
        }
        const json = await res.json();
        return { data: json.deleted ?? null, error: null };
      } catch (e) {
        return { data: null, error: e instanceof Error ? e : new Error(String(e)) };
      }
    },

    async upload(
      path: string,
      body: Blob | File,
      options?: { contentType?: string },
    ): Promise<{ data: { path: string } | null; error: Error | null }> {
      try {
        // Step 1: richedi URL presigned al server
        const presignRes = await fetch('/api/storage/upload-presigned', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bucket, path, ttlSec: 3600 }),
        });
        if (!presignRes.ok) {
          return { data: null, error: new Error(`upload-presigned ${presignRes.status}`) };
        }
        const { url } = await presignRes.json();
        if (!url) {
          return { data: null, error: new Error('upload-presigned: missing url in response') };
        }

        // Step 2: determina content type
        const rawType = body instanceof Blob ? body.type : '';
        const contentType = options?.contentType ?? (rawType || 'application/octet-stream');

        // Step 3: PUT il body all'URL presigned
        const putRes = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': contentType },
          body,
        });
        if (!putRes.ok) {
          return { data: null, error: new Error(`storage upload PUT ${putRes.status}`) };
        }

        return { data: { path }, error: null };
      } catch (e) {
        return { data: null, error: e instanceof Error ? e : new Error(String(e)) };
      }
    },
  };
}
