# Real-world Bench Workflows

## Sample Source versus parent sample

Before registering a new physical root, create or select its external/provider origin under **Sample Sources**. For example, `STEMCELL` may represent STEMCELL Technologies. `sample_source_id` remains STEMCELL throughout processing. `parent_sample_id` separately records the immediate physical tube:

```text
Sample Source: STEMCELL
PBMC-000001 (parent: none)
  -> DNA-000001 (parent: PBMC-000001)
     -> DNA-000002 (parent: DNA-000001)
```

All three samples have the same Sample Source. The user selects it only while registering PBMC-000001; downstream creation inherits it automatically.

## STEMCELL COA registration

Configure the STEMCELL Sample Source with the **STEMCELL COA registration** profile. In **Sample Intake**, select STEMCELL as the provider/origin, upload the original COA, and take or upload the required photo of the tube/package. The browser extracts embedded PDF text first and uses local OCR only if critical fields are missing.

Compare every Extracted/Missing value with the displayed COA, correct fields as needed, and check the review confirmation. Only then does the application create the root sample and authoritative metadata. For the representative synthetic fixture, `1 x 10^8 cells` becomes 100 million cells while the raw string remains attached to source metadata. All later PBMC aliquots, DNA, and RNA retain STEMCELL provenance through `sample_source_id` and parent lineage without duplicating donor metadata.

## Scenario 1: PBMC aliquots plus DNA and RNA

Register `PBMC-000001` with 100 million cells. In one Process Sample plan add:

- Six PBMC outputs at 10M cells each: 60M source input.
- DNA extraction using 20M cells, expected 90 µL, maximum 50 µL/vial: two DNA labels.
- RNA extraction using 20M cells, with its expected/capacity values: the calculated number of RNA labels.

The allocation display shows 100M available, 100M allocated, and 0M expected remaining. An additional allocation is blocked in both browser validation and the locked database transaction. Generate one PDF containing all planned labels. Every output remains `PLANNED`.

For the DNA result, open Pending Processing and enter actual volume `92` and Qubit concentration `70`. The app calculates 6,440 ng = 6.44 µg and suggests `50 + 42` µL. `46 + 46` is also valid. Optionally enter raw NanoDrop A230/A260/A280, DIN (DNA) or RIN (RNA), and private integrity traces. Ratios are calculated and are guidance—not pass/fail gates. Both used planned DNA tubes inherit the homogeneous 70 ng/µL Qubit value and calculate their own mass after physical activation; their detail views say the pooled QC came from the extraction. Scan each label and explicitly activate its physical tube.

Extraction QC covers extracted DNA/RNA yield, purity, integrity score, and genomic DNA/RNA trace. Sequencing-library concentration and post-library-preparation fragment distributions are library QC and are intentionally outside this workflow, including for samples considered for ONT sequencing.

## Scenario 2: serum aliquots with unused labels

Register `SERUM-000001` with 10,000 µL (10 mL). Plan 20 serum outputs at 500 µL each. The app reserves 10,000 µL and generates 20 labels.

If only 18 tubes are made, scan and activate A01–A18 (the actual IDs will be independent `SERUM-NNNNNN` IDs). Each activation consumes 500 µL. Scan or manually enter the remaining two planned labels and choose **Mark not created**. Those records become `NOT_CREATED`, their reservations are released, and they never count as active inventory. The source retains the unconsumed 1,000 µL unless separately consumed/discarded later.

## Scenario 3: extraction exceeds planned capacity

An expected DNA yield of 90 µL with 50 µL maximum per vial reserves two labels (100 µL capacity). If the actual yield is 130 µL, result entry reports that one additional vial is required. Saving the validated distribution transactionally creates one additional planned DNA record. Generate the new one-label PDF, then scan and activate all physical tubes after filling them.

## Routine safety checks

- Confirm the source identifier and displayed quantity before planning.
- Print PDFs at 100% and verify the configured stock dimensions.
- A printed label is only a reservation; scan confirmation creates active inventory.
- Never compensate for a warning by changing quantities to false values. Record actual values and use the explicit capacity override only when a physical vial truly exceeds the configured maximum.
- Never enter names, MRNs, dates of birth, diagnoses, or other PHI.
