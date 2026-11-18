import { writeFile } from 'node:fs/promises';
import {
  AlignmentType, Bookmark, BorderStyle, Document, Footer, HeightRule, ImageRun, LineRuleType,
  Math as WordMath, Packer, PageNumber, Paragraph, Table, TableCell, TableLayoutType, TableRow,
  TextRun, VerticalAlign, WidthType, type IParagraphOptions, type ParagraphChild,
} from 'docx';
import { latexToMath } from 'docx/math';
import { unzipSync } from 'fflate';
import sharp from 'sharp';
import type { PublicBlock, PublicQuestion, PublicSheet } from './projection.ts';
import { paperSizes } from './schema.ts';

export interface WordRow { columns: number; pageId: string; questionIds: string[]; reviewedPageBreak?: boolean }
export interface WordCheck { questions: number; widthMm: number; heightMm: number }
export interface RenderedEquation { data: Buffer; width: number; height: number }
type EquationImages = ReadonlyMap<string, RenderedEquation>;

type Content = Paragraph | Table;
const twips = (mm: number) => Math.round(mm * 1440 / 25.4);
const px = (mm: number) => mm * 96 / 25.4;
const widthDxa = (size: number) => ({ size, type: WidthType.DXA });
const noBorder = { style: BorderStyle.NONE };
const rule = { style: BorderStyle.SINGLE, color: '777777', size: 4 };
const gridLine = { ...rule, color: '333333' };
const gridGuide = { ...rule, style: BorderStyle.DASHED, color: '999999' };
const clearBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder };
const noPadding = { top: 0, bottom: 0, left: 0, right: 0 };
const sectionNumbers = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四'];
const decoder = new TextDecoder('utf-8', { fatal: true });

export const equationKey = (tex: string, display: boolean) => `${display ? 'block' : 'inline'}:${tex}`;

function formula(tex: string, display: boolean, equationImages: EquationImages) {
  const rendered = equationImages.get(equationKey(tex, display));
  if (rendered) return new ImageRun({
    type: 'png', data: rendered.data, transformation: { width: rendered.width, height: rendered.height },
    altText: { title: '公式', description: tex, name: '公式' },
  });
  return new WordMath({ children: latexToMath(tex) });
}

function textRuns(text: string, equationImages: EquationImages): ParagraphChild[] {
  return text.split(/(\\\([\s\S]*?\\\))/g).filter(Boolean).map(part =>
    part.startsWith('\\(') && part.endsWith('\\)') ? formula(part.slice(2, -2), false, equationImages) : new TextRun(part));
}

function textParagraphs(text: string, equationImages: EquationImages) {
  // Inline equations can themselves span source lines.
  return (text.match(/(?:\\\([\s\S]*?\\\)|[^\r\n])+|\r\n|[\r\n]/g) ?? [])
    .filter(line => line !== '\n' && line !== '\r' && line !== '\r\n')
    .map(line => new Paragraph({ children: textRuns(line, equationImages) }));
}

function spaceParagraph(heightMm: number, options: IParagraphOptions = {}) {
  return new Paragraph({
    spacing: { before: 0, after: 0, line: twips(heightMm), lineRule: LineRuleType.EXACT },
    ...options,
  });
}

function writingSpace(height: number, style: string, rowMm: number, width: number): Content[] {
  if (height <= 0) return [];
  const fourLine = style === 'four-line';
  const count = fourLine ? Math.ceil(height / 18) : Math.max(1, Math.floor(height / rowMm));
  if (style === 'blank') return Array.from({ length: count }, () => spaceParagraph(height / count));

  const heights = fourLine ? [3, 4, 4, 4, 3] : [height / count];
  // Round cumulative boundaries so repeated rows preserve the total physical height.
  let boundary = 0;
  const rows = Array.from({ length: count }, () => heights.map((mm, index) => {
    const rowHeight = twips(boundary + mm) - twips(boundary);
    boundary += mm;
    const nextLine = index < heights.length - 1;
    return new TableRow({
      cantSplit: true,
      keepNext: nextLine,
      height: { value: rowHeight, rule: HeightRule.EXACT },
      children: [new TableCell({
        width: widthDxa(width),
        borders: { ...clearBorders, bottom: fourLine ? nextLine ? index === 2 ? gridLine : rule : noBorder : rule },
        children: [spaceParagraph(1)],
      })],
    });
  })).flat();
  return [new Table({ width: widthDxa(width), columnWidths: [width], layout: TableLayoutType.FIXED, borders: clearBorders, margins: noPadding, rows })];
}

function characterGrid(count: number, cellMm: number, width: number, characters?: string[]): Table[] {
  const size = twips(cellMm);
  const perRow = Math.max(1, Math.floor(width / size));
  return Array.from({ length: Math.ceil(count / perRow) }, (_, line) => {
    const offset = line * perRow;
    const cells = Math.min(perRow, count - offset);
    const columnWidths = Array.from({ length: cells }, () => characters ? [size] : [Math.floor(size / 2), Math.ceil(size / 2)]).flat();
    const rows = characters ? [new TableRow({
      cantSplit: true,
      height: { value: size, rule: HeightRule.EXACT },
      children: columnWidths.map((w, i) => new TableCell({
        width: widthDxa(w), verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0 }, children: [new TextRun({ text: characters[offset + i], size: 44 })] })],
      })),
    })] : [0, 1].map(row => new TableRow({
      cantSplit: true,
      keepNext: row === 0,
      height: { value: columnWidths[row], rule: HeightRule.EXACT },
      children: columnWidths.map((w, i) => new TableCell({
        width: widthDxa(w),
        borders: { top: row === 0 ? gridLine : gridGuide, bottom: row === 0 ? gridGuide : gridLine, left: i % 2 === 0 ? gridLine : gridGuide, right: i % 2 === 0 ? gridGuide : gridLine },
        children: [spaceParagraph(1)],
      })),
    }));
    return new Table({ width: widthDxa(size * cells), columnWidths, layout: TableLayoutType.FIXED, margins: noPadding, rows,
      borders: { top: gridLine, bottom: gridLine, left: gridLine, right: gridLine, insideHorizontal: gridLine, insideVertical: gridLine } });
  });
}

function dataTable(rows: string[][], width: number) {
  const count = Math.max(...rows.map(row => row.length));
  const columnWidths = Array.from({ length: count }, (_, i) => Math.round(width * (i + 1) / count) - Math.round(width * i / count));
  return new Table({ width: widthDxa(width), columnWidths, layout: TableLayoutType.FIXED,
    margins: { top: twips(1), bottom: 0, left: twips(1), right: twips(1) },
    rows: rows.map((row, i) => new TableRow({
      tableHeader: i === 0,
      children: columnWidths.map((w, column) => new TableCell({
        width: widthDxa(w),
        shading: i === 0 ? { fill: 'F5F5F5' } : undefined,
        children: (row[column] ?? '').split(/\r?\n/).map(text => new Paragraph(text)),
      })),
    })),
  });
}

async function blocks(items: PublicBlock[], width: number, sheet: PublicSheet, equationImages: EquationImages,
  continuation?: { number: number; blocks: number[] }): Promise<Content[]> {
  const result: Content[] = [];
  for (const [index, block] of items.entries()) {
    if (continuation?.blocks.includes(index)) {
      result.push(new Paragraph({ pageBreakBefore: true, keepNext: true, text: `第 ${continuation.number} 题（续）` }));
    }
    switch (block.type) {
      case 'text': result.push(...textParagraphs(block.text, equationImages)); break;
      case 'formula': result.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [formula(block.tex, true, equationImages)] })); break;
      case 'options': result.push(...block.items.flatMap(text => textParagraphs(text, equationImages))); break;
      case 'table': result.push(dataTable(block.rows, width)); break;
      case 'image': {
        const bytes = Buffer.from(block.asset.slice('data:image/png;base64,'.length), 'base64');
        const image = await sharp(bytes).metadata();
        const ratio = image.width / image.height;
        const availableMm = width * 25.4 / 1440;
        const availableHeightMm = paperSizes[sheet.layout.paperSize][1] - sheet.layout.marginMm * 2 - 58;
        const widthMm = Math.min(availableMm, block.widthMm ?? availableMm, availableHeightMm * ratio);
        if (widthMm + 0.02 < block.minWidthMm) throw new Error(`题图“${block.alt}”无法满足最小可读宽度`);
        const run = new ImageRun({ type: 'png', data: bytes, transformation: { width: px(widthMm), height: px(widthMm / ratio) },
          altText: { title: block.alt, description: block.alt, name: block.alt } });
        result.push(new Paragraph({ keepNext: block.containsWork, children: [run] }));
        if (block.containsWork) result.push(new Paragraph('按家长确认保留原图（含原作答）'));
        break;
      }
      case 'pinyin':
        result.push(new Paragraph({ text: block.text, keepNext: true }), ...characterGrid(block.cells, sheet.layout.cellMm, width));
        break;
      case 'copy': {
        const characters = Array.from(block.word);
        result.push(new Paragraph({ text: '范字', keepNext: true }), ...characterGrid(characters.length, sheet.layout.cellMm, width, characters));
        for (let n = 0; n < block.repeats; n++) {
          result.push(spaceParagraph(1), ...characterGrid(characters.length, sheet.layout.cellMm, width));
        }
        break;
      }
      case 'subquestion':
        result.push(new Paragraph({ keepNext: true, children: [new TextRun({ text: block.label, bold: true })] }),
          ...await blocks(block.blocks, width, sheet, equationImages), ...writingSpace(block.workspaceMm, block.workspaceStyle, block.workspaceRowMm, width));
        break;
    }
  }
  return result;
}

function questionLabel(q: PublicQuestion) {
  return new Bookmark({ id: `question_${q.number}`, children: [new TextRun({ text: `${q.number}.`, bold: true, size: 24 })] });
}

function oralCells(q: PublicQuestion | undefined, width: number, layout: NonNullable<PublicSheet['oralLayout']>) {
  const numberWidth = twips(layout.numberWidthMm);
  const answerWidth = twips(layout.answerWidthMm);
  const expressionWidth = width - numberWidth - answerWidth;
  const padding = twips(1);
  const spacing = { before: 0, after: 0 };
  const fields = [{ width: numberWidth, paragraph: new Paragraph({
    alignment: AlignmentType.RIGHT, indent: { right: padding }, spacing,
    children: q ? [questionLabel(q)] : [],
  }) }, { width: expressionWidth, paragraph: new Paragraph({
    indent: { left: padding, right: padding }, spacing, text: q?.oralExpression?.replaceAll(' ', '\u00a0'),
  }) }, { width: answerWidth, paragraph: new Paragraph({
    spacing, children: q ? [new TextRun({ text: '_______', font: 'Courier New', size: 28 })] : [],
  }) }];
  return fields.map(field => ({ width: field.width, cell: new TableCell({
    width: widthDxa(field.width), verticalAlign: VerticalAlign.CENTER, children: [field.paragraph],
  }) }));
}

async function question(q: PublicQuestion, width: number, sheet: PublicSheet, equationImages: EquationImages, breaks: number[] = []): Promise<Content[]> {
  try {
    return [new Paragraph({ keepNext: true, children: [questionLabel(q)] }),
      ...await blocks(q.blocks, width, sheet, equationImages, { number: q.number, blocks: breaks }), ...writingSpace(q.workspaceMm, q.workspaceStyle, q.workspaceRowMm, width)];
  } catch (cause) {
    throw new Error(`第 ${q.number} 题 Word 排版失败：${(cause as Error).message}`, { cause });
  }
}

async function packWord(sheet: PublicSheet, rows: WordRow[], equationImages: EquationImages, continuationBreaks: { id: string; block: number }[]) {
  const [widthMm, heightMm] = paperSizes[sheet.layout.paperSize];
  const margin = twips(sheet.layout.marginMm);
  const contentWidth = twips(widthMm) - 2 * margin;
  const gap = sheet.layout.preset === 'compact' ? 3 : sheet.layout.preset === 'spacious' ? 7 : 5;
  const byId = new Map(sheet.questions.map(q => [q.id, q]));
  const sections = new Map(sheet.sections.map(section => [section.id, section]));
  const allOral = sheet.questions.length > 0 && sheet.questions.every(q => q.oralExpression);
  const children: Content[] = [];
  const fixedTable = (columnWidths: number[], tableRows: TableRow[]) => new Table({
    width: widthDxa(columnWidths.reduce((total, width) => total + width, 0)), columnWidths,
    layout: TableLayoutType.FIXED, borders: clearBorders, margins: noPadding, rows: tableRows,
  });
  let oralTable: { columns: number; widths: number[]; rows: TableRow[] } | undefined;
  const flushOralTable = () => {
    if (oralTable) children.push(fixedTable(oralTable.widths, oralTable.rows));
    oralTable = undefined;
  };
  let previousSubject: string | undefined;
  let previousSection: string | undefined;
  let previousPage: string | undefined;
  for (const row of rows) {
    const questions = row.questionIds.map(id => byId.get(id)!);
    const first = questions[0];
    const inline = first.oralExpression ? sheet.oralLayout : undefined;
    const reviewedPageStart = Boolean((allOral || row.reviewedPageBreak) && previousPage && previousPage !== row.pageId);
    if (!inline || previousSection !== first.sectionId || previousPage !== row.pageId) flushOralTable();
    if (previousSubject !== first.subject || reviewedPageStart) {
      children.push(new Paragraph({
        pageBreakBefore: previousSubject !== undefined, keepNext: true, alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: twips(sheet.studentInfo ? 8 : 4) },
        children: [new TextRun({ text: sheet.subjectTitles[first.subject], size: 46, bold: true })],
      }));
      if (sheet.studentInfo) children.push(new Paragraph({
        keepNext: true, alignment: AlignmentType.CENTER, spacing: { before: 0, after: twips(4) },
        children: [new TextRun({ text: sheet.studentInfo, size: 26 })],
      }));
      previousSubject = first.subject;
    }
    if (previousSection !== first.sectionId || reviewedPageStart) {
      const section = sections.get(first.sectionId)!;
      const heading = allOral && sheet.oralLayout
        ? reviewedPageStart ? sheet.oralLayout.continuation : `${sheet.oralLayout.instruction}  共 ${section.count} 题`
        : `${sectionNumbers[section.number] ?? section.number}、${section.title}${previousSection === first.sectionId ? '（续）' : ''}  共 ${section.count} 题`;
      children.push(new Paragraph({
        keepNext: true, spacing: { before: twips(2), after: twips(2) }, border: { bottom: rule },
        children: [new TextRun({ text: heading, bold: true })],
      }));
      previousSection = section.id;
    }
    previousPage = row.pageId;
    if (row.columns === 1 && !inline) {
      const breaks = continuationBreaks.filter(item => item.id === first.id).map(item => item.block);
      children.push(...await question(first, contentWidth, sheet, equationImages, breaks));
    } else {
      const gutter = twips(gap);
      const questionWidth = Math.floor((contentWidth - (row.columns - 1) * gutter) / row.columns);
      const rowWidths = Array.from({ length: row.columns }, (_, i) => i === 0 ? [questionWidth] : [gutter, questionWidth]).flat();
      const cells: TableCell[] = [];
      const columnWidths: number[] = [];
      for (const [i, width] of rowWidths.entries()) {
        const item = i % 2 === 0 ? questions[i / 2] : undefined;
        if (inline && i % 2 === 0) {
          for (const field of oralCells(item, width, inline)) {
            columnWidths.push(field.width);
            cells.push(field.cell);
          }
        } else {
          columnWidths.push(width);
          cells.push(new TableCell({ width: widthDxa(width), children: item ? await question(item, width, sheet, equationImages) : [spaceParagraph(1)] }));
        }
      }
      const tableRow = new TableRow({ cantSplit: true, children: cells, height: inline
        ? { value: twips(inline.rowHeightMm + gap), rule: HeightRule.ATLEAST } : undefined });
      if (inline) {
        if (oralTable && oralTable.columns !== row.columns) flushOralTable();
        oralTable ??= { columns: row.columns, widths: columnWidths, rows: [] };
        oralTable.rows.push(tableRow);
        continue;
      }
      children.push(fixedTable(columnWidths, [tableRow]));
    }
    children.push(spaceParagraph(gap));
  }
  flushOralTable();

  return Packer.toBuffer(new Document({
    title: sheet.title, creator: '错题打印助手',
    styles: { default: { document: {
      run: { font: { ascii: 'Arial', hAnsi: 'Arial', eastAsia: 'Microsoft YaHei' }, size: Math.round(sheet.layout.fontPt * 2) },
      paragraph: { spacing: { after: twips(1.5), line: 330 } },
    } } },
    sections: [{
      properties: { page: { size: { width: twips(widthMm), height: twips(heightMm) },
        margin: { top: margin, bottom: margin, left: margin, right: margin, footer: twips(5) } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
        children: [new TextRun({ size: 18, children: allOral ? ['第 ', PageNumber.CURRENT, ' 页 / 共 ', PageNumber.TOTAL_PAGES, ' 页']
          : [sheet.grade ? `${sheet.grade} · 第 ` : '第 ', PageNumber.CURRENT, ' 页'] })] })] }) },
      children,
    }],
  }));
}

export async function writeWord(path: string, sheet: PublicSheet, rows: WordRow[], equationImages: EquationImages = new Map(), continuationBreaks: { id: string; block: number }[] = []): Promise<WordCheck> {
  const ids = rows.flatMap(row => row.questionIds);
  if (ids.length !== sheet.questions.length || sheet.questions.some((q, i) => q.id !== ids[i])) {
    throw new Error('Word 输出题目数量或顺序对账失败');
  }
  const bytes = await packWord(sheet, rows, equationImages, continuationBreaks);
  const entries = unzipSync(bytes, { filter: file => ['[Content_Types].xml', 'word/document.xml'].includes(file.name) });
  const xml = decoder.decode(entries['word/document.xml']);
  const contentTypes = decoder.decode(entries['[Content_Types].xml']);
  const numbers = Array.from(xml.matchAll(/<w:bookmarkStart\b[^>]*\bw:name="question_(\d+)"/g), match => Number(match[1]));
  if (!contentTypes.includes('wordprocessingml.document.main+xml') || numbers.length !== sheet.questions.length || numbers.some((number, i) => number !== sheet.questions[i].number)) {
    throw new Error('Word 文件结构、题数或题号校验失败');
  }
  const [widthMm, heightMm] = paperSizes[sheet.layout.paperSize];
  const size = xml.match(/<w:pgSz\b[^>]*>/)?.[0];
  if (!size?.includes(`w:w="${twips(widthMm)}"`) || !size.includes(`w:h="${twips(heightMm)}"`)) throw new Error('Word 纸张尺寸校验失败');
  await writeFile(path, bytes);
  return { questions: numbers.length, widthMm, heightMm };
}
