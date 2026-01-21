"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportPDFSynthetic = exportPDFSynthetic;
exports.exportExcelSynthetic = exportExcelSynthetic;
exports.exportPDFAnalytic = exportPDFAnalytic;
exports.exportExcelAnalytic = exportExcelAnalytic;
exports.exportABCServicos = exportABCServicos;
exports.exportABCInsumos = exportABCInsumos;
exports.exportABCServicosExcel = exportABCServicosExcel;
exports.exportABCInsumosExcel = exportABCInsumosExcel;
exports.exportScheduleExcel = exportScheduleExcel;
exports.exportSchedulePDF = exportSchedulePDF;
exports.exportCurvaSExcel = exportCurvaSExcel;
exports.exportCurvaSPDF = exportCurvaSPDF;
exports.generatePDFSyntheticBuffer = generatePDFSyntheticBuffer;
exports.generateExcelSyntheticBuffer = generateExcelSyntheticBuffer;
exports.generatePDFAnalyticBuffer = generatePDFAnalyticBuffer;
exports.generateExcelAnalyticBuffer = generateExcelAnalyticBuffer;
exports.generatePDFABCBuffer = generatePDFABCBuffer;
exports.generateExcelABCBuffer = generateExcelABCBuffer;
exports.generatePDFScheduleBuffer = generatePDFScheduleBuffer;
exports.generateExcelCurvaSBuffer = generateExcelCurvaSBuffer;
exports.generatePDFPhysicalScheduleBuffer = generatePDFPhysicalScheduleBuffer;
exports.generatePDFBDIBuffer = generatePDFBDIBuffer;
exports.generatePDFEncargosBuffer = generatePDFEncargosBuffer;
exports.exportCompleteProject = exportCompleteProject;
exports.isAnalyticRequiredItem = isAnalyticRequiredItem;
exports.validateAnalytics = validateAnalytics;
exports.generateExcelScheduleBuffer = generateExcelScheduleBuffer;
const jspdf_1 = __importDefault(require("jspdf"));
const jspdf_autotable_1 = __importDefault(require("jspdf-autotable"));
const exceljs_1 = __importDefault(require("exceljs"));
// ===================================================================
// FUNÇÕES AUXILIARES
// ===================================================================
function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
}
function formatPercent(value) {
    return `${value.toFixed(2)}%`;
}
function getHierarchyLevel(itemNumber) {
    const trimmed = (itemNumber || '').trim();
    if (!trimmed)
        return 3;
    const dotCount = (trimmed.match(/\./g) || []).length;
    if (dotCount === 0)
        return 1;
    if (dotCount === 1)
        return 2;
    return 3;
}
function sanitizeFilename(name) {
    return name
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9 ]/g, '')
        .trim()
        .replace(/\s+/g, '_');
}
// ===================================================================
// CABEÇALHOS E RODAPÉS
// ===================================================================
function addPDFHeader(doc, title, budgetName, companySettings, details) {
    const pageWidth = doc.internal.pageSize.width;
    const logo = companySettings?.logo_url || companySettings?.logo;
    if (logo) {
        try {
            doc.addImage(logo, 'PNG', 14, 5, 25, 25);
        }
        catch (e) { }
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
function addPDFFinancialSummary(doc, totalSemBDI, bdi, totalGeral) {
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;
    let finalY = doc.lastAutoTable?.finalY || 100;
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
    doc.lastAutoTable = { finalY: startY + 35 };
}
function addPDFFooter(doc, companySettings, isLastPage = false) {
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;
    doc.setDrawColor(200, 200, 200);
    doc.line(14, pageHeight - 15, pageWidth - 14, pageHeight - 15);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    let addressInfo = companySettings?.address || '';
    if (companySettings?.email)
        addressInfo += ` | ${companySettings.email}`;
    if (companySettings?.phone)
        addressInfo += ` | ${companySettings.phone}`;
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
        if (respCrea)
            subText += `CREA/CAU: ${respCrea}`;
        if (respCpf)
            subText += (subText ? ' | ' : '') + `CPF: ${respCpf}`;
        if (!subText)
            subText = 'CREA/CAU / CPF NÃO INFORMADO';
        doc.text(subText, pageWidth / 2, pageHeight - 37, { align: 'center' });
    }
}
// Helper to check space and add page if needed for signature
function ensureSpaceForSignature(doc) {
    const pageHeight = doc.internal.pageSize.height;
    const finalY = doc.lastAutoTable?.finalY || 0;
    const footerHeight = 50; // Space needed for signature and footer text
    if (finalY > pageHeight - footerHeight) {
        doc.addPage();
    }
}
function addExcelHeader(worksheet, title, budgetName, clientName, companySettings, columnEnd = 'H', data) {
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
        if (data.banksUsed?.sinapi)
            refInfo += `SINAPI (${data.banksUsed.sinapi.mes}/${data.banksUsed.sinapi.estado}) `;
        if (data.banksUsed?.sbc)
            refInfo += `| SBC (${data.banksUsed.sbc.mes}/${data.banksUsed.sbc.estado}) `;
        if (data.banksUsed?.orse)
            refInfo += `| ORSE (${data.banksUsed.orse.mes}/${data.banksUsed.orse.estado}) `;
        if (data.banksUsed?.seinfra)
            refInfo += `| SEINFRA (${data.banksUsed.seinfra.versao}/${data.banksUsed.seinfra.estado}) `;
        if (data.banksUsed?.cpos)
            refInfo += `| CPOS/CDHU (${data.banksUsed.cpos.mes}/SP) `;
        if (refInfo === 'BASES DE REFER\u00caNCIA: ')
            refInfo += 'SINAPI/ORSE';
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
function addExcelFooter(worksheet, companySettings, columnEnd = 'H') {
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
    if (respCrea)
        credInfo += `CREA/CAU: ${respCrea}`;
    if (respCpf)
        credInfo += (credInfo ? ' | ' : '') + `CPF: ${respCpf}`;
    if (!credInfo)
        credInfo = 'CREA/CAU / CPF N\u00c3O INFORMADO';
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
function applyExcelTableFormatting(worksheet, headerRowNum, dataStartRow, columnCount) {
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
function autoFitExcelColumns(worksheet) {
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
function getExportFilename(prefix, budgetName, includeDate = false) {
    const safeName = sanitizeFilename(budgetName).toUpperCase();
    const dateStr = includeDate ? `_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}` : '';
    return `${prefix}_${safeName}${dateStr}`;
}
async function exportPDFSynthetic(data) {
    const buffer = await generatePDFSyntheticBuffer(data);
    const blob = new Blob([buffer], { type: 'application/pdf' });
    saveAs(blob, `${getExportFilename('ORCAMENTO_SINTETICO', data.budgetName, true)}.pdf`);
}
async function exportExcelSynthetic(data) {
    const buffer = await generateExcelSyntheticBuffer(data);
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, `${getExportFilename('ORCAMENTO_SINTETICO', data.budgetName, true)}.xlsx`);
}
async function exportPDFAnalytic(data) {
    const buffer = await generatePDFAnalyticBuffer(data);
    const blob = new Blob([buffer], { type: 'application/pdf' });
    saveAs(blob, `${getExportFilename('ORCAMENTO_ANALITICO', data.budgetName, true)}.pdf`);
}
async function exportExcelAnalytic(data) {
    const buffer = await generateExcelAnalyticBuffer(data);
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, `${getExportFilename('ORCAMENTO_ANALITICO', data.budgetName, true)}.xlsx`);
}
async function exportABCServicos(data) {
    const buffer = await generatePDFABCBuffer(data, 'servicos');
    const blob = new Blob([buffer], { type: 'application/pdf' });
    await saveAs(blob, `${getExportFilename('CURVA_ABC_SERVICOS', data.budgetName)}.pdf`);
}
async function exportABCInsumos(data) {
    const buffer = await generatePDFABCBuffer(data, 'insumos');
    const blob = new Blob([buffer], { type: 'application/pdf' });
    await saveAs(blob, `${getExportFilename('CURVA_ABC_INSUMOS', data.budgetName)}.pdf`);
}
async function exportABCServicosExcel(data) {
    const buffer = await generateExcelABCBuffer(data, 'servicos');
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await saveAs(blob, `${getExportFilename('CURVA_ABC_SERVICOS', data.budgetName)}.xlsx`);
}
async function exportABCInsumosExcel(data) {
    const buffer = await generateExcelABCBuffer(data, 'insumos');
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await saveAs(blob, `${getExportFilename('CURVA_ABC_INSUMOS', data.budgetName)}.xlsx`);
}
async function exportScheduleExcel(data) {
    const buffer = await generateExcelScheduleBuffer(data);
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await saveAs(blob, `${getExportFilename('CRONOGRAMA_FISICO_FINANCEIRO', data.budgetName)}.xlsx`);
}
async function exportSchedulePDF(data) {
    const buffer = await generatePDFScheduleBuffer(data);
    const blob = new Blob([buffer], { type: 'application/pdf' });
    await saveAs(blob, `${getExportFilename('CRONOGRAMA_FISICO_FINANCEIRO', data.budgetName)}.pdf`);
}
async function exportCurvaSExcel(data) {
    const buffer = await generateExcelCurvaSBuffer(data);
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await saveAs(blob, `${getExportFilename('CURVA_S', data.budgetName)}.xlsx`);
}
async function exportCurvaSPDF(data) {
    const doc = new jspdf_1.default({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    addPDFHeader(doc, 'CURVA S - PREVISTO VS REALIZADO', data.budgetName, data.companySettings, { bdi: data.bdi });
    if (data.chartImageDataUrl) {
        try {
            doc.addImage(data.chartImageDataUrl, 'PNG', 14, 65, 180, 100);
        }
        catch (e) { } // Moved image Y to 65
    }
    const tableData = (data.curvaData || []).map(item => [
        item.month,
        `${item.previstoAcumulado.toFixed(2)}%`,
        `${item.realizadoAcumulado.toFixed(2)}%`
    ]);
    (0, jspdf_autotable_1.default)(doc, {
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
async function generatePDFSyntheticBuffer(data) {
    const doc = new jspdf_1.default({ orientation: 'landscape', unit: 'mm', format: 'a4' });
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
        const i = item;
        const level = getHierarchyLevel(item.itemNumber);
        // CORREÇÃO ESTRUTURAL: Agrupadores (Nível 1 e 2 ou type='group')
        // NÃO devem mostrar Código, Banco, Unidade, Quantidade, Unitário.
        // DEVEM mostrar Totais e Peso (que já vêm calculados do BudgetEditor).
        // DEVEM remover "IMP"/"IMPORT" se vierem sujos.
        const isGroup = level < 3 || item.type === 'group';
        // Sanitização de Código/Banco para Agrupadores
        let code = item.code || '';
        let source = item.source || '';
        if (isGroup) {
            code = '';
            source = '';
        }
        else {
            // Limpeza extra pra itens reais (caso venham sujos)
            if (code === 'IMP')
                code = '';
            if (source === 'IMPORT')
                source = '';
        }
        const unitBDI = i.unitPriceWithBDI;
        // Quantidade e Unitário zerados visualmente para grupos
        const quantity = isGroup ? null : item.quantity;
        const unitPrice = isGroup ? null : item.unitPrice;
        const unitPriceBDI = isGroup ? null : unitBDI;
        const unit = isGroup ? '' : (item.unit || '');
        return [
            item.itemNumber,
            source,
            code,
            item.description,
            unit,
            quantity != null ? quantity.toFixed(2) : '',
            unitPrice != null ? formatCurrency(unitPrice) : '',
            unitPriceBDI != null ? formatCurrency(unitPriceBDI) : '',
            formatCurrency(item.totalPrice || item.finalPrice || 0), // Totais sempre visíveis
            formatPercent((i.pesoRaw || 0) * 100)
        ];
    });
    (0, jspdf_autotable_1.default)(doc, {
        startY: 75,
        head: [['ITEM', 'BANCO', 'CÓDIGO', 'DESCRIÇÃO', 'UND', 'QTD', 'UNIT', 'UNIT/BDI', 'TOTAL', 'PESO']],
        body: tableData,
        headStyles: { fillColor: [30, 58, 138], fontSize: 7, halign: 'center' },
        styles: { fontSize: 7, valign: 'middle' },
        columnStyles: {
            0: { halign: 'center', cellWidth: 15 }, // Item
            1: { halign: 'center', cellWidth: 15 }, // Banco
            2: { halign: 'center', cellWidth: 15 }, // Cod
            3: { halign: 'left' }, // Descrição
            4: { halign: 'center', cellWidth: 10 }, // Und
            5: { halign: 'center', cellWidth: 15 }, // Qtd
            6: { halign: 'right', cellWidth: 20 }, // Unit
            7: { halign: 'right', cellWidth: 20 }, // UnitBDI
            8: { halign: 'right', cellWidth: 22 }, // Total
            9: { halign: 'center', cellWidth: 12 } // Peso
        },
        didParseCell: (d) => {
            if (d.section === 'head')
                return;
            const rowIndex = d.row.index;
            const level = getHierarchyLevel(data.items[rowIndex]?.itemNumber || '');
            if (level === 1) {
                d.cell.styles.fillColor = [30, 58, 138];
                d.cell.styles.textColor = [255, 255, 255];
                d.cell.styles.fontStyle = 'bold';
            }
            else if (level === 2) {
                d.cell.styles.fillColor = [219, 234, 254];
                d.cell.styles.fontStyle = 'bold';
                d.cell.styles.textColor = [0, 0, 0];
            }
            else {
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
async function generateExcelSyntheticBuffer(data) {
    const workbook = new exceljs_1.default.Workbook();
    const worksheet = workbook.addWorksheet('Sintético');
    // -------------------------------------------------------------------------
    // 1. RECALCULATION & LOGIC (SSOT for Presentation)
    // -------------------------------------------------------------------------
    // Helper to calculate hierarchy totals
    const processedItems = data.items.map(item => ({
        ...item,
        isGroup: false,
        displayTotal: 0,
        displayUnitBDI: 0,
        displayQuant: 0
    }));
    // Identify Groups: Item is a group if the NEXT item is a child of it (starts with "number.")
    // We assume the list is sorted by itemNumber (standard for budgets).
    for (let i = 0; i < processedItems.length; i++) {
        const current = processedItems[i];
        const next = processedItems[i + 1];
        if (next && next.itemNumber.startsWith(current.itemNumber + '.')) {
            current.isGroup = true;
        }
        else {
            // Also check 'type' just in case it's a structural group without immediate children in this list
            if (current.type === 'group')
                current.isGroup = true;
        }
    }
    // Identify Leaves
    const leaves = processedItems.filter(i => !i.isGroup);
    // Calculate Grand Total from leaves (Source of Truth)
    const grandTotal = leaves.reduce((acc, item) => acc + (item.totalPrice || 0), 0);
    // Note: data.totalGlobalFinal can be used, but recalculating ensures consistency with rows
    // Assign Values
    processedItems.forEach(item => {
        if (item.isGroup) {
            // Sum of all descendant leaves
            // Filter is safe for N < 5000
            const descendants = leaves.filter(l => l.itemNumber.startsWith(item.itemNumber + '.'));
            const groupTotal = descendants.reduce((acc, l) => acc + (l.totalPrice || 0), 0);
            item.displayQuant = 1;
            item.displayTotal = groupTotal;
            item.displayUnitBDI = groupTotal; // "Valor Unit com BDI" = Total for groups
        }
        else {
            item.displayQuant = item.quantity;
            item.displayTotal = item.totalPrice || 0;
            // Ensure we use finalPrice if available, otherwise calc
            // But usually totalPrice IS finalPrice for items if BDI is applied? 
            // Standard: unitPriceWithBDI comes from item property or calc.
            // Using existing logic:
            const i = item;
            item.displayUnitBDI = i.unitPriceWithBDI || (item.finalPrice ? item.finalPrice / item.quantity : 0) || 0;
        }
    });
    // -------------------------------------------------------------------------
    // 2. SETUP COLUMNS & WIDTHS
    // -------------------------------------------------------------------------
    worksheet.columns = [
        { header: 'Item', key: 'item', width: 10 },
        { header: 'Código', key: 'code', width: 14 },
        { header: 'Banco', key: 'source', width: 14 },
        { header: 'Descrição', key: 'description', width: 60 },
        { header: 'Und', key: 'unit', width: 8 },
        { header: 'Quant.', key: 'quantity', width: 12 },
        { header: 'Valor Unit', key: 'unitPrice', width: 16 },
        { header: 'Valor Unit com BDI', key: 'unitPriceBdi', width: 20 },
        { header: 'Total', key: 'total', width: 18 },
        { header: 'Peso (%)', key: 'weight', width: 12 }
    ];
    // -------------------------------------------------------------------------
    // 3. HEADER (ROWS 1-3)
    // -------------------------------------------------------------------------
    const compSettings = data.companySettings;
    const bdiVal = (data.bdi || 0).toFixed(2);
    const encH = (data.encargosHorista || data.encargos || 0).toFixed(2);
    const encM = (data.encargosMensalista || data.encargos || 0).toFixed(2);
    // Construct Info Strings
    const obraInfo = `OBRA: ${data.budgetName || ''}`;
    let banksInfo = 'BANCOS: ';
    if (data.banksUsed) {
        const banks = [];
        if (data.banksUsed.sinapi)
            banks.push(`SINAPI ${data.banksUsed.sinapi.mes}/${data.banksUsed.sinapi.estado}`);
        if (data.banksUsed.sbc)
            banks.push('SBC');
        if (data.banksUsed.orse)
            banks.push('ORSE');
        if (data.banksUsed.seinfra)
            banks.push('SEINFRA');
        if (data.banksUsed.cpos)
            banks.push('CPOS');
        banksInfo += banks.join(' | ');
    }
    else {
        banksInfo += 'SINAPI/ORSE'; // Default
    }
    const bdiInfo = `B.D.I.: ${bdiVal}%`;
    const encargosInfo = `ENCARGOS SOCIAIS: Horista ${encH}% | Mensalista ${encM}%`;
    // Row 1
    // Merge Strategy: Divide 10 cols. 
    // OBRA: A-E (5 cols) | BANCOS: F-J (5 cols)
    worksheet.mergeCells('A1:E1');
    worksheet.mergeCells('F1:J1');
    const r1 = worksheet.getRow(1);
    r1.getCell(1).value = obraInfo;
    r1.getCell(6).value = banksInfo;
    r1.height = 20;
    // Row 2
    // BDI: A-E | ENCARGOS: F-J
    worksheet.mergeCells('A2:E2');
    worksheet.mergeCells('F2:J2');
    const r2 = worksheet.getRow(2);
    r2.getCell(1).value = bdiInfo;
    r2.getCell(6).value = encargosInfo;
    r2.height = 20;
    // Row 3
    // Title: A-J
    worksheet.mergeCells('A3:J3');
    const r3 = worksheet.getRow(3);
    r3.getCell(1).value = 'ORÇAMENTO SINTÉTICO';
    r3.height = 25;
    // STYLES FOR TOP
    [r1, r2].forEach(row => {
        row.eachCell(cell => {
            cell.font = { bold: true, size: 9 };
            cell.alignment = { vertical: 'middle', horizontal: 'left' };
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        });
    });
    r3.getCell(1).font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    r3.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    r3.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
    r3.getCell(1).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    // -------------------------------------------------------------------------
    // 4. TABLE HEADER (ROW 4)
    // -------------------------------------------------------------------------
    const headerRow = worksheet.getRow(4);
    headerRow.values = [
        'Item', 'Código', 'Banco', 'Descrição', 'Und',
        'Quant.', 'Valor Unit', 'Valor Unit com BDI', 'Total', 'Peso (%)'
    ];
    headerRow.height = 20;
    headerRow.eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    });
    // -------------------------------------------------------------------------
    // 5. DATA ROWS
    // -------------------------------------------------------------------------
    processedItems.forEach((item, index) => {
        const isGroup = item.isGroup;
        const level = getHierarchyLevel(item.itemNumber);
        // Weight Calculation
        const weight = grandTotal > 0 ? (item.displayTotal / grandTotal) : 0;
        let code = item.code || '';
        let source = item.source || '';
        if (isGroup) {
            code = '';
            source = '';
        }
        else {
            if (code === 'IMP')
                code = '';
            if (source === 'IMPORT')
                source = '';
        }
        const row = worksheet.addRow([
            item.itemNumber,
            code,
            source,
            item.description,
            (isGroup ? '' : item.unit),
            item.displayQuant,
            (isGroup ? null : item.unitPrice),
            item.displayUnitBDI,
            item.displayTotal,
            weight
        ]);
        // Formatting
        row.getCell(6).numFmt = '#,##0.00'; // Quant
        row.getCell(7).numFmt = '"R$ "#,##0.00'; // Unit
        row.getCell(8).numFmt = '"R$ "#,##0.00'; // Unit BDI
        row.getCell(9).numFmt = '"R$ "#,##0.00'; // Total
        row.getCell(10).numFmt = '0.00%'; // Peso
        // Alignments
        row.eachCell((cell, colNum) => {
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            cell.border = { top: { style: 'thin', color: { argb: 'FFE2E8F0' } }, left: { style: 'thin', color: { argb: 'FFE2E8F0' } }, bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
        });
        row.getCell(4).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }; // Desc
        // Style Groups
        if (isGroup) {
            // Level 1: Dark Blue
            if (level === 1) {
                row.eachCell(c => {
                    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
                    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                    c.border = { top: { style: 'thin' }, bottom: { style: 'thin' } }; // White border usually looks bad, stick to thin
                });
            }
            else if (level === 2) {
                row.eachCell(c => {
                    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
                    c.font = { bold: true };
                });
            }
            else {
                row.font = { bold: true };
            }
        }
        else {
            // Zebra for items
            if (index % 2 === 0) {
                row.eachCell(c => c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } });
            }
        }
    });
    // -------------------------------------------------------------------------
    // 6. TOTALS FOOTER
    // -------------------------------------------------------------------------
    worksheet.addRow([]); // Spacer
    const totalSemBDI = leaves.reduce((acc, l) => acc + (l.quantity * l.unitPrice), 0);
    // Note: totalSemBDI can be diff from grandTotal if BDI logic varies.
    // For consistency with "grandTotal" (which includes BDI), we should calculate BDI part.
    // However, user asked "Total sem BDI" and "Total do BDI".
    // BDI value = GrandTotal - TotalSemBDI.
    const totalBDIVal = grandTotal - totalSemBDI;
    // Label Col F (6) | Value Col H (8) ? 
    // User requested: "Coluna F: Label ; Coluna H: Value"
    // F is "Quant", H is "Valor Unit com BDI". 
    // It's a bit weird (H is Unit), but I will follow instructions.
    // Actually, usually Totals are under "Total". Column I (9).
    // User said: "Bloco de totais finais no fim com label em coluna F e valor em coluna H"
    // Let's implicitly assume user might mean F as 6th col (Quant) and H as 8th (Unit BDI).
    // Or maybe matching the visual model where totals align right.
    // I will strictly follow "F" and "H".
    // Row Total Sem BDI
    const rT1 = worksheet.addRow([]);
    rT1.getCell(6).value = 'Total sem BDI';
    rT1.getCell(8).value = totalSemBDI;
    rT1.getCell(6).font = { bold: true };
    rT1.getCell(8).numFmt = '"R$ "#,##0.00';
    rT1.getCell(6).alignment = { horizontal: 'right' };
    // Row Total BDI
    const rT2 = worksheet.addRow([]);
    rT2.getCell(6).value = 'Total do BDI';
    rT2.getCell(8).value = totalBDIVal;
    rT2.getCell(6).font = { bold: true, color: { argb: 'FF1E3A8A' } };
    rT2.getCell(8).numFmt = '"R$ "#,##0.00';
    rT2.getCell(8).font = { color: { argb: 'FF1E3A8A' } };
    rT2.getCell(6).alignment = { horizontal: 'right' };
    // Row Total Geral
    const rT3 = worksheet.addRow([]);
    rT3.getCell(6).value = 'Total Geral';
    rT3.getCell(8).value = grandTotal;
    rT3.getCell(6).font = { bold: true, size: 11 };
    rT3.getCell(8).numFmt = '"R$ "#,##0.00';
    rT3.getCell(8).font = { bold: true, size: 11 };
    rT3.getCell(6).alignment = { horizontal: 'right' };
    // -------------------------------------------------------------------------
    // 7. PAGE SETUP
    // -------------------------------------------------------------------------
    worksheet.pageSetup.printTitlesRow = '4:4';
    worksheet.pageSetup.margins = { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 };
    // Fit to width is good practice
    worksheet.pageSetup.fitToPage = true;
    worksheet.pageSetup.fitToWidth = 1;
    worksheet.pageSetup.fitToHeight = 0; // unlimited
    return await workbook.xlsx.writeBuffer();
}
async function generatePDFAnalyticBuffer(data) {
    const doc = new jspdf_1.default({ orientation: 'landscape', unit: 'mm', format: 'a4' });
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
    const tableData = [];
    data.items.forEach(item => {
        const level = getHierarchyLevel(item.itemNumber);
        const isGroup = level < 3 || item.type === 'group';
        let code = item.code || '';
        let source = item.source || '';
        if (isGroup) {
            code = '';
            source = '';
        }
        else {
            if (code === 'IMP')
                code = '';
            if (source === 'IMPORT')
                source = '';
        }
        const i = item;
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
    (0, jspdf_autotable_1.default)(doc, {
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
            if (d.section === 'head')
                return;
            // Cast raw to any to access array index without TS error
            const raw = d.row.raw;
            const itemNumber = raw[0];
            const isItemRow = itemNumber && itemNumber !== '';
            if (isItemRow) {
                const level = getHierarchyLevel(itemNumber);
                if (level === 1) {
                    d.cell.styles.fillColor = [30, 58, 138];
                    d.cell.styles.textColor = [255, 255, 255];
                    d.cell.styles.fontStyle = 'bold';
                }
                else if (level === 2) {
                    d.cell.styles.fillColor = [219, 234, 254];
                    d.cell.styles.fontStyle = 'bold';
                    d.cell.styles.textColor = [0, 0, 0];
                }
                else {
                    // Nível 3+ (Item normal)
                    d.cell.styles.fontStyle = 'bold';
                    d.cell.styles.fillColor = [245, 245, 245]; // Leve destaque para linha pai de comp
                }
            }
            else {
                // Linhas de Composição (Filhos)
                const desc = raw[3];
                if (desc === 'COMPOSIÇÃO ANALÍTICA:') {
                    d.cell.styles.fontStyle = 'bold';
                    d.cell.styles.fontSize = 6;
                    d.cell.styles.textColor = [100, 100, 100];
                }
                else {
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
async function generateExcelAnalyticBuffer(data) {
    const workbook = new exceljs_1.default.Workbook();
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
        if (isGroup) {
            code = '';
            source = '';
        }
        else {
            if (code === 'IMP')
                code = '';
            if (source === 'IMPORT')
                source = '';
        }
        // Linha Principal do Item
        const itemRow = worksheet.addRow([
            item.itemNumber,
            source,
            code,
            item.description,
            isGroup ? '' : item.unit,
            isGroup ? null : item.quantity,
            isGroup ? null : item.unitPrice,
            isGroup ? null : (item.unitPriceWithBDI ?? (item.unitPrice * bdiFactor)),
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
        }
        else if (level === 2) {
            itemRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
            itemRow.font = { bold: true, color: { argb: 'FF000000' } };
        }
        else {
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
    const totalSemBDI = data.totalGlobalBase ?? data.items.reduce((acc, item) => acc + (item.type === 'group' ? 0 : (item.totalPrice || 0)), 0);
    const totalGlobalFinal = data.totalGlobalFinal ?? (totalSemBDI * bdiFactor);
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
async function generatePDFABCBuffer(data, type) {
    const doc = new jspdf_1.default({ orientation: 'portrait', unit: 'mm', format: 'a4' });
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
    let rows = [];
    if (type === 'servicos') {
        const items = data.items.filter(i => i.type !== 'group').sort((a, b) => b.totalPrice - a.totalPrice);
        const total = items.reduce((acc, i) => acc + i.totalPrice, 0);
        let accPeso = 0;
        rows = items.map(i => {
            const peso = (i.totalPrice / total) * 100;
            accPeso += peso;
            return [accPeso <= 80 ? 'A' : accPeso <= 95 ? 'B' : 'C', i.itemNumber, i.code, i.description, i.unit, i.quantity, formatCurrency(i.unitPrice), formatCurrency(i.totalPrice), formatPercent(peso), formatPercent(accPeso)];
        });
    }
    else {
        const map = new Map();
        data.items.forEach(i => i.composition?.forEach(c => {
            const k = c.code || c.description;
            if (map.has(k))
                map.get(k).totalPrice += c.totalPrice;
            else
                map.set(k, { ...c });
        }));
        const items = Array.from(map.values()).sort((a, b) => b.totalPrice - a.totalPrice);
        const total = items.reduce((acc, i) => acc + i.totalPrice, 0);
        let accPeso = 0;
        rows = items.map(i => {
            const peso = (i.totalPrice / total) * 100;
            accPeso += peso;
            return [accPeso <= 80 ? 'A' : accPeso <= 95 ? 'B' : 'C', i.code, i.description, i.unit, i.quantity.toFixed(4), formatCurrency(i.unitPrice), formatCurrency(i.totalPrice), formatPercent(peso), formatPercent(accPeso)];
        });
    }
    (0, jspdf_autotable_1.default)(doc, {
        startY: 75,
        head: [['CL', 'ITEM', 'CÓDIGO', 'DESCRIÇÃO', 'UND', 'QTD', 'UNIT', 'TOTAL', '%', 'ACC%']],
        body: rows,
        headStyles: { fillColor: [30, 58, 138], fontSize: 8 },
        styles: { fontSize: 7 },
        didParseCell: (d) => { if (d.row.cells[0]?.text[0] === 'A')
            d.cell.styles.fillColor = [254, 243, 199]; }
    });
    // Financial Summary at the END
    addPDFFinancialSummary(doc, totalSemBDI, data.bdi || 0, totalGeral);
    ensureSpaceForSignature(doc);
    addPDFFooter(doc, data.companySettings, true);
    return doc.output('arraybuffer');
}
async function generateExcelABCBuffer(data, type) {
    const workbook = new exceljs_1.default.Workbook();
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
    }
    else {
        const map = new Map();
        data.items.forEach(i => i.composition?.forEach(c => {
            const k = c.code || c.description;
            if (map.has(k))
                map.get(k).totalPrice += c.totalPrice;
            else
                map.set(k, { ...c });
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
async function generatePDFScheduleBuffer(data) {
    const doc = new jspdf_1.default({ orientation: 'landscape', unit: 'mm', format: 'a4' });
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
    (0, jspdf_autotable_1.default)(doc, {
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
                const level = item.level ?? getHierarchyLevel(item.itemNumber);
                if (level === 1) {
                    d.cell.styles.fillColor = [30, 58, 138];
                    d.cell.styles.textColor = [255, 255, 255];
                    d.cell.styles.fontStyle = 'bold';
                }
                else if (level === 2) {
                    d.cell.styles.fillColor = [219, 234, 254];
                    d.cell.styles.fontStyle = 'bold';
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
async function generateExcelCurvaSBuffer(data) {
    const workbook = new exceljs_1.default.Workbook();
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
async function generatePDFPhysicalScheduleBuffer(data) {
    const doc = new jspdf_1.default({ orientation: 'landscape', unit: 'mm', format: 'a4' });
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
    (0, jspdf_autotable_1.default)(doc, {
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
                const level = item.level ?? getHierarchyLevel(item.itemNumber);
                if (level === 1) {
                    d.cell.styles.fillColor = [30, 58, 138];
                    d.cell.styles.textColor = [255, 255, 255];
                    d.cell.styles.fontStyle = 'bold';
                }
                else if (level === 2) {
                    d.cell.styles.fillColor = [219, 234, 254];
                    d.cell.styles.fontStyle = 'bold';
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
async function generatePDFBDIBuffer(data) {
    const doc = new jspdf_1.default({ orientation: 'portrait', unit: 'mm', format: 'a4' });
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
    const tableBody = [];
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
    (0, jspdf_autotable_1.default)(doc, {
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
    const summaryY = doc.lastAutoTable.finalY + 15;
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
async function generatePDFEncargosBuffer(data) {
    const doc = new jspdf_1.default({ orientation: 'portrait', unit: 'mm', format: 'a4' });
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
    const calcTotal = (items) => ({
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
    const tableBody = [];
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
    (0, jspdf_autotable_1.default)(doc, {
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
    const infoY = doc.lastAutoTable.finalY + 10;
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
async function exportCompleteProject(data, onProgress) {
    const JSZip = (await Promise.resolve().then(() => __importStar(require('jszip')))).default;
    const zip = new JSZip();
    const nameClean = sanitizeFilename(data.budgetName);
    const pdfFolder = zip.folder("PDF");
    const xlsxFolder = zip.folder("Excel");
    // Total steps estimation: Synt (2), Analyt (2), Sched (2), ABC/BDI (4) = 10
    const totalSteps = 10;
    let currentStep = 0;
    const updateProgress = (msg) => {
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
function isAnalyticRequiredItem(item) {
    if (item.type === 'group')
        return false;
    // SINAL ÚNICO DE CPU: Tem compositionId definido
    if (item.compositionId && item.compositionId.length > 0)
        return true;
    return false;
}
function validateAnalytics(items) {
    const rawCompositions = [];
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
async function generateExcelScheduleBuffer(data) {
    const workbook = new exceljs_1.default.Workbook();
    const worksheet = workbook.addWorksheet('Cronograma');
    const months = data.constructionSchedule?.months || [];
    // Config Columns: Item(10), Desc(50), Months(15...), Total(18)
    const columns = [
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
            if (colNum === 1)
                cell.alignment = { horizontal: 'center' };
            // Zebra
            if (level > 2 && isEven)
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
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
        }
        else if (level === 2) {
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
            if (getHierarchyLevel(i.itemNumber) === 1)
                return acc + (i.months[m] || 0);
            return acc;
        }, 0);
        totalRowValues.push(sumMonth);
        globalTotal += sumMonth;
    });
    totalRowValues.push(globalTotal);
    const totalRow = worksheet.addRow(totalRowValues);
    totalRow.font = { bold: true };
    totalRow.eachCell((cell, colNum) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
        if (colNum > 2)
            cell.numFmt = '"R$ "#,##0.00';
        cell.border = { top: { style: 'thin' } };
    });
    addExcelFooter(worksheet, data.companySettings, lastColLetter);
    return await workbook.xlsx.writeBuffer();
}
// Helper to get Excel Column Letter (A, B, ... AA, AB)
function getExcelColLetter(colIndex) {
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
async function saveAs(blob, name) {
    const { saveAs: fileSaverSaveAs } = await Promise.resolve().then(() => __importStar(require('file-saver')));
    fileSaverSaveAs(blob, name);
}
