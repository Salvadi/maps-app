import { ApiResponseError } from './homeserver';

function storageHttpError(path: string, status: number, label: string): ApiResponseError {
  return new ApiResponseError(status, path, `${label} ${status}`);
}

function resolveBucketAndKey(defaultBucket: string, path: string): { bucket: string; key: string } {
  const cleanPath = path.replace(/^\/+/, '');
  const slashIdx = cleanPath.indexOf('/');
  if (slashIdx !== -1) {
    const prefix = cleanPath.slice(0, slashIdx);
    if (prefix === 'photos' || prefix === 'planimetrie') {
      return { bucket: prefix, key: cleanPath.slice(slashIdx + 1) };
    }
  }
  return { bucket: defaultBucket, key: cleanPath };
}

export function apiStorageFrom(bucket: string) {
  return {
    getPublicUrl(path: string): { data: { publicUrl: string } } {
      const location = resolveBucketAndKey(bucket, path);
      return { data: { publicUrl: `/api/storage/proxy/${location.bucket}/${location.key}` } };
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
        if (!res.ok) return { data: null, error: storageHttpError('/api/storage/sign-one', res.status, 'sign-one') };
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
              if (!res.ok) return { path, signedUrl: '', error: `sign-one ${res.status}`, status: res.status };
              const { signedUrl } = await res.json();
              if (!signedUrl) {
                return { path, signedUrl: '', error: 'sign-one: missing signedUrl in response' };
              }
              return { path, signedUrl, error: null };
            } catch (e) {
              const error = e instanceof Error ? e : new Error(String(e));
              return { path, signedUrl: '', error: error.message, status: 'status' in error && typeof error.status === 'number' ? error.status : undefined };
            }
          }),
        );
        const allFailed = results.every(r => r.error !== null);
        if (allFailed && paths.length > 0) {
          const first = results[0];
          return {
            data: null,
            error: typeof first.status === 'number'
              ? storageHttpError('/api/storage/sign-one', first.status, first.error ?? 'createSignedUrls')
              : new Error(first.error ?? 'createSignedUrls: all paths failed'),
          };
        }
        return { data: results.map(({ status: _status, ...item }) => item), error: null };
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
        // Step 1: richiedi URL presigned al server
        // Nota: il server si aspetta "key" (non "path") e "ttl" (non "ttlSec")
        const presignRes = await fetch('/api/storage/upload-presigned', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bucket, key: path, ttl: 3600 }),
        });
        if (!presignRes.ok) {
          return { data: null, error: new Error(`upload-presigned ${presignRes.status}`) };
        }
        const presignData = await presignRes.json();
        const { url, direct } = presignData;
        if (!url) {
          return { data: null, error: new Error('upload-presigned: missing url in response') };
        }

        // Step 2: determina content type
        const rawType = body instanceof Blob ? body.type : '';
        const contentType = options?.contentType ?? (rawType || 'application/octet-stream');

        if (direct === true) {
          // Step 3a: client Tailscale — PUT diretto all'URL presigned MinIO
          const putRes = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': contentType },
            body,
          });
          if (!putRes.ok) {
            return { data: null, error: new Error(`storage upload PUT ${putRes.status}`) };
          }
        } else {
          // Step 3b: client esterno — POST al proxy API con bucket/key come query params
          const proxyUrl = new URL(url, window.location.origin);
          proxyUrl.searchParams.set('bucket', bucket);
          proxyUrl.searchParams.set('key', path);
          const postRes = await fetch(proxyUrl.toString(), {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': contentType },
            body,
          });
          if (!postRes.ok) {
            return { data: null, error: new Error(`storage proxy-upload POST ${postRes.status}`) };
          }
        }

        return { data: { path }, error: null };
      } catch (e) {
        return { data: null, error: e instanceof Error ? e : new Error(String(e)) };
      }
    },
  };
}
