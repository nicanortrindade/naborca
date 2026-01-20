
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { type BudgetItem, type CompanySettings } from '../../types/domain';


interface ProposalData {
    budgetName: string;
    clientName: string;
    date: Date;
    totalValue: number;
    bdi: number;
    items: (BudgetItem & { itemNumber?: string, composition?: any[] })[];
    companySettings?: CompanySettings;
}

const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

export const generateEncargosFullReport = (settings: any, baseSem: any, baseCom: any) => {
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // Cabeçalho com logo
    if (settings?.logo) {
        try { doc.addImage(settings.logo, 'PNG', 14, 10, 35, 35); } catch (e) { }
    }

    // Título
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.text("ENCARGOS SOCIAIS", pageWidth / 2, 20, { align: 'center' });

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("Composição Detalhada - Horista vs Mensalista", pageWidth / 2, 27, { align: 'center' });

    // Dados da empresa e referência
    doc.setFontSize(8);
    doc.text(String(settings?.name || "EMPRESA").toUpperCase(), 50, 15);
    doc.text(`CNPJ: ${settings?.cnpj || ''}`, 50, 20);
    doc.text(`Referência: ${baseSem.nome} / ${baseCom.nome}`, 50, 25);
    doc.text(`Data Ref.: ${baseSem.dataReferencia}`, 50, 30);

    doc.setFontSize(7);
    const hoje = format(new Date(), "dd/MM/yyyy HH:mm");
    doc.text(`Gerado em: ${hoje}`, pageWidth - 14, 15, { align: 'right' });

    doc.line(14, 40, pageWidth - 14, 40);

    let startY = 45;

    // Iterar pelos grupos (A, B, C, D)
    const grupos = ['Grupo A', 'Grupo B', 'Grupo C', 'Grupo D'];

    grupos.forEach((grupoNome, idx) => {
        const gSem = baseSem.grupos.find((g: any) => g.nome === grupoNome);
        const gCom = baseCom.grupos.find((g: any) => g.nome === grupoNome);

        if (!gSem) return;

        // Cabeçalho do Grupo
        doc.setFillColor(51, 65, 85);
        doc.rect(14, startY, pageWidth - 28, 6, 'F');
        doc.setFontSize(9);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(255, 255, 255);
        doc.text(`${gSem.nome} - ${gSem.descricao}`, 18, startY + 4);
        startY += 6;

        // Montar linhas da tabela
        const tableBody: any[] = [];

        // Mapear itens pelo código
        const codigos = Array.from(new Set(gSem.itens.map((i: any) => i.codigo)));

        codigos.forEach(cod => {
            const itemSem = gSem.itens.find((i: any) => i.codigo === cod);
            const itemCom = gCom?.itens.find((i: any) => i.codigo === cod);

            tableBody.push([
                cod,
                itemSem.descricao,
                `${(itemCom?.horista || 0).toFixed(2)}%`,
                `${(itemCom?.mensalista || 0).toFixed(2)}%`,
                `${(itemSem.horista).toFixed(2)}%`,
                `${(itemSem.mensalista).toFixed(2)}%`
            ]);
        });

        // Subtotais
        const totalSemH = gSem.itens.reduce((acc: number, i: any) => acc + i.horista, 0);
        const totalSemM = gSem.itens.reduce((acc: number, i: any) => acc + i.mensalista, 0);
        const totalComH = gCom?.itens.reduce((acc: number, i: any) => acc + i.horista, 0) || 0;
        const totalComM = gCom?.itens.reduce((acc: number, i: any) => acc + i.mensalista, 0) || 0;

        tableBody.push([
            { content: grupoNome.charAt(grupoNome.length - 1), styles: { fontStyle: 'bold' } },
            { content: 'TOTAL DO GRUPO', styles: { fontStyle: 'bold' } },
            { content: `${totalComH.toFixed(2)}%`, styles: { fontStyle: 'bold' } },
            { content: `${totalComM.toFixed(2)}%`, styles: { fontStyle: 'bold' } },
            { content: `${totalSemH.toFixed(2)}%`, styles: { fontStyle: 'bold' } },
            { content: `${totalSemM.toFixed(2)}%`, styles: { fontStyle: 'bold' } }
        ]);

        autoTable(doc, {
            startY: startY,
            head: [
                [
                    { content: 'CÓDIGO', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } },
                    { content: 'DESCRIÇÃO', rowSpan: 2, styles: { halign: 'left', valign: 'middle' } },
                    { content: 'COM DESONERAÇÃO', colSpan: 2, styles: { halign: 'center' } },
                    { content: 'SEM DESONERAÇÃO', colSpan: 2, styles: { halign: 'center' } }
                ],
                ['HORISTA (%)', 'MENSALISTA (%)', 'HORISTA (%)', 'MENSALISTA (%)']
            ],
            body: tableBody,
            theme: 'grid',
            headStyles: { fillColor: [100, 116, 139], fontSize: 7, textColor: [255, 255, 255] },
            bodyStyles: { fontSize: 7 },
            columnStyles: {
                0: { cellWidth: 15, halign: 'center' },
                1: { cellWidth: 'auto' },
                2: { cellWidth: 22, halign: 'right' },
                3: { cellWidth: 22, halign: 'right' },
                4: { cellWidth: 22, halign: 'right' },
                5: { cellWidth: 22, halign: 'right' }
            },
            styles: { cellPadding: 1 },
            didDrawPage: (data) => {
                startY = data.cursor?.y || startY;
            }
        });

        startY = (doc as any).lastAutoTable.finalY + 5;

        // Verificar quebra de página
        if (startY > pageHeight - 40 && idx < grupos.length - 1) {
            doc.addPage();
            startY = 20;
        }
    });

    // TOTAL FINAL
    const totalFinalSemH = baseSem.grupos.reduce((acc: number, g: any) => acc + g.itens.reduce((s: number, i: any) => s + i.horista, 0), 0);
    const totalFinalSemM = baseSem.grupos.reduce((acc: number, g: any) => acc + g.itens.reduce((s: number, i: any) => s + i.mensalista, 0), 0);
    const totalFinalComH = baseCom.grupos.reduce((acc: number, g: any) => acc + g.itens.reduce((s: number, i: any) => s + i.horista, 0), 0);
    const totalFinalComM = baseCom.grupos.reduce((acc: number, g: any) => acc + g.itens.reduce((s: number, i: any) => s + i.mensalista, 0), 0);

    startY += 5;
    if (startY > pageHeight - 40) { doc.addPage(); startY = 20; }

    doc.setFillColor(22, 163, 74);
    doc.rect(14, startY, pageWidth - 28, 10, 'F');
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(255, 255, 255);
    doc.text("TOTAL GERAL DE ENCARGOS SOCIAIS:", 18, startY + 6.5);

    doc.setFontSize(8);
    doc.text(`${totalFinalComH.toFixed(2)}%`, pageWidth - 80, startY + 6.5, { align: 'right' });
    doc.text(`${totalFinalComM.toFixed(2)}%`, pageWidth - 58, startY + 6.5, { align: 'right' });
    doc.text(`${totalFinalSemH.toFixed(2)}%`, pageWidth - 36, startY + 6.5, { align: 'right' });
    doc.text(`${totalFinalSemM.toFixed(2)}%`, pageWidth - 14, startY + 6.5, { align: 'right' });

    // Rodapé / Assinatura
    startY += 30;
    doc.setDrawColor(200);
    doc.line(14, startY, pageWidth / 2 - 10, startY);
    doc.setFontSize(7);
    doc.setTextColor(100);
    doc.text(String(settings?.name || "RESPONSÁVEL").toUpperCase(), 14, startY + 4);
    doc.text(`CNPJ: ${settings?.cnpj || ''}`, 14, startY + 8);

    doc.save(`Encargos_Sociais_Completo_${format(new Date(), 'dd-MM-yyyy')}.pdf`);
};

export const generateProposalPDF = (data: ProposalData, type: 'synthetic' | 'analytic' = 'synthetic') => {
    const doc = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4'
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const bdiFactor = 1 + (data.bdi || 0) / 100;
    const settings = data.companySettings;

    const margin = 14;
    const contentWidth = pageWidth - (margin * 2);

    const drawHeader = (doc: jsPDF, title: string) => {
        // Background for Header Title Area (Very subtle)
        doc.setFillColor(248, 250, 252);
        doc.rect(0, 0, pageWidth, 40, 'F');

        // Logo - Center or Left? Left looks more professional in reports
        if (settings?.logo) {
            try {
                // Keep logo proportions
                doc.addImage(settings.logo, 'PNG', margin, 10, 25, 20);
            } catch (e) {
                doc.setFontSize(16);
                doc.setTextColor(15, 23, 42);
                doc.setFont("helvetica", "bold");
                doc.text(settings.name || "ORÇAMENTO", margin, 20);
            }
        } else {
            doc.setFontSize(18);
            doc.setTextColor(15, 23, 42);
            doc.setFont("helvetica", "bold");
            doc.text(settings?.name || "NABOORÇA", margin, 20);
        }

        // Title and Date (Right Aligned)
        doc.setFontSize(12);
        doc.setTextColor(30, 41, 59);
        doc.setFont("helvetica", "bold");
        doc.text(title.toUpperCase(), pageWidth - margin, 18, { align: 'right' });

        doc.setFontSize(9);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(100);
        doc.text(format(new Date(), "dd 'de' MMMM 'de' yyyy", { locale: ptBR }), pageWidth - margin, 24, { align: 'right' });

        // Decorative Line
        doc.setDrawColor(15, 23, 42);
        doc.setLineWidth(0.5);
        doc.line(margin, 32, pageWidth - margin, 32);

        // Meta Info Block
        let metaY = 42;
        doc.setFontSize(8.5);
        doc.setTextColor(15, 23, 42);

        // Row 1: Project
        doc.setFont("helvetica", "bold");
        doc.text("PROJETO:", margin, metaY);
        doc.setFont("helvetica", "normal");
        const budgetName = (data.budgetName || 'NÃO INFORMADO').toUpperCase();
        const budgetLines = doc.splitTextToSize(budgetName, contentWidth - 60);
        doc.text(budgetLines, margin + 20, metaY);

        // BDI Info (pinned to right of row 1)
        doc.setFont("helvetica", "bold");
        doc.text(`BDI:`, pageWidth - margin - 20, metaY);
        doc.setFont("helvetica", "normal");
        doc.text(`${data.bdi}%`, pageWidth - margin, metaY, { align: 'right' });

        metaY += (budgetLines.length * 4);

        // Row 2: Client
        const isRealClient = data.clientName &&
            data.clientName.trim().toUpperCase() !== 'SEM CLIENTE' &&
            data.clientName.trim().toUpperCase() !== 'NÃO INFORMADO';

        if (isRealClient) {
            doc.setFont("helvetica", "bold");
            doc.text("CLIENTE:", margin, metaY);
            doc.setFont("helvetica", "normal");
            doc.text(data.clientName.toUpperCase(), margin + 20, metaY);
            metaY += 5;
        }

        // Final line before table
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.1);
        doc.line(margin, metaY + 1, pageWidth - margin, metaY + 1);

        return metaY + 6; // Return next Y position
    };

    const drawFooter = (doc: jsPDF, isLastPage = false) => {
        // Clean Footer
        doc.setDrawColor(226, 232, 240);
        doc.line(margin, pageHeight - 15, pageWidth - margin, pageHeight - 15);

        doc.setFontSize(7);
        doc.setTextColor(148, 163, 184);
        doc.setFont("helvetica", "normal");
        const companyLabel = settings?.name || 'NABOORÇA';
        doc.text(`${companyLabel} - Sistema de Orçamentação Inteligente`, margin, pageHeight - 10);

        doc.text(`Página ${doc.getNumberOfPages()}`, pageWidth - margin, pageHeight - 10, { align: 'right' });
    };

    if (type === 'analytic') {
        let startY = drawHeader(doc, "ORÇAMENTO ANALÍTICO (CPU)");
        let currentY = startY;

        const analyticItems = data.items.filter(i => i.type !== 'group');

        analyticItems.forEach((item) => {
            const composition = item.composition || [];
            const compRows = composition.map((c: any) => [
                c.code || '',
                c.description || '',
                c.unit || '',
                (c.quantity || c.coefficient || 0).toFixed(4),
                formatCurrency(c.unitPrice || 0),
                formatCurrency(c.totalPrice || 0)
            ]);

            if (currentY > pageHeight - 50) {
                doc.addPage();
                currentY = drawHeader(doc, "ORÇAMENTO ANALÍTICO (CPU)");
            }

            // Item Header Bar
            doc.setFillColor(248, 250, 252);
            doc.rect(margin, currentY, contentWidth, 10, 'F');
            doc.setFontSize(8);
            doc.setTextColor(15, 23, 42);
            doc.setFont("helvetica", "bold");
            doc.text(`${item.itemNumber || ''} - ${(item.description || '').toUpperCase()}`, margin + 3, currentY + 6);

            doc.setFont("helvetica", "normal");
            doc.text(`TOTAL: ${formatCurrency((item.totalPrice || 0) * bdiFactor)}`, pageWidth - margin - 3, currentY + 6, { align: 'right' });

            currentY += 11;

            if (compRows.length > 0) {
                autoTable(doc, {
                    startY: currentY,
                    head: [['CÓDIGO', 'INSUMO / COMPOSIÇÃO', 'UNID.', 'COEF.', 'R$ UNIT.', 'R$ TOTAL']],
                    body: compRows,
                    theme: 'grid',
                    headStyles: { fillColor: [51, 65, 85], fontSize: 6.5, cellPadding: 1, halign: 'center' },
                    styles: { fontSize: 6.5, cellPadding: 1 },
                    margin: { left: margin + 5, right: margin },
                    tableWidth: contentWidth - 5,
                    columnStyles: {
                        0: { cellWidth: 15, halign: 'center' },
                        1: { cellWidth: 'auto' },
                        2: { cellWidth: 10, halign: 'center' },
                        3: { cellWidth: 12, halign: 'right' },
                        4: { cellWidth: 18, halign: 'right' },
                        5: { cellWidth: 18, halign: 'right' }
                    }
                });
                currentY = (doc as any).lastAutoTable.finalY + 8;
            } else {
                currentY += 4;
            }
        });

    } else {
        // --- SYNTHETIC (IMAGE 1 STYLE) ---
        let startY = drawHeader(doc, "PLANILHA ORÇAMENTÁRIA SINTÉTICA");

        const tableRows = data.items.map((item) => {
            const isGroup = item.type === 'group';
            const unitPrice = (item.unitPrice || 0) * bdiFactor;
            const totalPrice = (item.totalPrice || 0) * bdiFactor;

            if (isGroup) {
                return [
                    { content: item.itemNumber || '', styles: { fontStyle: 'bold', fillColor: [241, 245, 249] } },
                    { content: 'IMP', styles: { fontStyle: 'bold', fillColor: [241, 245, 249] } },
                    { content: '', styles: { fillColor: [241, 245, 249] } },
                    { content: (item.description || '').toUpperCase(), styles: { fontStyle: 'bold', fillColor: [241, 245, 249] } },
                    { content: 'UN', styles: { fillColor: [241, 245, 249], halign: 'center' } },
                    { content: '1,00', styles: { fillColor: [241, 245, 249], halign: 'right' } },
                    { content: formatCurrency(totalPrice), styles: { fontStyle: 'bold', halign: 'right', fillColor: [241, 245, 249] } },
                    { content: formatCurrency(totalPrice), styles: { fontStyle: 'bold', halign: 'right', fillColor: [241, 245, 249] } }
                ];
            }

            return [
                item.itemNumber || '',
                item.source || 'PRÓPRIO',
                item.code || '',
                item.description || '',
                item.unit || '',
                new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 }).format(item.quantity || 0),
                formatCurrency(unitPrice),
                formatCurrency(totalPrice)
            ];
        });

        autoTable(doc, {
            startY: startY,
            head: [['ITEM', 'FONTE', 'CÓDIGO', 'DESCRIÇÃO', 'UNID.', 'QTD.', 'P. UNIT. (C/ BDI)', 'P. TOTAL']],
            body: tableRows as any,
            theme: 'grid',
            headStyles: {
                fillColor: [15, 23, 42],
                textColor: [255, 255, 255],
                fontSize: 6.5,
                fontStyle: 'bold',
                halign: 'center',
                valign: 'middle'
            },
            styles: {
                fontSize: 6.5,
                cellPadding: 1,
                textColor: [30, 41, 59],
                valign: 'middle',
                lineWidth: 0.05,
                lineColor: [203, 213, 225]
            },
            columnStyles: {
                0: { cellWidth: 10, halign: 'center' }, // ITEM
                1: { cellWidth: 12, halign: 'center' }, // FONTE
                2: { cellWidth: 15, halign: 'center' }, // CODIGO
                3: { cellWidth: 'auto', halign: 'left' }, // DESCRICAO
                4: { cellWidth: 9, halign: 'center' }, // UNID
                5: { cellWidth: 12, halign: 'right' }, // QTD
                6: { cellWidth: 20, halign: 'right', fillColor: [240, 253, 244] }, // UNIT
                7: { cellWidth: 20, halign: 'right', fillColor: [240, 253, 244] }  // TOTAL
            },
            didDrawPage: () => drawFooter(doc)
        });

        // Totals
        let finalY = (doc as any).lastAutoTable.finalY + margin;
        if (finalY > pageHeight - 30) {
            doc.addPage();
            finalY = margin + 5;
        }

        const costValue = data.totalValue / (1 + (data.bdi / 100));
        const bdiAmount = data.totalValue - costValue;

        // Grand Total Block (IMAGE 1 STYLE)
        doc.setFillColor(15, 23, 42); // Navy/Slate 900
        doc.rect(pageWidth - margin - 60, finalY, 60, 20, 'F');

        doc.setFontSize(8);
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "normal");
        doc.text("TOTAL GERAL", pageWidth - margin - 30, finalY + 8, { align: 'center' });

        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        doc.text(formatCurrency(data.totalValue), pageWidth - margin - 30, finalY + 14, { align: 'center' });
    }

    drawFooter(doc, true);

    // Terms
    if (settings?.proposalTerms) {
        doc.addPage();
        drawHeader(doc, "TERMOS E CONDIÇÕES");
        doc.setFontSize(9);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(51, 65, 85);
        const termsLines = doc.splitTextToSize(settings.proposalTerms, contentWidth);
        doc.text(termsLines, margin, margin + 40);
        drawFooter(doc, true);
    }

    doc.save(`Proposta_${(data.budgetName || 'Orcamento').replace(/\s+/g, '_')}.pdf`);
};

export const generateBDIReport = (settings: any, bdiData: any, finalBDI: number) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    // Reutilizar lógica básica de cabeçalho
    if (settings?.logo) {
        try { doc.addImage(settings.logo, 'PNG', 14, 10, 30, 30); } catch (e) { }
    }
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("DEMONSTRATIVO DE CÁLCULO DE BDI", 50, 20);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(settings?.name || "NABOORÇA", 50, 26);
    doc.text(`CNPJ: ${settings?.cnpj || ''}`, 50, 31);

    doc.line(14, 45, pageWidth - 14, 45);

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("COMPONENTES DO BDI (FÓRMULA TCU)", 14, 55);

    const totalI = (bdiData.i_pis || 0) + (bdiData.i_cofins || 0) + (bdiData.i_iss || 0) + (bdiData.i_cprb || 0);

    const rows = [
        ['TAXA DE RATEIO DA ADMINISTRAÇÃO CENTRAL', 'AC', `${bdiData.ac}%`],
        ['TAXA DE SEGURO E GARANTIA DO EMPREENDIMENTO', 'S+G', `${bdiData.sg}%`],
        ['TAXA DE RISCO', 'R', `${bdiData.r}%`],
        ['TAXA DE DESPESAS FINANCEIRAS', 'DF', `${bdiData.df}%`],
        ['TAXA DE LUCRO', 'L', `${bdiData.l}%`],
        ['TAXA DE TRIBUTOS (PIS, COFINS, ISS, CPRB)', 'I', `${totalI.toFixed(2)}%`],
        ['   - PIS', '', `${bdiData.i_pis}%`],
        ['   - COFINS', '', `${bdiData.i_cofins}%`],
        ['   - ISS', '', `${bdiData.i_iss}%`],
        ['   - CPRB', '', `${bdiData.i_cprb}%`],
    ];

    autoTable(doc, {
        startY: 60,
        head: [['ITENS', 'SIGLAS', 'VALORES']],
        body: rows,
        theme: 'striped',
        headStyles: { fillColor: [15, 23, 42] },
        styles: { fontSize: 9 },
        columnStyles: {
            1: { halign: 'center' },
            2: { halign: 'right' }
        }
    });

    const finalY = (doc as any).lastAutoTable.finalY + 15;

    doc.setFontSize(14);
    doc.text("FÓRMULA UTILIZADA:", 14, finalY);
    doc.setFontSize(10);
    doc.setFont("helvetica", "italic");
    doc.text("BDI = [((1 + AC + S + R + G) * (1 + DF) * (1 + L)) / (1 - I) - 1] * 100", 14, finalY + 8);

    doc.setFillColor(241, 245, 249);
    doc.rect(14, finalY + 15, pageWidth - 28, 20, 'F');
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 58, 138);
    doc.text("BDI CALCULADO:", 20, finalY + 28);
    doc.text(`${finalBDI.toFixed(2)}%`, pageWidth - 20, finalY + 28, { align: 'right' });

    // Disclaimer removido

    doc.save(`Calculo_BDI_${format(new Date(), 'dd-MM-yyyy')}.pdf`);
};

export const generateEncargosReport = (settings: any, base: any, tipo: 'horista' | 'mensalista' = 'horista') => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // Cabeçalho com logo
    if (settings?.logo) {
        try { doc.addImage(settings.logo, 'PNG', 14, 10, 35, 35); } catch (e) { }
    }

    // Título
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.text("ENCARGOS SOCIAIS", pageWidth / 2, 20, { align: 'center' });

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("Encargos Sociais Sobre a Mão de Obra", pageWidth / 2, 27, { align: 'center' });

    // Dados da empresa e referência
    doc.setFontSize(9);
    doc.text(settings?.name || "NABOORÇA", pageWidth - 14, 15, { align: 'right' });
    doc.text(`CNPJ: ${settings?.cnpj || ''}`, pageWidth - 14, 20, { align: 'right' });
    doc.text(`Referência: ${base.nome}`, pageWidth - 14, 25, { align: 'right' });
    doc.text(`Tipo: ${tipo === 'horista' ? 'Horista' : 'Mensalista'}`, pageWidth - 14, 30, { align: 'right' });
    doc.text(`Data Ref.: ${base.dataReferencia || 'Jan/2025'}`, pageWidth - 14, 35, { align: 'right' });

    doc.line(14, 45, pageWidth - 14, 45);

    let startY = 52;
    const tipoCol = tipo;

    // Iterar por cada grupo
    base.grupos.forEach((grupo: any, grupoIdx: number) => {
        // Cabeçalho do grupo
        doc.setFillColor(30, 41, 59);
        doc.rect(14, startY, pageWidth - 28, 8, 'F');
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(255, 255, 255);
        doc.text(`${grupo.nome} - ${grupo.descricao}`, 18, startY + 6);
        startY += 10;

        // Montar dados da tabela
        const rows = grupo.itens.map((item: any) => [
            item.codigo,
            item.descricao,
            `${item[tipoCol].toFixed(2)}%`
        ]);

        // Subtotal do grupo
        const subtotal = grupo.itens.reduce((acc: number, item: any) => acc + item[tipoCol], 0);
        rows.push([grupo.nome.charAt(grupo.nome.length - 1), 'Total', `${subtotal.toFixed(2)}%`]);

        autoTable(doc, {
            startY: startY,
            head: [['Código', 'Descrição', `${tipo === 'horista' ? 'Horista' : 'Mensalista'} (%)`]],
            body: rows,
            theme: 'grid',
            headStyles: { fillColor: [100, 116, 139], fontSize: 8 },
            bodyStyles: { fontSize: 8 },
            columnStyles: {
                0: { cellWidth: 15, halign: 'center' },
                1: { cellWidth: 'auto' },
                2: { cellWidth: 25, halign: 'right' }
            },
            didParseCell: (data: any) => {
                // Destacar linha de subtotal
                if (data.row.index === rows.length - 1) {
                    data.cell.styles.fontStyle = 'bold';
                    data.cell.styles.fillColor = [241, 245, 249];
                }
            }
        });

        startY = (doc as any).lastAutoTable.finalY + 8;

        // Nova página se necessário
        if (startY > pageHeight - 60 && grupoIdx < base.grupos.length - 1) {
            doc.addPage();
            startY = 20;
        }
    });

    // Total Geral
    const totalGeral = base.grupos.reduce((acc: number, grupo: any) => {
        return acc + grupo.itens.reduce((sum: number, item: any) => sum + item[tipoCol], 0);
    }, 0);

    startY += 5;
    doc.setFillColor(22, 163, 74);
    doc.rect(14, startY, pageWidth - 28, 14, 'F');
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(255, 255, 255);
    doc.text("TOTAL DE ENCARGOS SOCIAIS (A+B+C+D):", 20, startY + 10);
    doc.setFontSize(14);
    doc.text(`${totalGeral.toFixed(2)}%`, pageWidth - 20, startY + 10, { align: 'right' });

    // Data e local
    startY += 25;
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "normal");
    const hoje = format(new Date(), "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
    doc.text(`${settings?.city || 'Local'}, ${hoje}`, pageWidth - 14, startY, { align: 'right' });

    // Assinatura
    startY += 20;
    doc.line(14, startY, 90, startY);
    doc.setFontSize(8);
    doc.text(settings?.name || "EMPRESA", 14, startY + 5);
    doc.text(`CNPJ: ${settings?.cnpj || ''}`, 14, startY + 10);
    if (settings?.responsibleName) {
        doc.text(`${settings.responsibleName}`, 14, startY + 15);
        doc.text(`CREA/CAU: ${settings?.responsibleCrea || ''}`, 14, startY + 20);
    }

    // Disclaimer removido

    doc.save(`Encargos_Sociais_${base.id || 'base'}_${tipo}_${format(new Date(), 'dd-MM-yyyy')}.pdf`);
};

// Versão simplificada para compatibilidade (usa dados resumidos)
export const generateEncargosReportSimple = (settings: any, baseName: string, total: number, data: any) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    if (settings?.logo) {
        try { doc.addImage(settings.logo, 'PNG', 14, 10, 30, 30); } catch (e) { }
    }
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("COMPOSIÇÃO DE ENCARGOS SOCIAIS", 50, 20);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(settings?.name || "NABOORÇA", 50, 26);
    doc.text(`Referência: ${baseName}`, 50, 31);

    doc.line(14, 45, pageWidth - 14, 45);

    const body = Object.entries(data).map(([key, val]) => [key, `${val}%`]);

    autoTable(doc, {
        startY: 55,
        head: [['Grupo / Descrição', 'Percentual (%)']],
        body: body,
        theme: 'grid',
        headStyles: { fillColor: [15, 23, 42] }
    });

    const finalY = (doc as any).lastAutoTable.finalY + 15;
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text("TOTAL DE ENCARGOS SOCIAIS:", 14, finalY);
    doc.setTextColor(22, 163, 74);
    doc.text(`${total.toFixed(2)}%`, pageWidth - 14, finalY, { align: 'right' });

    const pageHeight = doc.internal.pageSize.getHeight();
    doc.setDrawColor(200);
    doc.line(14, pageHeight - 20, pageWidth - 14, pageHeight - 20);
    doc.setFontSize(6);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(150);
    doc.text("Estes encargos sociais são referências oficiais (SINAPI/SICRO) e podem divergir da realidade contábil da empresa. Não substitui consulta profissional.", pageWidth / 2, pageHeight - 15, { align: 'center' });

    doc.save(`Encargos_${baseName.replace(/\\s+/g, '_')}.pdf`);
};

