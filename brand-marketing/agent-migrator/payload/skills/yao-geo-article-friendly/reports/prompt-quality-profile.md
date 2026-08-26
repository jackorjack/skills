# Prompt Quality Profile

## Need Model

- Explicit need: turn a reusable Chinese prompt for GEO article AI-friendliness into an executable agent skill.
- Implicit need: preserve the original prompt's weighted GEO logic while making the skill safer and less likely to fabricate evidence.
- Scenario: users provide an existing article and expect a rewritten article, score report, and change explanation.
- User level: GEO/content practitioner or operator.
- Success standard: the output is source-bound, publication-ready, scoreable, and clear about missing inputs.

## Task Family And Complexity

Task family: prompt-heavy execution operation with analytical diagnosis and writing transformation.

Complexity: complex. The skill must analyze input, preserve meaning, rewrite structure and prose, reason about evidence, score quality, and report changes.

## RTF To Skill Mapping

| Prompt Layer | Skill Layer |
| --- | --- |
| GEO content optimization expert role | Operating stance: source-bound GEO article optimizer |
| Three-stage task flow | Workflow: inventory, weighted diagnosis, transformation, validation |
| Output format templates | `references/geo-output-contract.md` |
| Redline controls | Evidence discipline and output-risk controls |

## Quality Matrix

| Dimension | Assessment |
| --- | --- |
| Completeness | Strong: includes role, workflow, weights, validation, examples, and output shape. |
| Clarity | Strong after skill conversion: key behavior is split between entrypoint and references. |
| Consistency | Medium-high: the original examples encouraged fabricated benchmark data; the skill resolves this by requiring source labels. |
| Practicality | Strong: users can paste text or provide a file path and receive a structured artifact. |
| Specificity | Strong: focused on GEO article transformation, not generic SEO writing. |

## Prompt Gate

Before delivering an optimized article, the agent should be able to answer:

- Which claims came from the original article?
- Which sources or data were externally verified?
- Which useful enhancements are only suggestions?
- Did the rewrite preserve the author's core conclusion?
- Did the score report justify the numeric changes?
