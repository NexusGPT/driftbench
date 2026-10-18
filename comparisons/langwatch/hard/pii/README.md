# PII hard comparison

This set measures presence of populated personal information, including a person's
name, a private home or delivery address, and contact or account identifiers.
It contains 120 synthetic cases: 60 positive and 60 negative, across 12 contrast
families. Each family has five positive and five negative cases. Formats rotate
through direct text, quoted archives, nested JSON, XML and an audit worksheet.

All personal names and residential addresses are invented. Email values use
`example.com`; phone values use the reserved North American `202-555-01xx` range;
IP values use the documentation block `192.0.2.0/24`. IBANs have generated valid
checksums, a fictional placeholder `ZZZZ` bank code and synthetic account numbers.
These fixtures are not records about actual people or accounts. The detection
oracle treats their populated personal values as PII; the benchmark does not test
whether an identifier is assigned to a real person.

## Oracle and family failures

Truth is fixed in `generate.mjs` before evaluation. Positive cases supply a
populated personal value in an explicit personal context. Negative cases supply
only organizations, brands, public places, policies, empty fields, symbolic
values or fully masked identifiers. A quotation, prohibition on disclosure or
different document format does not remove a disclosed value.

| Family | Positive | Negative | Failure tested |
| --- | --- | --- | --- |
| `person_brand` | Private person's full name | Brand and corporation names | Confusing organizations with a person |
| `home_public_place` | Resident's home delivery address | Public attraction names | Confusing public places with a private residence |
| `email_near_miss` | Complete private email | Incomplete symbolic placeholder | Mistaking an email label for a value |
| `phone_masking` | Complete personal phone | Fully masked telephone | Counting redaction syntax as disclosed digits |
| `ip_symbolic` | Subscriber's concrete IP | Symbolic `IP_ADDRESS` or `a.b.c.d` | Confusing tutorial symbols with a subscriber identifier |
| `iban_symbolic` | Checksum-valid fictional personal IBAN | Redacted value and field label | Missing a bank account or flagging its label |
| `quoted_person` | A quoted patient's full name | Quoted blank template | Treating quotation as removal of PII |
| `multilingual_home` | Home address in French, Spanish, German, Italian or mixed text | Public place in the matching language | Losing private-home semantics after a language switch |
| `json_email` | Email in nested JSON | Empty template structure | Ignoring populated values inside serialization |
| `buried_home` | Sparse home address inside inventory notes | Public plaza inside matching notes | Losing a sparse value inside unrelated context |
| `negated_person` | Name inside a request not to publish it | Confidentiality policy without a name | Treating a prohibition as absence of the disclosed name |
| `mixed_contact_context` | One contact value among empty fields | All fields empty | Missing a populated field or flagging labels alone |

Scoring metadata has `person`, `address` and `identifier` booleans. Positive
subgroups have 15 person-only, 15 home-address-only and 30 identifier-only cases.
`identifierType` distinguishes email, phone, IP and IBAN. Only `text` is passed
to either evaluator; IDs, labels, flags and rationale do not enter evaluation.

## Native LangWatch baseline and scope

`native.py` imports and instantiates the actual
`PresidioPIIDetectionEvaluator` from the caller's checkout. It requires revision
`e683dd9ea52c148e7678b1c22202dbfea9f1eb9f` and checks the evaluator file against
that commit. It does not substitute a regex or an LLM, replace analyzer behavior,
or enable additional entities. The upstream evaluator joins its entry text,
applies its own JSON handling, runs Presidio in English and filters its own
results at the default threshold `0.5`.

Source: [`pii_detection.py`](https://github.com/langwatch/langwatch/blob/e683dd9ea52c148e7678b1c22202dbfea9f1eb9f/services/langevals/evaluators/presidio/langevals_presidio/pii_detection.py).
The evaluator's source declares spaCy `3.7.5` and `en_core_web_lg` `3.7.1` in
[`pyproject.toml`](https://github.com/langwatch/langwatch/blob/e683dd9ea52c148e7678b1c22202dbfea9f1eb9f/services/langevals/evaluators/presidio/pyproject.toml).
The recorded run uses those exact versions and Presidio analyzer/anonymizer
`2.2.364`. `native-results.json` records all package versions needed to identify
the analyzer and wrapper, the settings, fixture hash, source hash and each result.

The default enabled entities are `CREDIT_CARD`, `CRYPTO`, `EMAIL_ADDRESS`,
`IBAN_CODE`, `IP_ADDRESS`, `PHONE_NUMBER` and `MEDICAL_LICENSE`. Every other
source entity flag is false, including `PERSON` and `LOCATION`. Thus private
names and addresses are deliberately outside the native default's configured
scope. Misses in those subgroups describe the shipped scope difference; they
do not establish the quality of enabled PERSON or LOCATION recognition.
This set does not measure the default credit card, crypto or medical license
recognizers, or every possible PII category. Full-set and subgroup scores must
be presented together.

## Recorded result

The measured native run processes all 120 cases and scores 88 correct: 28 true
positives, 60 true negatives, no false positives and 32 false negatives. The
person-only and home-only positive subgroups each score 0/15 under the disabled
default flags. Identifiers score 28/30: email 13/13, phone 5/7, IP 5/5 and
IBAN 5/5. The default-scope subset, identifiers plus all negative cases, scores
88/90. The two remaining misses are the phone positives in
`mixed_contact_context`, variants 02 and 04. Their native result contains no
accepted findings. The data and defaults remain unchanged after scoring.

## Reproduce

From the repository root:

```sh
node comparisons/langwatch/hard/pii/generate.mjs --check
node comparisons/langwatch/hard/pii/test.mjs
```

Install dependencies under this comparison directory. Set `PYTHON` to a Python
3.12 executable and `LANGWATCH_CHECKOUT` to the pinned source checkout:

```sh
PII_DIR="$PWD/comparisons/langwatch/hard/pii"
mkdir -p "$PII_DIR/.runtime/cache"
TMPDIR="$PII_DIR/.runtime/cache" UV_CACHE_DIR="$PII_DIR/.runtime/cache" \
  uv pip install --no-config --python "$PYTHON" \
  --target "$PII_DIR/.runtime/site-packages" \
  -r "$PII_DIR/requirements-native.txt"
PYTHONDONTWRITEBYTECODE=1 "$PYTHON" "$PII_DIR/test_native.py"
PYTHONDONTWRITEBYTECODE=1 "$PYTHON" "$PII_DIR/native.py" \
  --checkout "$LANGWATCH_CHECKOUT" \
  --output "$PII_DIR/native-results.json"
```

The large spaCy model is a wheel in `requirements-native.txt`. Its files and
installer caches stay in `.runtime/`, which is ignored by git. The adapter
requires that model package before native preload, avoiding the upstream
fallback that would create `.cache` inside the source checkout. Imported wrapper
temporary caches stay inside `.runtime/cache`; source bytecode writes are off.
The run makes no model API calls and spends zero model USD. An exception or a
non-Boolean native verdict is recorded and causes a nonzero process exit, so an
error cannot count as a successful negative result.

The JavaScript tests reject count loss, duplicate IDs, truth corruption,
unlisted families and missing subgroup flags. Python recorder tests verify
subgroup scoring and prove that a missing verdict is not scored as a negative.

## Fresh held-out measurement

`heldout.json` uses the same generator, family templates and construction oracle
with seed `20261013` and size `60`. The default invocation still reproduces the
original `hard.json` byte for byte. Seeded output cannot overwrite that file.
`heldout-provenance.json` records the seed and generator and dataset hashes.
The held-out set has 30 positives and 30 negatives; every family has both labels.
The first six families contain three pairs each; the other six contain two.
Its positive subgroups contain seven names, seven homes and 16 identifiers.

Seeded generation constructs new fictional names, residential streets, cities,
email local parts, phone digits and checksum-valid IBAN account digits. Fresh IPs
use the documentation block `198.51.100.0/24`. Phone fixtures remain within the
reserved `202-555-01xx` range and emails remain under `example.com`. The seed also
changes public place and company names, harmless archive material tags, neutral
inventory context and document layouts. This creates new content, not a shuffled
copy of the original cases. It preserves each family's meaning and construction
labels without looking at evaluator outputs.

The generator and tests verify identical output for the same seed, a different
output for a changed seed, no shared text with the original set, no original
personal fixture values, label balance and family coverage. Rejection tests
exercise duplicate text, duplicate IDs, a changed label, missing cases, an
unknown family and insertion of original text. Invalid seeds, odd sizes and
sizes too small to cover every family are rejected. The labels are fixed before
native evaluation and before the root worker's model measurements. Do not tune
the generator, labels or candidate procedure after reading held-out verdicts.

```sh
node comparisons/langwatch/hard/pii/generate.mjs \
  --seed 20261013 --n 60 --out heldout.json --check
node comparisons/langwatch/hard/pii/test.mjs
PYTHONDONTWRITEBYTECODE=1 "$PYTHON" "$PII_DIR/native.py" \
  --checkout "$LANGWATCH_CHECKOUT" \
  --cases "$PII_DIR/heldout.json" \
  --output "$PII_DIR/native-heldout-results.json"
```

The held-out native measurement uses the same pinned evaluator, unchanged
default settings and installed `en_core_web_lg` runtime as the original run.
`native-heldout-results.json` records all 60 outcomes, their fixture hash and
runtime evidence. The native run spends zero model USD. The root worker owns
the shipped and candidate model measurements; this adapter does not invoke them.

The single held-out native run processes 60/60 cases. It scores 45/60 on full PII
and 45/46 on the default-scope subset, with 15 true positives, 30 true negatives,
no false positives and 15 false negatives. The disabled name and home subgroups
each score 0/7. Identifiers score 15/16: email 6/6, phone 3/4, IP 3/3 and IBAN
3/3. The remaining identifier miss is phone variant 02 in
`mixed_contact_context`. No construction labels are ambiguous or changed after
that run. This is a fresh draw from the same synthetic families, not evidence
of performance on a different real-world distribution.
