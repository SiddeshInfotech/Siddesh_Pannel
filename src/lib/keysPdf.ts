// PDF export for a freshly-generated Vendor batch of activation keys (Keys tab,
// "Batch key generation"). Client-only — jsPDF builds the file entirely in the
// browser and triggers a download; nothing is sent to a server.
//
// jspdf-autotable v5 uses the FUNCTIONAL API: `autoTable(doc, {...})`, not the
// older `doc.autoTable({...})` plugin-attach style.
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface BatchPdfInput {
  entityName: string;
  batchId: string | null;
  productLabel: string;
  durationLabel: string;
  generatedAt: Date;
  keys: string[];
}

function sanitizeForFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').substring(0, 40) || 'BATCH';
}

export function downloadActivationKeysPdf(input: BatchPdfInput): void {
  const { entityName, batchId, productLabel, durationLabel, generatedAt, keys } = input;

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const marginX = 40;
  let y = 50;

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('LMS Activation Keys — Batch Export', marginX, y);
  y += 24;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const meta: [string, string][] = [
    ['Vendor', entityName],
    ['Product', productLabel],
    ['Batch ID', batchId || 'N/A'],
    ['Policy Duration', durationLabel],
    ['Total Keys', String(keys.length)],
    ['Generated At', generatedAt.toLocaleString('en-IN')],
  ];
  for (const [label, value] of meta) {
    doc.setFont('helvetica', 'bold');
    doc.text(`${label}:`, marginX, y);
    doc.setFont('helvetica', 'normal');
    doc.text(value, marginX + 110, y);
    y += 16;
  }
  y += 8;

  // Duration/expiry is identical for every key in the batch (shown once above), so the
  // table itself stays lean — a repeated column per row would be pure noise at 1000+ rows.
  autoTable(doc, {
    startY: y,
    head: [['#', 'Activation Key']],
    body: keys.map((k, i) => [String(i + 1), k]),
    styles: { fontSize: 9, cellPadding: 4, font: 'courier' },
    headStyles: { fillColor: [139, 92, 246], textColor: 255, font: 'helvetica', fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 40, halign: 'right' } },
    margin: { left: marginX, right: marginX },
  });

  const filename = `LMS-Keys-${sanitizeForFilename(entityName)}-${sanitizeForFilename(batchId || 'BATCH')}.pdf`;
  doc.save(filename);
}
