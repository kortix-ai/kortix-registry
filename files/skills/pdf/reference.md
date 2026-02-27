# PDF Processing Advanced Reference

## pypdfium2 Library

### Render PDF to Images
```python
import pypdfium2 as pdfium

pdf = pdfium.PdfDocument("document.pdf")
page = pdf[0]
bitmap = page.render(scale=2.0, rotation=0)
img = bitmap.to_pil()
img.save("page_1.png", "PNG")

for i, page in enumerate(pdf):
    bitmap = page.render(scale=1.5)
    img = bitmap.to_pil()
    img.save(f"page_{i+1}.jpg", "JPEG", quality=90)
```

## JavaScript Libraries

### pdf-lib (MIT License)

#### Load and Manipulate
```javascript
import { PDFDocument } from 'pdf-lib';
import fs from 'fs';

async function manipulatePDF() {
    const existingPdfBytes = fs.readFileSync('input.pdf');
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const newPage = pdfDoc.addPage([600, 400]);
    newPage.drawText('Added by pdf-lib', { x: 100, y: 300, size: 16 });
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync('modified.pdf', pdfBytes);
}
```

#### Create from Scratch
```javascript
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

async function createPDF() {
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const page = pdfDoc.addPage([595, 842]);
    page.drawText('Invoice #12345', { x: 50, y: page.getSize().height - 50, size: 18, font, color: rgb(0.2, 0.2, 0.8) });
    fs.writeFileSync('created.pdf', await pdfDoc.save());
}
```

#### Merge
```javascript
async function mergePDFs() {
    const mergedPdf = await PDFDocument.create();
    const pdf1 = await PDFDocument.load(fs.readFileSync('doc1.pdf'));
    const pdf2 = await PDFDocument.load(fs.readFileSync('doc2.pdf'));
    const pdf1Pages = await mergedPdf.copyPages(pdf1, pdf1.getPageIndices());
    pdf1Pages.forEach(page => mergedPdf.addPage(page));
    const pdf2Pages = await mergedPdf.copyPages(pdf2, [0, 2, 4]);
    pdf2Pages.forEach(page => mergedPdf.addPage(page));
    fs.writeFileSync('merged.pdf', await mergedPdf.save());
}
```

## Advanced CLI

### poppler-utils
```bash
pdftotext -bbox-layout document.pdf output.xml
pdftoppm -png -r 300 document.pdf output_prefix
pdfimages -j -p document.pdf page_images
```

### qpdf
```bash
qpdf --split-pages=3 input.pdf output_group_%02d.pdf
qpdf --linearize input.pdf optimized.pdf
qpdf --check input.pdf
qpdf --encrypt user_pass owner_pass 256 --print=none --modify=none -- input.pdf encrypted.pdf
```

## Advanced pdfplumber

```python
import pdfplumber

with pdfplumber.open("document.pdf") as pdf:
    page = pdf.pages[0]
    chars = page.chars  # text with coordinates
    bbox_text = page.within_bbox((100, 100, 400, 200)).extract_text()
    tables = page.extract_tables({
        "vertical_strategy": "lines",
        "horizontal_strategy": "lines",
        "snap_tolerance": 3,
    })
```

## Performance Tips

- Use `pdftotext -bbox-layout` for fastest text extraction
- Use `pdfimages` over page rendering for image extraction
- Process large PDFs in chunks
- Use `qpdf --split-pages` for splitting large files
