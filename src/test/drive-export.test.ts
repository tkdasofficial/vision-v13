import { afterEach, describe, expect, it, vi } from 'vitest';
import { persistExport } from '@/lib/drive-export';
import { fetchDownload } from '@/lib/download';
afterEach(() => vi.unstubAllGlobals());
describe('authenticated browser export', () => {
  it('saves through the app without making a Google call', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ file: { url:'/api/files?id=owned' } })); vi.stubGlobal('fetch',fetcher);
    expect(await persistExport(new Blob(['original'], { type:'text/plain' }), 'story.txt')).toBe('/api/files?id=owned');
    expect(fetcher).toHaveBeenCalledWith('/api/files',expect.objectContaining({ method:'POST', credentials:'include', body:expect.any(FormData) }));
    expect(fetcher.mock.calls[0][1].body.get('file').name).toBe('story.txt');
  });
  it('never returns a completed link after storage fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error:'Drive unavailable' }, { status:502 })));
    await expect(persistExport(new Blob(['x']), 'x.txt')).rejects.toThrow('Drive unavailable');
  });
  it('allows private HTML exports with an attachment disposition', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('<h1>File</h1>', { headers:{ 'Content-Type':'text/html', 'Content-Disposition':'attachment; filename="file.html"' } }));
    expect((await fetchDownload('/api/files?id=owned',fetcher)).size).toBe(13);
  });
});
