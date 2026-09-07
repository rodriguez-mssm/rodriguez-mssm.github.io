# CryoLabel sheet reference

`CryoLabel_Template.docx` is the blank label-sheet template provided by the laboratory. It is retained unchanged as a reference artifact; Word is not used by the inventory application's runtime PDF workflow.

The geometry below was extracted from `word/document.xml`. Word uses DXA/twips, with 1,440 DXA per inch.

| Property | DOCX value | Physical value |
|---|---:|---:|
| Page | 12,240 × 15,840 DXA | 215.900 × 279.400 mm, US Letter portrait |
| Section margins | left/right 1,106; top 340; bottom 0 DXA | 19.508 / 19.508 / 5.997 / 0 mm |
| Table indent | −15 DXA | −0.265 mm |
| Effective label-grid left edge | 1,091 DXA | 19.244 mm |
| Label cell | 1,872 × 737 DXA | 33.020 × 13.000 mm |
| Horizontal gap cell | 168 DXA | 2.963 mm |
| Vertical gap row | 170 DXA | 2.999 mm |
| Grid | 5 × 17 | 85 positions |
| Effective right remainder | 1,117 DXA | 19.703 mm |
| Effective bottom remainder | 251 DXA | 4.428 mm |
| Cell left/right margin | 15 DXA | 0.265 mm |
| Paragraph left/right indent | 47 DXA | 0.829 mm |

The matching runtime values are centralized in `inventory/js/label-config.js`. Label positions use the table's effective left edge, including its negative indent, rather than merely copying the section margin.

## Physical calibration status

**Not yet verified against a printed physical sheet.** Do not treat the layout as production-ready until this procedure passes:

1. Open **Label calibration** in the inventory app and generate the calibration PDF.
2. Print it on ordinary paper at **Actual size / 100%**.
3. Disable **Fit to page**, **Shrink to fit**, and **Scale to printable area**.
4. Overlay the paper on an unused physical CryoLabel sheet.
5. Check the first label, last label in row 1, first label in row 17, and bottom-right label.
6. Measure horizontal and vertical cumulative drift.
7. Adjust only `inventory/js/label-config.js`.
8. Regenerate and repeat until all four corners align.
