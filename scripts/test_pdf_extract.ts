import * as pdfjsLib from "https://unpkg.com/pdfjs-dist@3.11.174/legacy/build/pdf.js";

// Polyfill DOMMatrix for Deno to parse scale matrices
if (typeof globalThis.DOMMatrix === "undefined") {
    globalThis.DOMMatrix = class DOMMatrix {
        a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
        constructor(init?: string | number[]) {
            if (Array.isArray(init) && init.length === 6) {
                [this.a, this.b, this.c, this.d, this.e, this.f] = init;
            }
        }
    } as any;
}

async function extractPdfText(buffer: ArrayBuffer): Promise<{ text: string, numpages: number } | null> {
    try {
        const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
        const pdf = await loadingTask.promise;
        const numPages = pdf.numPages;
        let fullText = "";

        for (let i = 1; i <= numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();

            const items = textContent.items as any[];
            const lines: { y: number, items: any[] }[] = [];

            for (const item of items) {
                if (!item.str || item.str.trim() === '') continue;
                const x = item.transform[4];
                const y = item.transform[5];

                let foundLine = lines.find(l => Math.abs(l.y - y) <= 3);
                if (!foundLine) {
                    foundLine = { y, items: [] };
                    lines.push(foundLine);
                }
                foundLine.items.push({ str: item.str, x, width: item.width || 0 });
            }

            lines.sort((a, b) => b.y - a.y);

            for (const line of lines) {
                line.items.sort((a, b) => a.x - b.x);
                let lineStr = "";
                let lastRight = -1;

                for (let j = 0; j < line.items.length; j++) {
                    const it = line.items[j];
                    if (j === 0) {
                        lineStr += it.str;
                        lastRight = it.x + it.width;
                    } else {
                        const gap = it.x - lastRight;
                        if (gap > 20) {
                            lineStr += " || " + it.str;
                        } else if (gap > 2) {
                            lineStr += " " + it.str;
                        } else {
                            lineStr += it.str;
                        }
                        lastRight = it.x + it.width;
                    }
                }
                fullText += lineStr + "\n";
            }
            fullText += "\n";
        }
        return { text: fullText.trim(), numpages: numPages };
    } catch (e: any) {
        console.warn("PDF Extraction Exception:", e.message);
        return null;
    }
}

async function run() {
    const file = Deno.args[0];
    if (!file) {
        console.log("Provide file path as arg");
        Deno.exit(1);
    }
    const buf = await Deno.readFile(file);
    const result = await extractPdfText(buf.buffer);

    if (result && result.text) {
        const lines = result.text.split('\n');
        console.log(`PAGES: ${result.numpages}`);
        console.log(`EXTRACTED LENGTH: ${result.text.length}`);
        console.log("FIRST 50 LINES:");
        console.log(lines.slice(0, 50).join('\n'));

        console.log("==== LAST 30 LINES ====");
        console.log(lines.slice(-30).join('\n'));
    }
}

run();
