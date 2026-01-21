
import ExcelJS from 'exceljs';
import path from 'path';

async function readExcel() {
    const wb = new ExcelJS.Workbook();
    const filePath = path.resolve('tmp', 'sintetico-gerado.xlsx');
    await wb.xlsx.readFile(filePath);
    const ws = wb.getWorksheet('Sintético');
    console.log("Budget Name:", ws?.getRow(1).getCell(1).value);
}

readExcel();
