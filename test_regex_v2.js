
const REGEX_ORIGINAL_REQUEST = /^\s*(\d{1,3})\s*([A-ZÁÉÍÓÚÀÃÕÂÊÎÔÛÇ][A-ZÁÉÍÓÚÀÃÕÂÊÎÔÛÇ\s,\/\-()\.\°\"']{3,?})(?:[\s\d.,]+%?\s*)*$/;

const casos = [
    '2FUNDAÇÃO231.554,99',
    '5COBERTURA103.755,60',
    '15INSTALAÇÕES HIDROSSANITÁRIAS229.619,25',
    '16INSTALAÇÕES ELÉTRICAS335.814,70',
    '1 SERVIÇOS PRELIMINARES E INDIRETOS185.303,28',
    '7ESQUADRIAS271.061,07',
    '1234 FALSO POSITIVO',
    '99999FALSO'
];

console.log('Testing Regex: ' + REGEX_ORIGINAL_REQUEST.toString());

casos.forEach(c => {
    const m = c.match(REGEX_ORIGINAL_REQUEST);
    if (m) {
        console.log('[MATCH] ' + c);
        console.log('  Group 1 (ID):    ' + m[1]);
        console.log('  Group 2 (Title): ' + m[2]);
    } else {
        console.log('[NO MATCH] ' + c);
    }
});
