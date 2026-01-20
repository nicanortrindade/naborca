import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';

// ===================================================================
// TIPAGEM E INTERFACES
// ===================================================================

export interface ExportCompositionItem {
    id?: string | number;
    code: string;
    description: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    source?: string;
}

export interface ExportItem {
    id: string | number;
    itemNumber: string;
    code: string;
    description: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    finalPrice?: number; // Valor com BDI (vem do backend)
    type: 'material' | 'labor' | 'equipment' | 'service' | 'group' | 'composition' | string;
    source: string;
    level: number;
    peso?: number;
    pesoRaw?: number; // 0-1 (Fonte da Verdade)
    composition?: ExportCompositionItem[];
    // Campos para identificar CPU
    itemType?: 'insumo' | 'composicao';
    compositionId?: string;
}

export interface CompanySettings {
    name?: string;
    company_name?: string; // fallback
    cnpj?: string;
    logo?: string;
    logo_url?: string;
    address?: string;
    city?: string;
    state?: string;
    email?: string;
    phone?: string;
    responsibleName?: string;
    responsible_name?: string; // fallback
    responsibleCrea?: string;
    responsible_crea?: string; // fallback
    responsibleCpf?: string; // Added Standard CPF
    responsible_cpf?: string; // fallback
}

export interface ScheduleData {
    month: string;
    percentage: number;
    value: number;
}

export interface ExportData {
    budgetName: string;
    clientName: string;
    date: Date;
    bdi: number;
    encargos: number;
    items: ExportItem[];
    companySettings?: CompanySettings;
    scheduleData?: any[];
    constructionSchedule?: {
        months: string[];
        items: {
            itemNumber: string;
            description: string;
            totalValue: number;
            months: { [key: string]: number };
        }[];
    };
    curvaData?: {
        month: string;
        previstoAcumulado: number;
        realizadoAcumulado: number;
    }[];
    chartImageDataUrl?: string;
    // New fields for proper PDF generation
    isDesonerado?: boolean;
    encargosHorista?: number;
    encargosMensalista?: number;
    totalGlobalBase?: number; // Fonte única da verdade
    totalGlobalFinal?: number; // Fonte única da verdade
    banksUsed?: {
        sinapi?: { mes: string; estado: string };
        sbc?: { mes: string; estado: string };
        orse?: { mes: string; estado: string };
        seinfra?: { versao: string; estado: string };
        cpos?: { mes: string };
    };
}

export interface ExportProgressCallback {
    (current: number, total: number, message: string): void;
}

// ===================================================================
// FUNÇÕES AUXILIARES
// ===================================================================

function formatCurrency(value: number): string {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
}

function formatPercent(value: number): string {
    return `${value.toFixed(2)}%`;
}

function getHierarchyLevel(itemNumber: string): 1 | 2 | 3 {
    const trimmed = (itemNumber || '').trim();
    if (!trimmed) return 3;
    const dotCount = (trimmed.match(/\./g) || []).length;
    if (dotCount === 0) return 1;
    if (dotCount === 1) return 2;
    return 3;
}

function sanitizeFilename(name: string): string {
    return name
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9 ]/g, '')
        .trim()
        .replace(/\s+/g, '_');
}

// ===================================================================
// CABEÇALHOS E RODAPÉS
// ===================================================================

function addPDFHeader(doc: jsPDF, title: string, budgetName: string, companySettings?: CompanySettings, details?: { bdi?: number, encargos?: number, isDesonerado?: boolean, encargosHorista?: number, encargosMensalista?: number, banksUsed?: any }) {
    const pageWidth = doc.internal.pageSize.width;
    const logo = companySettings?.logo_url || companySettings?.logo;
    if (logo) {
        try { doc.addImage(logo, 'PNG', 14, 5, 25, 25); } catch (e) { }
    }

    // Company Info (Center)
    doc.setTextColor(30, 58, 138);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    const compName = (companySettings?.name || companySettings?.company_name || 'EMPRESA NÃO CONFIGURADA').toUpperCase();
    doc.text(compName, pageWidth / 2, 12, { align: 'center' });
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
    doc.text(`CNPJ: ${companySettings?.cnpj || '00.000.000/0000-00'}`, pageWidth / 2, 17, { align: 'center' });

    let address = companySettings?.address || '';
    if (companySettings?.city || companySettings?.state) {
        address += ` | ${companySettings?.city || ''}/${companySettings?.state || ''}`;
    }
    doc.setFontSize(7);
    doc.text(address, pageWidth / 2, 21, { align: 'center' });

    // OBRA Info Box + Reference Banks Info
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.1);
    doc.rect(14, 32, pageWidth - 28, 26);

    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('OBRA:', 16, 37);
    doc.setFont('helvetica', 'normal');
    const obraText = budgetName?.toUpperCase() || '';
    doc.text(obraText, 28, 37, { maxWidth: pageWidth / 3 });

    // REFERENCE INFO BLOCK (Right Side)
    if (details) {
        const rightX = pageWidth - 16;
        // Meta Info stacked on the right
        doc.setFont('helvetica', 'bold');
        doc.text(`BDI: ${details.isDesonerado ? 'DESONERADO' : 'NÃO DESONERADO'} - ${(details.bdi || 0).toFixed(2)}%`, rightX, 36, { align: 'right' });

        doc.setFont('helvetica', 'normal');
        const encH = details.encargosHorista || details.encargos || 0;
        const encM = details.encargosMensalista || details.encargos || 0;
        doc.text(`ENCARGOS: Horista ${encH.toFixed(2)}% | Mensalista ${encM.toFixed(2)}%`, rightX, 40, { align: 'right' });

        // Banks Used (moved lower to avoid meta overlap)
        let banksY = 46;
        doc.setFont('helvetica', 'bold');
        doc.text('BASES DE REFERÊNCIA:', rightX - 65, banksY);
        doc.setFont('helvetica', 'normal');
        banksY += 3;
        if (details.banksUsed?.sinapi) {
            doc.text(`SINAPI - ${details.banksUsed.sinapi.mes} - ${details.banksUsed.sinapi.estado}`, rightX - 65, banksY);
            banksY += 3;
        }
        if (details.banksUsed?.sbc) {
            doc.text(`SBC - ${details.banksUsed.sbc.mes} - ${details.banksUsed.sbc.estado}`, rightX - 65, banksY);
            banksY += 3;
        }
        if (details.banksUsed?.orse) {
            doc.text(`ORSE - ${details.banksUsed.orse.mes} - ${details.banksUsed.orse.estado}`, rightX - 65, banksY);
            banksY += 3;
        }
        if (details.banksUsed?.seinfra) {
            doc.text(`SEINFRA - ${details.banksUsed.seinfra.versao} - ${details.banksUsed.seinfra.estado}`, rightX - 65, banksY);
            banksY += 3;
        }
        if (details.banksUsed?.cpos) {
            doc.text(`CPOS/CDHU - ${details.banksUsed.cpos.mes} - SP`, rightX - 65, banksY);
            banksY += 3;
        }
    }

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 58, 138);
    doc.text(title.toUpperCase(), pageWidth / 2, 66, { align: 'center' });
}

function addPDFFinancialSummary(doc: jsPDF, totalSemBDI: number, bdi: number, totalGeral: number) {
    const pageWidth = doc.internal.pageSize.width;
    const finalY = (doc as any).lastAutoTable?.finalY || 100;
    const startY = finalY + 10;

    // Financial Summary Box
    doc.setDrawColor(30, 58, 138);
    doc.setLineWidth(0.5);
    doc.rect(pageWidth / 2, startY, pageWidth / 2 - 14, 30);

    const bdiVal = totalGeral - totalSemBDI;
    const rightX = pageWidth - 18;
    let sumY = startY + 8;

    doc.setFontSize(9);
    // 1. CUSTO TOTAL (SEM BDI) - Black
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.text('CUSTO TOTAL (SEM BDI):', rightX - 75, sumY);
    doc.setFont('helvetica', 'bold');
    doc.text(formatCurrency(totalSemBDI), rightX, sumY, { align: 'right' });

    sumY += 7;
    // 2. VALOR DO BDI - Blue
    doc.setTextColor(30, 58, 138);
    doc.setFont('helvetica', 'normal');
    doc.text(`VALOR BDI (${bdi.toFixed(2)}%):`, rightX - 75, sumY);
    doc.text(formatCurrency(bdiVal), rightX, sumY, { align: 'right' });

    sumY += 7;
    // 3. TOTAL GLOBAL - Blue Bold
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('TOTAL GLOBAL:', rightX - 75, sumY);
    doc.text(formatCurrency(totalGeral), rightX, sumY, { align: 'right' });

    // Update lastAutoTable for footer positioning
    (doc as any).lastAutoTable = { finalY: startY + 35 };
}

function addPDFFooter(doc: jsPDF, companySettings?: CompanySettings, isLastPage: boolean = false) {
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;
    doc.setDrawColor(200, 200, 200);
    doc.line(14, pageHeight - 15, pageWidth - 14, pageHeight - 15);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);

    let addressInfo = companySettings?.address || '';
    if (companySettings?.email) addressInfo += ` | ${companySettings.email}`;
    if (companySettings?.phone) addressInfo += ` | ${companySettings.phone}`;

    doc.text(addressInfo, pageWidth / 2, pageHeight - 10, { align: 'center' });

    if (isLastPage) {
        // Standardized Responsible Block
        doc.setDrawColor(0, 0, 0);
        doc.line(pageWidth / 2 - 40, pageHeight - 45, pageWidth / 2 + 40, pageHeight - 45);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 0, 0);

        const respName = (companySettings?.responsibleName || companySettings?.responsible_name || 'RESPONSÁVEL TÉCNICO').toUpperCase();
        const respCrea = companySettings?.responsibleCrea || companySettings?.responsible_crea || '';
        const respCpf = companySettings?.responsibleCpf || companySettings?.responsible_cpf || '';

        doc.text(respName, pageWidth / 2, pageHeight - 41, { align: 'center' });
        doc.setFont('helvetica', 'normal');

        let subText = '';
        if (respCrea) subText += `CREA/CAU: ${respCrea}`;
        if (respCpf) subText += (subText ? ' | ' : '') + `CPF: ${respCpf}`;
        if (!subText) subText = 'CREA/CAU / CPF NÃO INFORMADO';

        doc.text(subText, pageWidth / 2, pageHeight - 37, { align: 'center' });
    }
}

// Helper to check space and add page if needed for signature
function ensureSpaceForSignature(doc: jsPDF) {
    const pageHeight = doc.internal.pageSize.height;
    const finalY = (doc as any).lastAutoTable?.finalY || 0;
    const footerHeight = 50; // Space needed for signature and footer text

    if (finalY > pageHeight - footerHeight) {
        doc.addPage();
    }
}

function addExcelHeader(
    worksheet: ExcelJS.Worksheet,
    title: string,
    budgetName: string,
    clientName: string,
    companySettings?: CompanySettings,
    columnEnd: string = 'H',
    data?: ExportData
) {
    const compName = (companySettings?.name || companySettings?.company_name || 'EMPRESA N\u00c3O CONFIGURADA').toUpperCase();
    const colEndNum = columnEnd.charCodeAt(0) - 64; // A=1, B=2, etc.

    // Row 1: Logo placeholder + Company Name
    worksheet.mergeCells(`A1:${columnEnd}1`);
    worksheet.getRow(1).height = 30;
    const c1 = worksheet.getCell('A1');
    c1.value = compName;
    c1.font = { bold: true, size: 16, color: { argb: 'FF1E3A8A' } };
    c1.alignment = { horizontal: 'center', vertical: 'middle' };

    // Row 2: CNPJ
    worksheet.mergeCells(`A2:${columnEnd}2`);
    const c2 = worksheet.getCell('A2');
    c2.value = `CNPJ: ${companySettings?.cnpj || '00.000.000/0000-00'}`;
    c2.alignment = { horizontal: 'center', vertical: 'middle' };
    c2.font = { size: 10 };

    // Row 3: Address
    worksheet.mergeCells(`A3:${columnEnd}3`);
    const c3 = worksheet.getCell('A3');
    let address = companySettings?.address || '';
    if (companySettings?.city || companySettings?.state) {
        address += ` | ${companySettings?.city || ''}/${companySettings?.state || ''}`;
    }
    c3.value = address;
    c3.alignment = { horizontal: 'center', vertical: 'middle' };
    c3.font = { size: 9, color: { argb: 'FF666666' } };

    // Row 4: Empty separator
    worksheet.addRow([]);

    // Row 5: Document Title
    worksheet.mergeCells(`A5:${columnEnd}5`);
    worksheet.getRow(5).height = 25;
    const c5 = worksheet.getCell('A5');
    c5.value = title.toUpperCase();
    c5.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    c5.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    c5.alignment = { horizontal: 'center', vertical: 'middle' };

    // Row 6: Project Info
    worksheet.addRow([]);
    const row6 = worksheet.addRow([`OBRA: ${budgetName?.toUpperCase() || ''}`]);
    worksheet.mergeCells(`A7:${columnEnd}7`);
    worksheet.getCell('A7').font = { bold: true, size: 11 };
    worksheet.getCell('A7').alignment = { horizontal: 'left', vertical: 'middle' };

    // Row 7: Client
    const row7 = worksheet.addRow([`CLIENTE: ${clientName?.toUpperCase() || ''}`]);
    worksheet.mergeCells(`A8:${columnEnd}8`);
    worksheet.getCell('A8').font = { bold: true, size: 11 };
    worksheet.getCell('A8').alignment = { horizontal: 'left', vertical: 'middle' };

    // Row 8: Date
    const row8 = worksheet.addRow([`DATA: ${new Date().toLocaleDateString('pt-BR')}`]);
    worksheet.mergeCells(`A9:${columnEnd}9`);
    worksheet.getCell('A9').font = { size: 10, color: { argb: 'FF666666' } };

    // Row 9: Empty separator
    worksheet.addRow([]);

    // Row 10-14: Reference Info Block (if data provided)
    if (data) {
        // Banks Used
        let refInfo = 'BASES DE REFER\u00caNCIA: ';
        if (data.banksUsed?.sinapi) refInfo += `SINAPI (${data.banksUsed.sinapi.mes}/${data.banksUsed.sinapi.estado}) `;
        if (data.banksUsed?.sbc) refInfo += `| SBC (${data.banksUsed.sbc.mes}/${data.banksUsed.sbc.estado}) `;
        if (data.banksUsed?.orse) refInfo += `| ORSE (${data.banksUsed.orse.mes}/${data.banksUsed.orse.estado}) `;
        if (data.banksUsed?.seinfra) refInfo += `| SEINFRA (${data.banksUsed.seinfra.versao}/${data.banksUsed.seinfra.estado}) `;
        if (data.banksUsed?.cpos) refInfo += `| CPOS/CDHU (${data.banksUsed.cpos.mes}/SP) `;
        if (refInfo === 'BASES DE REFER\u00caNCIA: ') refInfo += 'SINAPI/ORSE';

        const rowRef = worksheet.addRow([refInfo]);
        worksheet.mergeCells(`A11:${columnEnd}11`);
        worksheet.getCell('A11').font = { size: 9, color: { argb: 'FF666666' } };
        worksheet.getCell('A11').alignment = { horizontal: 'left', wrapText: true };

        // BDI Info
        const bdiType = data.isDesonerado ? 'DESONERADO' : 'N\u00c3O DESONERADO';
        const bdiInfo = `BDI: ${bdiType} - ${(data.bdi || 0).toFixed(2)}%`;
        const rowBdi = worksheet.addRow([bdiInfo]);
        worksheet.mergeCells(`A12:${columnEnd}12`);
        worksheet.getCell('A12').font = { size: 9, bold: true, color: { argb: 'FF1E3A8A' } };

        // Encargos Info
        const encH = data.encargosHorista || data.encargos || 0;
        const encM = data.encargosMensalista || data.encargos || 0;
        const encInfo = `ENCARGOS SOCIAIS: Horista ${encH.toFixed(2)}% | Mensalista ${encM.toFixed(2)}%`;
        const rowEnc = worksheet.addRow([encInfo]);
        worksheet.mergeCells(`A13:${columnEnd}13`);
        worksheet.getCell('A13').font = { size: 9, color: { argb: 'FF666666' } };

        // Empty separator before table
        worksheet.addRow([]);
    }

    worksheet.addRow([]);
}

function addExcelFooter(worksheet: ExcelJS.Worksheet, companySettings?: CompanySettings, columnEnd: string = 'H') {
    // Add empty rows for spacing
    worksheet.addRow([]);
    worksheet.addRow([]);

    // Responsible Technical Info
    const respName = (companySettings?.responsibleName || companySettings?.responsible_name || 'RESPONS\u00c1VEL T\u00c9CNICO').toUpperCase();
    const respCrea = companySettings?.responsibleCrea || companySettings?.responsible_crea || '';
    const respCpf = companySettings?.responsibleCpf || companySettings?.responsible_cpf || '';

    const rowNum = worksheet.rowCount + 1;

    // Line separator
    const sepRow = worksheet.addRow(['']);
    worksheet.mergeCells(`A${rowNum}:${columnEnd}${rowNum}`);

    // Responsible Name
    const nameRow = worksheet.addRow([respName]);
    const nameRowNum = worksheet.rowCount;
    worksheet.mergeCells(`A${nameRowNum}:${columnEnd}${nameRowNum}`);
    worksheet.getCell(`A${nameRowNum}`).font = { bold: true, size: 10 };
    worksheet.getCell(`A${nameRowNum}`).alignment = { horizontal: 'center' };

    // CREA/CPF
    let credInfo = '';
    if (respCrea) credInfo += `CREA/CAU: ${respCrea}`;
    if (respCpf) credInfo += (credInfo ? ' | ' : '') + `CPF: ${respCpf}`;
    if (!credInfo) credInfo = 'CREA/CAU / CPF N\u00c3O INFORMADO';

    const credRow = worksheet.addRow([credInfo]);
    const credRowNum = worksheet.rowCount;
    worksheet.mergeCells(`A${credRowNum}:${columnEnd}${credRowNum}`);
    worksheet.getCell(`A${credRowNum}`).font = { size: 9, color: { argb: 'FF666666' } };
    worksheet.getCell(`A${credRowNum}`).alignment = { horizontal: 'center' };

    // Date of emission
    const dateRow = worksheet.addRow([`Emitido em: ${new Date().toLocaleDateString('pt-BR')} \u00e0s ${new Date().toLocaleTimeString('pt-BR')}`]);
    const dateRowNum = worksheet.rowCount;
    worksheet.mergeCells(`A${dateRowNum}:${columnEnd}${dateRowNum}`);
    worksheet.getCell(`A${dateRowNum}`).font = { size: 8, italic: true, color: { argb: 'FF999999' } };
    worksheet.getCell(`A${dateRowNum}`).alignment = { horizontal: 'center' };
}

function applyExcelTableFormatting(worksheet: ExcelJS.Worksheet, headerRowNum: number, dataStartRow: number, columnCount: number) {
    // Style header row
    const headerRow = worksheet.getRow(headerRowNum);
    headerRow.height = 22;
    headerRow.eachCell((cell, colNumber) => {
        if (colNumber <= columnCount) {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };
        }
    });

    // Style data rows with zebra striping
    for (let i = dataStartRow; i <= worksheet.rowCount; i++) {
        const row = worksheet.getRow(i);
        const isEven = (i - dataStartRow) % 2 === 0;

        row.eachCell((cell, colNumber) => {
            if (colNumber <= columnCount) {
                // Alignment - center all cells
                cell.alignment = {
                    horizontal: 'center',
                    vertical: 'middle',
                    wrapText: true
                };

                // Zebra striping
                if (isEven) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
                }

                // Borders
                cell.border = {
                    top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                    left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                    bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                    right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
                };
            }
        });
    }
}

function autoFitExcelColumns(worksheet: ExcelJS.Worksheet) {
    worksheet.columns.forEach((column, index) => {
        let maxLength = 10; // Minimum width

        column.eachCell?.({ includeEmpty: true }, (cell) => {
            const cellValue = cell.value?.toString() || '';
            const lines = cellValue.split('\\n');
            const longestLine = lines.reduce((a, b) => a.length > b.length ? a : b, '');
            maxLength = Math.max(maxLength, longestLine.length + 2);
        });

        // Cap the maximum width to prevent extremely wide columns
        column.width = Math.min(maxLength, 60);
    });
}


// ===================================================================
// EXPORTAÇÕES DIRETAS
// ===================================================================


function getExportFilename(prefix: string, budgetName: string, includeDate: boolean = false) {
    const safeName = sanitizeFilename(budgetName).toUpperCase();
    const dateStr = includeDate ? `_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}` : '';
    return `${prefix}_${safeName}${dateStr}`;
}

export async function exportPDFSynthetic(data: ExportData) {
    const buffer = await generatePDFSyntheticBuffer(data);
    const blob = new Blob([buffer], { type: 'application/pdf' });
    saveAs(blob, `${getExportFilename('ORCAMENTO_SINTETICO', data.budgetName, true)}.pdf`);
}

export async function exportExcelSynthetic(data: ExportData) {
    const buffer = await generateExcelSyntheticBuffer(data);
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, `${getExportFilename('ORCAMENTO_SINTETICO', data.budgetName, true)}.xlsx`);
}

export async function exportPDFAnalytic(data: ExportData) {
    const buffer = await generatePDFAnalyticBuffer(data);
    const blob = new Blob([buffer], { type: 'application/pdf' });
    saveAs(blob, `${getExportFilename('ORCAMENTO_ANALITICO', data.budgetName, true)}.pdf`);
}

export async function exportExcelAnalytic(data: ExportData) {
    const buffer = await generateExcelAnalyticBuffer(data);
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, `${getExportFilename('ORCAMENTO_ANALITICO', data.budgetName, true)}.xlsx`);
}

export async function exportABCServicos(data: ExportData) {
    const buffer = await generatePDFABCBuffer(data, 'servicos');
    const blob = new Blob([buffer], { type: 'application/pdf' });
    await saveAs(blob, `${getExportFilename('CURVA_ABC_SERVICOS', data.budgetName)}.pdf`);
}

export async function exportABCInsumos(data: ExportData) {
    const buffer = await generatePDFABCBuffer(data, 'insumos');
    const blob = new Blob([buffer], { type: 'application/pdf' });
    await saveAs(blob, `${getExportFilename('CURVA_ABC_INSUMOS', data.budgetName)}.pdf`);
}

export async function exportABCServicosExcel(data: ExportData) {
    const buffer = await generateExcelABCBuffer(data, 'servicos');
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await saveAs(blob, `${getExportFilename('CURVA_ABC_SERVICOS', data.budgetName)}.xlsx`);
}

export async function exportABCInsumosExcel(data: ExportData) {
    const buffer = await generateExcelABCBuffer(data, 'insumos');
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await saveAs(blob, `${getExportFilename('CURVA_ABC_INSUMOS', data.budgetName)}.xlsx`);
}

export async function exportScheduleExcel(data: ExportData) {
    const buffer = await generateExcelScheduleBuffer(data);
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await saveAs(blob, `${getExportFilename('CRONOGRAMA_FISICO_FINANCEIRO', data.budgetName)}.xlsx`);
}

export async function exportSchedulePDF(data: ExportData) {
    const buffer = await generatePDFScheduleBuffer(data);
    const blob = new Blob([buffer], { type: 'application/pdf' });
    await saveAs(blob, `${getExportFilename('CRONOGRAMA_FISICO_FINANCEIRO', data.budgetName)}.pdf`);
}

export async function exportCurvaSExcel(data: ExportData) {
    const buffer = await generateExcelCurvaSBuffer(data);
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await saveAs(blob, `${getExportFilename('CURVA_S', data.budgetName)}.xlsx`);
}


export async function exportCurvaSPDF(data: ExportData) {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    addPDFHeader(doc, 'CURVA S - PREVISTO VS REALIZADO', data.budgetName, data.companySettings, { bdi: data.bdi });

    if (data.chartImageDataUrl) {
        try { doc.addImage(data.chartImageDataUrl, 'PNG', 14, 65, 180, 100); } catch (e) { } // Moved image Y to 65
    }

    const tableData = (data.curvaData || []).map(item => [
        item.month,
        `${item.previstoAcumulado.toFixed(2)}%`,
        `${item.realizadoAcumulado.toFixed(2)}%`
    ]);

    autoTable(doc, {
        startY: data.chartImageDataUrl ? 170 : 65, // Adjusted startY to 65 (or 170 if image exists)
        head: [['MÊS', 'PREVISTO ACUM. (%)', 'REALIZADO ACUM. (%)']],
        body: tableData,
        headStyles: { fillColor: [30, 58, 138] },
        theme: 'grid'
    });

    ensureSpaceForSignature(doc);
    addPDFFooter(doc, data.companySettings, true);

    const blob = doc.output('blob');
    await saveAs(blob, `09_Curva_S_${sanitizeFilename(data.budgetName)}.pdf`);
}

// ===================================================================
// GERADORES DE BUFFER (CORE)
// ===================================================================

export async function generatePDFSyntheticBuffer(data: ExportData): Promise<ArrayBuffer> {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    // BUG A FIX: Usar totais vindos do Engine (Fonte única da verdade)
    const totalSemBDI = data.totalGlobalBase ?? data.items.reduce((acc, item) => acc + (item.type === 'group' ? 0 : (item.totalPrice || 0)), 0);
    const totalGeral = data.totalGlobalFinal ?? data.items.reduce((acc, item) => acc + (item.type === 'group' ? 0 : (item.finalPrice || item.totalPrice || 0)), 0);

    // Header with reference info (no financial summary)
    addPDFHeader(doc, 'ORÇAMENTO SINTÉTICO', data.budgetName, data.companySettings, {
        bdi: data.bdi,
        encargos: data.encargos,
        isDesonerado: data.isDesonerado,
        encargosHorista: data.encargosHorista,
        encargosMensalista: data.encargosMensalista,
        banksUsed: data.banksUsed
    });

    // GERAÇÃO SINTÉTICA (Limpa e Direta)
    const tableData = data.items.map(item => {
        // Dados já vêm limpos de visibleRows/flattened
        // Apenas formatação visual permitida aqui

        // Cast para acessar propriedades flat se necessário ou usar item direto se tipagem bater
        const i: any = item;
        const unitBDI = i.unitPriceWithBDI; // Já calculado no BudgetEditor
        const quantity = i.quantity; // Undefined p/ grupo
        const unitPrice = i.unitPrice; // Undefined p/ grupo

        return [
            item.itemNumber,
            item.code || '',
            item.source || '',
            item.description,
            item.unit || '',
            quantity != null ? quantity.toFixed(2) : '',
            unitPrice != null ? formatCurrency(unitPrice) : '',
            unitBDI != null ? formatCurrency(unitBDI) : '',
            formatCurrency(item.totalPrice || item.finalPrice || 0),
            formatPercent((i.pesoRaw || 0) * 100) // Formata 0-1 -> 0-100%
        ];
    });
    autoTable(doc, {
        startY: 75,
        head: [['ITEM', 'CÓDIGO', 'BANCO', 'DESCRIÇÃO', 'UND', 'QTD', 'UNIT', 'UNIT/BDI', 'TOTAL', 'PESO']],
        body: tableData,
        headStyles: { fillColor: [30, 58, 138], fontSize: 7 },
        styles: { fontSize: 7 },
        didParseCell: (d) => {
            const rowIndex = d.row.index;
            const level = getHierarchyLevel(data.items[rowIndex]?.itemNumber || '');
            if (level === 1) { d.cell.styles.fillColor = [30, 58, 138]; d.cell.styles.textColor = [255, 255, 255]; d.cell.styles.fontStyle = 'bold'; }
            else if (level === 2) { d.cell.styles.fillColor = [219, 234, 254]; d.cell.styles.fontStyle = 'bold'; }
        }
    });

    // Financial Summary at the END
    addPDFFinancialSummary(doc, totalSemBDI, data.bdi || 0, totalGeral);

    ensureSpaceForSignature(doc);
    addPDFFooter(doc, data.companySettings, true);
    return doc.output('arraybuffer');
}

export async function generateExcelSyntheticBuffer(data: ExportData): Promise<ArrayBuffer> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Sint\u00e9tico');
    const bdiFactor = 1 + (data.bdi || 0) / 100;

    // Configure columns with minimum widths
    worksheet.columns = [
        { header: 'ITEM', key: 'item', width: 12 },
        { header: 'C\u00d3DIGO', key: 'code', width: 14 },
        { header: 'BANCO', key: 'source', width: 10 },
        { header: 'DESCRI\u00c7\u00c3O', key: 'description', width: 50 },
        { header: 'UND', key: 'unit', width: 8 },
        { header: 'QTD', key: 'quantity', width: 12 },
        { header: 'UNIT', key: 'unitPrice', width: 15 },
        { header: 'UNIT/BDI', key: 'unitPriceBdi', width: 15 },
        { header: 'TOTAL', key: 'total', width: 18 },
        { header: 'PESO (%)', key: 'weight', width: 12 }
    ];

    // Add comprehensive header with project/company info
    addExcelHeader(worksheet, 'OR\u00c7AMENTO SINT\u00c9TICO', data.budgetName, data.clientName, data.companySettings, 'J', data);

    // Track header row number
    const headerRowNum = worksheet.rowCount + 1;
    const headerRow = worksheet.addRow(['ITEM', 'C\u00d3DIGO', 'BANCO', 'DESCRI\u00c7\u00c3O', 'UND', 'QTD', 'UNIT', 'UNIT/BDI', 'TOTAL', 'PESO (%)']);
    headerRow.height = 22;
    headerRow.eachCell((cell, colNumber) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    });

    // BUG A FIX: Usar totais vindos do Engine (Fonte única da verdade)
    const totalSemBDI = data.totalGlobalBase ?? data.items.reduce((acc, item) => acc + (item.type === 'group' ? 0 : (item.totalPrice || 0)), 0);
    const totalGeral = data.totalGlobalFinal ?? (totalSemBDI * (1 + (data.bdi || 0) / 100));
    const dataStartRow = worksheet.rowCount + 1;

    // EXCEL SINTÉTICO (Direto)
    data.items.forEach((item, index) => {
        const i: any = item;
        const level = getHierarchyLevel(item.itemNumber);
        const isEven = index % 2 === 0;
        const isGroup = item.type === 'group';

        // Peso Raw (0-1) para Excel formatar
        const pesoRaw = i.pesoRaw || 0;

        const row = worksheet.addRow([
            item.itemNumber,
            item.code, // Já limpo
            item.source, // Já limpo
            item.description,
            item.unit, // Já limpo
            item.quantity, // Value or undefined
            item.unitPrice,
            i.unitPriceWithBDI,
            (item.totalPrice || item.finalPrice),
            pesoRaw
        ]);

        // Apply formatting to each cell
        row.eachCell((cell, colNumber) => {
            // Center alignment and wrap text
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

            // Description column - left align for readability
            if (colNumber === 4) {
                cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
            }

            // Borders
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
            };

            // Zebra striping (unless it has special level styling)
            if (level > 2 && isEven) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
            }
        });

        // Number formatting
        row.getCell(6).numFmt = '#,##0.00';
        row.getCell(7).numFmt = '"R$ "#,##0.00';
        row.getCell(8).numFmt = '"R$ "#,##0.00';
        row.getCell(9).numFmt = '"R$ "#,##0.00';
        row.getCell(10).numFmt = '0.00%';

        // Level styling
        if (level === 1) {
            row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
            row.font = { color: { argb: 'FFFFFFFF' }, bold: true };
        } else if (level === 2) {
            row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
            row.font = { bold: true };
        }
    });

    // Financial Summary
    worksheet.addRow([]);
    const summaryStart = worksheet.rowCount + 1;

    const sumRow1 = worksheet.addRow(['', '', '', '', '', '', '', 'TOTAL SEM BDI', totalSemBDI, '']);
    sumRow1.font = { bold: true };
    sumRow1.getCell(9).numFmt = '"R$ "#,##0.00';
    sumRow1.getCell(8).alignment = { horizontal: 'right' };
    sumRow1.getCell(9).alignment = { horizontal: 'right' };

    const sumRow2 = worksheet.addRow(['', '', '', '', '', '', '', `BDI (${data.bdi}%)`, totalSemBDI * (data.bdi / 100), '']);
    sumRow2.font = { bold: true };
    sumRow2.getCell(9).numFmt = '"R$ "#,##0.00';
    sumRow2.getCell(8).alignment = { horizontal: 'right' };
    sumRow2.getCell(9).alignment = { horizontal: 'right' };

    const totalRow = worksheet.addRow(['', '', '', '', '', '', '', 'TOTAL GLOBAL', totalGeral, '']);
    totalRow.font = { bold: true, size: 12 };
    totalRow.getCell(9).numFmt = '"R$ "#,##0.00';
    totalRow.getCell(8).alignment = { horizontal: 'right' };
    totalRow.getCell(9).alignment = { horizontal: 'right' };
    totalRow.getCell(9).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };

    // Add footer with responsible tech info
    addExcelFooter(worksheet, data.companySettings, 'J');

    return await workbook.xlsx.writeBuffer();
}


export async function generatePDFAnalyticBuffer(data: ExportData): Promise<ArrayBuffer> {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    // BUG A FIX: Usar totais vindos do Engine (Fonte única da verdade)
    const bdiFactor = 1 + (data.bdi || 0) / 100;
    const totalSemBDI = data.totalGlobalBase ?? data.items.reduce((acc, item) => acc + (item.type === 'group' ? 0 : (item.totalPrice || 0)), 0);
    const totalGeral = data.totalGlobalFinal ?? (totalSemBDI * bdiFactor);

    addPDFHeader(doc, 'ORÇAMENTO ANALÍTICO (CPU)', data.budgetName, data.companySettings, {
        bdi: data.bdi,
        encargos: data.encargos,
        isDesonerado: data.isDesonerado,
        encargosHorista: data.encargosHorista,
        encargosMensalista: data.encargosMensalista,
        banksUsed: data.banksUsed
    });

    // Prepare flattened table data
    const tableData: any[] = [];
    data.items.forEach(item => {
        const itemTotal = (item.totalPrice || 0) * bdiFactor;
        const isGroup = item.type === 'group';

        // Item Row
        tableData.push([
            item.itemNumber,
            isGroup ? '' : (item.code || ''),
            isGroup ? '' : (item.source || ''),
            item.description,
            isGroup ? '' : (item.unit || ''),
            isGroup ? '' : item.quantity.toFixed(2),
            isGroup ? '' : formatCurrency(item.unitPrice),
            isGroup ? '' : formatCurrency(item.unitPrice * bdiFactor),
            formatCurrency(itemTotal)
        ]);

        // Composition Rows
        if (item.composition && item.composition.length > 0) {
            item.composition.forEach(c => {
                tableData.push([
                    '',
                    c.code || '',
                    'INSUMO',
                    `   ${c.description}`,
                    c.unit,
                    c.quantity.toFixed(4),
                    formatCurrency(c.unitPrice),
                    '',
                    formatCurrency(c.totalPrice)
                ]);
            });
        }
    });

    autoTable(doc, {
        startY: 75,
        head: [['ITEM', 'CÓDIGO', 'BANCO', 'DESCRIÇÃO', 'UND', 'QTD/COEF', 'UNIT', 'UNIT/BDI', 'TOTAL']],
        body: tableData,
        headStyles: { fillColor: [30, 58, 138], fontSize: 7 },
        styles: { fontSize: 7, cellPadding: 1 },
        columnStyles: {
            0: { cellWidth: 15 },
            1: { cellWidth: 15 },
            2: { cellWidth: 15 },
            3: { cellWidth: 'auto' },
            4: { cellWidth: 10 },
            5: { cellWidth: 15 },
            6: { cellWidth: 20 },
            7: { cellWidth: 20 },
            8: { cellWidth: 20 }
        },
        didParseCell: (d) => {
            const rowIndex = d.row.index;
            const rowRaw = tableData[rowIndex];

            if (d.section === 'head') return;

            const isItem = rowRaw[0] !== '';

            if (isItem) {
                const level = getHierarchyLevel(rowRaw[0]);
                if (level === 1) {
                    d.cell.styles.fillColor = [30, 58, 138];
                    d.cell.styles.textColor = [255, 255, 255];
                    d.cell.styles.fontStyle = 'bold';
                } else if (level === 2) {
                    d.cell.styles.fillColor = [219, 234, 254];
                    d.cell.styles.fontStyle = 'bold';
                } else {
                    d.cell.styles.fontStyle = 'bold';
                }
            } else {
                d.cell.styles.textColor = [80, 80, 80];
                d.cell.styles.fontStyle = 'italic';
                d.cell.styles.fontSize = 6;
            }
        }
    });

    // Financial Summary at the END
    addPDFFinancialSummary(doc, totalSemBDI, data.bdi || 0, totalGeral);

    ensureSpaceForSignature(doc);
    addPDFFooter(doc, data.companySettings, true);
    return doc.output('arraybuffer');
}

export async function generateExcelAnalyticBuffer(data: ExportData): Promise<ArrayBuffer> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Analítico');
    const bdiFactor = 1 + (data.bdi || 0) / 100;

    worksheet.columns = [
        { header: 'ITEM', width: 10 },
        { header: 'CÓDIGO', width: 12 },
        { header: 'DESCRIÇÃO', width: 60 },
        { header: 'UND', width: 8 },
        { header: 'COEF/QTD', width: 12 },
        { header: 'UNIT', width: 15 },
        { header: 'UNIT/BDI', width: 15 },
        { header: 'TOTAL', width: 18 }
    ];

    addExcelHeader(worksheet, 'ORÇAMENTO ANALÍTICO (CPU)', data.budgetName, data.clientName, data.companySettings, 'H');

    const headerRow = worksheet.addRow(['ITEM', 'CÓDIGO', 'DESCRIÇÃO', 'UND', 'COEF/QTD', 'UNIT', 'UNIT/BDI', 'TOTAL']);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };

    for (const item of data.items) {
        const level = getHierarchyLevel(item.itemNumber);
        if (item.type === 'group') {
            const row = worksheet.addRow([item.itemNumber, '', item.description?.toUpperCase(), '', '', '', '', '']);
            if (level === 1) {
                row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
                row.font = { color: { argb: 'FFFFFFFF' }, bold: true };
            } else {
                row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
                row.font = { bold: true };
            }
            continue;
        }

        // Linha Principal do Item
        const itemRow = worksheet.addRow([
            item.itemNumber,
            item.code,
            item.description,
            item.unit,
            item.quantity,
            item.unitPrice,
            item.unitPrice * bdiFactor,
            item.totalPrice * bdiFactor
        ]);
        itemRow.font = { bold: true };
        itemRow.getCell(6).numFmt = '"R$ "#,##0.00';
        itemRow.getCell(7).numFmt = '"R$ "#,##0.00';
        itemRow.getCell(8).numFmt = '"R$ "#,##0.00';

        // Composições
        if (item.composition) {
            item.composition.forEach(c => {
                const compRow = worksheet.addRow([
                    '',
                    c.code,
                    `   ${c.description}`,
                    c.unit,
                    c.quantity,
                    c.unitPrice,
                    '',
                    c.totalPrice
                ]);
                compRow.font = { size: 9, italic: true, color: { argb: 'FF666666' } };
                compRow.getCell(6).numFmt = '"R$ "#,##0.00';
                compRow.getCell(8).numFmt = '"R$ "#,##0.00';
            });
        }
    }

    const totalSemBDI = data.totalGlobalBase ?? data.items.reduce((acc, item) => acc + (item.type === 'group' ? 0 : (item.totalPrice || 0)), 0);
    const totalGlobalFinal = data.totalGlobalFinal ?? (totalSemBDI * bdiFactor);
    worksheet.addRow([]);
    worksheet.addRow(['', '', '', '', '', '', 'TOTAL SEM BDI', totalSemBDI]).font = { bold: true };
    worksheet.addRow(['', '', '', '', '', '', 'TOTAL COM BDI', totalGlobalFinal]).font = { bold: true };

    return await workbook.xlsx.writeBuffer();
}

export async function generatePDFABCBuffer(data: ExportData, type: 'servicos' | 'insumos'): Promise<ArrayBuffer> {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    // BUG A FIX: Usar totais vindos do Engine (Fonte única da verdade)
    const totalSemBDI = data.totalGlobalBase ?? data.items.reduce((acc, item) => acc + (item.type === 'group' ? 0 : (item.totalPrice || 0)), 0);
    const totalGeral = data.totalGlobalFinal ?? (totalSemBDI * (1 + (data.bdi || 0) / 100));

    addPDFHeader(doc, `CURVA ABC - ${type.toUpperCase()}`, data.budgetName, data.companySettings, {
        bdi: data.bdi,
        encargos: data.encargos,
        isDesonerado: data.isDesonerado,
        encargosHorista: data.encargosHorista,
        encargosMensalista: data.encargosMensalista,
        banksUsed: data.banksUsed
    });
    let rows: any[] = [];
    if (type === 'servicos') {
        const items = data.items.filter(i => i.type !== 'group').sort((a, b) => b.totalPrice - a.totalPrice);
        const total = items.reduce((acc, i) => acc + i.totalPrice, 0);
        let accPeso = 0;
        rows = items.map(i => {
            const peso = (i.totalPrice / total) * 100; accPeso += peso;
            return [accPeso <= 80 ? 'A' : accPeso <= 95 ? 'B' : 'C', i.itemNumber, i.code, i.description, i.unit, i.quantity, formatCurrency(i.unitPrice), formatCurrency(i.totalPrice), formatPercent(peso), formatPercent(accPeso)];
        });
    } else {
        const map = new Map<string, any>();
        data.items.forEach(i => i.composition?.forEach(c => {
            const k = c.code || c.description;
            if (map.has(k)) map.get(k).totalPrice += c.totalPrice;
            else map.set(k, { ...c });
        }));
        const items = Array.from(map.values()).sort((a, b) => b.totalPrice - a.totalPrice);
        const total = items.reduce((acc, i) => acc + i.totalPrice, 0);
        let accPeso = 0;
        rows = items.map(i => {
            const peso = (i.totalPrice / total) * 100; accPeso += peso;
            return [accPeso <= 80 ? 'A' : accPeso <= 95 ? 'B' : 'C', i.code, i.description, i.unit, i.quantity.toFixed(4), formatCurrency(i.unitPrice), formatCurrency(i.totalPrice), formatPercent(peso), formatPercent(accPeso)];
        });
    }
    autoTable(doc, {
        startY: 75,
        head: [['CL', 'ITEM', 'CÓDIGO', 'DESCRIÇÃO', 'UND', 'QTD', 'UNIT', 'TOTAL', '%', 'ACC%']],
        body: rows,
        headStyles: { fillColor: [30, 58, 138], fontSize: 8 },
        styles: { fontSize: 7 },
        didParseCell: (d) => { if (d.row.cells[0]?.text[0] === 'A') d.cell.styles.fillColor = [254, 243, 199]; }
    });

    // Financial Summary at the END
    addPDFFinancialSummary(doc, totalSemBDI, data.bdi || 0, totalGeral);

    ensureSpaceForSignature(doc);
    addPDFFooter(doc, data.companySettings, true);
    return doc.output('arraybuffer');
}


export async function generateExcelABCBuffer(data: ExportData, type: 'servicos' | 'insumos'): Promise<ArrayBuffer> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('ABC');

    worksheet.columns = [
        { header: 'CL', width: 5 },
        { header: 'ITEM', width: 8 },
        { header: 'CÓDIGO', width: 12 },
        { header: 'DESCRIÇÃO', width: 60 },
        { header: 'UND', width: 8 },
        { header: 'QTD', width: 12 },
        { header: 'UNIT', width: 15 },
        { header: 'TOTAL', width: 18 },
        { header: '%', width: 10 },
        { header: 'ACC%', width: 10 }
    ];

    addExcelHeader(worksheet, `CURVA ABC - ${type.toUpperCase()}`, data.budgetName, data.clientName, data.companySettings, 'J', data);

    const headerRow = worksheet.addRow(['CL', 'ITEM', 'CÓDIGO', 'DESCRIÇÃO', 'UND', 'QTD', 'UNIT', 'TOTAL', '%', 'ACC%']);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    headerRow.alignment = { horizontal: 'center' };

    if (type === 'servicos') {
        const items = data.items.filter(i => i.type !== 'group').sort((a, b) => b.totalPrice - a.totalPrice);
        const total = items.reduce((acc, i) => acc + i.totalPrice, 0);
        let accPeso = 0;
        items.forEach(i => {
            const peso = (i.totalPrice / total);
            accPeso += peso;
            const cl = accPeso <= 0.8 ? 'A' : accPeso <= 0.95 ? 'B' : 'C';
            const row = worksheet.addRow([
                cl,
                i.itemNumber,
                i.code,
                i.description,
                i.unit,
                i.quantity,
                i.unitPrice,
                i.totalPrice,
                peso,
                accPeso
            ]);

            row.getCell(7).numFmt = '"R$ "#,##0.00';
            row.getCell(8).numFmt = '"R$ "#,##0.00';
            row.getCell(9).numFmt = '0.00%';
            row.getCell(10).numFmt = '0.00%';

            if (cl === 'A') {
                row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
            }
        });
    } else {
        const map = new Map<string, any>();
        data.items.forEach(i => i.composition?.forEach(c => {
            const k = c.code || c.description;
            if (map.has(k)) map.get(k).totalPrice += c.totalPrice;
            else map.set(k, { ...c });
        }));
        const items = Array.from(map.values()).sort((a, b) => b.totalPrice - a.totalPrice);
        const total = items.reduce((acc, i) => acc + i.totalPrice, 0);
        let accPeso = 0;
        items.forEach(i => {
            const peso = (i.totalPrice / total);
            accPeso += peso;
            const cl = accPeso <= 0.8 ? 'A' : accPeso <= 0.95 ? 'B' : 'C';
            const row = worksheet.addRow([
                cl,
                '',
                i.code,
                i.description,
                i.unit,
                i.quantity,
                i.unitPrice,
                i.totalPrice,
                peso,
                accPeso
            ]);

            row.getCell(7).numFmt = '"R$ "#,##0.00';
            row.getCell(8).numFmt = '"R$ "#,##0.00';
            row.getCell(9).numFmt = '0.00%';
            row.getCell(10).numFmt = '0.00%';

            if (cl === 'A') {
                row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
            }
        });
    }

    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber > 6) {
            row.eachCell(cell => {
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };
            });
        }
    });

    return await workbook.xlsx.writeBuffer();
}



export async function generatePDFScheduleBuffer(data: ExportData): Promise<ArrayBuffer> {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    // Calculate Totals for Header
    const totalSemBDI = data.items.reduce((acc, item) => acc + (item.type === 'group' ? 0 : (item.totalPrice || 0)), 0);
    const bdiFactor = 1 + (data.bdi || 0) / 100;
    const totalGeral = totalSemBDI * bdiFactor;

    addPDFHeader(doc, 'CRONOGRAMA FÍSICO-FINANCEIRO', data.budgetName, data.companySettings, {
        bdi: data.bdi,
        encargos: data.encargos,
        isDesonerado: data.isDesonerado,
        encargosHorista: data.encargosHorista,
        encargosMensalista: data.encargosMensalista,
        banksUsed: data.banksUsed
    });

    const months = data.constructionSchedule?.months || [];
    const body = (data.constructionSchedule?.items || []).map(item => [
        item.itemNumber,
        item.description,
        formatCurrency(item.totalValue),
        ...months.map(m => `${(item.months[m] || 0).toFixed(1)}%`),
        '100%'
    ]);

    autoTable(doc, {
        startY: 75,
        head: [['ITEM', 'DESCRIÇÃO', 'VALOR', ...months, 'TOTAL']],
        body,
        theme: 'grid',
        headStyles: { fillColor: [30, 58, 138], fontSize: 8 },
        styles: { fontSize: 7 },
        didParseCell: (d) => {
            const rowIndex = d.row.index;
            const item = data.constructionSchedule?.items[rowIndex];
            if (item) {
                const level = (item as any).level ?? getHierarchyLevel(item.itemNumber);
                if (level === 1) { d.cell.styles.fillColor = [30, 58, 138]; d.cell.styles.textColor = [255, 255, 255]; d.cell.styles.fontStyle = 'bold'; }
                else if (level === 2) { d.cell.styles.fillColor = [219, 234, 254]; d.cell.styles.fontStyle = 'bold'; }
            }
        }
    });

    // Financial Summary at the END
    addPDFFinancialSummary(doc, totalSemBDI, data.bdi || 0, totalGeral);

    ensureSpaceForSignature(doc);
    addPDFFooter(doc, data.companySettings, true);
    return doc.output('arraybuffer');
}

export async function generateExcelCurvaSBuffer(data: ExportData): Promise<ArrayBuffer> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Curva S');

    addExcelHeader(worksheet, 'CURVA S - PREVISTO VS REALIZADO', data.budgetName, data.clientName, data.companySettings, 'C');

    const headerRow = worksheet.addRow(['MÊS', 'PREVISTO %', 'REALIZADO %']);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    headerRow.alignment = { horizontal: 'center' };

    worksheet.getColumn(1).width = 20;
    worksheet.getColumn(2).width = 20;
    worksheet.getColumn(3).width = 20;

    data.curvaData?.forEach(d => {
        const row = worksheet.addRow([d.month, d.previstoAcumulado / 100, d.realizadoAcumulado / 100]);
        row.getCell(2).numFmt = '0.00%';
        row.getCell(3).numFmt = '0.00%';

        row.eachCell((cell) => {
            cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };
        });
    });

    return await workbook.xlsx.writeBuffer();
}

export async function generatePDFPhysicalScheduleBuffer(data: ExportData): Promise<ArrayBuffer> {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    // Calculate Totals for Header (even if not shown in table, standardized header requires it)
    const totalSemBDI = data.items.reduce((acc, item) => acc + (item.type === 'group' ? 0 : (item.totalPrice || 0)), 0);
    const bdiFactor = 1 + (data.bdi || 0) / 100;
    const totalGeral = totalSemBDI * bdiFactor;

    addPDFHeader(doc, 'CRONOGRAMA FÍSICO', data.budgetName, data.companySettings, {
        bdi: data.bdi,
        encargos: data.encargos,
        isDesonerado: data.isDesonerado,
        encargosHorista: data.encargosHorista,
        encargosMensalista: data.encargosMensalista,
        banksUsed: data.banksUsed
    });

    const months = data.constructionSchedule?.months || [];
    // Physical schedule usually only shows percentages or bars. We will show Item, Desc, and Months (%)
    const body = (data.constructionSchedule?.items || []).map(item => [
        item.itemNumber,
        item.description,
        ...months.map(m => `${(item.months[m] || 0).toFixed(1)}%`),
        '100%'
    ]);

    autoTable(doc, {
        startY: 75,
        head: [['ITEM', 'DESCRIÇÃO', ...months, 'TOTAL']],
        body,
        theme: 'grid',
        headStyles: { fillColor: [30, 58, 138], fontSize: 8 },
        styles: { fontSize: 7 },
        didParseCell: (d) => {
            const rowIndex = d.row.index;
            const item = data.constructionSchedule?.items[rowIndex];
            if (item) {
                const level = (item as any).level ?? getHierarchyLevel(item.itemNumber);
                if (level === 1) { d.cell.styles.fillColor = [30, 58, 138]; d.cell.styles.textColor = [255, 255, 255]; d.cell.styles.fontStyle = 'bold'; }
                else if (level === 2) { d.cell.styles.fillColor = [219, 234, 254]; d.cell.styles.fontStyle = 'bold'; }
            }
        }
    });

    // Financial Summary at the END
    addPDFFinancialSummary(doc, totalSemBDI, data.bdi || 0, totalGeral);

    ensureSpaceForSignature(doc);
    addPDFFooter(doc, data.companySettings, true);
    return doc.output('arraybuffer');
}

export async function generatePDFBDIBuffer(data: ExportData): Promise<ArrayBuffer> {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    // Totals from real data
    const totalSemBDI = data.items.reduce((acc, item) => acc + (item.type === 'group' ? 0 : (item.totalPrice || 0)), 0);
    const bdiFactor = 1 + (data.bdi || 0) / 100;
    const totalGeral = totalSemBDI * bdiFactor;
    const bdiValue = totalGeral - totalSemBDI;

    addPDFHeader(doc, 'COMPOSI\u00c7\u00c3O ANAL\u00cdTICA DO B.D.I.', data.budgetName, data.companySettings, {
        bdi: data.bdi,
        encargos: data.encargos,
        isDesonerado: data.isDesonerado,
        encargosHorista: data.encargosHorista,
        encargosMensalista: data.encargosMensalista,
        banksUsed: data.banksUsed
    });

    const isDesonerado = data.isDesonerado || false;
    const bdiPerc = data.bdi || 0;

    // Standard BDI composition (SINAPI/SICRO reference)
    // Values are percentages, we'll back-calculate to show theoretical composition
    const bdiComposition = [
        { grupo: 'A', desc: 'ADMINISTRA\u00c7\u00c3O CENTRAL (AC)', perc: isDesonerado ? 4.00 : 4.00 },
        { grupo: 'B', desc: 'SEGURO E GARANTIA (S+G)', perc: isDesonerado ? 0.80 : 0.80 },
        { grupo: 'C', desc: 'RISCO (R)', perc: isDesonerado ? 1.27 : 1.27 },
        { grupo: 'D', desc: 'DESPESAS FINANCEIRAS (DF)', perc: isDesonerado ? 0.59 : 0.59 },
        { grupo: 'E', desc: 'LUCRO (L)', perc: isDesonerado ? 6.16 : 6.16 },
    ];

    // Tributos
    const tributos = isDesonerado ? [
        { desc: 'PIS', perc: 0.65 },
        { desc: 'COFINS', perc: 3.00 },
        { desc: 'ISS', perc: 2.00 },
        { desc: 'CPRB (Contribui\u00e7\u00e3o Previdenci\u00e1ria)', perc: 4.50 },
    ] : [
        { desc: 'PIS', perc: 0.65 },
        { desc: 'COFINS', perc: 3.00 },
        { desc: 'ISS', perc: 2.00 },
    ];

    // Calculate totals for display
    const totalAE = bdiComposition.reduce((acc, i) => acc + i.perc, 0);
    const totalTributos = tributos.reduce((acc, i) => acc + i.perc, 0);

    // Table rows
    const tableBody: string[][] = [];
    tableBody.push(['', 'COMPOSI\u00c7\u00c3O DO BDI', '%']);
    bdiComposition.forEach(item => {
        tableBody.push([item.grupo, item.desc, item.perc.toFixed(2)]);
    });
    tableBody.push(['', 'SUBTOTAL (A+B+C+D+E)', totalAE.toFixed(2)]);
    tableBody.push(['', '', '']);
    tableBody.push(['', 'TRIBUTOS', '%']);
    tributos.forEach(item => {
        tableBody.push(['', item.desc, item.perc.toFixed(2)]);
    });
    tableBody.push(['', 'SUBTOTAL TRIBUTOS', totalTributos.toFixed(2)]);
    tableBody.push(['', '', '']);

    // Formula
    const formula = 'BDI = [(1+AC+S+G+R)*(1+DF)*(1+L) / (1 - I)] - 1';
    tableBody.push(['', 'F\u00d3RMULA UTILIZADA:', '']);
    tableBody.push(['', formula, '']);
    tableBody.push(['', '', '']);
    tableBody.push(['', 'B.D.I. CALCULADO (' + (isDesonerado ? 'DESONERADO' : 'N\u00c3O DESONERADO') + ')', bdiPerc.toFixed(2) + '%']);

    autoTable(doc, {
        startY: 80,
        head: [['ITEM', 'DESCRI\u00c7\u00c3O', 'PERCENTUAL']],
        body: tableBody,
        theme: 'grid',
        headStyles: { fillColor: [30, 58, 138], halign: 'center', fontSize: 9 },
        columnStyles: {
            0: { cellWidth: 20, halign: 'center' },
            1: { cellWidth: 130 },
            2: { cellWidth: 30, halign: 'right' }
        },
        styles: { fontSize: 9, cellPadding: 2 },
        didParseCell: (d) => {
            const text = d.cell.text[0] || '';
            if (text.includes('SUBTOTAL') || text.includes('F\u00d3RMULA') || text.includes('B.D.I. CALCULADO')) {
                d.cell.styles.fontStyle = 'bold';
            }
            if (text.includes('B.D.I. CALCULADO')) {
                d.cell.styles.fillColor = [219, 234, 254];
            }
        }
    });

    // Financial Summary
    const summaryY = (doc as any).lastAutoTable.finalY + 15;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('RESUMO FINANCEIRO:', 14, summaryY);
    doc.setFont('helvetica', 'normal');
    doc.text(`Custo Direto Total (Sem BDI): ${formatCurrency(totalSemBDI)}`, 14, summaryY + 6);
    doc.text(`Valor do B.D.I. (${bdiPerc.toFixed(2)}%): ${formatCurrency(bdiValue)}`, 14, summaryY + 12);
    doc.setFont('helvetica', 'bold');
    doc.text(`Pre\u00e7o de Venda Total (Com BDI): ${formatCurrency(totalGeral)}`, 14, summaryY + 18);

    ensureSpaceForSignature(doc);
    addPDFFooter(doc, data.companySettings, true);
    return doc.output('arraybuffer');
}


export async function generatePDFEncargosBuffer(data: ExportData): Promise<ArrayBuffer> {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    addPDFHeader(doc, 'PLANILHA DE ENCARGOS SOCIAIS', data.budgetName, data.companySettings, {
        bdi: data.bdi,
        encargos: data.encargos,
        isDesonerado: data.isDesonerado,
        encargosHorista: data.encargosHorista,
        encargosMensalista: data.encargosMensalista,
        banksUsed: data.banksUsed
    });

    const isDesonerado = data.isDesonerado || false;
    const encH = data.encargosHorista || data.encargos || 0;
    const encM = data.encargosMensalista || data.encargos || 0;

    // Complete Encargos Sociais table (SINAPI reference)
    const grupoA = [
        { cod: 'A1', desc: 'INSS', h: isDesonerado ? 0 : 20.00, m: isDesonerado ? 0 : 20.00 },
        { cod: 'A2', desc: 'SESI', h: 1.50, m: 1.50 },
        { cod: 'A3', desc: 'SENAI', h: 1.00, m: 1.00 },
        { cod: 'A4', desc: 'INCRA', h: 0.20, m: 0.20 },
        { cod: 'A5', desc: 'SEBRAE', h: 0.60, m: 0.60 },
        { cod: 'A6', desc: 'Sal\u00e1rio Educa\u00e7\u00e3o', h: 2.50, m: 2.50 },
        { cod: 'A7', desc: 'Seguro Acidente Trabalho', h: 3.00, m: 3.00 },
        { cod: 'A8', desc: 'FGTS', h: 8.00, m: 8.00 },
    ];

    const grupoB = [
        { cod: 'B1', desc: 'Repouso Semanal Remunerado', h: 17.98, m: 0.00 },
        { cod: 'B2', desc: 'Feriados', h: 3.70, m: 0.00 },
        { cod: 'B3', desc: 'Aux\u00edlio-Enfermidade', h: 0.88, m: 0.65 },
        { cod: 'B4', desc: '13\u00ba Sal\u00e1rio', h: 10.97, m: 8.33 },
        { cod: 'B5', desc: 'Licen\u00e7a Paternidade', h: 0.06, m: 0.05 },
        { cod: 'B6', desc: 'Faltas Justificadas', h: 0.74, m: 0.56 },
        { cod: 'B7', desc: 'Dias de Chuva', h: 2.14, m: 0.00 },
        { cod: 'B8', desc: 'Aux\u00edlio Acidente Trabalho', h: 0.10, m: 0.07 },
        { cod: 'B9', desc: 'F\u00e9rias Gozadas', h: 9.09, m: 9.09 },
        { cod: 'B10', desc: 'Sal\u00e1rio Maternidade', h: 0.03, m: 0.02 },
    ];

    const grupoC = [
        { cod: 'C1', desc: 'Aviso Pr\u00e9vio Indenizado', h: 5.45, m: 4.13 },
        { cod: 'C2', desc: 'Aviso Pr\u00e9vio Trabalhado', h: 0.13, m: 0.10 },
        { cod: 'C3', desc: 'F\u00e9rias Indenizadas', h: 3.52, m: 2.67 },
        { cod: 'C4', desc: 'Dep\u00f3sito Rescis\u00e3o Sem Justa Causa', h: 3.24, m: 2.46 },
        { cod: 'C5', desc: 'Indeniza\u00e7\u00e3o Adicional', h: 0.49, m: 0.37 },
    ];

    const grupoD = [
        { cod: 'D1', desc: 'Reincid\u00eancia Grupo A sobre B', h: isDesonerado ? 7.50 : 18.10, m: isDesonerado ? 2.85 : 6.87 },
        { cod: 'D2', desc: 'Reincid\u00eancia A sobre Aviso Pr\u00e9vio', h: isDesonerado ? 0.20 : 0.47, m: isDesonerado ? 0.15 : 0.35 },
    ];

    const calcTotal = (items: any[]) => ({
        h: items.reduce((a, i) => a + i.h, 0),
        m: items.reduce((a, i) => a + i.m, 0)
    });

    const totalA = calcTotal(grupoA);
    const totalB = calcTotal(grupoB);
    const totalC = calcTotal(grupoC);
    const totalD = calcTotal(grupoD);
    const totalGeral = {
        h: totalA.h + totalB.h + totalC.h + totalD.h,
        m: totalA.m + totalB.m + totalC.m + totalD.m
    };

    // Build table
    const tableBody: string[][] = [];
    tableBody.push(['', 'GRUPO A - ENCARGOS SOCIAIS B\u00c1SICOS', '', '']);
    grupoA.forEach(i => tableBody.push([i.cod, i.desc, i.h.toFixed(2), i.m.toFixed(2)]));
    tableBody.push(['', 'SUBTOTAL GRUPO A', totalA.h.toFixed(2), totalA.m.toFixed(2)]);
    tableBody.push(['', '', '', '']);

    tableBody.push(['', 'GRUPO B - ENCARGOS QUE RECEBEM INCID\u00caNCIA DE A', '', '']);
    grupoB.forEach(i => tableBody.push([i.cod, i.desc, i.h.toFixed(2), i.m.toFixed(2)]));
    tableBody.push(['', 'SUBTOTAL GRUPO B', totalB.h.toFixed(2), totalB.m.toFixed(2)]);
    tableBody.push(['', '', '', '']);

    tableBody.push(['', 'GRUPO C - ENCARGOS QUE N\u00c3O RECEBEM INCID\u00caNCIA DE A', '', '']);
    grupoC.forEach(i => tableBody.push([i.cod, i.desc, i.h.toFixed(2), i.m.toFixed(2)]));
    tableBody.push(['', 'SUBTOTAL GRUPO C', totalC.h.toFixed(2), totalC.m.toFixed(2)]);
    tableBody.push(['', '', '', '']);

    tableBody.push(['', 'GRUPO D - TAXAS DE REINCID\u00caNCIA', '', '']);
    grupoD.forEach(i => tableBody.push([i.cod, i.desc, i.h.toFixed(2), i.m.toFixed(2)]));
    tableBody.push(['', 'SUBTOTAL GRUPO D', totalD.h.toFixed(2), totalD.m.toFixed(2)]);
    tableBody.push(['', '', '', '']);

    tableBody.push(['', 'TOTAL GERAL (A+B+C+D)', totalGeral.h.toFixed(2), totalGeral.m.toFixed(2)]);

    autoTable(doc, {
        startY: 80,
        head: [['C\u00d3D', 'DESCRI\u00c7\u00c3O', 'HORISTA %', 'MENSALISTA %']],
        body: tableBody,
        theme: 'grid',
        headStyles: { fillColor: [30, 58, 138], halign: 'center', fontSize: 8 },
        columnStyles: {
            0: { cellWidth: 15, halign: 'center' },
            1: { cellWidth: 110 },
            2: { cellWidth: 28, halign: 'right' },
            3: { cellWidth: 28, halign: 'right' }
        },
        styles: { fontSize: 8, cellPadding: 1.5 },
        didParseCell: (d) => {
            const text = d.cell.text[0] || '';
            if (text.includes('GRUPO') || text.includes('SUBTOTAL') || text.includes('TOTAL GERAL')) {
                d.cell.styles.fontStyle = 'bold';
            }
            if (text.includes('TOTAL GERAL')) {
                d.cell.styles.fillColor = [219, 234, 254];
            }
        }
    });

    // Footer info
    const infoY = (doc as any).lastAutoTable.finalY + 10;
    doc.setFontSize(8);
    doc.setTextColor(80, 80, 80);
    doc.text(`Tipo: ${isDesonerado ? 'DESONERADO (Lei 12.546/2011)' : 'N\u00c3O DESONERADO'}`, 14, infoY);
    doc.text(`Refer\u00eancia: SINAPI/IBGE - ${new Date().toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}`, 14, infoY + 5);
    doc.text(`Encargos Utilizados: Horista ${encH.toFixed(2)}% | Mensalista ${encM.toFixed(2)}%`, 14, infoY + 10);

    ensureSpaceForSignature(doc);
    addPDFFooter(doc, data.companySettings, true);
    return doc.output('arraybuffer');
}


// ===================================================================
// EXPORTAÇÃO COMPLETA (ZIP)
// ===================================================================

export async function exportCompleteProject(data: ExportData, onProgress?: ExportProgressCallback) {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    const nameClean = sanitizeFilename(data.budgetName);

    const pdfFolder = zip.folder("PDF");
    const xlsxFolder = zip.folder("Excel");

    // Total steps estimation: Synt (2), Analyt (2), Sched (2), ABC/BDI (4) = 10
    const totalSteps = 10;
    let currentStep = 0;

    const updateProgress = (msg: string) => {
        currentStep++;
        onProgress?.(currentStep, totalSteps, msg);
    };

    // 1. Sintetico (PDF + Excel)
    updateProgress('Gerando Orçamento Sintético (PDF)...');
    const sintPDF = await generatePDFSyntheticBuffer(data);
    pdfFolder?.file(`Orcamento_Sintetico.pdf`, sintPDF);

    updateProgress('Gerando Orçamento Sintético (Excel)...');
    const sintExcel = await generateExcelSyntheticBuffer(data);
    xlsxFolder?.file(`Orcamento_Sintetico.xlsx`, sintExcel);

    // 2. Analitico (PDF + Excel)
    updateProgress('Gerando Orçamento Analítico (PDF)...');
    const analPDF = await generatePDFAnalyticBuffer(data);
    pdfFolder?.file(`Orcamento_Analitico.pdf`, analPDF);

    updateProgress('Gerando Orçamento Analítico (Excel)...');
    const analExcel = await generateExcelAnalyticBuffer(data);
    xlsxFolder?.file(`Orcamento_Analitico.xlsx`, analExcel);

    // 3. Cronograma (PDF + Excel) - se existir
    if (data.constructionSchedule) {
        updateProgress('Gerando Cronograma (PDF)...');
        const cronPDF = await generatePDFScheduleBuffer(data);
        pdfFolder?.file(`Cronograma_Fisico_Financeiro.pdf`, cronPDF);

        updateProgress('Gerando Cronograma (Excel)...');
        const cronExcel = await generateExcelScheduleBuffer(data);
        xlsxFolder?.file(`Cronograma_Fisico_Financeiro.xlsx`, cronExcel);
    }

    // 4. Outros Relatórios (Apenas PDF por enquanto, ou conforme demanda futura)
    updateProgress('Gerando Curva ABC Insumos...');
    const abcIns = await generatePDFABCBuffer(data, 'insumos');
    pdfFolder?.file(`Curva_ABC_Insumos.pdf`, abcIns);

    updateProgress('Gerando Curva ABC Serviços...');
    const abcServ = await generatePDFABCBuffer(data, 'servicos');
    pdfFolder?.file(`Curva_ABC_Servicos.pdf`, abcServ);

    updateProgress('Gerando BDI...');
    const bdiPDF = await generatePDFBDIBuffer(data);
    pdfFolder?.file(`Demonstrativo_BDI.pdf`, bdiPDF);

    updateProgress('Gerando Encargos...');
    const encPDF = await generatePDFEncargosBuffer(data);
    pdfFolder?.file(`Demonstrativo_Encargos.pdf`, encPDF);

    updateProgress('Compactando pacote...');
    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, `Projeto_Completo_${nameClean}.zip`);
}

/**
 * Determina se um item requer analítica (é uma Composição/CPU).
 * Critério: itemType='composicao' OU tem compositionId definido.
 */
export function isAnalyticRequiredItem(item: ExportItem): boolean {
    if (item.type === 'group') return false;

    // SINAL ÚNICO DE CPU: Tem compositionId definido
    if (item.compositionId && item.compositionId.length > 0) return true;

    return false;
}

export function validateAnalytics(items: ExportItem[]): ExportItem[] {
    const rawCompositions: ExportItem[] = [];

    items.forEach(item => {
        // Usar função canônica para detectar CPU
        if (isAnalyticRequiredItem(item)) {
            // Verificar se tem filhos
            const hasChildren = item.composition && item.composition.length > 0;
            if (!hasChildren) {
                rawCompositions.push(item);
            }
        }
    });

    return rawCompositions;
}

export async function generateExcelScheduleBuffer(data: ExportData): Promise<ArrayBuffer> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Cronograma');

    const months = data.constructionSchedule?.months || [];

    // Config Columns: Item(10), Desc(50), Months(15...), Total(18)
    const columns: any[] = [
        { header: 'ITEM', key: 'item', width: 10 },
        { header: 'DESCRIÇÃO', key: 'desc', width: 50 },
    ];
    months.forEach(m => columns.push({ header: m.toUpperCase(), key: m, width: 18 }));
    columns.push({ header: 'TOTAL', key: 'total', width: 18 });

    worksheet.columns = columns;

    // Header Info
    // Assuming addExcelHeader handles merging and title
    const lastColLetter = getExcelColLetter(columns.length);
    addExcelHeader(worksheet, 'CRONOGRAMA FÍSICO-FINANCEIRO', data.budgetName, data.clientName, data.companySettings, lastColLetter, data);

    // Table Header
    const headerValues = ['ITEM', 'DESCRIÇÃO', ...months.map(m => m.toUpperCase()), 'TOTAL'];
    const headerRow = worksheet.addRow(headerValues);

    headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    // Content
    const items = data.constructionSchedule?.items || [];

    items.forEach((item, index) => {
        const isEven = index % 2 === 0;
        const level = getHierarchyLevel(item.itemNumber);

        const rowValues = [
            item.itemNumber,
            item.description,
            ...months.map(m => item.months[m] || 0),
            item.totalValue
        ];

        const row = worksheet.addRow(rowValues);

        // Style & Format
        row.eachCell((cell, colNum) => {
            cell.border = { top: { style: 'thin', color: { argb: 'FFE2E8F0' } }, left: { style: 'thin', color: { argb: 'FFE2E8F0' } }, bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
            cell.alignment = { vertical: 'middle', horizontal: colNum > 2 ? 'right' : 'left' };
            if (colNum === 1) cell.alignment = { horizontal: 'center' };

            // Zebra
            if (level > 2 && isEven) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };

            // Currency Format for months and total
            if (colNum > 2) {
                cell.numFmt = '"R$ "#,##0.00';
            }
        });

        // Level Styling
        if (level === 1) {
            row.eachCell(c => {
                c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
                c.font = { color: { argb: 'FFFFFFFF' }, bold: true };
            });
        } else if (level === 2) {
            row.eachCell(c => {
                c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
                c.font = { bold: true };
            });
        }
    });

    // Footer Summary
    // Calculate totals per month
    const totalRowValues = ['', 'TOTAL GERAL'];
    let globalTotal = 0;

    months.forEach(m => {
        const sumMonth = items.reduce((acc, i) => {
            // Only sum level 1 items to avoid double counting? Or sum items that correspond to root?
            // Usually dataset has hierarchy. If we sum all, we duplicate.
            // Heuristic: Sum items where hierarchy level is 1.
            if (getHierarchyLevel(i.itemNumber) === 1) return acc + (i.months[m] || 0);
            return acc;
        }, 0);
        totalRowValues.push(sumMonth as any);
        globalTotal += sumMonth;
    });
    totalRowValues.push(globalTotal as any);

    const totalRow = worksheet.addRow(totalRowValues);
    totalRow.font = { bold: true };
    totalRow.eachCell((cell, colNum) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
        if (colNum > 2) cell.numFmt = '"R$ "#,##0.00';
        cell.border = { top: { style: 'thin' } };
    });

    addExcelFooter(worksheet, data.companySettings, lastColLetter);

    return await workbook.xlsx.writeBuffer();
}

// Helper to get Excel Column Letter (A, B, ... AA, AB)
function getExcelColLetter(colIndex: number): string {
    let temp, letter = '';
    while (colIndex > 0) {
        temp = (colIndex - 1) % 26;
        letter = String.fromCharCode(temp + 65) + letter;
        colIndex = (colIndex - temp - 1) / 26;
    }
    return letter;
}

/**
 * Função saveAs polyfill/helper
 */
async function saveAs(blob: Blob, name: string) {
    const { saveAs: fileSaverSaveAs } = await import('file-saver');
    fileSaverSaveAs(blob, name);
}
