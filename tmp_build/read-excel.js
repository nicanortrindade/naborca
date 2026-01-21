"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const exceljs_1 = __importDefault(require("exceljs"));
const path_1 = __importDefault(require("path"));
async function readExcel() {
    const wb = new exceljs_1.default.Workbook();
    const filePath = path_1.default.resolve('tmp', 'sintetico-gerado.xlsx');
    await wb.xlsx.readFile(filePath);
    const ws = wb.getWorksheet('Sintético');
    console.log("Budget Name:", ws?.getRow(1).getCell(1).value);
}
readExcel();
