**CRITICAL: Complete these steps in order. Do not skip ahead to writing code.**

First check if the PDF has fillable form fields. Run:
`python scripts/check_fillable_fields <file.pdf>`, then go to "Fillable fields" or "Non-fillable fields".

# Fillable fields
If the PDF has fillable form fields:
- Run: `python scripts/extract_form_field_info.py <input.pdf> <field_info.json>` to get field list as JSON.
- Convert PDF to PNGs: `python scripts/convert_pdf_to_images.py <file.pdf> <output_directory>`
- Analyze images to determine each field's purpose.
- Create `field_values.json` with values for each field.
- Run: `python scripts/fill_fillable_fields.py <input.pdf> <field_values.json> <output.pdf>`

# Non-fillable fields
If no fillable form fields, add text annotations.

## Step 1: Try Structure Extraction First
Run: `python scripts/extract_form_structure.py <input.pdf> form_structure.json`

If meaningful labels found, use **Approach A**. If scanned/image-based, use **Approach B**.

## Approach A: Structure-Based Coordinates (Preferred)
1. Analyze form_structure.json for label groups, row structure, field columns, checkboxes
2. Create fields.json with PDF coordinates using `pdf_width`/`pdf_height`
3. Validate: `python scripts/check_bounding_boxes.py fields.json`

## Approach B: Visual Estimation (Fallback)
1. Convert to images: `python scripts/convert_pdf_to_images.py <input.pdf> <images_dir/>`
2. Identify fields with rough estimates
3. Zoom and refine with ImageMagick crops
4. Create fields.json with image coordinates using `image_width`/`image_height`
5. Validate: `python scripts/check_bounding_boxes.py fields.json`

## Fill and Verify
- Fill: `python scripts/fill_pdf_form_with_annotations.py <input.pdf> fields.json <output.pdf>`
- Verify: `python scripts/convert_pdf_to_images.py <output.pdf> <verify_images/>`
