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
    ['given back (review gate): lacks + a', 'This estimate lacks a guarantee.', 'FLAG'],
    ['finding: lacks, phrase directly after', 'This tool lacks independently verified data for rural counties.', 'PASS'],
    ['given back (review gate): lack + a', 'These figures lack a guarantee of accuracy.', 'FLAG'],
    ["given back (review gate): ain't is not a cue", "Results ain't guaranteed.", 'FLAG'],
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
    ['given back (review gate): 49 characters back, phrase after "a"', 'We are not saying that any of these numbers come with a guarantee.', 'FLAG'],
    ['given back (review gate): 48 characters back, phrase after "a"', 'We do not want you to think that this is in any way a guarantee.', 'FLAG'],
    ['given back (review gate): 42 characters back, phrase after "a"', 'This estimate is not intended to be treated by anyone as a guarantee of savings.', 'FLAG'],
    ['finding: far back, phrase after "as"', 'This estimate is not intended to be treated by anyone as guaranteed savings.', 'PASS'],
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
    ['finding: about 300 characters back, phrase after "or"', `It is not ${'really '.repeat(40)}reviewed or independently verified.`, 'PASS'],
    ['documented: the long reach stops 500 characters back', `It is not ${'really '.repeat(100)}reviewed or independently verified.`, 'FLAG'],
    ['guard: a phrase after "a" does not get the long reach', 'We never stop working to make sure each estimate is backed by a proprietary dataset.', 'FLAG'],
  ]);
});

describe('F6: clause boundaries skip abbreviations, numbers and legal lists', () => {
  table([
    ['finding: U.S.', 'There is no U.S. government guarantee on this account.', 'PASS'],
    ['finding: 99.9%', 'We do not offer a 99.9% uptime guarantee.', 'PASS'],
    ['given back (review gate): a number right before the phrase blocks the reach', 'We do not have 1,000 fact-checked records.', 'FLAG'],
    ['finding: a number not right before the phrase', 'We do not track 1,000 accounts or a proprietary dataset.', 'PASS'],
    ['finding: legal list', 'We make no representations, warranties or guarantees of any kind.', 'PASS'],
    ['finding: negated list with an Oxford comma', 'We do not use guaranteed, verified, or proprietary datasets.', 'PASS'],
    ['given back (review gate): i.e. is a boundary', 'This figure is not final (i.e. guaranteed) until the lender signs.', 'FLAG'],
    ['given back (review gate): e.g. is a boundary', 'This is not a promise (e.g. a guaranteed rate) of any kind.', 'FLAG'],
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
    ['guard: a zero- compound before the phrase (the new zero cue must not hide it)', 'Zero-fee guaranteed transfers.', 'FLAG'],
    ['hit: nothing else compares', 'Nothing else compares to a guaranteed rate.', 'FLAG'],
    ['hit: legal list with a long head', 'We do not warrant that the service will be uninterrupted, error-free, or guaranteed to meet your needs.', 'PASS'],
    ['hit: subject negation heading a list', 'Nothing in this article constitutes a recommendation, offer, or guarantee of any kind.', 'PASS'],
    ['hit: list past the character window', 'We do not provide tax, legal, or accounting advice, or any guarantee of outcome.', 'PASS'],
    ['guard: imperative "Never" over a list', 'Never pay more for flights, hotels, or guaranteed rental cars.', 'FLAG'],
    ["guard: imperative \"Don't\" over a list", "Don't miss our deals on flights, hotels, or guaranteed rentals.", 'FLAG'],
    ['given back (review gate): an imperative never heads a list', 'Do not use guaranteed, verified, or proprietary datasets.', 'FLAG'],
    ['guard: nobody beats', 'Nobody beats our guaranteed prices.', 'FLAG'],
    ['guard: no one can beat (main verb after the modal)', 'No one can beat our guaranteed prices.', 'FLAG'],
    ['given back (review gate): zero reaches only a phrase right after it', 'There is zero chance of a guaranteed payout.', 'FLAG'],
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

// Second review (2026-10-10): sentences 0.2.1 reported that an earlier version
// of these fixes hid. Every one must stay reported (P1, P3), plus the Codex
// cases and the misses that are wrong in both builds.
describe('review: overclaims 0.2.1 reported must stay reported', () => {
  table([
    ['P1 lack + our', 'Our competitors lack our proprietary dataset.', 'FLAG'],
    ['P1 lack + the', 'Incumbents lack the independently verified benchmarks we publish every quarter.', 'FLAG'],
    ['P1 lack + a', 'Other apps lack a proprietary dataset like ours.', 'FLAG'],
    ['P1 lacking + a', 'Tired of lacking a guaranteed income in retirement?', 'FLAG'],
    ['P1 unable + second verb', 'Big banks are unable to match our guaranteed savings rate.', 'FLAG'],
    ['P1 unable + offer a', 'Rivals are unable to offer a guaranteed price-match.', 'FLAG'],
    ['P1 zero X guaranteed', 'Zero downtime guaranteed.', 'FLAG'],
    ['P1 zero fees guaranteed', 'Zero fees guaranteed.', 'FLAG'],
    ['P1 zero hidden fees guaranteed', 'Zero hidden fees guaranteed for life.', 'FLAG'],
    ['P1 zero wait guaranteed', 'Hate waiting? Zero wait guaranteed.', 'FLAG'],
    ['P1 zero commission guaranteed', 'Zero commission guaranteed on every trade.', 'FLAG'],
    ['P1 from zero to', 'Go from zero to independently verified SOC 2 compliance in six weeks.', 'FLAG'],
    ['P1 instead of + verb', 'Get paid today instead of waiting with guaranteed same-day deposits.', 'FLAG'],
    ['P1 rather than + our', 'Get answers rather than guesses with our guarantee.', 'FLAG'],
    ["P3 if it ain't", "If it ain't guaranteed we don't sell it.", 'FLAG'],
    ['P1 imperative list, "the" after or', "Don't wait, apply today or the guaranteed rate expires Friday.", 'FLAG'],
    ['P1 imperative list, short', "Don't wait, apply today or the guaranteed rate expires.", 'FLAG'],
    ['P1 imperative list, "a" after or', "Don't delay, enroll today or a guaranteed spot may go to someone else.", 'FLAG'],
    ['P1 reach past "when"', "Don't let market swings derail your retirement when you can lock in a guaranteed rate.", 'FLAG'],
    ['P1 reach past "thanks to"', 'Never worry about a missed payment again thanks to autopay backed by a guarantee.', 'FLAG'],
    ['P1 reach past "thanks to" (2)', 'No more manual reconciliation for your finance team thanks to matching powered by a proprietary dataset.', 'FLAG'],
    ['P1 reach past "because" to "been"', "You don't have to take our word for it because every number has been independently verified.", 'FLAG'],
    ['P1 reach past "because" to "an"', 'Nothing to install on your servers because everything runs on an independently verified platform.', 'FLAG'],
    ['P1 reach past "since"', 'No credit check needed since every applicant gets a guaranteed approval.', 'FLAG'],
    ['P1 reach past "because" to "a"', 'Investors no longer need to guess because our model runs on a proprietary database.', 'FLAG'],
    ['P1 reach past "with"', 'Never overpay for coverage again with a policy that comes with a guarantee.', 'FLAG'],
    ['P1 reach past "because" (filing)', 'Never miss a deadline because every filing comes with a guarantee.', 'FLAG'],
    ['P1 reach past "because" (spreadsheets)', 'No spreadsheets required because every number has been fact-checked.', 'FLAG'],
    ['P1 thousands comma right before the phrase', 'No fees on your first $5,000 guaranteed.', 'FLAG'],
    ['P1 U.S. then a digit', 'Not available outside the U.S. 100% accurate filings for every state.', 'FLAG'],
    ['P1 i.e. without a comma', 'No hidden fees i.e. guaranteed transparent pricing.', 'FLAG'],
    ['P1 e.g. without a comma', 'Not sold in stores e.g. guaranteed lowest price online.', 'FLAG'],
    ['Codex: U.S. then an opening quote', 'We are not in the U.S. “Guaranteed returns” is our slogan.', 'FLAG'],
    ['Codex: U.S. then an opening paren', 'We are not in the U.S. (Guaranteed returns are our slogan.)', 'FLAG'],
    ['Codex: legal list with a small window', 'We make no representations, warranties or guarantees of any kind.', 'PASS', { negationWindow: 10 }],
    ['guard: no-guarantee compound with the index', 'These are no-guarantee estimates.', 'PASS'],
    ['documented miss (both builds): contrast with "not"', 'Skip the guesswork, not the guarantee.', 'PASS'],
    ["documented miss (both builds): can't go wrong with", "You can't go wrong with a guaranteed rate.", 'PASS'],
    ["documented miss (both builds): don't settle for less than", "Don't settle for less than a guaranteed rate.", 'PASS'],
    ['documented miss (both builds): rhetorical question', "Who wouldn't want a guaranteed return on their savings?", 'PASS'],
    ['documented miss (both builds): cannot match our', 'Other tools cannot match our guaranteed rates.', 'PASS'],
    ['documented false fail (both builds): hard-wrapped line', 'Rates are not\nguaranteed and may change.', 'FLAG'],
    ['documented false fail (both builds): "no representation is made that"', 'No representation is made that the estimates shown are guaranteed.', 'FLAG'],
    ['documented false fail (both builds): "dont" without an apostrophe', 'We dont guarantee approval.', 'FLAG'],
  ]);
});

// The package has no @types/node; declare only the Node API this file uses.
declare const process: {
  cpuUsage(previous?: { user: number; system: number }): { user: number; system: number };
};

describe('review: cost stays near linear', () => {
  /** CPU milliseconds `run` takes. */
  function cpuMs(run: () => void): number {
    const start = process.cpuUsage();
    run();
    const used = process.cpuUsage(start);
    return (used.user + used.system) / 1000;
  }
  const scan = (text: string, options?: ValidateClaimsOptions) => () => {
    validateClaims([{ id: 'c', text, tier: 'modeled' }], options);
  };

  it('negationWindow Infinity on a long clause full of cues and matches', () => {
    expect(cpuMs(scan('zero '.repeat(2000) + 'x guaranteed '.repeat(770), { negationWindow: Infinity }))).toBeLessThan(3000);
    expect(cpuMs(scan('unable to help '.repeat(4000) + 'guaranteed', { negationWindow: Infinity }))).toBeLessThan(3000);
  });

  it('a 320 KB clause with "any" before every match, default options', () => {
    expect(cpuMs(scan('We are not saying ' + 'any guarantee '.repeat(22_857)))).toBeLessThan(3000);
  });
});

// Final Codex pass on 87dbc19 (three sentences 0.2.1 reported that it hid) and
// a targeted sweep combining the narrowed rules with subordinate clauses,
// quotes after abbreviations and hyphenated idioms.
describe('review: final Codex cases and sweep', () => {
  table([
    ['Codex: list head ends at "because"', 'No setup required because each plan includes support, updates, or guaranteed returns.', 'FLAG'],
    ['Codex: closing quote after U.S.', '“Not available in the U.S.” Guaranteed returns elsewhere.', 'FLAG'],
    ['Codex: hyphenated "not just"', 'Not-just guaranteed returns.', 'FLAG'],
    ['Codex: hyphenated "without question"', 'Without-question guaranteed returns.', 'FLAG'],
    ['Codex: hyphenated "far from" negates', 'These results are far-from-guaranteed.', 'PASS'],
    ['sweep: list head ends at "since"', 'No paperwork needed since every plan includes coverage, support, or a guarantee.', 'FLAG'],
    ['sweep: list head ends at "when"', 'Nothing to configure when each tier ships with backups, monitoring, or guaranteed uptime.', 'FLAG'],
    ['sweep: list head ends at "which"', 'No contracts required, which means every plan comes with support, updates, or guaranteed savings.', 'FLAG'],
    ['sweep: list head ends at "while"', 'No signup fees while every member gets rewards, perks, or guaranteed cashback.', 'FLAG'],
    ['sweep: list head ends at "thanks to"', 'Zero hassle thanks to plans with alerts, reports, or guaranteed refunds.', 'FLAG'],
    ['sweep: list head ends at "so"', 'We never upsell, so every plan includes onboarding, training, or a guarantee.', 'FLAG'],
    ['sweep: list head ends at "if"', 'No credit card needed if you pick monthly, annual, or guaranteed-rate billing.', 'FLAG'],
    ['sweep: list head ends at "with"', 'No lock-in with plans that include support, updates, or guaranteed pricing.', 'FLAG'],
    ['sweep: subject cue never heads a list', 'Nobody else has plans that include support, updates, or guaranteed pricing.', 'FLAG'],
    ['sweep: imperative with a "that" clause', 'Never miss a plan that includes support, updates, or guaranteed pricing.', 'FLAG'],
    ['sweep: closing quote after E.U.', '“Not sold in the E.U.” Fact-checked figures for every other market.', 'FLAG'],
    ['sweep: closing paren after U.S.', '(Not offered in the U.S.) Guaranteed approval for everyone else.', 'FLAG'],
    ['sweep: stray closing paren after U.K.', 'Not offered in the U.K.) Independently verified results everywhere else.', 'FLAG'],
    ['sweep: hyphenated "not only"', 'Not-only guaranteed returns but insured ones.', 'FLAG'],
    ['sweep: hyphenated "not merely"', 'Not-merely fact-checked figures.', 'FLAG'],
    ['sweep: hyphenated "without a doubt"', 'Without-a-doubt guaranteed returns.', 'FLAG'],
    ["sweep: hyphenated \"there's no denying\"", "There's-no-denying our numbers are independently verified.", 'FLAG'],
    ['sweep: hyphenated "not to mention"', 'Not-to-mention guaranteed returns on every plan.', 'FLAG'],
    ['sweep: "not just" then U.S. then a new sentence', 'Not just in the U.S. Guaranteed approval worldwide.', 'FLAG'],
    ['sweep: hyphenated "rather than" with a gap word', 'Rather-than-estimated guaranteed quotes.', 'FLAG'],
    ['sweep: hyphenated "nothing else compares"', 'Nothing-else-compares guaranteed rates.', 'FLAG'],
    ['sweep guard: "that" after "warrant" keeps the list negated', 'We do not warrant that the service will be uninterrupted, error-free, or guaranteed.', 'PASS'],
    ['sweep guard: "far-from" then a space', 'Rates are far-from guaranteed.', 'PASS'],
    ['sweep guard: hyphenated "no other" right before the phrase', 'No-other guarantee applies.', 'PASS'],
  ]);
});
