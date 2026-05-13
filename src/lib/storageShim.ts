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
  };
}
