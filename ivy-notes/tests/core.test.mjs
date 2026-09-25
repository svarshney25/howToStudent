import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE, demoReview, validateFlags, canResolve, highlightedParts } from '../dist/core.js';
test('demo flags quoted uncertainty and the sample misconception without changing notes', () => {
  const before = SAMPLE;
  const flags = demoReview(SAMPLE);
  assert.equal(flags.length, 3);
  assert.ok(flags.some(f => f.kind === 'misconception'));
  assert.ok(flags.every(f => SAMPLE.includes(f.quote)));
  assert.equal(SAMPLE, before);
});
test('demo does not claim to verify arbitrary notes without markers', () => assert.deepEqual(demoReview('Mitosis is a process.'), []));
test('repeated uncertainty markers produce one flag per distinct passage', () => assert.equal(demoReview('Why?\nWhy?').length, 1));
test('demo recognizes common confusion phrases and clarity checkpoints', () => {
  const flags = demoReview('idk how this works\nI don’t know why\nI am confused\nThis makes sense now');
  assert.equal(flags.length, 4);
  assert.equal(flags[3].kind, 'clarity');
  assert.ok(flags.every(flag => flag.quote.length > 0 && flag.hint.length > 0));
});
test('AI validation rejects fabricated quotes and citations', () => {
  const flag = demoReview('Why?')[0];
  assert.throws(() => validateFlags({ flags: [{ ...flag, quote: 'not present' }] }, 'Why?'));
  assert.throws(() => validateFlags({ flags: [{ ...flag, referenceQuote: 'made up source' }] }, 'Why?', 'actual material'));
  assert.throws(() => validateFlags({ flags: [{ ...flag, kind: 'answer' }] }, 'Why?'));
  assert.throws(() => validateFlags({ flags: [flag, flag] }, 'Why?'));
});
test('self-review needs a student revision and reflection', () => {
  const flag = demoReview('Why?')[0];
  assert.equal(canResolve(flag, 'Why?', 'Why?', 'A sufficiently long reflection.'), false);
  assert.equal(canResolve(flag, 'My revision', 'Why?', ''), false);
  assert.equal(canResolve(flag, 'My revision', 'Why?', 'Here is what I changed and why.'), true);
});
test('highlighting preserves every character including HTML and overlapping quotes', () => {
  const source = '<script>not executable</script> Why?';
  const parts = highlightedParts(source, [{ id: 'a', quote: 'Why?' }, { id: 'b', quote: 'Why' }]);
  assert.equal(parts.map(p => p.text).join(''), source);
  assert.equal(parts.filter(p => p.id).length, 1);
});
