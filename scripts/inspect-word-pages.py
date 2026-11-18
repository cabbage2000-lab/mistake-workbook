"""Inspect the locally rendered DOCX pages and save page images for visual review."""
import json
import re
import sys
from pathlib import Path

import pymupdf


def inspect(pdf, directory, prefix, width_mm, height_mm, margin_mm):
    points = 72 / 25.4
    thumbnails = []
    findings = []
    question_numbers = []
    with pymupdf.open(pdf) as document:
        for number, page in enumerate(document, 1):
            width, height = page.rect.width, page.rect.height
            if abs(width - width_mm * points) > 2 or abs(height - height_mm * points) > 2:
                findings.append({"page": number, "reason": "渲染纸型与任务指定尺寸不同"})
            body = pymupdf.Rect(0, 0, width, height - margin_mm * points)
            text = page.get_text("text", clip=body).strip()
            labels = [int(match[1]) for word in page.get_text("words", clip=body)
                      if (match := re.fullmatch(r"([1-9]\d{0,2})[.．]", word[4]))]
            question_numbers.append(labels)
            image = page.get_pixmap(matrix=pymupdf.Matrix(650 / width, 650 / width), alpha=False)
            file = f"{prefix}-word-page-{number:03d}.png"
            image.save(Path(directory) / file)
            thumbnails.append(file)
            # Writing lines and figures can occupy a text-free page. Keep those
            # pages for visual inspection, including explicitly reserved blank space.
            pictures = page.get_image_info()
            if not text and not pictures:
                findings.append({"page": number, "reason": "正文无可提取文字或题图，核对空白页及预留书写区"})
            elif not text:
                findings.append({"page": number, "reason": "仅有图像的正文页，核对题图和题号"})
            for picture in pictures:
                rect = pymupdf.Rect(picture["bbox"])
                if rect.x0 < margin_mm * points - 2 or rect.x1 > width - margin_mm * points + 2 or rect.y1 > body.y1 + 2:
                    findings.append({"page": number, "reason": "题图超出正文边距，核对图示是否完整"})
                    break
        return {"pages": len(document), "thumbnails": thumbnails, "findings": findings, "questionNumbers": question_numbers}


if __name__ == "__main__":
    pdf, directory, prefix, *sizes = sys.argv[1:]
    print(json.dumps(inspect(pdf, directory, prefix, *map(float, sizes)), ensure_ascii=False))
