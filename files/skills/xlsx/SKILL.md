---
name: xlsx
description: "Use this skill any time a spreadsheet file is the primary input or output. This means any task where the user wants to: open, read, edit, or fix an existing .xlsx, .xlsm, .csv, or .tsv file (e.g., adding columns, computing formulas, formatting, charting, cleaning messy data); create a new spreadsheet from scratch or from other data sources; or convert between tabular file formats. Trigger especially when the user references a spreadsheet file by name or path — even casually (like 'the xlsx in my downloads') — and wants something done to it or produced from it. Also trigger for cleaning or restructuring messy tabular data files (malformed rows, misplaced headers, junk data) into proper spreadsheets. The deliverable must be a spreadsheet file. Do NOT trigger when the primary deliverable is a Word document, HTML report, standalone Python script, database pipeline, or Google Sheets API integration, even if tabular data is involved."
---

# Kortix XLSX — Spreadsheet Skill

You are loading the spreadsheet skill. Follow these instructions for ALL spreadsheet work.

---

## Autonomy Doctrine

**Act, don't ask.** Receive the task, build the spreadsheet, verify it, deliver it. No permission requests. No presenting options. Pick the best approach and execute.

- Write the Python script, run it, verify the output, clean up.
- If it fails, debug and retry. Only surface blockers after exhausting options.
- Every spreadsheet gets professional formatting by default — headers, borders, number formats, frozen panes, auto-width columns.
- Verify your own work: read the file back, check structure, run `recalc.py`, confirm zero errors.

---

## Communication Rules

**The user is non-technical. NEVER expose implementation details.**

**DO say:**
- "I'll create that spreadsheet for you"
- "Here's your budget spreadsheet with the calculations"
- "I've organized the data and the totals calculate automatically"
- "I've added a new sheet for Q2 data"

**NEVER say:**
- "I'll use openpyxl to create an .xlsx file"
- "I'm executing a Python script"
- "I'll load_workbook and update cells"
- "I'll use PatternFill and Font classes"
- "Running recalc.py to evaluate formulas"

**Tone:** Friendly, conversational. Describe WHAT the spreadsheet does, not HOW you built it. Make it feel effortless.

---

# Requirements for Outputs

## All Excel Files

### Professional Font
- Use a consistent, professional font (e.g., Arial, Calibri) for all deliverables unless otherwise instructed

### Zero Formula Errors
- Every Excel file MUST be delivered with ZERO formula errors (#REF!, #DIV/0!, #VALUE!, #N/A, #NAME?)
- Run `scripts/recalc.py` on every file that contains formulas before delivering
- If errors are found, fix them and recalculate until clean

### Preserve Existing Templates (when updating)
- Study and EXACTLY match existing format, style, and conventions when modifying files
- Never impose standardized formatting on files with established patterns
- Existing template conventions ALWAYS override these guidelines

### Professional Styling (new files)
- Styled headers (dark fill, white bold text)
- Borders on all data cells
- Number formatting (currency, percentages, dates)
- Frozen header row (`ws.freeze_panes = "A2"`)
- Auto-fit column widths
- Alternating row fills for large datasets

## Financial Models

### Color Coding Standards
Unless otherwise stated by the user or existing template:

| Color | RGB | Use |
|---|---|---|
| Blue text | 0,0,255 | Hardcoded inputs, scenario-changeable numbers |
| Black text | 0,0,0 | ALL formulas and calculations |
| Green text | 0,128,0 | Links pulling from other worksheets |
| Red text | 255,0,0 | External links to other files |
| Yellow background | 255,255,0 | Key assumptions needing attention |

### Number Formatting Standards

| Type | Format | Example |
|---|---|---|
| Years | Text string | "2024" not "2,024" |
| Currency | `$#,##0` | Specify units in headers: "Revenue ($mm)" |
| Zeros | Dash format | `$#,##0;($#,##0);-` |
| Percentages | `0.0%` | One decimal default |
| Multiples | `0.0x` | EV/EBITDA, P/E ratios |
| Negative numbers | Parentheses | (123) not -123 |

### Formula Construction Rules

**Assumptions Placement:**
- Place ALL assumptions (growth rates, margins, multiples) in separate assumption cells
- Use cell references, not hardcoded values: `=B5*(1+$B$6)` not `=B5*1.05`

**Formula Error Prevention:**
- Verify all cell references are correct
- Check for off-by-one errors in ranges
- Ensure consistent formulas across all projection periods
- Test with edge cases (zero values, negative numbers)
- Verify no circular references

**Documentation Requirements for Hardcodes:**
- Add cell comments with source info: `"Source: [System/Document], [Date], [Reference], [URL]"`
- Examples:
  - "Source: Company 10-K, FY2024, Page 45, Revenue Note"
  - "Source: Bloomberg Terminal, 8/15/2025, AAPL US Equity"

---

# XLSX Creation, Editing, and Analysis

## CRITICAL: Use Formulas, Not Hardcoded Values

**Always use Excel formulas instead of calculating values in Python and hardcoding them.** The spreadsheet must remain dynamic and updateable.

```python
# WRONG — hardcoding calculated values
total = df['Sales'].sum()
sheet['B10'] = total  # Hardcodes 5000

# CORRECT — Excel formulas
sheet['B10'] = '=SUM(B2:B9)'
sheet['C5'] = '=(C4-C2)/C2'
sheet['D20'] = '=AVERAGE(D2:D19)'
```

This applies to ALL calculations — totals, percentages, ratios, differences. The spreadsheet should recalculate when source data changes.

## Execution Workflow

1. **Choose tool**: pandas for data analysis/bulk ops, openpyxl for formulas/formatting
2. **Create/Load**: New workbook or load existing
3. **Modify**: Add data, formulas, formatting
4. **Save**: Write to file
5. **Recalculate (MANDATORY for formulas)**: `python scripts/recalc.py output.xlsx`
6. **Verify**: Check recalc output JSON — if `errors_found`, fix and recalculate again
7. **Clean up**: Remove temp Python scripts
8. **Report**: Describe result in user-friendly language with file path

### Script Path Resolution

The `scripts/` directory lives alongside this SKILL.md file. When running recalc:
```bash
python <skill_dir>/scripts/recalc.py output.xlsx
```

Where `<skill_dir>` is the directory containing this SKILL.md (e.g., `skills/xlsx/` or `.opencode/skills/xlsx/`).

---

## Reading and Analyzing Data

### pandas (data analysis)
```python
import pandas as pd

df = pd.read_excel('file.xlsx')                          # First sheet
all_sheets = pd.read_excel('file.xlsx', sheet_name=None) # All sheets as dict

df.head()       # Preview
df.info()       # Column types
df.describe()   # Statistics

df.to_excel('output.xlsx', index=False)
```

### openpyxl (read with formulas preserved)
```python
from openpyxl import load_workbook

wb = load_workbook('file.xlsx')                    # Preserves formulas
wb_values = load_workbook('file.xlsx', data_only=True)  # Reads calculated values (WARNING: saving loses formulas)
```

---

## Creating New Excel Files

```python
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

wb = Workbook()
ws = wb.active
ws.title = "Sheet Name"

# Headers
headers = ["Product", "Revenue", "Cost", "Profit", "Margin %"]
header_fill = PatternFill('solid', start_color='1F4E79')
header_font = Font(bold=True, color='FFFFFF', name='Calibri', size=11)
header_align = Alignment(horizontal='center', vertical='center')

for col, header in enumerate(headers, 1):
    cell = ws.cell(row=1, column=col, value=header)
    cell.fill = header_fill
    cell.font = header_font
    cell.alignment = header_align

# Data with formulas
data = [
    ["Product A", 50000, 35000, "=B2-C2", "=IFERROR(D2/B2*100,0)"],
    ["Product B", 75000, 45000, "=B3-C3", "=IFERROR(D3/B3*100,0)"],
]

for row_idx, row_data in enumerate(data, 2):
    for col_idx, value in enumerate(row_data, 1):
        ws.cell(row=row_idx, column=col_idx, value=value)

# Summary row (dynamic — never hardcode row numbers)
summary_row = len(data) + 2
last_data_row = summary_row - 1
ws.cell(row=summary_row, column=1, value="Total").font = Font(bold=True)
ws.cell(row=summary_row, column=2, value=f"=SUM(B2:B{last_data_row})")
ws.cell(row=summary_row, column=3, value=f"=SUM(C2:C{last_data_row})")
ws.cell(row=summary_row, column=4, value=f"=SUM(D2:D{last_data_row})")
ws.cell(row=summary_row, column=5, value=f"=IFERROR(D{summary_row}/B{summary_row}*100,0)")

# Borders
thin_border = Border(
    left=Side(style='thin'), right=Side(style='thin'),
    top=Side(style='thin'), bottom=Side(style='thin')
)
for row in ws.iter_rows(min_row=1, max_row=summary_row, max_col=len(headers)):
    for cell in row:
        cell.border = thin_border

# Number formatting
for row in range(2, summary_row + 1):
    for col in [2, 3, 4]:
        ws.cell(row=row, column=col).number_format = '#,##0'
    ws.cell(row=row, column=5).number_format = '0.0'

# Auto-width columns
for col in range(1, len(headers) + 1):
    max_len = max(len(str(ws.cell(row=r, column=col).value or "")) for r in range(1, summary_row + 1))
    ws.column_dimensions[get_column_letter(col)].width = min(max_len + 4, 50)

# Freeze header row
ws.freeze_panes = "A2"

wb.save('output.xlsx')
```

---

## Editing Existing Files

```python
from openpyxl import load_workbook

wb = load_workbook('existing.xlsx')
ws = wb.active  # or wb['SheetName']

# Modify cells
ws['A1'] = 'New Value'
ws.insert_rows(2)
ws.delete_cols(3)

# Add new sheet (preserves existing sheets)
new_sheet = wb.create_sheet('NewSheet')
new_sheet['A1'] = 'Data'

wb.save('modified.xlsx')
```

Use `wb.create_sheet()` to add sheets — NEVER recreate the workbook.

---

## Cross-Sheet References

```python
ws = wb.create_sheet(title="Summary")

data = [
    ["Q1 Total Revenue", "=SUM('Q1 Sales'!B2:B100)"],
    ["Q2 Total Revenue", "=SUM('Q2 Sales'!B2:B100)"],
    ["Combined Total",   "=B2+B3"],
]
```

---

## CSV Import and Transform

```python
import csv
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

with open('input.csv', 'r') as f:
    rows = list(csv.reader(f))

wb = Workbook()
ws = wb.active
ws.title = "Imported Data"

header_fill = PatternFill('solid', start_color='1F4E79')
header_font = Font(bold=True, color='FFFFFF')

for row_idx, row_data in enumerate(rows, 1):
    for col_idx, value in enumerate(row_data, 1):
        cell = ws.cell(row=row_idx, column=col_idx, value=value)
        if row_idx == 1:
            cell.fill = header_fill
            cell.font = header_font

ws.freeze_panes = "A2"
wb.save('output.xlsx')
```

---

## Pandas + openpyxl (Analysis to Formatted Output)

```python
import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.utils.dataframe import dataframe_to_rows

df = pd.read_csv('data.csv')
summary = df.groupby('category').agg(
    total_revenue=('revenue', 'sum'),
    avg_price=('price', 'mean'),
    count=('id', 'count')
).reset_index()

wb = Workbook()
ws = wb.active
ws.title = "Analysis"

for r_idx, row in enumerate(dataframe_to_rows(summary, index=False, header=True), 1):
    for c_idx, value in enumerate(row, 1):
        ws.cell(row=r_idx, column=c_idx, value=value)

header_fill = PatternFill('solid', start_color='1F4E79')
header_font = Font(bold=True, color='FFFFFF')
for cell in ws[1]:
    cell.fill = header_fill
    cell.font = header_font

ws.freeze_panes = "A2"
wb.save('analysis.xlsx')
```

---

## Recalculating Formulas

openpyxl writes formulas as strings but does NOT evaluate them. Use LibreOffice via the bundled `recalc.py`:

```bash
python scripts/recalc.py <excel_file> [timeout_seconds]
```

The script:
- Sets up a LibreOffice macro on first run
- Recalculates ALL formulas in ALL sheets
- Scans every cell for Excel errors (#REF!, #DIV/0!, #VALUE!, #NAME?, #NULL!, #NUM!, #N/A)
- Returns JSON with error locations and counts
- Works on Linux and macOS (handles sandboxed environments via `soffice.py` shim)

### Interpreting Output

```json
{
  "status": "success",
  "total_errors": 0,
  "total_formulas": 42,
  "error_summary": {}
}
```

If `status` is `errors_found`:
1. Check `error_summary` for error types and cell locations
2. Fix the formulas in Python
3. Save and recalculate again
4. Repeat until `total_errors: 0`

---

## Formula Safety Rules

### Preventing Circular References

Headers = ROW 1. Data starts ROW 2. Summary/total row = LAST row.

**CORRECT** — total row references only data rows above it:
```python
# 3 data rows (rows 2-4), total in row 5
summary_row = len(data) + 2
last_data_row = summary_row - 1
ws.cell(row=summary_row, column=2, value=f"=SUM(B2:B{last_data_row})")
```

**WRONG** — total row includes itself:
```python
# BAD: row 5 formula references B2:B5 which includes itself
["Total", "=SUM(B2:B5)", "=SUM(C2:C5)"]
```

### Preventing #DIV/0! Errors

ALWAYS wrap division with IFERROR:
```python
"=IFERROR(C2/B2*100,0)"      # Returns 0 if division fails
"=IFERROR(A1/B1,\"N/A\")"    # Returns "N/A" if division fails
```

---

## Formula Verification Checklist

### Essential
- [ ] Test 2-3 sample references before building full model
- [ ] Column mapping correct (column 64 = BL, not BK)
- [ ] Row offset correct (Excel is 1-indexed; DataFrame row 5 = Excel row 6)

### Common Pitfalls
- [ ] NaN handling: use `pd.notna()` before writing
- [ ] Division by zero: wrap all division in IFERROR
- [ ] Wrong references: verify cell refs point to intended cells
- [ ] Cross-sheet refs: use `'Sheet Name'!A1` format (quotes around names with spaces)
- [ ] Off-by-one: summary row formulas end at `last_data_row`, not `summary_row`

### Testing Strategy
- [ ] Start small: test on 2-3 cells before applying broadly
- [ ] Verify all referenced cells exist
- [ ] Test edge cases: zero, negative, very large values
- [ ] Run `recalc.py` and confirm `total_errors: 0`

---

## Formatting Reference

### Standard Style Objects

```python
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.formatting.rule import CellIsRule

# Fills
header_fill = PatternFill('solid', start_color='1F4E79')
alt_row_fill = PatternFill('solid', start_color='F2F2F2')
green_fill = PatternFill('solid', start_color='E8F5E9')
red_fill = PatternFill('solid', start_color='FFEBEE')
yellow_fill = PatternFill('solid', start_color='FFFF00')

# Fonts
header_font = Font(bold=True, color='FFFFFF', name='Calibri', size=11)
title_font = Font(bold=True, name='Calibri', size=14)
input_font = Font(color='0000FF')    # Blue — hardcoded inputs
formula_font = Font(color='000000')  # Black — formulas
link_font = Font(color='008000')     # Green — cross-sheet links

# Alignment
center = Alignment(horizontal='center', vertical='center')
wrap = Alignment(horizontal='left', vertical='top', wrap_text=True)

# Borders
thin_border = Border(
    left=Side(style='thin'), right=Side(style='thin'),
    top=Side(style='thin'), bottom=Side(style='thin')
)
thick_bottom = Border(bottom=Side(style='medium'))
```

### Alternating Row Colors
```python
for row_idx in range(2, ws.max_row + 1):
    if row_idx % 2 == 0:
        for col_idx in range(1, ws.max_column + 1):
            ws.cell(row=row_idx, column=col_idx).fill = alt_row_fill
```

### Conditional Formatting (positive/negative)
```python
ws.conditional_formatting.add(
    f'D2:D{ws.max_row}',
    CellIsRule(operator='greaterThan', formula=['0'],
              fill=PatternFill('solid', start_color='E8F5E9'))
)
ws.conditional_formatting.add(
    f'D2:D{ws.max_row}',
    CellIsRule(operator='lessThan', formula=['0'],
              fill=PatternFill('solid', start_color='FFEBEE'))
)
```

### Auto-Fit Column Widths
```python
from openpyxl.utils import get_column_letter

for col in range(1, ws.max_column + 1):
    max_len = max(len(str(ws.cell(row=r, column=col).value or "")) for r in range(1, ws.max_row + 1))
    ws.column_dimensions[get_column_letter(col)].width = min(max_len + 4, 50)
```

---

## Best Practices

### Library Selection
- **pandas**: Data analysis, bulk operations, simple data export
- **openpyxl**: Formatting, formulas, Excel-specific features
- **Both**: pandas for analysis, openpyxl for final formatted output

### openpyxl
- Cell indices are 1-based (row=1, column=1 = A1)
- `data_only=True` reads calculated values — WARNING: saving LOSES formulas permanently
- `read_only=True` / `write_only=True` for large files
- Formulas are strings, not evaluated — always run `recalc.py`

### pandas
- Specify dtypes: `pd.read_excel('f.xlsx', dtype={'id': str})`
- Read specific columns: `usecols=['A', 'C', 'E']`
- Handle dates: `parse_dates=['date_column']`

### Code Style
- Minimal, concise Python — no unnecessary comments or verbose variable names
- No unnecessary print statements
- Add cell comments for complex formulas and assumptions
- Document data sources for all hardcoded values

---

## Common Formulas Quick Reference

| Formula | Example | Use |
|---|---|---|
| SUM | `=SUM(B2:B10)` | Total a range |
| AVERAGE | `=AVERAGE(B2:B10)` | Mean |
| COUNT | `=COUNT(A1:A100)` | Count numbers |
| COUNTA | `=COUNTA(A1:A100)` | Count non-empty |
| IF | `=IF(A1>100,"High","Low")` | Conditional |
| VLOOKUP | `=VLOOKUP(A1,Sheet2!A:B,2,FALSE)` | Cross-sheet lookup |
| SUMIF | `=SUMIF(A:A,"Product A",B:B)` | Conditional sum |
| COUNTIF | `=COUNTIF(A:A,"Product A")` | Conditional count |
| IFERROR | `=IFERROR(C2/B2*100,0)` | Safe division |
| Cross-sheet | `=SUM('Sheet Name'!B2:B10)` | Reference another sheet |
| INDEX/MATCH | `=INDEX(B:B,MATCH(D1,A:A,0))` | Flexible lookup |
| MIN/MAX | `=MIN(B2:B10)` | Range extremes |
| CONCATENATE | `=A1&" "&B1` | Join text |
