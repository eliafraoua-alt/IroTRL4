import html2canvas from 'html2canvas';
import { logger } from './logger';

/**
 * exportToPDF - Antigravity Intelligence Platform
 * Enhanced PDF generator with multi-page support and clean formatting
 */
export const exportToPDF = async (elementId: string, fileName: string): Promise<void> => {
  logger.info(`[PDF] Starting export for ID: ${elementId}`);
  let element = document.getElementById(elementId);
  
  if (!element) {
    logger.warn(`[PDF] Warning: Element with id ${elementId} not found, trying querySelector`);
    element = document.querySelector(`[id="${elementId}"]`) as HTMLElement;
  }

  if (!element) {
    throw new Error(`Element with id ${elementId} not found in the document`);
  }

  // Force scroll to top to ensure we capture the whole element if it's long
  const originalScrollY = window.scrollY;
  window.scrollTo(0, 0);

  try {
    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      logging: true,
      backgroundColor: '#0f172a',
      allowTaint: true,
      onclone: (clonedDoc: Document) => {
        // Fix for html2canvas failing on oklch() colors in Tailwind v4
        const style = clonedDoc.createElement('style');
        style.innerHTML = `
          * { 
            --color-slate-50: #f8fafc !important;
            --color-slate-100: #f1f5f9 !important;
            --color-slate-200: #e2e8f0 !important;
            --color-slate-300: #cbd5e1 !important;
            --color-slate-400: #94a3b8 !important;
            --color-slate-500: #64748b !important;
            --color-slate-600: #475569 !important;
            --color-slate-700: #334155 !important;
            --color-slate-800: #1e293b !important;
            --color-slate-900: #0f172a !important;
            --color-slate-950: #020617 !important;
            --color-indigo-500: #6366f1 !important;
            --color-indigo-600: #4f46e5 !important;
            --color-rose-500: #f43f5e !important;
            --color-emerald-500: #10b981 !important;
            --color-amber-400: #fbbf24 !important;
            --color-amber-500: #f59e0b !important;
          }
        `;
        clonedDoc.head.appendChild(style);
      }
    });

    // Restore scroll position
    window.scrollTo(0, originalScrollY);

    const imgData = canvas.toDataURL('image/png');
    
    // Handle both default and named export for jsPDF
    const jspdfModule = await import('jspdf');
    const JsPDF = jspdfModule.jsPDF || jspdfModule.default;
    // @ts-ignore
    const pdf = new JsPDF('p', 'mm', 'a4');
    
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    
    const imgProps = pdf.getImageProperties(imgData);
    const imgWidth = pageWidth;
    const imgHeight = (imgProps.height * imgWidth) / imgProps.width;
    
    let heightLeft = imgHeight;
    let position = 0;

    // Add pages
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    // Add footer to all pages
    const totalPages = pdf.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      pdf.setPage(i);
      pdf.setFontSize(8);
      pdf.setTextColor(150, 150, 150);
      pdf.text(
        `IRO Evaluateur V6 — Antigravity — Page ${i} de ${totalPages} — ${new Date().toLocaleDateString()}`,
        pageWidth / 2,
        pageHeight - 5,
        { align: 'center' }
      );
    }

    pdf.save(`${fileName}.pdf`);
    logger.info(`[PDF] Export successful: ${fileName}.pdf`);
  } catch (error) {
    logger.error(`[PDF] Export failed: ${error instanceof Error ? error.message : String(error)}`, { error: String(error) });
    window.scrollTo(0, originalScrollY);
    throw error;
  }
};
