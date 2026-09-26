// Boundary and error-path coverage: wrong types at the API edge should
// raise a clear, on-brand error rather than a native "Cannot read
// properties of undefined" — and a sourceRef that is present but empty of
// content should not satisfy "must cite a source."

import { describe, expect, it } from 'vitest';
import { validateClaims, type Claim, type ClaimsInput } from '../src/index.js';

/** A value arriving at runtime past the ClaimsInput type (e.g. from bad JSON). */
function asRuntimeInput(value: unknown): ClaimsInput {
  return value as ClaimsInput;
}

describe('validateClaims rejects malformed input with a clear message', () => {
  it('throws a descriptive error for null input', () => {
    expect(() => validateClaims(asRuntimeInput(null))).toThrow(/expected a Claim\[\]/);
  });

  it('throws a descriptive error for undefined input', () => {
    expect(() => validateClaims(asRuntimeInput(undefined))).toThrow(/expected a Claim\[\]/);
  });

  it('throws a descriptive error for a non-object input (string)', () => {
    expect(() => validateClaims(asRuntimeInput('oops'))).toThrow(/expected a Claim\[\]/);
  });

  it('throws a descriptive error when extractClaims does not return an array', () => {
    expect(() =>
      validateClaims({
        text: 'anything',
        extractClaims: () => asRuntimeInput('not an array') as unknown as Claim[],
      }),
    ).toThrow(/must return an array/);
  });

  it('an empty claims array is valid input and yields no offenses', () => {
    expect(validateClaims([])).toEqual([]);
  });
});

describe('a whitespace-only sourceRef does not count as a citation', () => {
  it('flags missing_source_ref for a sourceRef that is only spaces', () => {
    const claims: Claim[] = [
      { id: 'a', text: 'The ship carries 3,600 passengers.', tier: 'verified', sourceRef: '   ' },
    ];
    const offenses = validateClaims(claims);
    expect(offenses).toHaveLength(1);
    expect(offenses[0]?.reason).toBe('missing_source_ref');
  });

  it('flags missing_source_ref for a sourceRef that is only a tab/newline', () => {
    const claims: Claim[] = [
      { id: 'a', text: 'The ship carries 3,600 passengers.', tier: 'verified', sourceRef: '\t\n' },
    ];
    expect(validateClaims(claims)).toHaveLength(1);
  });

  it('accepts a sourceRef with real content and incidental whitespace', () => {
    const claims: Claim[] = [
      {
        id: 'a',
        text: 'The ship carries 3,600 passengers.',
        tier: 'verified',
        sourceRef: '  https://operator.example/specs  ',
      },
    ];
    expect(validateClaims(claims)).toEqual([]);
  });
});
