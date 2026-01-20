
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface ScheduleData {
    budgetName: string;
    clientName: string;
    totalValue: number;
    bdi: number;
    periods: number[];
    labels: Record<number, string>;
    items: any[];
    distributions: Record<string, Record<number, number>>;
    companySettings?: any;
}

const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

export const generateSchedulePDF = (data: ScheduleData) => {
    const doc = new jsPDF('l', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const settings = data.companySettings;
    const bdiFactor = 1 + (data.bdi || 0) / 100;

    const drawHeader = (doc: jsPDF, title: string) => {
        // Logo
        if (settings?.logo) {
            try { doc.addImage(settings.logo, 'PNG', 14, 10, 30, 30); } catch (e) { }
        }

        // Company Name Central
        doc.setFontSize(settings?.name?.length > 30 ? 14 : 16);
        doc.setTextColor(15, 23, 42);
        doc.setFont("helvetica", "bold");
        doc.text(settings?.name || "LABOORÇA", pageWidth / 2, 18, { align: 'center' });

        doc.setFontSize(9);
        doc.setFont("helvetica", "normal");
        doc.text(`CNPJ: ${settings?.cnpj || ''}`, pageWidth / 2, 23, { align: 'center' });

        doc.setFontSize(10);
        doc.text(title, pageWidth / 2, 30, { align: 'center' });

        doc.setFontSize(9);
        doc.text(format(new Date(), "dd/MM/yyyy", { locale: ptBR }), pageWidth - 14, 18, { align: 'right' });

        doc.setDrawColor(226, 232, 240);
        doc.line(14, 35, pageWidth - 14, 35);

        const isRealClient = data.clientName &&
            data.clientName.trim().toUpperCase() !== 'SEM CLIENTE' &&
            data.clientName.trim().toUpperCase() !== 'NÃO INFORMADO' &&
            data.clientName.trim() !== '';

        if (isRealClient) {
            doc.setFontSize(8);
            doc.setTextColor(71, 85, 105);
            doc.text("CLIENTE:", 14, 42);
            doc.setFont("helvetica", "bold");
            doc.text(data.clientName.toUpperCase(), 30, 42);

            doc.setFont("helvetica", "normal");
            doc.text("PROJETO:", 14, 47);
            doc.setFont("helvetica", "bold");
            doc.text((data.budgetName || 'NÃO INFORMADO').toUpperCase(), 30, 47);
        } else {
            doc.setFontSize(8);
            doc.setTextColor(71, 85, 105);
            doc.text("PROJETO:", 14, 42);
            doc.setFont("helvetica", "bold");
            doc.text((data.budgetName || 'NÃO INFORMADO').toUpperCase(), 30, 42);
        }

        doc.setFont("helvetica", "normal");
        doc.text("BDI:", pageWidth - 40, 42);
        doc.setFont("helvetica", "bold");
        doc.text(`${data.bdi}%`, pageWidth - 30, 42);
    };

    const drawFooter = (doc: jsPDF, isLastPage = false) => {
        if (settings && isLastPage) {
            const footerY = pageHeight - 25;
            doc.setDrawColor(200);
            doc.line(60, footerY, pageWidth - 60, footerY);

            doc.setFontSize(8);
            doc.setTextColor(15, 23, 42);
            doc.setFont("helvetica", "bold");

            const respName = (settings.responsibleName || '').toUpperCase();
            doc.text(respName, pageWidth / 2, footerY + 5, { align: 'center' });

            doc.setFont("helvetica", "normal");
            doc.setFontSize(7);
            const respCpf = settings.responsibleCpf || '';
            const respCrea = settings.responsibleCrea || '';
            doc.text(`CPF: ${respCpf} - REPRESENTANTE LEGAL`, pageWidth / 2, footerY + 9, { align: 'center' });
            doc.text(`CREA/CAU: ${respCrea} - RESPONSÁVEL TÉCNICO`, pageWidth / 2, footerY + 13, { align: 'center' });
        }

        doc.setFontSize(7);
        doc.setTextColor(150);
        doc.text(`Página ${doc.getNumberOfPages()}`, pageWidth - 14, pageHeight - 10, { align: 'right' });
    };

    drawHeader(doc, "CRONOGRAMA FÍSICO-FINANCEIRO");

    const periodHeaders = data.periods.map(p => data.labels[p] || `${p * 30} DIAS`);
    const head = [['ITEM', 'DESCRIÇÃO', 'TOTAL POR ETAPA', ...periodHeaders]];

    const body: any[] = [];

    data.items.forEach((item) => {
        const isGroup = item.type === 'group';
        const itemTotal = isGroup ? 0 : (item.totalPrice * bdiFactor);

        const periodValues = data.periods.map(p => {
            const perc = data.distributions[item.id!]?.[p] || 0;
            if (perc === 0) return '-';
            const val = (itemTotal * perc) / 100;
            return `${perc}%\n(${formatCurrency(val)})`;
        });

        if (isGroup) {
            body.push([
                { content: item.itemNumber, styles: { fontStyle: 'bold', fillColor: [248, 250, 252], textColor: [30, 41, 59] } },
                { content: item.description.toUpperCase(), styles: { fontStyle: 'bold', fillColor: [248, 250, 252], textColor: [30, 41, 59] } },
                { content: '100,00%', styles: { fontStyle: 'bold', fillColor: [248, 250, 252], halign: 'right' } },
                ...data.periods.map(() => ({ content: '', styles: { fillColor: [248, 250, 252] } }))
            ]);
        } else {
            body.push([
                item.itemNumber,
                item.description,
                { content: `100,00%\n${formatCurrency(itemTotal)}`, styles: { halign: 'right' } },
                ...periodValues.map(v => ({ content: v, styles: { halign: 'center' } }))
            ]);
        }
    });

    // Sub-summary calculations
    const periodCosts = data.periods.map(p => {
        let cost = 0;
        data.items.filter(i => i.type !== 'group').forEach(item => {
            const perc = data.distributions[item.id!]?.[p] || 0;
            cost += (item.totalPrice * bdiFactor * perc) / 100;
        });
        return cost;
    });

    const totalValue = data.totalValue;

    // Totals Rows
    body.push([
        { content: 'PORCENTAGEM', colSpan: 2, styles: { fontStyle: 'bold', halign: 'left' } },
        '',
        ...periodCosts.map(cost => ({
            content: totalValue > 0 ? `${((cost / totalValue) * 100).toFixed(2)}%` : '0,00%',
            styles: { fontStyle: 'bold', halign: 'center' }
        }))
    ]);

    body.push([
        { content: 'CUSTO DA ETAPA', colSpan: 2, styles: { fontStyle: 'bold', halign: 'left' } },
        '',
        ...periodCosts.map(cost => ({
            content: formatCurrency(cost),
            styles: { fontStyle: 'bold', halign: 'center' }
        }))
    ]);

    let accCost = 0;
    body.push([
        { content: 'PORCENTAGEM ACUMULADA', colSpan: 2, styles: { fontStyle: 'bold', halign: 'left' } },
        '',
        ...periodCosts.map(cost => {
            accCost += cost;
            return {
                content: totalValue > 0 ? `${((accCost / totalValue) * 100).toFixed(2)}%` : '0,00%',
                styles: { fontStyle: 'bold', halign: 'center' }
            };
        })
    ]);

    // Final Totals Summary
    const finalTotal = data.totalValue;
    const costValue = finalTotal / bdiFactor;
    const bdiAmount = finalTotal - costValue;

    body.push([
        { content: 'TOTAL CUSTO (SEM BDI)', colSpan: 2, styles: { fontStyle: 'bold', halign: 'left', fillColor: [241, 245, 249] } },
        { content: formatCurrency(costValue), styles: { fontStyle: 'bold', halign: 'right', fillColor: [241, 245, 249] } },
        ...data.periods.map(() => ({ content: '', styles: { fillColor: [241, 245, 249] } }))
    ]);

    body.push([
        { content: `TOTAL BDI (${data.bdi}%)`, colSpan: 2, styles: { fontStyle: 'bold', halign: 'left', fillColor: [241, 245, 249] } },
        { content: formatCurrency(bdiAmount), styles: { fontStyle: 'bold', halign: 'right', fillColor: [241, 245, 249] } },
        ...data.periods.map(() => ({ content: '', styles: { fillColor: [241, 245, 249] } }))
    ]);

    body.push([
        { content: 'VALOR TOTAL GLOBAL (C/ BDI)', colSpan: 2, styles: { fontStyle: 'bold', halign: 'left', fillColor: [15, 23, 42], textColor: 255 } },
        { content: formatCurrency(finalTotal), styles: { fontStyle: 'bold', halign: 'right', fillColor: [15, 23, 42], textColor: 255 } },
        ...data.periods.map(() => ({ content: '', styles: { fillColor: [15, 23, 42] } }))
    ]);

    autoTable(doc, {
        startY: 55,
        head: head,
        body: body,
        theme: 'grid',
        styles: { fontSize: 7, cellPadding: 2, overflow: 'linebreak' },
        headStyles: { fillColor: [15, 23, 42], textColor: 255, halign: 'center', fontStyle: 'bold' },
        columnStyles: {
            0: { cellWidth: 12 },
            1: { cellWidth: 'auto' },
            2: { cellWidth: 28, halign: 'right' }
        },
        margin: { bottom: 40 },
        didDrawPage: () => {
            drawFooter(doc, false);
        }
    });

    drawFooter(doc, true);

    doc.save(`Cronograma_${data.budgetName.replace(/\s+/g, '_')}.pdf`);
};
