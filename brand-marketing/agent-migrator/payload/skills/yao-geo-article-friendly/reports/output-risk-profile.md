# Output Risk Profile

## Main Risks

1. Fabricated evidence. GEO writing often tempts the model to add impressive reports, percentages, sample sizes, or expert quotes that were not in the source.
2. Meaning drift. Heavy restructuring can change the author's original emphasis or conclusion.
3. False completeness. A polished score report can hide missing sources or weak data口径.
4. Keyword stuffing. AI-search optimization can degrade readability when terms are repeated mechanically.
5. Unsupported FAQ expansion. FAQ answers may go beyond what the article can actually support.
6. Citation clutter. Too many source notes can interrupt the article and make it less useful to readers.

## Controls

- `SKILL.md` requires source labels: `原文支持`, `外部已核验`, and `建议补充`.
- The method forbids invented data, quotes, named reports, institutions, cases, and ranking guarantees.
- Unsupported improvements must appear in `需要用户补充或确认的内容`.
- The score report must include the basis for each dimension, not just numbers.
- FAQ is allowed only when the original article can answer the question or the answer is explicitly marked as a suggestion.
- Final verification checks original meaning, high-weight improvement, and natural readability.

## Reviewer Checks Before Delivery

- Spot-check the strongest claims in the optimized article against the original.
- Confirm all new data, sources, and quotes are either verified or marked as `建议补充`.
- Check that scoring improvements are plausible and not inflated.
- Confirm the output did not promise rankings, visibility guarantees, or AI-engine inclusion.
