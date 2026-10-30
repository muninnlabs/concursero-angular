import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { redirectToCanonical } from '../src/canonical.ts';

describe('redirectToCanonical', () => {
  const to = (url: string) => redirectToCanonical(new URL(url), 'concursero.com');

  test('www and the old munninlabs.com path go to concursero.com, keeping path and query', () => {
    assert.equal(to('https://www.concursero.com/app/praticar?modo=mini'), 'https://concursero.com/app/praticar?modo=mini');
    assert.equal(to('https://munninlabs.com/concursero-angular/termos'), 'https://concursero.com/termos');
    assert.equal(to('https://munninlabs.com/concursero-angular'), 'https://concursero.com/');
  });

  test('the canonical host itself, and setups without one, are served', () => {
    assert.equal(to('https://concursero.com/app'), null);
    assert.equal(redirectToCanonical(new URL('https://staging.concursero.com/'), undefined), null);
  });
});
