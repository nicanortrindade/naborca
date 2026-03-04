const lines = [
    "12.3 ESQUADRIAS",
    "14.3 METAIS E ACESSÓRIOS",
    "16.3 SPDA",
];

const REGEX_ST_NUMERIC = /^(\d{1,2}(?:\.\d{1,2}){0,2})\s+([A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][A-ZÁÉÍÓÚÀÃÕÂÊÎÔÛÇ ]{4,})$/;

for (let i = 0; i < lines.length; i++) {
    let clean = lines[i];
    console.log(`\n--- Line: '${clean}' ---`);
    console.log(`ST: REGEX_ST_NUMERIC ?`, !!clean.match(REGEX_ST_NUMERIC));
    if (clean.match(REGEX_ST_NUMERIC)) {
        console.log(`    Matches:`, clean.match(REGEX_ST_NUMERIC).slice(1));
    }
}
