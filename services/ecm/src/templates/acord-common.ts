import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";

// ── Constants ────────────────────────────────────────────────────────

const PAGE_WIDTH = 612; // US Letter
const PAGE_HEIGHT = 792;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;

const GRAY = rgb(0.4, 0.4, 0.4);
const LIGHT_GRAY = rgb(0.85, 0.85, 0.85);
const DARK = rgb(0.1, 0.1, 0.1);
const HEADER_BG = rgb(0.15, 0.25, 0.4);
const WHITE = rgb(1, 1, 1);

const FONT_SIZE_TITLE = 14;
const FONT_SIZE_SECTION = 10;
const FONT_SIZE_BODY = 9;
const FONT_SIZE_LABEL = 7.5;
const LINE_HEIGHT = 14;

// ── Types ────────────────────────────────────────────────────────────

export interface AcordFonts {
  regular: PDFFont;
  bold: PDFFont;
}

export interface Coverage {
  type: string;
  limit: string | null;
  deductible: number | null;
}

// ── Document setup ───────────────────────────────────────────────────

export async function createAcordDocument(
  formNumber: string,
  formTitle: string,
): Promise<{ doc: PDFDocument; page: PDFPage; fonts: AcordFonts; y: number }> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fonts = { regular, bold };

  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  // Header band
  page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - 60,
    width: PAGE_WIDTH,
    height: 60,
    color: HEADER_BG,
  });

  page.drawText(`ACORD ${formNumber}`, {
    x: MARGIN,
    y: PAGE_HEIGHT - 28,
    size: FONT_SIZE_TITLE,
    font: bold,
    color: WHITE,
  });

  page.drawText(formTitle, {
    x: MARGIN,
    y: PAGE_HEIGHT - 46,
    size: FONT_SIZE_BODY,
    font: regular,
    color: rgb(0.8, 0.85, 0.95),
  });

  // Agency branding (right-aligned)
  const agencyText = "Evergreen Insurance Agency";
  const agencyWidth = bold.widthOfTextAtSize(agencyText, FONT_SIZE_BODY);
  page.drawText(agencyText, {
    x: PAGE_WIDTH - MARGIN - agencyWidth,
    y: PAGE_HEIGHT - 28,
    size: FONT_SIZE_BODY,
    font: bold,
    color: WHITE,
  });

  const dateText = `Generated: ${new Date().toISOString().split("T")[0]}`;
  const dateWidth = regular.widthOfTextAtSize(dateText, FONT_SIZE_LABEL);
  page.drawText(dateText, {
    x: PAGE_WIDTH - MARGIN - dateWidth,
    y: PAGE_HEIGHT - 46,
    size: FONT_SIZE_LABEL,
    font: regular,
    color: rgb(0.8, 0.85, 0.95),
  });

  const y = PAGE_HEIGHT - 80; // starting y below header
  return { doc, page, fonts, y };
}

// ── Section header ───────────────────────────────────────────────────

export function drawSectionHeader(
  page: PDFPage,
  y: number,
  title: string,
  fonts: AcordFonts,
): number {
  const sectionY = y - 4;

  page.drawRectangle({
    x: MARGIN,
    y: sectionY - 14,
    width: CONTENT_WIDTH,
    height: 16,
    color: rgb(0.92, 0.93, 0.95),
  });

  page.drawText(title.toUpperCase(), {
    x: MARGIN + 6,
    y: sectionY - 11,
    size: FONT_SIZE_SECTION,
    font: fonts.bold,
    color: DARK,
  });

  return sectionY - 28;
}

// ── Label + value field ──────────────────────────────────────────────

export function drawField(
  page: PDFPage,
  x: number,
  y: number,
  label: string,
  value: string | null | undefined,
  fonts: AcordFonts,
): number {
  page.drawText(label, {
    x,
    y,
    size: FONT_SIZE_LABEL,
    font: fonts.regular,
    color: GRAY,
  });

  page.drawText(value ?? "—", {
    x,
    y: y - 11,
    size: FONT_SIZE_BODY,
    font: fonts.regular,
    color: DARK,
  });

  return y - 26;
}

// ── Two-column field row ─────────────────────────────────────────────

export function drawFieldRow(
  page: PDFPage,
  y: number,
  fields: Array<{ label: string; value: string | null | undefined }>,
  fonts: AcordFonts,
): number {
  const colWidth = CONTENT_WIDTH / fields.length;
  for (let i = 0; i < fields.length; i++) {
    const x = MARGIN + i * colWidth;
    drawField(page, x, y, fields[i].label, fields[i].value, fonts);
  }
  return y - 26;
}

// ── Coverage table ───────────────────────────────────────────────────

export function drawCoverageTable(
  page: PDFPage,
  y: number,
  coverages: Coverage[],
  fonts: AcordFonts,
): number {
  const col1 = MARGIN;
  const col2 = MARGIN + 220;
  const col3 = MARGIN + 380;

  // Table header
  page.drawRectangle({
    x: MARGIN,
    y: y - 12,
    width: CONTENT_WIDTH,
    height: 14,
    color: LIGHT_GRAY,
  });

  page.drawText("COVERAGE TYPE", { x: col1 + 4, y: y - 9, size: FONT_SIZE_LABEL, font: fonts.bold, color: DARK });
  page.drawText("LIMIT", { x: col2, y: y - 9, size: FONT_SIZE_LABEL, font: fonts.bold, color: DARK });
  page.drawText("DEDUCTIBLE", { x: col3, y: y - 9, size: FONT_SIZE_LABEL, font: fonts.bold, color: DARK });

  y -= 24;

  for (const cov of coverages) {
    const label = formatCoverageType(cov.type);
    const limit = cov.limit ?? "—";
    const deductible = cov.deductible != null ? `$${cov.deductible.toLocaleString()}` : "—";

    page.drawText(label, { x: col1 + 4, y, size: FONT_SIZE_BODY, font: fonts.regular, color: DARK });
    page.drawText(limit, { x: col2, y, size: FONT_SIZE_BODY, font: fonts.regular, color: DARK });
    page.drawText(deductible, { x: col3, y, size: FONT_SIZE_BODY, font: fonts.regular, color: DARK });

    y -= LINE_HEIGHT;
  }

  // Bottom border
  page.drawLine({
    start: { x: MARGIN, y: y + 4 },
    end: { x: MARGIN + CONTENT_WIDTH, y: y + 4 },
    thickness: 0.5,
    color: LIGHT_GRAY,
  });

  return y - 6;
}

// ── Wrapped text ─────────────────────────────────────────────────────

export function drawWrappedText(
  page: PDFPage,
  x: number,
  y: number,
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number,
): number {
  const words = text.split(/\s+/);
  let line = "";
  let currentY = y;

  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    const testWidth = font.widthOfTextAtSize(testLine, fontSize);

    if (testWidth > maxWidth && line) {
      page.drawText(line, { x, y: currentY, size: fontSize, font, color: DARK });
      currentY -= LINE_HEIGHT;
      line = word;
    } else {
      line = testLine;
    }
  }

  if (line) {
    page.drawText(line, { x, y: currentY, size: fontSize, font, color: DARK });
    currentY -= LINE_HEIGHT;
  }

  return currentY;
}

// ── Footer ───────────────────────────────────────────────────────────

export function drawFooter(
  page: PDFPage,
  formNumber: string,
  fonts: AcordFonts,
): void {
  const footerY = MARGIN - 10;

  page.drawLine({
    start: { x: MARGIN, y: footerY + 14 },
    end: { x: MARGIN + CONTENT_WIDTH, y: footerY + 14 },
    thickness: 0.5,
    color: LIGHT_GRAY,
  });

  const left = `ACORD ${formNumber} (2025/01)`;
  page.drawText(left, {
    x: MARGIN,
    y: footerY,
    size: FONT_SIZE_LABEL,
    font: fonts.regular,
    color: GRAY,
  });

  const right = "Generated by Evergreen Insurance Platform";
  const rightWidth = fonts.regular.widthOfTextAtSize(right, FONT_SIZE_LABEL);
  page.drawText(right, {
    x: PAGE_WIDTH - MARGIN - rightWidth,
    y: footerY,
    size: FONT_SIZE_LABEL,
    font: fonts.regular,
    color: GRAY,
  });
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatCoverageType(type: string): string {
  return type
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function formatCurrency(amount: number): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export { MARGIN, CONTENT_WIDTH, FONT_SIZE_BODY, FONT_SIZE_LABEL, LINE_HEIGHT };
