
const REGEX = /^\s*(\d{1,3})\s*([A-ZÁÉÍÓÚÀÃÕÂÊÎÔÛÇ][A-ZÁÉÍÓÚÀÃÕÂÊÎÔÛÇ\s,\/\-()\.\°\"']{3,})(?:[\s\d.,]+%?\s*)*$/;
const casos = [
    '2FUNDAÇÃO231.554,99',
    '5COBERTURA103.755,60',
    '15INSTALAÇÕES HIDROSSANITÁRIAS229.619,25',
    '16INSTALAÇÕES ELÉTRICAS335.814,70',
    '1 SERVIÇOS PRELIMINARES E INDIRETOS185.303,28',
    '7ESQUADRIAS271.061,07',
    '1234 FALSO POSITIVO',
    '99999FALSO',
    '17.1.10 CPU2656 DUTO PARA EXAUSTAO',
    '15.1.1 CPU2565 TUBO PVC',
    '8.1.1 87905 CHAPISCO'
];
casos.forEach(c => {
    const m = c.match(REGEX);
    console.log(c.substring(0, 45).padEnd(45), '->', m ? '\"' + m[2] + '\"' : 'NO MATCH');
});
