# Reference Scan

## User Source

Source prompt: user-provided `GEO文章AI友好化改造提示词 v1.0` prompt.

Borrowed patterns:

- Three-stage flow: foundation analysis, weighted transformation, validation.
- Weighted GEO scoring model with 11 positive dimensions plus risk control, evidence and structure prioritized.
- Output requirement: optimized article, score report, change explanation, and supplement list.
- Redlines: preserve original meaning, avoid fabrication, avoid keyword stuffing.

Adjusted patterns:

- Example benchmark data and named sources from the prompt were not copied as factual defaults.
- Unsupported additions are now represented as `建议补充` instead of being written as facts.
- The long prompt body was moved into references so `SKILL.md` stays routeable.

## Local Fit

Compared nearby local packages:

- `yao-geo-compliance-auditor`: useful for interface style, evidence discipline, and report profiles.
- `yao-geo-tender-radar`: useful for `yao-geo-*` naming and local adapter metadata.

Not borrowed:

- XLSX scripts, rendering scripts, example deliverables, and production gates were not added because this first version is a scaffold and the workflow is primarily generative Markdown transformation.

## External Benchmark

No external benchmark was required for this scaffold because the user supplied the source prompt and target workflow. If the skill is promoted to Production, add trigger cases and compare against current public GEO/LLMO writing guidance.
