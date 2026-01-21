import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import {
    getAdjustedItemValues,
    calculateAdjustmentFactors,
    type GlobalAdjustmentV2,
    getAdjustedBudgetTotals
} from './globalAdjustment';

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
    unitPriceWithBDI?: number; // Pre-calculated unit price with BDI
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
    adjustmentSettings?: GlobalAdjustmentV2;
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
    const pageHeight = doc.internal.pageSize.height;
    let finalY = (doc as any).lastAutoTable?.finalY || 100;

    // Check if there is enough space for the summary box (~40 units) 
    // keeping a safe bottom margin for the footer/signature (~50 units).
    if (finalY + 50 > pageHeight - 50) {
        doc.addPage();
        finalY = 20; // Reset Y for the new page
    }

    const startY = finalY + 10;

    // Financial Summary Box
    doc.setDrawColor(30, 58, 138);
    doc.setLineWidth(0.5);
    doc.rect(pageWidth / 2, startY, pageWidth / 2 - 14, 30);

    // REGRA DE OURO: Usar os totais passados (que já são ajustados e SSOT)
    // Recalcular componentes para exibição consistente
    const valBdi = totalGeral - totalSemBDI;

    // Safety check for display
    const finalSemBdi = totalSemBDI;
    const finalBdi = valBdi;
    const finalGeral = totalGeral;

    const rightX = pageWidth - 18;
    let sumY = startY + 8;

    doc.setFontSize(9);
    // 1. CUSTO TOTAL (SEM BDI) - Black
    // 1. CUSTO TOTAL (SEM BDI) -> TOTAL
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.text('TOTAL:', rightX - 75, sumY);
    doc.setFont('helvetica', 'bold');
    doc.text(formatCurrency(finalSemBdi), rightX, sumY, { align: 'right' });

    sumY += 7;
    // 2. VALOR DO BDI - Blue
    doc.setTextColor(30, 58, 138);
    doc.setFont('helvetica', 'normal');
    doc.text(`VALOR BDI (${bdi.toFixed(2)}%):`, rightX - 75, sumY);
    doc.text(formatCurrency(finalBdi), rightX, sumY, { align: 'right' });

    sumY += 7;
    // 3. TOTAL GLOBAL - Blue Bold
    // 3. TOTAL GLOBAL -> TOTAL GERAL
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('TOTAL GERAL:', rightX - 75, sumY);
    doc.text(formatCurrency(finalGeral), rightX, sumY, { align: 'right' });

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
    const compName = (companySettings?.company_name || companySettings?.name || 'EMPRESA N\u00c3O CONFIGURADA').toUpperCase();
    const cnpj = companySettings?.cnpj || '00.000.000/0000-00';
    const address = `${companySettings?.address || ''} ${companySettings?.city || ''}/${companySettings?.state || ''}`.trim() || 'Endere\u00e7o n\u00e3o cadastrado';
    const email = companySettings?.email || '';
    const phone = companySettings?.phone || '';
    const contactInfo = [email, phone].filter(Boolean).join(' | ');

    const respName = companySettings?.responsible_name || companySettings?.responsibleName || 'Respons\u00e1vel n\u00e3o cadastrado';
    const respCrea = companySettings?.responsible_crea || companySettings?.responsibleCrea || '000.000-0';
    const respCpf = companySettings?.responsible_cpf || companySettings?.responsibleCpf || '000.000.000-00';
    const technicalInfo = `Respons\u00e1vel T\u00e9cnico: ${respName} | CREA/CAU: ${respCrea} | CPF: ${respCpf}`;

    // Row 1: Company Name
    worksheet.mergeCells(`A1:${columnEnd}1`);
    worksheet.getRow(1).height = 30;
    const c1 = worksheet.getCell('A1');
    c1.value = compName;
    c1.font = { bold: true, size: 16, color: { argb: 'FF1E3A8A' } };
    c1.alignment = { horizontal: 'center', vertical: 'middle' };

    // Row 2: CNPJ
    worksheet.mergeCells(`A2:${columnEnd}2`);
    const c2 = worksheet.getCell('A2');
    c2.value = `CNPJ: ${cnpj}`;
    c2.alignment = { horizontal: 'center', vertical: 'middle' };
    c2.font = { size: 10 };

    // Row 3: Address
    worksheet.mergeCells(`A3:${columnEnd}3`);
    const c3 = worksheet.getCell('A3');
    c3.value = address;
    c3.alignment = { horizontal: 'center', vertical: 'middle' };
    c3.font = { size: 9, color: { argb: 'FF666666' } };

    // Row 4: Technical & Contact Info
    worksheet.mergeCells(`A4:${columnEnd}4`);
    const c4 = worksheet.getCell('A4');
    c4.value = `${technicalInfo}${contactInfo ? ` | Contato: ${contactInfo}` : ''}`;
    c4.alignment = { horizontal: 'center', vertical: 'middle' };
    c4.font = { size: 9, italic: true, color: { argb: 'FF666666' } };

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
    const row6Num = worksheet.rowCount + 1;
    worksheet.mergeCells(`A${row6Num}:${columnEnd}${row6Num}`);
    const r6 = worksheet.getCell(`A${row6Num}`);
    r6.value = `OBRA: ${budgetName?.toUpperCase() || ''}`;
    r6.font = { bold: true, size: 11 };
    r6.alignment = { horizontal: 'left', vertical: 'middle' };

    // Row 7: Client
    const row7Num = worksheet.rowCount + 1;
    worksheet.mergeCells(`A${row7Num}:${columnEnd}${row7Num}`);
    const r7 = worksheet.getCell(`A${row7Num}`);
    r7.value = `CLIENTE: ${clientName?.toUpperCase() || ''}`;
    r7.font = { bold: true, size: 11 };
    r7.alignment = { horizontal: 'left', vertical: 'middle' };

    // Row 8: Date
    const row8Num = worksheet.rowCount + 1;
    worksheet.mergeCells(`A${row8Num}:${columnEnd}${row8Num}`);
    const r8 = worksheet.getCell(`A${row8Num}`);
    r8.value = `DATA: ${new Date().toLocaleDateString('pt-BR')}`;
    r8.font = { size: 10, color: { argb: 'FF666666' } };

    // Row 9-14: Reference Info Block (if data provided)
    if (data) {
        worksheet.addRow([]);
        // Banks Used
        let refInfo = 'BASES DE REFER\u00caNCIA: ';
        if (data.banksUsed?.sinapi) refInfo += `SINAPI (${data.banksUsed.sinapi.mes}/${data.banksUsed.sinapi.estado}) `;
        if (data.banksUsed?.sbc) refInfo += `| SBC (${data.banksUsed.sbc.mes}/${data.banksUsed.sbc.estado}) `;
        if (data.banksUsed?.orse) refInfo += `| ORSE (${data.banksUsed.orse.mes}/${data.banksUsed.orse.estado}) `;
        if (data.banksUsed?.seinfra) refInfo += `| SEINFRA (${data.banksUsed.seinfra.versao}/${data.banksUsed.seinfra.estado}) `;
        if (data.banksUsed?.cpos) refInfo += `| CPOS/CDHU (${data.banksUsed.cpos.mes}/SP) `;
        if (refInfo === 'BASES DE REFER\u00caNCIA: ') refInfo += 'SINAPI/ORSE';

        const rowRefNum = worksheet.rowCount + 1;
        worksheet.mergeCells(`A${rowRefNum}:${columnEnd}${rowRefNum}`);
        const rRef = worksheet.getCell(`A${rowRefNum}`);
        rRef.value = refInfo;
        rRef.font = { size: 9, color: { argb: 'FF666666' } };
        rRef.alignment = { horizontal: 'left', wrapText: true };

        // BDI Info
        const bdiType = data.isDesonerado ? 'DESONERADO' : 'N\u00c3O DESONERADO';
        const bdiInfo = `BDI: ${bdiType} - ${(data.bdi || 0).toFixed(2)}%`;
        const rowBdiNum = worksheet.rowCount + 1;
        worksheet.mergeCells(`A${rowBdiNum}:${columnEnd}${rowBdiNum}`);
        const rBdi = worksheet.getCell(`A${rowBdiNum}`);
        rBdi.value = bdiInfo;
        rBdi.font = { size: 9, bold: true, color: { argb: 'FF1E3A8A' } };

        // Encargos Info
        const encH = data.encargosHorista || data.encargos || 0;
        const encM = data.encargosMensalista || data.encargos || 0;
        const encInfo = `ENCARGOS SOCIAIS: Horista ${encH.toFixed(2)}% | Mensalista ${encM.toFixed(2)}%`;
        const rowEncNum = worksheet.rowCount + 1;
        worksheet.mergeCells(`A${rowEncNum}:${columnEnd}${rowEncNum}`);
        const rEnc = worksheet.getCell(`A${rowEncNum}`);
        rEnc.value = encInfo;
        rEnc.font = { size: 9, color: { argb: 'FF666666' } };
    }

    worksheet.addRow([]);
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
    worksheet.addRow(['']);
    worksheet.mergeCells(`A${rowNum}:${columnEnd}${rowNum}`);

    // Responsible Name
    worksheet.addRow([respName]);
    const nameRowNum = worksheet.rowCount;
    worksheet.mergeCells(`A${nameRowNum}:${columnEnd}${nameRowNum}`);
    worksheet.getCell(`A${nameRowNum}`).font = { bold: true, size: 10 };
    worksheet.getCell(`A${nameRowNum}`).alignment = { horizontal: 'center' };

    // CREA/CPF
    let credInfo = '';
    if (respCrea) credInfo += `CREA/CAU: ${respCrea}`;
    if (respCpf) credInfo += (credInfo ? ' | ' : '') + `CPF: ${respCpf}`;
    if (!credInfo) credInfo = 'CREA/CAU / CPF N\u00c3O INFORMADO';

    worksheet.addRow([credInfo]);
    const credRowNum = worksheet.rowCount;
    worksheet.mergeCells(`A${credRowNum}:${columnEnd}${credRowNum}`);
    worksheet.getCell(`A${credRowNum}`).font = { size: 9, color: { argb: 'FF666666' } };
    worksheet.getCell(`A${credRowNum}`).alignment = { horizontal: 'center' };

    // Date of emission
    worksheet.addRow([`Emitido em: ${new Date().toLocaleDateString('pt-BR')} \u00e0s ${new Date().toLocaleTimeString('pt-BR')}`]);
    const dateRowNum = worksheet.rowCount;
    worksheet.mergeCells(`A${dateRowNum}:${columnEnd}${dateRowNum}`);
    worksheet.getCell(`A${dateRowNum}`).font = { size: 8, italic: true, color: { argb: 'FF999999' } };
    worksheet.getCell(`A${dateRowNum}`).alignment = { horizontal: 'center' };
}



function autoFitExcelColumns(worksheet: ExcelJS.Worksheet) {
    worksheet.columns.forEach((column) => {
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

    // SSOT Totals
    const { totalBase: tBaseAdj, totalFinal: tFinalAdj } = getAdjustedBudgetTotals(
        data.items,
        data.adjustmentSettings,
        data.bdi || 0
    );

    // BUG A FIX: Usar totais vindos do Engine (Fonte única da verdade)
    const totalSemBDI = data.totalGlobalBase ?? tBaseAdj;
    const totalGeral = data.totalGlobalFinal ?? tFinalAdj;

    // Header with reference info (no financial summary)
    addPDFHeader(doc, 'ORÇAMENTO SINTÉTICO', data.budgetName, data.companySettings, {
        bdi: data.bdi,
        encargos: data.encargos,
        isDesonerado: data.isDesonerado,
        encargosHorista: data.encargosHorista,
        encargosMensalista: data.encargosMensalista,
        banksUsed: data.banksUsed
    });

    // RECALCULATION SSOT (Global Adjustment V2)
    // 1. Calculate raw contexts
    let rawTotalBase = 0;
    let rawTotalMat = 0;
    data.items.filter(i => i.type !== 'group' && getHierarchyLevel(i.itemNumber) >= 3).forEach(i => {
        rawTotalBase += i.totalPrice; // Raw base total
        if (i.type === 'material' || (i.type === undefined && ['material', 'insumo'].includes((i as any).itemType))) { // Rough estimation or use proper classify if needed
            rawTotalMat += i.totalPrice;
        }
    });

    // Since we don't have rich type context here effectively for all items if they are flattened, 
    // ideally we trust the item loop to adjust. But we need context for factors.
    // Better: Calculate factors once using data.totalGlobalBase (Raw).

    const totalBaseRaw = data.totalGlobalBase || rawTotalBase; // Trust passed raw base or calc
    // Need raw final (Standard BDI) for 'bdi_only' calculation
    const totalFinalRaw = totalBaseRaw * (1 + (data.bdi || 0) / 100);

    const factors = calculateAdjustmentFactors(data.adjustmentSettings, {
        totalBase: totalBaseRaw,
        totalFinal: totalFinalRaw,
        totalMaterialBase: rawTotalMat // This might be approx if item.type is not perfect, but it's best effort.
    });

    let accumTotalBase = 0;
    let accumTotalFinal = 0;

    // GERAÇÃO SINTÉTICA (Limpa e Direta)
    const processedItems = data.items.map(item => {
        const i: any = item;
        const level = getHierarchyLevel(item.itemNumber);
        const isGroup = level < 3 || item.type === 'group';

        // Apply Adjustment
        // We act as if the item is 'raw'. ExportItem has unitPrice/totalPrice.
        // We construct a mini-object for the utility.
        const adj = getAdjustedItemValues(
            {
                unitPrice: item.unitPrice,
                description: item.description,
                type: (item.type === 'group' || isGroup) ? undefined : (item.type || 'material') // pass type if leaf
            },
            factors,
            data.bdi || 0
        );

        return { ...item, _adj: adj, isGroup, level };
    });

    // Now map to visual rows
    // Let's iterate backwards to sum groups!
    const adjustedMap = new Map<string | number, { tBase: number, tFinal: number, tUnit?: number, tUnitFinal?: number }>(); // id -> { totalBase: number, totalFinal: number }
    // We need IDs. ExportItem has unitId.

    // First pass: Leaves
    processedItems.forEach((row, idx) => {
        if (!row.isGroup) {
            const qty = row.quantity || 0;
            const tBase = row._adj.unitPrice * qty;
            const tFinal = row._adj.finalPrice * qty;
            adjustedMap.set(row.id, { tBase, tFinal, tUnit: row._adj.unitPrice, tUnitFinal: row._adj.finalPrice });

            accumTotalBase += tBase;
            accumTotalFinal += tFinal;
        }
    });

    // Second pass: Groups (Iterate backwards to ensure children processed before parents?)
    // Or just filter data.items by level reverse.
    const sortedLevels = [...processedItems].sort((a, b) => b.level - a.level); // Deepest first (3, then 2, then 1)

    sortedLevels.forEach(row => {
        if (row.isGroup) {
            // Find children (brute force or hierarchy check)
            // ExportItem has 'itemNumber'. Children start with `current.`
            const myNum = row.itemNumber + '.';
            // Finding direct children is tricky with just list.
            // But we can sum ALL descendants that are leaves?
            // Yes, sum of all leaves starting with myNum.

            let gTotalBase = 0;
            let gTotalFinal = 0;

            processedItems.forEach(sub => {
                if (!sub.isGroup && sub.itemNumber.startsWith(myNum)) {
                    const subCalc = adjustedMap.get(sub.id);
                    if (subCalc) {
                        gTotalBase += subCalc.tBase;
                        gTotalFinal += subCalc.tFinal;
                    }
                }
            });
            adjustedMap.set(row.id, { tBase: gTotalBase, tFinal: gTotalFinal });
        }
    });

    // Now map to visual rows
    const tableData = processedItems.map(row => {
        // Sanitização de Código/Banco para Agrupadores
        let code = row.code || '';
        let source = row.source || '';
        if (row.isGroup) {
            code = ''; source = '';
        } else {
            if (code === 'IMP') code = '';
            if (source === 'IMPORT') source = '';
        }

        const calc = adjustedMap.get(row.id) || { tBase: 0, tFinal: 0, tUnit: 0, tUnitFinal: 0 };

        // Quantidade e Unitário zerados visualmente para grupos
        const quantity = row.isGroup ? null : row.quantity;
        const unitPrice = row.isGroup ? null : calc.tUnit;
        const unitPriceBDI = row.isGroup ? null : calc.tUnitFinal;
        const unit = row.isGroup ? '' : (row.unit || '');

        return [
            row.itemNumber,
            source,
            code,
            row.description,
            unit,
            quantity != null ? quantity.toFixed(2) : '',
            unitPrice != null ? formatCurrency(unitPrice) : '',
            unitPriceBDI != null ? formatCurrency(unitPriceBDI) : '',
            formatCurrency(calc.tFinal), // ALWAYS DISPLAY FINAL TOTAL (ADJUSTED)
            formatPercent((row.pesoRaw || 0) * 100) // Keep weight as passed (or recalc?) Let's keep passed to avoid mess.
        ];
    });

    autoTable(doc, {
        startY: 75,
        head: [['ITEM', 'BANCO', 'CÓDIGO', 'DESCRIÇÃO', 'UND', 'QTD', 'UNIT', 'UNIT/BDI', 'TOTAL', 'PESO']],
        body: tableData,
        headStyles: { fillColor: [30, 58, 138], fontSize: 7, halign: 'center' },
        styles: { fontSize: 7, valign: 'middle' },
        columnStyles: {
            0: { halign: 'center', cellWidth: 15 }, // Item
            1: { halign: 'center', cellWidth: 15 }, // Banco
            2: { halign: 'center', cellWidth: 15 }, // Cod
            3: { halign: 'left' },                  // Descrição
            4: { halign: 'center', cellWidth: 10 }, // Und
            5: { halign: 'center', cellWidth: 15 }, // Qtd
            6: { halign: 'right', cellWidth: 20 },  // Unit
            7: { halign: 'right', cellWidth: 20 },  // UnitBDI
            8: { halign: 'right', cellWidth: 22 },  // Total
            9: { halign: 'center', cellWidth: 12 }  // Peso
        },
        didParseCell: (d) => {
            if (d.section === 'head') return;
            const rowIndex = d.row.index;
            const level = getHierarchyLevel(data.items[rowIndex]?.itemNumber || '');

            if (level === 1) {
                d.cell.styles.fillColor = [30, 58, 138];
                d.cell.styles.textColor = [255, 255, 255];
                d.cell.styles.fontStyle = 'bold';
            } else if (level === 2) {
                d.cell.styles.fillColor = [219, 234, 254];
                d.cell.styles.fontStyle = 'bold';
                d.cell.styles.textColor = [0, 0, 0];
            } else {
                d.cell.styles.textColor = [0, 0, 0];
            }
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
    const worksheet = workbook.addWorksheet('Sintético');

    // 1. RECALCULATION & LOGIC (SSOT for Presentation)
    const { totalBase: tBase, totalFinal: tFinal } = getAdjustedBudgetTotals(
        data.items,
        data.adjustmentSettings,
        data.bdi || 0
    );

    const leaves = data.items.filter(i => i.type !== 'group');
    const total_sem_bdi = tBase;
    const total_com_bdi = tFinal;
    const total_bdi = total_com_bdi - total_sem_bdi;

    // 2. HEADER (Using standard company branding)
    addExcelHeader(worksheet, 'ORÇAMENTO SINTÉTICO', data.budgetName, data.clientName, data.companySettings, 'J', data);

    // 3. TABLE HEADERS (Dynamic row position)
    const headerRow = worksheet.addRow([
        'Item', 'Código', 'Banco', 'Descrição', 'Und', 'Quant.', 'Valor Unit', 'Valor Unit com BDI', 'Total', 'Peso (%)'
    ]);

    // Header Styling
    headerRow.height = 22;
    headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    });

    // 4. DATA ROWS
    data.items.forEach((item, index) => {
        const isGroup = item.type === 'group';
        const level = getHierarchyLevel(item.itemNumber);

        let rowTotalWithBDI = 0;
        let unitPriceRaw: any = item.unitPrice || 0;
        let unitPriceWithBDI = item.unitPriceWithBDI || (item.finalPrice && item.quantity > 0 ? item.finalPrice / item.quantity : item.unitPrice * (1 + (data.bdi || 0) / 100));

        if (isGroup) {
            // Sum of all descendant leaves
            const descendants = leaves.filter(l => l.itemNumber.startsWith(item.itemNumber + '.'));
            rowTotalWithBDI = descendants.reduce((acc, l) => {
                const val = l.finalPrice || ((l.quantity || 0) * (l.unitPriceWithBDI || (l.unitPrice * (1 + (data.bdi || 0) / 100))));
                return acc + val;
            }, 0);

            // Regra Grupos: Quant=1, G vazio, H=subtotal, I=H
            unitPriceRaw = '';
            unitPriceWithBDI = rowTotalWithBDI;
            rowTotalWithBDI = unitPriceWithBDI;
        } else {
            // Regra Folhas: G=unitPriceBase, H=unitPriceWithBDI, I=Quant*H
            rowTotalWithBDI = (item.quantity || 0) * unitPriceWithBDI;
        }

        const weight = total_com_bdi > 0 ? (rowTotalWithBDI / total_com_bdi) : 0;

        let code = item.code || '';
        let source = item.source || '';
        if (isGroup) { code = ''; source = ''; }
        else {
            if (code === 'IMP') code = '';
            if (source === 'IMPORT') source = '';
        }

        const row = worksheet.addRow([
            item.itemNumber,
            code,
            source,
            item.description,
            (isGroup ? '' : item.unit),
            (isGroup ? 1 : item.quantity),
            unitPriceRaw,         // Col G: Valor Unit (Base)
            unitPriceWithBDI,     // Col H: Valor Unit c/ BDI
            rowTotalWithBDI,      // Col I: Total (Sempre com BDI)
            weight                // Col J: Peso
        ]);

        // ALIGNMENT & BORDER
        row.eachCell((cell) => {
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
            };
        });
        row.getCell(4).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }; // Descrição align left

        // STYLE PER LEVEL
        if (isGroup) {
            if (level === 1) {
                row.eachCell(c => {
                    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
                    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                });
            } else if (level === 2) {
                row.eachCell(c => {
                    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
                    c.font = { bold: true };
                });
            } else {
                row.font = { bold: true };
            }
        } else {
            if (index % 2 === 0) {
                row.eachCell(c => c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } });
            }
        }

        // NUMBER FORMATS
        row.getCell(6).numFmt = '#,##0.00';      // Quant
        row.getCell(7).numFmt = '"R$ "#,##0.00';  // Unit Base
        row.getCell(8).numFmt = '"R$ "#,##0.00';  // Unit BDI
        row.getCell(9).numFmt = '"R$ "#,##0.00';  // Total
        row.getCell(10).numFmt = '0.00%';         // Peso
    });

    // 5. TOTALS FOOTER
    worksheet.addRow([]); // Spacer

    // Row: Total sem BDI
    const rSem = worksheet.addRow([]);
    rSem.getCell(6).value = 'Total sem BDI';
    rSem.getCell(8).value = total_sem_bdi;
    rSem.getCell(6).font = { bold: true };
    rSem.getCell(8).font = { bold: true };
    rSem.getCell(8).numFmt = '"R$ "#,##0.00';
    rSem.getCell(6).alignment = { horizontal: 'right' };

    // Row: Total do BDI
    const rBdi = worksheet.addRow([]);
    rBdi.getCell(6).value = 'Total do BDI';
    rBdi.getCell(8).value = total_bdi;
    rBdi.getCell(6).font = { bold: true, color: { argb: 'FF1E3A8A' } };
    rBdi.getCell(8).font = { bold: true, color: { argb: 'FF1E3A8A' } };
    rBdi.getCell(8).numFmt = '"R$ "#,##0.00';
    rBdi.getCell(6).alignment = { horizontal: 'right' };

    // Row: Total Geral
    const rGer = worksheet.addRow([]);
    rGer.getCell(6).value = 'Total Geral';
    rGer.getCell(8).value = total_com_bdi;
    rGer.getCell(6).font = { bold: true, size: 12 };
    rGer.getCell(8).font = { bold: true, size: 12 };
    rGer.getCell(8).numFmt = '"R$ "#,##0.00';
    rGer.getCell(6).alignment = { horizontal: 'right' };

    // 6. FINISH
    addExcelFooter(worksheet, data.companySettings, 'J');
    autoFitExcelColumns(worksheet);

    return await workbook.xlsx.writeBuffer();
}


export async function generatePDFAnalyticBuffer(data: ExportData): Promise<ArrayBuffer> {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const bdiFactor = 1 + (data.bdi || 0) / 100;
    const { totalBase: tBase, totalFinal: tFinal } = getAdjustedBudgetTotals(
        data.items,
        data.adjustmentSettings,
        data.bdi || 0
    );

    const totalSemBDI = tBase;
    const totalGeral = tFinal;

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
        const level = getHierarchyLevel(item.itemNumber);
        const isGroup = level < 3 || item.type === 'group';

        let code = item.code || '';
        let source = item.source || '';
        if (isGroup) { code = ''; source = ''; }
        else { if (code === 'IMP') code = ''; if (source === 'IMPORT') source = ''; }

        const i: any = item;
        const unitBDI = i.unitPriceWithBDI ?? (item.unitPrice * bdiFactor);
        // Se visibleRows já tiver unitPriceWithBDI (o que é ideal), use-o.

        // Linha Principal
        tableData.push([
            item.itemNumber,
            source,
            code,
            item.description,
            isGroup ? '' : item.unit,
            isGroup ? '' : item.quantity?.toFixed(2),
            isGroup ? '' : formatCurrency(item.unitPrice),
            isGroup ? '' : formatCurrency(unitBDI),
            formatCurrency(item.totalPrice || item.finalPrice || 0) // Sempre mostra total
        ]);

        // Linha de Cabeçalho da Composição (Se tiver filhos)
        if (item.composition && item.composition.length > 0) {
            // Headerzinho discreto para composição
            tableData.push([
                '',
                '',
                '',
                'COMPOSIÇÃO ANALÍTICA:',
                '',
                '',
                '',
                '',
                ''
            ]);

            item.composition.forEach(c => {
                // Normalizar dados da composição (preço, total)
                // Eles já vêm ajustados pelo adjustmentFactor no handler
                tableData.push([
                    '',
                    'INSUMO',
                    c.code || '',
                    `   ${c.description}`,
                    c.unit,
                    c.quantity?.toFixed(4),
                    formatCurrency(c.unitPrice),
                    '', // Unit BDI em insumo de composição? Geralmente não se lista, mas se quiser: formatCurrency(c.unitPrice * bdiFactor)
                    formatCurrency(c.totalPrice)
                ]);
            });

            // Spacer visual
            tableData.push(['', '', '', '', '', '', '', '', '']);
        }
    });

    autoTable(doc, {
        startY: 75,
        head: [['ITEM', 'BANCO', 'CÓDIGO', 'DESCRIÇÃO', 'UND', 'QTD', 'UNIT', 'UNIT/BDI', 'TOTAL']],
        body: tableData,
        headStyles: { fillColor: [30, 58, 138], fontSize: 7, halign: 'center' },
        styles: { fontSize: 7, valign: 'middle' },
        columnStyles: {
            0: { halign: 'center', cellWidth: 15 },
            1: { halign: 'center', cellWidth: 15 },
            2: { halign: 'center', cellWidth: 15 },
            3: { halign: 'left' }, // Descrição
            4: { halign: 'center', cellWidth: 10 },
            5: { halign: 'center', cellWidth: 15 },
            6: { halign: 'right', cellWidth: 20 },
            7: { halign: 'right', cellWidth: 20 },
            8: { halign: 'right', cellWidth: 20 }
        },
        didParseCell: (d) => {
            if (d.section === 'head') return;
            // Cast raw to any to access array index without TS error
            const raw = d.row.raw as any;
            const itemNumber = raw[0];
            const isItemRow = itemNumber && itemNumber !== '';

            if (isItemRow) {
                const level = getHierarchyLevel(itemNumber as string);
                if (level === 1) {
                    d.cell.styles.fillColor = [30, 58, 138];
                    d.cell.styles.textColor = [255, 255, 255];
                    d.cell.styles.fontStyle = 'bold';
                } else if (level === 2) {
                    d.cell.styles.fillColor = [219, 234, 254];
                    d.cell.styles.fontStyle = 'bold';
                    d.cell.styles.textColor = [0, 0, 0];
                } else {
                    // Nível 3+ (Item normal)
                    d.cell.styles.fontStyle = 'bold';
                    d.cell.styles.fillColor = [245, 245, 245]; // Leve destaque para linha pai de comp
                }
            } else {
                // Linhas de Composição (Filhos)
                const desc = raw[3] as string;
                if (desc === 'COMPOSIÇÃO ANALÍTICA:') {
                    d.cell.styles.fontStyle = 'bold';
                    d.cell.styles.fontSize = 6;
                    d.cell.styles.textColor = [100, 100, 100];
                } else {
                    d.cell.styles.textColor = [80, 80, 80];
                    d.cell.styles.fontStyle = 'italic';
                    d.cell.styles.fontSize = 7;
                }
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
        { header: 'ITEM', key: 'item', width: 12 },
        { header: 'BANCO', key: 'source', width: 12 },
        { header: 'CÓDIGO', key: 'code', width: 14 },
        { header: 'DESCRIÇÃO', key: 'description', width: 60 },
        { header: 'UND', key: 'unit', width: 8 },
        { header: 'QTD/COEF', key: 'quantity', width: 12 },
        { header: 'UNIT', key: 'unitPrice', width: 15 },
        { header: 'UNIT/BDI', key: 'unitPriceBdi', width: 15 },
        { header: 'TOTAL', key: 'total', width: 18 }
    ];

    addExcelHeader(worksheet, 'ORÇAMENTO ANALÍTICO (CPU)', data.budgetName, data.clientName, data.companySettings, 'I', data);

    const headerRow = worksheet.addRow(['ITEM', 'BANCO', 'CÓDIGO', 'DESCRIÇÃO', 'UND', 'QTD/COEF', 'UNIT', 'UNIT/BDI', 'TOTAL']);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    headerRow.eachCell((cell) => {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    for (const item of data.items) {
        const level = getHierarchyLevel(item.itemNumber);
        const isGroup = level < 3 || item.type === 'group';

        let code = item.code || '';
        let source = item.source || '';
        if (isGroup) { code = ''; source = ''; }
        else { if (code === 'IMP') code = ''; if (source === 'IMPORT') source = ''; }

        // Linha Principal do Item
        const itemRow = worksheet.addRow([
            item.itemNumber,
            source,
            code,
            item.description,
            isGroup ? '' : item.unit,
            isGroup ? null : item.quantity,
            isGroup ? null : item.unitPrice,
            isGroup ? null : ((item as any).unitPriceWithBDI ?? (item.unitPrice * bdiFactor)),
            (item.totalPrice || item.finalPrice || 0)
        ]);

        // Formatação da linha principal
        itemRow.eachCell((cell) => { cell.alignment = { vertical: 'middle' }; });
        itemRow.getCell(1).alignment = { horizontal: 'center' }; // Item
        itemRow.getCell(2).alignment = { horizontal: 'center' }; // Cod
        itemRow.getCell(3).alignment = { horizontal: 'center' }; // Banco
        itemRow.getCell(5).alignment = { horizontal: 'center' }; // Und
        itemRow.getCell(6).alignment = { horizontal: 'center' }; // Qtd

        // Estilos de Nível
        if (level === 1) {
            itemRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
            itemRow.font = { color: { argb: 'FFFFFFFF' }, bold: true };
        } else if (level === 2) {
            itemRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
            itemRow.font = { bold: true, color: { argb: 'FF000000' } };
        } else {
            // Item real
            itemRow.font = { bold: true };
            itemRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
            itemRow.getCell(6).numFmt = '#,##0.00';
            itemRow.getCell(7).numFmt = '"R$ "#,##0.00';
            itemRow.getCell(8).numFmt = '"R$ "#,##0.00';
            itemRow.getCell(9).numFmt = '"R$ "#,##0.00';
        }

        // Composições
        if (item.composition && item.composition.length > 0) {
            // Spacer row or Header for comp?
            const compHeader = worksheet.addRow(['', '', '', 'COMPOSIÇÃO ANALÍTICA:', '', '', '', '', '']);
            compHeader.font = { size: 8, bold: true, color: { argb: 'FF666666' } };

            item.composition.forEach(c => {
                const compRow = worksheet.addRow([
                    '',
                    'INSUMO',
                    c.code,
                    `     ${c.description}`,
                    c.unit,
                    c.quantity,
                    c.unitPrice,
                    '', // Unit BDI?
                    c.totalPrice
                ]);
                compRow.font = { size: 9, italic: true, color: { argb: 'FF444444' } };
                compRow.getCell(6).numFmt = '#,##0.0000';
                compRow.getCell(7).numFmt = '"R$ "#,##0.00';
                compRow.getCell(9).numFmt = '"R$ "#,##0.00';
                compRow.getCell(4).alignment = { indent: 1 };
            });
            worksheet.addRow([]); // Spacer
        }
    }

    const { totalBase: tBase, totalFinal: tFinal } = getAdjustedBudgetTotals(
        data.items,
        data.adjustmentSettings,
        data.bdi || 0
    );
    const totalSemBDI = tBase;
    const totalGlobalFinal = tFinal;

    // Summary Final
    worksheet.addRow([]);
    const totalRowBase = worksheet.addRow(['', '', '', '', '', '', '', 'TOTAL SEM BDI', totalSemBDI]);
    totalRowBase.font = { bold: true };
    totalRowBase.getCell(8).alignment = { horizontal: 'right' };
    totalRowBase.getCell(9).numFmt = '"R$ "#,##0.00';

    const totalRowBDI = worksheet.addRow(['', '', '', '', '', '', '', `BDI (${data.bdi}%)`, totalSemBDI * (data.bdi / 100)]);
    totalRowBDI.font = { bold: true };
    totalRowBDI.getCell(8).alignment = { horizontal: 'right' };
    totalRowBDI.getCell(9).numFmt = '"R$ "#,##0.00';

    const totalRowFinal = worksheet.addRow(['', '', '', '', '', '', '', 'TOTAL COM BDI', totalGlobalFinal]);
    totalRowFinal.font = { bold: true, size: 12 };
    totalRowFinal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
    totalRowFinal.getCell(8).alignment = { horizontal: 'right' };
    totalRowFinal.getCell(9).numFmt = '"R$ "#,##0.00';

    // Footer
    addExcelFooter(worksheet, data.companySettings, 'I');

    return await workbook.xlsx.writeBuffer();
}

export async function generatePDFABCBuffer(data: ExportData, type: 'servicos' | 'insumos'): Promise<ArrayBuffer> {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    // BUG A FIX: Usar totais vindos do Engine (Fonte única da verdade)
    const { totalBase: tBase, totalFinal: tFinal } = getAdjustedBudgetTotals(
        data.items,
        data.adjustmentSettings,
        data.bdi || 0
    );

    const totalSemBDI = tBase;
    const totalGeral = tFinal;

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
        body: body.map(row => {
            const itemNumber = row[0] as string;
            const originalItem = data.items.find(i => i.itemNumber === itemNumber);

            let finalVal = 0;
            if (originalItem) {
                const rawT = data.totalGlobalBase || 0;
                const factors = calculateAdjustmentFactors(data.adjustmentSettings, {
                    totalBase: rawT, totalFinal: rawT * (1 + (data.bdi || 0) / 100), totalMaterialBase: rawT
                });

                const isGroup = getHierarchyLevel(itemNumber) < 3;

                let sumLeafs = 0;
                data.items.filter(sub => !['group'].includes(sub.type) && sub.itemNumber.startsWith(itemNumber + (isGroup ? '.' : '')) && (isGroup ? sub.itemNumber !== itemNumber : sub.itemNumber === itemNumber)).forEach(sub => {
                    const adj = getAdjustedItemValues({ unitPrice: sub.unitPrice, description: sub.description, type: sub.type }, factors, data.bdi || 0);
                    sumLeafs += adj.finalPrice * (sub.quantity || 0);
                });
                finalVal = sumLeafs;
            }

            const newRow = [...row];
            if (originalItem) {
                newRow[2] = formatCurrency(finalVal);
            }
            return newRow;
        }),
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
