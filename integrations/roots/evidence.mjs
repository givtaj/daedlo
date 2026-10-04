// Customer-owned read-back predicate. A matching old note is not save evidence.
export function journalRecordMatches(entries, expected, responseId) {
  if (typeof responseId !== 'string' || !responseId) return false;
  const rows = entries.filter(x => x.id === responseId);
  return rows.length === 1 && rows[0].notes === expected.notes.trim()
    && rows[0].experienced_on === expected.date
    && rows[0].rating === expected.rating
    && (rows[0].strain?.id ?? '') === expected.strain;
}
