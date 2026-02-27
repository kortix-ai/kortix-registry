"""Render DOCX-like file to PNG images via LibreOffice + Poppler.

Usage:
    python render_docx.py /path/to/file.docx --output_dir /tmp/docx_pages
"""

import argparse
import os
import re
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from os import makedirs, replace
from os.path import abspath, basename, exists, expanduser, join, splitext
from shutil import which
import sys
from typing import Sequence, cast
from zipfile import ZipFile

from pdf2image import convert_from_path, pdfinfo_from_path

TWIPS_PER_INCH: int = 1440


def ensure_system_tools() -> None:
    missing: list[str] = []
    for tool in ("soffice", "pdftoppm"):
        if which(tool) is None:
            missing.append(tool)
    if missing:
        raise RuntimeError(f"Missing required system tool(s): {', '.join(missing)}. Install LibreOffice and Poppler.")


def calc_dpi_via_ooxml_docx(input_path: str, max_w_px: int, max_h_px: int) -> int:
    with ZipFile(input_path, "r") as zf:
        xml = zf.read("word/document.xml")
    root = ET.fromstring(xml)
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}

    sect_pr = root.find(".//w:sectPr", ns)
    if sect_pr is None:
        raise RuntimeError("Section properties not found")
    pg_sz = sect_pr.find("w:pgSz", ns)
    if pg_sz is None:
        raise RuntimeError("Page size not found")

    w_twips_str = pg_sz.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}w") or pg_sz.get("w")
    h_twips_str = pg_sz.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}h") or pg_sz.get("h")

    if not w_twips_str or not h_twips_str:
        raise RuntimeError("Page size attributes missing")

    width_in = int(w_twips_str) / TWIPS_PER_INCH
    height_in = int(h_twips_str) / TWIPS_PER_INCH
    if width_in <= 0 or height_in <= 0:
        raise RuntimeError("Invalid page size values")
    return round(min(max_w_px / width_in, max_h_px / height_in))


def calc_dpi_via_pdf(input_path: str, max_w_px: int, max_h_px: int) -> int:
    with tempfile.TemporaryDirectory(prefix="soffice_profile_") as user_profile:
        with tempfile.TemporaryDirectory(prefix="soffice_convert_") as convert_tmp_dir:
            stem = splitext(basename(input_path))[0]
            pdf_path = convert_to_pdf(input_path, user_profile, convert_tmp_dir, stem)
            if not (pdf_path and exists(pdf_path)):
                raise RuntimeError("Failed to convert input to PDF for DPI computation.")

            info = pdfinfo_from_path(pdf_path)
            size_val = info.get("Page size")
            if not size_val:
                for k, v in info.items():
                    if isinstance(v, str) and "size" in k.lower() and "pts" in v:
                        size_val = v
                        break
            if not isinstance(size_val, str):
                raise RuntimeError("Failed to read PDF page size.")

            m = re.search(r"(\d+)\s*x\s*(\d+)\s*pts", size_val)
            if not m:
                raise RuntimeError("Unrecognized PDF page size format.")
            width_in = int(m.group(1)) / 72.0
            height_in = int(m.group(2)) / 72.0
            if width_in <= 0 or height_in <= 0:
                raise RuntimeError("Invalid PDF page size values.")
            return round(min(max_w_px / width_in, max_h_px / height_in))


def convert_to_pdf(doc_path: str, user_profile: str, convert_tmp_dir: str, stem: str) -> str:
    cmd_pdf = [
        "soffice", f"-env:UserInstallation=file://{user_profile}",
        "--invisible", "--headless", "--norestore",
        "--convert-to", "pdf", "--outdir", convert_tmp_dir, doc_path,
    ]
    subprocess.run(cmd_pdf, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=os.environ.copy())

    pdf_path = join(convert_tmp_dir, f"{stem}.pdf")
    if exists(pdf_path):
        return pdf_path

    # Fallback: DOCX -> ODT -> PDF
    cmd_odt = [
        "soffice", f"-env:UserInstallation=file://{user_profile}",
        "--invisible", "--headless", "--norestore",
        "--convert-to", "odt", "--outdir", convert_tmp_dir, doc_path,
    ]
    subprocess.run(cmd_odt, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=os.environ.copy())
    odt_path = join(convert_tmp_dir, f"{stem}.odt")
    if exists(odt_path):
        cmd_odt_pdf = [
            "soffice", f"-env:UserInstallation=file://{user_profile}",
            "--invisible", "--headless", "--norestore",
            "--convert-to", "pdf", "--outdir", convert_tmp_dir, odt_path,
        ]
        subprocess.run(cmd_odt_pdf, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=os.environ.copy())
        if exists(pdf_path):
            return pdf_path
    return ""


def rasterize(doc_path: str, out_dir: str, dpi: int) -> Sequence[str]:
    makedirs(out_dir, exist_ok=True)
    doc_path = abspath(doc_path)
    stem = splitext(basename(doc_path))[0]

    with tempfile.TemporaryDirectory(prefix="soffice_profile_") as user_profile:
        with tempfile.TemporaryDirectory(prefix="soffice_convert_") as convert_tmp_dir:
            pdf_path = convert_to_pdf(doc_path, user_profile, convert_tmp_dir, stem)
            if not pdf_path or not exists(pdf_path):
                raise RuntimeError("Failed to produce PDF for rasterization.")
            paths_raw = cast(
                list[str],
                convert_from_path(pdf_path, dpi=dpi, fmt="png", thread_count=8, output_folder=out_dir, paths_only=True, output_file="page"),
            )

    pages: list[tuple[int, str]] = []
    for src_path in paths_raw:
        base = splitext(basename(src_path))[0]
        page_num = int(base.split("-")[-1])
        dst_path = join(out_dir, f"page-{page_num}.png")
        replace(src_path, dst_path)
        pages.append((page_num, dst_path))
    pages.sort(key=lambda t: t[0])
    return [path for _, path in pages]


def main() -> None:
    parser = argparse.ArgumentParser(description="Render DOCX to PNG images.")
    parser.add_argument("input_path", help="Path to DOCX file.")
    parser.add_argument("--output_dir", default=None, help="Output directory for images.")
    parser.add_argument("--width", type=int, default=1600, help="Max width in pixels (default 1600).")
    parser.add_argument("--height", type=int, default=2000, help="Max height in pixels (default 2000).")
    parser.add_argument("--dpi", type=int, default=None, help="Override computed DPI.")
    args = parser.parse_args()

    try:
        ensure_system_tools()
        input_path = abspath(expanduser(args.input_path))
        out_dir = abspath(expanduser(args.output_dir)) if args.output_dir else splitext(input_path)[0]

        if args.dpi is not None:
            dpi = args.dpi
        else:
            try:
                if input_path.lower().endswith((".docx", ".docm", ".dotx", ".dotm")):
                    dpi = calc_dpi_via_ooxml_docx(input_path, args.width, args.height)
                else:
                    raise RuntimeError("Not a DOCX container")
            except Exception:
                dpi = calc_dpi_via_pdf(input_path, args.width, args.height)

        rasterize(input_path, out_dir, dpi)
        print("Pages rendered to " + out_dir)
    except RuntimeError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
