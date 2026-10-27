// Must be imported before anything that loads node:sqlite. Silences the one-time
// "SQLite is an experimental feature" notice; all other warnings pass through.
const original = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const type = typeof rest[0] === 'string' ? rest[0] : (rest[0] as { type?: string } | undefined)?.type;
  const text = typeof warning === 'string' ? warning : warning?.message;
  if (type === 'ExperimentalWarning' && /sqlite/i.test(text ?? '')) return;
  return (original as (...a: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;

export {};
