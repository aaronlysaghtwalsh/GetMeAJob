/** Minimal Server-Sent Events parser over a fetch body stream. */
export async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event = 'message';
  let dataLines: string[] = [];

  const flush = () => {
    const out = dataLines.length ? { event, data: dataLines.join('\n') } : null;
    event = 'message';
    dataLines = [];
    return out;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    if (done) buffer += decoder.decode();
    let idx: number;
    while ((idx = buffer.search(/\r?\n/)) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + (buffer[idx] === '\r' ? 2 : 1));
      if (line === '') {
        const ev = flush();
        if (ev) yield ev;
        continue;
      }
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      let val = colon < 0 ? '' : line.slice(colon + 1);
      if (val.startsWith(' ')) val = val.slice(1);
      if (field === 'event') event = val;
      else if (field === 'data') dataLines.push(val);
    }
    if (done) {
      if (buffer.length) {
        if (buffer.startsWith('data:')) dataLines.push(buffer.slice(5).trimStart());
        buffer = '';
      }
      const ev = flush();
      if (ev) yield ev;
      return;
    }
  }
}
