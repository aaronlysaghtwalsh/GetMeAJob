import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractNumbers, normalizeDate, orgSimilarity, unsupportedNumbers, verifyQuote, wordCount } from '../../src/shared/text';

// Fictional sample (same fictional company as tests/fixtures/persona.ts).
const doc = `LAKESHORE RETAIL GROUP — Data Analytics Intern
Milwaukee, WI | Jun 2025 – Aug 2025
• Analysed ~250,000 rows of inventory and sales data using Python and SQL to identify slow-moving stock.
• Built Tableau dashboards used by regional managers in weekly trading meet-
ings.`;

test('verifyQuote: exact and typography-insensitive matches', () => {
  assert.equal(verifyQuote('Built Tableau dashboards used by regional managers', doc).verified, true);
  assert.equal(verifyQuote('LAKESHORE RETAIL GROUP - Data Analytics Intern', doc).verified, true, 'em dash vs hyphen');
  assert.equal(verifyQuote('Analysed ~250,000 rows of inventory and sales data', doc).verified, true);
  assert.equal(verifyQuote('weekly trading meetings', doc).verified, true, 'de-hyphenated line break');
});

test('verifyQuote: tolerates a dropped word but rejects fabrications', () => {
  assert.equal(verifyQuote('Analysed ~250,000 rows of inventory and sales data using Python to identify slow-moving stock', doc).verified, true);
  assert.equal(verifyQuote('Led a team of 12 analysts to build forecasting models', doc).verified, false);
  assert.equal(verifyQuote('Analysed 2,500,000 rows of inventory data', doc).verified, false);
});

test('extractNumbers handles separators, suffixes, percents and words', () => {
  const vals = (s: string) => extractNumbers(s).map((n) => `${n.value}${n.percent ? '%' : ''}`);
  assert.deepEqual(vals('Analysed 250,000 rows'), ['250000']);
  assert.deepEqual(vals('Represented the brand at 60+ campus events'), ['60']);
  assert.deepEqual(vals('grew revenue 20% to $1.2M'), ['20%', '1200000']);
  assert.deepEqual(vals('250k records'), ['250000']);
  assert.deepEqual(vals('supervised a team of fifteen'), ['15']);
  assert.deepEqual(vals('Used AWS S3 and Web3 tooling in Q4'), []);
});

test('unsupportedNumbers flags invented metrics', () => {
  const support = ['Analysed ~250,000 rows of inventory and sales data', 'Brand ambassador, represented the brand at 60+ campus events'];
  assert.deepEqual(unsupportedNumbers('Analysed 250K rows of sales data', support), []);
  assert.deepEqual(
    unsupportedNumbers('Analysed 250,000 rows, cutting reporting time by 40%', support).map((n) => n.raw),
    ['40%'],
  );
  assert.deepEqual(unsupportedNumbers('Represented the brand at over sixty events', support), []);
});

test('normalizeDate', () => {
  assert.equal(normalizeDate('June 2023'), '2023-06');
  assert.equal(normalizeDate('Sept 2021'), '2021-09');
  assert.equal(normalizeDate('06/2023'), '2023-06');
  assert.equal(normalizeDate('2023-6'), '2023-06');
  assert.equal(normalizeDate('Summer 2022'), '2022');
  assert.equal(normalizeDate('Present'), '');
});

test('orgSimilarity and wordCount', () => {
  assert.ok(orgSimilarity('Fizzwell Beverages', 'Fizzwell') >= 1);
  assert.ok(orgSimilarity('Lakeshore Retail Group Ltd', 'The Lakeshore Retail Group') >= 1);
  assert.ok(orgSimilarity('Fizzwell', 'Northwind Analytics') === 0);
  assert.equal(wordCount('  one two  three '), 3);
});
