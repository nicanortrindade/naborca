const lines = [
    "2\tFUNDAÇÃO",
    "2  FUNDAÇÃO",
    "2 FUNDAÇÃO",
    "2",
    "FUNDAÇÃO",
    "12.3",
    "ESQUADRIAS",
    "16.3",
    "SPDA",
    "14.3",
    "METAIS E ACESSÓRIOS"
];

const REGEX_SECTION_TITLE = /^\s*(\d{1,3})\s*([A-ZÁÉÍÓÚÀÃÕÂÊÎÔÛÇ][A-ZÁÉÍÓÚÀÃÕÂÊÎÔÛÇ\s,\/\-().°"']{3,})(?:[\s\d.,]+%?\s*)*$/;
const REGEX_ST_NUMERIC = /^(\d{1,2}(?:\.\d{1,2}){0,2})\s+([A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][A-ZÁÉÍÓÚÀÃÕÂÊÎÔÛÇ ]{4,})$/;
const REGEX_ISO_PATH = /^\s*(\d{1,3}(?:\.\d{1,3}){1,6})\s*$/;
const REGEX_ITEM_PATH = /^\s*(\d{1,3}(?:\.\d{1,3}){1,6})\s*(.{5,})$/;

for (let i = 0; i < lines.length; i++) {
    let clean = lines[i].replace(/\s+/g, ' ').trim();
    console.log(`\n--- Line: '${clean}' ---`);
    console.log(`ETAPA 0: REGEX_SECTION_TITLE ?`, !!clean.match(REGEX_SECTION_TITLE));
    console.log(`P4: REGEX_ISO_PATH ?`, !!clean.match(REGEX_ISO_PATH));
    console.log(`S1: REGEX_ITEM_PATH ?`, !!clean.match(REGEX_ITEM_PATH));
    console.log(`ST: REGEX_ST_NUMERIC ?`, !!clean.match(REGEX_ST_NUMERIC));
    if (clean.match(REGEX_ST_NUMERIC)) {
        console.log(`    Matches:`, clean.match(REGEX_ST_NUMERIC).slice(1));
    }

    if (clean === "2") {
        let extractNum = clean.match(/^(\d+)[\s.A-Za-z]/);
        console.log(`S3 extractSectionNumber('2'):`, extractNum ? extractNum[1] : null);
    }
}
