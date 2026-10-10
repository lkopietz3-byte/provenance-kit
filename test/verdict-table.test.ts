// Verdict regression table for the 2026-10-10 hunt findings.
//
// One named case per confirmed finding, asserting the CORRECT verdict, plus
// guard cases on both sides: honest copy that must stay clean, and real
// overclaims that must stay flagged. Every leniency added for a finding (a new
// negation cue, a list comma that no longer ends a negation) has at least one
// guard where the cue appears but the claim is still an overclaim.
//
// Verdicts are judged on a `modeled` claim with the default phrase list unless
// a case says otherwise. PASS means no certainty-phrase offense; FLAG means at
// least one.

import { describe, expect, it } from 'vitest';
import {
  methodologyPageOutline,
  provenanceBadgeText,
  validateClaims,
  type ValidateClaimsOptions,
} from '../src/index.js';
import { FULL_DEFINITIONS, flaggedPhrases } from './helpers.js';

type Verdict = 'PASS' | 'FLAG';
type Row = readonly [name: string, text: string, expected: Verdict, options?: ValidateClaimsOptions];

/** One named test per row. */
function table(rows: readonly Row[]): void {
  for (const [name, text, expected, options] of rows) {
    it(name, () => {
      const flagged = flaggedPhrases(text, options);
      if (expected === 'PASS') expect(flagged).toEqual([]);
      else expect(flagged).not.toEqual([]);
    });
  }
}

describe('F1: "no one" and "nobody" negate a phrase they are the subject of', () => {
  table([
    ['finding: no one can guarantee', 'No one can guarantee future results.', 'PASS'],
    ['finding: nobody can guarantee', 'Nobody can guarantee the weather.', 'PASS'],
    ['finding: nobody + phrase as the verb', 'Nobody guaranteed anything.', 'PASS'],
    ['finding: no one has + phrase', 'No one has independently verified these figures.', 'PASS'],
    ['finding: no-one (hyphenated)', 'No-one can guarantee a refund.', 'PASS'],
    ['guard: no one disputes (asserts what follows)', 'No one disputes this independently verified figure.', 'FLAG'],
    ['guard: no one else offers', 'No one else gives you independently verified data.', 'FLAG'],
    ['guard: nobody else', 'Nobody else offers a proprietary dataset like ours.', 'FLAG'],
  ]);
});

describe('F2: missing negation cues', () => {
  table([
    ['finding: unable', 'We are unable to guarantee delivery dates.', 'PASS'],
    ["finding: unable (we're)", "We're unable to guarantee a refund.", 'PASS'],
    ['finding: non- hyphen', 'Non-guaranteed elements may change.', 'PASS'],
    ['finding: non- before a two-word phrase', 'A non-proprietary dataset from public filings.', 'PASS'],
    ['finding: non- before "verified dataset"', 'This is a non-verified dataset.', 'PASS'],
    ['finding: non with a space', 'The non guaranteed portion of the rate.', 'PASS'],
    ['finding: zero', 'Zero guarantees apply.', 'PASS'],
    ['finding: lacks', 'This estimate lacks a guarantee.', 'PASS'],
    ['finding: lack', 'These figures lack a guarantee of accuracy.', 'PASS'],
    ["finding: ain't", "Results ain't guaranteed.", 'PASS'],
    ["finding: mustn't", "Results mustn't be treated as guaranteed.", 'PASS'],
    ["finding: needn't", "You needn't treat this as guaranteed.", 'PASS'],
    ['finding: instead of', 'Instead of a guaranteed result, you get an estimate.', 'PASS'],
    ['finding: rather than', 'Treat it as an estimate rather than a guarantee.', 'PASS'],
    ['finding: rather than (adjective)', 'Rather than guaranteed, these figures are estimated.', 'PASS'],
    ['guard: without still negates', 'Provided without any guarantee.', 'PASS'],
    ['guard: cannot still negates', 'We cannot guarantee it.', 'PASS'],
    ['guard: unable, phrase far from the cue', 'Rivals are unable to match the depth of our independently verified data.', 'FLAG'],
    ['guard: non- on another word', 'Non-stop guaranteed support.', 'FLAG'],
    ['guard: un- on another word', 'Un-matched guaranteed rates.', 'FLAG'],
    ['guard: zero, phrase far from the cue', 'Zero guesswork thanks to our independently verified data.', 'FLAG'],
    ['guard: lack, phrase far from the cue', 'Rivals lack the decade of research behind our independently verified rates.', 'FLAG'],
    ['guard: instead of, phrase far from the cue', 'Instead of guessing we give you independently verified data.', 'FLAG'],
    ['guard: rather than, phrase far from the cue', 'Rather than estimating we rely on a proprietary dataset.', 'FLAG'],
    ["guard: ain't before but", "It ain't a guess but a verified dataset.", 'FLAG'],
    ["guard: mustn't before a comma", "You mustn't miss out, our rates are guaranteed.", 'FLAG'],
    ["guard: needn't before and", "You needn't guess and our data is fact-checked.", 'FLAG'],
    ['guard: unrelated words ending in n are not cues', 'Our modern, independently verified data.', 'FLAG'],
  ]);
});

describe('F3: phrases are trimmed; a blank phrase matches nothing', () => {
  table([
    ['finding: trailing LF', 'Returns are guaranteed', 'FLAG', { certaintyPhrases: ['guaranteed\n'] }],
    ['finding: trailing CR', 'Returns are guaranteed', 'FLAG', { certaintyPhrases: ['guaranteed\r'] }],
    ['finding: trailing CRLF', 'Returns are guaranteed', 'FLAG', { certaintyPhrases: ['guaranteed\r\n'] }],
    ['finding: trailing space', 'Returns are guaranteed', 'FLAG', { certaintyPhrases: ['guaranteed '] }],
    ['finding: leading space at start of text', 'Guaranteed returns', 'FLAG', { certaintyPhrases: [' guaranteed'] }],
    ['finding: rule object with CR', 'Returns are guaranteed', 'FLAG', { certaintyPhrases: [{ phrase: '\tguaranteed\r' }] }],
    ['finding: phrase of one space flags nothing', 'A plain sentence.', 'PASS', { certaintyPhrases: [' '] }],
    ['finding: phrase of CRLF flags nothing', 'A plain\r\nsentence.', 'PASS', { certaintyPhrases: ['\r\n'] }],
    ['guard: trimmed phrase keeps its word boundary', 'Returns are unguaranteed', 'PASS', { certaintyPhrases: [' guaranteed '] }],
  ]);
});

describe('F4: idioms that contain a negation word but assert what follows', () => {
  table([
    ['finding: nothing beats', 'Nothing beats our independently verified data.', 'FLAG'],
    ['finding: nothing compares', 'Nothing compares to our guaranteed rates.', 'FLAG'],
    ['finding: no other X gives', 'No other tool gives you fact-checked numbers.', 'FLAG'],
    ['finding: without a doubt', 'Without a doubt our figures are independently verified.', 'FLAG'],
    ['finding: without doubt', 'Without doubt our figures are independently verified.', 'FLAG'],
    ['finding: there is no denying', 'There is no denying our figures are independently verified.', 'FLAG'],
    ["finding: there's no denying", "There's no denying it is fact-checked.", 'FLAG'],
    ['finding: no-risk compound', 'No-risk guaranteed trial.', 'FLAG'],
    ['finding: no-fee compound', 'No-fee guaranteed approval.', 'FLAG'],
    ['finding: why not', 'Why not try a guaranteed plan?', 'FLAG'],
    ['finding: not to mention', 'Not to mention our guaranteed rates.', 'FLAG'],
    ['finding: not once has', 'Not once has our independently verified data been wrong.', 'FLAG'],
    ['guard: no other + phrase directly', 'No other guarantee applies.', 'PASS'],
    ['guard: no guarantee', 'There is no guarantee these numbers hold.', 'PASS'],
    ['guard: not guaranteed', 'Not guaranteed.', 'PASS'],
    ['guard: no-guarantee compound', 'These are no-guarantee estimates.', 'PASS'],
    ['guard: without a guarantee', 'Provided without a guarantee of accuracy.', 'PASS'],
    ['guard: why (not "why not")', 'Here is why we do not offer a guarantee.', 'PASS'],
    ['guard: nothing here is', 'Nothing here is guaranteed.', 'PASS'],
    ['guard: real negation after an idiom', 'Without a doubt, this is not a proprietary dataset.', 'PASS'],
  ]);
});

describe('F5: a long disclaimer in one clause', () => {
  table([
    ['finding: 49 characters back', 'We are not saying that any of these numbers come with a guarantee.', 'PASS'],
    ['finding: 48 characters back', 'We do not want you to think that this is in any way a guarantee.', 'PASS'],
    ['finding: 42 characters back', 'This estimate is not intended to be treated by anyone as a guarantee of savings.', 'PASS'],
    ['guard: a negation far back on another verb', 'No credit card required to start your free trial of our independently verified rate tracker.', 'FLAG'],
    ['guard: a subordinate clause after "when"', "Don't settle for guesswork when you can get independently verified data.", 'FLAG'],
    ['documented false fail: "in any way guaranteed", 70 characters back', 'Not a single one of the figures in this whole table is in any way guaranteed.', 'FLAG'],
    ['finding: phrase after "or", far back', 'These projections have not been reviewed by any outside firm or independently verified.', 'PASS'],
    ['finding: phrase after "been", far back', 'None of the figures shown on this comparison page have been fact-checked by the providers.', 'PASS'],
    ['guard: "is" does not get the long reach', 'No hidden fees will ever appear on your bill because every quote is guaranteed.', 'FLAG'],
    ['guard: "the" does not get the long reach', "We don't charge you anything extra to see the guaranteed total for your trip.", 'FLAG'],
    ['guard: the long reach stops at a comma', 'We do not sell your data to anyone, and every figure is a guaranteed estimate.', 'FLAG'],
    ['guard: the long reach stops at "but"', 'This is not something we take lightly in any way but a verified dataset.', 'FLAG'],
    ['guard: window of 0 still turns negation off', 'This is not a proprietary dataset.', 'FLAG', { negationWindow: 0 }],
    ['guard: window of 0 turns the long reach off too', `We are not saying that any of these numbers come with a guarantee.`, 'FLAG', { negationWindow: 0 }],
    ['finding: about 300 characters back, phrase after "a"', `It is not ${'really '.repeat(40)}a proprietary dataset.`, 'PASS'],
    ['documented: the long reach stops 500 characters back', `It is not ${'really '.repeat(100)}a proprietary dataset.`, 'FLAG'],
    ['documented miss (new, cost of the long reach): phrase after "a" with an unrelated negation far back', 'We never stop working to make sure each estimate is backed by a proprietary dataset.', 'PASS'],
  ]);
});

describe('F6: clause boundaries skip abbreviations, numbers and legal lists', () => {
  table([
    ['finding: U.S.', 'There is no U.S. government guarantee on this account.', 'PASS'],
    ['finding: 99.9%', 'We do not offer a 99.9% uptime guarantee.', 'PASS'],
    ['finding: 1,000', 'We do not have 1,000 fact-checked records.', 'PASS'],
    ['finding: legal list', 'We make no representations, warranties or guarantees of any kind.', 'PASS'],
    ['finding: negated list with an Oxford comma', 'We do not use guaranteed, verified, or proprietary datasets.', 'PASS'],
    ['finding: i.e.', 'This figure is not final (i.e. guaranteed) until the lender signs.', 'PASS'],
    ['finding: e.g.', 'This is not a promise (e.g. a guaranteed rate) of any kind.', 'PASS'],
    ['finding: Dr.', 'This is not reviewed by Dr. Patel or guaranteed by any lender.', 'PASS'],
    ['finding: etc. mid-sentence', 'We offer no refunds, credits, etc. or guaranteed payouts.', 'PASS'],
    ['guard: U.S. then a new sentence', 'We are not in the U.S. Our data is independently verified.', 'FLAG'],
    ['guard: etc. then a new sentence', 'We do not sell ads, data, etc. Our numbers are fact-checked.', 'FLAG'],
    ['guard: comma clause (PVK-F-003)', 'These are not guesses, they are independently verified.', 'FLAG'],
    ['guard: period before a decimal', 'Not cheap. 99.9% guaranteed uptime.', 'FLAG'],
    ['guard: list tail with a verb after "or"', 'No setup fees, cancel anytime, or get your money back guaranteed.', 'FLAG'],
    ['guard: imperative after the comma', "Don't wait, act now or lose your guaranteed rate.", 'FLAG'],
    ['guard: list joined by "and"', 'No fees, no contracts and guaranteed returns.', 'FLAG'],
    ['guard: long list item', 'Not a guess, but the result of years of work, or a proprietary dataset.', 'FLAG'],
  ]);
});

describe('F7: Cyrillic and Greek look-alikes inside Latin words', () => {
  table([
    ['finding: Cyrillic a', 'Returns are gu\u0430ranteed.', 'FLAG'],
    ['finding: Cyrillic er', 'Inde\u0440endently verified.', 'FLAG'],
    ['finding: Cyrillic ie, twice', 'Indep\u0435ndently v\u0435rified.', 'FLAG'],
    ['finding: Greek omicron', 'A pr\u03bfprietary dataset.', 'FLAG'],
    ['finding: Cyrillic capital', '\u0421onfirmed by the lender.', 'FLAG'],
    ['guard: a fully Cyrillic word is not folded', '\u0441\u043e\u0440', 'PASS', { certaintyPhrases: ['cop'] }],
    ['guard: a Cyrillic phrase still matches Cyrillic text', '\u0414\u043e\u0445\u043e\u0434 \u0433\u0430\u0440\u0430\u043d\u0442\u0438\u0440\u043e\u0432\u0430\u043d.', 'FLAG', { certaintyPhrases: ['\u0433\u0430\u0440\u0430\u043d\u0442\u0438\u0440'] }],
    ['guard: negated look-alike stays negated', 'Not gu\u0430ranteed.', 'PASS'],
  ]);
});

describe('F8: unknown option keys throw', () => {
  const claims = [{ id: 'c', text: 'Results are guaranteed.', tier: 'modeled' as const }];
  const run = (options: unknown) => () => validateClaims(claims, options as ValidateClaimsOptions);

  it.each([
    ['certaintyPhrase', { certaintyPhrase: ['clinically proven'] }],
    ['negationwindow', { negationwindow: 0 }],
    ['casesensitive', { casesensitive: true }],
    ['phrases', { phrases: ['x'] }],
  ])('finding: validateClaims rejects %s', (key, options) => {
    expect(run(options)).toThrow(TypeError);
    expect(run(options)).toThrow(new RegExp(`unknown option "${key}"`));
  });

  it('finding: provenanceBadgeText rejects a misspelled option', () => {
    expect(() =>
      provenanceBadgeText('verified', FULL_DEFINITIONS, { includeShortdescription: true } as never),
    ).toThrow(/provenanceBadgeText: unknown option "includeShortdescription"/);
  });

  it('finding: methodologyPageOutline rejects a misspelled option', () => {
    expect(() => methodologyPageOutline(FULL_DEFINITIONS, { producName: 'Acme' } as never)).toThrow(
      /methodologyPageOutline: unknown option "producName"/,
    );
  });

  it('guard: every known key, including undefined values, is accepted', () => {
    expect(
      run({
        certaintyPhrases: undefined,
        certaintyRequiresTier: undefined,
        requireSourceRefForTiers: undefined,
        caseSensitive: undefined,
        negationWindow: undefined,
      }),
    ).not.toThrow();
  });

  it('guard: symbol keys and non-enumerable keys are ignored', () => {
    const options: Record<PropertyKey, unknown> = { [Symbol('tag')]: true };
    Object.defineProperty(options, 'hidden', { value: 1, enumerable: false });
    expect(run(options)).not.toThrow();
  });

  it('finding: the error escapes a hostile key', () => {
    expect(run({ 'bad\u202ekey': 1 })).toThrow(/unknown option "bad\\u202ekey"/);
  });
});

describe('F9: a visibly blank title, intro or product name throws', () => {
  it.each([
    ['title', { title: '   ' }],
    ['intro', { intro: '\u200b' }],
    ['productName', { productName: '\t' }],
  ])('finding: %s', (field, options) => {
    expect(() => methodologyPageOutline(FULL_DEFINITIONS, options)).toThrow(RangeError);
    expect(() => methodologyPageOutline(FULL_DEFINITIONS, options)).toThrow(new RegExp(`options\\.${field} is blank`));
  });

  it('guard: a real title still renders', () => {
    expect(methodologyPageOutline(FULL_DEFINITIONS, { title: 'T' }).startsWith('# T\n')).toBe(true);
  });
});

describe('F10: default phrase list coverage (judgment call, see README)', () => {
  table([
    ['documented: "100 percent accurate" is not a default phrase', 'Our estimates are 100 percent accurate.', 'PASS'],
    ['guard: a caller can add "100 percent accurate"', 'Our estimates are 100 percent accurate.', 'FLAG', { certaintyPhrases: ['100 percent accurate'] }],
    ['guard: the added phrase is still negation-aware', 'Our estimates are not 100 percent accurate.', 'PASS', { certaintyPhrases: ['100 percent accurate'] }],
    ['guard: "verify your email" is not flagged', 'Please verify your email to see estimates.', 'PASS'],
    ['guard: "provenance" is not flagged (why "proven" is not a default)', 'Provenance tier: modeled.', 'PASS'],
    ['documented: plain "verified" is not a default phrase', 'Every figure here is verified.', 'PASS'],
    ['documented: plain "audited" is not a default phrase', 'Independently audited numbers.', 'PASS'],
    ['documented: markup can split a phrase', '<b>guarant</b>eed returns', 'PASS'],
    ['documented: negation words are English only', 'Nicht garantiert.', 'FLAG', { certaintyPhrases: ['garantiert'] }],
  ]);
});

describe('self-hunt: fresh probes from marketing, help-center, legal and pricing copy', () => {
  table([
    ['hit: a zero- compound before the phrase', 'Zero-fee guaranteed transfers.', 'FLAG'],
    ['hit: nothing else compares', 'Nothing else compares to a guaranteed rate.', 'FLAG'],
    ['hit: legal list with a long head', 'We do not warrant that the service will be uninterrupted, error-free, or guaranteed to meet your needs.', 'PASS'],
    ['hit: subject negation heading a list', 'Nothing in this article constitutes a recommendation, offer, or guarantee of any kind.', 'PASS'],
    ['hit: list past the character window', 'We do not provide tax, legal, or accounting advice, or any guarantee of outcome.', 'PASS'],
    ['guard: imperative "Never" over a list', 'Never pay more for flights, hotels, or guaranteed rental cars.', 'FLAG'],
    ["guard: imperative \"Don't\" over a list", "Don't miss our deals on flights, hotels, or guaranteed rentals.", 'FLAG'],
    ['hit: short imperative list stays negated', 'Do not use guaranteed, verified, or proprietary datasets.', 'PASS'],
    ['guard: nobody beats', 'Nobody beats our guaranteed prices.', 'FLAG'],
    ['guard: no one can beat (main verb after the modal)', 'No one can beat our guaranteed prices.', 'FLAG'],
    ['hit: zero, phrase three words on', 'There is zero chance of a guaranteed payout.', 'PASS'],
    ['guard: Inc. then a new sentence', 'Acme Inc. Our returns are guaranteed.', 'FLAG'],
    ['guard: Inc. mid-sentence', 'Acme Inc. does not offer guaranteed returns.', 'PASS'],
    ['hit: U.S. mid-sentence, phrase after "or"', 'Certain U.S. states do not allow the exclusion of implied warranties or guarantees.', 'PASS'],
    ['guard: price with a decimal, then a new sentence', 'Starts at $9.99/mo. No guaranteed uptime on the Free plan.', 'PASS'],
    ['hit: affiliation disclaimer list', 'This app is not affiliated with, endorsed by, or guaranteed by any airline.', 'PASS'],
    ['hit: no-questions-asked compound', 'No-questions-asked guaranteed refunds.', 'FLAG'],
    ['documented miss: "no more X with" asserts what follows', 'No more guesswork with guaranteed fares.', 'PASS'],
    ['documented false fail: adjectives split by a comma without "or"', 'This is not a fact-checked, independently-verified dataset.', 'FLAG'],
  ]);
});
